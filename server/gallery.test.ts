import test from "node:test";
import assert from "node:assert/strict";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { encodeBase58, isSolanaAddress } from "../src/leaderboard-protocol.ts";
import {
  ENTRY_LAMPORTS,
  LEGAL_LINE,
  MIN_SHOT_GAP_SEC,
  MEMO_PROGRAM_ID,
  buildFreeEntryMessage,
  buildStoryCompleteMessage,
  forfeitPreimage,
  memoForIntent,
} from "../src/gallery-protocol.ts";
import { findClearTargetShot } from "../src/gallery-sim.ts";
import { MemoryStore } from "./store.ts";
import { MemoryGalleryStore } from "./gallery-store.ts";
import { createLeaderboardServer } from "./index.ts";
import { forfeitCommitment } from "./gallery.ts";
import { inspectTransfer, type RpcTransaction, type SolanaRpc } from "./solana.ts";

function keypair() {
  const pair = nacl.sign.keyPair();
  return { secret: pair.secretKey, wallet: bs58.encode(pair.publicKey) };
}

function sign(secret: Uint8Array, message: string) {
  return encodeBase58(nacl.sign.detached(new TextEncoder().encode(message), secret));
}

function transferTx(input: {
  signature: string;
  source: string;
  destination: string;
  lamports: number;
  memo: string;
}): RpcTransaction {
  return {
    slot: 99,
    meta: { err: null },
    transaction: {
      signatures: [input.signature],
      message: {
        accountKeys: [input.source, input.destination],
        instructions: [
          {
            program: "system",
            programId: "11111111111111111111111111111111",
            parsed: {
              type: "transfer",
              info: {
                source: input.source,
                destination: input.destination,
                lamports: input.lamports,
              },
            },
          },
          {
            program: "spl-memo",
            programId: MEMO_PROGRAM_ID,
            parsed: input.memo as unknown as { type?: string },
            data: Buffer.from(input.memo, "utf8").toString("hex"),
          },
        ],
      },
    },
  };
}

const house = keypair();
const payments = new Map<string, RpcTransaction>();

const rpc: SolanaRpc = async (request) => {
  if (request.method === "getTransaction") {
    const signature = (request.params as unknown[])[0] as string;
    return payments.get(signature) ?? null;
  }
  if (request.method === "getLatestBlockhash") {
    return { value: { blockhash: bs58.encode(nacl.randomBytes(32)), lastValidBlockHeight: 10 } };
  }
  throw new Error(`unexpected rpc ${request.method}`);
};

async function withServer(
  fn: (url: string, clock: { advance(ms: number): void }) => Promise<void>,
  dryRun = true,
) {
  const store = new MemoryStore();
  const gallery = new MemoryGalleryStore();
  const clock = { now: Date.now(), advance(ms: number) { this.now += ms; } };
  const server = createLeaderboardServer({
    store,
    gallery,
    now: () => clock.now,
    galleryConfig: {
      houseWallet: house.wallet,
      rpc,
      dryRun,
      secretKey: house.secret,
      configured: true,
      pickForfeit: () => 5,
    },
    origins: ["http://127.0.0.1:5173"],
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no port");
  const url = `http://127.0.0.1:${address.port}`;
  try {
    await fn(url, clock);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await store.close();
    await gallery.close();
  }
}

async function post(url: string, path: string, body: unknown) {
  const response = await fetch(`${url}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "http://127.0.0.1:5173",
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

async function get(url: string, path: string) {
  const response = await fetch(`${url}${path}`, {
    headers: { Origin: "http://127.0.0.1:5173" },
  });
  return { status: response.status, body: await response.json() };
}

async function unlock(url: string, player: ReturnType<typeof keypair>, replay = false) {
  const nonceRes = await post(url, "/api/nonce", { wallet: player.wallet });
  assert.equal(nonceRes.status, 200, JSON.stringify(nonceRes.body));
  const nonce = (nonceRes.body as { nonce: string }).nonce;
  const payload = { wallet: player.wallet, timestamp: Date.now(), nonce };
  const submitted = await post(url, "/api/gallery/story", {
    ...payload,
    signature: sign(player.secret, buildStoryCompleteMessage(payload)),
  });
  assert.equal(submitted.status, 200, JSON.stringify(submitted.body));
  if (!replay) return;
  const again = await post(url, "/api/gallery/story", {
    ...payload,
    signature: sign(player.secret, buildStoryCompleteMessage(payload)),
  });
  assert.equal(again.status, 400);
  assert.equal((again.body as { error: string }).error, "Invalid or expired nonce");
}

function paymentSignature(label: string) {
  return bs58.encode(nacl.hash(new TextEncoder().encode(label)).slice(0, 64));
}

async function enter(url: string, player: ReturnType<typeof keypair>, label: string) {
  const intent = await post(url, "/api/gallery/intent", { wallet: player.wallet });
  assert.equal(intent.status, 200, JSON.stringify(intent.body));
  const { intentId, memo, houseWallet, lamports } = intent.body as {
    intentId: string;
    memo: string;
    houseWallet: string;
    lamports: number;
  };
  assert.equal(memo, memoForIntent(intentId));
  assert.equal(houseWallet, house.wallet);
  assert.equal(lamports, ENTRY_LAMPORTS);
  const txSignature = paymentSignature(label);
  payments.set(
    txSignature,
    transferTx({
      signature: txSignature,
      source: player.wallet,
      destination: house.wallet,
      lamports: ENTRY_LAMPORTS,
      memo,
    }),
  );
  const entered = await post(url, "/api/gallery/enter", {
    wallet: player.wallet,
    intentId,
    txSignature,
  });
  assert.equal(entered.status, 200, JSON.stringify(entered.body));
  return { ...(entered.body as { round: { token: string; seed: string; commitment: string; potId: string }; pot: { paidCount: number } }), txSignature, intentId };
}

function bullseyes(seed: string, targets: number[], start = 0.5) {
  const shots = [];
  const down = new Set<string>();
  let t = start;
  for (const targetIndex of targets) {
    const shot = findClearTargetShot(seed, targetIndex, t, down);
    shots.push(shot);
    down.add(`t:${targetIndex}`);
    t = shot.t + MIN_SHOT_GAP_SEC;
  }
  return shots;
}

test("a paid round scores, hides rivals until settlement, and rejects payment or token replays", async () => {
  await withServer(async (url, clock) => {
    const a = keypair();
    const b = keypair();
    const c = keypair();
    assert.ok(isSolanaAddress(a.wallet));
    await unlock(url, a, true);
    await unlock(url, b);
    await unlock(url, c);

    const locked = keypair();
    const skipped = await post(url, "/api/gallery/intent", { wallet: locked.wallet });
    assert.equal(skipped.status, 403, JSON.stringify(skipped.body));

    const first = await enter(url, a, "pay-a");
    clock.advance(10_000);
    // A retry with the same payment (lost response, cold start) resumes the same
    // round with a fresh token instead of eating the entry.
    const replayPay = await post(url, "/api/gallery/enter", {
      wallet: a.wallet,
      intentId: first.intentId,
      txSignature: first.txSignature,
    });
    assert.equal(replayPay.status, 200, JSON.stringify(replayPay.body));
    const resumed = replayPay.body as { round: { token: string; seed: string; roundId: string; potId: string } };
    assert.equal(resumed.round.seed, first.round.seed);
    assert.equal(resumed.round.potId, first.round.potId);
    assert.notEqual(resumed.round.token, first.round.token);
    const staleToken = await post(url, "/api/gallery/submit", {
      token: first.round.token,
      shots: bullseyes(first.round.seed, [0, 1, 2, 3, 4]),
    });
    assert.equal(staleToken.status, 400);
    // The same payment cannot be reused by another wallet or another intent.
    const stolen = await post(url, "/api/gallery/enter", {
      wallet: b.wallet,
      intentId: first.intentId,
      txSignature: first.txSignature,
    });
    assert.equal(stolen.status, 400);

    const scored = await post(url, "/api/gallery/submit", {
      token: resumed.round.token,
      shots: bullseyes(first.round.seed, [0, 1, 2, 3, 4]),
    });
    assert.equal(scored.status, 200, JSON.stringify(scored.body));
    const scoredBody = scored.body as {
      result: { status: string; score: number; skippedFifth: boolean };
      reveal: { forfeitIndex: number; salt: string };
      commitment: string;
      seed: string;
      pot: { paidCount: number; entries?: unknown };
    };
    assert.equal(scoredBody.result.status, "scored");
    assert.equal(scoredBody.result.score, 20);
    assert.equal(scoredBody.result.skippedFifth, true);
    assert.equal(scoredBody.reveal.forfeitIndex, 5);
    const body = scored.body as typeof scoredBody & { roundId: string; wallet: string };
    assert.equal(
      forfeitCommitment({
        roundId: body.roundId,
        wallet: a.wallet,
        seed: scoredBody.seed,
        forfeitIndex: scoredBody.reveal.forfeitIndex,
        salt: scoredBody.reveal.salt,
      }),
      scoredBody.commitment,
    );
    const replayToken = await post(url, "/api/gallery/submit", {
      token: resumed.round.token,
      shots: bullseyes(first.round.seed, [0, 1, 2, 3]),
    });
    assert.equal(replayToken.status, 400);

    const second = await enter(url, b, "pay-b");
    clock.advance(10_000);
    const mid = await get(url, `/api/gallery/status?wallet=${b.wallet}`);
    const midPot = (mid.body as { pot: { paidCount: number; entries?: unknown; yours: { score: number | null } } }).pot;
    assert.equal(midPot.paidCount, 2);
    assert.equal(midPot.entries, undefined);

    const bScore = await post(url, "/api/gallery/submit", {
      token: second.round.token,
      shots: [
        { t: 0.5, yaw: 1.05, pitch: -0.55 },
        ...bullseyes(second.round.seed, [0, 1, 2, 3], 0.5 + MIN_SHOT_GAP_SEC),
      ],
    });
    assert.equal(bScore.status, 200, JSON.stringify(bScore.body));
    assert.equal((bScore.body as { result: { score: number } }).result.score, 45);
    const bStatus = await get(url, `/api/gallery/status?wallet=${a.wallet}`);
    const aView = (bStatus.body as { pot: { yours: { score: number }; entries?: unknown; status: string } }).pot;
    assert.equal(aView.status, "open");
    assert.equal(aView.yours.score, 20);
    assert.equal(aView.entries, undefined);

    const third = await enter(url, c, "pay-c");
    clock.advance(10_000);
    const forfeit = await post(url, "/api/gallery/submit", {
      token: third.round.token,
      shots: bullseyes(third.round.seed, [5]),
    });
    assert.equal(forfeit.status, 200, JSON.stringify(forfeit.body));
    const settled = forfeit.body as {
      result: { status: string };
      pot: { status: string; entries: { wallet: string; score: number | null }[] };
      settlement: { kind: string; winningScore: number; winners: string[]; houseCutLamports: number; payouts: { wallet: string; status: string }[] };
    };
    assert.equal(settled.result.status, "forfeit");
    assert.equal(settled.pot.status, "settled");
    assert.equal(settled.settlement.kind, "winner");
    assert.equal(settled.settlement.winningScore, 20);
    assert.deepEqual(settled.settlement.winners, [a.wallet]);
    assert.equal(settled.settlement.houseCutLamports, Math.floor((ENTRY_LAMPORTS * 3 * 500) / 10_000));
    assert.equal(settled.settlement.payouts[0]?.status, "pending");
    assert.ok(settled.pot.entries.some((entry) => entry.wallet === b.wallet && entry.score === 45));
    const publicView = await get(url, `/api/gallery/status?wallet=${c.wallet}`);
    const legal = publicView.body as { legal: string; dryRun: boolean; storyUnlockNote: string; mode: string };
    assert.equal(legal.legal, LEGAL_LINE);
    assert.equal(legal.dryRun, false);
    assert.equal(legal.mode, "live");
    assert.match(legal.storyUnlockNote, /does not independently verify/i);
  }, false);
});

test("tied 20s split the pot and an all-forfeit pot rolls over with no house cut", async () => {
  await withServer(async (url, clock) => {
    const players = [keypair(), keypair(), keypair()];
    for (const player of players) await unlock(url, player);
    const results = [];
    for (const [i, player] of players.entries()) {
      const entered = await enter(url, player, `tie-${i}`);
      clock.advance(10_000);
      const submitted = await post(url, "/api/gallery/submit", {
        token: entered.round.token,
        shots: bullseyes(entered.round.seed, [0, 1, 2, 3]),
      });
      results.push(submitted);
    }
    const last = results[2]!.body as {
      settlement: {
        kind: string;
        winners: string[];
        prizeIgnored?: number;
        payouts: { lamports: number; status: string }[];
        houseCutLamports: number;
        rolloverLamports: number;
      };
    };
    assert.equal(last.settlement.kind, "winner");
    assert.equal(last.settlement.winners.length, 3);
    const gross = ENTRY_LAMPORTS * 3;
    const cut = Math.floor((gross * 500) / 10_000);
    const share = Math.floor((gross - cut) / 3);
    const remainder = gross - cut - share * 3;
    assert.ok(last.settlement.payouts.every((payout) => payout.lamports === share));
    assert.equal(last.settlement.houseCutLamports, cut + remainder);
    assert.equal(last.settlement.payouts[0]?.status, "pending");

    const more = [keypair(), keypair(), keypair()];
    for (const player of more) await unlock(url, player);
    type ForfeitBody = {
      settlement: {
        kind: string;
        rolloverLamports: number;
        houseCutLamports: number;
        winners: string[];
      };
    };
    let lastForfeit: ForfeitBody | undefined;
    for (const [i, player] of more.entries()) {
      const entered = await enter(url, player, `foe-${i}`);
      clock.advance(10_000);
      const submitted = await post(url, "/api/gallery/submit", {
        token: entered.round.token,
        shots: bullseyes(entered.round.seed, [5]),
      });
      lastForfeit = submitted.body as ForfeitBody;
    }
    assert.ok(lastForfeit);
    assert.equal(lastForfeit.settlement.kind, "rollover");
    assert.equal(lastForfeit.settlement.houseCutLamports, 0);
    assert.equal(lastForfeit.settlement.rolloverLamports, ENTRY_LAMPORTS * 3);
    assert.deepEqual(lastForfeit.settlement.winners, []);
  }, false);
});

test("payment verification still rejects a wrong memo at the inspect layer used by enter", () => {
  const payer = keypair();
  const signature = paymentSignature("wrong-memo");
  const tx = transferTx({
    signature,
    source: payer.wallet,
    destination: house.wallet,
    lamports: ENTRY_LAMPORTS,
    memo: "nope",
  });
  const checked = inspectTransfer(tx, {
    signature,
    wallet: payer.wallet,
    houseWallet: house.wallet,
    lamports: ENTRY_LAMPORTS,
    intentId: "ab".repeat(16),
  });
  assert.equal(checked.ok, false);
});

test("dry-run signed free entry starts a round without a payment or story unlock", async () => {
  await withServer(async (url) => {
    const player = keypair();
    const nonceRes = await post(url, "/api/nonce", { wallet: player.wallet });
    assert.equal(nonceRes.status, 200, JSON.stringify(nonceRes.body));
    const payload = {
      wallet: player.wallet,
      timestamp: Date.now(),
      nonce: (nonceRes.body as { nonce: string }).nonce,
    };
    const entered = await post(url, "/api/gallery/enter", {
      ...payload,
      signature: sign(player.secret, buildFreeEntryMessage(payload)),
    });
    assert.equal(entered.status, 200, JSON.stringify(entered.body));
    const body = entered.body as { round: { token: string; seed: string; potId: string } };
    assert.ok(body.round.token);
    assert.ok(body.round.seed);
    const blocked = await post(url, "/api/gallery/enter", {
      ...payload,
      signature: sign(player.secret, buildFreeEntryMessage(payload)),
    });
    assert.equal(blocked.status, 400);
    assert.match((blocked.body as { error: string }).error, /nonce|used/i);
  });
});

test("live mode rejects free test entry", async () => {
  await withServer(async (url) => {
    const player = keypair();
    await unlock(url, player);
    const nonceRes = await post(url, "/api/nonce", { wallet: player.wallet });
    const payload = {
      wallet: player.wallet,
      timestamp: Date.now(),
      nonce: (nonceRes.body as { nonce: string }).nonce,
    };
    const denied = await post(url, "/api/gallery/enter", {
      ...payload,
      signature: sign(player.secret, buildFreeEntryMessage(payload)),
    });
    assert.equal(denied.status, 403);
    assert.match((denied.body as { error: string }).error, /dry run/i);
    const cors = await fetch(`${url}/api/gallery/enter`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://127.0.0.1:5173",
      },
      body: JSON.stringify({ ...payload, signature: sign(player.secret, buildFreeEntryMessage(payload)) }),
    });
    assert.equal(cors.status, 403);
    assert.equal(cors.headers.get("access-control-allow-origin"), "http://127.0.0.1:5173");
  }, false);
});

test("live mode still requires a signed story unlock before entry", async () => {
  await withServer(async (url) => {
    const player = keypair();
    const denied = await post(url, "/api/gallery/intent", { wallet: player.wallet });
    assert.equal(denied.status, 403);
    assert.match((denied.body as { error: string }).error, /story/i);
  }, false);
});
