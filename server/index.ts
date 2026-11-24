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
import { openStore, type Store } from "./store.ts";
import { RateLimiter } from "./rate-limit.ts";
import { verifyScoreSignature } from "./verify.ts";

const MAX_BODY = 8_192;
const DEFAULT_ORIGINS = [
  "http://127.0.0.1:5173",
  "http://localhost:5173",
  "https://grand-theft-liquidity.onrender.com",
];

export interface ApiOptions {
  store: Store;
  origins?: string[];
  limiter?: RateLimiter;
  now?: () => number;
}

export function allowedOrigins(): string[] {
  const configured = process.env.CORS_ORIGIN?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  return configured?.length ? configured : DEFAULT_ORIGINS;
}

function originAllowed(origin: string | undefined, allowed: string[]): boolean {
  return !!origin && allowed.includes(origin);
}

function clientIp(req: IncomingMessage): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim())
    return forwarded.split(",")[0]!.trim();
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
  };
  if (origin && originAllowed(origin, allowed)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Methods"] = "GET,POST,OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Content-Type, Accept";
    headers["Access-Control-Max-Age"] = "600";
    headers.Vary = "Origin";
  }
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

  return createServer(async (req, res) => {
    const origin = typeof req.headers.origin === "string" ? req.headers.origin : undefined;
    const url = new URL(req.url || "/", "http://127.0.0.1");
    const ip = clientIp(req);

    try {
      if (req.method === "OPTIONS") {
        if (origin && originAllowed(origin, allowed)) {
          res.writeHead(204, {
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Accept",
            "Access-Control-Max-Age": "600",
            Vary: "Origin",
          });
        } else res.writeHead(204);
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
  const store = await openStore();
  const server = createLeaderboardServer({ store });
  const port = Number(process.env.PORT) || 8787;
  await new Promise<void>((resolve) => {
    server.listen(port, "0.0.0.0", () => resolve());
  });
  console.log(
    `Leaderboard API on :${port} (${store.kind}${store.kind === "memory" ? "; set DATABASE_URL for Postgres" : ""})`,
  );
  const shutdown = async () => {
    server.close();
    await store.close();
  };
  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());
  return { server, store };
}

const isMain =
  !!process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) void startLeaderboardServer();
