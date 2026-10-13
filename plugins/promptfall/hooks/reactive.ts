import type { PlayerEvent } from './vendor/sim.js'

/**
 * A batch over any server bucket is refused whole, and a human paced every event that had one
 * before. Reactive events have no such pacing, so the plugin paces each kind under its bucket.
 */
export const PACE_MS = {
  /** Haste's refresh from a turn's steps; the sim's countdown is 3 minutes. */
  turn_start: 60_000,
  tool_mishap: 5_000,
  camp: 60_000,
  /** One guard pair: an on admitted starts the wait, its off follows whenever the call resolves. */
  guard: 2_000,
} as const

type Paced = keyof typeof PACE_MS

/** A reactive event the pacer admits or drops. */
export type ReactiveEvent = Extract<PlayerEvent, { t: Paced }>

/**
 * The plugin's own pace for the reactive events: one sent faster than its rate is dropped, since a
 * dropped reactive event loses a flash at most. It also keeps the guard's flag, so a second on
 * while on, or an off while off, sends nothing.
 */
export class ReactivePacer {
  private readonly last = new Map<Paced, number>()
  private guarding = false

  /**
   * Whether `event` at `at` goes to the sim; an admitted one starts its kind's wait. `fresh` admits
   * a turn's own start whatever the wait, and starts the wait its steps refresh against.
   */
  admits(event: ReactiveEvent, at: number, fresh = false): boolean {
    if (event.t === 'guard' && !event.on) {
      if (!this.guarding) return false
      this.guarding = false
      return true
    }
    if (event.t === 'guard' && this.guarding) return false
    const prev = this.last.get(event.t)
    if (!fresh && prev !== undefined && at - prev < PACE_MS[event.t]) return false
    this.last.set(event.t, at)
    if (event.t === 'guard') this.guarding = true
    return true
  }
}
