import type { PluginState, RenderSurface } from 'claude-code'
import type { GameView } from '../types'
import type { GaugeTrack } from './stage/gauges'
import type { MessageLog } from './stage/log'
import type { StageLoop } from './stage/loop'
import type { StageTimeline } from './stage/timeline'
import { revokedToast } from './toasts'
import type { LedgerHost } from './vendor/ledger.js'
import type {
  Account,
  Auth,
  Banned,
  Batch,
  BatchAck,
  Boards,
  ChatResult,
  Delivery,
  Journal,
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
  WorldSnapshot,
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
import { toAccountView, toGameView, tradeName } from './view'

/** The cursor `shown` records for `account`, or 0 when it records none or another account's. */
function shownThrough(shown: unknown, account: string): number {
  if (typeof shown !== 'object' || shown === null) return 0
  const { account: of, cursor } = shown as { account?: unknown; cursor?: unknown }
  return of === account && typeof cursor === 'number' ? cursor : 0
}

export type EnginePublish = (patch: Partial<PluginState['promptfall']>) => Promise<void>

export type EngineDeps = {
  client: ServerClient
  /** Holds the device token under `tokenKey`. */
  kv: KeyValue
  /** The store key of the device token; `deviceToken` for the in-process ledger. */
  tokenKey?: string
  /** The server's label in the view; `in-process` by default. */
  label?: string
  /** The sandbox save: the view says so. */
  sandbox?: boolean
  now: () => Promise<number>
  newBatchId: () => string
  /** Writes atoms; a closure over the session's `$`. */
  publish: EnginePublish
  /**
   * Every applied event, effects or none, and every restep that publishes or brings effects.
   * `at`: the applied event's time, absent for a delivery; `view`: the view just published for it,
   * so a listener needs no read of the async atom (null when the state has no view); `arrived`: a
   * delivery's wall time, when it reached the engine.
   */
  onEffects: (
    effects: Effect[],
    at: number | undefined,
    view: GameView | null,
    arrived?: number,
  ) => void
  /** Shows a toast; `timeoutMs` left out is the host's default. Optional: tests leave it out. */
  toast?: (text: string, timeoutMs?: number) => void
  /** Runs `fn` once after `ms`: notices that clear themselves and outage retries. */
  after: (ms: number, fn: () => void) => void
  /** In [0, 1): the jitter of outage retries. */
  random: () => number
  /** This engine starts after the account's delete: a refused bootstrap's pause says so. */
  deleted?: boolean
}

/** What the command and the dialog hold of a running game. */
export type GameHandle = {
  /** The stage's timeline (one per session) and its frame loop per surface, made on first use. */
  stage: {
    timeline: StageTimeline
    gauges: GaugeTrack
    log: MessageLog
    loopFor: (surface: RenderSurface) => StageLoop
  }
  apply: (event: PlayerEvent, at: number) => void
  canApply: () => boolean
  /** This session holds the lease and its engine has paused: its refusals say paused. */
  isPaused: () => boolean
  /** This session's engine paused for a ban: the delete is the one verb it still lets through. */
  isBanned: () => boolean
  setOff: (off: boolean) => Promise<void>
  /** The player is using this session: take the lease if another session holds it. */
  claim: () => Promise<void>
  settled: () => Promise<void>
  /**
   * A market call after a flush, its delivery applied. Throws `not_primary`, `paused` or
   * `unreachable`, or the ban's message once it pauses for a ban.
   */
  trade: <R extends MarketResult>(fn: TradeCall<R>) => Promise<Exclude<R, Banned>>
  /** Flushes, then applies what `account()` delivers. Throws `unreachable` during an outage. */
  sync: () => Promise<void>
  /** Moves the machine to another server (`null`: the in-process ledger). */
  switchServer: (url: string | null) => Promise<{ label: string; old: string; dropped: number }>
  /** Starts the GitHub device flow; the session polls until it is approved. */
  link: () => Promise<void>
  /** Deletes this machine's Promptfall data but the lease, then starts over on the same server. */
  reset: () => Promise<void>
  /**
   * Deletes the account on its server; on the server's word, resets this machine as `reset`
   * does. The message window says which. Never rejects.
   */
  deleteAccount: () => Promise<void>
  /** Market reads: no flush first, reads need none. Throw `unreachable`, `not_started` or a ban's message. */
  market: {
    browse: (query: ListingQuery) => Promise<ListingPage | Unauthorized>
    myOrders: () => Promise<MyOrders | Unauthorized>
    matching: (itemId: string) => Promise<Order[] | Unauthorized>
  }
  /** The last server clock seen, for showing server deadlines as real time left. */
  clock: () => { serverNow: number; clientNow: number; speed: number } | null
  /** The Chat tab drew at `now`: the world poll runs fast for a while. Publishes nothing. */
  chatSeen: (now: number) => void
  /** Posts a chat line with the stored token. Throws `unreachable` in an outage or on a thrown call, or a ban's message. */
  chat: (text: string) => Promise<Exclude<ChatResult, Banned>>
  /** The boards, with the stored token. Throws `unreachable`, `not_started` or a ban's message. */
  leaderboards: () => Promise<Boards | Unauthorized>
  /** The journal, with the stored token: a read that writes nothing, from any session. Throws as `leaderboards` does. */
  journal: () => Promise<Journal | Unauthorized>
  /** The in-process ledger's host: the sandbox's grants go through it. Null on a remote server. */
  host: () => LedgerHost | null
  /** The account the engine plays, once bootstrapped. */
  accountId: () => string | null
  /** The view as last published: what the band and the dialog draw. */
  view: () => Promise<GameView | null>
  /** One world poll now, its toasts and cue fired; the snapshot it holds, null before any. */
  pollWorld: () => Promise<WorldSnapshot | null>
}

export type TradeCall<R extends MarketResult> = (client: ServerClient, auth: Auth) => Promise<R>

type Sent = { batch: Batch; result: GameState }

export const UPDATE_NOTICE = 'Update Promptfall: /plugin update promptfall'
export const MISMATCH_NOTICE = 'Promptfall: account mismatch, delete the plugin store to reset'
export const OLD_VERSION_NOTICE =
  "Promptfall: this machine's data is from an older version, reset it in /promptfall account"
export const RETRYING_NOTICE = 'Promptfall: server unreachable, retrying'
export const UNREACHABLE_NOTICE = 'Promptfall: server unreachable'
export const DELETED_NOTICE =
  'Promptfall: your account on this server is deleted. A fresh one plays here now.'
/** A refused bootstrap after the delete: the refusal, and that the delete happened. */
export function deletedRefusal(message: string): string {
  return `Promptfall: your account was deleted. ${message}`
}
/** The pane's refusal when the server did not confirm a delete: nothing was reset. */
export const NOT_DELETED = 'the server did not delete the account'
/** A paused primary's refusal, on every surface: the band's notice says why. */
export const PAUSED_LINE = 'Promptfall is paused'

/**
 * How long a bootstrap refused by the mint cap waits before it asks again: the cap counts by the
 * hour. A ban is not asked again until the next session.
 */
export const REFUSED_RETRY_MS = 300_000

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
  /** The shown cursor's writes, in order. */
  private shownWrite: Promise<void> = Promise.resolve()
  private noticeGen = 0
  private outageGen = 0
  private refusedGen = 0
  /** No bootstrap has succeeded since the account's delete: a refusal's pause names it. */
  private afterDelete: boolean
  /** The token a ban paused this engine on: the delete, the one call a ban lets through, uses it. */
  private bannedToken: string | null = null

  constructor(private readonly deps: EngineDeps) {
    this.afterDelete = deps.deleted ?? false
  }

  private get tokenKey(): string {
    return this.deps.tokenKey ?? 'deviceToken'
  }

  /**
   * Where the cursor this account's events have been handed on through is kept, beside the token:
   * every session's primary reads it, so a handover neither repeats nor silences a toast.
   */
  private get shownKey(): string {
    return `${this.tokenKey}:shown`
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

  /**
   * Bootstraps and takes the committed state; a thrown bootstrap enters the outage and retries,
   * and a refused one pauses with the host's message: a rate limit asks again after
   * REFUSED_RETRY_MS, a ban never does. A token the server does not know is cleared, if the store
   * still holds it, and the start runs again: with no token it mints.
   * After a delete, the pause says the delete happened.
   * The bootstrap's delivery hands on only the events past the cursor a primary of this account
   * has shown: what one already toasted does not toast again, and what nobody saw still does.
   */
  start(): Promise<void> {
    return this.lock(() => this.doStart())
  }

  private async doStart(): Promise<void> {
    const stored = await this.deps.kv.get(this.tokenKey)
    // Stopped (a reset, a switch, a demotion) while the token was read: a null token would mint.
    if (this.stopped) return
    const token = typeof stored === 'string' ? stored : null
    let boot: Awaited<ReturnType<ServerClient['bootstrap']>>
    try {
      boot = await this.deps.client.bootstrap({ clientVersion: CLIENT_VERSION, deviceToken: token })
    } catch {
      if (this.stopped) return
      await this.enterOutage(() => this.doStart())
      return
    }
    // Replaced (a reset or a switch) while the bootstrap was in flight: write nothing.
    if (this.stopped) return
    if ('refusal' in boot) {
      this.clearOutage()
      if (boot.refusal === 'unknown' && token !== null) {
        await this.forget(token)
        if (this.stopped) return
        await this.doStart()
        return
      }
      this.setPaused(this.afterDelete ? deletedRefusal(boot.message) : boot.message)
      if (boot.refusal === 'banned') {
        this.bannedToken = token
        return
      }
      const gen = ++this.refusedGen
      this.deps.after(REFUSED_RETRY_MS, () => {
        if (gen !== this.refusedGen || this.stopped) return
        void this.lock(() => this.doStart())
      })
      return
    }
    this.afterDelete = false
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
      // By direction: a save from a newer sim means this plugin is behind, so update; one from an
      // older sim is this machine's to reset. An outdated plugin is never told to reset in a loop.
      const notice = boot.state.v > SIM_VERSION ? UPDATE_NOTICE : OLD_VERSION_NOTICE
      this.paused = notice
      this.noticeGen += 1
      await this.publish({ view: null, mode: 'paused', notice })
      return
    }
    if (this.paused !== null) {
      this.paused = null
      void this.publish({ mode: 'primary', notice: null })
    }
    const shown = await this.deps.kv.get(this.shownKey)
    this.receive(
      boot.delivery,
      false,
      shownThrough(shown, boot.account.accountId),
      await this.deps.now(),
    )
    await this.publish({ view: this.view() })
    // Only the minted account's first view says firstRun; every later view says no.
    this.firstRun = false
  }

  /**
   * Clears the stored token if it is still `token`. Another session may have healed it while the
   * refused call was in flight: then the store holds its token, and that one is kept.
   */
  private async forget(token: string): Promise<void> {
    const stored = await this.deps.kv.get(this.tokenKey)
    if (this.stopped || stored !== token) return
    await this.deps.kv.delete(this.tokenKey)
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
    if (!local || this.stopped || this.paused !== null) return
    if (this.outage && at - this.outage.since >= OUTAGE_BUFFER_MS) return
    const r = step(local, event)
    this.local = r.state
    this.buffer.push({ ...event, at: Math.floor(at) } as TimedEvent)
    const view = this.view()
    void this.publish({ view })
    // Every tick, effects or not: gauges fill on ticks where nobody acts.
    this.deps.onEffects(r.effects, at, view)
  }

  /** Whether `apply` takes events now: not paused, and not past the outage's buffer window. */
  accepting(): boolean {
    return this.local !== null && !this.stopped && this.paused === null && !this.outage?.expired
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
    const recovering = this.outage !== null
    let stuck = 0
    for (;;) {
      // Stopped between passes: a discarded engine never submits again.
      if (this.stopped) return
      const sent: Sent | null = this.sent
      if (!sent) return
      let ack: BatchAck
      try {
        ack = await this.deps.client.submit(sent.batch, { deviceToken: this.token })
      } catch {
        // Any thrown submit, a 4xx included, is an outage: only the version-gate and sim-version
        // acks pause with the update notice.
        await this.enterOutage(() => this.doFlush())
        return
      }
      // Stopped during the submit: the ack is the next primary's business, and nothing toasts.
      if (this.stopped) return
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
        this.receive(ack.delivery, true, 0, await this.deps.now())
        // The first success after an outage sends what buffered during it now, not at the next
        // scheduled flush.
        if (recovering && this.buffer.length > 0) await this.doFlush()
        return
      }
      if (ack.reason === 'cursor_behind') {
        const before = this.cursor
        this.receive(ack.delivery, true, 0, await this.deps.now())
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
      case 'hash_mismatch': {
        // Named before adopting: the ack's state no longer holds what it revoked.
        const revoked = revokedToast((ack.revokedItemIds ?? []).map((id) => this.itemName(id)))
        this.adopt(ack)
        if (revoked) this.deps.toast?.(revoked.text, revoked.timeoutMs)
        return
      }
      case 'version_gate':
      case 'sim_version':
        this.setPaused(UPDATE_NOTICE)
        return
      case 'unauthorized':
        this.setPaused(MISMATCH_NOTICE)
        return
      case 'banned':
        this.pauseBanned(ack.message)
        return
    }
  }

  /** An item's base name as the local state holds it, else the committed one; null when neither does. */
  private itemName(id: string): string | null {
    const item = [this.local, this.committed]
      .map((s) => s?.inventory.find((i) => i.id === id))
      .find((i) => i !== undefined)
    return item ? tradeName('item', item.base) : null
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
   * and buffered on top. Called only under the lock. The effects of events at or
   * before `shownThrough` are not handed on: a primary already toasted them. `arrived` is the wall
   * time the delivery came in.
   */
  private receive(delivery: Delivery, publish = true, shownThrough = 0, arrived?: number): void {
    const fresh = delivery.events.filter((e) => e.n > this.cursor).sort((a, b) => a.n - b.n)
    const last = fresh.at(-1)?.n ?? 0
    this.cursor = Math.max(this.cursor, delivery.cursor, last)
    if (fresh.length === 0 || !this.committed) return
    const effects: Effect[] = []
    let s = replay(this.committed, this.pending).state
    for (const { n, event } of fresh) {
      const r = step(s, event)
      s = r.state
      if (n > shownThrough) effects.push(...r.effects)
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
    // A stopped engine's effects never toast, and it records nothing as shown.
    if (this.stopped) return
    this.recordShown()
    if (!publish && effects.length === 0) return
    const view = this.view()
    if (publish) void this.publish({ view })
    this.deps.onEffects(effects, undefined, view, arrived)
  }

  /** Records that this account's events have been handed on through the cursor. */
  private recordShown(): void {
    const account = this.account
    if (account === null) return
    const value = { account, cursor: this.cursor }
    this.shownWrite = this.shownWrite
      .then(() => this.deps.kv.set(this.shownKey, value))
      .catch(() => undefined)
  }

  // ---------------------------------------------------------------------------
  // Market and account

  trade<R extends MarketResult>(fn: TradeCall<R>): Promise<Exclude<R, Banned>> {
    if (this.paused !== null) return Promise.reject(new Error('paused'))
    return this.lock(async () => {
      if (this.outage) throw new Error('unreachable')
      await this.doFlush()
      if (this.outage) throw new Error('unreachable')
      if (this.paused !== null) throw new Error('paused')
      const token = this.token
      if (!token) throw new Error('not_primary')
      let r: R
      try {
        r = await fn(this.deps.client, { deviceToken: token })
      } catch {
        throw new Error('unreachable')
      }
      if (r.ok) this.receive(r.delivery, true, 0, await this.deps.now())
      return this.unbanned(r)
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
        if (info.reason === 'banned') this.pauseBanned(info.message)
        else this.setPaused(MISMATCH_NOTICE)
        return
      }
      this.returns = info.returns
      this.accountRecord = info.account
      await this.rememberConfig(info.config)
      this.receive(info.delivery, false, 0, await this.deps.now())
      await this.publish({ view: this.view() })
    })
  }

  /** A call to the server under the lock, no flush first: the link flow and the market reads. */
  call<T>(fn: (client: ServerClient, auth: Auth) => Promise<T>): Promise<Exclude<T, Banned>> {
    return this.callWith(() => this.token, fn)
  }

  /**
   * The account's delete under the lock: the one call a ban lets through, so it reaches the server
   * with the stored token although a refused bootstrap never started this engine.
   */
  deleteAccount(): Promise<Exclude<Awaited<ReturnType<ServerClient['deleteAccount']>>, Banned>> {
    return this.callWith(
      () => this.token ?? this.bannedToken,
      (client, auth) => client.deleteAccount(auth),
    )
  }

  private callWith<T>(
    tokenOf: () => string | null,
    fn: (client: ServerClient, auth: Auth) => Promise<T>,
  ): Promise<Exclude<T, Banned>> {
    return this.lock(async () => {
      if (this.outage) throw new Error('unreachable')
      const token = tokenOf()
      if (!token) throw new Error('not_started')
      let r: T
      try {
        r = await fn(this.deps.client, { deviceToken: token })
      } catch {
        throw new Error('unreachable')
      }
      return this.unbanned(r)
    })
  }

  /**
   * An answer that is not a ban. A ban pauses play with its message, as a refused bootstrap
   * does, and throws the message for the surface that asked.
   */
  unbanned<T>(answer: T): Exclude<T, Banned> {
    const a = answer as { reason?: unknown; message?: unknown }
    if (a.reason === 'banned' && typeof a.message === 'string') {
      this.pauseBanned(a.message)
      throw new Error(a.message)
    }
    return answer as Exclude<T, Banned>
  }

  /** The account changed on the server (a link): the view shows it. */
  setAccount(account: Account): void {
    this.accountRecord = account
    void this.publish({ view: this.view() })
  }

  /**
   * This engine is replaced: it clears its notice, as a restart does, so no banner outlives
   * it; then its retries stop and it publishes nothing more. Resolves once the clear has landed.
   */
  stop(): Promise<void> {
    if (this.stopped) return this.queue
    this.noticeGen += 1
    const cleared = this.publish({ notice: null })
    this.stopped = true
    this.outage = null
    this.outageGen += 1
    return cleared
  }

  // ---------------------------------------------------------------------------
  // Outages

  /**
   * A thrown submit or bootstrap. The banner shows at once; the attempt
   * retries on a backoff of `1 s × 2^n`, capped at 30 s, plus up to 50% jitter.
   */
  private async enterOutage(retry: () => Promise<void>): Promise<void> {
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
      void this.lock(retry)
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

  /** What the committed state has dealt to the boss it is engaged with: the baseline of the predicted bar. */
  committedBoss(): { bossId: string; dealt: number } | null {
    const boss = this.committed?.boss
    return boss ? { bossId: boss.bossId, dealt: boss.dealt } : null
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
    return this.queue.then(() => this.shownWrite)
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

  /** Paused by a ban: the delete is the one call it still lets through. */
  isBanned(): boolean {
    return this.paused !== null && this.bannedToken !== null
  }

  /** A ban on the running account pauses play for good with its message. */
  private pauseBanned(message: string): void {
    // A session refused at bootstrap runs no token: it keeps the credential that refusal left it.
    this.bannedToken = this.token ?? this.bannedToken
    this.setPaused(message)
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
      this.deps.sandbox ?? false,
    )
    return toGameView(this.local, this.account, this.firstRun, account)
  }

  private publish(patch: Partial<PluginState['promptfall']>): Promise<void> {
    if (this.stopped) return this.queue
    this.queue = this.queue.then(() => this.deps.publish(patch)).catch(() => undefined)
    return this.queue
  }
}
