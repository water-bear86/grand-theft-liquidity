import test from "node:test";
import assert from "node:assert/strict";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { ENTRY_LAMPORTS, MEMO_PROGRAM_ID, memoForIntent } from "../src/gallery-protocol.ts";
import {
  buildTransferMessage,
  inspectTransfer,
  parseHouseSecret,
  publicKeyFromSecret,
  serializeUnsignedTransaction,
  signTransaction,
  verifyPayment,
  type RpcTransaction,
  type SolanaRpc,
} from "./solana.ts";

function keypair() {
  const pair = nacl.sign.keyPair();
  return { secret: pair.secretKey, wallet: bs58.encode(pair.publicKey) };
}

function transferTx(input: {
  signature: string;
  source: string;
  destination: string;
  lamports: number;
  memo?: string;
  err?: unknown;
}): RpcTransaction {
  const instructions: NonNullable<NonNullable<RpcTransaction["transaction"]>["message"]>["instructions"] = [
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
  ];
  if (input.memo) {
    instructions.push({
      program: "spl-memo",
      programId: MEMO_PROGRAM_ID,
      parsed: input.memo as unknown as { type?: string },
      data: Buffer.from(input.memo, "utf8").toString("hex"),
    });
  }
  return {
    slot: 12,
    meta: { err: input.err ?? null },
    transaction: {
      signatures: [input.signature],
      message: {
        accountKeys: [input.source, input.destination, "11111111111111111111111111111111"],
        instructions,
      },
    },
  };
}

const payer = keypair();
const house = keypair();
const intentId = "ab".repeat(16);
const signature = "5" + "1".repeat(87);
const check = {
  signature,
  wallet: payer.wallet,
  houseWallet: house.wallet,
  lamports: ENTRY_LAMPORTS,
  intentId,
};

test("inspectTransfer accepts a matching transfer and memo", () => {
  const tx = transferTx({
    signature,
    source: payer.wallet,
    destination: house.wallet,
    lamports: ENTRY_LAMPORTS,
    memo: memoForIntent(intentId),
  });
  assert.deepEqual(inspectTransfer(tx, check), { ok: true, signature, slot: 12 });
});

test("inspectTransfer rejects the wrong amount, destination, sender, memo, or a failed tx", () => {
  const base = {
    signature,
    source: payer.wallet,
    destination: house.wallet,
    lamports: ENTRY_LAMPORTS,
    memo: memoForIntent(intentId),
  };
  assert.equal(inspectTransfer(transferTx({ ...base, lamports: ENTRY_LAMPORTS * 2 }), check).ok, false);
  assert.equal(
    inspectTransfer(transferTx({ ...base, destination: keypair().wallet }), check).ok,
    false,
  );
  assert.equal(inspectTransfer(transferTx({ ...base, source: keypair().wallet }), check).ok, false);
  assert.equal(inspectTransfer(transferTx({ ...base, memo: "nope" }), check).ok, false);
  assert.equal(inspectTransfer(transferTx({ ...base, memo: undefined }), check).ok, false);
  assert.equal(inspectTransfer(transferTx({ ...base, err: { InstructionError: [0, "Something"] } }), check).ok, false);
  assert.equal(inspectTransfer(null, check).ok, false);
});

test("verifyPayment uses the RPC and blocks a reused signature at the inspect layer", async () => {
  const good = transferTx({
    signature,
    source: payer.wallet,
    destination: house.wallet,
    lamports: ENTRY_LAMPORTS,
    memo: memoForIntent(intentId),
  });
  const rpc: SolanaRpc = async (request) => {
    assert.equal(request.method, "getTransaction");
    assert.equal((request.params as unknown[])[0], signature);
    return good;
  };
  const verified = await verifyPayment(rpc, check);
  assert.equal(verified.ok, true);
});

test("parseHouseSecret accepts JSON, hex, and base58 without throwing the secret", () => {
  const seed = nacl.randomBytes(32);
  const pair = nacl.sign.keyPair.fromSeed(seed);
  const json = JSON.stringify([...pair.secretKey]);
  const parsed = parseHouseSecret(json);
  assert.ok(parsed);
  assert.equal(publicKeyFromSecret(parsed!), bs58.encode(pair.publicKey));
  assert.equal(publicKeyFromSecret(parseHouseSecret(bs58.encode(pair.secretKey))!), bs58.encode(pair.publicKey));
  assert.equal(publicKeyFromSecret(parseHouseSecret(Buffer.from(seed).toString("hex"))!), bs58.encode(pair.publicKey));
  assert.equal(parseHouseSecret("not-a-key"), null);
  assert.equal(parseHouseSecret(undefined), null);
});

test("a signed transfer transaction round-trips through the message builder", () => {
  const blockhash = bs58.encode(nacl.randomBytes(32));
  const message = buildTransferMessage({
    from: payer.wallet,
    to: house.wallet,
    lamports: ENTRY_LAMPORTS,
    blockhash,
    memo: memoForIntent(intentId),
  });
  const unsigned = serializeUnsignedTransaction(message);
  assert.equal(unsigned[0], 1);
  const signed = signTransaction(message, payer.secret);
  assert.equal(signed.signature.length > 30, true);
  const again = signTransaction(message, payer.secret);
  assert.equal(again.signature, signed.signature);
});
