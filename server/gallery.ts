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
} from "./gallery-store.ts";
import {
  latestBlockhash,
  payoutMemo,
  publicKeyFromSecret,
  sendPayout,
  sha256Hex,
  verifyPayment,
  type SolanaRpc,
} from "./solana.ts";

export type GalleryConfig = {
  houseWallet: string;
  rpc: SolanaRpc | null;
  dryRun: boolean;
  secretKey: Uint8Array | null;
  configured: boolean;
  /** Test hook. Production always uses a CSPRNG. */
  pickForfeit?: () => number;
};

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
  if (!isSolanaAddress(wallet))
    return { ok: false, error: "Invalid wallet", status: 400 };
  if (!(await store.hasStoryComplete(wallet)))
    return {
      ok: false,
      error: "Finish the story once, then sign the unlock, before entering the gallery",
      status: 403,
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
  | { ok: false; error: string; status: number }
> {
  if (!config.configured || !config.houseWallet || !config.rpc)
    return { ok: false, error: "The shooting gallery is not configured", status: 503 };
  const { wallet, intentId, txSignature } = input;
  if (!isSolanaAddress(wallet))
    return { ok: false, error: "Invalid wallet", status: 400 };
  if (!isIntentId(intentId))
    return { ok: false, error: "Invalid entry intent", status: 400 };
  if (typeof txSignature !== "string" || txSignature.length < 32)
    return { ok: false, error: "Invalid payment signature", status: 400 };
  if (!(await store.hasStoryComplete(wallet)))
    return {
      ok: false,
      error: "Finish the story once, then sign the unlock, before entering the gallery",
      status: 403,
    };
  await store.expireStale(now);
  await maybeSettle(store, config, now);
  if (await store.paymentUsed(txSignature))
    return { ok: false, error: "Payment already used", status: 400 };
  const paid = await verifyPayment(config.rpc, {
    signature: txSignature,
    wallet,
    houseWallet: config.houseWallet,
    lamports: ENTRY_LAMPORTS,
    intentId,
  });
  if (!paid.ok) return { ok: false, error: paid.error, status: 400 };
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
  if (!(await store.hasStoryComplete(checked.value.wallet)))
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
  const settled = await maybeSettle(store, config, now);
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
    paidCount: entries.length,
    completedCount: entries.filter((entry) => entry.status !== "playing").length,
    playersNeeded: PLAYERS_PER_POT,
    rolloverLamports: pot.rolloverLamports,
    potLamports: pot.rolloverLamports + entries.length * ENTRY_LAMPORTS,
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
): Promise<{ pot: GalleryPot; next: GalleryPot } | null> {
  const open = await store.getOpenPot();
  if (!open) return null;
  const entries = await store.listEntries(open.id);
  const done = entries.filter((entry) => entry.status !== "playing");
  if (done.length < PLAYERS_PER_POT) return null;
  const settlement = settlePot(
    done.map((entry) =>
      entry.status === "scored" && entry.score != null
        ? { wallet: entry.wallet, status: "scored" as const, score: entry.score }
        : { wallet: entry.wallet, status: "forfeit" as const, score: null },
    ),
    open.rolloverLamports,
  );
  const payouts: GalleryPayout[] = settlement.payouts.map((payout) => ({
    id: hex(16),
    potId: open.id,
    wallet: payout.wallet,
    lamports: payout.lamports,
    status: config.dryRun ? "dry_run" : "pending",
    txSignature: null,
    error: config.dryRun ? "dry_run" : null,
    createdAt: now,
    updatedAt: now,
  }));
  const next: GalleryPot = {
    id: hex(16),
    status: "open",
    rolloverLamports: settlement.rolloverLamports,
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
  if (result && !config.dryRun) await processPayouts(store, config, now);
  return result;
}

export async function processPayouts(
  store: GalleryStore,
  config: GalleryConfig,
  now: number,
): Promise<void> {
  if (config.dryRun) return;
  if (!config.rpc || !config.secretKey || !config.houseWallet) return;
  const open = await store.listOpenPayouts();
  for (const payout of open) {
    const claimed = await store.updatePayout({
      id: payout.id,
      status: "pending",
      now,
      expected: ["pending"],
    });
    if (!claimed) continue;
    try {
      const sent = await sendPayout({
        rpc: config.rpc,
        secret: config.secretKey,
        to: payout.wallet,
        lamports: payout.lamports,
        memo: payoutMemo(payout.potId, payout.wallet),
      });
      await store.updatePayout({
        id: payout.id,
        status: "sent",
        txSignature: sent.signature,
        error: null,
        now,
        expected: ["pending"],
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Payout failed";
      await store.updatePayout({
        id: payout.id,
        status: "failed",
        error: message.slice(0, 200),
        now,
        expected: ["pending"],
      });
    }
  }
}

export async function galleryStatus(
  store: GalleryStore,
  config: GalleryConfig,
  wallet: string | undefined,
  now: number,
) {
  await store.expireStale(now);
  await maybeSettle(store, config, now);
  const pot = (await store.getOpenPot()) ?? (wallet ? await activePotFor(store, wallet) : null);
  const recent = pot ? await publicPot(store, pot.id, wallet) : null;
  const completed = wallet ? await store.hasStoryComplete(wallet) : false;
  const active = wallet ? await store.getActiveEntry(wallet) : null;
  return {
    configured: config.configured && !!config.houseWallet,
    houseWallet: config.houseWallet || null,
    entryLamports: ENTRY_LAMPORTS,
    legal: LEGAL_LINE,
    dryRun: config.dryRun,
    payoutsEnabled: !config.dryRun,
    storyCompleted: completed,
    storyUnlockNote:
      "Story completion is reported by the client and signed by the wallet. The server does not independently verify that the story was actually finished.",
    pot: recent,
    activeRound: active
      ? { potId: active.potId, expiresAt: active.expiresAt, startedAt: active.createdAt }
      : null,
  };
}

async function activePotFor(store: GalleryStore, wallet: string): Promise<GalleryPot | null> {
  const active = await store.getActiveEntry(wallet);
  if (active) return store.getPot(active.potId);
  return store.getOpenPot();
}

export function publicKeyOrNull(secret: Uint8Array | null): string | null {
  if (!secret) return null;
  return publicKeyFromSecret(secret);
}
