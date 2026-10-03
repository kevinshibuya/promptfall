import type { WorldState } from '../types'
import { WORLD_DEFAULT } from './state'
import {
  CHAT_KEEP,
  type ChatMessage,
  type Unauthorized,
  type WorldSnapshot,
} from './vendor/protocol.js'

/** The world poll's slow cadence: the flush cadence. */
export const WORLD_POLL_MS = 15_000
/** While a world boss is live or the Chat tab is open. */
export const WORLD_POLL_FAST_MS = 5_000
/** Three missed slow polls: the World tab dims. */
export const WORLD_STALE_MS = 45_000
/** The Chat tab counts as open for this long after its last render; each render of the tab refreshes it. */
export const CHAT_TAB_HOT_MS = 20_000

type Timer = { cancel: () => void }

export type PollerDeps = {
  now: () => Promise<number>
  every: (ms: number, fn: () => void) => Timer
  after: (ms: number, fn: () => void) => Timer
  /** Writes the `world` atom. */
  publish: (world: WorldState) => Promise<void>
  /** Reads the `world` atom: a hot reload keeps the buffer it held. */
  load: () => Promise<WorldState | null>
  /** One poll with the stored token, outside the engine lock. Throws when there is none. */
  fetch: (since: number) => Promise<WorldSnapshot | Unauthorized>
  /** The committed boss tally on a primary; null on a secondary. */
  committedDealt?: () => WorldState['committedDealt']
  /** Shows a toast: the boss transitions. */
  toast?: (text: string) => void
}

/** The toast a snapshot transition earns: a boss appearing, or the same boss going down. */
export function bossTransition(
  before: WorldSnapshot['boss'] | undefined,
  after: WorldSnapshot['boss'],
): string | null {
  if (!after) return null
  if (after.hp > 0 && before?.bossId !== after.bossId)
    return `World boss ${after.name} has appeared`
  if (after.hp === 0 && before?.bossId === after.bossId && before.hp > 0) {
    return `${after.name} is down`
  }
  return null
}

/** Inserts messages by id, ascending, dropping ids already held; the oldest past CHAT_KEEP go. */
export function mergeMessages(held: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  if (incoming.length === 0) return held
  const byId = new Map(held.map((m) => [m.id, m]))
  for (const m of incoming) if (!byId.has(m.id)) byId.set(m.id, m)
  return [...byId.values()].sort((a, b) => a.id - b.id).slice(-CHAT_KEEP)
}

/**
 * The session's world poll: every session polls, primary or secondary, never
 * under the engine lock. A thrown or unauthorized poll is ignored; only a
 * submit or a bootstrap enters the outage. At most one poll is in flight.
 */
export class WorldPoller {
  private state: WorldState = WORLD_DEFAULT
  private timer: Timer | null = null
  private period = 0
  private started = false
  private inFlight = false
  /** Bumped by a reset: an answer from before it is dropped. */
  private epoch = 0
  /** Bumped by each fresh snapshot: a stale timer from before it does nothing. */
  private freshGen = 0
  private chatSeenAt = Number.NEGATIVE_INFINITY

  constructor(private readonly deps: PollerDeps) {}

  /** Arms the timer the first time, then polls once. A hot reload keeps the buffer at mark 0. */
  async start(): Promise<void> {
    if (!this.started) {
      this.started = true
      const held = await this.deps.load()
      if (held) this.state = { ...WORLD_DEFAULT, messages: held.messages }
      this.rearm(WORLD_POLL_MS)
    }
    await this.poll()
  }

  stop(): void {
    this.epoch += 1
    this.timer?.cancel()
    this.timer = null
    this.started = false
  }

  /** A server switch or a reset: back to the default, then a fresh poll once running. */
  async reset(): Promise<void> {
    if (!this.started) return
    this.epoch += 1
    this.freshGen += 1
    this.inFlight = false
    this.state = WORLD_DEFAULT
    await this.deps.publish(this.state)
    this.rearm(WORLD_POLL_MS)
    await this.poll()
  }

  /** The Chat tab drew: the fast cadence for CHAT_TAB_HOT_MS. Publishes nothing. */
  chatSeen(now: number): void {
    this.chatSeenAt = now
    if (this.started) this.rearm(this.cadence(now))
  }

  /** An own post shows before the next poll; the mark does not move, so nothing posted in between is skipped. */
  async insert(message: ChatMessage): Promise<void> {
    this.state = { ...this.state, messages: mergeMessages(this.state.messages, [message]) }
    await this.deps.publish(this.state)
  }

  periodMs(): number {
    return this.period
  }

  private cadence(now: number): number {
    const boss = this.state.snapshot?.boss
    const live = boss !== null && boss !== undefined && boss.hp > 0
    return live || now - this.chatSeenAt < CHAT_TAB_HOT_MS ? WORLD_POLL_FAST_MS : WORLD_POLL_MS
  }

  private rearm(ms: number): void {
    if (ms === this.period && this.timer) return
    this.period = ms
    this.timer?.cancel()
    this.timer = this.deps.every(ms, () => void this.poll())
  }

  private async poll(): Promise<void> {
    if (this.inFlight || !this.started) return
    this.inFlight = true
    const epoch = this.epoch
    let answer: WorldSnapshot | Unauthorized
    try {
      answer = await this.deps.fetch(this.state.chatMark)
    } catch {
      return
    } finally {
      if (epoch === this.epoch) this.inFlight = false
    }
    if (epoch !== this.epoch || 'reason' in answer) return
    const now = await this.deps.now()
    if (epoch !== this.epoch) return
    const last = answer.chat.at(-1)
    const toast = bossTransition(this.state.snapshot?.boss, answer.boss)
    this.state = {
      snapshot: answer,
      fetchedAt: now,
      stale: false,
      messages: mergeMessages(this.state.messages, answer.chat),
      chatMark: last ? last.id : this.state.chatMark,
      clock: { serverNow: answer.serverNow, clientNow: now, speed: answer.speed },
      committedDealt: this.deps.committedDealt?.() ?? null,
    }
    const gen = ++this.freshGen
    this.deps.after(WORLD_STALE_MS, () => {
      if (gen !== this.freshGen || epoch !== this.epoch) return
      this.state = { ...this.state, stale: true }
      void this.deps.publish(this.state)
    })
    await this.deps.publish(this.state)
    if (toast) this.deps.toast?.(toast)
    this.rearm(this.cadence(now))
  }
}
