import test from "node:test";
import assert from "node:assert/strict";
import { wallet } from "./wallet.ts";

test("restores the public key from a trusted Phantom connection", async () => {
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
