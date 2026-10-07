import type { UiBlitArgs, UiBlitResult } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { GameView, Settings } from '../../types'
import { SETTINGS_DEFAULT, WORLD_DEFAULT } from '../state'
import { GAUGE_FRAME_MS } from '../windows/tuning'
import { boss, wave } from './fixtures'
import { GaugeTrack } from './gauges'
import { layoutFor } from './layout'
import { MessageLog } from './log'
import { type LoopIo, StageLoop, type StageSite, stageFrame } from './loop'
import { StageTimeline } from './timeline'
import { EVENT_FRAME_MS, IDLE_FRAME_MS, SPAWN_MS, SVG_FALLBACK_FRAME_MS } from './tuning'

type Harness = {
  loop: StageLoop
  timeline: StageTimeline
  blits: UiBlitArgs[]
  /** The clock's time at each blit. */
  times: number[]
  invalidations: { at: number }[]
  state: {
    view: GameView | null
    settings: Settings
    answer: UiBlitResult
    onView: (() => void) | null
    /** The next blits reject, as a failed call through `$` would. */
    rejects: number
    /** What the strip reads; null (the default) draws no strip, the stage alone. */
    strip: Awaited<ReturnType<LoopIo['strip']>>
  }
}

// Room for a zone boss: 17 stage rows and the 5-row strip.
const PROPS = { bodyColumns: 120, maxRows: 30 }

function site(
  renderer: StageSite['renderer'] = 'raster',
  view = wave(),
  props: StageSite['props'] = PROPS,
  surface: StageSite['surface'] = 'terminal',
): StageSite {
  const t = new StageTimeline()
  t.observe(view, 0)
  const extra = surface === 'terminal' ? 0 : 1
  return {
    requestId: 'band-1',
    key: 'stage',
    layout: layoutFor(t.rowsAt(view, 0), props, surface, { tab: 'party', extra }),
    renderer,
    props,
    surface,
    strip: { kind: 'full', columns: props.bodyColumns, tab: 'party', extra },
  }
}

/** A clock in memory: `after` timers run in due order as `advance` moves time. */
function fakeClock(start = 1_000_000) {
  let t = start
  const timers: { due: number; fn: () => void; cancelled: boolean }[] = []
  const flush = async () => {
    for (let i = 0; i < 50; i++) await Promise.resolve()
  }
  return {
    /** Moves time on without running timers: the cost of an await. */
    spend: (ms: number) => {
      t += ms
    },
    now: async () => t,
    after: (ms: number, fn: () => void) => {
      const timer = { due: t + ms, fn, cancelled: false }
      timers.push(timer)
      return {
        cancel: () => {
          timer.cancelled = true
        },
      }
    },
    async advance(ms: number) {
      const end = t + ms
      for (;;) {
        await flush()
        timers.sort((a, b) => a.due - b.due)
        const next = timers.find((x) => !x.cancelled && x.due <= end)
        if (!next) break
        timers.splice(timers.indexOf(next), 1)
        t = next.due
        next.fn()
      }
      await flush()
      t = end
    },
  }
}

type Clock = Pick<LoopIo, 'now' | 'after'> & { spend?: (ms: number) => void }

function harness(clock: Clock, blitMs = 0): Harness {
  const blits: UiBlitArgs[] = []
  const times: number[] = []
  const invalidations: { at: number }[] = []
  const state: Harness['state'] = {
    view: wave(),
    settings: SETTINGS_DEFAULT,
    answer: {},
    onView: null,
    rejects: 0,
    strip: null,
  }
  let now = 0
  const io: LoopIo = {
    now: async () => {
      now = await clock.now()
      return now
    },
    after: clock.after,
    blit: async (args) => {
      blits.push(args)
      times.push(await clock.now())
      if (state.rejects > 0) {
        state.rejects -= 1
        throw new Error('blit failed')
      }
      clock.spend?.(blitMs)
      return state.answer
    },
    invalidate: () => invalidations.push({ at: now }),
    view: async () => {
      const v = state.view
      state.onView?.()
      return v
    },
    settings: async () => state.settings,
    strip: async () => state.strip,
  }
  const timeline = new StageTimeline()
  timeline.observe(wave(), 1_000_000)
  return { loop: new StageLoop(io, timeline), timeline, blits, times, invalidations, state }
}

/** One action: the knight lunges and hits the front enemy. */
const hit = [
  { k: 'act' as const, actor: 'h1', action: 'attack' as const, at: 0 },
  { k: 'hit' as const, by: 'h1', target: 'e1', amount: 5 },
]

test('a mounted raster site blits on wake, at the event rate while busy, at the idle rate at rest', async () => {
  const clock = fakeClock()
  const h = harness(clock)
  h.loop.mount(site())
  h.timeline.onEffects(hit, 1_000_000)
  h.loop.wake()
  await clock.advance(EVENT_FRAME_MS)
  expect(h.blits.length).toBeGreaterThanOrEqual(1)
  expect(h.blits[0]).toMatchObject({ requestId: 'band-1', key: 'stage', columns: 120, rows: 8 })
  const before = h.blits.length
  await clock.advance(EVENT_FRAME_MS * 4)
  expect(h.blits.length - before).toBeGreaterThanOrEqual(3)
  await clock.advance(2_000)
  const rest = h.blits.length
  await clock.advance(IDLE_FRAME_MS * 4)
  expect(h.blits.length - rest).toBe(4)
})

test('mount(null) stops the blits', async () => {
  const clock = fakeClock()
  const h = harness(clock)
  h.loop.mount(site())
  await clock.advance(IDLE_FRAME_MS)
  h.loop.mount(null)
  const n = h.blits.length
  h.loop.wake()
  await clock.advance(5_000)
  expect(h.blits.length).toBe(n)
})

test('a layout change invalidates once and blits nothing until a new mount', async () => {
  const clock = fakeClock()
  const h = harness(clock)
  h.loop.mount(site())
  h.state.view = boss()
  await clock.advance(2_000)
  expect(h.invalidations).toHaveLength(1)
  expect(h.blits).toHaveLength(0)
  h.loop.mount(site('raster', boss()))
  await clock.advance(EVENT_FRAME_MS)
  expect(h.blits.at(-1)).toMatchObject({ rows: 17 })
})

test('a deny stops the blits until the next mount', async () => {
  const clock = fakeClock()
  const h = harness(clock)
  h.state.answer = { deny: 'not mounted' }
  h.loop.mount(site())
  await clock.advance(5_000)
  expect(h.blits).toHaveLength(1)
  h.state.answer = {}
  h.loop.mount(site())
  await clock.advance(IDLE_FRAME_MS)
  expect(h.blits.length).toBeGreaterThan(1)
})

test('a tick that spans a mount(null) blits nothing', async () => {
  const clock = fakeClock()
  const h = harness(clock)
  h.loop.mount(site())
  h.state.onView = () => h.loop.mount(null)
  await clock.advance(5_000)
  expect(h.blits).toHaveLength(0)
})

test('with motion still, one settled blit follows the last motion and then none', async () => {
  const clock = fakeClock()
  const h = harness(clock)
  h.state.settings = { ...SETTINGS_DEFAULT, motion: 'still' }
  h.loop.mount(site())
  await clock.advance(5_000)
  expect(h.blits).toHaveLength(0)
  h.timeline.onEffects(hit, await clock.now())
  h.loop.wake()
  await clock.advance(2_000)
  const settled = h.blits.length
  expect(settled).toBeGreaterThan(1)
  await clock.advance(5_000)
  expect(h.blits.length).toBe(settled)
})

test('an svg site invalidates at the fallback rate while busy and never at rest', async () => {
  const clock = fakeClock()
  const h = harness(clock)
  h.loop.mount(site('svg'))
  await clock.advance(5_000)
  expect(h.invalidations).toHaveLength(0)
  h.timeline.onEffects(hit, await clock.now())
  h.loop.wake()
  await clock.advance(SVG_FALLBACK_FRAME_MS * 3)
  expect(h.invalidations.length).toBeGreaterThanOrEqual(3)
  expect(h.blits).toHaveLength(0)
})

test('a desktop svg site at 95 × 12 keeps running through a zone boss', async () => {
  const clock = fakeClock()
  const h = harness(clock)
  h.state.view = boss()
  h.timeline.observe(boss(), await clock.now())
  await clock.advance(SPAWN_MS * 4)
  const props = { bodyColumns: 95, maxRows: 12 }
  const rows = h.timeline.rowsAt(boss(), await clock.now())
  h.loop.mount({
    ...site('svg', boss(), props, 'desktop'),
    layout: layoutFor(rows, props, 'desktop', { tab: 'party', extra: 1 }),
  })
  // On a terminal 95 × 12 is the one-row band: a tick that ignored the surface would stop the site.
  h.timeline.onEffects(hit, await clock.now())
  h.loop.wake()
  await clock.advance(SVG_FALLBACK_FRAME_MS * 5)
  // A stopped site invalidates once, for the re-mount, and never again; a live one redraws the hit.
  expect(h.invalidations.length).toBeGreaterThan(1)
})

test('at rest each blit draws the next bob phase, never the same one twice', async () => {
  // Each blit costs 60 ms: a flat 500 ms re-arm drifts across the boundaries and repeats a phase.
  const clock = fakeClock(1_000_037)
  const h = harness(clock, 60)
  h.loop.mount(site())
  await clock.advance(6_000)
  const phases = h.times.map((t) => Math.floor(t / IDLE_FRAME_MS) % 2)
  expect(phases.length).toBeGreaterThanOrEqual(10)
  for (let i = 1; i < phases.length; i++) expect(phases[i]).not.toBe(phases[i - 1])
})

test('a blit that rejects does not end the loop', async () => {
  const clock = fakeClock()
  const h = harness(clock)
  h.state.rejects = 2
  h.loop.mount(site())
  await clock.advance(3_000)
  expect(h.blits.length).toBeGreaterThanOrEqual(5)
})

test('a new site mounted while a slow frame is in flight still gets its frames', async () => {
  const clock = fakeClock()
  const blits: UiBlitArgs[] = []
  let slowNext = false
  let loop: StageLoop | null = null
  const io: LoopIo = {
    now: clock.now,
    after: clock.after,
    blit: async (args) => {
      blits.push(args)
      return {}
    },
    invalidate: () => undefined,
    view: async () => {
      if (!slowNext) return wave()
      slowNext = false
      // The render mounts another site while this frame waits longer than a frame.
      loop?.mount(site('raster', wave(), { bodyColumns: 140, maxRows: 20 }))
      return new Promise<GameView>((resolve) => clock.after(150, () => resolve(wave())))
    },
    settings: async () => SETTINGS_DEFAULT,
    strip: async () => null,
  }
  const timeline = new StageTimeline()
  timeline.observe(wave(), 1_000_000)
  loop = new StageLoop(io, timeline)
  loop.mount(site())
  slowNext = true
  await clock.advance(400)
  const before = blits.length
  timeline.onEffects(hit, await clock.now())
  await clock.advance(2_000)
  expect(blits.length).toBeGreaterThan(before)
  expect(blits.length).toBeGreaterThan(0)
})

/** The strip's reads, with a fresh tracker and log. */
function extras() {
  return { world: WORLD_DEFAULT, notice: null, gauges: new GaugeTrack(), log: new MessageLog() }
}

test('the image strip blits each window on the first frame, then only the window that changed', async () => {
  const clock = fakeClock()
  const h = harness(clock)
  h.state.strip = extras()
  h.loop.mount(site('image'))
  await clock.advance(EVENT_FRAME_MS + 1)
  const first = h.blits.filter((b) => b.key.startsWith('win-')).map((b) => b.key)
  expect(first.sort()).toEqual([
    'win-enemy-25x5',
    'win-message-40x5',
    'win-party-42x5',
    'win-purse-13x5',
  ])
  const before = h.blits.length
  await clock.advance(IDLE_FRAME_MS * 2)
  expect(h.blits.slice(before).filter((b) => b.key.startsWith('win-'))).toHaveLength(0)
  const v = wave()
  v.gold = 1240
  h.state.view = v
  const mid = h.blits.length
  await clock.advance(IDLE_FRAME_MS * 2)
  expect(
    h.blits
      .slice(mid)
      .filter((b) => b.key.startsWith('win-'))
      .map((b) => b.key),
  ).toEqual(['win-purse-13x5'])
})

test('the raster strip blits one strip Raster when it changes', async () => {
  const clock = fakeClock()
  const h = harness(clock)
  h.state.strip = extras()
  h.loop.mount(site('raster'))
  await clock.advance(EVENT_FRAME_MS + 1)
  const v = wave()
  v.farm = true
  h.state.view = v
  await clock.advance(IDLE_FRAME_MS * 2)
  const strip = h.blits.find((b) => b.key === 'strip')
  expect(strip && 'cells' in strip).toBe(true)
  expect([strip?.columns, strip?.rows]).toEqual([120, 5])
})

test('with only a gauge filling the loop re-arms at the gauge rate, capped by the bob', async () => {
  const clock = fakeClock(1_000_000)
  const h = harness(clock)
  const e = extras()
  h.state.strip = e
  const t0 = await clock.now()
  // A batch landed: the gauges fill for 5 s at the idle cadence, nobody acts.
  e.gauges.onTick(wave(), t0, 5000, h.timeline)
  const v = wave()
  v.heroes = v.heroes.map((x) => ({ ...x, gauge: 9000, queued: false }))
  h.state.view = v
  e.gauges.onTick(v, t0 + 1, 5000, h.timeline)
  h.loop.mount(site('raster', v))
  await clock.advance(2_000)
  const gaps = h.times.slice(2).map((t, i) => t - (h.times[i + 1] ?? t))
  expect(gaps.length).toBeGreaterThan(4)
  expect(Math.max(...gaps)).toBeLessThanOrEqual(GAUGE_FRAME_MS)
})

test('a bare site (World) blits the strip and no stage; a boss arriving is not a layout change', async () => {
  const clock = fakeClock()
  const h = harness(clock)
  h.state.strip = extras()
  const props = PROPS
  h.loop.mount({
    requestId: 'band-1',
    key: '',
    layout: layoutFor(0, props, 'terminal', { tab: 'world', extra: 0 }),
    renderer: 'image',
    props,
    surface: 'terminal',
    strip: { kind: 'bare', columns: 120, tab: 'world', extra: 0 },
  })
  await clock.advance(EVENT_FRAME_MS + 1)
  const v = wave()
  v.highestZone = 4
  h.state.view = v
  await clock.advance(IDLE_FRAME_MS * 2)
  expect(h.blits.some((b) => b.key === 'win-message-40x5')).toBe(true)
  expect(h.blits.some((b) => b.key === 'stage' || b.key.startsWith('stage-'))).toBe(false)
  h.state.view = boss()
  await clock.advance(IDLE_FRAME_MS * 3)
  expect(h.invalidations).toHaveLength(0)
})

test('the Image stage: full at scale 1.5 upscaled 4 times, compact at 1 upscaled 6 times', () => {
  const t = new StageTimeline()
  t.observe(wave(), 0)
  const full = layoutFor(t.rowsAt(wave(), 0), PROPS, 'terminal', { tab: 'party', extra: 0 })
  const image = stageFrame(wave(), t, 0, full, 'image', 'full')
  if (!('source' in image)) throw new Error('expected an Image source')
  expect([image.source.width, image.source.height]).toEqual([720, 96])
  const narrow = layoutFor(t.rowsAt(wave(), 0), { bodyColumns: 105, maxRows: 30 }, 'terminal', {
    tab: 'party',
    extra: 0,
  })
  expect(narrow.kind).toBe('compact')
  const compact = stageFrame(wave(), t, 0, narrow, 'image', 'full')
  if (!('source' in compact)) throw new Error('expected an Image source')
  expect([compact.source.width, compact.source.height]).toEqual([312, 48])
})
