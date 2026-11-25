import {
  ENTRY_SOL,
  LEGAL_LINE,
  buildFreeEntryMessage,
  buildStoryCompleteMessage,
  forfeitPreimage,
  type ShotInput,
} from "./gallery-protocol.ts";
import { encodeBase58 } from "./leaderboard-protocol.ts";
import { leaderboardApiBase } from "./leaderboard-client.ts";
import { isUserRejection } from "./leaderboard-client.ts";
import { wallet } from "./wallet.ts";
import {
  buildTransferMessage,
  serializeUnsignedTransaction,
} from "./solana-transfer.ts";

export { isUserRejection, LEGAL_LINE, ENTRY_SOL };

const REQUEST_MS = 30_000;

export type GalleryStatus = {
  configured: boolean;
  houseWallet: string | null;
  entryLamports: number;
  legal: string;
  dryRun: boolean;
  payoutsEnabled: boolean;
  mode?: "test" | "live";
  liveReady?: boolean;
  storyCompleted: boolean;
  storyUnlockNote: string;
  pot: PublicPot | null;
  activeRound: { potId: string; expiresAt: number; startedAt: number } | null;
};

export type PublicPot = {
  id: string;
  status: "open" | "settled";
  /** "test" pots are dry-run only; older API builds omit this. */
  mode?: "test" | "live";
  paidCount: number;
  completedCount: number;
  playersNeeded: number;
  rolloverLamports: number;
  potLamports: number;
  yours: { status: "playing" | "scored" | "forfeit"; score: number | null } | null;
  entries?: Array<{ wallet: string; status: "scored" | "forfeit"; score: number | null }>;
  settlement?: {
    kind: "winner" | "rollover";
    winningScore: number | null;
    winners: string[];
    houseCutLamports: number;
    rolloverLamports: number;
    payouts: Array<{
      wallet: string;
      lamports: number;
      status: string;
      txSignature: string | null;
    }>;
  } | null;
};

export type IssuedIntent = {
  intentId: string;
  memo: string;
  houseWallet: string;
  lamports: number;
  expiresAt: number;
  blockhash: string | null;
  lastValidBlockHeight: number | null;
};

export type IssuedRound = {
  token: string;
  roundId: string;
  seed: string;
  commitment: string;
  expiresAt: number;
  startedAt: number;
  potId: string;
};

export type SubmitResult = {
  result: {
    status: "scored" | "forfeit";
    score: number | null;
    shots: unknown;
    cleanHits: number;
    skippedFifth: boolean;
  };
  reveal: { forfeitIndex: number; salt: string };
  commitment: string;
  seed: string;
  roundId: string;
  wallet: string;
  pot: PublicPot;
  settlement: PublicPot["settlement"];
  commitmentMatches: boolean;
};

export type RangeHttpError = Error & { status?: number; retryable?: boolean };

export type PendingEntry = {
  wallet: string;
  intentId: string;
  txSignature: string;
  paidAt: number;
};

const PENDING_KEY = "gtl-pending-paid-entry";
/** Matches the server's 24h recovery window. */
const PENDING_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadPendingEntry(walletAddress?: string | null): PendingEntry | null {
  const raw = storage()?.getItem(PENDING_KEY);
  if (!raw) return null;
  try {
    const pending = JSON.parse(raw) as PendingEntry;
    if (Date.now() - pending.paidAt > PENDING_MAX_AGE_MS) {
      clearPendingEntry();
      return null;
    }
    if (walletAddress && pending.wallet !== walletAddress) return null;
    return pending;
  } catch {
    clearPendingEntry();
    return null;
  }
}

function savePendingEntry(pending: PendingEntry) {
  try {
    storage()?.setItem(PENDING_KEY, JSON.stringify(pending));
  } catch {
    // Private mode can block storage; the in-memory retry loop still runs.
  }
}

export function clearPendingEntry() {
  try {
    storage()?.removeItem(PENDING_KEY);
  } catch {
    // ignore
  }
}

function apiBase(): string | null {
  return leaderboardApiBase();
}

export function galleryConfigured(): boolean {
  return apiBase() !== null;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const base = apiBase();
  if (base === null) throw new Error("The shooting gallery is not live on this build.");
  const url = `${base}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_MS);
  try {
    const response = await fetch(url, {
      ...init,
      method: init?.method ?? "GET",
      mode: "cors",
      credentials: "omit",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
    });
    const body = (await response.json().catch(() => ({}))) as { error?: string; retryable?: boolean } & T;
    if (!response.ok) {
      const detail = body.error?.trim();
      const error = new Error(detail || `The range returned HTTP ${response.status}.`) as RangeHttpError;
      error.status = response.status;
      error.retryable = body.retryable === true || response.status >= 500 || response.status === 429;
      throw error;
    }
    return body;
  } catch (error) {
    if (error instanceof Error && typeof (error as RangeHttpError).status === "number") throw error;
    const described = describeRangeError(error, path, url) as RangeHttpError;
    // Network failures and timeouts (cold start, flaky mobile data) are worth retrying.
    described.retryable = true;
    throw described;
  } finally {
    clearTimeout(timer);
  }
}

export function describeRangeError(error: unknown, path = "", url = ""): Error {
  const endpoint = path.split("?")[0] || url;
  if (typeof console !== "undefined" && console.warn) {
    if (url) console.warn(`Range request failed at ${endpoint}: ${url}`, error);
    else console.warn(endpoint ? `Range request failed at ${endpoint}` : "Range request failed", error);
  }
  if (error instanceof Error && error.name === "AbortError")
    return new Error(
      endpoint
        ? `The range took too long to answer (${endpoint}). Try again.`
        : "The range took too long to answer. Try again.",
    );
  const message = error instanceof Error ? error.message.trim() : "";
  const isNetwork =
    error instanceof TypeError ||
    /failed to fetch|networkerror|load failed/i.test(message);
  if (isNetwork && !/HTTP |range returned/i.test(message))
    return new Error(
      endpoint
        ? `Couldn't reach the range API at ${endpoint} (network or CORS). If a browser extension blocked the request, try again after a reload.`
        : "Couldn't reach the range API from this page (network or CORS). If a browser extension blocked the request, try again after a reload.",
    );
  if (error instanceof Error && message) return error;
  return new Error(endpoint ? `The range request failed (${endpoint}).` : "The range request failed.");
}

export async function fetchGalleryStatus(wallet?: string | null): Promise<GalleryStatus> {
  const query = wallet ? `?wallet=${encodeURIComponent(wallet)}` : "";
  return request<GalleryStatus>(`/api/gallery/status${query}`);
}

export async function reportStoryComplete(
  onStatus?: (status: string) => void,
): Promise<void> {
  onStatus?.("Connecting Phantom…");
  const address = wallet.address ?? (await wallet.connect());
  if (!address) throw new Error("Connect Phantom to sign the story unlock.");
  onStatus?.("Requesting a signing nonce from the range…");
  const issued = await request<{ nonce: string }>("/api/nonce", {
    method: "POST",
    body: JSON.stringify({ wallet: address }),
  });
  if (!issued?.nonce) throw new Error("The range did not return a signing nonce.");
  const payload = {
    wallet: address,
    timestamp: Date.now(),
    nonce: issued.nonce,
  };
  onStatus?.("Approve the story unlock in Phantom…");
  const signature = await wallet.signMessage(buildStoryCompleteMessage(payload));
  onStatus?.("Sending the signed unlock to the range…");
  await request("/api/gallery/story", {
    method: "POST",
    body: JSON.stringify({ ...payload, signature: encodeBase58(signature) }),
  });
}

export async function requestIntent(): Promise<IssuedIntent> {
  const address = wallet.address ?? (await wallet.connect());
  const body = await request<IssuedIntent>("/api/gallery/intent", {
    method: "POST",
    body: JSON.stringify({ wallet: address }),
  });
  return body;
}

export async function enterFree(
  onStatus?: (status: string) => void,
): Promise<IssuedRound> {
  onStatus?.("Connecting Phantom…");
  const address = wallet.address ?? (await wallet.connect());
  if (!address) throw new Error("Connect Phantom to enter the range.");
  onStatus?.("Requesting a signing nonce from the range…");
  const issued = await request<{ nonce: string }>("/api/nonce", {
    method: "POST",
    body: JSON.stringify({ wallet: address }),
  });
  if (!issued?.nonce) throw new Error("The range did not return a signing nonce.");
  const payload = {
    wallet: address,
    timestamp: Date.now(),
    nonce: issued.nonce,
  };
  onStatus?.("Approve the free test-entry signature in Phantom. No SOL will be sent.");
  const signature = await wallet.signMessage(buildFreeEntryMessage(payload));
  onStatus?.("Opening a free dry-run round…");
  const entered = await request<{ round: IssuedRound }>("/api/gallery/enter", {
    method: "POST",
    body: JSON.stringify({ ...payload, signature: encodeBase58(signature) }),
  });
  return entered.round;
}

export async function payAndEnter(onStatus?: (status: string) => void): Promise<IssuedRound> {
  const address = wallet.address ?? (await wallet.connect());
  const intent = await requestIntent();
  if (!intent.blockhash)
    throw new Error("The range could not get a Solana blockhash. Try again in a moment.");
  const message = buildTransferMessage({
    from: address,
    to: intent.houseWallet,
    lamports: intent.lamports,
    blockhash: intent.blockhash,
    memo: intent.memo,
  });
  const serialized = serializeUnsignedTransaction(message);
  const txSignature = await wallet.signAndSendTransaction(serialized);
  // Remember the payment before talking to the range again, so a cold start,
  // a timeout, or a closed tab can't lose a paid entry.
  const pending: PendingEntry = {
    wallet: address,
    intentId: intent.intentId,
    txSignature,
    paidAt: Date.now(),
  };
  savePendingEntry(pending);
  return redeemPendingEntry(pending, onStatus);
}

/**
 * Turns a recorded payment into a round. Safe to call repeatedly: the range
 * returns the same round (with a fresh token) if the entry already opened.
 */
export async function redeemPendingEntry(
  pending: PendingEntry,
  onStatus?: (status: string) => void,
  options: { maxWaitMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<IssuedRound> {
  const maxWaitMs = options.maxWaitMs ?? 150_000;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const started = Date.now();
  let attempt = 0;
  for (;;) {
    attempt += 1;
    try {
      onStatus?.(
        attempt === 1
          ? "Payment sent. Confirming it on Solana…"
          : `Still confirming your payment (try ${attempt}). The range may be waking up; your entry is safe.`,
      );
      const entered = await request<{ round: IssuedRound }>("/api/gallery/enter", {
        method: "POST",
        body: JSON.stringify({
          wallet: pending.wallet,
          intentId: pending.intentId,
          txSignature: pending.txSignature,
        }),
      });
      clearPendingEntry();
      return entered.round;
    } catch (error) {
      const http = error as RangeHttpError;
      // 409: already in the current pot / open round. Keep the payment for later.
      if (http.status === 409) throw error;
      if (!http.retryable) {
        clearPendingEntry();
        throw error;
      }
      if (Date.now() - started > maxWaitMs) {
        const stuck = new Error(
          "Your payment went through, but the range hasn't confirmed it yet. It's saved on this device: reopen the gallery to resume your entry (valid for 24 hours).",
        ) as RangeHttpError;
        stuck.retryable = true;
        throw stuck;
      }
      await sleep(Math.min(10_000, 2_000 * attempt));
    }
  }
}

export async function submitGalleryRound(input: {
  token: string;
  shots: ShotInput[];
  abandon?: boolean;
}): Promise<SubmitResult> {
  const body = await request<SubmitResult>("/api/gallery/submit", {
    method: "POST",
    body: JSON.stringify(input),
  });
  body.commitmentMatches = await verifyCommitment(body);
  return body;
}

async function verifyCommitment(result: {
  roundId: string;
  wallet: string;
  seed: string;
  reveal: { forfeitIndex: number; salt: string };
  commitment: string;
}): Promise<boolean> {
  const preimage = forfeitPreimage({
    roundId: result.roundId,
    wallet: result.wallet,
    seed: result.seed,
    forfeitIndex: result.reveal.forfeitIndex,
    salt: result.reveal.salt,
  });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(preimage));
  const hex = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return hex === result.commitment;
}
