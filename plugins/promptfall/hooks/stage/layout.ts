import type { RenderSurface } from 'claude-code'
import type { BandTab } from '../../types'
import { COMPACT_WINDOW_ROWS, STRIP_ROWS } from '../windows/tuning'
import {
  COMPACT_STAGE_COLUMNS,
  COMPACT_STAGE_ROWS,
  FULL_MIN_COLUMNS,
  IMAGE_MAX_BYTES,
  IMAGE_SCALE,
  MIN_COLUMNS,
  STAGE_MAX_COLUMNS,
} from './tuning'

/** The stage in cells; pixels are columns × (rows * 2). */
export type Box = { columns: number; rows: number }
export type Layout =
  /** `cells`, when present, is the smaller box an Image stage too tall for the band draws into. */
  | { kind: 'full'; box: Box; cells?: Box; bandRows: number }
  | { kind: 'compact'; box: Box; bandRows: number }
  | { kind: 'bare'; box: null; bandRows: number }
  | { kind: 'collapsed'; box: null; bandRows: 1 }

/**
 * `rows` is timeline.rowsAt(view, now): the stage's height for what is on it. The window strip
 * goes under the stage (full), beside the compact stage (compact, COMPACT_WINDOW_ROWS), or alone
 * on Loot and World (bare). `extra` is the hotkey row of rung (c) where the renderer needs one.
 * Terminals fit the band in cells; the Svg surfaces scale it, so they never collapse (ADR 0004).
 */
export function layoutFor(
  rows: number,
  props: { bodyColumns: number; maxRows: number },
  surface: RenderSurface,
  opts: { tab: BandTab; extra: 0 | 1; scalable?: boolean },
): Layout {
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
  // An Image scales to its box: a stage too tall for the band (a boss, a long prompt) zooms out
  // rather than flipping the band to compact. The scene widens so that, scaled into the rows left,
  // it still spans the band; as far as its picture stays within IMAGE_MAX_BYTES.
  const room = props.maxRows - STRIP_ROWS - opts.extra
  if (opts.scalable && props.bodyColumns >= FULL_MIN_COLUMNS && room >= COMPACT_STAGE_ROWS) {
    const columns = Math.min(props.bodyColumns, STAGE_MAX_COLUMNS)
    // The Image's bytes: columns × rows cells at IMAGE_SCALE × 2·IMAGE_SCALE pixels, 4 a pixel.
    const budget = Math.floor(IMAGE_MAX_BYTES / (IMAGE_SCALE * 2 * IMAGE_SCALE * 4 * rows))
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
