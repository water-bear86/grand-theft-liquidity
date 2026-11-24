import test from "node:test";
import assert from "node:assert/strict";
import { MemoryStore } from "./store.ts";

const wallet = "7xKptH1dYHh8YQd6a9Qz7xKptH1dYHh8YQd6a9Qz";
const other = "8yLquI2eZIi9ZRe7b0Ra8yLquI2eZIi9ZRe7b0Ra";

test("MemoryStore keeps one best score per wallet and ranks the top 10", async () => {
  const store = new MemoryStore();
  await store.upsertScore({ wallet, score: 100, submittedAt: 10 });
  const skipped = await store.upsertScore({
    wallet,
    score: 80,
    submittedAt: 20,
  });
  assert.deepEqual(skipped, { accepted: false, score: 100 });
  const improved = await store.upsertScore({
    wallet,
    score: 400,
    submittedAt: 30,
  });
  assert.deepEqual(improved, { accepted: true, score: 400 });
  await store.upsertScore({ wallet: other, score: 400, submittedAt: 40 });
  const tiedEarlier = "9zMrvJ3fAJj0ASf8c1Sb9zMrvJ3fAJj0ASf8c1Sb";
  await store.upsertScore({
    wallet: tiedEarlier,
    score: 400,
    submittedAt: 5,
  });
  const top = await store.top(3);
  assert.equal(top[0]?.wallet, tiedEarlier);
  assert.equal(top[1]?.wallet, wallet);
  assert.equal(top[2]?.wallet, other);
  assert.deepEqual(
    top.map((row) => row.rank),
    [1, 2, 3],
  );
  await store.close();
});

test("MemoryStore issues a single-use nonce bound to a wallet", async () => {
  const store = new MemoryStore();
  await store.issueNonce(wallet, "a".repeat(32), 1000);
  assert.equal(await store.consumeNonce(other, "a".repeat(32), 500), false);
  assert.equal(await store.consumeNonce(wallet, "a".repeat(32), 1500), false);
  await store.issueNonce(wallet, "b".repeat(32), 1000);
  assert.equal(await store.consumeNonce(wallet, "b".repeat(32), 999), true);
  assert.equal(await store.consumeNonce(wallet, "b".repeat(32), 999), false);
  await store.close();
});
