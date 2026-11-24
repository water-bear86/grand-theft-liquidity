import test from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { encodeBase58, MAX_SCORE } from "../src/leaderboard-protocol.ts";
import { MemoryStore } from "./store.ts";
import { createLeaderboardServer } from "./index.ts";

async function withApi(
  fn: (url: string, wallet: string, sign: (body: object) => string) => Promise<void>,
) {
  const key = nacl.sign.keyPair();
  const wallet = bs58.encode(key.publicKey);
  const store = new MemoryStore();
  const server = createLeaderboardServer({
    store,
    origins: ["http://127.0.0.1:5173"],
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no port");
  const url = `http://127.0.0.1:${address.port}`;
  const sign = (body: object) => {
    const message = [
      "Grand Theft Liquidity",
      `Wallet: ${(body as { wallet: string }).wallet}`,
      `Score: ${(body as { score: number }).score}`,
      `Timestamp: ${(body as { timestamp: number }).timestamp}`,
      `Nonce: ${(body as { nonce: string }).nonce}`,
    ].join("\n");
    return encodeBase58(
      nacl.sign.detached(new TextEncoder().encode(message), key.secretKey),
    );
  };
  try {
    await fn(url, wallet, sign);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await store.close();
  }
}

async function post(url: string, path: string, body: unknown) {
  const response = await fetch(`${url}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "http://127.0.0.1:5173",
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

test("the API accepts a signed score and returns a ranked board", async () => {
  await withApi(async (url, wallet, sign) => {
    const health = await fetch(`${url}/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { ok: true, storage: "memory" });

    const nonceRes = await post(url, "/api/nonce", { wallet });
    assert.equal(nonceRes.status, 200);
    const nonce = (nonceRes.body as { nonce: string }).nonce;
    const payload = {
      wallet,
      score: 4200,
      timestamp: Date.now(),
      nonce,
    };
    const submitted = await post(url, "/api/scores", {
      ...payload,
      signature: sign(payload),
    });
    assert.equal(submitted.status, 200);
    const entries = (submitted.body as { entries: { wallet: string; score: number; rank: number }[] }).entries;
    assert.equal(entries[0]?.wallet, wallet);
    assert.equal(entries[0]?.score, 4200);
    assert.equal(entries[0]?.rank, 1);

    const board = await fetch(`${url}/api/leaderboard`, {
      headers: { Origin: "http://127.0.0.1:5173" },
    });
    assert.equal(board.status, 200);
    const listed = (await board.json()) as { entries: { score: number }[] };
    assert.equal(listed.entries[0]?.score, 4200);
  });
});

test("the API rejects a bad signature, a reused nonce, and a score above the cap", async () => {
  await withApi(async (url, wallet, sign) => {
    const first = await post(url, "/api/nonce", { wallet });
    const payload = {
      wallet,
      score: 10,
      timestamp: Date.now(),
      nonce: (first.body as { nonce: string }).nonce,
    };
    const bad = await post(url, "/api/scores", {
      ...payload,
      signature: "2" + "1".repeat(86),
    });

    assert.equal(bad.status, 400);
    assert.equal((bad.body as { error: string }).error, "Invalid signature");

    const ok = await post(url, "/api/scores", {
      ...payload,
      signature: sign(payload),
    });

    assert.equal(ok.status, 200);
    const replay = await post(url, "/api/scores", {
      ...payload,
      signature: sign(payload),
    });
    assert.equal(replay.status, 400);
    assert.equal((replay.body as { error: string }).error, "Invalid or expired nonce");

    const capped = await post(url, "/api/scores", {
      wallet,
      score: MAX_SCORE + 1,
      timestamp: Date.now(),
      nonce: "a".repeat(32),
      signature: "ignored",
    });
    assert.equal(capped.status, 400);
    assert.equal((capped.body as { error: string }).error, "Invalid score");
  });
});

test("malformed request targets return 400 without stopping the server", async () => {
  await withApi(async (url) => {
    const target = new URL(url);
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const req = request({
        hostname: target.hostname,
        port: target.port,
        path: "http://[",
      }, (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode));
      });
      req.on("error", reject);
      req.end();
    });
    assert.equal(status, 400);
    assert.equal((await fetch(`${url}/health`)).status, 200);
  });
});

test("client-supplied forwarding headers cannot bypass IP limits", async () => {
  await withApi(async (url) => {
    for (const [path, limit, method] of [
      ["/api/leaderboard", 60, "GET"],
      ["/api/nonce", 20, "POST"],
      ["/api/scores", 10, "POST"],
    ] as const) {
      for (let i = 0; i <= limit; i++) {
        const response = await fetch(`${url}${path}`, {
          method,
          headers: { "X-Forwarded-For": `192.0.2.${i}` },
          ...(method === "POST" ? { body: "{}" } : {}),
        });
        assert.equal(response.status, i === limit ? 429 : method === "GET" ? 200 : 400);
        await response.arrayBuffer();
      }
    }
  });
});
