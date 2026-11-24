export const MAX_SCORE = 1_000_000;
export const MAX_TIMESTAMP_SKEW_MS = 5 * 60 * 1000;
export const NONCE_TTL_MS = 5 * 60 * 1000;
export const LEADERBOARD_SIZE = 10;
export const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export interface ScoreSubmission {
  wallet: string;
  score: number;
  timestamp: number;
  nonce: string;
}

export interface LeaderboardEntry {
  rank: number;
  wallet: string;
  score: number;
  submittedAt: number;
}

export function isBase58(
  value: string,
  minLength: number,
  maxLength: number,
): boolean {
  if (value.length < minLength || value.length > maxLength) return false;
  for (const char of value) {
    if (!BASE58_ALPHABET.includes(char)) return false;
  }
  return true;
}

export function isSolanaAddress(wallet: string): boolean {
  return isBase58(wallet, 32, 44);
}

export function isNonce(nonce: string): boolean {
  return /^[0-9a-f]{32}$/.test(nonce);
}

export function encodeBase58(bytes: Uint8Array): string {
  if (bytes.length === 0) return "";
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  const size = Math.ceil(((bytes.length - zeros) * 138) / 100) + 1;
  const encoded = new Uint8Array(size);
  let length = 0;
  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i]!;
    let j = 0;
    for (let k = size - 1; k >= 0 && (carry !== 0 || j < length); k--, j++) {
      carry += 256 * encoded[k]!;
      encoded[k] = carry % 58;
      carry = (carry / 58) | 0;
    }
    length = j;
  }
  let start = size - length;
  while (start < size && encoded[start] === 0) start++;
  let result = "1".repeat(zeros);
  for (let i = start; i < size; i++) result += BASE58_ALPHABET[encoded[i]!]!;
  return result;
}

export function decodeBase58(value: string): Uint8Array {
  let zeros = 0;
  while (zeros < value.length && value[zeros] === "1") zeros++;
  const size = Math.ceil((value.length * 733) / 1000) + 1;
  const decoded = new Uint8Array(size);
  let length = 0;
  for (let i = zeros; i < value.length; i++) {
    const index = BASE58_ALPHABET.indexOf(value[i]!);
    if (index === -1) throw new Error("Invalid base58");
    let carry = index;
    let j = 0;
    for (let k = size - 1; k >= 0 && (carry !== 0 || j < length); k--, j++) {
      carry += 58 * decoded[k]!;
      decoded[k] = carry % 256;
      carry = (carry / 256) | 0;
    }
    length = j;
  }
  let start = size - length;
  while (start < size && decoded[start] === 0) start++;
  const out = new Uint8Array(zeros + (size - start));
  out.set(decoded.subarray(start), zeros);
  return out;
}

function decodeBase64(value: string): Uint8Array | null {
  try {
    const atobFn = (globalThis as { atob?: (data: string) => string }).atob;
    const BufferCtor = (
      globalThis as {
        Buffer?: { from(data: string, enc: string): Uint8Array };
      }
    ).Buffer;
    if (atobFn) {
      const binary = atobFn(value);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return bytes;
    }
    if (BufferCtor) return new Uint8Array(BufferCtor.from(value, "base64"));
    return null;
  } catch {
    return null;
  }
}

export function signatureBytes(signature: unknown): Uint8Array {
  if (signature instanceof Uint8Array) {
    if (signature.length !== 64)
      throw new Error("Phantom returned a signature of the wrong length.");
    return signature;
  }
  if (ArrayBuffer.isView(signature)) {
    const view = signature as ArrayBufferView;
    return signatureBytes(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
  }
  if (Array.isArray(signature))
    return signatureBytes(Uint8Array.from(signature as number[]));
  if (typeof signature === "string") {
    const trimmed = signature.trim();
    try {
      const decoded = decodeBase58(trimmed);
      if (decoded.length === 64) return decoded;
    } catch {
      // Try base64 next.
    }
    const base64 = decodeBase64(trimmed);
    if (base64 && base64.length === 64) return base64;
  }
  throw new Error("Phantom returned an unexpected signature.");
}

export function shortenAddress(wallet: string): string {
  if (wallet.length < 8) return wallet;
  return `${wallet.slice(0, 4)}…${wallet.slice(-4)}`;
}

export function buildScoreMessage(input: ScoreSubmission): string {
  return [
    "Grand Theft Liquidity",
    `Wallet: ${input.wallet}`,
    `Score: ${input.score}`,
    `Timestamp: ${input.timestamp}`,
    `Nonce: ${input.nonce}`,
  ].join("\n");
}

export type ScoreValidation =
  | { ok: true; value: ScoreSubmission }
  | { ok: false; error: string };

export function validateScoreFields(
  input: unknown,
  now = Date.now(),
): ScoreValidation {
  if (!input || typeof input !== "object")
    return { ok: false, error: "Invalid payload" };
  const body = input as Record<string, unknown>;
  const { wallet, score, timestamp, nonce } = body;
  if (typeof wallet !== "string" || !isSolanaAddress(wallet))
    return { ok: false, error: "Invalid wallet" };
  if (!Number.isInteger(score) || (score as number) < 0 || (score as number) > MAX_SCORE)
    return { ok: false, error: "Invalid score" };
  if (
    !Number.isInteger(timestamp) ||
    Math.abs(now - (timestamp as number)) > MAX_TIMESTAMP_SKEW_MS
  )
    return { ok: false, error: "Invalid timestamp" };
  if (typeof nonce !== "string" || !isNonce(nonce))
    return { ok: false, error: "Invalid nonce" };
  return {
    ok: true,
    value: {
      wallet,
      score: score as number,
      timestamp: timestamp as number,
      nonce,
    },
  };
}
