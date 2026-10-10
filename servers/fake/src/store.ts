import type { KeyValue } from '@promptfall/protocol'
import type { ClockSnapshot } from './clock'

/**
 * What the host needs of its store beyond the ledger's KeyValue: the clock it
 * persists with every flush, and a synchronous flush and close for startup and
 * shutdown. The JSON file store and the SQLite store both implement it.
 */
export interface HostStore extends KeyValue {
  /** The clock stored when the store was opened, or null. */
  readonly persistedClock: ClockSnapshot | null
  attachClock(snapshot: () => ClockSnapshot): void
  flush(): Promise<void>
  flushSync(): void
  close(): void
}
