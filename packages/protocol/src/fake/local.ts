import {
  createInitialState,
  type Event,
  type EventKind,
  type GameState,
  hashState,
  replay,
  SIM_VERSION,
} from '@promptfall/sim'
import {
  type Account,
  type Auth,
  type BatchAck,
  type Bootstrap,
  BUDGETS,
  type BudgetKind,
  type ServerClient,
  type ServerConfig,
} from '../client'
import type { KeyValue } from '../kv'
import { type Batch, BatchSchema, compareSemver } from '../schemas'

export type LocalServerOptions = {
  kv: KeyValue
  now: () => Promise<number>
  minClientVersion: string
  seedSource: () => number
  tokenSource: () => string
}

type Committed = { batchId: string; hash: string; seq: number }

/** Everything the fake knows about one account, written in one `set`. */
type AccountRecord = {
  account: Account
  state: GameState
  seq: number
  t0: number
  buckets: Record<BudgetKind, number>
  committed: Committed[]
}

const RING = 200
const KINDS = Object.keys(BUDGETS) as BudgetKind[]

const recordKey = (accountId: string) => `pf:acct:${accountId}:record`
const tokenKey = (token: string) => `pf:token:${token}`

function fullBuckets(): Record<BudgetKind, number> {
  const out = {} as Record<BudgetKind, number>
  for (const kind of KINDS) out[kind] = BUDGETS[kind].capacity
  return out
}

export class LocalServer implements ServerClient {
  constructor(private readonly options: LocalServerOptions) {}

  private config(): ServerConfig {
    return { minClientVersion: this.options.minClientVersion, simVersion: SIM_VERSION, flags: {} }
  }

  private async load(accountId: string): Promise<AccountRecord | null> {
    const raw = await this.options.kv.get(recordKey(accountId))
    return raw ? (raw as AccountRecord) : null
  }

  private async accountFor(token: string): Promise<string | null> {
    const raw = await this.options.kv.get(tokenKey(token))
    return typeof raw === 'string' ? raw : null
  }

  async bootstrap(input: {
    clientVersion: string
    deviceToken: string | null
  }): Promise<Bootstrap> {
    if (input.deviceToken) {
      const accountId = await this.accountFor(input.deviceToken)
      const record = accountId ? await this.load(accountId) : null
      if (record) {
        return {
          deviceToken: input.deviceToken,
          account: record.account,
          config: this.config(),
          state: record.state,
          seq: record.seq,
          hash: hashState(record.state),
        }
      }
    }
    const now = await this.options.now()
    const seed = this.options.seedSource() >>> 0
    const deviceToken = this.options.tokenSource()
    const accountId = this.options.tokenSource()
    const state = createInitialState(seed)
    const record: AccountRecord = {
      account: { accountId, seed, createdAt: now, displayName: null, linked: null },
      state,
      seq: 0,
      t0: now,
      buckets: fullBuckets(),
      committed: [],
    }
    await this.options.kv.set(recordKey(accountId), record)
    await this.options.kv.set(tokenKey(deviceToken), accountId)
    return {
      deviceToken,
      account: record.account,
      config: this.config(),
      state,
      seq: 0,
      hash: hashState(state),
    }
  }

  async submit(input: Batch, auth: Auth): Promise<BatchAck> {
    // 0. Schema: throws a ZodError.
    const batch = BatchSchema.parse(input)

    // 3. Authentication.
    const owner = await this.accountFor(auth.deviceToken)
    if (!owner || owner !== batch.accountId) return { ok: false, reason: 'unauthorized' }
    const record = await this.load(owner)
    if (!record) return { ok: false, reason: 'unauthorized' }

    // 4. Versions.
    if (compareSemver(batch.clientVersion, this.options.minClientVersion) < 0) {
      return { ok: false, reason: 'version_gate', minClientVersion: this.options.minClientVersion }
    }
    if (batch.simVersion !== SIM_VERSION) {
      return { ok: false, reason: 'sim_version', simVersion: SIM_VERSION }
    }

    // 5. Duplicates.
    const seen = record.committed.find((c) => c.batchId === batch.batchId)
    if (seen) return { ok: true, duplicate: true, seq: seen.seq, hash: seen.hash }

    const currentHash = hashState(record.state)

    // 6. Sequence.
    if (batch.seq !== record.seq) {
      return {
        ok: false,
        reason: 'seq_mismatch',
        seq: record.seq,
        state: record.state,
        hash: currentHash,
      }
    }

    // 7. Base hash.
    if (batch.baseHash !== currentHash) {
      return {
        ok: false,
        reason: 'hash_mismatch',
        seq: record.seq,
        state: record.state,
        hash: currentHash,
        revokedItemIds: [],
      }
    }

    // 8. Budgets on the server's clock.
    const now = await this.options.now()
    const elapsed = Math.max(0, now - record.t0)
    const buckets = {} as Record<BudgetKind, number>
    for (const kind of KINDS) {
      const { refillMs, capacity } = BUDGETS[kind]
      buckets[kind] = Math.min(capacity, record.buckets[kind] + Math.floor(elapsed / refillMs))
    }
    const counts = {} as Record<BudgetKind, number>
    for (const kind of KINDS) counts[kind] = 0
    for (const e of batch.events) if (e.t in counts) counts[e.t as BudgetKind] += 1
    for (const kind of KINDS) {
      if (counts[kind] > buckets[kind]) {
        return {
          ok: false,
          reason: 'rate_capped',
          seq: record.seq,
          state: record.state,
          hash: currentHash,
          kind: kind as EventKind,
        }
      }
    }

    // 9. Commit, in one write.
    const events: Event[] = batch.events.map(({ at: _at, ...event }) => event as Event)
    const result = replay(record.state, events).state
    const hash = hashState(result)
    const nextSeq = record.seq + 1
    for (const kind of KINDS) buckets[kind] -= counts[kind]
    const next: AccountRecord = {
      ...record,
      state: result,
      seq: nextSeq,
      t0: now,
      buckets,
      committed: [...record.committed, { batchId: batch.batchId, hash, seq: nextSeq }].slice(-RING),
    }
    await this.options.kv.set(recordKey(owner), next)
    if (hash === batch.resultHash) return { ok: true, duplicate: false, seq: nextSeq, hash }
    return {
      ok: false,
      reason: 'hash_mismatch',
      seq: nextSeq,
      state: result,
      hash,
      revokedItemIds: [],
    }
  }
}
