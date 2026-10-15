// The frame loop: one timer per surface, re-armed each tick, blitting the mounted stage and its
// window strip. The render hook mounts the site and draws the first frame; every frame after it
// is a blit here. Each frame also drains the held toasts due by its `now`. On the desktop, whose
// SMIL plays the motion, the loop draws nothing: it wakes only for the next held toast's show time.
// The loop's shape follows claude-toons (MIT; see NOTICE.md).
import type { RenderSurface, Timer, UiBlitArgs, UiBlitResult } from 'claude-code'
import type { BandTab, GameView, LogScroll, Settings, WorldState } from '../../types'
import { WORLD_DEFAULT } from '../state'
import { stripScene } from '../ui/strip'
import type { Scene } from '../windows/kit'
import { GAUGE_FRAME_MS, WINDOW_SCALE } from '../windows/tuning'
import { composeFrame, cropBottom, type Frame } from './compose'
import type { GaugeTrack } from './gauges'
import { pngImage } from './image'
import { type Box, cellsOf, imageScaleFor, type Layout, layoutFor, sameLayout } from './layout'
import type { MessageLog } from './log'
import { type StageModel, type StageNumber, stageAt } from './model'
import { composeBand, composeBandCells, headsOf } from './playfield'
import { encodeRaster, intoCells } from './raster'
import { stagedState } from './staged'
import type { StageTimeline } from './timeline'
import {
  ALT_REMOUNT_MS,
  EVENT_FRAME_MS,
  HASTE_FRAME_MS,
  IDLE_FRAME_MS,
  IMAGE_ALT_DENY,
  SVG_FALLBACK_FRAME_MS,
} from './tuning'

export type StageSite = {
  requestId: string
  /**
   * The element's key: `stage` for the Raster, `stageKey(box)` for the Image, `bandKey(band)` for
   * the band as one picture, Image or Raster; '' with no stage.
   */
  key: string
  layout: Layout
  /**
   * The band's box in cells when the band is one picture (the full and compact layouts and Loot
   * and World, spec #45): each frame composes the stage, if any, and the strip into it, and no strip element
   * is blitted.
   */
  band?: Box
  /**
   * The window strip the band drew: its kind, its columns, the tab, rung (c)'s extra row, and the
   * tab's scroll, so every frame draws the page the band drew.
   */
  strip: {
    kind: 'full' | 'compact' | 'bare'
    columns: number
    tab: BandTab
    extra: 0 | 1
    scroll: LogScroll | null
  }
  /** `smil`: the desktop's stage, which SMIL plays; the loop draws no frame for it. */
  renderer: 'raster' | 'image' | 'svg' | 'smil'
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
  /**
   * Drains the held queue at `now`: the registration raises the toasts due and their cues.
   * Answers whether any was due.
   */
  release: (now: number) => boolean
  /** The next show time after `now` a held toast waits for, or null: a SMIL loop's wake. */
  nextRelease: (now: number) => number | null
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

/** The band picture's key, one per size, as the stage's: only a resize mounts a new picture. */
export function bandKey(box: Box): string {
  return `band-${box.columns}x${box.rows}`
}

/** Past a bob boundary by this much, so a tick never samples the phase it just drew. */
const PHASE_SLACK_MS = 15

/**
 * At rest, the delay to just past the next bob boundary, on a clock of `frameMs` frames. Re-arming
 * a flat IDLE_FRAME_MS let the ticks drift across the boundaries the bob flips on, so the bob
 * sometimes held for a second.
 */
export function restDelay(now: number, frameMs: number = IDLE_FRAME_MS): number {
  return frameMs - (now % frameMs) + PHASE_SLACK_MS
}

/** The fastest bob on the stage: Haste's while a hero bobs hasted. */
function bobFrameMs(view: GameView): number {
  return view.heroes.some((h) => h.hasted && h.alive && !h.guarding)
    ? HASTE_FRAME_MS
    : IDLE_FRAME_MS
}

function same(a: StageSite, b: StageSite): boolean {
  return (
    a.requestId === b.requestId &&
    a.key === b.key &&
    a.renderer === b.renderer &&
    a.band?.columns === b.band?.columns &&
    a.band?.rows === b.band?.rows &&
    sameLayout(a.layout, b.layout) &&
    a.strip.kind === b.strip.kind &&
    a.strip.columns === b.strip.columns &&
    a.strip.tab === b.strip.tab &&
    a.strip.extra === b.strip.extra &&
    JSON.stringify(a.strip.scroll) === JSON.stringify(b.strip.scroll) &&
    a.props.bodyColumns === b.props.bodyColumns &&
    a.props.maxRows === b.props.maxRows &&
    a.surface === b.surface
  )
}

/** The pixels for a stage frame, encoded for its element; `view` is the staged state at `now`. */
export function stageFrame(
  view: GameView,
  timeline: StageTimeline,
  now: number,
  layout: Layout,
  renderer: 'raster' | 'image',
  motion: Settings['motion'],
): { cells: string } | { source: { png: string } } {
  if (!layout.box) throw new Error('no stage in a collapsed layout')
  // The full stage is the 1.5x scene on both; the Raster resamples it into its cells.
  const model = stageAt(view, timeline, now, layout.box, {
    compact: layout.kind === 'compact',
    motion,
  })
  if (renderer === 'raster') {
    const { frame, numbers } = rasterStage(model, layout)
    return { cells: encodeRaster(frame, numbers) }
  }
  return {
    source: pngImage(
      shown(model, layout, composeFrame(model, { numbers: true })),
      imageScaleFor(layout.box.columns) / model.scale,
    ),
  }
}

/**
 * A short band shows the stage's bottom rows: the frame cropped to the cells' pixels. A zoom-out
 * (cells narrower than the box) scales the whole frame instead, so nothing is cropped.
 */
function shown(model: StageModel, layout: Layout, frame: Frame): Frame {
  const cells =
    layout.kind === 'full' && layout.cells?.columns === layout.box.columns
      ? layout.cells
      : undefined
  return cells ? cropBottom(frame, Math.ceil(cells.rows * 2 * model.scale)) : frame
}

/**
 * The Raster's stage: the scene's rows shown (three scene pixels a cell row at 1.5), its numbers
 * moved up with them (one clamped to the top stays visible), resampled into the cells' pixels, the
 * numbers mapped through the same factor (`intoCells`). A zoomed layout's cells are smaller than
 * its scene each way, so the one resample is the zoom too (#230).
 */
export function rasterStage(
  model: StageModel,
  layout: Layout,
): { frame: Frame; numbers: StageNumber[]; heads: boolean[] } {
  const scene = shown(model, layout, composeFrame(model, { numbers: false }))
  const cut = Math.ceil(model.box.rows * 2 * model.scale) - scene.height
  const moved = cut > 0 ? model.numbers.map((n) => ({ ...n, y: n.y - cut })) : model.numbers
  const cells = cellsOf(layout) ?? model.box
  const { frame, numbers } = intoCells(scene, moved, cells)
  // The actors alone, cropped and resampled the same: where their art reaches the top cell row.
  const art = shown(model, layout, composeFrame({ ...model, backdrop: null }, { numbers: false }))
  return { frame, numbers, heads: headsOf(intoCells(art, [], cells).frame) }
}

/**
 * The Image band's picture (spec #45): the full stage's 1.5x frame, or compact's 1x one beside its
 * window, and the strip's scene composed into `band` on the windows' grid, the playfield on the
 * shell; on Loot and World (`bare`) the strip alone.
 */
export function bandFrame(
  view: GameView,
  timeline: StageTimeline,
  now: number,
  layout: Layout,
  motion: Settings['motion'],
  band: Box,
  strip: Scene,
): { png: string } {
  if (layout.kind === 'bare') return pngImage(composeBand(band, null, strip), WINDOW_SCALE)
  if (layout.kind === 'collapsed') throw new Error('a collapsed band is text')
  const model = stageAt(view, timeline, now, layout.box, {
    compact: layout.kind === 'compact',
    motion,
  })
  return pngImage(composeBand(band, composeFrame(model, { numbers: true }), strip), WINDOW_SCALE)
}

/**
 * The Raster band's cells (#61): the full stage's 1.5x frame, its sky cropped on a short band (ADR
 * 0010), resampled into the stage's cells; or compact's 1x one beside its window; and the strip's
 * scene composed into `band`, the playfield on the shell; on Loot and World (`bare`) the strip
 * alone.
 */
export function bandCells(
  view: GameView,
  timeline: StageTimeline,
  now: number,
  layout: Layout,
  motion: Settings['motion'],
  band: Box,
  strip: Scene,
): { cells: string } {
  if (layout.kind === 'bare') return { cells: composeBandCells(band, null, [], strip) }
  if (layout.kind === 'collapsed') throw new Error('a collapsed band is text')
  const model = stageAt(view, timeline, now, layout.box, {
    compact: layout.kind === 'compact',
    motion,
  })
  const { frame, numbers, heads } = rasterStage(model, layout)
  return { cells: composeBandCells(band, frame, numbers, strip, heads) }
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
  /**
   * The stage picture last sent, by element key and layout, for a redraw of the same site to
   * reuse; dropped once the stage goes away, so a stage drawn again never shows an old picture.
   */
  private lastStage: {
    key: string
    layout: Layout
    tab: BandTab
    source: { png: string }
  } | null = null
  /** On the loop's clock, when the next busy frame is due; null re-anchors the beat on the next. */
  private beat: number | null = null
  /** The clock at the last SMIL wake: a travel's backdrop change since then redraws. */
  private wokeAt = Number.NEGATIVE_INFINITY
  /** Images found laid out as their alt: the band's key carries it, so each count mounts anew. */
  private remounts = 0
  private remountedAt = Number.NEGATIVE_INFINITY

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
      this.lastStage = null
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

  /** The suffix the band's Image key takes: empty until an Image is found laid out as its alt. */
  remountKey(): string {
    return this.remounts === 0 ? '' : `-r${this.remounts}`
  }

  /** A stage is mounted on this surface: held toasts wait for the stage to play their event. */
  isDrawn(): boolean {
    return this.site !== null
  }

  /**
   * The picture the loop last sent to the Image keyed `key` in `layout` on `tab`, or null. Loot
   * and World share a key and a layout: the tab tells their pictures apart.
   */
  stageSource(key: string, layout: Layout, tab: BandTab): { png: string } | null {
    const last = this.lastStage
    return last?.key === key && last.tab === tab && sameLayout(last.layout, layout)
      ? last.source
      : null
  }

  /** New effects landed: draw the next frame now, or on SMIL re-arm the wake. */
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
    try {
      next = await this.frame(gen)
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
    if (next === null) {
      // A wake during a frame that found nothing to do still runs: its batch may hold a toast.
      if (this.rerun && this.site !== null && !this.stopped) this.arm(0)
      return
    }
    // A wake during the frame runs the next at once, and the beat starts over from it.
    if (this.rerun) this.beat = null
    this.arm(this.rerun ? 0 : next)
  }

  /**
   * SMIL plays the desktop's motion: no frame and no blit, only the drain and a wake for the next
   * held toast's show time or travel's backdrop change, or none until the next batch wakes the
   * loop. It reads the clock alone, so no other read's latency lands between a show time and its
   * release.
   */
  private async wakeFrame(gen: number): Promise<number | null> {
    const now = await this.io.now()
    if (gen !== this.gen || this.site === null) return null
    // SMIL plays the actors and the chest but not the backdrop, which is drawn: a release redraws,
    // so the picture changes with the words and not at the next publish, and so does a travel's
    // backdrop change, which holds no toast.
    const shows = this.timeline.travelShows()
    const traveled = shows.some((show) => show > this.wokeAt && show <= now)
    this.wokeAt = now
    const released = this.io.release(now)
    if (released || traveled) this.io.invalidate()
    const next = [this.io.nextRelease(now), ...shows.filter((show) => show > now)]
      .filter((t): t is number => t !== null)
      .reduce((a, b) => Math.min(a, b), Number.POSITIVE_INFINITY)
    return Number.isFinite(next) ? next - now : null
  }

  /** One frame; answers the delay to the next, or null to stop until the next mount. */
  private async frame(gen: number): Promise<number | null> {
    if (this.site?.renderer === 'smil') return this.wakeFrame(gen)
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
    // A SMIL site mounted while the reads ran has a new generation: its wake frame is its own.
    if (gen !== this.gen || site === null || view === null || site.renderer === 'smil') return null
    // Held toasts land on the first frame at or after their show time.
    this.io.release(now)

    this.timeline.observe(view, now)
    const layout = layoutFor(this.timeline.rowsAt(view, now), site.props, site.surface, {
      tab: site.strip.tab,
      extra: site.strip.extra,
      minRows: this.timeline.minRowsAt(view, now),
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
    // A Loot row waits for its reveal: on Loot too, the frames keep the event beat until it shows.
    const revealing = this.timeline.pendingReveals(now) > 0

    const scene = extras
      ? stripScene({
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
          scroll: site.strip.scroll,
        }).scene
      : null
    // The band picture draws the strip inside it: a change in the strip alone redraws it.
    const band = site.band && scene ? { box: site.band, scene, json: JSON.stringify(scene) } : null

    const box = layout.box
    const cells = cellsOf(layout)
    // A band site with no strip to compose draws nothing: the stage alone is not the band's size.
    // A site without a band (the loop's own tests) draws the stage alone.
    const drawn = band ? band.box : !site.band ? cells : null
    if (drawn) {
      const staged = stagedState(view, extras?.world ?? WORLD_DEFAULT, this.timeline, now)
      const actors = [
        ...staged.enemies.map((e) => e.id),
        ...staged.heroes.map((h) => `${h.id}:${h.alive}`),
      ].join(',')
      if (this.fresh) {
        this.fresh = false
        this.lastActors = actors
      }
      const settled = settings.motion === 'still' && !this.timeline.isBusy(now)
      const same = band === null || this.sent.get('band') === band.json
      // With no stage in it (Loot and World) the band is its strip: it redraws when that changes.
      const skip = box ? settled && !this.wasBusy && actors === this.lastActors && same : same
      this.wasBusy = this.timeline.isBusy(now)
      if (!skip) {
        const frame = !band
          ? stageFrame(staged, this.timeline, now, layout, site.renderer, settings.motion)
          : site.renderer === 'raster'
            ? bandCells(staged, this.timeline, now, layout, settings.motion, band.box, band.scene)
            : {
                source: bandFrame(
                  staged,
                  this.timeline,
                  now,
                  layout,
                  settings.motion,
                  band.box,
                  band.scene,
                ),
              }
        const at = {
          requestId: site.requestId,
          key: site.key,
          columns: drawn.columns,
          rows: drawn.rows,
        }
        const result = await this.io.blit(
          'cells' in frame ? { ...at, cells: frame.cells } : { ...at, source: frame.source },
        )
        this.blitCount += 1
        this.lastActors = actors
        if (gen !== this.gen) return null
        if (result.deny !== undefined) {
          this.stopped = true
          this.lastStage = null
          // An Image drawing its alt keeps it until it is mounted afresh: a background worker's band,
          // laid out before the terminal attached (no pictures, no image id), stays text otherwise. A
          // new key and a render mount one, at most every ALT_REMOUNT_MS while the alt stands.
          if (
            site.renderer === 'image' &&
            result.deny.startsWith(IMAGE_ALT_DENY) &&
            now - this.remountedAt >= ALT_REMOUNT_MS
          ) {
            this.remounts += 1
            this.remountedAt = now
            this.io.invalidate()
          }
          return null
        }
        if (band) this.sent.set('band', band.json)
        if ('source' in frame) {
          this.lastStage = {
            key: site.key,
            layout: site.layout,
            tab: site.strip.tab,
            source: frame.source,
          }
        }
      }
    }

    if (busy || revealing) {
      // Overrun: the next frame runs at once and the beat starts over from it, never a burst.
      const next = slot + EVENT_FRAME_MS
      const end = await this.io.now()
      if (next <= end) return 0
      this.beat = next
      return next - end
    }
    const rest = restDelay(now, bobFrameMs(view))
    return filling ? Math.min(GAUGE_FRAME_MS, rest) : rest
  }
}
