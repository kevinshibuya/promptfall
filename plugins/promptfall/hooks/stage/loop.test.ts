import type { UiBlitArgs, UiBlitResult } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { GameView, Settings } from '../../types'
import { decode } from '../sprites/base64'
import { SETTINGS_DEFAULT, WORLD_DEFAULT } from '../state'
import { GAUGE_FRAME_MS } from '../windows/tuning'
import { boss, wave } from './fixtures'
import { GaugeTrack } from './gauges'
import { layoutFor } from './layout'
import { MessageLog } from './log'
import { bandKey, type LoopIo, StageLoop, type StageSite, stageFrame } from './loop'
import { StageTimeline } from './timeline'
import {
  EVENT_FRAME_MS,
  HASTE_FRAME_MS,
  IDLE_FRAME_MS,
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
    strip: { kind: 'bare', columns: 120, tab: 'world', extra: 0 },
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
  v.loot = [{ text: '[ Silk Robe (rare)', rarity: 'rare', kind: 'drop', itemId: 'i1' }]
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
  const timeline = new StageTimeline()
  timeline.observe(wave(), 1_000_000)
  h.loop = new StageLoop(io, timeline)
  return h
}

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
