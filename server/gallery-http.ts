import type { IncomingMessage } from "node:http";
import { isSolanaAddress } from "../src/leaderboard-protocol.ts";
import type { RateLimiter } from "./rate-limit.ts";
import type { Store } from "./store.ts";
import type { GalleryStore } from "./gallery-store.ts";
import {
  enterFreeRound,
  enterRound,
  galleryStatus,
  issueIntent,
  publicPot,
  reportStoryComplete,
  submitRound,
  type GalleryConfig,
} from "./gallery.ts";

export async function handleGalleryRequest(input: {
  method: string;
  url: URL;
  req: IncomingMessage;
  send: (status: number, body: unknown) => void;
  readBody: () => Promise<unknown>;
  scores: Store;
  gallery: GalleryStore;
  config: GalleryConfig;
  now: number;
  limiter: RateLimiter;
  ip: string;
}): Promise<boolean> {
  const { method, url, send, readBody, scores, gallery, config, now, limiter, ip } = input;
  const path = url.pathname;

  if (method === "GET" && path === "/api/gallery/status") {
    if (!limiter.allow(`gallery-status:${ip}`, 60, 60_000, now)) {
      send(429, { error: "Too many requests" });
      return true;
    }
    const wallet = url.searchParams.get("wallet") ?? undefined;
    if (wallet && !isSolanaAddress(wallet)) {
      send(400, { error: "Invalid wallet" });
      return true;
    }
    send(200, await galleryStatus(gallery, config, wallet, now));
    return true;
  }

  if (method === "GET" && path.startsWith("/api/gallery/pot/")) {
    if (!limiter.allow(`gallery-pot:${ip}`, 60, 60_000, now)) {
      send(429, { error: "Too many requests" });
      return true;
    }
    const potId = path.slice("/api/gallery/pot/".length);
    const wallet = url.searchParams.get("wallet") ?? undefined;
    if (wallet && !isSolanaAddress(wallet)) {
      send(400, { error: "Invalid wallet" });
      return true;
    }
    send(200, { pot: await publicPot(gallery, potId, wallet) });
    return true;
  }

  if (method === "POST" && path === "/api/gallery/story") {
    if (!limiter.allow(`gallery-story:${ip}`, 10, 60_000, now)) {
      send(429, { error: "Too many requests" });
      return true;
    }
    const body = await readBody();
    const result = await reportStoryComplete(gallery, body, now, (wallet, nonce, when) =>
      scores.consumeNonce(wallet, nonce, when),
    );
    if (!result.ok) send(result.status, { error: result.error });
    else send(200, { ok: true, storyCompleted: true });
    return true;
  }

  if (method === "POST" && path === "/api/gallery/intent") {
    if (!limiter.allow(`gallery-intent:${ip}`, 20, 60_000, now)) {
      send(429, { error: "Too many requests" });
      return true;
    }
    const body = await readBody();
    const wallet =
      body && typeof body === "object" ? (body as { wallet?: unknown }).wallet : undefined;
    if (typeof wallet !== "string") {
      send(400, { error: "Invalid wallet" });
      return true;
    }
    if (!limiter.allow(`gallery-intent-wallet:${wallet}`, 6, 60_000, now)) {
      send(429, { error: "Too many requests" });
      return true;
    }
    const result = await issueIntent(gallery, wallet, config, now);
    if (!result.ok) send(result.status, { error: result.error });
    else send(200, result);
    return true;
  }

  if (method === "POST" && path === "/api/gallery/enter") {
    if (!limiter.allow(`gallery-enter:${ip}`, 20, 60_000, now)) {
      send(429, { error: "Too many requests" });
      return true;
    }
    const body = await readBody();
    const payload = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    // Generous per wallet so a paid player's automatic retries after a cold start still get through.
    if (
      typeof payload.wallet === "string" &&
      !limiter.allow(`gallery-enter-wallet:${payload.wallet}`, 30, 60_000, now)
    ) {
      send(429, { error: "Too many requests", retryable: true });
      return true;
    }
    const usesFreeEntry =
      typeof payload.nonce === "string" ||
      (config.dryRun && typeof payload.txSignature !== "string");
    const result = usesFreeEntry
      ? await enterFreeRound(gallery, config, payload, now, (wallet, nonce, when) =>
          scores.consumeNonce(wallet, nonce, when),
        )
      : await enterRound(
          gallery,
          config,
          {
            wallet: typeof payload.wallet === "string" ? payload.wallet : "",
            intentId: typeof payload.intentId === "string" ? payload.intentId : "",
            txSignature: typeof payload.txSignature === "string" ? payload.txSignature : "",
          },
          now,
        );
    if (!result.ok)
      send(result.status, {
        error: result.error,
        ...("retryable" in result && result.retryable ? { retryable: true } : {}),
      });
    else send(200, result);
    return true;
  }

  if (method === "POST" && path === "/api/gallery/submit") {
    if (!limiter.allow(`gallery-submit:${ip}`, 20, 60_000, now)) {
      send(429, { error: "Too many requests" });
      return true;
    }
    const body = await readBody();
    const payload = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    const result = await submitRound(
      gallery,
      config,
      {
        token: typeof payload.token === "string" ? payload.token : "",
        shots: payload.shots,
        abandon: payload.abandon === true,
      },
      now,
    );
    if (!result.ok) send(result.status, { error: result.error });
    else send(200, result);
    return true;
  }

  return false;
}
