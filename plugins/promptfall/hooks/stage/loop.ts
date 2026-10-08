// The frame loop: one timer per surface, re-armed each tick, blitting the mounted stage and its
// window strip. The render hook mounts the site and draws the first frame; every frame after it
// is a blit here.
// The loop's shape follows claude-toons (MIT; see NOTICE.md).
import type { RenderSurface, Timer, UiBlitArgs, UiBlitResult } from 'claude-code'
import type { BandTab, GameView, Settings, WorldState } from '../../types'
import { payloadBytes, trace } from '../diag'
import { stripScene } from '../ui/strip'
import { windowKey, windowSource } from '../windows/image'
import { sceneCells } from '../windows/raster'
import { GAUGE_FRAME_MS } from '../windows/tuning'
import { composeFrame } from './compose'
import type { GaugeTrack } from './gauges'
import { pngImage } from './image'
import { cellsOf, type Layout, layoutFor, sameLayout } from './layout'
import type { MessageLog } from './log'
import { stageAt } from './model'
import { encodeRaster } from './raster'
import type { StageTimeline } from './timeline'
import {
  EVENT_FRAME_MS,
  HIRES_SCALE,
  IDLE_FRAME_MS,
  IMAGE_SCALE,
  SVG_FALLBACK_FRAME_MS,
} from './tuning'

export type StageSite = {
  requestId: string
  /** The element's key: `stage` for the Raster, `stageKey(box)` for the Image; '' with no stage. */
  key: string
  layout: Layout
  /** The window strip the band drew: its kind, its columns, the tab, rung (c)'s extra row. */
  strip: { kind: 'full' | 'compact' | 'bare'; columns: number; tab: BandTab; extra: 0 | 1 }
  renderer: 'raster' | 'image' | 'svg'
  /** The band's props the layout came from, so a tick can tell when it no longer holds. */
  props: { bodyColumns: number; maxRows: number }
  surface: RenderSurface
}

export type LoopIo = {
  now: () => Promise<number>
  after: (ms: number, fn: () => void) => Timer
  blit: (args: UiBlitArgs) => Promise<UiBlitResult>
  /** $.ui.invalidate('ui.render') */
  invalidate: () => void
  view: () => Promise<GameView | null>
  settings: () => Promise<Settings>
  /** What the strip reads besides the view; null draws no strip. */
  strip: () => Promise<{
    world: WorldState
    notice: string | null
    gauges: GaugeTrack
    log: MessageLog
  } | null>
}

/**
 * The stage Image's key, one per size. A keyed Image that grows in place keeps the terminal's
 * placement of its first size (seen in Ghostty: an 8-row stage grown to 17 rows drew at 8 rows'
 * height), so a new size mounts a new Image.
 */
export function stageKey(box: { columns: number; rows: number }): string {
  return `stage-${box.columns}x${box.rows}`
}

/** Past a bob boundary by this much, so a tick never samples the phase it just drew. */
const PHASE_SLACK_MS = 15

/**
 * At rest, the delay to just past the next bob boundary. Re-arming a flat IDLE_FRAME_MS let the
 * ticks drift across the boundaries the bob flips on, so the bob sometimes held for a second.
 */
export function restDelay(now: number): number {
  return IDLE_FRAME_MS - (now % IDLE_FRAME_MS) + PHASE_SLACK_MS
}

function same(a: StageSite, b: StageSite): boolean {
  return (
    a.requestId === b.requestId &&
    a.key === b.key &&
    a.renderer === b.renderer &&
    sameLayout(a.layout, b.layout) &&
    a.strip.kind === b.strip.kind &&
    a.strip.columns === b.strip.columns &&
    a.strip.tab === b.strip.tab &&
    a.strip.extra === b.strip.extra &&
    a.props.bodyColumns === b.props.bodyColumns &&
    a.props.maxRows === b.props.maxRows &&
    a.surface === b.surface
  )
}

/** The pixels for a stage frame, encoded for its element. */
export function stageFrame(
  view: GameView,
  timeline: StageTimeline,
  now: number,
  layout: Layout,
  renderer: 'raster' | 'image',
  motion: Settings['motion'],
): { cells: string } | { source: { png: string } } {
  if (!layout.box) throw new Error('no stage in a collapsed layout')
  // The full stage draws the 1.5x art on Image; Raster and the compact stage stay at 1.
  const model = stageAt(view, timeline, now, layout.box, {
    compact: layout.kind === 'compact',
    motion,
    scale: renderer === 'image' ? HIRES_SCALE : 1,
  })
  if (renderer === 'raster') {
    return { cells: encodeRaster(composeFrame(model, { numbers: false }), model.numbers) }
  }
  return {
    source: pngImage(composeFrame(model, { numbers: true }), IMAGE_SCALE / model.scale),
  }
}

export class StageLoop {
  blitCount = 0
  private site: StageSite | null = null
  private gen = 0
  private timer: Timer | null = null
  private inFlight = false
  private rerun = false
  private stopped = false
  private wasBusy = false
  private lastActors = ''
  /** The render hook drew this site's first frame: the first tick takes its actors as drawn. */
  private fresh = false
  /** What each strip element last got: a window's model as JSON, or the raster's cells. */
  private sent = new Map<string, string>()
  private due = 0
  /** The stage picture last sent, by element key, for a redraw of the same site to reuse. */
  private lastStage: { key: string; source: { png: string } } | null = null
  /** On the loop's clock, when the next busy frame is due; null re-anchors the beat on the next. */
  private beat: number | null = null

  constructor(
    private readonly io: LoopIo,
    private readonly timeline: StageTimeline,
  ) {}

  /**
   * Called on every render of the band's surface: a site while the stage is drawn, null when
   * it is not. A changed site or null starts a new generation; null stops the timer.
   */
  mount(site: StageSite | null): void {
    if (site === null) {
      if (this.site !== null) this.gen += 1
      this.site = null
      this.cancel()
      return
    }
    if (this.site === null || !same(this.site, site)) {
      this.gen += 1
      this.site = site
      this.stopped = false
      this.fresh = true
      this.wasBusy = false
      // The first frame blits the strip too: the engine sends nothing for a source it already
      // drew, and a change between the render and this frame still lands.
      this.sent.clear()
      this.arm(EVENT_FRAME_MS)
      return
    }
    // The same site drawn again: a loop stopped by a deny or a layout change resumes.
    if (this.stopped) {
      this.stopped = false
      this.arm(EVENT_FRAME_MS)
    }
  }

  /** The picture the loop last sent to the stage Image keyed `key`, or null. */
  stageSource(key: string): { png: string } | null {
    return this.lastStage?.key === key ? this.lastStage.source : null
  }

  /** New effects landed: draw the next frame now. */
  wake(): void {
    if (this.site === null || this.stopped) return
    this.beat = null
    if (this.inFlight) this.rerun = true
    else this.arm(0)
  }

  private cancel(): void {
    this.timer?.cancel()
    this.timer = null
  }

  private arm(ms: number): void {
    this.cancel()
    const gen = this.gen
    this.due = Date.now() + ms
    this.timer = this.io.after(ms, () => {
      this.timer = null
      void this.tick(gen)
    })
  }

  private async tick(gen: number): Promise<void> {
    if (gen !== this.gen) return
    if (this.inFlight) {
      // A frame of an older site is still awaiting: run this one when it ends, or no timer is left.
      this.rerun = true
      return
    }
    this.inFlight = true
    this.rerun = false
    let next: number | null = null
    const tickStart = Date.now()
    const late = tickStart - this.due
    try {
      next = await this.frame(gen)
      trace('frame', { late, ms: Date.now() - tickStart, next: next ?? -1 })
    } catch {
      // A frame that throws (a rejected call through `$`) must not end the loop: nothing would
      // re-arm it until the next mount or wake. Try again at the next bob boundary.
      next = restDelay(await this.io.now().catch(() => 0))
    } finally {
      this.inFlight = false
    }
    if (gen !== this.gen) {
      // A mount started a newer generation while this frame ran; its tick may have been skipped.
      if (this.rerun && this.site !== null && !this.stopped && this.timer === null) this.arm(0)
      return
    }
    if (next === null) return
    this.arm(this.rerun ? 0 : next)
  }

  /** One frame; answers the delay to the next, or null to stop until the next mount. */
  private async frame(gen: number): Promise<number | null> {
    // One round of reads through `$`, not four in a row.
    const [now, view, settings, extras] = await Promise.all([
      this.io.now(),
      this.io.view(),
      this.io.settings(),
      this.io.strip(),
    ])
    // Busy frames keep a fixed beat: this frame's slot is the one it was due in, so its own cost
    // and a late timer do not push the next one back.
    const slot = this.beat ?? now
    this.beat = null
    const site = this.site
    if (gen !== this.gen || site === null || view === null) return null

    this.timeline.observe(view, now)
    const layout = layoutFor(this.timeline.rowsAt(view, now), site.props, site.surface, {
      tab: site.strip.tab,
      extra: site.strip.extra,
      scalable: site.renderer === 'image',
    })
    if (!sameLayout(site.layout, layout)) {
      // Grow or shrink is a redraw: the next render mounts the new site.
      this.stopped = true
      this.io.invalidate()
      return null
    }
    // On Loot and World neither the stage nor the log shows: only the gauges set the pace.
    const busy =
      site.strip.kind !== 'bare' &&
      (this.timeline.isBusy(now) || (extras?.log.isBusy(now, settings.motion) ?? false))
    const filling = extras?.gauges.isFilling(view, now) ?? false
    if (site.renderer === 'svg') {
      // The desktop's fallback without SMIL: redraws while a motion is live, nothing at rest.
      if (busy) this.io.invalidate()
      return busy ? SVG_FALLBACK_FRAME_MS : IDLE_FRAME_MS
    }

    const box = layout.box
    const cells = cellsOf(layout)
    if (box && cells) {
      const actors = [
        ...this.timeline.known().map((k) => k.id),
        ...view.heroes.map((h) => `${h.id}:${h.alive}`),
      ].join(',')
      if (this.fresh) {
        this.fresh = false
        this.lastActors = actors
      }
      const settled = settings.motion === 'still' && !this.timeline.isBusy(now)
      const skip = settled && !this.wasBusy && actors === this.lastActors
      this.wasBusy = this.timeline.isBusy(now)
      if (!skip) {
        const composeStart = Date.now()
        const frame = stageFrame(view, this.timeline, now, layout, site.renderer, settings.motion)
        const composeMs = Date.now() - composeStart
        const at = {
          requestId: site.requestId,
          key: site.key,
          columns: cells.columns,
          rows: cells.rows,
        }
        const blitStart = Date.now()
        const result = await this.io.blit(
          'cells' in frame ? { ...at, cells: frame.cells } : { ...at, source: frame.source },
        )
        trace('blit', {
          what: 'stage',
          compose: composeMs,
          ms: Date.now() - blitStart,
          bytes: payloadBytes(frame),
          deny: result.deny !== undefined,
        })
        this.blitCount += 1
        this.lastActors = actors
        if (gen !== this.gen) return null
        if (result.deny !== undefined) {
          this.stopped = true
          return null
        }
        if ('source' in frame) this.lastStage = { key: site.key, source: frame.source }
      }
    }

    if (extras) {
      const { scene } = stripScene({
        view,
        world: extras.world,
        tab: site.strip.tab,
        kind: site.strip.kind,
        columns: site.strip.columns,
        now,
        notice: extras.notice,
        motion: settings.motion,
        timeline: this.timeline,
        gauges: extras.gauges,
        log: extras.log,
      })
      const sends: UiBlitArgs[] = []
      if (site.renderer === 'raster') {
        const cells = sceneCells(scene)
        if (this.sent.get('strip') !== cells) {
          this.sent.set('strip', cells)
          sends.push({
            requestId: site.requestId,
            key: 'strip',
            columns: scene.columns,
            rows: scene.rows,
            cells,
          })
        }
      } else {
        for (const win of scene.windows) {
          const key = windowKey(win)
          const json = JSON.stringify(win)
          if (this.sent.get(key) === json) continue
          this.sent.set(key, json)
          const source = windowSource(win)
          sends.push({
            requestId: site.requestId,
            key,
            columns: win.columns,
            rows: win.rows,
            source,
          })
        }
      }
      for (const args of sends) {
        const blitStart = Date.now()
        const result = await this.io.blit(args)
        trace('blit', { what: args.key, ms: Date.now() - blitStart, bytes: payloadBytes(args) })
        this.blitCount += 1
        if (gen !== this.gen) return null
        if (result.deny !== undefined) {
          this.stopped = true
          return null
        }
      }
    }
    if (busy) {
      // Overrun: the next frame runs at once and the beat starts over from it, never a burst.
      const next = slot + EVENT_FRAME_MS
      const end = await this.io.now()
      if (next <= end) return 0
      this.beat = next
      return next - end
    }
    return filling ? Math.min(GAUGE_FRAME_MS, restDelay(now)) : restDelay(now)
  }
}
