import test from "node:test";
import assert from "node:assert/strict";
import nacl from "tweetnacl";
import bs58 from "bs58";
import {
  buildScoreMessage,
  encodeBase58,
} from "../src/leaderboard-protocol.ts";
import {
  decodePublicKey,
  decodeSignature,
  verifyScoreSignature,
} from "./verify.ts";

function signed(score = 2500) {
  const key = nacl.sign.keyPair();
  const wallet = bs58.encode(key.publicKey);
  const submission = {
    wallet,
    score,
    timestamp: 1_700_000_000_000,
    nonce: "ab".repeat(16),
  };
  const message = new TextEncoder().encode(buildScoreMessage(submission));
  const signature = encodeBase58(nacl.sign.detached(message, key.secretKey));
  return { key, wallet, submission, signature };
}

test("verifyScoreSignature accepts a matching ed25519 signature", () => {
  const { submission, signature, wallet } = signed();
  assert.equal(decodePublicKey(wallet)?.length, 32);
  assert.equal(decodeSignature(signature)?.length, 64);
  assert.equal(verifyScoreSignature(submission, signature), true);
});

test("verifyScoreSignature rejects a tampered score or wallet", () => {
  const { submission, signature, key } = signed(2500);
  assert.equal(
    verifyScoreSignature({ ...submission, score: 2501 }, signature),
    false,
  );
  const other = nacl.sign.keyPair();
  assert.equal(
    verifyScoreSignature(
      { ...submission, wallet: bs58.encode(other.publicKey) },
      signature,
    ),
    false,
  );
  const wrong = encodeBase58(
    nacl.sign.detached(new TextEncoder().encode("nope"), key.secretKey),
  );
  assert.equal(verifyScoreSignature(submission, wrong), false);
});

test("verifyScoreSignature rejects malformed signatures and keys", () => {
  const { submission } = signed();
  assert.equal(verifyScoreSignature(submission, "not-base58!"), false);
  assert.equal(verifyScoreSignature(submission, encodeBase58(new Uint8Array(8))), false);
  assert.equal(decodePublicKey("short"), null);
  assert.equal(decodeSignature(""), null);
});

test("encodeBase58 matches bs58 for typical signatures and pubkeys", () => {
  const key = nacl.sign.keyPair();
  const sig = nacl.sign.detached(new TextEncoder().encode("ping"), key.secretKey);
  assert.equal(encodeBase58(key.publicKey), bs58.encode(key.publicKey));
  assert.equal(encodeBase58(sig), bs58.encode(sig));
  assert.equal(encodeBase58(new Uint8Array([0, 0, 17])), bs58.encode(Buffer.from([0, 0, 17])));
});
