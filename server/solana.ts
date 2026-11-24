import { createHash, randomBytes } from "node:crypto";
import nacl from "tweetnacl";
import bs58 from "bs58";
import {
  ENTRY_LAMPORTS,
  MEMO_PROGRAM_ID,
  SYSTEM_PROGRAM_ID,
  memoForIntent,
} from "../src/gallery-protocol.ts";
import {
  buildTransferMessage,
  concatBytes,
  decodeAccount,
  encodeCompactU16,
  serializeUnsignedTransaction,
} from "../src/solana-transfer.ts";

export { buildTransferMessage, decodeAccount, encodeCompactU16, serializeUnsignedTransaction };

export type RpcCommitment = "confirmed" | "finalized";

export interface RpcRequest {
  method: string;
  params?: unknown[];
}

export type SolanaRpc = (request: RpcRequest) => Promise<unknown>;

export type ParsedInstruction = {
  program?: string;
  programId?: string;
  parsed?: {
    type?: string;
    info?: {
      source?: string;
      destination?: string;
      lamports?: number;
    };
  };
  json?: unknown;
  data?: string;
  accounts?: string[];
};

export type RpcTransaction = {
  slot?: number;
  meta?: { err: unknown } | null;
  transaction?: {
    message?: {
      accountKeys?: Array<string | { pubkey: string; signer?: boolean }>;
      instructions?: ParsedInstruction[];
    };
    signatures?: string[];
  };
};

export type TransferCheck = {
  signature: string;
  wallet: string;
  houseWallet: string;
  lamports: number;
  intentId: string;
};

export type TransferError = { ok: false; error: string };
export type TransferOk = { ok: true; signature: string; slot: number | null };

export function jsonRpc(url: string, headers: Record<string, string> = {}): SolanaRpc {
  return async (request) => {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, ...request }),
    });
    if (!response.ok) throw new Error("Solana RPC request failed");
    const body = (await response.json()) as { result?: unknown; error?: { message?: string } };
    if (body.error) throw new Error(body.error.message || "Solana RPC error");
    return body.result;
  };
}

export function rpcFromEnv(url = process.env.SOLANA_RPC_URL): SolanaRpc | null {
  if (!url) return null;
  return jsonRpc(url);
}

export function parseHouseSecret(raw: string | undefined): Uint8Array | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  try {
    if (trimmed.startsWith("[")) {
      const nums = JSON.parse(trimmed) as unknown;
      if (
        Array.isArray(nums) &&
        (nums.length === 32 || nums.length === 64) &&
        nums.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)
      ) {
        const bytes = Uint8Array.from(nums);
        return bytes.length === 32 ? nacl.sign.keyPair.fromSeed(bytes).secretKey : bytes;
      }
      return null;
    }
    if (/^[0-9a-fA-F]+$/.test(trimmed) && (trimmed.length === 64 || trimmed.length === 128)) {
      const bytes = Buffer.from(trimmed, "hex");
      return bytes.length === 32
        ? nacl.sign.keyPair.fromSeed(bytes).secretKey
        : new Uint8Array(bytes);
    }
    const decoded = bs58.decode(trimmed);
    if (decoded.length === 32) return nacl.sign.keyPair.fromSeed(decoded).secretKey;
    if (decoded.length === 64) return decoded;
    return null;
  } catch {
    return null;
  }
}

export function publicKeyFromSecret(secret: Uint8Array): string {
  const pair =
    secret.length === 32 ? nacl.sign.keyPair.fromSeed(secret) : nacl.sign.keyPair.fromSecretKey(secret);
  return bs58.encode(pair.publicKey);
}


export function signTransaction(message: Uint8Array, secret: Uint8Array): {
  serialized: Uint8Array;
  signature: string;
} {
  const pair =
    secret.length === 32 ? nacl.sign.keyPair.fromSeed(secret) : nacl.sign.keyPair.fromSecretKey(secret);
  const signature = nacl.sign.detached(message, pair.secretKey);
  return {
    serialized: concatBytes([encodeCompactU16(1), signature, message]),
    signature: bs58.encode(signature),
  };
}

function accountKey(entry: string | { pubkey: string }): string {
  return typeof entry === "string" ? entry : entry.pubkey;
}

function instructionProgram(ix: ParsedInstruction, keys: string[]): string | undefined {
  if (ix.programId) return ix.programId;
  return undefined;
}

function readMemo(ix: ParsedInstruction): string | null {
  if (ix.program === "spl-memo" && typeof ix.parsed === "string") return ix.parsed;
  if (typeof ix.data === "string") {
    try {
      if (/^[0-9a-fA-F]+$/.test(ix.data) && ix.data.length % 2 === 0)
        return Buffer.from(ix.data, "hex").toString("utf8");
      return Buffer.from(bs58.decode(ix.data)).toString("utf8");
    } catch {
      return null;
    }
  }
  if (typeof ix.parsed === "string") return ix.parsed;
  return null;
}

export function inspectTransfer(tx: RpcTransaction | null | undefined, check: TransferCheck): TransferOk | TransferError {
  if (!tx || !tx.transaction?.message)
    return { ok: false, error: "Payment transaction not found" };
  if (tx.meta?.err) return { ok: false, error: "Payment transaction failed" };
  const signatures = tx.transaction.signatures ?? [];
  if (!signatures.includes(check.signature))
    return { ok: false, error: "Payment signature mismatch" };
  const keys = (tx.transaction.message.accountKeys ?? []).map(accountKey);
  if (!keys.includes(check.wallet) || !keys.includes(check.houseWallet))
    return { ok: false, error: "Payment is missing the expected accounts" };
  const instructions = tx.transaction.message.instructions ?? [];
  const memo = memoForIntent(check.intentId);
  let transferOk = false;
  let memoOk = false;
  for (const ix of instructions) {
    const program = instructionProgram(ix, keys);
    const parsed = ix.parsed;
    if (
      (ix.program === "system" || program === SYSTEM_PROGRAM_ID) &&
      parsed &&
      typeof parsed === "object" &&
      parsed.type === "transfer"
    ) {
      const info = parsed.info ?? {};
      if (
        info.source === check.wallet &&
        info.destination === check.houseWallet &&
        info.lamports === check.lamports
      )
        transferOk = true;
      else if (info.destination === check.houseWallet && info.source === check.wallet)
        return { ok: false, error: "Payment amount does not match the entry fee" };
    }
    const text = readMemo(ix);
    if (text === memo) memoOk = true;
    if (
      program === MEMO_PROGRAM_ID ||
      ix.program === "spl-memo" ||
      (typeof program === "undefined" && ix.data)
    ) {
      if (text === memo) memoOk = true;
    }
  }
  if (!transferOk) return { ok: false, error: "No matching 0.05 SOL transfer to the house wallet" };
  if (!memoOk) return { ok: false, error: "Payment is missing the entry memo" };
  return { ok: true, signature: check.signature, slot: tx.slot ?? null };
}

export async function verifyPayment(
  rpc: SolanaRpc,
  check: TransferCheck,
  commitment: RpcCommitment = "confirmed",
): Promise<TransferOk | TransferError> {
  let lastError = "Could not fetch the payment from Solana";
  for (let attempt = 0; attempt < 8; attempt++) {
    let result: unknown;
    try {
      result = await rpc({
        method: "getTransaction",
        params: [
          check.signature,
          { encoding: "jsonParsed", commitment, maxSupportedTransactionVersion: 0 },
        ],
      });
    } catch {
      lastError = "Could not fetch the payment from Solana";
      await new Promise((resolve) => setTimeout(resolve, 400));
      continue;
    }
    if (!result) {
      lastError = "Payment transaction not found";
      await new Promise((resolve) => setTimeout(resolve, 400));
      continue;
    }
    return inspectTransfer(result as RpcTransaction, check);
  }
  return { ok: false, error: lastError };
}

export async function latestBlockhash(
  rpc: SolanaRpc,
  commitment: RpcCommitment = "confirmed",
): Promise<{ blockhash: string; lastValidBlockHeight: number }> {
  const result = (await rpc({
    method: "getLatestBlockhash",
    params: [{ commitment }],
  })) as { value?: { blockhash?: string; lastValidBlockHeight?: number } };
  const blockhash = result?.value?.blockhash;
  const height = result?.value?.lastValidBlockHeight;
  if (!blockhash || typeof height !== "number") throw new Error("No blockhash from Solana");
  return { blockhash, lastValidBlockHeight: height };
}

export async function sendSignedTransaction(
  rpc: SolanaRpc,
  serialized: Uint8Array,
): Promise<string> {
  const signature = (await rpc({
    method: "sendTransaction",
    params: [
      Buffer.from(serialized).toString("base64"),
      { encoding: "base64", skipPreflight: false, preflightCommitment: "confirmed" },
    ],
  })) as string;
  if (typeof signature !== "string" || !signature)
    throw new Error("Solana did not accept the payout transaction");
  return signature;
}

export async function sendPayout(input: {
  rpc: SolanaRpc;
  secret: Uint8Array;
  to: string;
  lamports: number;
  memo: string;
}): Promise<{ signature: string; serialized: Uint8Array }> {
  const from = publicKeyFromSecret(input.secret);
  const { blockhash } = await latestBlockhash(input.rpc);
  const message = buildTransferMessage({
    from,
    to: input.to,
    lamports: input.lamports,
    blockhash,
    memo: input.memo,
  });
  const signed = signTransaction(message, input.secret);
  const signature = await sendSignedTransaction(input.rpc, signed.serialized);
  return { signature, serialized: signed.serialized };
}

export function paymentIdempotencyKey(potId: string, wallet: string): string {
  return createHash("sha256").update(`payout:${potId}:${wallet}`).digest("hex");
}

export function newPrivateBytes(size = 16): string {
  return randomBytes(size).toString("hex");
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function payoutMemo(potId: string, wallet: string): string {
  return `GTL-PAYOUT:${potId}:${wallet}`;
}

export const DEFAULT_ENTRY_LAMPORTS = ENTRY_LAMPORTS;
