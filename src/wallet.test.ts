import test from "node:test";
import assert from "node:assert/strict";
import nacl from "tweetnacl";
import { wallet } from "./wallet.ts";
import { encodeBase58 } from "./leaderboard-protocol.ts";
import { describeRangeError } from "./gallery-client.ts";
import { isUserRejection } from "./leaderboard-client.ts";

test("restores the public key from a trusted Phantom connection", { concurrency: false }, async () => {
  const publicKey = { toString: () => "wallet-address" };
  let connectHandler: ((key: typeof publicKey) => void) | undefined;
  const provider = {
    on(event: string, handler: typeof connectHandler) {
      if (event === "connect") connectHandler = handler;
    },
    async connect(options: { onlyIfTrusted: boolean }) {
      assert.equal(options.onlyIfTrusted, true);
      connectHandler?.(publicKey);
      return { publicKey };
    },
  };
  Object.assign(globalThis, {
    window: { phantom: { solana: provider }, addEventListener() {} },
  });
  try {
    const unsubscribe = wallet.subscribe(() => {});
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(wallet.address, "wallet-address");
    unsubscribe();
  } finally {
    delete (globalThis as { window?: unknown }).window;
  }
});

test("signMessage encodes utf8 bytes and accepts a Uint8Array or base58 signature", { concurrency: false }, async () => {
  const key = nacl.sign.keyPair();
  const message = "Grand Theft Liquidity\nStory complete";
  const expected = nacl.sign.detached(new TextEncoder().encode(message), key.secretKey);
  const calls: unknown[] = [];
  const provider = {
    isPhantom: true,
    isConnected: true,
    publicKey: { toString: () => "wallet-address" },
    on() {},
    async connect() {
      return { publicKey: { toString: () => "wallet-address" } };
    },
    async signMessage(encoded: Uint8Array, display?: string) {
      calls.push({ encoded: Array.from(encoded), display });
      return { signature: expected };
    },
  };
  Object.assign(globalThis, {
    window: { phantom: { solana: provider }, addEventListener() {}, removeEventListener() {}, setTimeout, clearTimeout },
  });
  try {
    const unsubscribe = wallet.subscribe(() => {});
    await new Promise((resolve) => setImmediate(resolve));
    const signed = await wallet.signMessage(message);
    assert.deepEqual(signed, expected);
    assert.equal((calls[0] as { display: string }).display, "utf8");
    provider.signMessage = async () => ({ signature: encodeBase58(expected) as unknown as Uint8Array });
    const fromBase58 = await wallet.signMessage(message);
    assert.deepEqual(fromBase58, expected);
    unsubscribe();
  } finally {
    delete (globalThis as { window?: unknown }).window;
  }
});

test("unlock errors stay visible and are not treated as a user cancellation", () => {
  const failed = new TypeError("Failed to fetch");
  assert.equal(isUserRejection(failed), false);
  assert.match(describeRangeError(failed).message, /Couldn't reach the range API/);
  assert.equal(
    isUserRejection(new Error("Permission was denied for this request to access the unknown address space")),
    false,
  );
  assert.equal(isUserRejection({ code: 4001, message: "User rejected the request" }), true);
});

test("HTTP range errors are shown, not remapped as CORS", () => {
  assert.equal(
    describeRangeError(new Error("Finish the story once, then sign the unlock, before entering the gallery")).message,
    "Finish the story once, then sign the unlock, before entering the gallery",
  );
  assert.match(describeRangeError(new TypeError("Failed to fetch")).message, /Couldn't reach the range API/);
});

test("range network errors name the endpoint that failed", () => {
  const failed = new TypeError("Failed to fetch");
  assert.match(
    describeRangeError(failed, "/api/nonce", "https://example.test/api/nonce").message,
    /Couldn't reach the range API at \/api\/nonce/,
  );
});
