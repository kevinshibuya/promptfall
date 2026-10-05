import type { Register, RenderSurface, UiBlitArgs, UiBlitResult } from 'claude-code'
import { atom, read, update } from 'claude-code'
import type { GameView, Mode, Settings, WorldState } from '../types'
import { COMMAND, registerCommand } from './command'
import { CUE_ASSET, type Cue, cueFor } from './cues'
import { type EnginePublish, GameEngine, type GameHandle, type TradeCall } from './engine'
import { acquire, claim, holds, LEASE_KEY, release } from './lease'
import { type ResolvedServer, resolveClient } from './server'
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
import { type StoreCalls, StoreKeyValue } from './storage'
import { effectToast } from './toasts'
import { registerBand } from './ui/band'
import { registerDialog } from './ui/dialog'
import type {
  Auth,
  Boards,
  ChatResult,
  FetchLike,
  LinkPoll,
  LinkStart,
  MarketResult,
  ServerClient,
  Unauthorized,
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
  toast: (text: string) => void
  leaseOwner: () => Promise<string | null>
  mode: () => Promise<Mode>
  paneNotice: (text: string | null) => Promise<void>
  /** Shows or clears the device-flow code in the dialog. */
  dialogLink: (link: { code: string; url: string } | null) => Promise<void>
  /** Drops what the dialog holds of one server: a link code and an open sell panel. */
  clearDialog: () => Promise<void>
  /** Reads the `world` atom. */
  readWorld: () => Promise<WorldState | null>
  fetch: FetchLike
  blit: (args: UiBlitArgs) => Promise<UiBlitResult>
  /** $.ui.invalidate('ui.render') */
  invalidate: () => void
  view: () => Promise<GameView | null>
  settings: () => Promise<Settings>
  /** Plays a file of the plugin's; resolves or rejects with nothing played off macOS. */
  play: (asset: string, gain: number) => Promise<void>
}

/** The store key of the machine's server setting: a URL, or absent for the in-process ledger. */
const SERVER_KEY = 'server'
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

  readonly stage: GameHandle['stage'] = {
    timeline: new StageTimeline(),
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
          },
          this.stage.timeline,
        )
        this.loops.set(surface, loop)
      }
      return loop
    },
  }

  constructor(private readonly io: Io) {
    this.kv = new StoreKeyValue(io.store)
    this.server = this.resolve(null)
    this.engine = this.makeEngine()
    this.poller = new WorldPoller({
      now: io.now,
      every: io.every,
      after: io.after,
      publish: (world) => io.publish({ world }),
      load: io.readWorld,
      fetch: async (since) => this.server.client.world(await this.storedAuth(), since),
      // A secondary's view is the committed state: nothing to subtract.
      committedDealt: () => (this.role === 'primary' ? this.engine.committedBoss() : null),
      toast: io.toast,
      cue: (cue) => void this.playCue(cue),
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

  /** The stored device token of the current server; reads and chat use it outside the engine. */
  private async storedAuth(): Promise<Auth> {
    const token = await this.kv.get(this.server.tokenKey)
    if (typeof token !== 'string') throw new Error('not_started')
    return { deviceToken: token }
  }

  private resolve(setting: string | null): ResolvedServer {
    return resolveClient(setting, { kv: this.kv, now: this.io.now, fetch: this.io.fetch })
  }

  private makeEngine(): GameEngine {
    const io = this.io
    return new GameEngine({
      client: this.server.client,
      kv: this.kv,
      tokenKey: this.server.tokenKey,
      label: this.server.label,
      now: io.now,
      newBatchId: () => crypto.randomUUID(),
      publish: (patch) => {
        if (patch.view?.firstRun) this.firstRun = true
        // The session owns the mode: the engine's pause becomes the derived value.
        return io.publish(patch.mode === undefined ? patch : { ...patch, mode: this.mode() })
      },
      onEffects: (effects, at) => this.onEffects(effects, at),
      toast: io.toast,
      after: (ms, fn) => {
        io.after(ms, fn)
      },
      random: Math.random,
    })
  }

  /** Points the session at a server: a fresh client and engine; the old engine stops. */
  private useServer(setting: string | null): void {
    this.engine.stop()
    this.linkGen += 1
    this.orphanToken = null
    this.setting = setting
    this.server = this.resolve(setting)
    this.engine = this.makeEngine()
    // World data belongs to one server: drop it and poll the new one.
    void this.poller.reset()
  }

  private async readSetting(): Promise<string | null> {
    const raw = await this.kv.get(SERVER_KEY)
    return typeof raw === 'string' && raw !== '' ? raw : null
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

  trade<R extends MarketResult>(fn: TradeCall<R>): Promise<R> {
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
    if (url === null) await this.kv.delete(SERVER_KEY)
    else await this.kv.set(SERVER_KEY, url)
    await this.restart(url)
    return { label: this.server.label, old, dropped }
  }

  /** A fresh engine on `setting`, started as primary or refreshed as secondary. */
  private async restart(setting: string | null): Promise<void> {
    this.useServer(setting)
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
    const engine = this.engine
    let start: LinkStart | Unauthorized
    try {
      start = await engine.call((client, auth) => client.linkStart(auth))
    } catch {
      // Unreachable: the band already says so, and the press stays a no-op.
      return
    }
    if ('reason' in start) return
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

  /** A market read: through the engine when playing; with the stored token otherwise (reads write nothing). */
  private async read<T>(fn: (client: ServerClient, auth: Auth) => Promise<T>): Promise<T> {
    if (this.role === 'primary') return this.engine.call(fn)
    const token = await this.kv.get(this.server.tokenKey)
    if (typeof token !== 'string') throw new Error('not_started')
    try {
      return await fn(this.server.client, { deviceToken: token })
    } catch {
      throw new Error('unreachable')
    }
  }

  clock(): ReturnType<GameHandle['clock']> {
    return this.engine.clock()
  }

  chatSeen(now: number): void {
    this.poller.chatSeen(now)
  }

  /** Any session posts: no flush, no lease. A primary in an outage answers unreachable without a call. */
  async chat(text: string): Promise<ChatResult> {
    if (this.role === 'primary' && this.engine.isUnreachable()) throw new Error('unreachable')
    const auth = await this.storedAuth()
    let result: ChatResult
    try {
      result = await this.server.client.chat(auth, text)
    } catch {
      throw new Error('unreachable')
    }
    if (result.ok) await this.poller.insert(result.message)
    return result
  }

  async leaderboards(): Promise<Boards | Unauthorized> {
    const auth = await this.storedAuth()
    try {
      return await this.server.client.leaderboards(auth)
    } catch {
      throw new Error('unreachable')
    }
  }

  /** Deletes every Promptfall key but the lease, then starts over on the same server. */
  async reset(): Promise<void> {
    await this.claim()
    this.engine.stop()
    const setting = this.setting
    for (const key of await this.kv.keys()) {
      if (key !== LEASE_KEY && key !== SETTINGS_KEY) await this.kv.delete(key)
    }
    if (setting !== null) await this.kv.set(SERVER_KEY, setting)
    await this.restart(setting)
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

  async claim(): Promise<void> {
    if (this.role === 'primary') return
    await this.followSetting()
    if (await claim(this.kv, this.owner, await this.io.now())) await this.becomePrimary()
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
      // Its retry timers and publishes must not outlive the lease.
      this.engine.stop()
      this.engine = this.makeEngine()
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
    if (boot.deviceToken !== token) {
      // The server minted for this token: it is unknown there. Wait for the primary to store a new one.
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
    const account = toAccountView(boot.account, boot.config, this.server.label, 0)
    await this.io.publish({ view: toGameView(state, boot.account.accountId, false, account) })
  }

  private onEffects(effects: Effect[], at?: number): void {
    // Before the toasts, and synchronously: the next render observes the view these effects
    // came with, so the hits must already be on the timeline (engine.apply publishes first).
    if (at !== undefined) this.lastAt = at
    // A tick's battle time plays stretched over the cadence: 2 s ticks at real speed, 5 s slower.
    this.stage.timeline.onEffects(effects, at ?? this.lastAt, this.cadence || TURN_CADENCE_MS)
    for (const loop of this.loops.values()) loop.wake()
    for (const effect of effects) {
      if (effect.k === 'rejected') {
        const reason = effect.reason
        const gen = ++this.paneNoticeGen
        this.pending = this.pending.then(() => this.io.paneNotice(reason)).catch(() => undefined)
        this.io.after(5000, () => {
          if (gen === this.paneNoticeGen) void this.io.paneNotice(null)
        })
        continue
      }
      const text = effectToast(effect)
      if (text) this.io.toast(text)
    }
    // After the toasts: each cue the batch earned, once.
    for (const cue of new Set(effects.map(cueFor))) if (cue) void this.playCue(cue)
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

export const register: Register = (on) => {
  registerBand(on, () => game)
  registerDialog(on, () => game)
  registerCommand(on, () => game)

  on('session.start', async ($, e, next) => {
    game = null
    await $.command.register(COMMAND)
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
        toast: (text) => $.ui.toast(text),
        leaseOwner: () => read($, leaseOwnerAtom),
        mode: () => read($, modeAtom),
        paneNotice: async (text) => {
          await update($, dialogAtom, (d) => ({ ...(d ?? DIALOG_DEFAULT), paneNotice: text }))
        },
        dialogLink: async (link) => {
          await update($, dialogAtom, (d) => ({ ...(d ?? DIALOG_DEFAULT), link }))
        },
        clearDialog: async () => {
          await update($, dialogAtom, (d) => ({ ...(d ?? DIALOG_DEFAULT), link: null, sell: null }))
        },
        readWorld: () => read($, worldAtom),
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
      })
      game = session
      await session.start()
    }
    return next(e)
  })

  on('session.attach', async ($, e, next) => {
    if (e.surface === 'desktop') {
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
        toast: (text) => $.ui.toast(text),
        leaseOwner: () => read($, leaseOwnerAtom),
        mode: () => read($, modeAtom),
        paneNotice: async (text) => {
          await update($, dialogAtom, (d) => ({ ...(d ?? DIALOG_DEFAULT), paneNotice: text }))
        },
        dialogLink: async (link) => {
          await update($, dialogAtom, (d) => ({ ...(d ?? DIALOG_DEFAULT), link }))
        },
        clearDialog: async () => {
          await update($, dialogAtom, (d) => ({ ...(d ?? DIALOG_DEFAULT), link: null, sell: null }))
        },
        readWorld: () => read($, worldAtom),
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
      await game?.claim()
      game?.apply({ t: 'rest' }, at)
    }
    return next(e)
  })
}
