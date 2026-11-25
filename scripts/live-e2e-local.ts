// Manual check, not part of `pnpm test`. Needs a local solana-test-validator on :8899 and a
// throwaway Postgres (see DATABASE_URL below). Runs the whole live flow: story unlock, intent,
// on-chain entry, scoring, settlement, and a real payout signed by a throwaway house key.
// Usage: node --experimental-strip-types scripts/live-e2e-local.ts
// Full live-mode API run against a local solana-test-validator + Postgres.
import nacl from "tweetnacl";
import bs58 from "bs58";
import { spawn } from "node:child_process";
import { jsonRpc, signPayout, sendSignedTransaction, getSignatureState, getBalance } from "../server/solana.ts";
import { buildStoryCompleteMessage } from "../src/gallery-protocol.ts";
import { encodeBase58 } from "../src/leaderboard-protocol.ts";
const RPC = "http://127.0.0.1:8899";
const rpc = jsonRpc(RPC);
const house = nacl.sign.keyPair();
const hw = bs58.encode(house.publicKey);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function confirm(sig: string) { for (let i = 0; i < 60; i++) { if ((await getSignatureState(rpc, sig)) === "confirmed") return; await wait(500); } throw new Error("no confirm " + sig); }
async function fund(addr: string, lamports: number) { const s = (await rpc({ method: "requestAirdrop", params: [addr, lamports] })) as string; await confirm(s); }
await fund(hw, 10_000_000); // seed float 0.01 SOL
const port = 18787;
const server = spawn("node", ["--experimental-strip-types", "server/index.ts"], {
  env: { ...process.env, PORT: String(port), GALLERY_DRY_RUN: "false", SOLANA_RPC_URL: RPC, HOUSE_WALLET: hw,
    HOUSE_WALLET_SECRET: JSON.stringify([...house.secretKey]), DATABASE_URL: "postgres://postgres:test@127.0.0.1:55432/postgres" },
  stdio: ["ignore", "pipe", "pipe"],
});
let logs = "";
server.stdout.on("data", (d) => (logs += d)); server.stderr.on("data", (d) => (logs += d));
const base = `http://127.0.0.1:${port}`;
for (let i = 0; i < 40; i++) { try { if ((await fetch(base + "/health")).ok) break; } catch {} await wait(250); }
const post = async (path: string, body: unknown) => { const r = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); return { status: r.status, body: (await r.json()) as any }; };
try {
  console.log("health", JSON.stringify((await (await fetch(base + "/health")).json()).gallery));
  const players = [nacl.sign.keyPair(), nacl.sign.keyPair(), nacl.sign.keyPair()];
  const results: any[] = [];
  for (const [i, p] of players.entries()) {
    const w = bs58.encode(p.publicKey);
    await fund(w, 100_000_000);
    const n = await post("/api/nonce", { wallet: w });
    const payload = { wallet: w, timestamp: Date.now(), nonce: n.body.nonce };
    const sig = encodeBase58(nacl.sign.detached(new TextEncoder().encode(buildStoryCompleteMessage(payload)), p.secretKey));
    const st = await post("/api/gallery/story", { ...payload, signature: sig });
    if (st.status !== 200) throw new Error("story " + JSON.stringify(st));
    const intent = await post("/api/gallery/intent", { wallet: w });
    if (intent.status !== 200) throw new Error("intent " + JSON.stringify(intent));
    const tx = await signPayout({ rpc, secret: p.secretKey, to: intent.body.houseWallet, lamports: intent.body.lamports, memo: intent.body.memo });
    await sendSignedTransaction(rpc, tx.serialized);
    // Hit /enter immediately (before confirmation), as a real browser would.
    let entered = await post("/api/gallery/enter", { wallet: w, intentId: intent.body.intentId, txSignature: tx.signature });
    let tries = 1;
    while (entered.status !== 200 && entered.body.retryable && tries < 10) { await wait(1000); entered = await post("/api/gallery/enter", { wallet: w, intentId: intent.body.intentId, txSignature: tx.signature }); tries++; }
    if (entered.status !== 200) throw new Error("enter " + JSON.stringify(entered));
    console.log(`player ${i} entered after ${tries} call(s); pot ${entered.body.pot.potLamports} lamports, mode ${entered.body.pot.mode}`);
    let shots: any[] = [];
    // Player 0 files a card (no shots = five misses = 125); the other two forfeit.
    const sub = await post("/api/gallery/submit", { token: entered.body.round.token, shots, abandon: i !== 0 });
    if (sub.status !== 200) throw new Error("submit " + JSON.stringify(sub));
    results.push(sub.body);
  }
  const last = results[2];
  console.log("settlement", JSON.stringify({ kind: last.settlement.kind, winningScore: last.settlement.winningScore, payouts: last.settlement.payouts.map((p: any) => ({ lamports: p.lamports, status: p.status })) }));
  const winner = bs58.encode(players[0]!.publicKey);
  for (let i = 0; i < 40; i++) {
    const s = await (await fetch(`${base}/api/gallery/pot/${last.pot.id}?wallet=${winner}`)).json() as any;
    const p = s.pot.settlement?.payouts?.[0];
    if (p?.status === "sent") { console.log("payout sent", p.lamports, "tx", p.txSignature); break; }
    await wait(1000);
  }
  console.log("house balance after", await getBalance(rpc, hw), "(expected 10_000_000 + 150_000_000 - prize - fee)");
  console.log("winner balance", await getBalance(rpc, winner));
} finally {
  server.kill();
  console.log("--- server log (filtered) ---\n" + logs.split("\n").filter((l) => !l.startsWith("cors ")).join("\n"));
}
