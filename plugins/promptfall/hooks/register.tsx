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
import { type ReactiveEvent, ReactivePacer } from './reactive'
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
import { type StageEffect, StageTimeline } from './stage/timeline'
import { SKIPPED_PLAY_MS, SOUND_GAIN } from './stage/tuning'
import {
  BOARDS_DEFAULT,
  CHAT_DEFAULT,
  DIALOG_DEFAULT,
  JOURNAL_DEFAULT,
  MARKET_DEFAULT,
  ORDERS_DEFAULT,
  parseSettings,
  SETTINGS_DEFAULT,
  SETTINGS_KEY,
  soundWasBoolean,
  WORLD_DEFAULT,
} from './state'
import { PREFIX, SANDBOX_PREFIX, type StoreCalls, StoreKeyValue } from './storage'
import { STAMP_MS, SUMMARY_MS, SummaryRecords } from './summary'
import { LONG_MS, type Toast, toastsFor, worldToast } from './toasts'
import { toolKind } from './tool-kinds'
import { registerBand } from './ui/band'
import { registerDialog } from './ui/dialog'
import type {
  Auth,
  Banned,
  Boards,
  ChatResult,
  FetchLike,
  Journal,
  LinkPoll,
  LinkRefused,
  LinkStart,
  MarketResult,
  RestDaysResult,
  Unauthorized,
  WorldSnapshot,
} from './vendor/protocol.js'
import { dayOf } from './vendor/protocol.js'
import { type PlayerEvent, replay, SIM_VERSION } from './vendor/sim.js'
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
  /** Which of the agents view's background processes this is, if any; see BgKind. */
  bgKind: () => Promise<BgKind>
  /** No surface draws the session: on a terminal, its REPL is gone (the agents view took it). */
  drawsNowhere: () => Promise<boolean>
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
  /**
   * Plays a file of the plugin's; resolves once played or skipped (a terminal off macOS has no
   * player), rejects when the clip cannot play.
   */
  play: (asset: string, gain: number) => Promise<void>
  /** The surface the session plays on: the desktop plays through its own audio element anywhere. */
  surface: RenderSurface
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
/** How often a terminal session checks it is still drawn, and a job retries a free lease. */
const QUICK_MS = 2000
/** How long a job keeps retrying a free lease at QUICK_MS before it waits for its renewals. */
const PICK_UP_MS = 60_000

/**
 * Claude Code's agents view runs conversations in background processes, and keeps a spare one warm
 * for the next new task. `job`: the process a conversation was moved into, the one the player comes
 * back to (`CLAUDE_BG_SOURCE=slash`). `spare`: the warm one, which nobody looks at until a prompt in
 * it (`spare`, or unset at its launch). `plain`: anything else. Read from the engine's own
 * environment (2.1.296), which no API exposes: missing, it is `plain`.
 */
type BgKind = 'plain' | 'job' | 'spare'

const WELCOME = 'Welcome to Promptfall. /promptfall heroes to meet your party'
/**
 * The welcome's notice when sound is not off: the toast keeps WELCOME. The sound clause leads, so
 * the band's one notice row shows `/promptfall sound off` whole from 100 columns up.
 */
const WELCOME_SOUND =
  'Sound on; /promptfall sound off silences it. Welcome to Promptfall. /promptfall heroes to meet your party.'
const WELCOME_MS = 20_000
/** Once per machine, for a setting stored before the steps: sound was off by default then. */
const SOUND_NEWS = 'Sound is now on by default. /promptfall sound off silences it.'
/** Set with the boolean's rewrite, deleted by the primary that toasts it: news no session lost. */
const SOUND_NEWS_KEY = `${PREFIX}soundNews`

/**
 * One session's game: the engine, the lease, and the timers. Module state, so
 * a hot reload starts it over; the session's atoms and the store carry on.
 */
class GameSession implements GameHandle {
  engine: GameEngine
  private readonly kv: StoreKeyValue
  /** The session summary's snapshot and stamp: the primary's alone to read and write. */
  private readonly summary: SummaryRecords
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
  private steppingAside = false
  private pending: Promise<void> = Promise.resolve()
  private firstRun = false
  /** A play here was skipped or refused: no cue is tried for the rest of the session. */
  private soundSilent = false
  private paneNoticeGen = 0
  private readonly poller: WorldPoller
  private readonly loops = new Map<RenderSurface, StageLoop>()
  private readonly pacer = new ReactivePacer()
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
            release: (now) => this.releaseHeld(now),
            nextRelease: (now) => this.stage.log.nextRelease(now),
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
    this.summary = new SummaryRecords(this.kv)
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
   * Plays a cue on the primary at the stored step. `/promptfall off` hides the band, not the cues.
   * On a terminal, a play the engine answers before any clip could end was skipped (no player off
   * macOS), and one it rejects cannot play: either marks the session, and no cue is tried again.
   */
  private async playCue(cue: Cue): Promise<void> {
    if (this.role !== 'primary' || this.soundSilent) return
    const { sound } = await this.io.settings()
    if (sound === 'off' || this.role !== 'primary') return
    // Read alongside the play, not before it: the cue starts with its toast. A clock that fails
    // reads as a play that took its time, which marks nothing.
    const started = this.io.now().catch(() => Number.NEGATIVE_INFINITY)
    const played = await this.io
      .play(CUE_ASSET[cue], SOUND_GAIN[sound])
      .then(
        () => this.io.now().then(async (ended) => ended - (await started) >= SKIPPED_PLAY_MS),
        () => false,
      )
      .catch(() => true)
    if (played || this.io.surface !== 'terminal' || this.soundSilent) return
    this.soundSilent = true
    await this.io.publish({ soundSilent: true }).catch(() => undefined)
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
    // Before anything else writes the settings back, which would turn the boolean into a step.
    const stored = await this.io.store.get(`${PREFIX}${SETTINGS_KEY}`)
    if (soundWasBoolean(stored)) {
      // In the store, not this session: a secondary that rewrites it may close before a promotion.
      await this.io.store.set(SOUND_NEWS_KEY, true)
      await this.io.store.set(`${PREFIX}${SETTINGS_KEY}`, parseSettings(stored))
    }
    const setting = await this.readSetting()
    if (setting !== null) this.useServer(setting)
    // A new session tries its plays afresh: a player may have appeared since.
    await this.io.publish({ server: setting, soundSilent: false })
    // A code from before a hot reload has no poll behind it any more.
    await this.io.clearDialog()
    this.owner = (await this.io.leaseOwner()) ?? crypto.randomUUID()
    this.off = (await this.io.mode()) === 'off'
    await this.io.publish({ leaseOwner: this.owner })
    // A spare plays only once a prompt in it claims: the lease it would take is the player's.
    const kind = await this.io.bgKind()
    if (kind !== 'spare' && (await acquire(this.kv, this.owner, await this.io.now())))
      await this.becomePrimary()
    else await this.becomeSecondary()
    this.setCadence(IDLE_CADENCE_MS)
    // A demoted primary discards its engine, so nothing it held is ever submitted.
    this.timers.push(this.io.every(FLUSH_MS, () => void this.flushIfOwner()))
    this.timers.push(this.io.every(LEASE_RENEW_MS, () => void this.renew()))
    if (this.io.surface === 'terminal') {
      this.timers.push(this.io.every(QUICK_MS, () => void this.checkDrawn()))
    }
    if (kind === 'job') this.pickUp()
    this.timers.push(this.io.every(STAMP_MS, () => void this.stamp()))
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

  /**
   * Camp off, only while the party camps: the sim also breaks camp on events the plugin never
   * sees, so the engine's own state is the flag, read before any await so two breaks at once send
   * one off, and the off goes once per camp, unpaced.
   */
  async breakCamp(at: number): Promise<boolean> {
    if (!this.canApply() || !this.engine.camping()) return false
    this.engine.apply({ t: 'camp', on: false }, at)
    return true
  }

  /** A reactive event, on the primary and at its kind's pace. `fresh`: a turn's own start. */
  react(event: ReactiveEvent, at: number, fresh = false): void {
    if (this.canApply() && this.pacer.admits(event, at, fresh)) this.engine.apply(event, at)
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
      // The old server's account stops playing here.
      await this.stamp()
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
      journal: JOURNAL_DEFAULT,
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

  async journal(): Promise<Journal | Unauthorized> {
    const auth = await this.storedAuth()
    let r: Journal | Unauthorized | Banned
    try {
      r = await this.server.client.journal(auth)
    } catch {
      throw new Error('unreachable')
    }
    return this.unbanned(r)
  }

  async setRestDays(days: number[]): Promise<Exclude<RestDaysResult, Banned>> {
    const auth = await this.storedAuth()
    let r: RestDaysResult
    try {
      r = await this.server.client.setRestDays(auth, days)
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
    // The party is out of camp when the save rests; a clear or a resume plays on in camp.
    if (processEnds) await this.breakCamp(await this.io.now())
    if (this.role === 'primary' && remainingMs() > 200) await this.engine.flush()
    await this.stamp()
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
    // Chat drafts, loaded boards and the journal belong to the old server too.
    await this.io.publish({
      server: setting,
      chat: CHAT_DEFAULT,
      boards: BOARDS_DEFAULT,
      journal: JOURNAL_DEFAULT,
    })
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
    const now = await this.io.now()
    // Before the accept check: a paused session still raises what it held.
    this.releaseHeld(now)
    if (!this.canApply()) return
    this.engine.apply({ t: 'tick' }, now)
  }

  /** A stage is mounted on some surface: only then does a held toast wait for its show time. */
  private stageDrawn(): boolean {
    return [...this.loops.values()].some((loop) => loop.isDrawn())
  }

  /**
   * The drain: raises the held toasts due by `now`. With no stage drawn on any surface (band off,
   * collapsed, paused, secondary) everything held is due: nobody sees the picture it waits for.
   * Answers whether any was due.
   */
  private releaseHeld(now: number): boolean {
    const due = this.stage.log.release(this.stageDrawn() ? now : Number.POSITIVE_INFINITY)
    this.raise(due)
    return due.length > 0
  }

  /** Raises toasts on the primary, then each cue they earned, once. */
  private raise(toasts: readonly Toast[]): void {
    if (this.role !== 'primary') return
    for (const toast of toasts) this.io.toast(toast.text, toast.timeoutMs)
    for (const cue of new Set(toasts.map((t) => t.cue))) if (cue) void this.playCue(cue)
  }

  private async becomePrimary(): Promise<void> {
    this.role = 'primary'
    await this.engine.start()
    await this.io.publish({ mode: this.mode() })
    await this.poller.start()
    if ((await this.io.store.get(SOUND_NEWS_KEY)) === true) {
      await this.io.store.delete(SOUND_NEWS_KEY)
      this.io.toast(SOUND_NEWS, LONG_MS)
    }
    const firstRun = this.firstRun
    if (firstRun) {
      this.firstRun = false
      this.io.toast(WELCOME)
      const { sound } = await this.io.settings()
      this.engine.notice(sound === 'off' ? WELCOME : WELCOME_SOUND, WELCOME_MS)
      await this.engine.settled()
    }
    await this.summarize(firstRun)
  }

  /**
   * The session summary: the play since this account was last seen, in a toast and the message
   * window, as the welcome is; a first launch only takes the snapshot the next one counts from.
   */
  private async summarize(firstRun: boolean): Promise<void> {
    const account = this.engine.accountId()
    const view = await this.io.view()
    if (account === null || view === null || this.engine.isPaused()) return
    const now = await this.io.now()
    // The local day: the Journal shows the same goal before its read answers.
    const line = await this.summary.onPrimary({
      tokenKey: this.server.tokenKey,
      account,
      view,
      now,
      day: dayOf(now),
      firstRun,
    })
    if (line === null || this.role !== 'primary') return
    this.io.toast(line, LONG_MS)
    this.engine.notice(line, SUMMARY_MS)
    await this.engine.settled()
  }

  /** The account was seen playing: written by the primary only, while it plays and as it stops. */
  private async stamp(): Promise<void> {
    const account = this.engine.accountId()
    if (this.role !== 'primary' || account === null) return
    await this.summary
      .stamp(this.server.tokenKey, account, await this.io.now())
      .catch(() => undefined)
  }

  private async becomeSecondary(): Promise<void> {
    if (this.role === 'primary') {
      await this.stamp()
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

  /**
   * A terminal session that draws nowhere plays for nobody: the agents view took its REPL, and no
   * hook says so. Within QUICK_MS it flushes what it holds while the lease is still its own, steps
   * back and gives the lease up, so the process the player went to picks it up.
   */
  private async checkDrawn(): Promise<void> {
    if (this.role !== 'primary' || this.steppingAside) return
    if (!(await this.io.drawsNowhere())) return
    this.steppingAside = true
    try {
      const held = await holds(this.kv, this.owner)
      if (held) await this.engine.flush()
      await this.becomeSecondary()
      if (held) await release(this.kv, this.owner)
    } finally {
      this.steppingAside = false
    }
  }

  /**
   * The process the conversation moved into starts while the one it left still holds the lease:
   * it tries a free lease every QUICK_MS for its first minute, so the band plays a moment after
   * the old process lets go, rather than at the next renewal.
   */
  private pickUp(): void {
    let left = PICK_UP_MS / QUICK_MS
    const timer = this.io.every(QUICK_MS, () => {
      left -= 1
      if (left <= 0) timer.cancel()
      void this.pickUpOnce()
    })
    this.timers.push(timer)
  }

  private async pickUpOnce(): Promise<void> {
    if (this.role !== 'secondary' || (await this.io.drawsNowhere())) return
    if (!(await acquire(this.kv, this.owner, await this.io.now()))) return
    await this.followSetting()
    await this.becomePrimary()
  }

  private async renew(): Promise<void> {
    // Nothing here is seen any more: no renewal, and no read-only refresh either. checkDrawn steps
    // back.
    if (this.io.surface === 'terminal' && (await this.io.drawsNowhere())) return
    if (this.role === 'secondary') await this.followSetting()
    // A spare only follows: it never takes a free lease (see BgKind).
    if (this.role === 'secondary' && (await this.io.bgKind()) === 'spare') return this.refresh()
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
    effects: StageEffect[],
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
    // A toast with a show time waits for it while a stage is drawn; the rest land with the burst.
    this.raise(this.stageDrawn() ? this.stage.log.hold(toasts, this.stage.timeline, now) : toasts)
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
const journalAtom = atom({ plugin: 'promptfall', key: 'journal' } as const, JOURNAL_DEFAULT)
const soundSilentAtom = atom({ plugin: 'promptfall', key: 'soundSilent' } as const, false)
const surfaceAtom = atom({ plugin: 'promptfall', key: 'surface' } as const, null)

let game: GameSession | null = null
/** The calls the permission-denied hook named, until each resolves: their failure is no mishap. */
const denied = new Set<string>()
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
    // Claude Code settles "no pictures" in a background worker before a terminal attaches, and its
    // re-check on attach rules the same unless told to force them (2.1.296). A worker started from
    // a terminal that draws pictures (Ghostty, cmux, kitty), outside tmux or screen, forces them, so
    // a conversation back from the agents view keeps its image band. It skips the probe too: run
    // before the attach, the probe would hear "no pictures" and settle the band on half-blocks.
    if (
      e.surface === 'terminal' &&
      settings.renderer !== 'raster' &&
      (await $.env.get('CLAUDE_CODE_SESSION_KIND')) === 'bg' &&
      (await $.env.get('TMUX')) === undefined &&
      (await $.env.get('STY')) === undefined &&
      ((await $.env.get('GHOSTTY_RESOURCES_DIR')) !== undefined ||
        (await $.env.get('KITTY_WINDOW_ID')) !== undefined)
    ) {
      await $.env.set('CLAUDE_CODE_FORCE_TERMINAL_IMAGES', '1')
      await update($, rendererAtom, () => 'image')
    }
    // A forced renderer skips the probe; `auto` leaves the atom to the band's probe.
    if (e.surface === 'terminal' && settings.renderer !== 'auto') {
      await update($, rendererAtom, () => settings.renderer)
    }
    const started = e.surface === 'terminal' || e.surface === 'desktop' ? e.surface : null
    if (started !== null) await update($, surfaceAtom, () => started)
    // A hot reload starts with no surface: the one it started on before carries on.
    const surface = started ?? (await read($, surfaceAtom))
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
          if (patch.journal !== undefined) {
            await update($, journalAtom, () => patch.journal ?? JOURNAL_DEFAULT)
          }
          if (patch.soundSilent !== undefined) {
            await update($, soundSilentAtom, () => patch.soundSilent ?? false)
          }
        },
        toast: (text, timeoutMs) =>
          timeoutMs === undefined ? $.ui.toast(text) : $.ui.toast(text, { timeoutMs }),
        leaseOwner: () => read($, leaseOwnerAtom),
        bgKind: async () => {
          try {
            if ((await $.env.get('CLAUDE_CODE_SESSION_KIND')) !== 'bg') return 'plain'
            const source = await $.env.get('CLAUDE_BG_SOURCE')
            if (source === 'slash') return 'job'
            return source === undefined || source === 'spare' ? 'spare' : 'plain'
          } catch {
            return 'plain'
          }
        },
        drawsNowhere: () =>
          $.session.surfaces().then(
            (s) => s.length === 0,
            () => false,
          ),
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
        // Only a terminal's plays are timed.
        surface: surface === 'terminal' ? 'terminal' : 'desktop',
        sandbox,
      })
      game = session
      await session.start()
    }
    return next(e)
  })

  on('session.attach', async ($, e, next) => {
    if (e.surface === 'desktop') {
      await update($, surfaceAtom, () => 'desktop')
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
          if (patch.journal !== undefined) {
            await update($, journalAtom, () => patch.journal ?? JOURNAL_DEFAULT)
          }
          if (patch.soundSilent !== undefined) {
            await update($, soundSilentAtom, () => patch.soundSilent ?? false)
          }
        },
        toast: (text, timeoutMs) =>
          timeoutMs === undefined ? $.ui.toast(text) : $.ui.toast(text, { timeoutMs }),
        leaseOwner: () => read($, leaseOwnerAtom),
        bgKind: async () => {
          try {
            if ((await $.env.get('CLAUDE_CODE_SESSION_KIND')) !== 'bg') return 'plain'
            const source = await $.env.get('CLAUDE_BG_SOURCE')
            if (source === 'slash') return 'job'
            return source === undefined || source === 'spare' ? 'spare' : 'plain'
          } catch {
            return 'plain'
          }
        },
        drawsNowhere: () =>
          $.session.surfaces().then(
            (s) => s.length === 0,
            () => false,
          ),
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
        surface: 'desktop',
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

  // The main loop's by construction: a subagent's run raises no turn.start. Haste starts with it.
  on('turn.start', async ($, e, next) => {
    const at = await $.clock.now()
    game?.react({ t: 'turn_start' }, at, true)
    game?.setCadence(TURN_CADENCE_MS)
    return next(e)
  })

  // A main-loop step keeps Haste on while Claude works; a subagent's leaves Haste and the cadence.
  on('turn.step', async function* ($, e, next) {
    if (!e.agentId) game?.react({ t: 'turn_start' }, await $.clock.now())
    return yield* next(e)
  })

  // Only the running main turn can be aborted, and an abort that went through ends it: the party
  // is not left hasted, nor the cadence at turn speed.
  on('turn.abort', async ($, e, next) => {
    const result = await next(e)
    game?.apply({ t: 'turn_end' }, await $.clock.now())
    game?.setCadence(IDLE_CADENCE_MS)
    return result
  })

  // The hook runs before the permission prompt: `next(e)` asks, runs the tool and settles when the
  // call resolves, allowed, denied or failed, which answers any prompt the call raised.
  on('tool.call', async ($, e, next) => {
    const at = await $.clock.now()
    game?.apply({ t: 'tool_call', hint: toolKind(e.tool, e.agentId) }, at)
    try {
      return await next(e)
    } finally {
      denied.delete(e.tool_use_id)
      game?.react({ t: 'guard', on: false }, await $.clock.now())
    }
  })

  // Raised as the permission prompt shows. Its `next(e)` settles only once the person answered,
  // at times after the call itself resolved (seen live on 2.1.296), so the guard goes up before it.
  // `tool.check` answering ask is not the signal: the mode settles an ask after it, often unasked.
  on('classic.PermissionRequest', async ($, e, next) => {
    game?.react({ t: 'guard', on: true }, await $.clock.now())
    return next(e)
  })

  on('classic.PermissionDenied', async ($, e, next) => {
    denied.add(e.tool_use_id)
    game?.react({ t: 'guard', on: false }, await $.clock.now())
    return next(e)
  })

  // Neither the person's stop nor a refusal is Claude's stumble. A no at the prompt raises no
  // failure at all (seen live on 2.1.296); a call the permission-denied hook named is filtered here.
  on('classic.PostToolUseFailure', async ($, e, next) => {
    const at = await $.clock.now()
    if (!e.is_interrupt && !denied.has(e.tool_use_id)) game?.react({ t: 'tool_mishap' }, at)
    return next(e)
  })

  // As a compaction of the main conversation is about to run, manual, auto or a plugin's: the party
  // camps while Claude gathers its thoughts. The engine's precompute and a fork's own make none.
  on('session.compact', async ($, e, next) => {
    if (e.trigger !== 'precompute' && !e.agentId)
      game?.react({ t: 'camp', on: true }, await $.clock.now())
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
