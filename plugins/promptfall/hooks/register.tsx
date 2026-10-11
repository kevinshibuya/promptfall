import type { Register, RenderSurface, UiBlitArgs, UiBlitResult } from 'claude-code'
import { atom, read, update } from 'claude-code'
import type { GameView, Mode, Settings, WorldState } from '../types'
import { commandSpec, registerCommand } from './command'
import { CUE_ASSET, type Cue } from './cues'
import {
  DELETED_NOTICE,
  type EnginePublish,
  GameEngine,
  type GameHandle,
  NOT_DELETED,
  type TradeCall,
} from './engine'
import { acquire, claim, holds, LEASE_KEY, release } from './lease'
import {
  LOCAL,
  type ResolvedServer,
  resolveClient,
  SERVER_KEY,
  type SecondaryReads,
  serverOf,
} from './server'
import { GaugeTrack } from './stage/gauges'
import { MessageLog } from './stage/log'
import { StageLoop } from './stage/loop'
import { StageTimeline } from './stage/timeline'
import { CUE_GAIN } from './stage/tuning'
import {
  BOARDS_DEFAULT,
  CHAT_DEFAULT,
  DIALOG_DEFAULT,
  MARKET_DEFAULT,
  ORDERS_DEFAULT,
  parseSettings,
  SETTINGS_DEFAULT,
  SETTINGS_KEY,
  WORLD_DEFAULT,
} from './state'
import { PREFIX, SANDBOX_PREFIX, type StoreCalls, StoreKeyValue } from './storage'
import { toastsFor, worldToast } from './toasts'
import { registerBand } from './ui/band'
import { registerDialog } from './ui/dialog'
import type {
  Auth,
  Banned,
  Boards,
  ChatResult,
  FetchLike,
  LinkPoll,
  LinkRefused,
  LinkStart,
  MarketResult,
  Unauthorized,
  WorldSnapshot,
} from './vendor/protocol.js'
import { type Effect, type PlayerEvent, replay, SIM_VERSION } from './vendor/sim.js'
import { CLIENT_VERSION } from './version'
import { toAccountView, toGameView } from './view'
import { WorldPoller } from './world'

type Timer = { cancel: () => void }

/** Everything the game needs from `$`, as closures written at a hook. */
type Io = {
  now: () => Promise<number>
  every: (ms: number, fn: () => void) => Timer
  after: (ms: number, fn: () => void) => Timer
  store: StoreCalls
  publish: EnginePublish
  /** Shows a toast; `timeoutMs` left out is the host's default. */
  toast: (text: string, timeoutMs?: number) => void
  leaseOwner: () => Promise<string | null>
  mode: () => Promise<Mode>
  paneNotice: (text: string | null) => Promise<void>
  /** Shows or clears the device-flow code in the dialog. */
  dialogLink: (link: { code: string; url: string } | null) => Promise<void>
  /** Drops what the dialog holds of one server: a link code and an open sell panel. */
  clearDialog: () => Promise<void>
  /** Reads the `world` atom. */
  readWorld: () => Promise<WorldState | null>
  /** Reads the `notice` atom: the band's strip shows it. */
  readNotice: () => Promise<string | null>
  fetch: FetchLike
  blit: (args: UiBlitArgs) => Promise<UiBlitResult>
  /** $.ui.invalidate('ui.render') */
  invalidate: () => void
  view: () => Promise<GameView | null>
  settings: () => Promise<Settings>
  /** Plays a file of the plugin's; resolves or rejects with nothing played off macOS. */
  play: (asset: string, gain: number) => Promise<void>
  /** The sandbox switch, read once for the session: its own save on the in-process ledger. */
  sandbox: boolean
}

/** How many polls a link waits for approval before giving up (15 minutes at 5 s). */
const LINK_POLLS = 180
/** A request the server has not answered by then is a thrown fetch: an outage, not a held lock. */
const FETCH_TIMEOUT_MS = 15_000

/** `$.http.fetch` adapted to the protocol's FetchLike, giving up after `FETCH_TIMEOUT_MS`. */
function timedFetch(
  http: (
    url: string,
    init: Parameters<FetchLike>[1],
  ) => Promise<{ status: number; ok: boolean; text: string }>,
  after: (ms: number, fn: () => void) => Timer,
): FetchLike {
  return (url, init) =>
    new Promise((resolve, reject) => {
      const timer = after(FETCH_TIMEOUT_MS, () => reject(new Error('timeout')))
      http(url, init).then(
        (r) => {
          timer.cancel()
          resolve({ status: r.status, ok: r.ok, text: r.text })
        },
        (error: unknown) => {
          timer.cancel()
          reject(error)
        },
      )
    })
}

const TURN_CADENCE_MS = 2000
const IDLE_CADENCE_MS = 5000
const FLUSH_MS = 15_000
const LEASE_RENEW_MS = 10_000

const WELCOME = 'Welcome to Promptfall. /promptfall heroes to meet your party'
const WELCOME_MS = 20_000

/**
 * One session's game: the engine, the lease, and the timers. Module state, so
 * a hot reload starts it over; the session's atoms and the store carry on.
 */
class GameSession implements GameHandle {
  engine: GameEngine
  private readonly kv: StoreKeyValue
  private server: ResolvedServer
  private setting: string | null = null
  private linkGen = 0
  /** A token the server minted over: it does not know it, so a secondary stops asking with it. */
  private orphanToken: string | null = null
  private role: 'primary' | 'secondary' = 'secondary'
  private off = false
  private owner = ''
  private cadence = 0
  private tickTimer: Timer | null = null
  private timers: Timer[] = []
  private pending: Promise<void> = Promise.resolve()
  private firstRun = false
  private paneNoticeGen = 0
  private readonly poller: WorldPoller
  private readonly loops = new Map<RenderSurface, StageLoop>()
  /** The last applied event's time: the stage's `now` for effects a delivery brought. */
  private lastAt = 0
  /**
   * World boss names by id, from the view's boss and the world snapshot: a reward carries only
   * the boss id, and arrives after boss mode has ended.
   */
  private readonly bossNames = new Map<string, string>()

  readonly stage: GameHandle['stage'] = {
    timeline: new StageTimeline(),
    gauges: new GaugeTrack(),
    log: new MessageLog(),
    loopFor: (surface) => {
      let loop = this.loops.get(surface)
      if (!loop) {
        const io = this.io
        loop = new StageLoop(
          {
            now: io.now,
            after: io.after,
            blit: io.blit,
            invalidate: io.invalidate,
            view: io.view,
            settings: io.settings,
            strip: async () => ({
              world: (await io.readWorld()) ?? WORLD_DEFAULT,
              notice: await io.readNotice(),
              gauges: this.stage.gauges,
              log: this.stage.log,
            }),
          },
          this.stage.timeline,
        )
        this.loops.set(surface, loop)
      }
      return loop
    },
  }

  constructor(private readonly io: Io) {
    this.kv = new StoreKeyValue(io.store, io.sandbox ? SANDBOX_PREFIX : PREFIX)
    this.server = this.resolve(null)
    this.engine = this.makeEngine()
    this.poller = new WorldPoller({
      now: io.now,
      every: io.every,
      after: io.after,
      publish: (world) => {
        const boss = world.snapshot?.boss
        if (boss) this.bossNames.set(boss.bossId, boss.name)
        return io.publish({ world })
      },
      load: io.readWorld,
      // A secondary's poll leaves the world boss to the primary. A ban pauses the primary and
      // throws, and a thrown poll is ignored.
      fetch: async (since) =>
        this.unbanned(
          await (this.role === 'primary' ? this.server.client : this.server.reads).world(
            await this.storedAuth(),
            since,
          ),
        ),
      // A secondary's view is the committed state: nothing to subtract.
      committedDealt: () => (this.role === 'primary' ? this.engine.committedBoss() : null),
      // Only the primary toasts, the world boss included: two terminals never show the news twice.
      transition: ({ kind, name, cue }) => {
        if (this.role !== 'primary') return
        const toast = worldToast(kind, name)
        io.toast(toast.text, toast.timeoutMs)
        if (cue && toast.cue) void this.playCue(toast.cue)
      },
    })
  }

  /**
   * Plays a cue on the primary with sound on. `/promptfall off` hides the band, not the cues.
   * Off macOS the engine plays nothing; a rejection is swallowed either way.
   */
  private async playCue(cue: Cue): Promise<void> {
    if (this.role !== 'primary') return
    const settings = await this.io.settings()
    if (!settings.sound || this.role !== 'primary') return
    this.io.play(CUE_ASSET[cue], CUE_GAIN).catch(() => undefined)
  }

  /**
   * An answer outside the engine that is not a ban. On the primary the engine pauses for a ban;
   * any session throws its message for the surface that asked.
   */
  private unbanned<T>(answer: T): Exclude<T, Banned> {
    if (this.role === 'primary') return this.engine.unbanned(answer)
    const a = answer as { reason?: unknown; message?: unknown }
    if (a.reason === 'banned' && typeof a.message === 'string') throw new Error(a.message)
    return answer as Exclude<T, Banned>
  }

  /** The stored device token of the current server; reads and chat use it outside the engine. */
  private async storedAuth(): Promise<Auth> {
    const token = await this.kv.get(this.server.tokenKey)
    if (typeof token !== 'string') throw new Error('not_started')
    return { deviceToken: token }
  }

  private resolve(setting: string | null): ResolvedServer {
    return resolveClient(
      setting,
      { kv: this.kv, now: this.io.now, fetch: this.io.fetch },
      this.io.sandbox,
    )
  }

  /** `deleted`: the engine starts after the account's delete. */
  private makeEngine(deleted = false): GameEngine {
    const io = this.io
    return new GameEngine({
      client: this.server.client,
      kv: this.kv,
      tokenKey: this.server.tokenKey,
      label: this.server.label,
      sandbox: this.server.sandbox,
      now: io.now,
      newBatchId: () => crypto.randomUUID(),
      publish: (patch) => {
        if (patch.view?.firstRun) this.firstRun = true
        // The session owns the mode: the engine's pause becomes the derived value.
        return io.publish(patch.mode === undefined ? patch : { ...patch, mode: this.mode() })
      },
      onEffects: (effects, at, view, arrived) => this.onEffects(effects, at, view, arrived),
      toast: io.toast,
      after: (ms, fn) => {
        io.after(ms, fn)
      },
      random: Math.random,
      deleted,
    })
  }

  /** Points the session at a server: a fresh client and engine; the old engine stops. */
  private useServer(setting: string | null, deleted = false): void {
    void this.engine.stop()
    this.linkGen += 1
    this.orphanToken = null
    this.setting = setting
    this.server = this.resolve(setting)
    this.engine = this.makeEngine(deleted)
    // World data belongs to one server: drop it and poll the new one.
    void this.poller.reset()
  }

  private async readSetting(): Promise<string | null> {
    // The sandbox pins the in-process ledger: a stored URL is ignored.
    if (this.io.sandbox) return null
    return serverOf(await this.kv.get(SERVER_KEY))
  }

  async start(): Promise<void> {
    const setting = await this.readSetting()
    if (setting !== null) this.useServer(setting)
    await this.io.publish({ server: setting })
    // A code from before a hot reload has no poll behind it any more.
    await this.io.clearDialog()
    this.owner = (await this.io.leaseOwner()) ?? crypto.randomUUID()
    this.off = (await this.io.mode()) === 'off'
    await this.io.publish({ leaseOwner: this.owner })
    if (await acquire(this.kv, this.owner, await this.io.now())) await this.becomePrimary()
    else await this.becomeSecondary()
    this.setCadence(IDLE_CADENCE_MS)
    // A demoted primary discards its engine, so nothing it held is ever submitted.
    this.timers.push(this.io.every(FLUSH_MS, () => void this.flushIfOwner()))
    this.timers.push(this.io.every(LEASE_RENEW_MS, () => void this.renew()))
  }

  /** Events apply while this session holds the lease and the engine is not paused. Off only hides the band. */
  canApply(): boolean {
    return this.role === 'primary' && this.engine.accepting()
  }

  /** What the band and the dialog show: off, then paused, then the lease role. */
  mode(): Mode {
    return this.off ? 'off' : this.engine.isPaused() ? 'paused' : this.role
  }

  isPaused(): boolean {
    return this.role === 'primary' && this.engine.isPaused()
  }

  isBanned(): boolean {
    return this.role === 'primary' && this.engine.isBanned()
  }

  isPrimary(): boolean {
    return this.role === 'primary'
  }

  async setOff(off: boolean): Promise<void> {
    this.off = off
    await this.io.publish({ mode: this.mode() })
  }

  apply(event: PlayerEvent, at: number): void {
    if (this.canApply()) this.engine.apply(event, at)
  }

  trade<R extends MarketResult>(fn: TradeCall<R>): Promise<Exclude<R, Banned>> {
    if (this.role !== 'primary') return Promise.reject(new Error('not_primary'))
    return this.engine.trade(fn)
  }

  sync(): Promise<void> {
    if (this.role !== 'primary') return this.refresh()
    return this.engine.sync()
  }

  /**
   * Flushes once on the old server; in an outage the unsent events cannot go
   * anywhere, so they are dropped and counted. Then the new client starts.
   */
  async switchServer(url: string | null): Promise<{ label: string; old: string; dropped: number }> {
    const old = this.server.label
    let dropped = 0
    if (this.role === 'primary') {
      await this.engine.flush()
      if (this.engine.isUnreachable()) dropped = this.engine.unsentCount()
    }
    await this.kv.set(SERVER_KEY, url ?? LOCAL)
    await this.restart(url)
    return { label: this.server.label, old, dropped }
  }

  /**
   * A fresh engine on `setting`, started as primary or refreshed as secondary. `deleted`: after the
   * account's delete.
   */
  private async restart(setting: string | null, deleted = false): Promise<void> {
    this.useServer(setting, deleted)
    // Listing and order ids belong to one server: nothing loaded or pending on the old one survives.
    await this.io.publish({
      server: setting,
      notice: null,
      view: null,
      market: MARKET_DEFAULT,
      orders: ORDERS_DEFAULT,
      chat: CHAT_DEFAULT,
      boards: BOARDS_DEFAULT,
    })
    await this.io.clearDialog()
    if (this.role === 'primary') await this.becomePrimary()
    else await this.becomeSecondary()
  }

  /** Starts the device flow; polling is the session's, so it outlives a closed dialog. */
  async link(): Promise<void> {
    if (this.role !== 'primary') throw new Error('not_primary')
    // The sandbox save never links: nothing granted may reach the market or chat.
    if (this.server.sandbox) return
    const engine = this.engine
    let start: LinkStart | LinkRefused | Unauthorized
    try {
      start = await engine.call((client, auth) => client.linkStart(auth))
    } catch {
      // Unreachable: the band already says so, and the press stays a no-op.
      return
    }
    if ('reason' in start) return
    if ('refusal' in start) {
      this.io.toast(start.message)
      return
    }
    // The code, the URL and the interval are the server's: GitHub's on a real host.
    const gen = ++this.linkGen
    await this.io.dialogLink({ code: start.code, url: start.url })
    let polls = 0
    const poll = async () => {
      if (gen !== this.linkGen) return
      polls += 1
      let r: LinkPoll | Unauthorized
      try {
        r = await engine.call((client, auth) => client.linkPoll(auth, start.code))
      } catch {
        r = { status: 'pending' }
      }
      if (gen !== this.linkGen) return
      if ('status' in r && r.status === 'linked') {
        this.linkGen += 1
        engine.setAccount(r.account)
        await this.io.dialogLink(null)
        return
      }
      if ('status' in r && r.status === 'ended') {
        this.linkGen += 1
        await this.io.dialogLink(null)
        this.io.toast(r.message)
        return
      }
      if ('reason' in r || polls >= LINK_POLLS) {
        await this.io.dialogLink(null)
        return
      }
      this.io.after(start.intervalMs, () => void poll())
    }
    this.io.after(start.intervalMs, () => void poll())
  }

  readonly market: GameHandle['market'] = {
    browse: (query) => this.read((client, auth) => client.browse(auth, query)),
    myOrders: () => this.read((client, auth) => client.myOrders(auth)),
    matching: (itemId) => this.read((client, auth) => client.matchingOrders(auth, itemId)),
  }

  /**
   * A market read: through the engine when playing, expiring what is due; with the stored token
   * otherwise, through the reads that leave expiries to the primary.
   */
  private async read<T>(
    fn: (client: SecondaryReads, auth: Auth) => Promise<T>,
  ): Promise<Exclude<T, Banned>> {
    if (this.role === 'primary') return this.engine.call(fn)
    const token = await this.kv.get(this.server.tokenKey)
    if (typeof token !== 'string') throw new Error('not_started')
    let r: T
    try {
      r = await fn(this.server.reads, { deviceToken: token })
    } catch {
      throw new Error('unreachable')
    }
    return this.unbanned(r)
  }

  clock(): ReturnType<GameHandle['clock']> {
    return this.engine.clock()
  }

  chatSeen(now: number): void {
    this.poller.chatSeen(now)
  }

  /** Any session posts: no flush, no lease. A primary in an outage answers unreachable without a call. */
  async chat(text: string): Promise<Exclude<ChatResult, Banned>> {
    if (this.role === 'primary' && this.engine.isUnreachable()) throw new Error('unreachable')
    const auth = await this.storedAuth()
    let answer: ChatResult
    try {
      answer = await this.server.client.chat(auth, text)
    } catch {
      throw new Error('unreachable')
    }
    const result = this.unbanned(answer)
    if (result.ok) await this.poller.insert(result.message)
    return result
  }

  host(): ReturnType<GameHandle['host']> {
    return this.server.host
  }

  accountId(): string | null {
    return this.engine.accountId()
  }

  view(): Promise<GameView | null> {
    return this.io.view()
  }

  pollWorld(): Promise<WorldSnapshot | null> {
    return this.poller.pollNow()
  }

  async leaderboards(): Promise<Boards | Unauthorized> {
    const auth = await this.storedAuth()
    let r: Boards | Unauthorized | Banned
    try {
      r = await this.server.client.leaderboards(auth)
    } catch {
      throw new Error('unreachable')
    }
    return this.unbanned(r)
  }

  /** Deletes every Promptfall key but the lease and the settings, then starts over on the same server. */
  reset(): Promise<void> {
    return this.wipe(false)
  }

  /** The reset; `deleted`: after the account's delete, so a refused start says the delete happened. */
  private async wipe(deleted: boolean): Promise<void> {
    await this.claim()
    await this.engine.stop()
    for (const key of await this.kv.keys()) {
      if (key !== LEASE_KEY && key !== SETTINGS_KEY && key !== SERVER_KEY) await this.kv.delete(key)
    }
    await this.restart(this.setting, deleted)
  }

  async deleteAccount(): Promise<void> {
    let deleted = false
    try {
      await this.claim()
      // A ban lets the delete through, with the stored token even when it refused the start.
      const answer = await this.engine.deleteAccount()
      deleted = !('reason' in answer)
    } catch {
      // Unreachable, not started, or a ban from a server that refuses the delete too.
    }
    if (!deleted) {
      this.refuseInPane(NOT_DELETED)
      return
    }
    await this.wipe(true)
    // Only a fresh account playing gets the notice, over the welcome: it says why it is fresh. A
    // refused start has paused with the refusal, which says the delete happened.
    if (this.engine.accountId() !== null && !this.engine.isPaused()) {
      this.engine.notice(DELETED_NOTICE, WELCOME_MS)
    }
  }

  setCadence(ms: number): void {
    if (ms === this.cadence && this.tickTimer) return
    this.cadence = ms
    this.tickTimer?.cancel()
    this.tickTimer = this.io.every(ms, () => void this.tick())
  }

  cadenceMs(): number {
    return this.cadence
  }

  /**
   * The session is ending. Flush what is buffered while the hook's budget
   * allows; when the process ends too, stop the timers and give the lease up.
   */
  async end(processEnds: boolean, remainingMs: () => number): Promise<void> {
    if (this.role === 'primary' && remainingMs() > 200) await this.engine.flush()
    if (!processEnds) return
    this.tickTimer?.cancel()
    for (const timer of this.timers) timer.cancel()
    this.poller.stop()
    if (this.role === 'primary') await release(this.kv, this.owner)
  }

  /** Resolves once the view and any pane notice from the last events have landed. */
  async settled(): Promise<void> {
    await this.engine.settled()
    await this.pending
  }

  /** Takes the lease if another session holds it, and waits for the promotion: the commands act on its engine. */
  async claim(): Promise<void> {
    if (this.role === 'primary') return
    await this.followSetting()
    if (await claim(this.kv, this.owner, await this.io.now())) await this.becomePrimary()
  }

  /**
   * The player's own prompt: it takes the lease without waiting for the promotion, so a hanging
   * server holds nothing, and rests the party once this session's engine has started.
   */
  async prompt(at: number): Promise<void> {
    if (this.role !== 'primary') {
      await this.followSetting()
      if (await claim(this.kv, this.owner, await this.io.now())) {
        // Not awaited, so nothing reports a rejection: the engine's start rides out a failed
        // bootstrap itself, and a failed publish or poll start leaves the next one to try.
        this.becomePrimary().catch(() => undefined)
        // The promotion's start is queued on its engine's lock by now.
        void this.engine.idle().then(() => this.apply({ t: 'rest' }, at))
        return
      }
    }
    this.apply({ t: 'rest' }, at)
  }

  /** The server setting is machine-wide: a session that is not primary follows a switch made elsewhere. */
  private async followSetting(): Promise<void> {
    const setting = await this.readSetting()
    if (setting === this.setting) return
    this.useServer(setting)
    // Chat drafts and loaded boards belong to the old server too.
    await this.io.publish({ server: setting, chat: CHAT_DEFAULT, boards: BOARDS_DEFAULT })
  }

  /**
   * Flush only while this session still holds the lease: another session may
   * have claimed it since the last renewal, and its progress must not be undone.
   */
  private async flushIfOwner(): Promise<void> {
    if (this.role !== 'primary') return
    if (!(await holds(this.kv, this.owner))) {
      await this.becomeSecondary()
      return
    }
    // The in-process ledger's only sweep: expiries and returns before each timed flush.
    await this.server.host?.sweep()
    await this.engine.flushIfIdle()
  }

  private async tick(): Promise<void> {
    if (!this.canApply()) return
    this.engine.apply({ t: 'tick' }, await this.io.now())
  }

  private async becomePrimary(): Promise<void> {
    this.role = 'primary'
    await this.engine.start()
    await this.io.publish({ mode: this.mode() })
    await this.poller.start()
    if (this.firstRun) {
      this.firstRun = false
      this.io.toast(WELCOME)
      this.engine.notice(WELCOME, WELCOME_MS)
      await this.engine.settled()
    }
  }

  private async becomeSecondary(): Promise<void> {
    if (this.role === 'primary') {
      // Its retry timers, publishes and notice must not outlive the lease.
      const discarded = this.engine
      this.engine = this.makeEngine()
      await discarded.stop()
    }
    this.role = 'secondary'
    await this.io.publish({ mode: this.mode() })
    await this.refresh()
    await this.poller.start()
  }

  private async renew(): Promise<void> {
    if (this.role === 'secondary') await this.followSetting()
    const ok = await acquire(this.kv, this.owner, await this.io.now())
    if (ok && this.role === 'secondary') await this.becomePrimary()
    else if (!ok && this.role === 'primary') await this.becomeSecondary()
    else if (!ok) await this.refresh()
  }

  /**
   * A secondary's read-only view: bootstrap with the stored token, which writes
   * nothing, and the delivery applied on top of the committed state.
   */
  private async refresh(): Promise<void> {
    const token = await this.kv.get(this.server.tokenKey)
    if (typeof token !== 'string' || token === this.orphanToken) return
    let boot: Awaited<ReturnType<ResolvedServer['client']['bootstrap']>>
    try {
      boot = await this.server.client.bootstrap({
        clientVersion: CLIENT_VERSION,
        deviceToken: token,
      })
    } catch {
      return
    }
    if ('refusal' in boot) {
      // Unknown: only the primary resets and mints, so wait for it to store a new token. Any other
      // refusal the primary shows; the next renewal asks again.
      if (boot.refusal === 'unknown') this.orphanToken = token
      return
    }
    if (boot.deviceToken !== token) {
      // An older server minted for this token: it is unknown there. Wait for the primary to store a new one.
      this.orphanToken = token
      return
    }
    if (boot.state.v !== SIM_VERSION) {
      await this.io.publish({ view: null })
      return
    }
    const state = replay(
      boot.state,
      boot.delivery.events.map((e) => e.event),
    ).state
    const account = toAccountView(
      boot.account,
      boot.config,
      this.server.label,
      0,
      this.server.sandbox,
    )
    await this.io.publish({ view: toGameView(state, boot.account.accountId, false, account) })
  }

  /** A refusal in the pane's message window for five seconds. */
  private refuseInPane(reason: string): void {
    const gen = ++this.paneNoticeGen
    this.pending = this.pending.then(() => this.io.paneNotice(reason)).catch(() => undefined)
    this.io.after(5000, () => {
      if (gen === this.paneNoticeGen) void this.io.paneNotice(null)
    })
  }

  private onEffects(
    effects: Effect[],
    at: number | undefined,
    view: GameView | null,
    arrived?: number,
  ): void {
    // Before the toasts, and synchronously: the next render observes the view these effects
    // came with, so the hits must already be on the timeline (engine.apply publishes first).
    if (at !== undefined) this.lastAt = at
    if (view?.boss) this.bossNames.set(view.boss.bossId, view.boss.name)
    // A tick's battle time plays stretched over the cadence: 2 s ticks at real speed, 5 s slower.
    const now = at ?? this.lastAt
    const cadence = this.cadence || TURN_CADENCE_MS
    // A monster the tick brought acts in it: the timeline knows it before the effects play, not
    // only from the next redraw (the desktop's is a round away).
    if (view) this.stage.timeline.admit(view, now)
    // A delivery plays at the last tick's time, but a lone drop in it (a sandbox item) falls when
    // it arrived: at that stale time its chest would be over before it was drawn.
    const starts = this.stage.timeline.onEffects(effects, now, cadence, arrived ?? now)
    if (view) {
      this.stage.gauges.onTick(view, now, cadence, this.stage.timeline)
      this.stage.log.onEffects(effects, starts, view, now, cadence, this.stage.timeline)
    }
    for (const loop of this.loops.values()) loop.wake()
    for (const effect of effects) if (effect.k === 'rejected') this.refuseInPane(effect.reason)
    const toasts = toastsFor(effects, view, { bossName: (id) => this.bossNames.get(id) ?? null })
    for (const toast of toasts) this.io.toast(toast.text, toast.timeoutMs)
    // After the toasts: each cue the burst earned, once.
    for (const cue of new Set(toasts.map((t) => t.cue))) if (cue) void this.playCue(cue)
  }
}

// The scan that checks $.state calls reads atoms declared in the calling module.
const viewAtom = atom({ plugin: 'promptfall', key: 'view' } as const, null)
const modeAtom = atom({ plugin: 'promptfall', key: 'mode' } as const, 'primary')
const noticeAtom = atom({ plugin: 'promptfall', key: 'notice' } as const, null)
const leaseOwnerAtom = atom({ plugin: 'promptfall', key: 'leaseOwner' } as const, null)
const dialogAtom = atom({ plugin: 'promptfall', key: 'dialog' } as const, DIALOG_DEFAULT)
const serverAtom = atom({ plugin: 'promptfall', key: 'server' } as const, null)
const marketAtom = atom({ plugin: 'promptfall', key: 'market' } as const, MARKET_DEFAULT)
const ordersAtom = atom({ plugin: 'promptfall', key: 'orders' } as const, ORDERS_DEFAULT)
const worldAtom = atom({ plugin: 'promptfall', key: 'world' } as const, WORLD_DEFAULT)
const chatAtom = atom({ plugin: 'promptfall', key: 'chat' } as const, CHAT_DEFAULT)
const settingsAtom = atom({ plugin: 'promptfall', key: 'settings' } as const, SETTINGS_DEFAULT)
const rendererAtom = atom({ plugin: 'promptfall', key: 'renderer' } as const, 'unknown')
const boardsAtom = atom({ plugin: 'promptfall', key: 'boards' } as const, BOARDS_DEFAULT)

let game: GameSession | null = null
/** PROMPTFALL_SANDBOX=1, read at session start and at the desktop attach. */
let sandbox = false

export const register: Register = (on) => {
  registerBand(on, () => game)
  registerDialog(on, () => game)
  registerCommand(
    on,
    () => game,
    () => sandbox,
  )

  on('session.start', async ($, e, next) => {
    game = null
    sandbox = (await $.env.get('PROMPTFALL_SANDBOX')) === '1'
    await $.command.register(commandSpec(sandbox))
    // A set lease owner means this session ran a game before a hot reload, on any surface.
    const hadGame = (await read($, leaseOwnerAtom)) !== null
    const settings = parseSettings(await $.store.get(`promptfall:${SETTINGS_KEY}`))
    await update($, settingsAtom, () => settings)
    // A forced renderer skips the probe; `auto` leaves the atom to the band's probe.
    if (e.surface === 'terminal' && settings.renderer !== 'auto') {
      await update($, rendererAtom, () => settings.renderer)
    }
    if ((e.isInteractive && e.surface === 'terminal') || hadGame) {
      const session = new GameSession({
        now: () => $.clock.now(),
        every: (ms, fn) => $.clock.every(ms, fn),
        after: (ms, fn) => $.clock.after(ms, fn),
        store: {
          get: (key) => $.store.get(key),
          set: (key, value) => $.store.set(key, value),
          delete: (key) => $.store.delete(key),
          keys: () => $.store.keys(),
        },
        publish: async (patch) => {
          if (patch.view !== undefined) await update($, viewAtom, () => patch.view ?? null)
          if (patch.mode !== undefined) await update($, modeAtom, () => patch.mode ?? 'primary')
          if (patch.notice !== undefined) await update($, noticeAtom, () => patch.notice ?? null)
          if (patch.leaseOwner !== undefined) {
            await update($, leaseOwnerAtom, () => patch.leaseOwner ?? null)
          }
          if (patch.server !== undefined) await update($, serverAtom, () => patch.server ?? null)
          if (patch.market !== undefined) {
            await update($, marketAtom, () => patch.market ?? MARKET_DEFAULT)
          }
          if (patch.orders !== undefined) {
            await update($, ordersAtom, () => patch.orders ?? ORDERS_DEFAULT)
          }
          if (patch.world !== undefined) {
            await update($, worldAtom, () => patch.world ?? WORLD_DEFAULT)
          }
          if (patch.chat !== undefined) await update($, chatAtom, () => patch.chat ?? CHAT_DEFAULT)
          if (patch.boards !== undefined) {
            await update($, boardsAtom, () => patch.boards ?? BOARDS_DEFAULT)
          }
        },
        toast: (text, timeoutMs) =>
          timeoutMs === undefined ? $.ui.toast(text) : $.ui.toast(text, { timeoutMs }),
        leaseOwner: () => read($, leaseOwnerAtom),
        mode: () => read($, modeAtom),
        paneNotice: async (text) => {
          await update($, dialogAtom, (d) => ({ ...DIALOG_DEFAULT, ...d, paneNotice: text }))
        },
        dialogLink: async (link) => {
          await update($, dialogAtom, (d) => ({ ...DIALOG_DEFAULT, ...d, link }))
        },
        clearDialog: async () => {
          await update($, dialogAtom, (d) => ({
            ...DIALOG_DEFAULT,
            ...d,
            link: null,
            sell: null,
            menu: null,
          }))
        },
        readWorld: () => read($, worldAtom),
        readNotice: () => read($, noticeAtom),
        fetch: timedFetch(
          (url, init) => $.http.fetch(url, init),
          (ms, fn) => $.clock.after(ms, fn),
        ),
        blit: (args) => $.ui.blit(args),
        invalidate: () => $.ui.invalidate('ui.render'),
        view: () => read($, viewAtom),
        // Per machine: another session's /promptfall sound|motion writes the store, not our atom.
        settings: async () => parseSettings(await $.store.get(`promptfall:${SETTINGS_KEY}`)),
        play: (asset, gain) => $.audio.play({ asset }, { gain }),
        sandbox,
      })
      game = session
      await session.start()
    }
    return next(e)
  })

  on('session.attach', async ($, e, next) => {
    if (e.surface === 'desktop') {
      sandbox = (await $.env.get('PROMPTFALL_SANDBOX')) === '1'
      const settings = parseSettings(await $.store.get(`promptfall:${SETTINGS_KEY}`))
      await update($, settingsAtom, () => settings)
    }
    if (e.surface === 'desktop' && !game) {
      const session = new GameSession({
        now: () => $.clock.now(),
        every: (ms, fn) => $.clock.every(ms, fn),
        after: (ms, fn) => $.clock.after(ms, fn),
        store: {
          get: (key) => $.store.get(key),
          set: (key, value) => $.store.set(key, value),
          delete: (key) => $.store.delete(key),
          keys: () => $.store.keys(),
        },
        publish: async (patch) => {
          if (patch.view !== undefined) await update($, viewAtom, () => patch.view ?? null)
          if (patch.mode !== undefined) await update($, modeAtom, () => patch.mode ?? 'primary')
          if (patch.notice !== undefined) await update($, noticeAtom, () => patch.notice ?? null)
          if (patch.leaseOwner !== undefined) {
            await update($, leaseOwnerAtom, () => patch.leaseOwner ?? null)
          }
          if (patch.server !== undefined) await update($, serverAtom, () => patch.server ?? null)
          if (patch.market !== undefined) {
            await update($, marketAtom, () => patch.market ?? MARKET_DEFAULT)
          }
          if (patch.orders !== undefined) {
            await update($, ordersAtom, () => patch.orders ?? ORDERS_DEFAULT)
          }
          if (patch.world !== undefined) {
            await update($, worldAtom, () => patch.world ?? WORLD_DEFAULT)
          }
          if (patch.chat !== undefined) await update($, chatAtom, () => patch.chat ?? CHAT_DEFAULT)
          if (patch.boards !== undefined) {
            await update($, boardsAtom, () => patch.boards ?? BOARDS_DEFAULT)
          }
        },
        toast: (text, timeoutMs) =>
          timeoutMs === undefined ? $.ui.toast(text) : $.ui.toast(text, { timeoutMs }),
        leaseOwner: () => read($, leaseOwnerAtom),
        mode: () => read($, modeAtom),
        paneNotice: async (text) => {
          await update($, dialogAtom, (d) => ({ ...DIALOG_DEFAULT, ...d, paneNotice: text }))
        },
        dialogLink: async (link) => {
          await update($, dialogAtom, (d) => ({ ...DIALOG_DEFAULT, ...d, link }))
        },
        clearDialog: async () => {
          await update($, dialogAtom, (d) => ({
            ...DIALOG_DEFAULT,
            ...d,
            link: null,
            sell: null,
            menu: null,
          }))
        },
        readWorld: () => read($, worldAtom),
        readNotice: () => read($, noticeAtom),
        fetch: timedFetch(
          (url, init) => $.http.fetch(url, init),
          (ms, fn) => $.clock.after(ms, fn),
        ),
        blit: (args) => $.ui.blit(args),
        invalidate: () => $.ui.invalidate('ui.render'),
        view: () => read($, viewAtom),
        // Per machine: another session's /promptfall sound|motion writes the store, not our atom.
        settings: async () => parseSettings(await $.store.get(`promptfall:${SETTINGS_KEY}`)),
        play: (asset, gain) => $.audio.play({ asset }, { gain }),
        sandbox,
      })
      game = session
      await session.start()
    }
    return next(e)
  })

  on('session.end', async (_$, e, next) => {
    // A /clear or a resume goes on in this process with no session.start, so the game keeps running.
    const processEnds = e.reason !== 'clear' && e.reason !== 'resume'
    await game?.end(processEnds, () => next.budget.remainingMs)
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    await $.clock.now()
    game?.setCadence(TURN_CADENCE_MS)
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const at = await $.clock.now()
    game?.apply({ t: 'tool_call' }, at)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const at = await $.clock.now()
    if (!e.agentId) {
      game?.apply({ t: 'turn_end' }, at)
      game?.setCadence(IDLE_CADENCE_MS)
    }
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    const at = await $.clock.now()
    // The player's own prompts rest the party: typed here, or sent through the Remote Control bridge.
    if (e.origin.kind === 'composer' || e.origin.kind === 'bridge') {
      // The player is here: this session plays, even if another one took the lease.
      await game?.prompt(at)
    }
    return next(e)
  })
}
