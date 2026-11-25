import { createHash, randomBytes, randomInt } from "node:crypto";
import {
  ENTRY_LAMPORTS,
  INTENT_TTL_MS,
  LEGAL_LINE,
  MAX_ROUND_SEC,
  PLAYERS_PER_POT,
  ROUND_SUBMIT_SLACK_SEC,
  TARGET_COUNT,
  buildFreeEntryMessage,
  buildStoryCompleteMessage,
  forfeitPreimage,
  isIntentId,
  isRoundToken,
  memoForIntent,
  settlePot,
  validateShotFields,
  validateStoryFields,
  type PotSettlement,
  type ShotInput,
} from "../src/gallery-protocol.ts";
import { isSolanaAddress } from "../src/leaderboard-protocol.ts";
import { evaluateRound } from "../src/gallery-sim.ts";
import { verifyWalletMessage } from "./verify.ts";
import {
  EnterError,
  type GalleryEntry,
  type GalleryPayout,
  type GalleryPot,
  type GalleryStore,
  type PotMode,
} from "./gallery-store.ts";
import {
  getBalance,
  getBlockHeight,
  getSignatureState,
  isRetryablePaymentError,
  latestBlockhash,
  payoutMemo,
  publicKeyFromSecret,
  sendSignedTransaction,
  sha256Hex,
  signPayout,
  spendableLamports,
  verifyPayment,
  type SolanaRpc,
} from "./solana.ts";

/** Default per-payout safety cap (1 SOL). Larger payouts are held for a manual look. */
export const DEFAULT_MAX_PAYOUT_LAMPORTS = 1_000_000_000;

export type GalleryConfig = {
  houseWallet: string;
  rpc: SolanaRpc | null;
  dryRun: boolean;
  secretKey: Uint8Array | null;
  configured: boolean;
  /** Per-payout safety cap in lamports. Defaults to DEFAULT_MAX_PAYOUT_LAMPORTS. */
  maxPayoutLamports?: number;
  /** Test hook. Production always uses a CSPRNG. */
  pickForfeit?: () => number;
  /** Test hook for payout confirmation polling. */
  payoutConfirmPolls?: number;
  payoutConfirmDelayMs?: number;
  paymentVerifyDelayMs?: number;
};

export function potMode(config: GalleryConfig): PotMode {
  return config.dryRun ? "test" : "live";
}

/**
 * What live mode still needs. Empty means a GALLERY_DRY_RUN=false flip is safe.
 * Never includes secret values, only which piece is missing.
 */
export function liveProblems(config: GalleryConfig): string[] {
  const problems: string[] = [];
  if (!config.configured || !config.houseWallet) problems.push("HOUSE_WALLET is not set");
  if (!config.rpc) problems.push("SOLANA_RPC_URL is not set");
  if (!config.secretKey) problems.push("HOUSE_WALLET_SECRET is not set or not readable");
  else if (config.houseWallet && publicKeyFromSecret(config.secretKey) !== config.houseWallet)
    problems.push("HOUSE_WALLET_SECRET does not match HOUSE_WALLET");
  return problems;
}

export function forfeitCommitment(input: {
  roundId: string;
  wallet: string;
  seed: string;
  forfeitIndex: number;
  salt: string;
}): string {
  return createHash("sha256").update(forfeitPreimage(input)).digest("hex");
}

export function tokenHash(token: string): string {
  return sha256Hex(token);
}

function hex(size: number): string {
  return randomBytes(size).toString("hex");
}

export async function reportStoryComplete(
  store: GalleryStore,
  input: unknown,
  now: number,
  consumeNonce: (wallet: string, nonce: string, now: number) => Promise<boolean>,
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const checked = validateStoryFields(input, now);
  if (!checked.ok) return { ok: false, error: checked.error, status: 400 };
  const signature =
    input && typeof input === "object"
      ? (input as { signature?: unknown }).signature
      : undefined;
  if (typeof signature !== "string")
    return { ok: false, error: "Missing signature", status: 400 };
  const message = buildStoryCompleteMessage(checked.value);
  if (!verifyWalletMessage(checked.value.wallet, message, signature))
    return { ok: false, error: "Invalid signature", status: 400 };
  const consumed = await consumeNonce(checked.value.wallet, checked.value.nonce, now);
  if (!consumed) return { ok: false, error: "Invalid or expired nonce", status: 400 };
  await store.markStoryComplete(checked.value.wallet, now);
  return { ok: true };
}

export async function storyRequirementMet(store: GalleryStore, config: GalleryConfig, wallet: string) {
  if (config.dryRun) return true;
  return store.hasStoryComplete(wallet);
}

export async function issueIntent(
  store: GalleryStore,
  wallet: string,
  config: GalleryConfig,
  now: number,
): Promise<
  | {
      ok: true;
      intentId: string;
      memo: string;
      houseWallet: string;
      lamports: number;
      expiresAt: number;
      blockhash: string | null;
      lastValidBlockHeight: number | null;
    }
  | { ok: false; error: string; status: number }
> {
  if (!config.configured || !config.houseWallet)
    return { ok: false, error: "The shooting gallery is not configured", status: 503 };
  if (config.dryRun)
    return {
      ok: false,
      error: "Paid entry opens when the gallery goes live. Use the free test entry for now.",
      status: 403,
    };
  if (liveProblems(config).length)
    return { ok: false, error: "Paid entry is paused while payouts are being set up", status: 503 };
  if (!isSolanaAddress(wallet))
    return { ok: false, error: "Invalid wallet", status: 400 };
  if (!(await storyRequirementMet(store, config, wallet)))
    return {
      ok: false,
      error: "Finish the story once, then sign the unlock, before entering the gallery",
      status: 403,
    };
  // Refuse before the wallet pays, not after.
  await store.expireStale(now);
  await maybeSettle(store, config, now);
  if (await store.getActiveEntry(wallet))
    return { ok: false, error: "This wallet already has an open round. Finish it first.", status: 409 };
  const open = await store.getOpenPot("live");
  if (open && (await store.listEntries(open.id)).some((entry) => entry.wallet === wallet))
    return {
      ok: false,
      error: "This wallet is already in the current pot. Wait for it to settle, then enter again.",
      status: 409,
    };
  const intentId = hex(16);
  const expiresAt = now + INTENT_TTL_MS;
  await store.createIntent({
    id: intentId,
    wallet,
    expiresAt,
    usedAt: null,
    txSignature: null,
  });
  let blockhash: string | null = null;
  let lastValidBlockHeight: number | null = null;
  if (config.rpc) {
    try {
      const latest = await latestBlockhash(config.rpc);
      blockhash = latest.blockhash;
      lastValidBlockHeight = latest.lastValidBlockHeight;
    } catch {
      blockhash = null;
    }
  }
  return {
    ok: true,
    intentId,
    memo: memoForIntent(intentId),
    houseWallet: config.houseWallet,
    lamports: ENTRY_LAMPORTS,
    expiresAt,
    blockhash,
    lastValidBlockHeight,
  };
}

export async function enterRound(
  store: GalleryStore,
  config: GalleryConfig,
  input: { wallet: string; intentId: string; txSignature: string },
  now: number,
): Promise<
  | {
      ok: true;
      round: {
        token: string;
        roundId: string;
        seed: string;
        commitment: string;
        expiresAt: number;
        startedAt: number;
        potId: string;
      };
      pot: PublicPotView;
    }
  | { ok: false; error: string; status: number; retryable?: boolean }
> {
  if (!config.configured || !config.houseWallet || !config.rpc)
    return { ok: false, error: "The shooting gallery is not configured", status: 503 };
  if (config.dryRun)
    return {
      ok: false,
      error: "Paid entry opens when the gallery goes live. Use the free test entry for now.",
      status: 403,
    };
  const { wallet, intentId, txSignature } = input;
  if (!isSolanaAddress(wallet))
    return { ok: false, error: "Invalid wallet", status: 400 };
  if (!isIntentId(intentId))
    return { ok: false, error: "Invalid entry intent", status: 400 };
  if (typeof txSignature !== "string" || txSignature.length < 32)
    return { ok: false, error: "Invalid payment signature", status: 400 };
  if (!(await storyRequirementMet(store, config, wallet)))
    return {
      ok: false,
      error: "Finish the story once, then sign the unlock, before entering the gallery",
      status: 403,
    };
  await store.expireStale(now);
  await maybeSettle(store, config, now);
  if (await store.paymentUsed(txSignature)) {
    // Idempotent retry: the entry went through but the response never reached the
    // player (timeout, closed tab, cold start). Hand back the same round with a fresh token.
    const existing = await store.getEntryByPayment(txSignature);
    if (
      existing &&
      existing.wallet === wallet &&
      existing.intentId === intentId &&
      existing.status === "playing" &&
      existing.expiresAt > now
    ) {
      const token = hex(32);
      const rotated = await store.rotateEntryToken({ entryId: existing.id, tokenHash: tokenHash(token) });
      if (rotated) {
        const pot = await publicPot(store, rotated.potId, wallet);
        return {
          ok: true,
          round: {
            token,
            roundId: rotated.roundId,
            seed: rotated.seed,
            commitment: rotated.commitment,
            expiresAt: rotated.expiresAt,
            startedAt: rotated.createdAt,
            potId: rotated.potId,
          },
          pot,
        };
      }
    }
    return { ok: false, error: "Payment already used", status: 400 };
  }
  const paid = await verifyPayment(config.rpc, {
    signature: txSignature,
    wallet,
    houseWallet: config.houseWallet,
    lamports: ENTRY_LAMPORTS,
    intentId,
  }, "confirmed", config.paymentVerifyDelayMs != null ? { delayMs: config.paymentVerifyDelayMs } : {});
  if (!paid.ok) {
    if (isRetryablePaymentError(paid.error))
      return {
        ok: false,
        error: `${paid.error}. Your payment is safe; the range will keep checking.`,
        status: 503,
        retryable: true,
      };
    return { ok: false, error: paid.error, status: 400 };
  }
  const token = hex(32);
  const seed = hex(16);
  const salt = hex(16);
  const roundId = hex(16);
  const forfeitIndex = config.pickForfeit ? config.pickForfeit() % TARGET_COUNT : randomInt(TARGET_COUNT);
  const commitment = forfeitCommitment({
    roundId,
    wallet,
    seed,
    forfeitIndex,
    salt,
  });
  const entry: GalleryEntry = {
    id: hex(16),
    potId: hex(16),
    wallet,
    status: "playing",
    score: null,
    intentId,
    txSignature,
    roundId,
    tokenHash: tokenHash(token),
    seed,
    forfeitIndex,
    salt,
    commitment,
    createdAt: now,
    expiresAt: now + (MAX_ROUND_SEC + ROUND_SUBMIT_SLACK_SEC) * 1000,
    submittedAt: null,
    result: null,
  };
  try {
    const accepted = await store.enter({
      intentId,
      wallet,
      txSignature,
      now,
      paidAt: paid.paidAt ?? now,
      mode: "live",
      entry,
    });
    console.log(
      `gallery paid entry wallet=${wallet} pot=${accepted.pot.id} tx=${txSignature}`,
    );
    const pot = await publicPot(store, accepted.pot.id, wallet);
    return {
      ok: true,
      round: {
        token,
        roundId: accepted.entry.roundId,
        seed,
        commitment,
        expiresAt: accepted.entry.expiresAt,
        startedAt: accepted.entry.createdAt,
        potId: accepted.pot.id,
      },
      pot,
    };
  } catch (error) {
    if (error instanceof EnterError) {
      if (/already in the current pot|already has an open round/.test(error.message))
        return {
          ok: false,
          error: `${error.message}. Your payment is recorded on chain and still valid for 24 hours; retry once that clears.`,
          status: 409,
          retryable: true,
        };
      return { ok: false, error: error.message, status: 400 };
    }
    throw error;
  }
}

export async function enterFreeRound(
  store: GalleryStore,
  config: GalleryConfig,
  input: unknown,
  now: number,
  consumeNonce: (wallet: string, nonce: string, now: number) => Promise<boolean>,
): Promise<
  | {
      ok: true;
      round: {
        token: string;
        roundId: string;
        seed: string;
        commitment: string;
        expiresAt: number;
        startedAt: number;
        potId: string;
      };
      pot: PublicPotView;
    }
  | { ok: false; error: string; status: number }
> {
  if (!config.dryRun)
    return {
      ok: false,
      error: "Free test entry is only available while payouts are in dry run",
      status: 403,
    };
  if (!config.configured || !config.houseWallet)
    return { ok: false, error: "The shooting gallery is not configured", status: 503 };
  const checked = validateStoryFields(input, now);
  if (!checked.ok) return { ok: false, error: checked.error, status: 400 };
  const signature =
    input && typeof input === "object"
      ? (input as { signature?: unknown }).signature
      : undefined;
  if (typeof signature !== "string")
    return { ok: false, error: "Missing signature", status: 400 };
  if (!verifyWalletMessage(checked.value.wallet, buildFreeEntryMessage(checked.value), signature))
    return { ok: false, error: "Invalid signature", status: 400 };
  if (!(await storyRequirementMet(store, config, checked.value.wallet)))
    return {
      ok: false,
      error: "Finish the story once, then sign the unlock, before entering the gallery",
      status: 403,
    };
  const consumed = await consumeNonce(checked.value.wallet, checked.value.nonce, now);
  if (!consumed) return { ok: false, error: "Invalid or expired nonce", status: 400 };
  const wallet = checked.value.wallet;
  const intentId = hex(16);
  const txSignature = `dryrun:${checked.value.nonce}`;
  if (await store.paymentUsed(txSignature))
    return { ok: false, error: "Entry already used", status: 400 };
  await store.createIntent({
    id: intentId,
    wallet,
    expiresAt: now + INTENT_TTL_MS,
    usedAt: null,
    txSignature: null,
  });
  await store.expireStale(now);
  await maybeSettle(store, config, now);
  const token = hex(32);
  const seed = hex(16);
  const salt = hex(16);
  const roundId = hex(16);
  const forfeitIndex = config.pickForfeit ? config.pickForfeit() % TARGET_COUNT : randomInt(TARGET_COUNT);
  const commitment = forfeitCommitment({
    roundId,
    wallet,
    seed,
    forfeitIndex,
    salt,
  });
  const entry: GalleryEntry = {
    id: hex(16),
    potId: hex(16),
    wallet,
    status: "playing",
    score: null,
    intentId,
    txSignature,
    roundId,
    tokenHash: tokenHash(token),
    seed,
    forfeitIndex,
    salt,
    commitment,
    createdAt: now,
    expiresAt: now + (MAX_ROUND_SEC + ROUND_SUBMIT_SLACK_SEC) * 1000,
    submittedAt: null,
    result: null,
  };
  try {
    const accepted = await store.enter({
      intentId,
      wallet,
      txSignature,
      now,
      mode: "test",
      entry,
    });
    const pot = await publicPot(store, accepted.pot.id, wallet);
    return {
      ok: true,
      round: {
        token,
        roundId: accepted.entry.roundId,
        seed,
        commitment,
        expiresAt: accepted.entry.expiresAt,
        startedAt: accepted.entry.createdAt,
        potId: accepted.pot.id,
      },
      pot,
    };
  } catch (error) {
    if (error instanceof EnterError)
      return { ok: false, error: error.message, status: 400 };
    throw error;
  }
}

export async function submitRound(
  store: GalleryStore,
  config: GalleryConfig,
  input: { token: string; shots?: unknown; abandon?: boolean },
  now: number,
): Promise<
  | {
      ok: true;
      result: {
        status: "scored" | "forfeit";
        score: number | null;
        shots: unknown;
        cleanHits: number;
        skippedFifth: boolean;
      };
      reveal: { forfeitIndex: number; salt: string };
      commitment: string;
      seed: string;
      roundId: string;
      wallet: string;
      pot: PublicPotView;
      settlement: PublicSettlement | null;
    }
  | { ok: false; error: string; status: number }
> {
  if (!isRoundToken(input.token))
    return { ok: false, error: "Invalid round token", status: 400 };
  await store.expireStale(now);
  const entry = await store.getEntryByTokenHash(tokenHash(input.token));
  if (!entry) return { ok: false, error: "Unknown or already used round", status: 400 };
  if (entry.status !== "playing")
    return { ok: false, error: "This round was already submitted", status: 400 };
  let evaluation;
  if (input.abandon) {
    evaluation = {
      status: "forfeit" as const,
      score: null,
      shots: [],
      cleanHits: 0,
      skippedFifth: false,
    };
  } else {
    const shots = validateShotFields(input.shots);
    if ("error" in shots) return { ok: false, error: shots.error, status: 400 };
    const elapsedSec = Math.max(0, (now - entry.createdAt) / 1000);
    const result = evaluateRound({
      seed: entry.seed,
      forfeitIndex: entry.forfeitIndex,
      shots: shots as ShotInput[],
      elapsedSec,
    });
    if ("error" in result) return { ok: false, error: result.error, status: 400 };
    evaluation = result;
  }
  const completed = await store.completeEntry({
    tokenHash: entry.tokenHash,
    status: evaluation.status,
    score: evaluation.status === "scored" ? evaluation.score : null,
    result: evaluation,
    now,
  });
  if (!completed) return { ok: false, error: "This round was already submitted", status: 400 };
  const entryPot = await store.getPot(completed.potId);
  const settled = await maybeSettle(store, config, now, entryPot?.mode ?? potMode(config));
  const pot = await publicPot(store, completed.potId, completed.wallet);
  const settlement =
    settled && settled.pot.id === completed.potId
      ? await publicSettlement(store, settled.pot)
      : pot.status === "settled"
        ? await publicSettlement(store, (await store.getPot(completed.potId))!)
        : null;
  return {
    ok: true,
    result: evaluation,
    reveal: { forfeitIndex: entry.forfeitIndex, salt: entry.salt },
    commitment: entry.commitment,
    seed: entry.seed,
    roundId: entry.roundId,
    wallet: entry.wallet,
    pot,
    settlement,
  };
}

export type PublicPotView = {
  id: string;
  status: "open" | "settled";
  /** "test" pots are dry-run only and hold no real SOL. */
  mode: PotMode;
  paidCount: number;
  completedCount: number;
  playersNeeded: number;
  rolloverLamports: number;
  potLamports: number;
  yours: {
    status: "playing" | "scored" | "forfeit";
    score: number | null;
  } | null;
  entries?: Array<{
    wallet: string;
    status: "scored" | "forfeit";
    score: number | null;
  }>;
  settlement?: PublicSettlement | null;
};

export type PublicSettlement = {
  kind: PotSettlement["kind"];
  winningScore: number | null;
  winners: string[];
  houseCutLamports: number;
  rolloverLamports: number;
  payouts: Array<{
    wallet: string;
    lamports: number;
    status: string;
    txSignature: string | null;
  }>;
};

export async function publicPot(
  store: GalleryStore,
  potId: string,
  wallet?: string,
): Promise<PublicPotView> {
  const pot = await store.getPot(potId);
  if (!pot)
    return {
      id: potId,
      status: "open",
      mode: "test",
      paidCount: 0,
      completedCount: 0,
      playersNeeded: PLAYERS_PER_POT,
      rolloverLamports: 0,
      potLamports: 0,
      yours: null,
    };
  const entries = await store.listEntries(pot.id);
  const yours = wallet ? entries.find((entry) => entry.wallet === wallet) : undefined;
  const view: PublicPotView = {
    id: pot.id,
    status: pot.status,
    mode: pot.mode,
    paidCount: entries.length,
    completedCount: entries.filter((entry) => entry.status !== "playing").length,
    playersNeeded: PLAYERS_PER_POT,
    rolloverLamports: pot.rolloverLamports,
    // Test pots hold no real SOL, so they always report 0.
    potLamports: pot.mode === "live" ? pot.rolloverLamports + entries.length * ENTRY_LAMPORTS : 0,
    yours: yours
      ? {
          status: yours.status,
          score: pot.status === "settled" || yours.wallet === wallet ? yours.score : null,
        }
      : null,
  };
  if (pot.status === "settled") {
    view.entries = entries.map((entry) => ({
      wallet: entry.wallet,
      status: entry.status === "playing" ? "forfeit" : entry.status,
      score: entry.score,
    }));
    view.settlement = await publicSettlement(store, pot);
  }
  return view;
}

async function publicSettlement(store: GalleryStore, pot: GalleryPot): Promise<PublicSettlement | null> {
  if (!pot.settlement) return null;
  const payouts = await store.getPayouts(pot.id);
  const byWallet = new Map(payouts.map((row) => [row.wallet, row]));
  return {
    kind: pot.settlement.kind,
    winningScore: pot.settlement.winningScore,
    winners: pot.settlement.winners,
    houseCutLamports: pot.settlement.houseCutLamports,
    rolloverLamports: pot.settlement.rolloverLamports,
    payouts: pot.settlement.payouts.map((payout) => {
      const row = byWallet.get(payout.wallet);
      return {
        wallet: payout.wallet,
        lamports: payout.lamports,
        status: row?.status ?? "pending",
        txSignature: row?.txSignature ?? null,
      };
    }),
  };
}

export async function maybeSettle(
  store: GalleryStore,
  config: GalleryConfig,
  now: number,
  mode: PotMode = potMode(config),
): Promise<{ pot: GalleryPot; next: GalleryPot } | null> {
  const open = await store.getOpenPot(mode);
  if (!open) return null;
  // Test pots never carry real SOL: no rollover in, no rollover out, payouts are dry_run.
  const live = open.mode === "live";
  const entries = await store.listEntries(open.id);
  const done = entries.filter((entry) => entry.status !== "playing");
  if (done.length < PLAYERS_PER_POT) return null;
  const settlement = settlePot(
    done.map((entry) =>
      entry.status === "scored" && entry.score != null
        ? { wallet: entry.wallet, status: "scored" as const, score: entry.score }
        : { wallet: entry.wallet, status: "forfeit" as const, score: null },
    ),
    live ? open.rolloverLamports : 0,
  );
  const payouts: GalleryPayout[] = settlement.payouts.map((payout) => ({
    id: hex(16),
    potId: open.id,
    wallet: payout.wallet,
    lamports: payout.lamports,
    status: live ? "pending" : "dry_run",
    txSignature: null,
    error: live ? null : "dry_run",
    createdAt: now,
    updatedAt: now,
  }));
  const next: GalleryPot = {
    id: hex(16),
    status: "open",
    mode: open.mode,
    rolloverLamports: live ? settlement.rolloverLamports : 0,
    createdAt: now,
    settledAt: null,
    settlement: null,
  };
  const result = await store.settlePot({
    potId: open.id,
    settlement,
    now,
    nextPot: next,
    payouts,
  });
  if (result && live) {
    console.log(
      `gallery pot settled pot=${open.id} kind=${settlement.kind} payouts=${payouts.length} rollover=${settlement.rolloverLamports}`,
    );
    // Don't hold the player's request open while payouts confirm.
    if (!config.dryRun)
      void processPayouts(store, config, now).catch((error) =>
        console.error("gallery payout run failed", error instanceof Error ? error.message : error),
      );
  }
  return result;
}

const payoutRuns = new WeakMap<GalleryStore, Promise<void>>();

/**
 * Pays every owed live payout. Safe to call any number of times: runs are
 * serialized per store, each payout is claimed in the database before
 * broadcast, and a signed-but-unconfirmed payout is reconciled against the
 * chain instead of being signed again.
 */
export function processPayouts(
  store: GalleryStore,
  config: GalleryConfig,
  now: number = Date.now(),
): Promise<void> {
  const running = payoutRuns.get(store);
  if (running) return running;
  const run = runPayouts(store, config, now).finally(() => payoutRuns.delete(store));
  payoutRuns.set(store, run);
  return run;
}

async function runPayouts(store: GalleryStore, config: GalleryConfig, now: number) {
  if (config.dryRun) return;
  if (liveProblems(config).length) return;
  const rpc = config.rpc!;
  const secret = config.secretKey!;
  const rows = await store.listOpenPayouts();
  if (!rows.length) return;
  const live: GalleryPayout[] = [];
  for (const row of rows) {
    const pot = await store.getPot(row.potId);
    if (pot?.mode === "live") live.push(row);
  }
  // Resolve in-flight attempts first so the balance check below is honest.
  for (const payout of live.filter((row) => row.status === "sending"))
    await reconcilePayout(store, rpc, payout, now);
  const fresh = await store.listOpenPayouts();
  let inFlight = fresh
    .filter((row) => row.status === "sending")
    .reduce((sum, row) => sum + row.lamports, 0);
  const cap = config.maxPayoutLamports ?? DEFAULT_MAX_PAYOUT_LAMPORTS;
  for (const payout of fresh) {
    if (payout.status === "sending") continue;
    if (!live.some((row) => row.id === payout.id)) continue;
    if (payout.lamports <= 0) continue;
    if (payout.lamports > cap) {
      await store.updatePayout({
        id: payout.id,
        status: "held",
        error: `Payout exceeds the ${cap} lamport safety cap; review and pay manually or raise GALLERY_MAX_PAYOUT_LAMPORTS`,
        now,
        expected: [payout.status],
      });
      console.warn(`gallery payout held (cap) id=${payout.id} lamports=${payout.lamports}`);
      continue;
    }
    let balance: number;
    try {
      balance = await getBalance(rpc, config.houseWallet);
    } catch (error) {
      console.error("gallery payout: could not read house balance", error instanceof Error ? error.message : error);
      return;
    }
    if (spendableLamports(balance, inFlight) < payout.lamports) {
      await store.updatePayout({
        id: payout.id,
        status: "held",
        error: "House wallet balance is too low to cover this payout plus fee and rent reserve",
        now,
        expected: [payout.status],
      });
      console.warn(
        `gallery payout held (balance) id=${payout.id} lamports=${payout.lamports} balance=${balance} inFlight=${inFlight}`,
      );
      continue;
    }
    let signed;
    try {
      signed = await signPayout({
        rpc,
        secret,
        to: payout.wallet,
        lamports: payout.lamports,
        memo: payoutMemo(payout.potId, payout.wallet),
      });
    } catch (error) {
      console.error("gallery payout: could not build transaction", error instanceof Error ? error.message : error);
      return;
    }
    // Record the exact signature BEFORE broadcasting. If we crash or the send
    // times out, the next run asks the chain about this signature.
    const claimed = await store.updatePayout({
      id: payout.id,
      status: "sending",
      txSignature: signed.signature,
      lastValidBlockHeight: signed.lastValidBlockHeight,
      error: null,
      now,
      expected: [payout.status],
    });
    if (!claimed) continue;
    inFlight += payout.lamports;
    try {
      await sendSignedTransaction(rpc, signed.serialized);
      console.log(`gallery payout broadcast id=${payout.id} lamports=${payout.lamports} tx=${signed.signature}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Payout broadcast failed";
      console.error(`gallery payout broadcast error id=${payout.id}: ${message.slice(0, 200)}`);
      await store.updatePayout({
        id: payout.id,
        status: "sending",
        error: message.slice(0, 200),
        now,
        expected: ["sending"],
      });
    }
    const polls = config.payoutConfirmPolls ?? 12;
    const delay = config.payoutConfirmDelayMs ?? 1500;
    for (let i = 0; i < polls; i++) {
      const current = (await store.getPayouts(payout.potId)).find((row) => row.id === payout.id);
      if (!current || current.status !== "sending") break;
      const settled = await reconcilePayout(store, rpc, current, now);
      if (settled !== "sending") {
        // Sent: the confirmed balance now reflects it. Pending: nothing left the wallet.
        inFlight -= payout.lamports;
        break;
      }
      if (i < polls - 1) await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

async function reconcilePayout(
  store: GalleryStore,
  rpc: SolanaRpc,
  payout: GalleryPayout,
  now: number,
): Promise<"sent" | "pending" | "sending"> {
  if (!payout.txSignature) {
    await store.updatePayout({ id: payout.id, status: "pending", now, expected: ["sending"] });
    return "pending";
  }
  let state;
  try {
    state = await getSignatureState(rpc, payout.txSignature);
  } catch {
    return "sending";
  }
  if (state === "confirmed") {
    await store.updatePayout({ id: payout.id, status: "sent", error: null, now, expected: ["sending"] });
    console.log(`gallery payout confirmed id=${payout.id} tx=${payout.txSignature}`);
    return "sent";
  }
  if (state === "failed") {
    await store.updatePayout({
      id: payout.id,
      status: "pending",
      txSignature: null,
      lastValidBlockHeight: null,
      error: "Previous attempt failed on chain; will retry",
      now,
      expected: ["sending"],
    });
    return "pending";
  }
  // Unknown: only re-sign once this transaction can no longer land.
  if (payout.lastValidBlockHeight == null) return "sending";
  let height: number;
  try {
    height = await getBlockHeight(rpc);
  } catch {
    return "sending";
  }
  if (height <= payout.lastValidBlockHeight) return "sending";
  const again = await getSignatureState(rpc, payout.txSignature).catch(() => "unknown" as const);
  if (again === "confirmed") {
    await store.updatePayout({ id: payout.id, status: "sent", error: null, now, expected: ["sending"] });
    return "sent";
  }
  await store.updatePayout({
    id: payout.id,
    status: "pending",
    txSignature: null,
    lastValidBlockHeight: null,
    error: "Previous attempt expired without landing; will retry",
    now,
    expected: ["sending"],
  });
  return "pending";
}

export async function galleryStatus(
  store: GalleryStore,
  config: GalleryConfig,
  wallet: string | undefined,
  now: number,
) {
  await store.expireStale(now);
  await maybeSettle(store, config, now);
  const mode = potMode(config);
  const active0 = wallet ? await store.getActiveEntry(wallet) : null;
  const pot = active0
    ? await store.getPot(active0.potId)
    : await store.getOpenPot(mode);
  const recent = pot ? await publicPot(store, pot.id, wallet) : null;
  const completed = wallet ? await store.hasStoryComplete(wallet) : false;
  const active = wallet ? await store.getActiveEntry(wallet) : null;
  return {
    configured: config.configured && !!config.houseWallet,
    houseWallet: config.houseWallet || null,
    entryLamports: ENTRY_LAMPORTS,
    legal: LEGAL_LINE,
    dryRun: config.dryRun,
    mode,
    payoutsEnabled: !config.dryRun && liveProblems(config).length === 0,
    liveReady: liveProblems(config).length === 0,
    storyCompleted: completed,
    storyUnlockNote:
      "Story completion is reported by the client and signed by the wallet. The server does not independently verify that the story was actually finished.",
    pot: recent,
    activeRound: active
      ? { potId: active.potId, expiresAt: active.expiresAt, startedAt: active.createdAt }
      : null,
  };
}

export function publicKeyOrNull(secret: Uint8Array | null): string | null {
  if (!secret) return null;
  return publicKeyFromSecret(secret);
}
