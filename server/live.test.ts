// Go-live readiness tests: pot isolation between dry run and live, paid entry
// recovery, and the payout worker's balance cap and idempotency.
// Runs against the in-memory store always, and against Postgres too when
// GTL_TEST_DATABASE_URL points at a throwaway database.
import test from "node:test";
import assert from "node:assert/strict";
import nacl from "tweetnacl";
import bs58 from "bs58";
import postgres from "postgres";
import type { IncomingMessage } from "node:http";
import { encodeBase58 } from "../src/leaderboard-protocol.ts";
import {
  ENTRY_LAMPORTS,
  INTENT_TTL_MS,
  MEMO_PROGRAM_ID,
  buildFreeEntryMessage,
  memoForIntent,
} from "../src/gallery-protocol.ts";
import {
  MemoryGalleryStore,
  PostgresGalleryStore,
  type GalleryStore,
} from "./gallery-store.ts";
import {
  enterFreeRound,
  enterRound,
  galleryStatus,
  issueIntent,
  liveProblems,
  processPayouts,
  submitRound,
  type GalleryConfig,
} from "./gallery.ts";
import {
  PAYOUT_FEE_LAMPORTS,
  RENT_EXEMPT_RESERVE_LAMPORTS,
  spendableLamports,
  type RpcTransaction,
  type SolanaRpc,
} from "./solana.ts";
import { clientIp, isPrivateProxyAddress } from "./index.ts";

function keypair() {
  const pair = nacl.sign.keyPair();
  return { secret: pair.secretKey, wallet: bs58.encode(pair.publicKey) };
}
const house = keypair();
const nonceHex = () => Buffer.from(nacl.randomBytes(16)).toString("hex");
const sigOf = (label: string) => bs58.encode(nacl.hash(new TextEncoder().encode(label)).slice(0, 64));

type Chain = {
  payments: Map<string, RpcTransaction>;
  balance: number;
  height: number;
  landed: Map<string, "confirmed" | "failed">;
  sends: string[];
  sendBehavior: "land" | "throw-but-land" | "throw-drop" | "drop";
  rpc: SolanaRpc;
};

function chain(): Chain {
  const c: Chain = {
    payments: new Map(),
    balance: 0,
    height: 100,
    landed: new Map(),
    sends: [],
    sendBehavior: "land",
    rpc: async () => null,
  };
  c.rpc = async (request) => {
    const params = (request.params ?? []) as unknown[];
    switch (request.method) {
      case "getTransaction":
        return c.payments.get(params[0] as string) ?? null;
      case "getLatestBlockhash":
        return { value: { blockhash: bs58.encode(nacl.randomBytes(32)), lastValidBlockHeight: c.height + 150 } };
      case "getBalance":
        return { value: c.balance };
      case "getBlockHeight":
        return c.height;
      case "getSignatureStatuses": {
        const sig = (params[0] as string[])[0]!;
        const state = c.landed.get(sig);
        if (!state) return { value: [null] };
        return { value: [{ err: state === "failed" ? { InstructionError: [0, "x"] } : null, confirmationStatus: "confirmed" }] };
      }
      case "sendTransaction": {
        const raw = Buffer.from(params[0] as string, "base64");
        const sig = bs58.encode(raw.subarray(1, 65));
        c.sends.push(sig);
        const lamports = readLamports(raw);
        if (c.sendBehavior === "land" || c.sendBehavior === "throw-but-land") {
          c.landed.set(sig, "confirmed");
          c.balance -= lamports + PAYOUT_FEE_LAMPORTS;
        }
        if (c.sendBehavior.startsWith("throw")) throw new Error("socket hang up");
        return sig;
      }
    }
    throw new Error(`unexpected rpc ${request.method}`);
  };
  return c;
}

// Pull the transfer amount back out of our own serialized transfer for the fake ledger.
function readLamports(raw: Buffer): number {
  const idx = raw.indexOf(Buffer.from([2, 0, 0, 0]));
  return Number(raw.readBigUInt64LE(idx + 4));
}

function payTx(c: Chain, input: { signature: string; from: string; memo: string; lamports?: number; blockTime?: number }) {
  c.payments.set(input.signature, {
    slot: 1,
    blockTime: input.blockTime ?? null,
    meta: { err: null },
    transaction: {
      signatures: [input.signature],
      message: {
        accountKeys: [input.from, house.wallet],
        instructions: [
          {
            program: "system",
            programId: "11111111111111111111111111111111",
            parsed: { type: "transfer", info: { source: input.from, destination: house.wallet, lamports: input.lamports ?? ENTRY_LAMPORTS } },
          },
          { program: "spl-memo", programId: MEMO_PROGRAM_ID, parsed: input.memo as unknown as { type?: string } },
        ],
      },
    },
  });
}

function config(c: Chain, dryRun: boolean, extra: Partial<GalleryConfig> = {}): GalleryConfig {
  return {
    houseWallet: house.wallet,
    rpc: c.rpc,
    dryRun,
    secretKey: house.secret,
    configured: true,
    pickForfeit: () => 5,
    payoutConfirmPolls: 2,
    payoutConfirmDelayMs: 1,
    paymentVerifyDelayMs: 1,
    ...extra,
  };
}

const always = async () => true;

async function freeEnter(store: GalleryStore, cfg: GalleryConfig, now: number) {
  const player = keypair();
  const payload = { wallet: player.wallet, timestamp: now, nonce: nonceHex() };
  const signature = encodeBase58(nacl.sign.detached(new TextEncoder().encode(buildFreeEntryMessage(payload)), player.secret));
  const entered = await enterFreeRound(store, cfg, { ...payload, signature }, now, always);
  assert.ok(entered.ok, JSON.stringify(entered));
  return { player, round: entered.round };
}

async function paidEnter(store: GalleryStore, c: Chain, cfg: GalleryConfig, now: number, label: string, player = keypair()) {
  await store.markStoryComplete(player.wallet, now);
  const intent = await issueIntent(store, player.wallet, cfg, now);
  assert.ok(intent.ok, JSON.stringify(intent));
  const signature = sigOf(label);
  payTx(c, { signature, from: player.wallet, memo: memoForIntent(intent.intentId), blockTime: Math.floor(now / 1000) });
  const entered = await enterRound(store, cfg, { wallet: player.wallet, intentId: intent.intentId, txSignature: signature }, now);
  assert.ok(entered.ok, JSON.stringify(entered));
  return { player, round: entered.round, intentId: intent.intentId, signature };
}

type StoreFactory = { name: string; make: () => Promise<{ store: GalleryStore; done: () => Promise<void> }> };
const factories: StoreFactory[] = [
  { name: "memory", make: async () => { const store = new MemoryGalleryStore(); return { store, done: () => store.close() }; } },
];
const pgUrl = process.env.GTL_TEST_DATABASE_URL;
if (pgUrl) {
  factories.push({
    name: "postgres",
    make: async () => {
      const sql = postgres(pgUrl, { max: 4, onnotice: () => {} });
      await sql`DROP TABLE IF EXISTS gallery_entries, gallery_payouts, gallery_pots, gallery_payments, gallery_intents, story_completions CASCADE`;
      const store = new PostgresGalleryStore(sql);
      await store.setup();
      return { store, done: () => store.close() };
    },
  });
}

for (const factory of factories) {
  test(`[${factory.name}] dry-run entries never touch the live pot, and test pots never roll over`, async () => {
    const { store, done } = await factory.make();
    try {
      const c = chain();
      const dry = config(c, true);
      let now = Date.now();
      // Three dry-run rounds that all forfeit: the old build rolled 0.15 SOL forward from this.
      for (let i = 0; i < 3; i++) {
        const { round } = await freeEnter(store, dry, now);
        const done2 = await submitRound(store, dry, { token: round.token, abandon: true }, now + 1000);
        assert.ok(done2.ok, JSON.stringify(done2));
        now += 2000;
      }
      const dryStatus = await galleryStatus(store, dry, undefined, now);
      assert.equal(dryStatus.mode, "test");
      assert.equal(dryStatus.pot?.mode, "test");
      assert.equal(dryStatus.pot?.rolloverLamports, 0, "an all-forfeit test pot does not roll fake SOL forward");
      assert.equal(dryStatus.pot?.potLamports, 0);
      const { round } = await freeEnter(store, dry, now);
      const testPot = await store.getPot(round.potId);
      const testView = await galleryStatus(store, dry, undefined, now);
      assert.equal(testView.pot?.paidCount, 1);
      assert.equal(testView.pot?.potLamports, 0, "free entries add no SOL to a test pot");
      assert.equal(testPot?.mode, "test");
      assert.equal(testPot?.rolloverLamports, 0);

      // Paid entry is refused while dry run is on, so no real SOL lands in a test pot.
      const player = keypair();
      await store.markStoryComplete(player.wallet, now);
      const refused = await issueIntent(store, player.wallet, dry, now);
      assert.equal(refused.ok, false);
      assert.equal(!refused.ok && refused.status, 403);
      const refusedEnter = await enterRound(store, dry, { wallet: player.wallet, intentId: "ab".repeat(16), txSignature: sigOf("x") }, now);
      assert.equal(!refusedEnter.ok && refusedEnter.status, 403);

      // Flip to live: the live pot is separate and starts from zero.
      const live = config(c, false);
      const liveStatus = await galleryStatus(store, live, undefined, now);
      assert.equal(liveStatus.mode, "live");
      assert.equal(liveStatus.dryRun, false);
      assert.equal(liveStatus.payoutsEnabled, true);
      assert.equal(liveStatus.pot, null);
      const paid = await paidEnter(store, c, live, now, `iso-${factory.name}`);
      const livePot = await store.getPot(paid.round.potId);
      assert.equal(livePot?.mode, "live");
      assert.equal(livePot?.rolloverLamports, 0);
      assert.notEqual(livePot?.id, testPot?.id);
      const view = await galleryStatus(store, live, paid.player.wallet, now);
      assert.equal(view.pot?.paidCount, 1);
      assert.equal(view.pot?.potLamports, ENTRY_LAMPORTS);
      // Free entry is refused once live.
      const p2 = keypair();
      const payload = { wallet: p2.wallet, timestamp: now, nonce: nonceHex() };
      const signature = encodeBase58(nacl.sign.detached(new TextEncoder().encode(buildFreeEntryMessage(payload)), p2.secret));
      const free = await enterFreeRound(store, live, { ...payload, signature }, now, always);
      assert.equal(!free.ok && free.status, 403);
    } finally {
      await done();
    }
  });

  test(`[${factory.name}] a paid entry survives a slow chain, an expired intent window, and lost responses`, async () => {
    const { store, done } = await factory.make();
    try {
      const c = chain();
      const live = config(c, false);
      const now = Date.now();
      const player = keypair();
      await store.markStoryComplete(player.wallet, now);
      const intent = await issueIntent(store, player.wallet, live, now);
      assert.ok(intent.ok);
      const signature = sigOf(`slow-${factory.name}`);
      // Not visible on chain yet: retryable, not a hard failure.
      const fast = { ...live, rpc: c.rpc };
      const early = await enterRound(store, fast, { wallet: player.wallet, intentId: intent.intentId, txSignature: signature }, now);
      assert.equal(early.ok, false);
      assert.equal(!early.ok && early.status, 503);
      assert.equal(!early.ok && early.retryable, true);
      // Paid inside the window, but the API only hears about it 40 minutes later (cold start, closed tab).
      payTx(c, { signature, from: player.wallet, memo: memoForIntent(intent.intentId), blockTime: Math.floor((now + 60_000) / 1000) });
      const later = now + INTENT_TTL_MS + 25 * 60_000;
      const entered = await enterRound(store, live, { wallet: player.wallet, intentId: intent.intentId, txSignature: signature }, later);
      assert.ok(entered.ok, JSON.stringify(entered));
      // The round clock starts when the entry is opened, not when it was paid.
      assert.equal(entered.round.startedAt, later);
      // Lost response: same payment returns the same round with a new token.
      const again = await enterRound(store, live, { wallet: player.wallet, intentId: intent.intentId, txSignature: signature }, later + 2000);
      assert.ok(again.ok, JSON.stringify(again));
      assert.equal(again.round.roundId, entered.round.roundId);

      // A payment that landed AFTER its intent expired is rejected.
      const other = keypair();
      await store.markStoryComplete(other.wallet, now);
      const i2 = await issueIntent(store, other.wallet, live, now);
      assert.ok(i2.ok);
      const late = sigOf(`late-${factory.name}`);
      payTx(c, { signature: late, from: other.wallet, memo: memoForIntent(i2.intentId), blockTime: Math.floor((now + INTENT_TTL_MS + 60_000) / 1000) });
      const rejected = await enterRound(store, live, { wallet: other.wallet, intentId: i2.intentId, txSignature: late }, now + INTENT_TTL_MS + 70_000);
      assert.equal(rejected.ok, false);

      // Wrong amount and wrong memo are hard failures.
      const third = keypair();
      await store.markStoryComplete(third.wallet, now);
      const i3 = await issueIntent(store, third.wallet, live, now);
      assert.ok(i3.ok);
      const cheap = sigOf(`cheap-${factory.name}`);
      payTx(c, { signature: cheap, from: third.wallet, memo: memoForIntent(i3.intentId), lamports: ENTRY_LAMPORTS - 1 });
      const short = await enterRound(store, live, { wallet: third.wallet, intentId: i3.intentId, txSignature: cheap }, now);
      assert.equal(!short.ok && short.status, 400);

      // Can't pay twice into the same pot: refused before paying.
      const dup = await issueIntent(store, player.wallet, live, later + 3000);
      assert.equal(!dup.ok && dup.status, 409);
    } finally {
      await done();
    }
  });

  test(`[${factory.name}] payouts respect the house balance, never double-pay, and recover from a lost broadcast`, async () => {
    const { store, done } = await factory.make();
    try {
      const c = chain();
      const live = config(c, false);
      let now = Date.now();
      // Three paid players; the first scores best and wins.
      const rounds = [];
      for (let i = 0; i < 3; i++) rounds.push(await paidEnter(store, c, live, now + i, `pay-${factory.name}-${i}`));
      // Entry SOL arrives in the house wallet, but pretend most of it was swept, leaving too little.
      c.balance = RENT_EXEMPT_RESERVE_LAMPORTS + 1_000;
      for (const [i, r] of rounds.entries()) {
        const res = await submitRound(store, live, { token: r.round.token, abandon: i !== 0 ? true : false, shots: [] }, now + 5000 + i);
        assert.ok(res.ok, JSON.stringify(res));
      }
      // Player 0 submitted zero shots, which scores as five misses (125) and still beats two forfeits.
      await processPayouts(store, live, now + 10_000);
      let rows = await store.getPayouts(rounds[0]!.round.potId);
      assert.equal(rows.length, 1);
      assert.equal(rows[0]!.status, "held", "not enough SOL: held, not sent");
      assert.equal(c.sends.length, 0);
      const prize = rows[0]!.lamports;
      assert.equal(prize, ENTRY_LAMPORTS * 3 - Math.floor((ENTRY_LAMPORTS * 3 * 500) / 10_000));

      // Fund it. Broadcast "fails" (socket hang up) but the transaction actually landed.
      c.balance = prize + PAYOUT_FEE_LAMPORTS + RENT_EXEMPT_RESERVE_LAMPORTS;
      assert.equal(spendableLamports(c.balance), prize);
      c.sendBehavior = "throw-but-land";
      await Promise.all([processPayouts(store, live, now + 20_000), processPayouts(store, live, now + 20_000)]);
      rows = await store.getPayouts(rounds[0]!.round.potId);
      assert.equal(rows[0]!.status, "sent");
      assert.equal(c.sends.length, 1, "concurrent runs send once");
      // Re-running the worker never pays again.
      await processPayouts(store, live, now + 30_000);
      assert.equal(c.sends.length, 1);
      assert.equal(c.balance, RENT_EXEMPT_RESERVE_LAMPORTS);
    } finally {
      await done();
    }
  });

  test(`[${factory.name}] a dropped payout is re-signed only after its blockhash expires`, async () => {
    const { store, done } = await factory.make();
    try {
      const c = chain();
      const live = config(c, false);
      const now = Date.now();
      const rounds = [];
      for (let i = 0; i < 3; i++) rounds.push(await paidEnter(store, c, live, now + i, `drop-${factory.name}-${i}`));
      c.balance = 10 * ENTRY_LAMPORTS;
      c.sendBehavior = "throw-drop";
      for (const [i, r] of rounds.entries())
        await submitRound(store, live, { token: r.round.token, abandon: i !== 0, shots: [] }, now + 5000 + i);
      await processPayouts(store, live, now + 10_000);
      let rows = await store.getPayouts(rounds[0]!.round.potId);
      assert.equal(rows[0]!.status, "sending");
      assert.ok(rows[0]!.txSignature);
      assert.equal(c.sends.length, 1);
      // Still inside the blockhash window: never re-sign.
      await processPayouts(store, live, now + 20_000);
      assert.equal(c.sends.length, 1);
      // Window passed and the chain never saw it: safe to sign a fresh one.
      c.height += 1000;
      c.sendBehavior = "land";
      await processPayouts(store, live, now + 30_000);
      rows = await store.getPayouts(rounds[0]!.round.potId);
      assert.equal(rows[0]!.status, "sent");
      assert.equal(c.sends.length, 2);
      assert.notEqual(c.sends[0], c.sends[1]);
    } finally {
      await done();
    }
  });
}

test("payouts over the safety cap are held for a manual look", async () => {
  const store = new MemoryGalleryStore();
  const c = chain();
  const live = config(c, false, { maxPayoutLamports: ENTRY_LAMPORTS });
  const now = Date.now();
  const rounds = [];
  for (let i = 0; i < 3; i++) rounds.push(await paidEnter(store, c, live, now + i, `cap-${i}`));
  c.balance = 100 * ENTRY_LAMPORTS;
  for (const [i, r] of rounds.entries())
    await submitRound(store, live, { token: r.round.token, abandon: i !== 0, shots: [] }, now + 5000 + i);
  await processPayouts(store, live, now + 10_000);
  const rows = await store.getPayouts(rounds[0]!.round.potId);
  assert.equal(rows[0]!.status, "held");
  assert.match(rows[0]!.error ?? "", /safety cap/);
  assert.equal(c.sends.length, 0);
});

test("live mode with no payout signer refuses paid entry and reports what's missing", async () => {
  const store = new MemoryGalleryStore();
  const c = chain();
  const live = config(c, false, { secretKey: null });
  assert.deepEqual(liveProblems(live), ["HOUSE_WALLET_SECRET is not set or not readable"]);
  const player = keypair();
  await store.markStoryComplete(player.wallet, Date.now());
  const refused = await issueIntent(store, player.wallet, live, Date.now());
  assert.equal(!refused.ok && refused.status, 503);
  const status = await galleryStatus(store, live, undefined, Date.now());
  assert.equal(status.payoutsEnabled, false);
  const wrong = config(c, false, { secretKey: keypair().secret });
  assert.deepEqual(liveProblems(wrong), ["HOUSE_WALLET_SECRET does not match HOUSE_WALLET"]);
  assert.deepEqual(liveProblems(config(c, false)), []);
});

test("rate limits use Render's forwarded client address only behind its private proxy", () => {
  const req = (remoteAddress: string, xff?: string) =>
    ({ socket: { remoteAddress }, headers: xff ? { "x-forwarded-for": xff } : {} }) as unknown as IncomingMessage;
  assert.equal(isPrivateProxyAddress("10.1.2.3"), true);
  assert.equal(isPrivateProxyAddress("::ffff:10.1.2.3"), true);
  assert.equal(isPrivateProxyAddress("127.0.0.1"), false);
  assert.equal(isPrivateProxyAddress("203.0.113.9"), false);
  assert.equal(clientIp(req("10.0.0.5", "1.1.1.1, 198.51.100.7")), "198.51.100.7");
  assert.equal(clientIp(req("127.0.0.1", "198.51.100.7")), "127.0.0.1");
  assert.equal(clientIp(req("203.0.113.9", "198.51.100.7")), "203.0.113.9");
  assert.equal(clientIp(req("10.0.0.5")), "10.0.0.5");
  process.env.RENDER = "true";
  try {
    assert.equal(clientIp(req("216.24.57.1", "1.1.1.1, 198.51.100.7")), "198.51.100.7");
  } finally {
    delete process.env.RENDER;
  }
});

if (pgUrl) {
  test("[postgres] upgrading the live database turns old dry-run pots into test pots and clears their fake rollover", async () => {
    const sql = postgres(pgUrl, { max: 2, onnotice: () => {} });
    try {
      await sql`DROP TABLE IF EXISTS gallery_entries, gallery_payouts, gallery_pots, gallery_payments, gallery_intents, story_completions CASCADE`;
      // The schema exactly as the previous build created it (no mode column).
      await sql`CREATE TABLE gallery_pots (id TEXT PRIMARY KEY, status TEXT NOT NULL, rollover_lamports BIGINT NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL, settled_at TIMESTAMPTZ, settlement_json TEXT)`;
      await sql`CREATE TABLE gallery_payouts (id TEXT PRIMARY KEY, pot_id TEXT NOT NULL, wallet TEXT NOT NULL, lamports BIGINT NOT NULL, status TEXT NOT NULL, tx_signature TEXT, error TEXT, created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL, UNIQUE (pot_id, wallet))`;
      await sql`INSERT INTO gallery_pots VALUES ('old-settled', 'settled', 0, now(), now(), NULL), ('old-open', 'open', 150000000, now(), NULL, NULL)`;
      const store = new PostgresGalleryStore(sql);
      await store.setup();
      const open = await store.getOpenPot("test");
      assert.equal(open?.id, "old-open");
      assert.equal(open?.rolloverLamports, 0);
      assert.equal(await store.getOpenPot("live"), null);
      // Running setup again (every boot) is harmless.
      await store.setup();
      const live = await galleryStatus(store, config(chain(), false), undefined, Date.now());
      assert.equal(live.pot, null);
    } finally {
      await sql.end({ timeout: 2 });
    }
  });
}
