// The frame loop: one timer per surface, re-armed each tick, blitting the mounted stage. The
// render hook mounts the site and draws the first frame; every frame after it is a blit here.
// The loop's shape follows claude-toons (MIT; see NOTICE.md).
import type { Timer, UiBlitArgs, UiBlitResult } from 'claude-code'
import type { GameView, Settings } from '../../types'
import { composeFrame } from './compose'
import { encodeImage } from './image'
import { type Layout, layoutFor, sameLayout } from './layout'
import { stageAt } from './model'
import { encodeRaster } from './raster'
import type { StageTimeline } from './timeline'
import { EVENT_FRAME_MS, IDLE_FRAME_MS, IMAGE_SCALE, SVG_FALLBACK_FRAME_MS } from './tuning'

export type StageSite = {
  requestId: string
  key: 'stage'
  layout: Layout
  renderer: 'raster' | 'image' | 'svg'
  /** The band's props the layout came from, so a tick can tell when it no longer holds. */
  props: { bodyColumns: number; maxRows: number }
}

export type LoopIo = {
  now: () => Promise<number>
  after: (ms: number, fn: () => void) => Timer
  blit: (args: UiBlitArgs) => Promise<UiBlitResult>
  /** $.ui.invalidate('ui.render') */
  invalidate: () => void
  view: () => Promise<GameView | null>
  settings: () => Promise<Settings>
}

function same(a: StageSite, b: StageSite): boolean {
  return (
    a.requestId === b.requestId &&
    a.renderer === b.renderer &&
    sameLayout(a.layout, b.layout) &&
    a.props.bodyColumns === b.props.bodyColumns &&
    a.props.maxRows === b.props.maxRows
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
): { cells: string } | { source: { rgba: string; width: number; height: number } } {
  if (!layout.box) throw new Error('no stage in a collapsed layout')
  const model = stageAt(view, timeline, now, layout.box, {
    compact: layout.kind === 'compact',
    motion,
  })
  if (renderer === 'raster') {
    return { cells: encodeRaster(composeFrame(model, { numbers: false }), model.numbers) }
  }
  return { source: encodeImage(composeFrame(model, { numbers: true }), IMAGE_SCALE) }
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
      this.arm(EVENT_FRAME_MS)
      return
    }
    // The same site drawn again: a loop stopped by a deny or a layout change resumes.
    if (this.stopped) {
      this.stopped = false
      this.arm(EVENT_FRAME_MS)
    }
  }

  /** New effects landed: draw the next frame now. */
  wake(): void {
    if (this.site === null || this.stopped) return
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
    this.timer = this.io.after(ms, () => {
      this.timer = null
      void this.tick(gen)
    })
  }

  private async tick(gen: number): Promise<void> {
    if (gen !== this.gen || this.inFlight) return
    this.inFlight = true
    this.rerun = false
    let next: number | null = null
    try {
      next = await this.frame(gen)
    } finally {
      this.inFlight = false
    }
    if (gen !== this.gen || next === null) return
    this.arm(this.rerun ? 0 : next)
  }

  /** One frame; answers the delay to the next, or null to stop until the next mount. */
  private async frame(gen: number): Promise<number | null> {
    const now = await this.io.now()
    if (gen !== this.gen) return null
    const view = await this.io.view()
    if (gen !== this.gen) return null
    const settings = await this.io.settings()
    const site = this.site
    if (gen !== this.gen || site === null || view === null) return null

    this.timeline.observe(view, now)
    const layout = layoutFor(this.timeline.rowsAt(view, now), site.props)
    if (!sameLayout(site.layout, layout)) {
      // Grow or shrink is a redraw: the next render mounts the new site.
      this.stopped = true
      this.io.invalidate()
      return null
    }
    const busy = this.timeline.isBusy(now)
    if (site.renderer === 'svg') {
      // The desktop's fallback without SMIL: redraws while a motion is live, nothing at rest.
      if (busy) this.io.invalidate()
      return busy ? SVG_FALLBACK_FRAME_MS : IDLE_FRAME_MS
    }

    const actors = [
      ...this.timeline.known().map((k) => k.id),
      ...view.heroes.map((h) => `${h.id}:${h.alive}`),
    ].join(',')
    if (this.fresh) {
      this.fresh = false
      this.lastActors = actors
    }
    const settled = settings.motion === 'still' && !busy
    const skip = settled && !this.wasBusy && actors === this.lastActors
    this.wasBusy = busy
    if (skip) return IDLE_FRAME_MS

    const frame = stageFrame(view, this.timeline, now, layout, site.renderer, settings.motion)
    const box = layout.box
    if (!box) return null
    const at = { requestId: site.requestId, key: site.key, columns: box.columns, rows: box.rows }
    const result = await this.io.blit(
      'cells' in frame ? { ...at, cells: frame.cells } : { ...at, source: frame.source },
    )
    this.blitCount += 1
    this.lastActors = actors
    if (gen !== this.gen) return null
    if (result.deny !== undefined) {
      this.stopped = true
      return null
    }
    return busy ? EVENT_FRAME_MS : IDLE_FRAME_MS
  }
}
