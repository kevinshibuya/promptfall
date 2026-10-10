import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { backup, DatabaseSync, type StatementSync } from 'node:sqlite'
import type { ClockSnapshot } from './clock'
import type { HostStore } from './store'

/** The clock's row: outside the ledger's `pf:` keys. */
const CLOCK_KEY = 'host:clock'

/**
 * A KeyValue over one SQLite file: one table of key and JSON value, WAL on.
 * `get`, `set` and `delete` work on a write buffer that reads see first;
 * `flush()` commits the buffer as one transaction, so one ledger operation
 * is one durable write. Every flush also writes the clock snapshot to its row.
 */
export class SqliteKeyValue implements HostStore {
  private readonly db: DatabaseSync
  /** Writes since the last flush; null is a delete. */
  private readonly buffer = new Map<string, string | null>()
  /** The clock stored in the file when it was opened, or null. */
  readonly persistedClock: ClockSnapshot | null
  private clock: (() => ClockSnapshot) | null = null
  private readonly select: StatementSync
  private readonly put: StatementSync
  private readonly drop: StatementSync

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true })
    this.db = new DatabaseSync(path)
    this.db.exec('PRAGMA journal_mode = WAL')
    this.db.exec('PRAGMA synchronous = FULL')
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID',
    )
    this.select = this.db.prepare('SELECT value FROM kv WHERE key = ?')
    this.put = this.db.prepare('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)')
    this.drop = this.db.prepare('DELETE FROM kv WHERE key = ?')
    const clock = this.read(CLOCK_KEY)
    this.persistedClock = clock === undefined ? null : (JSON.parse(clock) as ClockSnapshot)
  }

  /** The clock snapshot written with every flush. */
  attachClock(snapshot: () => ClockSnapshot): void {
    this.clock = snapshot
  }

  async get(key: string): Promise<unknown> {
    const raw = this.buffer.has(key) ? this.buffer.get(key) : this.read(key)
    return raw == null ? undefined : JSON.parse(raw)
  }

  async set(key: string, value: unknown): Promise<void> {
    // `undefined` has no JSON: stored as a delete, as a read of it answers.
    this.buffer.set(key, JSON.stringify(value) ?? null)
  }

  async delete(key: string): Promise<void> {
    this.buffer.set(key, null)
  }

  async flush(): Promise<void> {
    this.flushSync()
  }

  flushSync(): void {
    if (this.buffer.size === 0 && this.clock === null) return
    // A failed flush writes nothing and keeps the buffer, so the next one retries it whole.
    this.db.exec('BEGIN IMMEDIATE')
    try {
      for (const [key, raw] of this.buffer) {
        if (raw === null) this.drop.run(key)
        else this.put.run(key, raw)
      }
      if (this.clock) this.put.run(CLOCK_KEY, JSON.stringify(this.clock()))
      this.db.exec('COMMIT')
    } catch (error) {
      if (this.db.isTransaction) this.db.exec('ROLLBACK')
      throw error
    }
    this.buffer.clear()
  }

  /** Writes a consistent copy of the committed file to `path` with the online backup API. */
  async backup(path: string): Promise<void> {
    mkdirSync(dirname(path), { recursive: true })
    await backup(this.db, path)
  }

  close(): void {
    this.db.close()
  }

  private read(key: string): string | undefined {
    const row = this.select.get(key) as { value: string } | undefined
    return row?.value
  }
}
