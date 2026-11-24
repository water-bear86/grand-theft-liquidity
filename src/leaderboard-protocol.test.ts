import test from "node:test";
import assert from "node:assert/strict";
import {
  BASE58_ALPHABET,
  MAX_SCORE,
  MAX_TIMESTAMP_SKEW_MS,
  buildScoreMessage,
  encodeBase58,
  decodeBase58,
  signatureBytes,
  shortenAddress,
  validateScoreFields,
} from "./leaderboard-protocol.ts";

const wallet = "7xKptH1dYHh8YQd6a9Qz7xKptH1dYHh8YQd6a9Qz";
const now = 1_700_000_000_000;

function payload(overrides: Record<string, unknown> = {}) {
  return {
    wallet,
    score: 12_500,
    timestamp: now,
    nonce: "a".repeat(32),
    ...overrides,
  };
}

test("validateScoreFields accepts a well-formed score", () => {
  const result = validateScoreFields(payload(), now);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.score, 12_500);
    assert.equal(result.value.wallet, wallet);
  }
});

test("validateScoreFields rejects non-integers, negatives, and scores above the cap", () => {
  for (const score of [12.5, -1, MAX_SCORE + 1, Number.NaN, Infinity, "100"]) {
    const result = validateScoreFields(payload({ score }), now);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error, "Invalid score");
  }
  assert.equal(validateScoreFields(payload({ score: 0 }), now).ok, true);
  assert.equal(validateScoreFields(payload({ score: MAX_SCORE }), now).ok, true);
});

test("validateScoreFields rejects malformed wallets, nonces, and stale timestamps", () => {
  assert.equal(validateScoreFields(payload({ wallet: "short" }), now).ok, false);
  assert.equal(
    validateScoreFields(payload({ wallet: "0".repeat(32) }), now).ok,
    false,
  );
  assert.equal(
    validateScoreFields(payload({ nonce: "zz" + "a".repeat(30) }), now).ok,
    false,
  );
  assert.equal(
    validateScoreFields(payload({ nonce: "ab" }), now).ok,
    false,
  );
  assert.equal(
    validateScoreFields(
      payload({ timestamp: now + MAX_TIMESTAMP_SKEW_MS + 1 }),
      now,
    ).ok,
    false,
  );
  assert.equal(
    validateScoreFields(
      payload({ timestamp: now - MAX_TIMESTAMP_SKEW_MS - 1 }),
      now,
    ).ok,
    false,
  );
  assert.equal(validateScoreFields(null, now).ok, false);
  assert.equal(validateScoreFields("nope", now).ok, false);
});

test("buildScoreMessage is canonical and binds wallet, score, timestamp, and nonce", () => {
  const message = buildScoreMessage({
    wallet,
    score: 2500,
    timestamp: now,
    nonce: "ab".repeat(16),
  });
  assert.equal(
    message,
    [
      "Grand Theft Liquidity",
      `Wallet: ${wallet}`,
      "Score: 2500",
      `Timestamp: ${now}`,
      `Nonce: ${"ab".repeat(16)}`,
    ].join("\n"),
  );
});

test("shortenAddress uses a four-character prefix and suffix", () => {
  assert.equal(shortenAddress("7xKptH1dYHh8YQd6a9Qz"), "7xKp…a9Qz");
  assert.equal(shortenAddress("abcd"), "abcd");
});

test("encodeBase58 matches the typical leading-zero and alphabet rules", () => {
  assert.equal(encodeBase58(new Uint8Array()), "");
  assert.equal(encodeBase58(new Uint8Array([0, 0, 1])), "11" + BASE58_ALPHABET[1]);
  assert.equal(encodeBase58(Uint8Array.from([0])), "1");
});

test("decodeBase58 and signatureBytes accept Phantom-style encodings", () => {
  const bytes = Uint8Array.from({ length: 64 }, (_, i) => (i * 7 + 3) & 255);
  const encoded = encodeBase58(bytes);
  assert.deepEqual(decodeBase58(encoded), bytes);
  assert.deepEqual(signatureBytes(bytes), bytes);
  assert.deepEqual(signatureBytes(encoded), bytes);
  const base64 = Buffer.from(bytes).toString("base64");
  assert.deepEqual(signatureBytes(base64), bytes);
  assert.throws(() => signatureBytes("not-a-signature"), /unexpected signature/);
});
