import {
  type Account,
  type Auth,
  BUDGETS,
  type BudgetKind,
  type Delivery,
  type KeyValue,
} from '@promptfall/protocol'
import {
  type GameState,
  type Goods,
  hashState,
  replay,
  type ServerEvent,
  SIM_VERSION,
  step,
} from '@promptfall/sim'
import { isBlocked } from './blocklist'

export type BatchRecord = { batchId: string; hash: string; seq: number }
export type LogEntry = { n: number; event: ServerEvent }
export type PendingReturn = { listingId: string; goods: Goods }

/** Everything the ledger knows about one account, written in one `set`. */
export type AccountRecord = {
  account: Account
  /** The effective state: every server event is applied the moment it is authored. */
  state: GameState
  seq: number
  /** Per bucket, the time its refill has been counted up to. */
  refillAt: Record<BudgetKind, number>
  buckets: Record<BudgetKind, number>
  /** Ring of committed batch ids. */
  batches: BatchRecord[]
  /** Last server event id issued to this account. */
  cursor: number
  committedCursor: number
  /** The state at `committedCursor`: what the client's next `baseHash` is checked against. */
  committedState: GameState
  committedHash: string
  /** Every event with `n > committedCursor`. */
  log: LogEntry[]
  returns: PendingReturn[]
  /** The chat token bucket; absent means full. */
  chat?: { tokens: number; refillAt: number }
}

export const BATCH_RING = 200
export const LOG_CAP = 500
export const KINDS = Object.keys(BUDGETS) as BudgetKind[]

export const recordKey = (accountId: string) => `pf:acct:${accountId}:record`
export const tokenKey = (token: string) => `pf:token:${token}`
export const linkKey = (code: string) => `pf:link:${code}`
export const RETURNS_KEY = 'pf:returns'

export function everyKind(value: number): Record<BudgetKind, number> {
  const out = {} as Record<BudgetKind, number>
  for (const kind of KINDS) out[kind] = value
  return out
}

export function fullBuckets(): Record<BudgetKind, number> {
  const out = {} as Record<BudgetKind, number>
  for (const kind of KINDS) out[kind] = BUDGETS[kind].capacity
  return out
}

/** True for a record written by this sim version; older records carry none of the phase 2 fields. */
export function isCurrent(record: AccountRecord): boolean {
  return record.state.v === SIM_VERSION
}

/**
 * The name others see: the display name without control characters, else
 * `adventurer` when there is none, nothing is left, or it is blocklisted.
 */
export function publicName(record: AccountRecord): string {
  const raw = record.account.displayName ?? record.account.linked?.login ?? null
  if (raw === null) return 'adventurer'
  const name = raw.replace(/\p{Cc}/gu, '')
  if (name.trim() === '' || isBlocked(name)) return 'adventurer'
  return name
}

export function newRecord(account: Account, state: GameState, now: number): AccountRecord {
  return {
    account,
    state,
    seq: 0,
    refillAt: everyKind(now),
    buckets: fullBuckets(),
    batches: [],
    cursor: 0,
    committedCursor: 0,
    committedState: state,
    committedHash: hashState(state),
    log: [],
    returns: [],
  }
}

export function deliveryOf(record: AccountRecord): Delivery {
  if (!isCurrent(record)) return { cursor: 0, events: [] }
  return { cursor: record.cursor, events: record.log.map((e) => ({ ...e })) }
}

/** Moves the committed point to the effective state and empties the log. */
export function settle(record: AccountRecord): void {
  record.committedState = record.state
  record.committedCursor = record.cursor
  record.committedHash = hashState(record.state)
  record.log = []
}

/**
 * Authors a server event: the next `n`, applied to the effective state at
 * once. Throws, before anything is written, if the sim refuses it.
 */
export function author(record: AccountRecord, event: ServerEvent): void {
  const refused = tryAuthor(record, event)
  if (refused !== null) throw new Error(`ledger authored an unapplicable event: ${refused}`)
}

/** `author` for an event the sim may refuse: the refusal's reason, with the record untouched, or null once authored. */
export function tryAuthor(record: AccountRecord, event: ServerEvent): string | null {
  const r = step(record.state, event)
  const refused = r.effects.find((e) => e.k === 'rejected')
  if (refused?.k === 'rejected') return refused.reason
  record.state = r.state
  record.cursor += 1
  record.log.push({ n: record.cursor, event })
  // A log past its cap folds its oldest entries into the committed point; a
  // client behind that point can no longer catch up and is handed the state.
  while (record.log.length > LOG_CAP) {
    const oldest = record.log.shift()
    if (!oldest) break
    record.committedState = replay(record.committedState, [oldest.event]).state
    record.committedCursor = oldest.n
    record.committedHash = hashState(record.committedState)
  }
  return null
}

/** Whether goods of this kind fit in the effective state. */
export function hasRoom(state: GameState, goods: Goods): boolean {
  return goods.kind === 'item'
    ? state.inventory.length < state.inventoryCap
    : state.roster.length < state.rosterCap
}

/** A KeyValue view that remembers whether anything was written, so a run flushes only when it wrote. */
export class TrackedKeyValue implements KeyValue {
  dirty = false
  constructor(private readonly inner: KeyValue) {}

  get(key: string): Promise<unknown> {
    return this.inner.get(key)
  }

  set(key: string, value: unknown): Promise<void> {
    this.dirty = true
    return this.inner.set(key, value)
  }

  delete(key: string): Promise<void> {
    this.dirty = true
    return this.inner.delete(key)
  }

  async flush(): Promise<void> {
    if (!this.dirty) return
    await this.inner.flush?.()
    // Only a flush that landed is done: a failed one is retried by the next operation.
    this.dirty = false
  }
}

/** Record and token access over the tracked store. */
export class Books {
  constructor(readonly kv: TrackedKeyValue) {}

  async load(accountId: string): Promise<AccountRecord | null> {
    const raw = await this.kv.get(recordKey(accountId))
    return raw ? (raw as AccountRecord) : null
  }

  async save(record: AccountRecord): Promise<void> {
    await this.kv.set(recordKey(record.account.accountId), record)
  }

  async accountFor(token: string): Promise<string | null> {
    const raw = await this.kv.get(tokenKey(token))
    return typeof raw === 'string' ? raw : null
  }

  async authenticate(auth: Auth): Promise<AccountRecord | null> {
    const accountId = await this.accountFor(auth.deviceToken)
    return accountId ? this.load(accountId) : null
  }

  async returnsQueue(): Promise<string[]> {
    const raw = await this.kv.get(RETURNS_KEY)
    return Array.isArray(raw) ? (raw as string[]) : []
  }

  /** Keeps `pf:returns` in step with the record's `returns`. Call before saving the record. */
  async syncReturnsQueue(record: AccountRecord): Promise<void> {
    const queue = await this.returnsQueue()
    const id = record.account.accountId
    const listed = queue.includes(id)
    const waiting = record.returns.length > 0
    if (waiting && !listed) await this.kv.set(RETURNS_KEY, [...queue, id])
    if (!waiting && listed)
      await this.kv.set(
        RETURNS_KEY,
        queue.filter((q) => q !== id),
      )
  }

  /**
   * Delivers waiting returns where a slot is free, oldest first. An entry
   * without a slot is skipped and does not block the next kind. Mutates the
   * record; the caller saves it.
   */
  async deliverReturns(record: AccountRecord): Promise<void> {
    if (!isCurrent(record) || record.returns.length === 0) return
    const kept: PendingReturn[] = []
    for (const entry of record.returns) {
      if (hasRoom(record.state, entry.goods)) {
        author(record, { t: 'returned', listingId: entry.listingId, goods: entry.goods })
      } else {
        kept.push(entry)
      }
    }
    record.returns = kept
    await this.syncReturnsQueue(record)
  }
}
