import type { UiBlitArgs, UiBlitResult } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { GameView, Settings } from '../../types'
import { decode } from '../sprites/base64'
import { SETTINGS_DEFAULT, WORLD_DEFAULT } from '../state'
import { GAUGE_FRAME_MS } from '../windows/tuning'
import { composeFrame, type Frame } from './compose'
import { boss, wave } from './fixtures'
import { GaugeTrack } from './gauges'
import { layoutFor } from './layout'
import { MessageLog } from './log'
import { bandKey, type LoopIo, rasterStage, StageLoop, type StageSite, stageFrame } from './loop'
import { type StageModel, stageAt } from './model'
import { encodeRaster } from './raster'
import { StageTimeline } from './timeline'
import {
  ALT_REMOUNT_MS,
  EVENT_FRAME_MS,
  HASTE_FRAME_MS,
  IDLE_FRAME_MS,
  PROBE_ALT_DENY,
  SPAWN_MS,
  SVG_FALLBACK_FRAME_MS,
} from './tuning'

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
    layout: layoutFor(t.rowsAt(view, 0), props, surface, {
      tab: 'party',
      extra,
      minRows: t.minRowsAt(view, 0),
      scalable: renderer === 'image',
    }),
    renderer,
    props,
    surface,
    strip: { kind: 'full', columns: props.bodyColumns, tab: 'party', extra, scroll: null },
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
    release: () => false,
    nextRelease: () => null,
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
  expect(h.blits[0]).toMatchObject({ requestId: 'band-1', key: 'stage', columns: 120, rows: 17 })
  const before = h.blits.length
  await clock.advance(EVENT_FRAME_MS * 4)
  expect(h.blits.length - before).toBeGreaterThanOrEqual(3)
  await clock.advance(2_000)
  const rest = h.blits.length
  await clock.advance(IDLE_FRAME_MS * 4)
  expect(h.blits.length - rest).toBe(4)
})

test('busy frames keep a fixed beat: a 30 ms frame does not push the next one back', async () => {
  const clock = fakeClock()
  const h = harness(clock, 30)
  h.loop.mount(site())
  h.timeline.onEffects(hit, 1_000_000)
  h.loop.wake()
  await clock.advance(EVENT_FRAME_MS * 6)
  const gaps = h.times.slice(1, 5).map((t, i) => t - (h.times[i] ?? 0))
  expect(gaps).toEqual([EVENT_FRAME_MS, EVENT_FRAME_MS, EVENT_FRAME_MS, EVENT_FRAME_MS])
})

test('a frame that overruns its slot runs the next at once, then the beat starts over', async () => {
  const clock = fakeClock()
  const h = harness(clock, EVENT_FRAME_MS + 20)
  h.loop.mount(site())
  h.timeline.onEffects(hit, 1_000_000)
  h.loop.wake()
  await clock.advance(EVENT_FRAME_MS * 4)
  // Each frame takes 103 ms: the next starts as it ends, never two at once to catch up.
  const gaps = h.times.slice(1, 3).map((t, i) => t - (h.times[i] ?? 0))
  expect(gaps).toEqual([EVENT_FRAME_MS + 20, EVENT_FRAME_MS + 20])
})

test('the last stage picture the loop sent is there for a redraw of the same site to reuse', async () => {
  const clock = fakeClock()
  const h = harness(clock)
  const s = { ...site('image'), key: 'stage-120x8' }
  h.loop.mount(s)
  expect(h.loop.stageSource('stage-120x8', s.layout, 'party')).toBe(null)
  h.timeline.onEffects(hit, 1_000_000)
  h.loop.wake()
  await clock.advance(EVENT_FRAME_MS)
  const sent = h.blits.filter((b) => b.key === 'stage-120x8').at(-1)
  expect(sent && 'source' in sent ? sent.source : null).not.toBe(null)
  expect(h.loop.stageSource('stage-120x8', s.layout, 'party')).toBe(
    sent && 'source' in sent ? sent.source : null,
  )
  expect(h.loop.stageSource('stage-130x8', s.layout, 'party')).toBe(null)
  // Another tab under the same key and layout (Loot and World share both) is another picture.
  expect(h.loop.stageSource('stage-120x8', s.layout, 'world')).toBe(null)
})

test('a stage picture is not reused once the stage went away, after a deny, or for another layout', async () => {
  const clock = fakeClock()
  const h = harness(clock)
  const s = { ...site('image'), key: 'stage-120x8' }
  const draw = async () => {
    h.loop.mount(s)
    h.timeline.onEffects(hit, await clock.now())
    h.loop.wake()
    await clock.advance(EVENT_FRAME_MS)
    expect(h.loop.stageSource('stage-120x8', s.layout, 'party')).not.toBe(null)
  }
  await draw()
  // The same cells under another layout (a scaled boss stage) is another picture.
  const box = s.layout.box ?? { columns: 120, rows: 8 }
  const scaled = { kind: 'full' as const, box: { ...box, rows: 13 }, cells: box, bandRows: 18 }
  expect(h.loop.stageSource('stage-120x8', scaled, 'party')).toBe(null)
  h.loop.mount(null)
  expect(h.loop.stageSource('stage-120x8', s.layout, 'party')).toBe(null)
  await draw()
  h.state.answer = { deny: 'not mounted' }
  h.loop.wake()
  await clock.advance(EVENT_FRAME_MS)
  expect(h.loop.stageSource('stage-120x8', s.layout, 'party')).toBe(null)
})

test('a wake during a frame runs the next at once, and the beat starts over from it', async () => {
  const clock = fakeClock()
  const h = harness(clock, 30)
  h.loop.mount(site())
  h.timeline.onEffects(hit, 1_000_000)
  let views = 0
  h.state.onView = () => {
    views += 1
    if (views === 2) h.loop.wake()
  }
  h.loop.wake()
  await clock.advance(EVENT_FRAME_MS * 5)
  const gaps = h.times.slice(1, 4).map((t, i) => t - (h.times[i] ?? 0))
  expect(gaps).toEqual([EVENT_FRAME_MS, 30, EVENT_FRAME_MS])
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

test('a boss arriving changes no layout (ADR 0010): no invalidation, the blits go on at 17 rows', async () => {
  const clock = fakeClock()
  const h = harness(clock)
  h.loop.mount(site())
  h.state.view = boss()
  await clock.advance(2_000)
  expect(h.invalidations).toHaveLength(0)
  expect(h.blits.length).toBeGreaterThan(0)
  expect(h.blits.at(-1)).toMatchObject({ rows: 17 })
})

test('a short band blits the cells it shows: the stage cropped to its bottom rows', async () => {
  const clock = fakeClock()
  const h = harness(clock)
  h.loop.mount(site('raster', wave(), { bodyColumns: 120, maxRows: 16 }))
  await clock.advance(IDLE_FRAME_MS)
  expect(h.blits.at(-1)).toMatchObject({ key: 'stage', columns: 120, rows: 11 })
  const t = new StageTimeline()
  t.observe(wave(), 0)
  const layout = layoutFor(17, { bodyColumns: 120, maxRows: 16 }, 'terminal', {
    tab: 'party',
    extra: 0,
  })
  const image = stageFrame(wave(), t, 0, layout, 'image', 'full')
  if (!('source' in image)) throw new Error('expected an Image source')
  // 11 rows at 1.5 are 33 pixels, upscaled 4 times.
  expect(pngSize(image.source)).toEqual([720, 132])
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

test('an Image drawn as its alt takes a new key and a render, at most every ALT_REMOUNT_MS', async () => {
  const clock = fakeClock()
  const h = harness(clock)
  // A background worker's band, laid out before the terminal attached.
  h.state.answer = { deny: `${PROBE_ALT_DENY} (bg worker)` }
  h.loop.mount(site('image'))
  await clock.advance(EVENT_FRAME_MS)
  expect(h.loop.remountKey()).toBe('-r1')
  const asked = h.invalidations.length
  expect(asked).toBeGreaterThan(0)
  // Drawn again under that key, attached now but with no image id: no new key before ALT_REMOUNT_MS.
  h.state.answer = { deny: 'the Image draws its alt here: every 8-bit image id is in use' }
  h.loop.mount({ ...site('image'), key: `stage${h.loop.remountKey()}` })
  await clock.advance(EVENT_FRAME_MS)
  expect(h.loop.remountKey()).toBe('-r1')
  await clock.advance(ALT_REMOUNT_MS)
  h.loop.mount({ ...site('image'), key: 'stage-r1-again' })
  await clock.advance(EVENT_FRAME_MS)
  expect(h.loop.remountKey()).toBe('-r2')
  expect(h.invalidations.length).toBeGreaterThan(asked)
  // Attached: the fresh Image takes its blits, and the key holds.
  h.state.answer = {}
  h.loop.mount({ ...site('image'), key: `stage${h.loop.remountKey()}` })
  await clock.advance(ALT_REMOUNT_MS * 2)
  expect(h.loop.remountKey()).toBe('-r2')
})

test('any other deny, or a Raster, keeps the key', async () => {
  const clock = fakeClock()
  const h = harness(clock)
  h.state.answer = { deny: 'not mounted' }
  h.loop.mount(site('image'))
  await clock.advance(5_000)
  const raster = harness(clock)
  raster.state.answer = { deny: `${PROBE_ALT_DENY} (bg worker)` }
  raster.loop.mount(site('raster'))
  await clock.advance(5_000)
  expect([h.loop.remountKey(), raster.loop.remountKey()]).toEqual(['', ''])
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

test('hasted, at rest each blit draws the next phase of the twice-as-fast bob', async () => {
  const clock = fakeClock(1_000_037)
  const h = harness(clock, 20)
  const v = wave()
  for (const hero of v.heroes) hero.hasted = true
  h.state.view = v
  h.loop.mount(site())
  await clock.advance(3_000)
  const phases = h.times.map((t) => Math.floor(t / HASTE_FRAME_MS) % 2)
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
    release: () => false,
    nextRelease: () => null,
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

/** The World tab's band site (spec #45): the strip alone, drawn as one picture at the band key. */
function worldSite(renderer: StageSite['renderer'] = 'image'): StageSite {
  const layout = layoutFor(0, PROPS, 'terminal', { tab: 'world', extra: 0 })
  const band = { columns: PROPS.bodyColumns, rows: layout.bandRows }
  return {
    requestId: 'band-1',
    key: bandKey(band),
    layout,
    band,
    renderer,
    props: PROPS,
    surface: 'terminal',
    strip: { kind: 'bare', columns: 120, tab: 'world', extra: 0, scroll: null },
  }
}

test('a bare band site (World) blits the band, 5 rows, and no stage; a boss arriving is not a layout change', async () => {
  const clock = fakeClock()
  const h = harness(clock)
  h.state.strip = extras()
  h.loop.mount(worldSite())
  await clock.advance(EVENT_FRAME_MS + 1)
  const v = wave()
  v.highestZone = 4
  h.state.view = v
  await clock.advance(IDLE_FRAME_MS * 2)
  expect(h.blits.length).toBeGreaterThanOrEqual(1)
  for (const b of h.blits) expect(b).toMatchObject({ key: 'band-120x5', columns: 120, rows: 5 })
  const first = h.blits[0]
  if (!first || !('source' in first) || !first.source || !('png' in first.source))
    throw new Error('expected a PNG source')
  expect(pngSize(first.source)).toEqual([960, 80])
  h.state.view = boss()
  await clock.advance(IDLE_FRAME_MS * 3)
  expect(h.invalidations).toHaveLength(0)
})

test('a bare band site redraws only when its strip changes, whatever the motion setting', async () => {
  const clock = fakeClock()
  const h = harness(clock)
  h.state.strip = extras()
  h.loop.mount(worldSite('raster'))
  await clock.advance(5_000)
  expect(h.blits).toHaveLength(1)
  expect(cellText(h.blits[0] as UiBlitArgs)[0]).toMatch(/^╭─+┬/)
  const v = wave()
  v.gold = 1240
  h.state.view = v
  await clock.advance(IDLE_FRAME_MS * 2)
  expect(h.blits).toHaveLength(2)
  expect(h.blits.at(-1)).toMatchObject({ key: 'band-120x5', columns: 120, rows: 5 })
})

test("a Loot band site redraws at a reveal's show time, not at the next rest frame", async () => {
  const clock = fakeClock()
  const h = harness(clock)
  h.state.strip = extras()
  const t0 = await clock.now()
  // A lone drop: its chest falls on the front enemy now; its Loot row waits for the reveal.
  const robe = { id: 'i1', base: 'silk_robe', rarity: 'rare', affixes: [], equippedBy: null }
  h.timeline.onEffects([{ k: 'drop', item: { ...robe, tradeableAt: null } as never }], t0)
  const show = h.timeline.showAt('i1') ?? 0
  const v = wave()
  v.loot = [
    {
      text: '[ Silk Robe (rare)',
      rarity: 'rare',
      kind: 'drop',
      itemId: 'i1',
      lead: { kind: 'item', key: 'silk_robe' },
      name: 'Silk Robe',
      rest: ' (rare)',
    },
  ]
  h.state.view = v
  const site = worldSite('raster')
  h.loop.mount({ ...site, strip: { ...site.strip, tab: 'loot' } })
  await clock.advance(show - t0 + IDLE_FRAME_MS)
  const shown = h.blits.findIndex((b) => cellText(b).some((row) => row.includes('Silk Robe')))
  expect(shown).toBeGreaterThan(0)
  expect(h.times[shown]).toBeGreaterThanOrEqual(show)
  expect(h.times[shown]).toBeLessThanOrEqual(show + EVENT_FRAME_MS)
})

/** A PNG source's width and height, from its IHDR. */
function pngSize(source: { png: string }): [number, number] {
  const bytes = decode(source.png)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return [view.getUint32(16), view.getUint32(20)]
}

test('the Image stage: full at scale 1.5 upscaled 4 times, compact at 1 upscaled 6 times', () => {
  const t = new StageTimeline()
  t.observe(wave(), 0)
  const full = layoutFor(t.rowsAt(wave(), 0), PROPS, 'terminal', { tab: 'party', extra: 0 })
  const image = stageFrame(wave(), t, 0, full, 'image', 'full')
  if (!('source' in image)) throw new Error('expected an Image source')
  expect(pngSize(image.source)).toEqual([720, 204])
  const narrow = layoutFor(t.rowsAt(wave(), 0), { bodyColumns: 105, maxRows: 30 }, 'terminal', {
    tab: 'party',
    extra: 0,
  })
  expect(narrow.kind).toBe('compact')
  const compact = stageFrame(wave(), t, 0, narrow, 'image', 'full')
  if (!('source' in compact)) throw new Error('expected an Image source')
  expect(pngSize(compact.source)).toEqual([312, 48])
})

/** The band's site (spec #45): the band's box, drawn as one picture at its key. */
function bandSite(
  props: StageSite['props'] = PROPS,
  view = wave(),
  renderer: StageSite['renderer'] = 'image',
): StageSite {
  const s = site(renderer, view, props)
  const band = { columns: props.bodyColumns, rows: s.layout.bandRows }
  return { ...s, key: bandKey(band), band }
}

test('an Image band site blits one picture at the band key, 8 by 16 pixels a cell, and no window', async () => {
  const clock = fakeClock()
  const h = harness(clock)
  h.state.strip = extras()
  h.loop.mount(bandSite())
  await clock.advance(IDLE_FRAME_MS * 3)
  expect(h.blits.length).toBeGreaterThan(1)
  for (const b of h.blits) expect(b).toMatchObject({ key: 'band-120x22', columns: 120, rows: 22 })
  const first = h.blits[0]
  if (!first || !('source' in first) || !first.source || !('png' in first.source))
    throw new Error('expected a PNG source')
  expect(pngSize(first.source)).toEqual([960, 352])
})

test('with motion still, a change in the strip alone redraws the band through the loop', async () => {
  const clock = fakeClock()
  const h = harness(clock)
  h.state.settings = { ...SETTINGS_DEFAULT, motion: 'still' }
  h.state.strip = extras()
  h.loop.mount(bandSite())
  await clock.advance(5_000)
  const settled = h.blits.length
  await clock.advance(5_000)
  expect(h.blits.length).toBe(settled)
  // The purse changes; nothing on the stage does.
  const v = wave()
  v.gold = 1240
  h.state.view = v
  await clock.advance(IDLE_FRAME_MS * 2)
  expect(h.blits.slice(settled)).toHaveLength(1)
  expect(h.blits.at(-1)).toMatchObject({ key: 'band-120x22', columns: 120, rows: 22 })
})

/** A blit's Raster cells as rows of text. */
function cellText(b: UiBlitArgs): string[] {
  if (!('cells' in b) || typeof b.cells !== 'string') throw new Error('expected Raster cells')
  const bytes = decode(b.cells)
  const words = new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4)
  const columns = b.columns ?? 0
  const out: string[] = []
  for (let y = 0; y < (b.rows ?? 0); y++) {
    let line = ''
    for (let x = 0; x < columns; x++)
      line += String.fromCodePoint(words[(y * columns + x) * 3] ?? 0)
    out.push(line)
  }
  return out
}

test('a Raster band site blits one band Raster at the band key, the stage and strip inside it', async () => {
  const clock = fakeClock()
  const h = harness(clock)
  h.state.strip = extras()
  h.loop.mount(bandSite(PROPS, wave(), 'raster'))
  await clock.advance(IDLE_FRAME_MS * 3)
  expect(h.blits.length).toBeGreaterThan(1)
  for (const b of h.blits) expect(b).toMatchObject({ key: 'band-120x22', columns: 120, rows: 22 })
  const text = cellText(h.blits[0] as UiBlitArgs)
  expect([text[0]?.[0], text[0]?.[119], text[17]?.[0], text[21]?.[119]]).toEqual([
    '╭',
    '╮',
    '├',
    '╯',
  ])
  // The stage's half blocks above the strip's windows, whose sides meet the bottom line.
  expect(text[8]?.slice(1, 119)).toMatch(/^[▀▄]+$/)
  expect(text[21]).toContain('┴')
})

test('a Raster band under a short band blits the stage rows shown, the line around them', async () => {
  const clock = fakeClock()
  const h = harness(clock)
  h.state.strip = extras()
  // 16 rows: the stage's bottom 11 above the strip (ADR 0010).
  h.loop.mount(bandSite({ bodyColumns: 120, maxRows: 16 }, wave(), 'raster'))
  await clock.advance(IDLE_FRAME_MS)
  const last = h.blits.at(-1) as UiBlitArgs
  expect(last).toMatchObject({ key: 'band-120x16', columns: 120, rows: 16 })
  const text = cellText(last)
  expect([text[0]?.[0], text[11]?.[0], text[15]?.[0]]).toEqual(['╭', '├', '╰'])
})

test('a Raster band with a boss in 15 rows blits the zoomed stage in 10, the line around them (#230)', async () => {
  const clock = fakeClock()
  const h = harness(clock)
  h.state.strip = extras()
  h.state.view = boss()
  h.loop.mount(bandSite({ bodyColumns: 120, maxRows: 15 }, boss(), 'raster'))
  await clock.advance(IDLE_FRAME_MS)
  expect(h.invalidations).toHaveLength(0)
  const last = h.blits.at(-1) as UiBlitArgs
  expect(last).toMatchObject({ key: 'band-120x15', columns: 120, rows: 15 })
  const text = cellText(last)
  expect([text[0]?.[0], text[10]?.[0], text[14]?.[0]]).toEqual(['╭', '├', '╰'])
})

/**
 * A SMIL loop over a holder in memory: toasts wait for the times in `shows`, `release` takes those
 * due as the log does, `view` takes `readMs`, and `onNext` runs inside each `nextRelease`.
 */
function smilHarness(clock: ReturnType<typeof fakeClock>, readMs = 0) {
  const h = {
    shows: [] as number[],
    released: [] as number[],
    invalidations: 0,
    onNext: null as (() => void) | null,
    loop: null as unknown as StageLoop,
    timeline: new StageTimeline(),
  }
  const io: LoopIo = {
    now: clock.now,
    after: clock.after,
    blit: async () => ({}),
    invalidate: () => {
      h.invalidations += 1
    },
    view: () =>
      readMs === 0
        ? Promise.resolve(wave())
        : new Promise<GameView>((resolve) => clock.after(readMs, () => resolve(wave()))),
    settings: async () => SETTINGS_DEFAULT,
    release: (now) => {
      const due = h.shows.filter((s) => s <= now)
      h.shows = h.shows.filter((s) => s > now)
      for (const _ of due) h.released.push(now)
      return due.length > 0
    },
    nextRelease: (now) => {
      const next = h.shows.filter((s) => s > now)
      h.onNext?.()
      return next.length === 0 ? null : Math.min(...next)
    },
    strip: async () => null,
  }
  h.timeline.observe(wave(), 1_000_000)
  h.loop = new StageLoop(io, h.timeline)
  return h
}

test("on SMIL a travel's backdrop change redraws the band at its show time, with no toast held", async () => {
  const clock = fakeClock(1_000_000)
  const h = smilHarness(clock)
  h.loop.mount(site('smil', wave(), PROPS, 'desktop'))
  await clock.advance(10)
  h.timeline.onEffects([{ k: 'traveled', from: 1, to: 3 }], await clock.now())
  h.loop.wake()
  const show = h.timeline.travelShowAt(3) ?? 0
  await clock.advance(show - 1 - (await clock.now()))
  expect(h.invalidations).toBe(0)
  await clock.advance(1)
  expect(h.invalidations).toBe(1)
  expect(h.released).toEqual([])
})

test('on SMIL a held toast lands at its show time however slow the reads, and the band redraws', async () => {
  const clock = fakeClock(1_000_000)
  const h = smilHarness(clock, 200)
  const show = 1_001_500
  h.shows.push(show)
  h.loop.mount(site('smil', wave(), PROPS, 'desktop'))
  await clock.advance(show - 1 - (await clock.now()))
  expect(h.released).toEqual([])
  expect(h.invalidations).toBe(0)
  await clock.advance(1)
  expect(h.released).toEqual([show])
  // The backdrop is drawn, not played: the release redraws so it changes with the words.
  expect(h.invalidations).toBe(1)
})

test('on SMIL a batch held while a frame found nothing to release still gets its wake', async () => {
  const clock = fakeClock(1_000_000)
  const h = smilHarness(clock)
  const show = 1_001_000
  // The batch lands after the frame's read found the holder empty, while the frame runs.
  h.onNext = () => {
    h.onNext = null
    h.shows.push(show)
    h.loop.wake()
  }
  h.loop.mount(site('smil', wave(), PROPS, 'desktop'))
  await clock.advance(show - (await clock.now()))
  expect(h.released).toEqual([show])
})

/** Where `f` differs from `ground`, the same stage with no actor on it: [left, top, right, bottom]. */
function bounds(f: Frame, ground: Frame): [number, number, number, number] {
  let [left, top, right, bottom] = [f.width, f.height, -1, -1]
  for (let y = 0; y < f.height; y++) {
    for (let x = 0; x < f.width; x++) {
      const i = (y * f.width + x) * 4
      if ([0, 1, 2, 3].every((k) => f.rgba[i + k] === ground.rgba[i + k])) continue
      left = Math.min(left, x)
      right = Math.max(right, x)
      top = Math.min(top, y)
      bottom = Math.max(bottom, y)
    }
  }
  return [left, top, right, bottom]
}

test("the Raster stage stands each actor in the 1x stage's box, a 24-pixel hero 16 pixels tall", () => {
  const t = new StageTimeline()
  t.observe(wave(), 0)
  const layout = layoutFor(t.rowsAt(wave(), 0), PROPS, 'terminal', { tab: 'party', extra: 0 })
  if (!layout.box) throw new Error('expected a full stage')
  const box = layout.box
  const hires = stageAt(wave(), t, 0, box, { compact: false, motion: 'still' })
  // Where the 1x stage stood each actor, its 16-pixel box's top-left corner, before it retired.
  const was: Record<string, { x: number; y: number }> = {
    e1: { x: 4, y: 18 },
    e2: { x: 22, y: 18 },
    e3: { x: 40, y: 18 },
    h1: { x: 64, y: 18 },
    h2: { x: 82, y: 18 },
    h3: { x: 100, y: 18 },
  }
  const alone = (m: StageModel, key: string | null): StageModel => ({
    ...m,
    backdrop: null,
    actors: m.actors.filter((a) => a.key === key),
  })
  const ground = rasterStage(alone(hires, null), layout).frame
  expect([ground.width, ground.height]).toEqual([120, 34])
  expect(hires.actors.map((a) => a.key).sort()).toEqual(Object.keys(was).sort())
  for (const actor of hires.actors) {
    const box = was[actor.key]
    if (!box) throw new Error(`${actor.key} was not on the 1x stage`)
    expect(actor.art.height, actor.key).toBe(24)
    const [left, top, right, bottom] = bounds(
      rasterStage(alone(hires, actor.key), layout).frame,
      ground,
    )
    // Inside the 16-pixel box the 1x stage drew it in, standing on that box's bottom row.
    expect(left, `${actor.key}: left`).toBeGreaterThanOrEqual(box.x)
    expect(right, `${actor.key}: right`).toBeLessThan(box.x + 16)
    expect(top, `${actor.key}: top`).toBeGreaterThanOrEqual(box.y)
    expect(bottom, `${actor.key}: bottom`).toBe(box.y + 15)
    // Two thirds of the figure's height in the scene, give or take the pixel the vote rounds.
    const scene = composeFrame(alone(hires, actor.key), { numbers: false })
    const [, sceneTop, , sceneBottom] = bounds(
      scene,
      composeFrame(alone(hires, null), { numbers: false }),
    )
    const tall = (sceneBottom - sceneTop + 1) * (2 / 3)
    expect(Math.abs(bottom - top + 1 - tall), `${actor.key}: height`).toBeLessThanOrEqual(1)
  }
})

test("a short Raster band shows the full stage's bottom rows, three scene pixels a cell row, a number above it in its top row", () => {
  const t = new StageTimeline()
  t.observe(wave(), 0)
  const rows = t.rowsAt(wave(), 0)
  const full = layoutFor(rows, PROPS, 'terminal', { tab: 'party', extra: 0 })
  const short = layoutFor(rows, { bodyColumns: 120, maxRows: 16 }, 'terminal', {
    tab: 'party',
    extra: 0,
  })
  expect(short).toMatchObject({ kind: 'full', cells: { columns: 120, rows: 11 } })
  if (!full.box) throw new Error('expected a full stage')
  const model = {
    ...stageAt(wave(), t, 0, full.box, { compact: false, motion: 'still' }),
    numbers: [{ text: '9', x: 30, y: 0, rgb: 0xffffff }],
  }
  const whole = rasterStage(model, full).frame
  const { frame, numbers } = rasterStage(model, short)
  expect([frame.width, frame.height]).toEqual([120, 22])
  expect(frame.rgba).toEqual(whole.rgba.slice((34 - 22) * 120 * 4))
  const cells = decode(encodeRaster(frame, numbers))
  const words = new Uint32Array(cells.buffer, cells.byteOffset, cells.length / 4)
  // Scene column 30 is cell column 20; the number was 18 scene rows above the crop.
  expect(words[20 * 3]).toBe(0x39)
})

test('a Raster boss in a short band: the whole scene resampled into the cells, its numbers and heads through the same factor (#230)', () => {
  const t = new StageTimeline()
  t.observe(boss(), 0)
  const props = { bodyColumns: 144, maxRows: 15 }
  const layout = layoutFor(t.rowsAt(boss(), 0), props, 'terminal', {
    tab: 'party',
    extra: 0,
    minRows: t.minRowsAt(boss(), 0),
  })
  expect(layout).toMatchObject({
    box: { columns: 245, rows: 17 },
    cells: { columns: 144, rows: 10 },
  })
  if (layout.kind !== 'full') throw new Error('expected a full stage')
  const scene = stageAt(boss(), t, 0, layout.box, { compact: false, motion: 'still' })
  const model = { ...scene, numbers: [{ text: '9', x: 184, y: 30, rgb: 0xffffff }] }
  const { frame, numbers, heads } = rasterStage(model, layout)
  // 10 rows of half-blocks across the band's 144 columns.
  expect([frame.width, frame.height]).toEqual([144, 20])
  // The whole scene, 368 by 51 pixels, scaled by about 0.39 each way, so nothing is cropped.
  const full = composeFrame(model, { numbers: false })
  expect([full.width, full.height]).toEqual([368, 51])
  expect(Math.abs((numbers[0]?.x ?? 0) - 184 * (144 / 368))).toBeLessThan(1e-9)
  expect(Math.abs((numbers[0]?.y ?? 0) - 30 * (20 / 51))).toBeLessThan(1e-9)
  const cells = decode(encodeRaster(frame, numbers))
  const words = new Uint32Array(cells.buffer, cells.byteOffset, cells.length / 4)
  // Scene pixel (184, 30) is cell (72, 5): the number lands where its figure is drawn.
  expect(words[(5 * 144 + 72) * 3]).toBe(0x39)
  // A number on the boss's middle lands on the boss's zoomed pixels.
  const big = scene.actors.find((a) => a.key === 'e9')
  if (!big) throw new Error('expected the zone boss on stage')
  const mid = { x: big.x + big.art.width / 2, y: big.y + big.art.height / 2 }
  const onBoss = rasterStage(
    { ...scene, backdrop: null, actors: [big], numbers: [{ text: '9', ...mid, rgb: 0xffffff }] },
    layout,
  )
  const n = onBoss.numbers[0]
  if (!n) throw new Error('expected the number')
  const at = (Math.floor(n.y) * 144 + Math.floor(n.x)) * 4
  // Above the ground strip, so the only art there is the boss's.
  expect(n.y).toBeLessThan(16)
  expect(onBoss.frame.rgba[at + 3]).toBe(255)
  // The heads the line opens over are read off the zoomed art: one flag a cell column.
  expect(heads).toHaveLength(144)
})
