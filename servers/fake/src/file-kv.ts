import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { KeyValue } from '@promptfall/protocol'
import type { ClockSnapshot } from './clock'

/** The snapshot file: the whole KeyValue plus the clock it was written at. */
export type Snapshot = { clock: ClockSnapshot | null; kv: Record<string, unknown> }

/**
 * A KeyValue held in memory and written to one JSON file on `flush()`: write
 * `<path>.tmp`, then rename, so one ledger operation is one durable write.
 */
export class FileKeyValue implements KeyValue {
  private readonly data = new Map<string, string>()
  /** The clock stored in the file when it was loaded, or null. */
  readonly persistedClock: ClockSnapshot | null
  private clock: (() => ClockSnapshot) | null = null

  constructor(private readonly path: string) {
    let clock: ClockSnapshot | null = null
    if (existsSync(path)) {
      const snapshot = JSON.parse(readFileSync(path, 'utf8')) as Snapshot
      clock = snapshot.clock ?? null
      for (const [key, value] of Object.entries(snapshot.kv ?? {})) {
        this.data.set(key, JSON.stringify(value))
      }
    }
    this.persistedClock = clock
  }

  /** The clock snapshot written with every flush. */
  attachClock(snapshot: () => ClockSnapshot): void {
    this.clock = snapshot
  }

  async get(key: string): Promise<unknown> {
    const raw = this.data.get(key)
    return raw === undefined ? undefined : JSON.parse(raw)
  }

  async set(key: string, value: unknown): Promise<void> {
    this.data.set(key, JSON.stringify(value))
  }

  async delete(key: string): Promise<void> {
    this.data.delete(key)
  }

  keys(): string[] {
    return [...this.data.keys()]
  }

  async flush(): Promise<void> {
    this.flushSync()
  }

  flushSync(): void {
    const kv: Record<string, unknown> = {}
    for (const [key, raw] of this.data) kv[key] = JSON.parse(raw)
    const snapshot: Snapshot = { clock: this.clock?.() ?? null, kv }
    mkdirSync(dirname(this.path), { recursive: true })
    const tmp = `${this.path}.tmp`
    writeFileSync(tmp, JSON.stringify(snapshot))
    renameSync(tmp, this.path)
  }
}
