import {
  isSolanaAddress,
  MAX_TIMESTAMP_SKEW_MS,
} from "./leaderboard-protocol.ts";

export const ENTRY_SOL = 0.05;
export const LAMPORTS_PER_SOL = 1_000_000_000;
export const ENTRY_LAMPORTS = 50_000_000;
export const HOUSE_CUT_BPS = 500;
export const PLAYERS_PER_POT = 3;
export const TARGET_COUNT = 6;
export const SHOT_COUNT = 5;
export const CLEAN_HITS_TO_END = 4;
export const MISS_SCORE = 25;
export const DECOY_SCORE = 40;
export const BONUS_SCORE = 0;
export const RING_SCORES = [5, 10, 15, 20] as const;
/** Hit radii as a fraction of the target radius, from bullseye out. */
export const RING_RADII = [0.12, 0.32, 0.58, 1] as const;
export const TARGET_RADIUS = 0.48;
export const BONUS_RADIUS = 0.3;
export const MIN_SHOT_GAP_SEC = 0.4;
export const MAX_ROUND_SEC = 90;
export const ROUND_SUBMIT_SLACK_SEC = 15;
export const INTENT_TTL_MS = 15 * 60 * 1000;
export const MAX_YAW = 1.2;
export const MAX_PITCH = 0.8;
export const SYSTEM_PROGRAM_ID = "11111111111111111111111111111111";
export const MEMO_PROGRAM_ID = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
export const LEGAL_LINE = "Skill game. 18+. Check your local laws.";

export function memoForIntent(intentId: string): string {
  return `GTL-GALLERY:${intentId}`;
}

export function isIntentId(value: string): boolean {
  return /^[0-9a-f]{32}$/.test(value);
}

export function isRoundToken(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}

export function isHex(value: string, length: number): boolean {
  return new RegExp(`^[0-9a-f]{${length}}$`).test(value);
}

export function lamportsToSol(lamports: number): string {
  return (lamports / LAMPORTS_PER_SOL).toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

export function buildStoryCompleteMessage(input: {
  wallet: string;
  timestamp: number;
  nonce: string;
}): string {
  return [
    "Grand Theft Liquidity",
    "Story complete",
    `Wallet: ${input.wallet}`,
    `Timestamp: ${input.timestamp}`,
    `Nonce: ${input.nonce}`,
  ].join("\n");
}

export function buildFreeEntryMessage(input: {
  wallet: string;
  timestamp: number;
  nonce: string;
}): string {
  return [
    "Grand Theft Liquidity",
    "Gallery free entry",
    `Wallet: ${input.wallet}`,
    `Timestamp: ${input.timestamp}`,
    `Nonce: ${input.nonce}`,
  ].join("\n");
}

export function forfeitPreimage(input: {
  roundId: string;
  wallet: string;
  seed: string;
  forfeitIndex: number;
  salt: string;
}): string {
  return [
    "gtl-gallery-forfeit:v1",
    input.roundId,
    input.wallet,
    input.seed,
    String(input.forfeitIndex),
    input.salt,
  ].join(":");
}

export function scoreFromRadius(radiusFraction: number): {
  points: number;
  ring: number;
} {
  if (!Number.isFinite(radiusFraction) || radiusFraction > 1)
    return { points: MISS_SCORE, ring: -1 };
  for (let i = 0; i < RING_RADII.length; i++) {
    if (radiusFraction <= RING_RADII[i]!)
      return { points: RING_SCORES[i]!, ring: i };
  }
  return { points: MISS_SCORE, ring: -1 };
}

export interface ShotInput {
  t: number;
  yaw: number;
  pitch: number;
}

export type ShotKind = "target" | "decoy" | "bonus" | "cover" | "miss";

export type ShotOutcome = {
  t: number;
  targetIndex: number | null;
  actorId: string | null;
  kind: ShotKind;
  radiusFraction: number | null;
  points: number;
  ring: number;
  forfeit: boolean;
  counted: boolean;
};

export type RoundEvaluation =
  | {
      status: "scored";
      score: number;
      shots: ShotOutcome[];
      cleanHits: number;
      skippedFifth: boolean;
    }
  | {
      status: "forfeit";
      score: null;
      shots: ShotOutcome[];
      cleanHits: number;
      skippedFifth: boolean;
    };

export type SettlementPayout = {
  wallet: string;
  lamports: number;
};

export type PotSettlement =
  | {
      kind: "winner";
      grossLamports: number;
      houseCutLamports: number;
      prizeLamports: number;
      remainderLamports: number;
      winningScore: number;
      winners: string[];
      payouts: SettlementPayout[];
      rolloverLamports: 0;
    }
  | {
      kind: "rollover";
      grossLamports: number;
      houseCutLamports: 0;
      prizeLamports: 0;
      remainderLamports: 0;
      winningScore: null;
      winners: [];
      payouts: [];
      rolloverLamports: number;
    };

export type PotEntryResult =
  | { wallet: string; status: "scored"; score: number }
  | { wallet: string; status: "forfeit"; score: null };

export function houseCutLamports(gross: number): number {
  return Math.floor((gross * HOUSE_CUT_BPS) / 10_000);
}

export function settlePot(entries: PotEntryResult[], rolloverLamports = 0): PotSettlement {
  if (entries.length !== PLAYERS_PER_POT)
    throw new Error(`A pot settles after exactly ${PLAYERS_PER_POT} completed rounds.`);
  const gross = entries.length * ENTRY_LAMPORTS + rolloverLamports;
  const scored = entries.filter(
    (entry): entry is { wallet: string; status: "scored"; score: number } =>
      entry.status === "scored",
  );
  if (scored.length === 0) {
    return {
      kind: "rollover",
      grossLamports: gross,
      houseCutLamports: 0,
      prizeLamports: 0,
      remainderLamports: 0,
      winningScore: null,
      winners: [],
      payouts: [],
      rolloverLamports: gross,
    };
  }
  const winningScore = Math.min(...scored.map((entry) => entry.score));
  const winners = scored
    .filter((entry) => entry.score === winningScore)
    .map((entry) => entry.wallet);
  const cut = houseCutLamports(gross);
  const prize = gross - cut;
  const share = Math.floor(prize / winners.length);
  const remainder = prize - share * winners.length;
  return {
    kind: "winner",
    grossLamports: gross,
    houseCutLamports: cut + remainder,
    prizeLamports: share * winners.length,
    remainderLamports: remainder,
    winningScore,
    winners,
    payouts: winners.map((wallet) => ({ wallet, lamports: share })),
    rolloverLamports: 0,
  };
}

export type StoryValidation =
  | { ok: true; value: { wallet: string; timestamp: number; nonce: string } }
  | { ok: false; error: string };

export function validateStoryFields(input: unknown, now = Date.now()): StoryValidation {
  if (!input || typeof input !== "object")
    return { ok: false, error: "Invalid payload" };
  const body = input as Record<string, unknown>;
  const { wallet, timestamp, nonce } = body;
  if (typeof wallet !== "string" || !isSolanaAddress(wallet))
    return { ok: false, error: "Invalid wallet" };
  if (!Number.isInteger(timestamp) || Math.abs(now - (timestamp as number)) > MAX_TIMESTAMP_SKEW_MS)
    return { ok: false, error: "Invalid timestamp" };
  if (typeof nonce !== "string" || !/^[0-9a-f]{32}$/.test(nonce))
    return { ok: false, error: "Invalid nonce" };
  return { ok: true, value: { wallet, timestamp: timestamp as number, nonce } };
}

export function validateShotFields(input: unknown): ShotInput[] | { error: string } {
  if (!Array.isArray(input) || input.length > SHOT_COUNT)
    return { error: "Invalid shots" };
  const shots: ShotInput[] = [];
  for (const item of input) {
    if (!item || typeof item !== "object") return { error: "Invalid shots" };
    const { t, yaw, pitch } = item as Record<string, unknown>;
    if (typeof t !== "number" || !Number.isFinite(t) || t < 0 || t > MAX_ROUND_SEC)
      return { error: "Invalid shot timing" };
    if (typeof yaw !== "number" || !Number.isFinite(yaw) || Math.abs(yaw) > MAX_YAW)
      return { error: "Invalid aim" };
    if (typeof pitch !== "number" || !Number.isFinite(pitch) || Math.abs(pitch) > MAX_PITCH)
      return { error: "Invalid aim" };
    shots.push({ t, yaw, pitch });
  }
  return shots;
}
