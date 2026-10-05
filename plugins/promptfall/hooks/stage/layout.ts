import type { RenderSurface } from 'claude-code'
import {
  COMPACT_ROWS,
  COMPACT_STAGE_COLUMNS,
  FULL_MIN_COLUMNS,
  MIN_COLUMNS,
  STAGE_MAX_COLUMNS,
  STAGE_TEXT_ROWS,
} from './tuning'

/** The stage in cells; pixels are columns × (rows * 2). */
export type Box = { columns: number; rows: number }
export type Layout =
  | { kind: 'full'; box: Box; bandRows: number }
  | { kind: 'compact'; box: Box; bandRows: 4 }
  | { kind: 'collapsed'; box: null; bandRows: 1 }

/**
 * `rows` is timeline.rowsAt(view, now): the stage's height for what is on it. Terminals fit the
 * stage in cells; the Svg surfaces scale it, so they always get the full stage (ADR 0004).
 */
export function layoutFor(
  rows: number,
  props: { bodyColumns: number; maxRows: number },
  surface: RenderSurface,
): Layout {
  if (surface !== 'terminal') {
    const columns = Math.min(Math.max(props.bodyColumns, FULL_MIN_COLUMNS), STAGE_MAX_COLUMNS)
    return { kind: 'full', box: { columns, rows }, bandRows: rows + STAGE_TEXT_ROWS }
  }
  if (props.bodyColumns >= FULL_MIN_COLUMNS && props.maxRows >= rows + STAGE_TEXT_ROWS) {
    const columns = Math.min(props.bodyColumns, STAGE_MAX_COLUMNS)
    return { kind: 'full', box: { columns, rows }, bandRows: rows + STAGE_TEXT_ROWS }
  }
  if (props.bodyColumns >= MIN_COLUMNS && props.maxRows >= COMPACT_ROWS) {
    return {
      kind: 'compact',
      box: { columns: COMPACT_STAGE_COLUMNS, rows: COMPACT_ROWS },
      bandRows: 4,
    }
  }
  return { kind: 'collapsed', box: null, bandRows: 1 }
}

export function sameLayout(a: Layout, b: Layout): boolean {
  return a.kind === b.kind && a.box?.columns === b.box?.columns && a.box?.rows === b.box?.rows
}
