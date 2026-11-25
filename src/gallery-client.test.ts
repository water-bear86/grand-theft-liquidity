import test, { mock } from "node:test";
import assert from "node:assert/strict";

mock.module("./leaderboard-client.ts", {
  exports: {
    leaderboardApiBase: () => "https://range.test",
    isUserRejection: () => false,
  },
});
mock.module("./wallet.ts", { exports: { wallet: { address: "W1" } } });

const memory = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, v: string) => void memory.set(k, v),
  removeItem: (k: string) => void memory.delete(k),
};

const { redeemPendingEntry, loadPendingEntry } = await import("./gallery-client.ts");

const round = { token: "t", roundId: "r", seed: "s", commitment: "c", expiresAt: 1, startedAt: 1, potId: "p" };
const pending = { wallet: "W1", intentId: "i", txSignature: "sig", paidAt: Date.now() };

function respond(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

test("a paid entry keeps retrying through a cold start and a not-yet-confirmed payment", async () => {
  memory.set("gtl-pending-paid-entry", JSON.stringify(pending));
  const replies = [
    () => { throw new TypeError("Failed to fetch"); },
    () => respond(502, {}),
    () => respond(503, { error: "Payment transaction not found", retryable: true }),
    () => respond(200, { round }),
  ];
  let calls = 0;
  const original = globalThis.fetch;
  globalThis.fetch = (async () => replies[calls++]!()) as typeof fetch;
  const statuses: string[] = [];
  try {
    const got = await redeemPendingEntry(pending, (s) => statuses.push(s), { sleep: async () => {} });
    assert.deepEqual(got, round);
    assert.equal(calls, 4);
    assert.equal(loadPendingEntry("W1"), null, "cleared once the round opens");
    assert.match(statuses.at(-1)!, /entry is safe/);
  } finally {
    globalThis.fetch = original;
  }
});

test("a hard rejection clears the saved entry; an already-in-pot conflict keeps it for later", async () => {
  const original = globalThis.fetch;
  try {
    memory.set("gtl-pending-paid-entry", JSON.stringify(pending));
    globalThis.fetch = (async () => respond(400, { error: "Payment amount does not match the entry fee" })) as typeof fetch;
    await assert.rejects(redeemPendingEntry(pending, undefined, { sleep: async () => {} }), /does not match/);
    assert.equal(loadPendingEntry("W1"), null);

    memory.set("gtl-pending-paid-entry", JSON.stringify(pending));
    globalThis.fetch = (async () => respond(409, { error: "already in the current pot", retryable: true })) as typeof fetch;
    await assert.rejects(redeemPendingEntry(pending, undefined, { sleep: async () => {} }), /current pot/);
    assert.ok(loadPendingEntry("W1"));
    assert.equal(loadPendingEntry("SOMEONE_ELSE"), null);
  } finally {
    globalThis.fetch = original;
  }
});

test("if the range never answers, the payment stays saved and the player is told how to resume", async () => {
  memory.set("gtl-pending-paid-entry", JSON.stringify(pending));
  const original = globalThis.fetch;
  globalThis.fetch = (async () => respond(503, { error: "asleep", retryable: true })) as typeof fetch;
  try {
    await assert.rejects(
      redeemPendingEntry(pending, undefined, { sleep: async () => {}, maxWaitMs: -1 }),
      /saved on this device/,
    );
    assert.ok(loadPendingEntry("W1"));
  } finally {
    globalThis.fetch = original;
  }
});
