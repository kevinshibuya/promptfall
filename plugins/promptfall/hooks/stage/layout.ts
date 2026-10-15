import type { RenderSurface } from 'claude-code'
import type { BandTab } from '../../types'
import { COMPACT_WINDOW_ROWS, STRIP_ROWS } from '../windows/tuning'
import {
  COMPACT_STAGE_COLUMNS,
  COMPACT_STAGE_ROWS,
  FULL_MIN_COLUMNS,
  IMAGE_MAX_SIDE,
  IMAGE_MIN_SCALE,
  IMAGE_SCALE,
  MIN_COLUMNS,
  RASTER_MIN_ROWS,
  STAGE_MAX_COLUMNS,
  STAGE_MIN_ROWS,
} from './tuning'

/** The stage in cells; pixels are columns × (rows * 2). */
export type Box = { columns: number; rows: number }
export type Layout =
  /**
   * `cells`, when present, is the smaller box a full stage too tall for the band draws into.
   * With `box`'s columns it shows the box's bottom rows, the sky above them cropped; with other
   * columns it is the zoom-out, the whole (widened) scene in `box` scaled into it. The Raster's
   * zoom follows its crop, so its `box` has the cropped scene's rows (#230).
   */
  | { kind: 'full'; box: Box; cells?: Box; bandRows: number }
  | { kind: 'compact'; box: Box; bandRows: number }
  | { kind: 'bare'; box: null; bandRows: number }
  | { kind: 'collapsed'; box: null; bandRows: 1 }

/**
 * `rows` is timeline.rowsAt(view, now): the stage's height for what is on it. The window strip
 * goes under the stage (full), beside the compact stage (compact, COMPACT_WINDOW_ROWS), or alone
 * on Loot and World (bare). `extra` is the hotkey row of rung (c) where the renderer needs one.
 * A `scalable` renderer (the Image) draws the whole stage zoomed out into a short band; the
 * Raster crops the sky down to `minRows` (timeline.minRowsAt, the tallest actor), then zooms the
 * cropped scene out down to RASTER_MIN_ROWS, then goes compact (ADR 0010, #230).
 * Terminals fit the band in cells; the Svg surfaces scale it, so they never collapse (ADR 0004).
 */
export function layoutFor(
  rows: number,
  props: { bodyColumns: number; maxRows: number },
  surface: RenderSurface,
  opts: { tab: BandTab; extra: 0 | 1; minRows?: number; scalable?: boolean },
): Layout {
  const minRows = opts.minRows ?? STAGE_MIN_ROWS
  const party = opts.tab === 'party'
  if (surface !== 'terminal') {
    if (!party) return { kind: 'bare', box: null, bandRows: STRIP_ROWS + opts.extra }
    const columns = Math.min(Math.max(props.bodyColumns, FULL_MIN_COLUMNS), STAGE_MAX_COLUMNS)
    return { kind: 'full', box: { columns, rows }, bandRows: rows + STRIP_ROWS + opts.extra }
  }
  if (!party) {
    if (props.bodyColumns >= MIN_COLUMNS && props.maxRows >= STRIP_ROWS + opts.extra)
      return { kind: 'bare', box: null, bandRows: STRIP_ROWS + opts.extra }
    return { kind: 'collapsed', box: null, bandRows: 1 }
  }
  if (props.bodyColumns >= FULL_MIN_COLUMNS && props.maxRows >= rows + STRIP_ROWS + opts.extra) {
    const columns = Math.min(props.bodyColumns, STAGE_MAX_COLUMNS)
    return { kind: 'full', box: { columns, rows }, bandRows: rows + STRIP_ROWS + opts.extra }
  }
  // A stage too tall for the band (a long prompt): the band cannot take more rows than the
  // engine gives it (`maxRows`), so the stage fits what is left. An Image zooms the whole scene
  // out, the zoomed-out view Kevin wants in every fight (ADR 0010): the scene widens so that,
  // scaled into the rows left, it still spans the band. The Raster crops first: it keeps the size
  // it resamples the scene to and shows the stage's bottom `room` rows, the sky cropped, down to
  // the tallest actor's height. Under that it zooms the cropped scene out the Image's way, down to
  // RASTER_MIN_ROWS, where a 24-pixel figure in 16 pixels of height starts to smear (#230).
  const room = props.maxRows - STRIP_ROWS - opts.extra
  const wide = props.bodyColumns >= FULL_MIN_COLUMNS
  const columns = Math.min(props.bodyColumns, STAGE_MAX_COLUMNS)
  if (!opts.scalable && wide && room >= minRows) {
    return {
      kind: 'full',
      box: { columns, rows },
      cells: { columns, rows: room },
      bandRows: props.maxRows,
    }
  }
  if (!opts.scalable && wide && room >= RASTER_MIN_ROWS) {
    const scene = Math.round((columns * minRows) / room)
    return {
      kind: 'full',
      box: { columns: scene, rows: minRows },
      cells: { columns: Math.min(columns, Math.round((scene * room) / minRows)), rows: room },
      bandRows: props.maxRows,
    }
  }
  if (opts.scalable && wide && room >= COMPACT_STAGE_ROWS) {
    // The picture is at most IMAGE_MAX_SIDE wide at IMAGE_MIN_SCALE pixels a column (imageScaleFor), so a
    // short band (#21) still spans it; at that size the PNG stays far under the host's 2 MiB.
    const budget = Math.floor(IMAGE_MAX_SIDE / IMAGE_MIN_SCALE)
    const scene = Math.min(Math.round((columns * rows) / room), budget)
    return {
      kind: 'full',
      box: { columns: scene, rows },
      cells: { columns: Math.min(columns, Math.round((scene * room) / rows)), rows: room },
      bandRows: props.maxRows,
    }
  }
  // Grill 1.17: compact needs its whole 6 rows, or the band collapses.
  if (props.bodyColumns >= MIN_COLUMNS && props.maxRows >= COMPACT_WINDOW_ROWS + opts.extra) {
    return {
      kind: 'compact',
      box: { columns: COMPACT_STAGE_COLUMNS, rows: COMPACT_STAGE_ROWS },
      bandRows: COMPACT_WINDOW_ROWS + opts.extra,
    }
  }
  return { kind: 'collapsed', box: null, bandRows: 1 }
}

/** The cells the stage takes on screen: its box, or the smaller box it shrank into. */
/**
 * The Image's pixels a stage column: IMAGE_SCALE, or fewer (down to IMAGE_MIN_SCALE) when a
 * zoomed-out scene would pass the host's IMAGE_MAX_SIDE. The terminal shrinks such a scene into
 * fewer cells, so the lost upscale never shows.
 */
export function imageScaleFor(columns: number): number {
  return Math.max(IMAGE_MIN_SCALE, Math.min(IMAGE_SCALE, Math.floor(IMAGE_MAX_SIDE / columns)))
}

export function cellsOf(layout: Layout): Box | null {
  return layout.kind === 'full' ? (layout.cells ?? layout.box) : layout.box
}

export function sameLayout(a: Layout, b: Layout): boolean {
  const ac = cellsOf(a)
  const bc = cellsOf(b)
  return (
    a.kind === b.kind &&
    a.box?.columns === b.box?.columns &&
    a.box?.rows === b.box?.rows &&
    ac?.columns === bc?.columns &&
    ac?.rows === bc?.rows
  )
}
