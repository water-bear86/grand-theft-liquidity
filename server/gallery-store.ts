import type { Sql } from "postgres";
import type { PotSettlement, RoundEvaluation } from "../src/gallery-protocol.ts";
import { ENTRY_LAMPORTS, PLAYERS_PER_POT } from "../src/gallery-protocol.ts";

export type EntryStatus = "playing" | "scored" | "forfeit";
export type PotStatus = "open" | "settled";
/**
 * "test" pots hold dry-run / free entries and never touch real SOL.
 * "live" pots hold verified on-chain entries only. The two never mix.
 */
export type PotMode = "test" | "live";
/**
 * pending  – owed, not yet signed
 * sending  – signed and (maybe) broadcast; txSignature + lastValidBlockHeight are stored
 *            BEFORE broadcast so a crash or retry can check the chain instead of re-paying
 * held     – not sent because the house balance (minus fee + rent reserve) can't cover it,
 *            or it exceeds the per-payout safety cap; retried automatically
 * sent     – confirmed on chain
 * dry_run  – test pot, nothing is ever sent
 * failed   – legacy status from older builds; treated like pending on retry
 */
export type PayoutStatus = "pending" | "sending" | "held" | "dry_run" | "sent" | "failed";

export type GalleryPot = {
  id: string;
  status: PotStatus;
  mode: PotMode;
  rolloverLamports: number;
  createdAt: number;
  settledAt: number | null;
  settlement: PotSettlement | null;
};

export type GalleryEntry = {
  id: string;
  potId: string;
  wallet: string;
  status: EntryStatus;
  score: number | null;
  intentId: string;
  txSignature: string;
  roundId: string;
  tokenHash: string;
  seed: string;
  forfeitIndex: number;
  salt: string;
  commitment: string;
  createdAt: number;
  expiresAt: number;
  submittedAt: number | null;
  result: RoundEvaluation | null;
};

export type GalleryIntent = {
  id: string;
  wallet: string;
  expiresAt: number;
  usedAt: number | null;
  txSignature: string | null;
};

export type GalleryPayout = {
  id: string;
  potId: string;
  wallet: string;
  lamports: number;
  status: PayoutStatus;
  txSignature: string | null;
  error: string | null;
  lastValidBlockHeight?: number | null;
  createdAt: number;
  updatedAt: number;
};

export type EnterRecord = {
  entry: Omit<GalleryEntry, "status" | "score" | "submittedAt" | "result"> & {
    status?: EntryStatus;
  };
};

export interface GalleryStore {
  kind: "memory" | "postgres";
  markStoryComplete(wallet: string, at: number): Promise<void>;
  hasStoryComplete(wallet: string): Promise<boolean>;
  createIntent(intent: GalleryIntent): Promise<void>;
  getIntent(id: string): Promise<GalleryIntent | null>;
  paymentUsed(signature: string): Promise<boolean>;
  getEntryByPayment(signature: string): Promise<GalleryEntry | null>;
  rotateEntryToken(input: { entryId: string; tokenHash: string }): Promise<GalleryEntry | null>;
  enter(input: {
    intentId: string;
    wallet: string;
    txSignature: string;
    now: number;
    /** When the entry was paid (on-chain block time). Defaults to now. */
    paidAt?: number;
    mode: PotMode;
    entry: GalleryEntry;
  }): Promise<{ pot: GalleryPot; entry: GalleryEntry }>;
  getOpenPot(mode: PotMode): Promise<GalleryPot | null>;
  getPot(id: string): Promise<GalleryPot | null>;
  listEntries(potId: string): Promise<GalleryEntry[]>;
  getEntryByTokenHash(tokenHash: string): Promise<GalleryEntry | null>;
  getActiveEntry(wallet: string): Promise<GalleryEntry | null>;
  expireStale(now: number): Promise<GalleryEntry[]>;
  completeEntry(input: {
    tokenHash: string;
    status: "scored" | "forfeit";
    score: number | null;
    result: RoundEvaluation;
    now: number;
  }): Promise<GalleryEntry | null>;
  settlePot(input: {
    potId: string;
    settlement: PotSettlement;
    now: number;
    nextPot: GalleryPot;
    payouts: GalleryPayout[];
  }): Promise<{ pot: GalleryPot; next: GalleryPot } | null>;
  listOpenPayouts(): Promise<GalleryPayout[]>;
  updatePayout(input: {
    id: string;
    status: PayoutStatus;
    txSignature?: string | null;
    error?: string | null;
    lastValidBlockHeight?: number | null;
    now: number;
    expected?: PayoutStatus[];
  }): Promise<GalleryPayout | null>;
  getPayouts(potId: string): Promise<GalleryPayout[]>;
  close(): Promise<void>;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class MemoryGalleryStore implements GalleryStore {
  kind = "memory" as const;
  private stories = new Map<string, number>();
  private intents = new Map<string, GalleryIntent>();
  private payments = new Set<string>();
  private pots = new Map<string, GalleryPot>();
  private entries = new Map<string, GalleryEntry>();
  private payouts = new Map<string, GalleryPayout>();

  async markStoryComplete(wallet: string, at: number) {
    if (!this.stories.has(wallet)) this.stories.set(wallet, at);
  }

  async hasStoryComplete(wallet: string) {
    return this.stories.has(wallet);
  }

  async createIntent(intent: GalleryIntent) {
    this.intents.set(intent.id, { ...intent });
  }

  async getIntent(id: string) {
    const intent = this.intents.get(id);
    return intent ? { ...intent } : null;
  }

  async paymentUsed(signature: string) {
    return this.payments.has(signature);
  }

  async getEntryByPayment(signature: string) {
    const entry = [...this.entries.values()].find((row) => row.txSignature === signature);
    return entry ? clone(entry) : null;
  }

  async rotateEntryToken(input: { entryId: string; tokenHash: string }) {
    const entry = this.entries.get(input.entryId);
    if (!entry || entry.status !== "playing") return null;
    entry.tokenHash = input.tokenHash;
    return clone(entry);
  }

  async enter(input: {
    intentId: string;
    wallet: string;
    txSignature: string;
    now: number;
    paidAt?: number;
    mode: PotMode;
    entry: GalleryEntry;
  }) {
    const intent = this.intents.get(input.intentId);
    if (!intent || intent.wallet !== input.wallet)
      throw new EnterError("Unknown entry intent");
    if (intent.usedAt != null) throw new EnterError("Entry intent already used");
    if (!intentStillRedeemable(intent.expiresAt, input.paidAt ?? input.now, input.now))
      throw new EnterError("Entry intent expired");
    if (this.payments.has(input.txSignature))
      throw new EnterError("Payment already used");
    let pot = [...this.pots.values()].find((row) => row.status === "open" && row.mode === input.mode);
    if (!pot) {
      pot = {
        id: input.entry.potId,
        status: "open",
        mode: input.mode,
        rolloverLamports: 0,
        createdAt: input.now,
        settledAt: null,
        settlement: null,
      };
      this.pots.set(pot.id, pot);
    }
    const already = [...this.entries.values()].some(
      (row) => row.potId === pot!.id && row.wallet === input.wallet,
    );
    if (already) throw new EnterError("This wallet is already in the current pot");
    const seated = [...this.entries.values()].filter((row) => row.potId === pot!.id).length;
    if (seated >= PLAYERS_PER_POT) throw new EnterError(POT_FULL);
    const playing = [...this.entries.values()].some(
      (row) => row.wallet === input.wallet && row.status === "playing" && row.expiresAt > input.now,
    );
    if (playing) throw new EnterError("This wallet already has an open round");
    intent.usedAt = input.now;
    intent.txSignature = input.txSignature;
    this.payments.add(input.txSignature);
    const entry = { ...input.entry, potId: pot.id };
    this.entries.set(entry.id, entry);
    return { pot: clone(pot), entry: clone(entry) };
  }

  async getOpenPot(mode: PotMode) {
    const pot = [...this.pots.values()].find((row) => row.status === "open" && row.mode === mode);
    return pot ? clone(pot) : null;
  }

  async getPot(id: string) {
    const pot = this.pots.get(id);
    return pot ? clone(pot) : null;
  }

  async listEntries(potId: string) {
    return [...this.entries.values()]
      .filter((row) => row.potId === potId)
      .sort((a, b) => a.createdAt - b.createdAt)
      .map(clone);
  }

  async getEntryByTokenHash(tokenHash: string) {
    const entry = [...this.entries.values()].find((row) => row.tokenHash === tokenHash);
    return entry ? clone(entry) : null;
  }

  async getActiveEntry(wallet: string) {
    const entry = [...this.entries.values()]
      .filter((row) => row.wallet === wallet && row.status === "playing")
      .sort((a, b) => b.createdAt - a.createdAt)[0];
    return entry ? clone(entry) : null;
  }

  async expireStale(now: number) {
    const expired: GalleryEntry[] = [];
    for (const entry of this.entries.values()) {
      if (entry.status === "playing" && entry.expiresAt <= now) {
        entry.status = "forfeit";
        entry.score = null;
        entry.submittedAt = now;
        expired.push(clone(entry));
      }
    }
    return expired;
  }

  async completeEntry(input: {
    tokenHash: string;
    status: "scored" | "forfeit";
    score: number | null;
    result: RoundEvaluation;
    now: number;
  }) {
    const entry = [...this.entries.values()].find((row) => row.tokenHash === input.tokenHash);
    if (!entry || entry.status !== "playing") return null;
    entry.status = input.status;
    entry.score = input.score;
    entry.result = input.result;
    entry.submittedAt = input.now;
    return clone(entry);
  }

  async settlePot(input: {
    potId: string;
    settlement: PotSettlement;
    now: number;
    nextPot: GalleryPot;
    payouts: GalleryPayout[];
  }) {
    const pot = this.pots.get(input.potId);
    if (!pot || pot.status !== "open") return null;
    const done = [...this.entries.values()].filter(
      (row) => row.potId === pot.id && row.status !== "playing",
    );
    if (done.length < PLAYERS_PER_POT) return null;
    pot.status = "settled";
    pot.settledAt = input.now;
    pot.settlement = input.settlement;
    this.pots.set(input.nextPot.id, { ...input.nextPot, mode: pot.mode });
    for (const payout of input.payouts) this.payouts.set(payout.id, { ...payout });
    return { pot: clone(pot), next: clone(this.pots.get(input.nextPot.id)!) };
  }

  async listOpenPayouts() {
    return [...this.payouts.values()]
      .filter((row) => OPEN_PAYOUT_STATUSES.includes(row.status))
      .sort((a, b) => a.createdAt - b.createdAt)
      .map(clone);
  }

  async updatePayout(input: {
    id: string;
    status: PayoutStatus;
    txSignature?: string | null;
    error?: string | null;
    lastValidBlockHeight?: number | null;
    now: number;
    expected?: PayoutStatus[];
  }) {
    const row = this.payouts.get(input.id);
    if (!row) return null;
    if (input.expected && !input.expected.includes(row.status)) return null;
    row.status = input.status;
    if (input.txSignature !== undefined) row.txSignature = input.txSignature;
    if (input.error !== undefined) row.error = input.error;
    if (input.lastValidBlockHeight !== undefined) row.lastValidBlockHeight = input.lastValidBlockHeight;
    row.updatedAt = input.now;
    return clone(row);
  }

  async getPayouts(potId: string) {
    return [...this.payouts.values()]
      .filter((row) => row.potId === potId)
      .map(clone);
  }

  async close() {
    this.stories.clear();
    this.intents.clear();
    this.payments.clear();
    this.pots.clear();
    this.entries.clear();
    this.payouts.clear();
  }
}

/** Payout rows the payout worker still has to resolve. */
export const OPEN_PAYOUT_STATUSES: PayoutStatus[] = ["pending", "sending", "held", "failed"];

/**
 * A paid entry can be redeemed after its intent's 15-minute window as long as
 * the payment itself landed inside the window. This keeps a cold start, a slow
 * RPC, or a closed tab from eating a real entry. Recovery stays open for 24h.
 */
export const ENTRY_RECOVERY_MS = 24 * 60 * 60 * 1000;
export function intentStillRedeemable(expiresAt: number, paidAt: number, now: number): boolean {
  if (paidAt > expiresAt) return false;
  return now <= expiresAt + ENTRY_RECOVERY_MS;
}

export const POT_FULL = "The pot is full. The last rounds finish within two minutes; try again then";

export class EnterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnterError";
  }
}

type PotRow = {
  id: string;
  status: PotStatus;
  mode?: PotMode | null;
  rollover_lamports: string | number;
  created_at: Date;
  settled_at: Date | null;
  settlement_json: string | null;
};

type EntryRow = {
  id: string;
  pot_id: string;
  wallet: string;
  status: EntryStatus;
  score: number | null;
  intent_id: string;
  tx_signature: string;
  round_id: string;
  token_hash: string;
  seed: string;
  forfeit_index: number;
  salt: string;
  commitment: string;
  created_at: Date;
  expires_at: Date;
  submitted_at: Date | null;
  result_json: string | null;
};

type IntentRow = {
  id: string;
  wallet: string;
  expires_at: Date;
  used_at: Date | null;
  tx_signature: string | null;
};

type PayoutRow = {
  id: string;
  pot_id: string;
  wallet: string;
  lamports: string | number;
  status: PayoutStatus;
  tx_signature: string | null;
  error: string | null;
  last_valid_block_height?: string | number | null;
  created_at: Date;
  updated_at: Date;
};

function num(value: string | number): number {
  return typeof value === "number" ? value : Number(value);
}

function mapPot(row: PotRow): GalleryPot {
  return {
    id: row.id,
    status: row.status,
    mode: row.mode === "live" ? "live" : "test",
    rolloverLamports: num(row.rollover_lamports),
    createdAt: row.created_at.getTime(),
    settledAt: row.settled_at ? row.settled_at.getTime() : null,
    settlement: row.settlement_json ? (JSON.parse(row.settlement_json) as PotSettlement) : null,
  };
}

function mapEntry(row: EntryRow): GalleryEntry {
  return {
    id: row.id,
    potId: row.pot_id,
    wallet: row.wallet,
    status: row.status,
    score: row.score,
    intentId: row.intent_id,
    txSignature: row.tx_signature,
    roundId: row.round_id,
    tokenHash: row.token_hash,
    seed: row.seed,
    forfeitIndex: row.forfeit_index,
    salt: row.salt,
    commitment: row.commitment,
    createdAt: row.created_at.getTime(),
    expiresAt: row.expires_at.getTime(),
    submittedAt: row.submitted_at ? row.submitted_at.getTime() : null,
    result: row.result_json ? (JSON.parse(row.result_json) as RoundEvaluation) : null,
  };
}

function mapIntent(row: IntentRow): GalleryIntent {
  return {
    id: row.id,
    wallet: row.wallet,
    expiresAt: row.expires_at.getTime(),
    usedAt: row.used_at ? row.used_at.getTime() : null,
    txSignature: row.tx_signature,
  };
}

function mapPayout(row: PayoutRow): GalleryPayout {
  return {
    id: row.id,
    potId: row.pot_id,
    wallet: row.wallet,
    lamports: num(row.lamports),
    status: row.status,
    txSignature: row.tx_signature,
    error: row.error,
    lastValidBlockHeight:
      row.last_valid_block_height == null ? null : num(row.last_valid_block_height),
    createdAt: row.created_at.getTime(),
    updatedAt: row.updated_at.getTime(),
  };
}

export class PostgresGalleryStore implements GalleryStore {
  kind = "postgres" as const;

  private sql: Sql;
  constructor(sql: Sql) {
    this.sql = sql;
  }

  async setup() {
    await this.sql`
      CREATE TABLE IF NOT EXISTS story_completions (
        wallet TEXT PRIMARY KEY,
        completed_at TIMESTAMPTZ NOT NULL
      )`;
    await this.sql`
      CREATE TABLE IF NOT EXISTS gallery_intents (
        id TEXT PRIMARY KEY,
        wallet TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        used_at TIMESTAMPTZ,
        tx_signature TEXT
      )`;
    await this.sql`
      CREATE TABLE IF NOT EXISTS gallery_payments (
        tx_signature TEXT PRIMARY KEY,
        wallet TEXT NOT NULL,
        intent_id TEXT NOT NULL,
        used_at TIMESTAMPTZ NOT NULL
      )`;
    await this.sql`
      CREATE TABLE IF NOT EXISTS gallery_pots (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        rollover_lamports BIGINT NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL,
        settled_at TIMESTAMPTZ,
        settlement_json TEXT
      )`;
    await this.sql`
      CREATE TABLE IF NOT EXISTS gallery_entries (
        id TEXT PRIMARY KEY,
        pot_id TEXT NOT NULL REFERENCES gallery_pots(id),
        wallet TEXT NOT NULL,
        status TEXT NOT NULL,
        score INTEGER,
        intent_id TEXT NOT NULL,
        tx_signature TEXT NOT NULL,
        round_id TEXT NOT NULL UNIQUE,
        token_hash TEXT NOT NULL UNIQUE,
        seed TEXT NOT NULL,
        forfeit_index INTEGER NOT NULL,
        salt TEXT NOT NULL,
        commitment TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        submitted_at TIMESTAMPTZ,
        result_json TEXT,
        UNIQUE (pot_id, wallet)
      )`;
    await this.sql`
      CREATE TABLE IF NOT EXISTS gallery_payouts (
        id TEXT PRIMARY KEY,
        pot_id TEXT NOT NULL,
        wallet TEXT NOT NULL,
        lamports BIGINT NOT NULL,
        status TEXT NOT NULL,
        tx_signature TEXT,
        error TEXT,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL,
        UNIQUE (pot_id, wallet)
      )`;
    // Pots created before pot modes existed were all dry-run pots. DEFAULT 'test'
    // classifies them as test pots so their fake rollover can never reach a live pot.
    await this.sql`ALTER TABLE gallery_pots ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'test'`;
    await this.sql`ALTER TABLE gallery_payouts ADD COLUMN IF NOT EXISTS last_valid_block_height BIGINT`;
    // Test pots never carry a rollover (no real SOL backs them). Clear any left over
    // from older builds that rolled dry-run forfeits forward.
    await this.sql`UPDATE gallery_pots SET rollover_lamports = 0 WHERE mode = 'test' AND status = 'open' AND rollover_lamports <> 0`;
    await this.sql`CREATE INDEX IF NOT EXISTS gallery_pots_open_idx ON gallery_pots (status)`;
    await this.sql`CREATE INDEX IF NOT EXISTS gallery_entries_tx_idx ON gallery_entries (tx_signature)`;
    try {
      // At most one open pot per mode, even if two first entries race.
      await this.sql`CREATE UNIQUE INDEX IF NOT EXISTS gallery_pots_one_open_per_mode ON gallery_pots (mode) WHERE status = 'open'`;
    } catch (error) {
      console.warn("gallery: could not add the one-open-pot index", error instanceof Error ? error.message : error);
    }
    await this.sql`CREATE INDEX IF NOT EXISTS gallery_entries_pot_idx ON gallery_entries (pot_id, created_at)`;
  }

  async markStoryComplete(wallet: string, at: number) {
    await this.sql`
      INSERT INTO story_completions (wallet, completed_at)
      VALUES (${wallet}, ${new Date(at)})
      ON CONFLICT (wallet) DO NOTHING`;
  }

  async hasStoryComplete(wallet: string) {
    const rows = await this.sql`SELECT wallet FROM story_completions WHERE wallet = ${wallet}`;
    return rows.length > 0;
  }

  async createIntent(intent: GalleryIntent) {
    await this.sql`
      INSERT INTO gallery_intents (id, wallet, expires_at, used_at, tx_signature)
      VALUES (${intent.id}, ${intent.wallet}, ${new Date(intent.expiresAt)}, ${intent.usedAt ? new Date(intent.usedAt) : null}, ${intent.txSignature})`;
  }

  async getIntent(id: string) {
    const rows = await this.sql<IntentRow[]>`SELECT * FROM gallery_intents WHERE id = ${id}`;
    return rows[0] ? mapIntent(rows[0]) : null;
  }

  async paymentUsed(signature: string) {
    const rows = await this.sql`SELECT tx_signature FROM gallery_payments WHERE tx_signature = ${signature}`;
    return rows.length > 0;
  }

  async getEntryByPayment(signature: string) {
    const rows = await this.sql<EntryRow[]>`
      SELECT * FROM gallery_entries WHERE tx_signature = ${signature} LIMIT 1`;
    return rows[0] ? mapEntry(rows[0]) : null;
  }

  async rotateEntryToken(input: { entryId: string; tokenHash: string }) {
    const rows = await this.sql<EntryRow[]>`
      UPDATE gallery_entries SET token_hash = ${input.tokenHash}
      WHERE id = ${input.entryId} AND status = 'playing'
      RETURNING *`;
    return rows[0] ? mapEntry(rows[0]) : null;
  }

  async enter(input: {
    intentId: string;
    wallet: string;
    txSignature: string;
    now: number;
    paidAt?: number;
    mode: PotMode;
    entry: GalleryEntry;
  }) {
    const paidAt = input.paidAt ?? input.now;
    try {
      return await this.sql.begin(async (sql) => {
        const intents = await sql<IntentRow[]>`
          UPDATE gallery_intents
          SET used_at = ${new Date(input.now)}, tx_signature = ${input.txSignature}
          WHERE id = ${input.intentId}
            AND wallet = ${input.wallet}
            AND used_at IS NULL
            AND expires_at >= ${new Date(paidAt)}
            AND expires_at >= ${new Date(input.now - ENTRY_RECOVERY_MS)}
          RETURNING *`;
        if (!intents[0]) throw new EnterError("Invalid or expired entry intent");
        try {
          await sql`
            INSERT INTO gallery_payments (tx_signature, wallet, intent_id, used_at)
            VALUES (${input.txSignature}, ${input.wallet}, ${input.intentId}, ${new Date(input.now)})`;
        } catch (error) {
          throw new EnterError("Payment already used");
        }
        let pots = await sql<PotRow[]>`
          SELECT * FROM gallery_pots WHERE status = 'open' AND mode = ${input.mode} FOR UPDATE`;
        if (!pots[0]) {
          const created = await sql<PotRow[]>`
            INSERT INTO gallery_pots (id, status, mode, rollover_lamports, created_at, settled_at, settlement_json)
            VALUES (${input.entry.potId}, 'open', ${input.mode}, 0, ${new Date(input.now)}, NULL, NULL)
            RETURNING *`;
          pots = created;
        }
        const pot = pots[0]!;
        const taken = await sql`
          SELECT id FROM gallery_entries WHERE pot_id = ${pot.id} AND wallet = ${input.wallet}`;
        if (taken.length) throw new EnterError("This wallet is already in the current pot");
        const seated = await sql`SELECT id FROM gallery_entries WHERE pot_id = ${pot.id}`;
        if (seated.length >= PLAYERS_PER_POT) throw new EnterError(POT_FULL);
        const playing = await sql`
          SELECT id FROM gallery_entries
          WHERE wallet = ${input.wallet} AND status = 'playing' AND expires_at > ${new Date(input.now)}`;
        if (playing.length) throw new EnterError("This wallet already has an open round");
        const entry = input.entry;
        const rows = await sql<EntryRow[]>`
          INSERT INTO gallery_entries (
            id, pot_id, wallet, status, score, intent_id, tx_signature, round_id, token_hash,
            seed, forfeit_index, salt, commitment, created_at, expires_at, submitted_at, result_json
          )
          VALUES (
            ${entry.id}, ${pot.id}, ${entry.wallet}, 'playing', NULL, ${entry.intentId}, ${entry.txSignature},
            ${entry.roundId}, ${entry.tokenHash}, ${entry.seed}, ${entry.forfeitIndex}, ${entry.salt},
            ${entry.commitment}, ${new Date(entry.createdAt)}, ${new Date(entry.expiresAt)}, NULL, NULL
          )
          RETURNING *`;
        return { pot: mapPot(pot), entry: mapEntry(rows[0]!) };
      });
    } catch (error) {
      if (error instanceof EnterError) throw error;
      const message = error instanceof Error ? error.message : "";
      if (/already used|duplicate|unique/i.test(message))
        throw new EnterError("Payment already used");
      throw error;
    }
  }

  async getOpenPot(mode: PotMode) {
    const rows = await this.sql<PotRow[]>`
      SELECT * FROM gallery_pots WHERE status = 'open' AND mode = ${mode} ORDER BY created_at ASC LIMIT 1`;
    return rows[0] ? mapPot(rows[0]) : null;
  }

  async getPot(id: string) {
    const rows = await this.sql<PotRow[]>`SELECT * FROM gallery_pots WHERE id = ${id}`;
    return rows[0] ? mapPot(rows[0]) : null;
  }

  async listEntries(potId: string) {
    const rows = await this.sql<EntryRow[]>`
      SELECT * FROM gallery_entries WHERE pot_id = ${potId} ORDER BY created_at ASC`;
    return rows.map(mapEntry);
  }

  async getEntryByTokenHash(tokenHash: string) {
    const rows = await this.sql<EntryRow[]>`SELECT * FROM gallery_entries WHERE token_hash = ${tokenHash}`;
    return rows[0] ? mapEntry(rows[0]) : null;
  }

  async getActiveEntry(wallet: string) {
    const rows = await this.sql<EntryRow[]>`
      SELECT * FROM gallery_entries
      WHERE wallet = ${wallet} AND status = 'playing'
      ORDER BY created_at DESC
      LIMIT 1`;
    return rows[0] ? mapEntry(rows[0]) : null;
  }

  async expireStale(now: number) {
    const rows = await this.sql<EntryRow[]>`
      UPDATE gallery_entries
      SET status = 'forfeit', score = NULL, submitted_at = ${new Date(now)}
      WHERE status = 'playing' AND expires_at <= ${new Date(now)}
      RETURNING *`;
    return rows.map(mapEntry);
  }

  async completeEntry(input: {
    tokenHash: string;
    status: "scored" | "forfeit";
    score: number | null;
    result: RoundEvaluation;
    now: number;
  }) {
    const rows = await this.sql<EntryRow[]>`
      UPDATE gallery_entries
      SET status = ${input.status},
          score = ${input.score},
          result_json = ${JSON.stringify(input.result)},
          submitted_at = ${new Date(input.now)}
      WHERE token_hash = ${input.tokenHash} AND status = 'playing'
      RETURNING *`;
    return rows[0] ? mapEntry(rows[0]) : null;
  }

  async settlePot(input: {
    potId: string;
    settlement: PotSettlement;
    now: number;
    nextPot: GalleryPot;
    payouts: GalleryPayout[];
  }) {
    return this.sql.begin(async (sql) => {
      const pots = await sql<PotRow[]>`
        SELECT * FROM gallery_pots WHERE id = ${input.potId} AND status = 'open' FOR UPDATE`;
      const pot = pots[0];
      if (!pot) return null;
      const done = await sql`
        SELECT id FROM gallery_entries WHERE pot_id = ${pot.id} AND status <> 'playing'`;
      if (done.length < PLAYERS_PER_POT) return null;
      const updated = await sql<PotRow[]>`
        UPDATE gallery_pots
        SET status = 'settled',
            settled_at = ${new Date(input.now)},
            settlement_json = ${JSON.stringify(input.settlement)}
        WHERE id = ${pot.id}
        RETURNING *`;
      const next = await sql<PotRow[]>`
        INSERT INTO gallery_pots (id, status, mode, rollover_lamports, created_at, settled_at, settlement_json)
        VALUES (${input.nextPot.id}, 'open', ${pot.mode === "live" ? "live" : "test"}, ${input.nextPot.rolloverLamports}, ${new Date(input.nextPot.createdAt)}, NULL, NULL)
        RETURNING *`;
      for (const payout of input.payouts) {
        await sql`
          INSERT INTO gallery_payouts (id, pot_id, wallet, lamports, status, tx_signature, error, created_at, updated_at)
          VALUES (
            ${payout.id}, ${payout.potId}, ${payout.wallet}, ${payout.lamports}, ${payout.status},
            ${payout.txSignature}, ${payout.error}, ${new Date(payout.createdAt)}, ${new Date(payout.updatedAt)}
          )
          ON CONFLICT (pot_id, wallet) DO NOTHING`;
      }
      return { pot: mapPot(updated[0]!), next: mapPot(next[0]!) };
    });
  }

  async listOpenPayouts() {
    const rows = await this.sql<PayoutRow[]>`
      SELECT * FROM gallery_payouts WHERE status = ANY(${OPEN_PAYOUT_STATUSES}) ORDER BY created_at ASC`;
    return rows.map(mapPayout);
  }

  async updatePayout(input: {
    id: string;
    status: PayoutStatus;
    txSignature?: string | null;
    error?: string | null;
    lastValidBlockHeight?: number | null;
    now: number;
    expected?: PayoutStatus[];
  }) {
    const expected = input.expected ?? ["pending", "failed", "dry_run"];
    const clearSignature = input.txSignature === null;
    const rows = await this.sql<PayoutRow[]>`
      UPDATE gallery_payouts
      SET status = ${input.status},
          tx_signature = CASE WHEN ${clearSignature} THEN NULL ELSE COALESCE(${input.txSignature ?? null}, tx_signature) END,
          last_valid_block_height = CASE WHEN ${input.lastValidBlockHeight !== undefined} THEN ${input.lastValidBlockHeight ?? null}::bigint ELSE last_valid_block_height END,
          error = ${input.error ?? null},
          updated_at = ${new Date(input.now)}
      WHERE id = ${input.id} AND status = ANY(${expected})
      RETURNING *`;
    return rows[0] ? mapPayout(rows[0]) : null;
  }

  async getPayouts(potId: string) {
    const rows = await this.sql<PayoutRow[]>`SELECT * FROM gallery_payouts WHERE pot_id = ${potId}`;
    return rows.map(mapPayout);
  }

  async close() {
    await this.sql.end({ timeout: 2 });
  }
}

export { ENTRY_LAMPORTS };
