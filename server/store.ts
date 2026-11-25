import type { Sql } from "postgres";
import { MemoryGalleryStore, PostgresGalleryStore, type GalleryStore } from "./gallery-store.ts";
import {
  LEADERBOARD_SIZE,
  type LeaderboardEntry,
} from "../src/leaderboard-protocol.ts";

export interface ScoreRow {
  wallet: string;
  score: number;
  submittedAt: number;
}

export interface Store {
  kind: "memory" | "postgres";
  issueNonce(wallet: string, nonce: string, expiresAt: number): Promise<void>;
  consumeNonce(wallet: string, nonce: string, now: number): Promise<boolean>;
  upsertScore(row: ScoreRow): Promise<{ accepted: boolean; score: number }>;
  top(limit?: number): Promise<LeaderboardEntry[]>;
  close(): Promise<void>;
}

export class MemoryStore implements Store {
  kind = "memory" as const;
  private nonces = new Map<string, { wallet: string; expiresAt: number }>();
  private scores = new Map<string, ScoreRow>();

  async issueNonce(wallet: string, nonce: string, expiresAt: number) {
    this.prune(Date.now());
    this.nonces.set(nonce, { wallet, expiresAt });
  }

  async consumeNonce(wallet: string, nonce: string, now: number) {
    this.prune(now);
    const issued = this.nonces.get(nonce);
    if (!issued || issued.wallet !== wallet || issued.expiresAt <= now)
      return false;
    this.nonces.delete(nonce);
    return true;
  }

  async upsertScore(row: ScoreRow) {
    const existing = this.scores.get(row.wallet);
    if (existing && existing.score >= row.score)
      return { accepted: false, score: existing.score };
    this.scores.set(row.wallet, row);
    return { accepted: true, score: row.score };
  }

  async top(limit = LEADERBOARD_SIZE): Promise<LeaderboardEntry[]> {
    return [...this.scores.values()]
      .sort((a, b) => b.score - a.score || a.submittedAt - b.submittedAt)
      .slice(0, limit)
      .map((row, index) => ({
        rank: index + 1,
        wallet: row.wallet,
        score: row.score,
        submittedAt: row.submittedAt,
      }));
  }

  async close() {
    this.nonces.clear();
    this.scores.clear();
  }

  private prune(now: number) {
    for (const [nonce, issued] of this.nonces)
      if (issued.expiresAt <= now) this.nonces.delete(nonce);
  }
}

export class PostgresStore implements Store {
  kind = "postgres" as const;

  static fromSql(sql: Sql): PostgresStore {
    return new PostgresStore(sql);
  }

  static async connect(url: string): Promise<PostgresStore> {
    const { default: postgres } = await import("postgres");
    const local = /localhost|127\.0\.0\.1/.test(url);
    const sql = postgres(url, {
      max: 4,
      ssl: local ? false : "require",
    });
    const store = new PostgresStore(sql);
    await store.setup();
    return store;
  }

  private sql: Sql;
  private constructor(sql: Sql) {
    this.sql = sql;
  }

  async setup() {
    await this.sql`
      CREATE TABLE IF NOT EXISTS scores (
        wallet TEXT PRIMARY KEY,
        score INTEGER NOT NULL,
        submitted_at TIMESTAMPTZ NOT NULL
      )`;
    await this.sql`
      CREATE TABLE IF NOT EXISTS nonces (
        nonce TEXT PRIMARY KEY,
        wallet TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL
      )`;
    await this.sql`CREATE INDEX IF NOT EXISTS scores_rank_idx ON scores (score DESC, submitted_at ASC)`;
  }

  async issueNonce(wallet: string, nonce: string, expiresAt: number) {
    await this.sql`DELETE FROM nonces WHERE expires_at <= now()`;
    await this.sql`
      INSERT INTO nonces (nonce, wallet, expires_at)
      VALUES (${nonce}, ${wallet}, ${new Date(expiresAt)})`;
  }

  async consumeNonce(wallet: string, nonce: string, now: number) {
    const rows = await this.sql`
      DELETE FROM nonces
      WHERE nonce = ${nonce}
        AND wallet = ${wallet}
        AND expires_at > ${new Date(now)}
      RETURNING nonce`;
    return rows.length > 0;
  }

  async upsertScore(row: ScoreRow) {
    const existing = await this.sql<{ score: number }[]>`
      SELECT score FROM scores WHERE wallet = ${row.wallet}`;
    if (existing[0] && existing[0].score >= row.score)
      return { accepted: false, score: existing[0].score };
    await this.sql`
      INSERT INTO scores (wallet, score, submitted_at)
      VALUES (${row.wallet}, ${row.score}, ${new Date(row.submittedAt)})
      ON CONFLICT (wallet) DO UPDATE
        SET score = EXCLUDED.score,
            submitted_at = EXCLUDED.submitted_at
        WHERE scores.score < EXCLUDED.score`;
    return { accepted: true, score: row.score };
  }

  async top(limit = LEADERBOARD_SIZE): Promise<LeaderboardEntry[]> {
    const rows = await this.sql<{
      wallet: string;
      score: number;
      submitted_at: Date;
    }[]>`
      SELECT wallet, score, submitted_at
      FROM scores
      ORDER BY score DESC, submitted_at ASC
      LIMIT ${limit}`;
    return rows.map((row, index) => ({
      rank: index + 1,
      wallet: row.wallet,
      score: row.score,
      submittedAt: row.submitted_at.getTime(),
    }));
  }

  async close() {
    await this.sql.end({ timeout: 2 });
  }
}

export async function openStore(
  databaseUrl = process.env.DATABASE_URL,
): Promise<Store> {
  if (!databaseUrl) return new MemoryStore();
  return PostgresStore.connect(databaseUrl);
}

export async function openStores(
  databaseUrl = process.env.DATABASE_URL,
): Promise<{ store: Store; gallery: GalleryStore; close: () => Promise<void> }> {
  if (!databaseUrl) {
    const store = new MemoryStore();
    const gallery = new MemoryGalleryStore();
    return {
      store,
      gallery,
      close: async () => {
        await store.close();
        await gallery.close();
      },
    };
  }
  const { default: postgres } = await import("postgres");
  const local = /localhost|127\.0\.0\.1/.test(databaseUrl);
  const sql = postgres(databaseUrl, {
    onnotice: () => {},
    max: 4,
    ssl: local ? false : "require",
  });
  const store = PostgresStore.fromSql(sql);
  const gallery = new PostgresGalleryStore(sql);
  await store.setup();
  await gallery.setup();
  return {
    store,
    gallery,
    close: async () => {
      await sql.end({ timeout: 2 });
    },
  };
}
