import {
  type AccountInfo,
  type AdoptReason,
  type Auth,
  type BatchAck,
  BatchSchema,
  type Bootstrap,
  BUDGETS,
  type BudgetKind,
  compareSemver,
  type KeyValue,
  type LinkPoll,
  type LinkStart,
  type ListingPage,
  type ListingQuery,
  type MarketResult,
  type MyOrders,
  type NewOrder,
  type Order,
  type ServerClient,
  type ServerConfig,
  type Unauthorized,
} from '@promptfall/protocol'
import {
  createInitialState,
  type GameState,
  hashState,
  type PlayerEvent,
  type PlayerEventKind,
  replay,
  SIM_VERSION,
  type TradeKind,
} from '@promptfall/sim'
import {
  type AccountRecord,
  author,
  BATCH_RING,
  Books,
  deliveryOf,
  isCurrent,
  KINDS,
  linkKey,
  newRecord,
  settle,
  TrackedKeyValue,
  tokenKey,
} from './books'
import * as market from './market'

export type LedgerFlag = 'market.enabled' | 'chat.enabled' | 'worldboss.enabled' | 'maintenance'

export type LedgerOptions = {
  kv: KeyValue
  now: () => Promise<number>
  /** Reported in ServerConfig; default 1. */
  speed?: number
  minClientVersion: string
  seedSource: () => number
  /** Device tokens, account ids and link codes. */
  tokenSource: () => string
  flags?: Partial<Record<LedgerFlag, boolean>>
  /** Links approve on the first poll with this login (the fakes). Phase 5 replaces it with GitHub. */
  linkApprover: (code: string) => Promise<{ login: string } | null>
}

export type LedgerHost = {
  /** Mints an account with a given state and name (bots, tests). */
  mint(input: {
    state: GameState
    name: string
    linked: boolean
  }): Promise<{ accountId: string; deviceToken: string }>
  /** Authors a `credited` server event (bot stipends; phase 5 admin). */
  credit(accountId: string, gold: number, reason: string): Promise<void>
  /** Folds the log into the committed state for an account that never batches (bots). */
  settle(accountId: string): Promise<void>
  /** Expires listings and orders past `expiresAt` and delivers returns where a slot is free. */
  sweep(): Promise<void>
}

export const LINK_URL = 'https://github.com/login/device'
export const LINK_INTERVAL_MS = 5000

type Link = { accountId: string; createdAt: number }

const unauthorized: Unauthorized = { reason: 'unauthorized' }
const refusedUnauthorized: MarketResult = { ok: false, reason: 'unauthorized' }

/**
 * The account ledger: records, batch replay, server events and the market.
 * Every operation, `host` included, runs through one in-process mutex and
 * ends with one `flush` of whatever it wrote.
 */
export class Ledger implements ServerClient {
  readonly host: LedgerHost
  private readonly kv: TrackedKeyValue
  private readonly books: Books
  private chain: Promise<unknown> = Promise.resolve()

  constructor(private readonly options: LedgerOptions) {
    this.kv = new TrackedKeyValue(options.kv)
    this.books = new Books(this.kv)
    this.host = {
      mint: (input) => this.run(() => this.mint(input)),
      credit: (accountId, gold, reason) => this.run(() => this.credit(accountId, gold, reason)),
      settle: (accountId) => this.run(() => this.settleAccount(accountId)),
      sweep: () => this.run(() => this.sweep()),
    }
  }

  private run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(async () => {
      try {
        return await fn()
      } finally {
        await this.kv.flush()
      }
    })
    this.chain = next.catch(() => undefined)
    return next
  }

  private flags(): Record<string, boolean> {
    return { 'market.enabled': true, ...this.options.flags }
  }

  private async config(): Promise<ServerConfig> {
    return {
      minClientVersion: this.options.minClientVersion,
      simVersion: SIM_VERSION,
      flags: this.flags(),
      serverNow: await this.options.now(),
      speed: this.options.speed ?? 1,
    }
  }

  private async marketContext(): Promise<market.MarketContext> {
    return { books: this.books, now: await this.options.now(), flags: this.flags() }
  }

  // ---------------------------------------------------------------------------
  // Accounts

  bootstrap(input: { clientVersion: string; deviceToken: string | null }): Promise<Bootstrap> {
    return this.run(async () => {
      if (input.deviceToken) {
        // A known token writes nothing: a secondary session bootstraps every few seconds.
        const record = await this.books.authenticate({ deviceToken: input.deviceToken })
        if (record) return this.bootFor(input.deviceToken, record)
      }
      const now = await this.options.now()
      const seed = this.options.seedSource() >>> 0
      const deviceToken = this.options.tokenSource()
      const accountId = this.options.tokenSource()
      const record = newRecord(
        { accountId, seed, createdAt: now, displayName: null, linked: null },
        createInitialState(seed),
        now,
      )
      await this.books.save(record)
      await this.kv.set(tokenKey(deviceToken), accountId)
      return this.bootFor(deviceToken, record)
    })
  }

  private async bootFor(deviceToken: string, record: AccountRecord): Promise<Bootstrap> {
    const config = await this.config()
    if (!isCurrent(record)) {
      return {
        deviceToken,
        account: record.account,
        config,
        state: record.state,
        seq: record.seq,
        hash: hashState(record.state),
        cursor: 0,
        delivery: { cursor: 0, events: [] },
      }
    }
    return {
      deviceToken,
      account: record.account,
      config,
      state: record.committedState,
      seq: record.seq,
      hash: record.committedHash,
      cursor: record.committedCursor,
      delivery: deliveryOf(record),
    }
  }

  account(auth: Auth): Promise<AccountInfo | Unauthorized> {
    return this.run(async () => {
      const record = await this.books.authenticate(auth)
      if (!record) return unauthorized
      return {
        account: record.account,
        returns: isCurrent(record) ? record.returns.length : 0,
        config: await this.config(),
        delivery: deliveryOf(record),
      }
    })
  }

  // ---------------------------------------------------------------------------
  // Batches

  submit(input: Parameters<ServerClient['submit']>[0], auth: Auth): Promise<BatchAck> {
    return this.run(async () => {
      // 0. Schema: throws a ZodError.
      const batch = BatchSchema.parse(input)

      // 3. Authentication.
      const owner = await this.books.accountFor(auth.deviceToken)
      if (!owner || owner !== batch.accountId) return { ok: false, reason: 'unauthorized' }
      const record = await this.books.load(owner)
      if (!record) return { ok: false, reason: 'unauthorized' }

      // 4. Versions.
      const { minClientVersion } = this.options
      if (compareSemver(batch.clientVersion, minClientVersion) < 0) {
        return { ok: false, reason: 'version_gate', minClientVersion }
      }
      if (batch.simVersion !== SIM_VERSION || !isCurrent(record)) {
        return { ok: false, reason: 'sim_version', simVersion: SIM_VERSION }
      }

      // 5. Duplicates.
      const seen = record.batches.find((c) => c.batchId === batch.batchId)
      if (seen) {
        return {
          ok: true,
          duplicate: true,
          seq: seen.seq,
          hash: seen.hash,
          delivery: deliveryOf(record),
        }
      }

      // 6. Sequence.
      if (batch.seq !== record.seq) return this.adopt(record, 'seq_mismatch')

      // 6a. Cursor. Ahead of the log, or behind what the log still holds: adopt.
      if (batch.cursor > record.cursor || batch.cursor < record.committedCursor) {
        return this.adopt(record, 'cursor_mismatch')
      }
      if (batch.cursor < record.cursor) {
        return { ok: false, reason: 'cursor_behind', delivery: deliveryOf(record) }
      }

      // 7. Base hash, against the committed point.
      if (batch.baseHash !== record.committedHash) return this.adopt(record, 'hash_mismatch')

      // 8. Budgets on the server's clock.
      const now = await this.options.now()
      // Each bucket's clock advances by whole refill periods only, so the
      // remainder carries over and a steady honest cadence never drains it.
      const buckets = {} as Record<BudgetKind, number>
      const refillAt = {} as Record<BudgetKind, number>
      for (const kind of KINDS) {
        const { refillMs, capacity } = BUDGETS[kind]
        const n = Math.floor(Math.max(0, now - record.refillAt[kind]) / refillMs)
        buckets[kind] = Math.min(capacity, record.buckets[kind] + n)
        refillAt[kind] = record.refillAt[kind] + n * refillMs
      }
      const counts = {} as Record<BudgetKind, number>
      for (const kind of KINDS) counts[kind] = 0
      for (const e of batch.events) if (e.t in counts) counts[e.t as BudgetKind] += 1
      for (const kind of KINDS) {
        if (counts[kind] > buckets[kind]) return this.adopt(record, 'rate_capped', kind)
      }

      // 9. Replay the player events on the effective state, which already
      // holds every server event up to the batch's cursor.
      const events: PlayerEvent[] = batch.events.map(
        ({ at: _at, ...event }) => event as PlayerEvent,
      )
      const result = replay(record.state, events).state
      const hash = hashState(result)
      const seq = record.seq + 1
      for (const kind of KINDS) buckets[kind] -= counts[kind]
      record.state = result
      record.seq = seq
      record.refillAt = refillAt
      record.buckets = buckets
      record.batches = [...record.batches, { batchId: batch.batchId, hash, seq }].slice(-BATCH_RING)
      settle(record)
      await this.books.deliverReturns(record)
      if (hash === batch.resultHash) {
        await this.books.save(record)
        return { ok: true, duplicate: false, seq, hash, delivery: deliveryOf(record) }
      }
      settle(record)
      await this.books.save(record)
      return {
        ok: false,
        reason: 'hash_mismatch',
        seq,
        state: record.state,
        hash: record.committedHash,
        cursor: record.cursor,
        revokedItemIds: [],
      }
    })
  }

  /** A state-carrying refusal: the client adopts the effective state, so the committed point moves there. */
  private async adopt(
    record: AccountRecord,
    reason: AdoptReason,
    kind?: PlayerEventKind,
  ): Promise<BatchAck> {
    settle(record)
    await this.books.save(record)
    const common = {
      ok: false as const,
      seq: record.seq,
      state: record.state,
      hash: record.committedHash,
      cursor: record.cursor,
    }
    if (reason === 'hash_mismatch') return { ...common, reason, revokedItemIds: [] }
    if (reason === 'rate_capped' && kind) return { ...common, reason, kind }
    return { ...common, reason }
  }

  // ---------------------------------------------------------------------------
  // GitHub link (approved by `linkApprover` until phase 5)

  linkStart(auth: Auth): Promise<LinkStart | Unauthorized> {
    return this.run(async () => {
      const record = await this.books.authenticate(auth)
      if (!record) return unauthorized
      const code = this.linkCode()
      const link: Link = {
        accountId: record.account.accountId,
        createdAt: await this.options.now(),
      }
      await this.kv.set(linkKey(code), link)
      return { code, url: LINK_URL, intervalMs: LINK_INTERVAL_MS }
    })
  }

  linkPoll(auth: Auth, code: string): Promise<LinkPoll | Unauthorized> {
    return this.run(async () => {
      const record = await this.books.authenticate(auth)
      if (!record) return unauthorized
      const link = (await this.kv.get(linkKey(code))) as Link | undefined
      if (!link || link.accountId !== record.account.accountId) return { status: 'pending' }
      const approved = await this.options.linkApprover(code)
      if (!approved) return { status: 'pending' }
      record.account = {
        ...record.account,
        displayName: approved.login,
        linked: { provider: 'github', login: approved.login },
      }
      await this.books.save(record)
      await this.kv.delete(linkKey(code))
      return { status: 'linked', account: record.account }
    })
  }

  /** Eight uppercase letters and digits drawn from the token source. */
  private linkCode(): string {
    let code = ''
    for (let i = 0; i < 16 && code.length < 8; i++) {
      code += this.options
        .tokenSource()
        .replace(/[^0-9a-z]/gi, '')
        .toUpperCase()
    }
    if (code.length < 8) throw new Error('tokenSource gave no letters or digits')
    return code.slice(0, 8)
  }

  // ---------------------------------------------------------------------------
  // Market

  private marketRead<T>(
    auth: Auth,
    expire: boolean,
    fn: (ctx: market.MarketContext, record: AccountRecord) => Promise<T>,
  ): Promise<T | Unauthorized> {
    return this.run(async () => {
      const ctx = await this.marketContext()
      if (expire) await market.expireDue(ctx)
      const record = await this.books.authenticate(auth)
      if (!record || !isCurrent(record)) return unauthorized
      return fn(ctx, record)
    })
  }

  private marketWrite(
    auth: Auth,
    expire: boolean,
    fn: (ctx: market.MarketContext, record: AccountRecord) => Promise<MarketResult>,
  ): Promise<MarketResult> {
    return this.run(async () => {
      const ctx = await this.marketContext()
      if (expire) await market.expireDue(ctx)
      const record = await this.books.authenticate(auth)
      if (!record || !isCurrent(record)) return refusedUnauthorized
      return fn(ctx, record)
    })
  }

  browse(auth: Auth, query: ListingQuery): Promise<ListingPage | Unauthorized> {
    return this.marketRead(auth, true, (ctx, record) => market.browse(ctx, record, query))
  }

  list(auth: Auth, input: { kind: TradeKind; id: string; price: number }): Promise<MarketResult> {
    return this.marketWrite(auth, false, (ctx, record) => market.list(ctx, record, input))
  }

  cancelListing(auth: Auth, listingId: string): Promise<MarketResult> {
    return this.marketWrite(auth, true, (ctx, record) =>
      market.cancelListing(ctx, record, listingId),
    )
  }

  buy(auth: Auth, listingId: string): Promise<MarketResult> {
    return this.marketWrite(auth, true, (ctx, record) => market.buy(ctx, record, listingId))
  }

  myOrders(auth: Auth): Promise<MyOrders | Unauthorized> {
    return this.marketRead(auth, true, (ctx, record) => market.myOrders(ctx, record))
  }

  placeOrder(auth: Auth, input: NewOrder): Promise<MarketResult> {
    return this.marketWrite(auth, false, (ctx, record) => market.placeOrder(ctx, record, input))
  }

  cancelOrder(auth: Auth, orderId: string): Promise<MarketResult> {
    return this.marketWrite(auth, true, (ctx, record) => market.cancelOrder(ctx, record, orderId))
  }

  matchingOrders(auth: Auth, itemId: string): Promise<Order[] | Unauthorized> {
    return this.marketRead(auth, true, (ctx, record) => market.matchingOrders(ctx, record, itemId))
  }

  fillOrder(auth: Auth, orderId: string, itemId: string): Promise<MarketResult> {
    return this.marketWrite(auth, true, (ctx, record) =>
      market.fillOrder(ctx, record, orderId, itemId),
    )
  }

  // ---------------------------------------------------------------------------
  // Host privileges

  private async mint(input: {
    state: GameState
    name: string
    linked: boolean
  }): Promise<{ accountId: string; deviceToken: string }> {
    const now = await this.options.now()
    const accountId = this.options.tokenSource()
    const deviceToken = this.options.tokenSource()
    const record = newRecord(
      {
        accountId,
        seed: input.state.seed,
        createdAt: now,
        displayName: input.name,
        linked: input.linked ? { provider: 'github', login: input.name } : null,
      },
      input.state,
      now,
    )
    await this.books.save(record)
    await this.kv.set(tokenKey(deviceToken), accountId)
    return { accountId, deviceToken }
  }

  private async currentRecord(accountId: string): Promise<AccountRecord> {
    const record = await this.books.load(accountId)
    if (!record || !isCurrent(record)) throw new Error(`no current account ${accountId}`)
    return record
  }

  private async credit(accountId: string, gold: number, reason: string): Promise<void> {
    const record = await this.currentRecord(accountId)
    author(record, { t: 'credited', gold, reason })
    await this.books.save(record)
  }

  private async settleAccount(accountId: string): Promise<void> {
    const record = await this.currentRecord(accountId)
    settle(record)
    await this.books.save(record)
  }

  private async sweep(): Promise<void> {
    await market.expireDue(await this.marketContext())
    for (const accountId of await this.books.returnsQueue()) {
      const record = await this.books.load(accountId)
      if (!record) continue
      await this.books.deliverReturns(record)
      await this.books.save(record)
    }
  }
}
