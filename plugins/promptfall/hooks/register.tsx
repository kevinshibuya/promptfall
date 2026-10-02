import type { Register } from 'claude-code'
import { atom, read, update } from 'claude-code'
import type { Mode } from '../types'
import { type EnginePublish, GameEngine } from './engine'
import { acquire } from './lease'
import { type StoreCalls, StoreKeyValue } from './storage'
import { LocalServer } from './vendor/protocol.js'
import { content, type Effect } from './vendor/sim.js'
import { CLIENT_VERSION } from './version'
import { heroName, toGameView } from './view'

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
}

const TURN_CADENCE_MS = 2000
const IDLE_CADENCE_MS = 5000
const FLUSH_MS = 15_000
const LEASE_RENEW_MS = 10_000

const TOAST_RARITIES = new Set(['rare', 'epic', 'legendary'])

function effectToast(effect: Effect): string | null {
  switch (effect.k) {
    case 'drop': {
      if (!TOAST_RARITIES.has(effect.item.rarity)) return null
      const base = content.itemBases[effect.item.base]
      return `${base?.glyph ?? '?'} ${base?.name ?? effect.item.base} (${effect.item.rarity})`
    }
    case 'level_up':
      return `Level ${effect.level}`
    case 'zone_cleared':
      return effect.advancedTo > effect.zone
        ? `Zone ${effect.zone} cleared, on to ${content.zones[effect.advancedTo - 1]?.name ?? effect.advancedTo}`
        : `Zone ${effect.zone} cleared`
    case 'wipe':
      return `Party wiped, retreating to zone ${effect.retreatedTo}`
    case 'hero_recruited':
      return `${heroName(effect.hero.template, effect.hero.epithet)} joined (${effect.hero.rarity})`
    default:
      return null
  }
}

/**
 * One session's game: the engine, the lease, and the timers. Module state, so
 * a hot reload starts it over; the session's atoms and the store carry on.
 */
class GameSession {
  readonly engine: GameEngine
  private readonly kv: StoreKeyValue
  private readonly server: LocalServer
  private role: 'primary' | 'secondary' = 'secondary'
  private off = false
  private owner = ''
  private cadence = 0
  private tickTimer: Timer | null = null
  private timers: Timer[] = []

  constructor(private readonly io: Io) {
    this.kv = new StoreKeyValue(io.store)
    this.server = new LocalServer({
      kv: this.kv,
      now: io.now,
      minClientVersion: CLIENT_VERSION,
      seedSource: () => Number.parseInt(crypto.randomUUID().slice(0, 8), 16),
      tokenSource: () => crypto.randomUUID(),
    })
    this.engine = new GameEngine({
      client: this.server,
      kv: this.kv,
      now: io.now,
      newBatchId: () => crypto.randomUUID(),
      publish: io.publish,
      onEffects: (effects) => this.onEffects(effects),
      toast: io.toast,
      after: (ms, fn) => {
        io.after(ms, fn)
      },
    })
  }

  async start(): Promise<void> {
    this.owner = (await this.io.leaseOwner()) ?? crypto.randomUUID()
    this.off = (await this.io.mode()) === 'off'
    await this.io.publish({ leaseOwner: this.owner })
    if (await acquire(this.kv, this.owner, await this.io.now())) await this.becomePrimary()
    else await this.becomeSecondary()
    this.setCadence(IDLE_CADENCE_MS)
    this.timers.push(this.io.every(FLUSH_MS, () => void this.engine.flush()))
    this.timers.push(this.io.every(LEASE_RENEW_MS, () => void this.renew()))
  }

  /** Events apply only in the primary session, unpaused and switched on. */
  canApply(): boolean {
    return this.role === 'primary' && !this.off && !this.engine.isPaused()
  }

  isPrimary(): boolean {
    return this.role === 'primary'
  }

  setOff(off: boolean): void {
    this.off = off
  }

  apply(event: Parameters<GameEngine['apply']>[0], at: number): void {
    if (this.canApply()) this.engine.apply(event, at)
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

  private async tick(): Promise<void> {
    if (!this.canApply()) return
    this.engine.apply({ t: 'tick' }, await this.io.now())
  }

  private async becomePrimary(): Promise<void> {
    this.role = 'primary'
    await this.engine.start()
    if (!this.off) await this.io.publish({ mode: 'primary' })
  }

  private async becomeSecondary(): Promise<void> {
    this.role = 'secondary'
    if (!this.off) await this.io.publish({ mode: 'secondary' })
    await this.refresh()
  }

  private async renew(): Promise<void> {
    const ok = await acquire(this.kv, this.owner, await this.io.now())
    if (ok && this.role === 'secondary') await this.becomePrimary()
    else if (!ok && this.role === 'primary') await this.becomeSecondary()
    else if (!ok) await this.refresh()
  }

  /** A secondary's read-only view: bootstrap with the stored token, which writes nothing. */
  private async refresh(): Promise<void> {
    const token = await this.kv.get('deviceToken')
    if (typeof token !== 'string') return
    const boot = await this.server.bootstrap({ clientVersion: CLIENT_VERSION, deviceToken: token })
    await this.io.publish({ view: toGameView(boot.state, boot.account.accountId, false) })
  }

  private onEffects(effects: Effect[]): void {
    for (const effect of effects) {
      const text = effectToast(effect)
      if (text) this.io.toast(text)
    }
  }
}

// The scan that checks $.state calls reads atoms declared in the calling module.
const viewAtom = atom({ plugin: 'promptfall', key: 'view' } as const, null)
const modeAtom = atom({ plugin: 'promptfall', key: 'mode' } as const, 'primary')
const noticeAtom = atom({ plugin: 'promptfall', key: 'notice' } as const, null)
const leaseOwnerAtom = atom({ plugin: 'promptfall', key: 'leaseOwner' } as const, null)

let game: GameSession | null = null

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    game = null
    if (e.isInteractive && e.surface === 'terminal') {
      const session = new GameSession({
        now: () => $.clock.now(),
        every: (ms, fn) => $.clock.every(ms, fn),
        after: (ms, fn) => $.clock.after(ms, fn),
        store: {
          get: (key) => $.store.get(key),
          set: (key, value) => $.store.set(key, value),
          delete: (key) => $.store.delete(key),
        },
        publish: async (patch) => {
          if (patch.view !== undefined) await update($, viewAtom, () => patch.view ?? null)
          if (patch.mode !== undefined) await update($, modeAtom, () => patch.mode ?? 'primary')
          if (patch.notice !== undefined) await update($, noticeAtom, () => patch.notice ?? null)
          if (patch.leaseOwner !== undefined) {
            await update($, leaseOwnerAtom, () => patch.leaseOwner ?? null)
          }
        },
        toast: (text) => $.ui.toast(text),
        leaseOwner: () => read($, leaseOwnerAtom),
        mode: () => read($, modeAtom),
      })
      game = session
      await session.start()
    }
    return next(e)
  })

  on('session.attach', async ($, e, next) => {
    if (e.surface === 'desktop' && !game) {
      const session = new GameSession({
        now: () => $.clock.now(),
        every: (ms, fn) => $.clock.every(ms, fn),
        after: (ms, fn) => $.clock.after(ms, fn),
        store: {
          get: (key) => $.store.get(key),
          set: (key, value) => $.store.set(key, value),
          delete: (key) => $.store.delete(key),
        },
        publish: async (patch) => {
          if (patch.view !== undefined) await update($, viewAtom, () => patch.view ?? null)
          if (patch.mode !== undefined) await update($, modeAtom, () => patch.mode ?? 'primary')
          if (patch.notice !== undefined) await update($, noticeAtom, () => patch.notice ?? null)
          if (patch.leaseOwner !== undefined) {
            await update($, leaseOwnerAtom, () => patch.leaseOwner ?? null)
          }
        },
        toast: (text) => $.ui.toast(text),
        leaseOwner: () => read($, leaseOwnerAtom),
        mode: () => read($, modeAtom),
      })
      game = session
      await session.start()
    }
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
    if (e.origin.kind === 'composer') game?.apply({ t: 'rest' }, at)
    return next(e)
  })
}
