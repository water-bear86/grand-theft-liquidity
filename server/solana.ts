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
  blockTime?: number | null;
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
export type TransferOk = {
  ok: true;
  signature: string;
  slot: number | null;
  /** Unix ms of the block that included the payment, when the RPC reports it. */
  paidAt: number | null;
};

/** Minimum balance that keeps a 0-data system account rent exempt. */
export const RENT_EXEMPT_RESERVE_LAMPORTS = 890_880;
/** One-signature base fee. Payouts are a transfer + memo with a single signer. */
export const PAYOUT_FEE_LAMPORTS = 5_000;
/** Payout attempts that land are confirmed at this commitment before marking "sent". */
export const PAYOUT_COMMITMENT: RpcCommitment = "confirmed";

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
  return {
    ok: true,
    signature: check.signature,
    slot: tx.slot ?? null,
    paidAt: typeof tx.blockTime === "number" ? tx.blockTime * 1000 : null,
  };
}

export const PAYMENT_NOT_FOUND = "Payment transaction not found";
export const PAYMENT_RPC_ERROR = "Could not fetch the payment from Solana";

/** Errors the client should retry with the same intent + signature. */
export function isRetryablePaymentError(error: string): boolean {
  return error === PAYMENT_NOT_FOUND || error === PAYMENT_RPC_ERROR;
}

export async function verifyPayment(
  rpc: SolanaRpc,
  check: TransferCheck,
  commitment: RpcCommitment = "confirmed",
  options: { attempts?: number; delayMs?: number } = {},
): Promise<TransferOk | TransferError> {
  const attempts = options.attempts ?? 10;
  const delayMs = options.delayMs ?? 750;
  let lastError = PAYMENT_RPC_ERROR;
  for (let attempt = 0; attempt < attempts; attempt++) {
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
      lastError = PAYMENT_RPC_ERROR;
      if (attempt < attempts - 1) await new Promise((resolve) => setTimeout(resolve, delayMs));
      continue;
    }
    if (!result) {
      lastError = PAYMENT_NOT_FOUND;
      if (attempt < attempts - 1) await new Promise((resolve) => setTimeout(resolve, delayMs));
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

export async function getBalance(
  rpc: SolanaRpc,
  address: string,
  commitment: RpcCommitment = "confirmed",
): Promise<number> {
  const result = (await rpc({ method: "getBalance", params: [address, { commitment }] })) as
    | { value?: number }
    | number;
  const value = typeof result === "number" ? result : result?.value;
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("No balance from Solana");
  return value;
}

export async function getBlockHeight(
  rpc: SolanaRpc,
  commitment: RpcCommitment = "confirmed",
): Promise<number> {
  const result = await rpc({ method: "getBlockHeight", params: [{ commitment }] });
  if (typeof result !== "number") throw new Error("No block height from Solana");
  return result;
}

export type SignatureState = "confirmed" | "failed" | "unknown";

export async function getSignatureState(rpc: SolanaRpc, signature: string): Promise<SignatureState> {
  const result = (await rpc({
    method: "getSignatureStatuses",
    params: [[signature], { searchTransactionHistory: true }],
  })) as { value?: Array<{ err: unknown; confirmationStatus?: string | null } | null> };
  const status = result?.value?.[0];
  if (!status) return "unknown";
  if (status.err) return "failed";
  if (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized")
    return "confirmed";
  return "unknown";
}

/** Largest payout the house can make right now without dropping below the rent reserve. */
export function spendableLamports(balance: number, inFlightLamports = 0): number {
  return Math.max(0, balance - inFlightLamports - PAYOUT_FEE_LAMPORTS - RENT_EXEMPT_RESERVE_LAMPORTS);
}

/**
 * Builds and signs a payout without broadcasting it. The caller records the
 * signature and lastValidBlockHeight first, then broadcasts, so a retry can ask
 * the chain whether this exact transaction landed instead of paying twice.
 */
export async function signPayout(input: {
  rpc: SolanaRpc;
  secret: Uint8Array;
  to: string;
  lamports: number;
  memo: string;
}): Promise<{ signature: string; serialized: Uint8Array; lastValidBlockHeight: number }> {
  const from = publicKeyFromSecret(input.secret);
  const { blockhash, lastValidBlockHeight } = await latestBlockhash(input.rpc);
  const message = buildTransferMessage({
    from,
    to: input.to,
    lamports: input.lamports,
    blockhash,
    memo: input.memo,
  });
  const signed = signTransaction(message, input.secret);
  return { signature: signed.signature, serialized: signed.serialized, lastValidBlockHeight };
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
