import {
  ENTRY_SOL,
  LEGAL_LINE,
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
  storyCompleted: boolean;
  storyUnlockNote: string;
  pot: PublicPot | null;
  activeRound: { potId: string; expiresAt: number; startedAt: number } | null;
};

export type PublicPot = {
  id: string;
  status: "open" | "settled";
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

function apiBase(): string | null {
  return leaderboardApiBase();
}

export function galleryConfigured(): boolean {
  return apiBase() !== null;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const base = apiBase();
  if (base === null) throw new Error("The shooting gallery is not live on this build.");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_MS);
  try {
    const response = await fetch(`${base}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
    });
    const body = (await response.json().catch(() => ({}))) as { error?: string } & T;
    if (!response.ok)
      throw new Error(body.error || `The range returned ${response.status}.`);
    return body;
  } catch (error) {
    throw describeRangeError(error);
  } finally {
    clearTimeout(timer);
  }
}

export function describeRangeError(error: unknown): Error {
  if (error instanceof Error && error.name === "AbortError")
    return new Error("The range took too long to answer. Try the unlock again.");
  const message = error instanceof Error ? error.message : "";
  if (
    error instanceof TypeError ||
    /failed to fetch|networkerror|load failed|cors/i.test(message)
  )
    return new Error(
      "Couldn't reach the range API from this page (a network or CORS error). The Phantom popup will not open until that request succeeds. Reload and try again.",
    );
  if (error instanceof Error && error.message.trim()) return error;
  return new Error("Couldn't complete the story unlock.");
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

export async function payAndEnter(): Promise<IssuedRound> {
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
  const entered = await request<{ round: IssuedRound }>("/api/gallery/enter", {
    method: "POST",
    body: JSON.stringify({
      wallet: address,
      intentId: intent.intentId,
      txSignature,
    }),
  });
  return entered.round;
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
