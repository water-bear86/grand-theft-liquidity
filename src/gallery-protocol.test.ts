import test from "node:test";
import assert from "node:assert/strict";
import {
  buildFreeEntryMessage,
  buildStoryCompleteMessage,
  ENTRY_LAMPORTS,
  MISS_SCORE,
  PLAYERS_PER_POT,
  houseCutLamports,
  memoForIntent,
  scoreFromRadius,
  settlePot,
} from "./gallery-protocol.ts";

test("ring scores go 5, 10, 15, 20 and a miss is 25", () => {
  assert.deepEqual(scoreFromRadius(0), { points: 5, ring: 0 });
  assert.deepEqual(scoreFromRadius(0.12), { points: 5, ring: 0 });
  assert.deepEqual(scoreFromRadius(0.1201), { points: 10, ring: 1 });
  assert.deepEqual(scoreFromRadius(0.32), { points: 10, ring: 1 });
  assert.deepEqual(scoreFromRadius(0.58), { points: 15, ring: 2 });
  assert.deepEqual(scoreFromRadius(1), { points: 20, ring: 3 });
  assert.deepEqual(scoreFromRadius(1.0001), { points: MISS_SCORE, ring: -1 });
  assert.deepEqual(scoreFromRadius(Number.NaN), { points: MISS_SCORE, ring: -1 });
});

test("settlement pays the lowest score and takes a 5% house cut", () => {
  const settled = settlePot(
    [
      { wallet: "a", status: "scored", score: 40 },
      { wallet: "b", status: "scored", score: 25 },
      { wallet: "c", status: "forfeit", score: null },
    ],
    0,
  );
  assert.equal(settled.kind, "winner");
  assert.equal(settled.grossLamports, PLAYERS_PER_POT * ENTRY_LAMPORTS);
  assert.equal(settled.houseCutLamports, houseCutLamports(settled.grossLamports));
  assert.equal(settled.prizeLamports, settled.grossLamports - settled.houseCutLamports);
  assert.deepEqual(settled.winners, ["b"]);
  assert.equal(settled.winningScore, 25);
  assert.deepEqual(settled.payouts, [
    { wallet: "b", lamports: settled.prizeLamports },
  ]);
  assert.equal(settled.rolloverLamports, 0);
});

test("tied lowest scores split the prize evenly", () => {
  const settled = settlePot([
    { wallet: "a", status: "scored", score: 20 },
    { wallet: "b", status: "scored", score: 20 },
    { wallet: "c", status: "scored", score: 35 },
  ]);
  assert.equal(settled.kind, "winner");
  const expectedCut = houseCutLamports(settled.grossLamports);
  const prize = settled.grossLamports - expectedCut;
  const share = Math.floor(prize / 2);
  const remainder = prize - share * 2;
  assert.deepEqual(settled.winners, ["a", "b"]);
  assert.equal(settled.prizeLamports, share * 2);
  assert.equal(settled.houseCutLamports, expectedCut + remainder);
  assert.equal(settled.remainderLamports, remainder);
  assert.deepEqual(settled.payouts, [
    { wallet: "a", lamports: share },
    { wallet: "b", lamports: share },
  ]);
});

test("if every player forfeits, the whole pot rolls forward with no house cut", () => {
  const settled = settlePot(
    [
      { wallet: "a", status: "forfeit", score: null },
      { wallet: "b", status: "forfeit", score: null },
      { wallet: "c", status: "forfeit", score: null },
    ],
    ENTRY_LAMPORTS,
  );
  assert.equal(settled.kind, "rollover");
  assert.equal(settled.houseCutLamports, 0);
  assert.equal(settled.rolloverLamports, PLAYERS_PER_POT * ENTRY_LAMPORTS + ENTRY_LAMPORTS);
  assert.deepEqual(settled.winners, []);
  assert.deepEqual(settled.payouts, []);
});

test("memoForIntent is a stable memo prefix", () => {
  assert.equal(memoForIntent("ab".repeat(16)), "GTL-GALLERY:" + "ab".repeat(16));
});

test("free entry and story messages are distinct bindings", () => {
  const input = { wallet: "7xKptH1dYHh8YQd6a9Qz7xKptH1dYHh8YQd6a9Qz", timestamp: 1, nonce: "a".repeat(32) };
  const free = buildFreeEntryMessage(input);
  const story = buildStoryCompleteMessage(input);
  assert.match(free, /Gallery free entry/);
  assert.match(story, /Story complete/);
  assert.notEqual(free, story);
});
