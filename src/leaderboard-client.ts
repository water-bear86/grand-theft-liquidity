import {
  buildScoreMessage,
  encodeBase58,
  type LeaderboardEntry,
} from "./leaderboard-protocol.ts";
import { wallet } from "./wallet.ts";

const REQUEST_MS = 20_000;

export function leaderboardApiBase(): string | null {
  const configured = import.meta.env.VITE_LEADERBOARD_API?.trim().replace(
    /\/$/,
    "",
  );
  if (configured) return configured;
  if (import.meta.env.DEV) return "";
  return null;
}

export function leaderboardConfigured(): boolean {
  return leaderboardApiBase() !== null;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const base = leaderboardApiBase();
  if (base === null) throw new Error("The board is not live on this build.");
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
    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
    } & T;
    if (!response.ok)
      throw new Error(body.error || `The board returned ${response.status}.`);
    return body;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError")
      throw new Error("The board took too long to answer.");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchLeaderboard(): Promise<LeaderboardEntry[]> {
  const body = await request<{ entries: LeaderboardEntry[] }>("/api/leaderboard");
  return Array.isArray(body.entries) ? body.entries : [];
}

export async function submitScore(score: number): Promise<LeaderboardEntry[]> {
  if (!Number.isInteger(score) || score < 0)
    throw new Error("This run has no banked score to post.");
  const address = wallet.address ?? (await wallet.connect());
  const issued = await request<{ nonce: string }>("/api/nonce", {
    method: "POST",
    body: JSON.stringify({ wallet: address }),
  });
  const payload = {
    wallet: address,
    score,
    timestamp: Date.now(),
    nonce: issued.nonce,
  };
  const signature = await wallet.signMessage(buildScoreMessage(payload));
  const body = await request<{ entries: LeaderboardEntry[] }>("/api/scores", {
    method: "POST",
    body: JSON.stringify({
      ...payload,
      signature: encodeBase58(signature),
    }),
  });
  return Array.isArray(body.entries) ? body.entries : [];
}

export function isUserRejection(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? (error as { code?: number }).code : undefined;
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return (
    code === 4001 ||
    message.includes("reject") ||
    message.includes("denied") ||
    message.includes("cancel")
  );
}
