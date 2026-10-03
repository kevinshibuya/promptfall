import type { PluginState } from 'claude-code'
import type {
  Account,
  Auth,
  Batch,
  BatchAck,
  Delivery,
  KeyValue,
  ListingPage,
  ListingQuery,
  MarketResult,
  MyOrders,
  Order,
  ServerClient,
  ServerConfig,
  TimedEvent,
  Unauthorized,
} from './vendor/protocol.js'
import {
  type Effect,
  type GameState,
  hashState,
  type PlayerEvent,
  replay,
  type ServerEvent,
  SIM_VERSION,
  step,
} from './vendor/sim.js'
import { CLIENT_VERSION } from './version'
import { toAccountView, toGameView } from './view'

export type EnginePublish = (patch: Partial<PluginState['promptfall']>) => Promise<void>

export type EngineDeps = {
  client: ServerClient
  /** Holds the device token under `tokenKey`. */
  kv: KeyValue
  /** The store key of the device token; `deviceToken` for the in-process ledger. */
  tokenKey?: string
  /** The server's label in the view; `in-process` by default. */
  label?: string
  now: () => Promise<number>
  newBatchId: () => string
  /** Writes atoms; a closure over the session's `$`. */
  publish: EnginePublish
  onEffects: (effects: Effect[]) => void
  /** Shows a toast. Optional: tests leave it out. */
  toast?: (text: string) => void
  /** Runs `fn` once after `ms`: notices that clear themselves and outage retries. */
  after: (ms: number, fn: () => void) => void
  /** In [0, 1): the jitter of outage retries. */
  random: () => number
}

/** What the command and the dialog hold of a running game. */
export type GameHandle = {
  apply: (event: PlayerEvent, at: number) => void
  canApply: () => boolean
  setOff: (off: boolean) => Promise<void>
  /** The player is using this session: take the lease if another session holds it. */
  claim: () => Promise<void>
  settled: () => Promise<void>
  /** A market call after a flush, its delivery applied. Throws `not_primary` or `unreachable`. */
  trade: <R extends MarketResult>(fn: TradeCall<R>) => Promise<R>
  /** Flushes, then applies what `account()` delivers. Throws `unreachable` during an outage. */
  sync: () => Promise<void>
  /** Moves the machine to another server (`null`: the in-process ledger). */
  switchServer: (url: string | null) => Promise<{ label: string; old: string; dropped: number }>
  /** Starts the GitHub device flow; the session polls until it is approved. */
  link: () => Promise<void>
  /** Deletes this machine's Promptfall data but the lease, then starts over on the same server. */
  reset: () => Promise<void>
  /** Market reads: no flush first, reads need none. Throw `unreachable` or `not_started`. */
  market: {
    browse: (query: ListingQuery) => Promise<ListingPage | Unauthorized>
    myOrders: () => Promise<MyOrders | Unauthorized>
    matching: (itemId: string) => Promise<Order[] | Unauthorized>
  }
  /** The last server clock seen, for showing server deadlines as real time left. */
  clock: () => { serverNow: number; clientNow: number; speed: number } | null
}

export type TradeCall<R extends MarketResult> = (client: ServerClient, auth: Auth) => Promise<R>

type Sent = { batch: Batch; result: GameState }

export const UPDATE_NOTICE = 'Update Promptfall: /plugin update promptfall'
export const MISMATCH_NOTICE = 'Promptfall: account mismatch, delete the plugin store to reset'
export const OLD_VERSION_NOTICE =
  "Promptfall: this machine's data is from an older version, reset it in /promptfall account"
export const RETRYING_NOTICE = 'Promptfall: server unreachable, retrying'
export const UNREACHABLE_NOTICE = 'Promptfall: server unreachable'

/** How long the sim keeps ticking and buffering after the first failure. */
export const OUTAGE_BUFFER_MS = 120_000
const BACKOFF_BASE_MS = 1_000
const BACKOFF_CAP_MS = 30_000
/** Consecutive `cursor_behind` answers without the cursor moving before a resync. */
const STUCK_BEHIND = 5

function strip(event: TimedEvent): PlayerEvent {
  const { at: _at, ...rest } = event
  return rest as PlayerEvent
}

/**
 * Runs the sim locally and reconciles with the ledger. `local` always equals
 * `replay(committed, [...pending, ...sent.batch.events, ...buffer])`. Every
 * server call runs under one lock; publishing is queued so the atoms see
 * patches in order.
 */
export class GameEngine {
  private committed: GameState | null = null
  private local: GameState | null = null
  private cursor = 0
  private pending: ServerEvent[] = []
  private sent: Sent | null = null
  private buffer: TimedEvent[] = []
  private seq = 0
  private token: string | null = null
  private account: string | null = null
  private accountRecord: Account | null = null
  private stopped = false
  private paused: string | null = null
  private outage: { since: number; attempt: number; expired: boolean } | null = null
  private firstRun = false
  private returns = 0
  private config: ServerConfig | null = null
  private clockSeen: { serverNow: number; clientNow: number; speed: number } | null = null
  private chain: Promise<unknown> = Promise.resolve()
  private held = 0
  private queue: Promise<void> = Promise.resolve()
  private noticeGen = 0
  private outageGen = 0

  constructor(private readonly deps: EngineDeps) {}

  private get tokenKey(): string {
    return this.deps.tokenKey ?? 'deviceToken'
  }

  /** Runs `fn` under the lock: every server call goes through here. */
  private lock<T>(fn: () => Promise<T>): Promise<T> {
    this.held += 1
    const next = this.chain.then(fn).finally(() => {
      this.held -= 1
    })
    this.chain = next.catch(() => undefined)
    return next
  }

  // ---------------------------------------------------------------------------
  // Start and resync

  /** Bootstraps and takes the committed state; a thrown bootstrap enters the outage and retries. */
  start(): Promise<void> {
    return this.lock(() => this.doStart())
  }

  private async doStart(): Promise<void> {
    const stored = await this.deps.kv.get(this.tokenKey)
    const token = typeof stored === 'string' ? stored : null
    let boot: Awaited<ReturnType<ServerClient['bootstrap']>>
    try {
      boot = await this.deps.client.bootstrap({ clientVersion: CLIENT_VERSION, deviceToken: token })
    } catch {
      if (this.stopped) return
      await this.enterOutage('start')
      return
    }
    // Replaced (a reset or a switch) while the bootstrap was in flight: write nothing.
    if (this.stopped) return
    this.firstRun = boot.deviceToken !== token
    this.token = boot.deviceToken
    if (boot.deviceToken !== token) await this.deps.kv.set(this.tokenKey, boot.deviceToken)
    this.account = boot.account.accountId
    this.accountRecord = boot.account
    this.committed = boot.state
    this.local = boot.state
    this.cursor = boot.cursor
    this.seq = boot.seq
    this.pending = []
    this.sent = null
    this.buffer = []
    await this.rememberConfig(boot.config)
    this.clearOutage()
    if (boot.state.v !== SIM_VERSION) {
      this.paused = OLD_VERSION_NOTICE
      this.noticeGen += 1
      await this.publish({ view: null, mode: 'paused', notice: OLD_VERSION_NOTICE })
      return
    }
    if (this.paused !== null) {
      this.paused = null
      void this.publish({ mode: 'primary', notice: null })
    }
    this.receive(boot.delivery, false)
    await this.publish({ view: this.view() })
    // Only the minted account's first view says firstRun; every later view says no.
    this.firstRun = false
  }

  /** The server wins: a read-only bootstrap with the stored token, the buffer dropped. */
  private doResync(): Promise<void> {
    return this.doStart()
  }

  // ---------------------------------------------------------------------------
  // Player events

  /** Steps locally, buffers the event, publishes the view and hands the effects on. */
  apply(event: PlayerEvent, at: number): void {
    const local = this.local
    if (!local || this.paused !== null) return
    if (this.outage && at - this.outage.since >= OUTAGE_BUFFER_MS) return
    const r = step(local, event)
    this.local = r.state
    this.buffer.push({ ...event, at: Math.floor(at) } as TimedEvent)
    void this.publish({ view: this.view() })
    if (r.effects.length > 0) this.deps.onEffects(r.effects)
  }

  /** Whether `apply` takes events now: not paused, and not past the outage's buffer window. */
  accepting(): boolean {
    return this.local !== null && this.paused === null && !this.outage?.expired
  }

  // ---------------------------------------------------------------------------
  // Batches

  flush(): Promise<void> {
    return this.lock(() => this.doFlush())
  }

  /** The 15-second timer: skips while the lock is held or the server is unreachable. */
  async flushIfIdle(): Promise<void> {
    if (this.held > 0 || this.outage) return
    await this.flush()
  }

  private async doFlush(): Promise<void> {
    if (!this.local || !this.committed || !this.account || !this.token) return
    if (this.paused !== null) return
    if (!this.sent && this.buffer.length === 0) return
    if (!this.sent) {
      this.sent = { batch: this.build(), result: this.local }
      this.buffer = []
    }
    let stuck = 0
    for (;;) {
      const sent: Sent | null = this.sent
      if (!sent) return
      let ack: BatchAck
      try {
        ack = await this.deps.client.submit(sent.batch, { deviceToken: this.token })
      } catch {
        await this.enterOutage('flush')
        return
      }
      this.clearOutage()
      if (ack.ok) {
        if (ack.duplicate && ack.hash !== hashState(sent.result)) {
          await this.doResync()
          return
        }
        this.committed = sent.result
        this.pending = []
        this.seq = ack.seq
        this.sent = null
        this.receive(ack.delivery)
        return
      }
      if (ack.reason === 'cursor_behind') {
        const before = this.cursor
        this.receive(ack.delivery)
        stuck = this.cursor === before ? stuck + 1 : 0
        if (stuck >= STUCK_BEHIND) {
          await this.doResync()
          return
        }
        const result: GameState = this.sent?.result ?? sent.result
        this.sent = {
          batch: { ...sent.batch, cursor: this.cursor, resultHash: hashState(result) },
          result,
        }
        continue
      }
      this.handleRefusal(ack)
      return
    }
  }

  private build(): Batch {
    if (!this.committed || !this.local || !this.account) throw new Error('not started')
    return {
      batchId: this.deps.newBatchId(),
      accountId: this.account,
      seq: this.seq,
      clientVersion: CLIENT_VERSION,
      simVersion: SIM_VERSION,
      cursor: this.cursor,
      baseHash: hashState(this.committed),
      resultHash: hashState(this.local),
      events: this.buffer,
    }
  }

  private handleRefusal(ack: Exclude<BatchAck, { ok: true } | { reason: 'cursor_behind' }>): void {
    switch (ack.reason) {
      case 'seq_mismatch':
      case 'cursor_mismatch':
        this.adopt(ack)
        this.notice('Promptfall resynced', 10_000)
        return
      case 'rate_capped':
        this.adopt(ack)
        this.notice('Promptfall: progress capped, resynced', 10_000)
        return
      case 'hash_mismatch':
        this.adopt(ack)
        if ((ack.revokedItemIds ?? []).length > 0) this.deps.toast?.('An item was revoked')
        return
      case 'version_gate':
      case 'sim_version':
        this.setPaused(UPDATE_NOTICE)
        return
      case 'unauthorized':
        this.setPaused(MISMATCH_NOTICE)
        return
    }
  }

  /**
   * The server wins. Events applied during the flight were stepped on the old
   * state, so they go too: at most one flush interval of progress.
   */
  private adopt(ack: { state: GameState; seq: number; cursor: number }): void {
    this.committed = ack.state
    this.local = ack.state
    this.cursor = ack.cursor
    this.seq = ack.seq
    this.pending = []
    this.sent = null
    this.buffer = []
    void this.publish({ view: this.view() })
  }

  // ---------------------------------------------------------------------------
  // Server events

  /**
   * Applies the delivered events not seen yet, then re-steps what is in flight
   * and buffered on top. Called only under the lock.
   */
  private receive(delivery: Delivery, publish = true): void {
    const fresh = delivery.events.filter((e) => e.n > this.cursor).sort((a, b) => a.n - b.n)
    const last = fresh.at(-1)?.n ?? 0
    this.cursor = Math.max(this.cursor, delivery.cursor, last)
    if (fresh.length === 0 || !this.committed) return
    const effects: Effect[] = []
    let s = replay(this.committed, this.pending).state
    for (const { event } of fresh) {
      const r = step(s, event)
      s = r.state
      effects.push(...r.effects)
      this.pending.push(event)
    }
    const restep = (events: TimedEvent[]) => {
      for (const event of events) {
        const r = step(s, strip(event))
        s = r.state
        for (const e of r.effects) if (e.k === 'rejected') effects.push(e)
      }
    }
    if (this.sent) {
      restep(this.sent.batch.events)
      this.sent = { batch: this.sent.batch, result: s }
    }
    restep(this.buffer)
    this.local = s
    if (publish) void this.publish({ view: this.view() })
    if (effects.length > 0) this.deps.onEffects(effects)
  }

  // ---------------------------------------------------------------------------
  // Market and account

  trade<R extends MarketResult>(fn: TradeCall<R>): Promise<R> {
    if (this.paused !== null) return Promise.reject(new Error('not_primary'))
    return this.lock(async () => {
      if (this.outage) throw new Error('unreachable')
      await this.doFlush()
      if (this.outage) throw new Error('unreachable')
      if (this.paused !== null) throw new Error('not_primary')
      const token = this.token
      if (!token) throw new Error('not_primary')
      let r: R
      try {
        r = await fn(this.deps.client, { deviceToken: token })
      } catch {
        throw new Error('unreachable')
      }
      if (r.ok) this.receive(r.delivery)
      return r
    })
  }

  sync(): Promise<void> {
    return this.lock(async () => {
      if (this.outage) throw new Error('unreachable')
      await this.doFlush()
      if (this.outage) throw new Error('unreachable')
      const token = this.token
      if (!token || this.paused !== null) return
      let info: Awaited<ReturnType<ServerClient['account']>>
      try {
        info = await this.deps.client.account({ deviceToken: token })
      } catch {
        throw new Error('unreachable')
      }
      if ('reason' in info) {
        this.setPaused(MISMATCH_NOTICE)
        return
      }
      this.returns = info.returns
      this.accountRecord = info.account
      await this.rememberConfig(info.config)
      this.receive(info.delivery, false)
      await this.publish({ view: this.view() })
    })
  }

  /** A call to the server under the lock, no flush first: the link flow. */
  call<T>(fn: (client: ServerClient, auth: Auth) => Promise<T>): Promise<T> {
    return this.lock(async () => {
      if (this.outage) throw new Error('unreachable')
      const token = this.token
      if (!token) throw new Error('not_started')
      try {
        return await fn(this.deps.client, { deviceToken: token })
      } catch {
        throw new Error('unreachable')
      }
    })
  }

  /** The account changed on the server (a link): the view shows it. */
  setAccount(account: Account): void {
    this.accountRecord = account
    void this.publish({ view: this.view() })
  }

  /** This engine is replaced: its retries stop and it publishes nothing more. */
  stop(): void {
    this.stopped = true
    this.outage = null
    this.outageGen += 1
  }

  // ---------------------------------------------------------------------------
  // Outages

  /**
   * A thrown submit or bootstrap. The banner shows at once; the attempt
   * retries on a backoff of `1 s × 2^n`, capped at 30 s, plus up to 50% jitter.
   */
  private async enterOutage(retry: 'flush' | 'start'): Promise<void> {
    const now = await this.deps.now()
    if (!this.outage) {
      const gen = ++this.outageGen
      this.outage = { since: now, attempt: 0, expired: false }
      this.noticeGen += 1
      void this.publish({ notice: RETRYING_NOTICE })
      this.deps.after(OUTAGE_BUFFER_MS, () => {
        if (gen === this.outageGen && this.outage) this.expireOutage()
      })
    } else if (!this.outage.expired && now - this.outage.since >= OUTAGE_BUFFER_MS) {
      this.expireOutage()
    }
    const outage = this.outage
    const delay =
      Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** outage.attempt) *
      (1 + this.deps.random() * 0.5)
    outage.attempt += 1
    const gen = this.outageGen
    this.deps.after(delay, () => {
      if (gen !== this.outageGen || !this.outage || this.stopped) return
      void this.lock(() => (retry === 'start' ? this.doStart() : this.doFlush()))
    })
  }

  private expireOutage(): void {
    if (!this.outage) return
    this.outage.expired = true
    this.noticeGen += 1
    void this.publish({ notice: UNREACHABLE_NOTICE, view: this.view() })
  }

  private clearOutage(): void {
    if (!this.outage) return
    this.outage = null
    this.outageGen += 1
    this.noticeGen += 1
    void this.publish({ notice: null })
  }

  isUnreachable(): boolean {
    return this.outage !== null
  }

  /** The unsent events: what a switch of server during an outage drops. */
  unsentCount(): number {
    return (this.sent?.batch.events.length ?? 0) + this.buffer.length
  }

  // ---------------------------------------------------------------------------
  // Clock

  private async rememberConfig(config: ServerConfig): Promise<void> {
    this.config = config
    this.clockSeen = {
      serverNow: config.serverNow,
      clientNow: await this.deps.now(),
      speed: config.speed,
    }
  }

  /** The last server clock seen, for showing server deadlines as real time left. */
  clock(): { serverNow: number; clientNow: number; speed: number } | null {
    return this.clockSeen
  }

  serverConfig(): ServerConfig | null {
    return this.config
  }

  returnsWaiting(): number {
    return this.returns
  }

  // ---------------------------------------------------------------------------
  // Reads and notices

  /** Resolves once every publish queued so far has landed. */
  settled(): Promise<void> {
    return this.queue
  }

  /** Resolves once every locked operation queued so far has ended. */
  idle(): Promise<void> {
    return this.chain.then(() => undefined)
  }

  state(): GameState | null {
    return this.local
  }

  accountId(): string | null {
    return this.account
  }

  isPaused(): boolean {
    return this.paused !== null
  }

  setPaused(reason: string | null): void {
    this.noticeGen += 1
    this.paused = reason
    void this.publish(
      reason === null ? { mode: 'primary', notice: null } : { mode: 'paused', notice: reason },
    )
  }

  /** Shows `text` for `ms`. Its timer clears it only if no later notice and no pause replaced it. */
  notice(text: string, ms: number): void {
    const gen = ++this.noticeGen
    void this.publish({ notice: text })
    this.deps.after(ms, () => {
      if (gen === this.noticeGen && this.paused === null) void this.publish({ notice: null })
    })
  }

  private view() {
    if (!this.local || !this.account || this.local.v !== SIM_VERSION) return null
    const account = toAccountView(
      this.accountRecord,
      this.config,
      this.deps.label ?? 'in-process',
      this.returns,
    )
    return toGameView(this.local, this.account, this.firstRun, account)
  }

  private publish(patch: Partial<PluginState['promptfall']>): Promise<void> {
    if (this.stopped) return this.queue
    this.queue = this.queue.then(() => this.deps.publish(patch)).catch(() => undefined)
    return this.queue
  }
}
