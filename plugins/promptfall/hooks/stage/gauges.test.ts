import { expect, test } from 'claude-code/testing'
import type { GameView, HeroView } from '../../types'
import type { Effect } from '../vendor/sim.js'
import { wave } from './fixtures'
import { GaugeTrack } from './gauges'
import { StageTimeline } from './timeline'

const NOW = 1_000_000
const act = (actor: string, at: number): Effect => ({ k: 'act', actor, action: 'attack', at })

/** A wave view whose first hero has the given gauge fields. */
function viewWith(patch: Partial<HeroView>, enemies = true): GameView {
  const v = wave()
  const h = v.heroes[0] as HeroView
  v.heroes[0] = { ...h, gaugePerStep: 150, queued: false, ...patch }
  if (!enemies) v.enemies = []
  return v
}
const h1 = (v: GameView) => v.heroes[0] as HeroView

function batch(
  track: GaugeTrack,
  t: StageTimeline,
  v: GameView,
  now: number,
  cadence: number,
  effects: Effect[] = [],
) {
  t.observe(v, now)
  t.onEffects(effects, now, cadence)
  track.onTick(v, now, cadence, t)
}

test('with no batch yet the gauge is the view’s', () => {
  const v = viewWith({ gauge: 4200 })
  expect(new GaugeTrack().at(h1(v), NOW)).toBe(4200)
})

test('a gauge fills at gaugePerStep per 100 ms of battle time, from the drawn value', () => {
  const track = new GaugeTrack()
  const t = new StageTimeline()
  batch(track, t, viewWith({ gauge: 2000 }), NOW - 1, 2000)
  // The second batch lands while the first still draws 2000 (it is 1 ms in): it starts there.
  const v = viewWith({ gauge: 5000 })
  batch(track, t, v, NOW, 2000)
  expect(track.at(h1(v), NOW + 500)).toBe(2000 + 150 * 5)
  // At the idle cadence the same battle time takes 2.5 times as long.
  const idle = new GaugeTrack()
  batch(idle, new StageTimeline(), viewWith({ gauge: 2000 }), NOW - 1, 5000)
  batch(idle, new StageTimeline(), viewWith({ gauge: 9000 }), NOW, 5000)
  expect(idle.at(h1(viewWith({ gauge: 9000 })), NOW + 1250)).toBe(2000 + 150 * 5)
})

test('an action empties the gauge at its start, then it refills, capped at the view’s end value', () => {
  const track = new GaugeTrack()
  const t = new StageTimeline()
  batch(track, t, viewWith({ gauge: 9000 }), NOW - 1, 2000)
  const v = viewWith({ gauge: 1800 })
  batch(track, t, v, NOW, 2000, [act('h1', 800)])
  expect(track.at(h1(v), NOW + 799)).toBe(10000)
  expect(track.at(h1(v), NOW + 800)).toBe(0)
  expect(track.at(h1(v), NOW + 1000)).toBe(Math.floor(1.5 * 200))
  expect(track.at(h1(v), NOW + 1999)).toBe(1798)
  expect(track.at(h1(v), NOW + 1999 + 500)).toBe(1800)
})

test('after the batch’s end the current view wins, a resync included', () => {
  const track = new GaugeTrack()
  const t = new StageTimeline()
  batch(track, t, viewWith({ gauge: 3000 }), NOW, 2000)
  expect(track.at(h1(viewWith({ gauge: 3000 })), NOW + 2000)).toBe(3000)
  // A view published without a batch (a resync): drawn at once, the batch being over.
  expect(track.at(h1(viewWith({ gauge: 7777 })), NOW + 2500)).toBe(7777)
})

test('a spawn-only tick holds the gauge flat; a wipe draws 0; a fallen hero draws 0', () => {
  const track = new GaugeTrack()
  const t = new StageTimeline()
  batch(track, t, viewWith({ gauge: 4000 }), NOW - 1, 2000)
  batch(track, t, viewWith({ gauge: 4000 }), NOW, 2000)
  expect(track.at(h1(viewWith({ gauge: 4000 })), NOW + 1500)).toBe(4000)
  batch(track, t, viewWith({ gauge: 0 }), NOW + 2000, 2000)
  expect(track.at(h1(viewWith({ gauge: 0 })), NOW + 2500)).toBe(0)
  expect(track.at(h1(viewWith({ gauge: 5000, alive: false })), NOW + 2500)).toBe(0)
})

test('isFilling while a gauge rises, not once it is capped or the batch is over', () => {
  const track = new GaugeTrack()
  const t = new StageTimeline()
  batch(track, t, viewWith({ gauge: 0 }), NOW - 1, 2000)
  // It reaches the tick's end value, 1000, about 666 ms in, and holds there.
  const v = viewWith({ gauge: 1000 })
  batch(track, t, v, NOW, 2000)
  expect(track.isFilling(v, NOW + 100)).toBe(true)
  expect(track.isFilling(v, NOW + 1500)).toBe(false)
  expect(track.isFilling(v, NOW + 2000)).toBe(false)
})

test('keys: a corner where it fills, two keys at a reset, the settle at the end', () => {
  const track = new GaugeTrack()
  const t = new StageTimeline()
  batch(track, t, viewWith({ gauge: 9400 }), NOW - 1, 2000)
  const v = viewWith({ gauge: 1800 })
  batch(track, t, v, NOW, 2000, [act('h1', 800)])
  const keys = track.keys(h1(v), NOW, 3000)
  expect(keys[0]).toEqual({ at: 0, fill: 9400 })
  expect(keys).toContainEqual({ at: 400, fill: 10000 })
  const atReset = keys.filter((k) => k.at === 800)
  expect(atReset.map((k) => k.fill)).toEqual([10000, 0])
  expect(keys.at(-1)).toEqual({ at: 3000, fill: 1800 })
  for (let i = 1; i < keys.length; i++)
    expect((keys[i] as { at: number }).at).toBeGreaterThanOrEqual(
      (keys[i - 1] as { at: number }).at,
    )
})
