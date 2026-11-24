import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  isSolanaAddress,
  LEADERBOARD_SIZE,
  NONCE_TTL_MS,
  validateScoreFields,
} from "../src/leaderboard-protocol.ts";
import { openStores, type Store } from "./store.ts";
import { RateLimiter } from "./rate-limit.ts";
import { verifyScoreSignature } from "./verify.ts";
import { MemoryGalleryStore, type GalleryStore } from "./gallery-store.ts";
import { handleGalleryRequest } from "./gallery-http.ts";
import { loadGalleryConfig, unconfiguredGallery } from "./gallery-config.ts";
import type { GalleryConfig } from "./gallery.ts";

const MAX_BODY = 16_384;
const DEFAULT_ORIGINS = [
  "http://127.0.0.1:5173",
  "http://localhost:5173",
  "https://grand-theft-liquidity.onrender.com",
  "https://grandtheftliquidity.fun",
  "https://www.grandtheftliquidity.fun",
];

export interface ApiOptions {
  store: Store;
  gallery?: GalleryStore;
  galleryConfig?: GalleryConfig;
  origins?: string[];
  limiter?: RateLimiter;
  now?: () => number;
}

export function normalizeOrigin(origin: string | undefined): string | undefined {
  if (!origin) return undefined;
  const trimmed = origin.trim();
  if (!trimmed || trimmed === "null") return undefined;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    const host = url.hostname.replace(/\.+$/, "");
    if (!host) return undefined;
    const port = url.port;
    const implicit =
      !port || (url.protocol === "https:" && port === "443") || (url.protocol === "http:" && port === "80");
    return `${url.protocol}//${host}${implicit ? "" : `:${port}`}`;
  } catch {
    return trimmed.replace(/\/+$/, "") || undefined;
  }
}

export function allowedOrigins(): string[] {
  const configured = (process.env.CORS_ORIGIN?.split(",") ?? [])
    .map((origin) => normalizeOrigin(origin.trim()))
    .filter((origin): origin is string => !!origin);
  const merged = new Set<string>();
  for (const origin of [...DEFAULT_ORIGINS, ...configured]) {
    const normalized = normalizeOrigin(origin);
    if (normalized) merged.add(normalized);
  }
  return [...merged];
}

function originAllowed(origin: string | undefined, allowed: string[]): boolean {
  const normalized = normalizeOrigin(origin);
  if (!normalized) return false;
  if (allowed.includes(normalized)) return true;
  try {
    const url = new URL(normalized);
    url.hostname = url.hostname.startsWith("www.")
      ? url.hostname.slice(4)
      : `www.${url.hostname}`;
    return allowed.includes(url.origin);
  } catch {
    return false;
  }
}

const DEFAULT_ALLOW_HEADERS = [
  "Accept",
  "Authorization",
  "Content-Type",
  "X-Requested-With",
];

function allowRequestHeaders(requested: string | string[] | undefined): string {
  const raw = Array.isArray(requested) ? requested.join(",") : requested ?? "";
  const names = raw
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name && name !== "*" && /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/.test(name));
  const merged = new Set(DEFAULT_ALLOW_HEADERS);
  for (const name of names) merged.add(name);
  return Array.from(merged).join(", ");
}

function corsHeaders(
  origin: string | undefined,
  allowed: string[],
  requestedHeaders?: string | string[] | undefined,
  privateNetwork?: boolean,
): Record<string, string> {
  const headers: Record<string, string> = {
    Vary: "Origin",
    "Cache-Control": "no-store",
  };
  const normalized = normalizeOrigin(origin);
  if (!normalized || !originAllowed(normalized, allowed)) return headers;
  headers["Access-Control-Allow-Origin"] = normalized;
  headers["Access-Control-Allow-Credentials"] = "true";
  headers["Access-Control-Allow-Methods"] = "GET,POST,OPTIONS";
  headers["Access-Control-Allow-Headers"] = allowRequestHeaders(requestedHeaders);
  headers["Access-Control-Max-Age"] = "10";
  if (privateNetwork) headers["Access-Control-Allow-Private-Network"] = "true";
  return headers;
}

function clientIp(req: IncomingMessage): string {
  return req.socket.remoteAddress || "unknown";
}

function send(
  res: ServerResponse,
  status: number,
  body: unknown,
  origin?: string,
  allowed: string[] = [],
) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...corsHeaders(origin, allowed),
  };
  res.writeHead(status, headers);
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error("Payload too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!chunks.length) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

export function createLeaderboardServer(options: ApiOptions) {
  const allowed = options.origins ?? allowedOrigins();
  const limiter = options.limiter ?? new RateLimiter();
  const now = options.now ?? Date.now;
  const { store } = options;
  const gallery = options.gallery ?? new MemoryGalleryStore();
  const galleryConfig = options.galleryConfig ?? unconfiguredGallery();

  return createServer(async (req, res) => {
    const rawOrigin = Array.isArray(req.headers.origin)
      ? req.headers.origin[0]
      : typeof req.headers.origin === "string"
        ? req.headers.origin
        : undefined;
    const origin = normalizeOrigin(rawOrigin);
    let url: URL;
    try {
      url = new URL(req.url || "/", "http://127.0.0.1");
    } catch {
      send(res, 400, { error: "Invalid request URL" }, origin, allowed);
      return;
    }
    const ip = clientIp(req);
    console.log(
      `cors origin=${rawOrigin || "-"} normalized=${origin || "-"} allowed=${originAllowed(origin, allowed)} method=${req.method || "GET"} path=${url.pathname}`,
    );

    try {
      if (req.method === "OPTIONS") {
        const preflight = corsHeaders(
          origin,
          allowed,
          req.headers["access-control-request-headers"],
          String(req.headers["access-control-request-private-network"] || "").toLowerCase() === "true",
        );
        res.writeHead(204, preflight);
        res.end();
        return;
      }

      if (req.method === "GET" && url.pathname === "/health") {
        send(
          res,
          200,
          { ok: true, storage: store.kind },
          origin,
          allowed,
        );
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/leaderboard") {
        if (!limiter.allow(`get:${ip}`, 60, 60_000, now())) {
          send(res, 429, { error: "Too many requests" }, origin, allowed);
          return;
        }
        const entries = await store.top(LEADERBOARD_SIZE);
        send(res, 200, { entries }, origin, allowed);
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/nonce") {
        if (
          !limiter.allow(`nonce-ip:${ip}`, 20, 60_000, now())
        ) {
          send(res, 429, { error: "Too many requests" }, origin, allowed);
          return;
        }
        const body = await readBody(req);
        const wallet =
          body && typeof body === "object"
            ? (body as { wallet?: unknown }).wallet
            : undefined;
        if (typeof wallet !== "string" || !isSolanaAddress(wallet)) {
          send(res, 400, { error: "Invalid wallet" }, origin, allowed);
          return;
        }
        if (!limiter.allow(`nonce-wallet:${wallet}`, 8, 60_000, now())) {
          send(res, 429, { error: "Too many requests" }, origin, allowed);
          return;
        }
        const nonce = randomBytes(16).toString("hex");
        const expiresAt = now() + NONCE_TTL_MS;
        await store.issueNonce(wallet, nonce, expiresAt);
        send(res, 200, { nonce, expiresAt }, origin, allowed);
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/scores") {
        if (
          !limiter.allow(`score-ip:${ip}`, 10, 60_000, now())
        ) {
          send(res, 429, { error: "Too many requests" }, origin, allowed);
          return;
        }
        const body = await readBody(req);
        const checked = validateScoreFields(body, now());
        if (!checked.ok) {
          send(res, 400, { error: checked.error }, origin, allowed);
          return;
        }
        const signature =
          body && typeof body === "object"
            ? (body as { signature?: unknown }).signature
            : undefined;
        if (typeof signature !== "string") {
          send(res, 400, { error: "Missing signature" }, origin, allowed);
          return;
        }
        if (!limiter.allow(`score-wallet:${checked.value.wallet}`, 5, 60_000, now())) {
          send(res, 429, { error: "Too many requests" }, origin, allowed);
          return;
        }
        if (!verifyScoreSignature(checked.value, signature)) {
          send(res, 400, { error: "Invalid signature" }, origin, allowed);
          return;
        }
        const consumed = await store.consumeNonce(
          checked.value.wallet,
          checked.value.nonce,
          now(),
        );
        if (!consumed) {
          send(res, 400, { error: "Invalid or expired nonce" }, origin, allowed);
          return;
        }
        await store.upsertScore({
          wallet: checked.value.wallet,
          score: checked.value.score,
          submittedAt: now(),
        });
        const entries = await store.top(LEADERBOARD_SIZE);
        send(res, 200, { entries }, origin, allowed);
        return;
      }

      const handled = await handleGalleryRequest({
        method: req.method || "GET",
        url,
        req,
        send: (status, body) => send(res, status, body, origin, allowed),
        readBody: () => readBody(req),
        scores: store,
        gallery,
        config: galleryConfig,
        now: now(),
        limiter,
        ip,
      });
      if (handled) return;

      send(res, 404, { error: "Not found" }, origin, allowed);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Server error";
      const status =
        message === "Payload too large" || message === "Invalid JSON" ? 400 : 500;
      if (status === 500) console.error(error);
      send(
        res,
        status,
        { error: status === 400 ? message : "Server error" },
        origin,
        allowed,
      );
    }
  });
}

export async function startLeaderboardServer() {
  const opened = await openStores();
  const { store, gallery } = opened;
  let galleryConfig = unconfiguredGallery();
  try {
    galleryConfig = loadGalleryConfig();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid gallery configuration";
    console.error(`Shooting gallery disabled: ${message}`);
  }
  const server = createLeaderboardServer({ store, gallery, galleryConfig });
  const port = Number(process.env.PORT) || 8787;
  await new Promise<void>((resolve) => {
    server.listen(port, "0.0.0.0", () => resolve());
  });
  const galleryState = galleryConfig.configured
    ? `gallery ${galleryConfig.dryRun ? "dry-run" : "live payouts"}`
    : "gallery unconfigured";
  console.log(
    `Leaderboard API on :${port} (${store.kind}${store.kind === "memory" ? "; set DATABASE_URL for Postgres" : ""}; ${galleryState})`,
  );
  const shutdown = async () => {
    server.close();
    await opened.close();
  };
  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());
  return { server, store };
}

const isMain =
  !!process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) void startLeaderboardServer();
