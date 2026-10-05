// Each hero's action gauge as the party window draws it between ticks. The view holds the gauge
// at the end of the last applied tick, which runs up to a tick ahead of playback; this replays
// the fill from the tick's action starts (combat plan, View contract) and settles on the view's
// value when the tick's playback ends. The algorithm is the UI PR 1 plan's, "The gauge tracker".
import type { GameView, HeroView } from '../../types'
import { GAUGE_FULL, STEP_MS, TICK_MS } from '../vendor/sim.js'
import type { StageTimeline } from './timeline'

type Record = {
  /** The gauge drawn when the batch landed: no jump at a batch's start. */
  from: number
  fromAt: number
  /** gaugePerStep per wall ms at this batch's cadence. */
  perMs: number
  /** This hero's action starts the batch scheduled; its gauge empties at each. */
  resets: number[]
  endAt: number
  /** The view's gauge after the batch. */
  to: number
}

export class GaugeTrack {
  private records = new Map<string, Record>()
  /** Each hero as the last batch's view had it: the draw before a record exists. */
  private last = new Map<string, HeroView>()

  /** Every applied event, effects or none, after timeline.onEffects for the same batch. */
  onTick(view: GameView, now: number, cadenceMs: number, timeline: StageTimeline): void {
    const next = new Map<string, Record>()
    for (const hero of view.heroes) {
      const before = this.last.get(hero.id)
      const from = before ? this.at(before, now) : hero.gauge
      const resets = timeline.actionStarts(hero.id).filter((t) => t >= now)
      next.set(hero.id, {
        from,
        fromAt: now,
        perMs: (hero.gaugePerStep * TICK_MS) / (STEP_MS * cadenceMs),
        resets,
        endAt: Math.max(now + cadenceMs, (resets.at(-1) ?? now) + 1),
        to: hero.gauge,
      })
    }
    this.records = next
    this.last = new Map(view.heroes.map((h) => [h.id, h]))
  }

  /** 0..GAUGE_FULL to draw for `hero`, as the current view has it. */
  at(hero: HeroView, now: number): number {
    if (!hero.alive) return 0
    const r = this.records.get(hero.id)
    if (!r) return hero.gauge
    if (now >= r.endAt) return hero.gauge
    return valueAt(r, now)
  }

  /** A living hero's drawn gauge is still rising toward its cap. */
  isFilling(view: GameView, now: number): boolean {
    return view.heroes.some((hero) => {
      const r = this.records.get(hero.id)
      if (!hero.alive || !r || now >= r.endAt || r.perMs <= 0) return false
      return valueAt(r, now) < capAt(r, now)
    })
  }

  /**
   * Piecewise-linear keys over [now, now + horizonMs], `at` relative to now: a corner where the
   * gauge reaches its cap, two keys at each reset (the jump to 0), and the settle at `endAt`.
   */
  keys(hero: HeroView, now: number, horizonMs: number): { at: number; fill: number }[] {
    const r = this.records.get(hero.id)
    const end = now + horizonMs
    if (!hero.alive || !r || now >= r.endAt) {
      const g = hero.alive ? hero.gauge : 0
      return [
        { at: 0, fill: g },
        { at: horizonMs, fill: g },
      ]
    }
    const out: { at: number; fill: number }[] = [{ at: 0, fill: valueAt(r, now) }]
    const stop = Math.min(end, r.endAt)
    // Segment starts: now, then each reset still to come before the stop.
    const starts = [now, ...r.resets.filter((t) => t > now && t < stop)]
    for (const [i, t0] of starts.entries()) {
      const t1 = starts[i + 1] ?? stop
      const b0 = i === 0 ? valueAt(r, now) : 0
      if (i > 0) out.push({ at: t0 - now, fill: 0 })
      const cap = capAt(r, t0)
      if (r.perMs > 0 && b0 < cap) {
        const hit = t0 + (cap - b0) / r.perMs
        if (hit < t1) out.push({ at: Math.round(hit - now), fill: cap })
      }
      out.push({ at: t1 - now, fill: Math.min(cap, Math.floor(b0 + r.perMs * (t1 - t0))) })
    }
    if (stop < end) {
      out.push({ at: stop - now, fill: hero.gauge })
      out.push({ at: horizonMs, fill: hero.gauge })
    }
    return out
  }
}

/** The cap at `t`: full while a reset is still to come, else the tick's end value. */
function capAt(r: Record, t: number): number {
  return Math.min(GAUGE_FULL, r.resets.some((x) => x > t) ? GAUGE_FULL : r.to)
}

function valueAt(r: Record, now: number): number {
  let last: number | undefined
  for (const t of r.resets) if (t <= now && (last === undefined || t > last)) last = t
  const g = last !== undefined ? r.perMs * (now - last) : r.from + r.perMs * (now - r.fromAt)
  return Math.max(0, Math.min(capAt(r, now), Math.floor(g)))
}
