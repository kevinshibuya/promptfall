// The window model all three encoders draw (ADR 0005): windows laid out in cells, their text in
// the baked pixel font, their frame as Dragon Quest V draws it
// (docs/design/ui-remake/transcription.md). No surface code here.
import { glyph } from './glyphs'
import { BORDER_PX, CELL_H, CELL_W, MARGIN_PX, PAD_PX, TEXT_RGB } from './tuning'

/** A run of text, or a bar, or the ▶ cursor cell, laid left to right in a line. */
export type Span =
  | { text: string; rgb?: number } // TEXT_RGB when absent; one cell per character
  | { bar: number; cells: number; rgb: number } // bar: fill 0..10000 over `cells` cells, BAR_BACK_RGB behind
  | { cursor: boolean } // one cell: ▶ when true, blank when false
  | { gap: number } // blank cells

export type Line = {
  spans: readonly Span[]
  /** Pixel encoders draw a 1 px BORDER_RGB rule along this line's bottom edge; raster draws nothing. */
  rule?: boolean
  /** Characters of text shown, counted over the line's text spans; absent = all. Typing. */
  reveal?: number
}

export type Win = {
  /** Stable id: the Image key's stem and the Svg group id. */
  key: string
  /** Cells, border included. A strip window spans every row of the strip: y = 0, rows = scene rows. */
  x: number
  columns: number
  rows: number
  /** Drawn into the top border from column 1, with one border cell kept on each side. */
  title?: readonly Span[]
  /** Drawn into the bottom border the same way (compact's command line). */
  footer?: readonly Span[]
  /** Inner rows, top to bottom; at most rows - 2. A missing row is blank. */
  lines: readonly Line[]
  /** The text a screen reader gets for this window. */
  alt: string
}

export type Scene = { columns: number; rows: number; windows: readonly Win[]; alt: string }

/** Desktop only: how parts of the scene change over the next `horizon` ms, as SMIL. */
export type Track =
  | {
      kind: 'bar'
      window: string
      line: number
      /** Index of the bar span in that line. */
      span: number
      /** Linear between keys; `at` in ms after the scene's now, non-decreasing, the first at 0.
       *  Two keys at one `at` are a jump (a gauge reset). */
      keys: readonly { at: number; fill: number }[]
      /** The bar's colour switches to this while fill is 10000. */
      fullRgb: number
    }
  | {
      kind: 'lines'
      window: string
      /** Each frame replaces the window's inner lines from its `at` until the next frame's. */
      frames: readonly {
        at: number
        lines: readonly Line[]
        /** The line typing through this frame; `from` cells already show at its start. */
        typing?: { line: number; charMs: number; from?: number }
      }[]
    }
  | {
      kind: 'cursor'
      window: string
      line: number
      /** Index of the cursor span in that line. */
      span: number
      /** ▶ shows during each interval, ms after the scene's now. */
      on: readonly { from: number; until: number }[]
    }

/** A span laid at cell `x` of its line (0 = the first inner cell), clipped to the line's width. */
export type Placed = { x: number; span: number } & (
  | { kind: 'text'; text: string; rgb: number }
  | { kind: 'bar'; cells: number; fill: number; rgb: number }
  | { kind: 'cursor' }
)

/** One string per character (code point), so a character is one cell. */
export function chars(text: string): string[] {
  return Array.from(text)
}

/** The cells a span takes. */
export function spanCells(span: Span): number {
  if ('text' in span) return chars(span.text).length
  if ('bar' in span) return span.cells
  if ('cursor' in span) return 1
  return span.gap
}

/**
 * Lays a line's spans from cell 0, clipped at `width` cells; `reveal` cuts the text after that
 * many characters (bars and the cursor stay). Blank cells (a gap, a cursor that is off) place
 * nothing.
 */
export function placeLine(spans: readonly Span[], width: number, reveal?: number): Placed[] {
  const out: Placed[] = []
  let x = 0
  let left = reveal ?? Number.POSITIVE_INFINITY
  for (const [i, span] of spans.entries()) {
    if (x >= width) break
    const room = width - x
    if ('text' in span) {
      const cs = chars(span.text).slice(0, Math.min(room, Math.max(0, left)))
      left -= Math.min(chars(span.text).length, room)
      if (cs.length > 0)
        out.push({ x, span: i, kind: 'text', text: cs.join(''), rgb: span.rgb ?? TEXT_RGB })
    } else if ('bar' in span) {
      const cells = Math.min(room, span.cells)
      if (cells > 0)
        out.push({ x, span: i, kind: 'bar', cells, fill: clampFill(span.bar), rgb: span.rgb })
    } else if ('cursor' in span) {
      if (span.cursor) out.push({ x, span: i, kind: 'cursor' })
    }
    x += spanCells(span)
  }
  return out
}

export function clampFill(fill: number): number {
  return Math.max(0, Math.min(10000, Math.round(fill)))
}

/** A bar's filled width in picture pixels: whole pixels, never past the bar. */
export function barPixels(cells: number, fill: number): number {
  return Math.round((cells * CELL_W * clampFill(fill)) / 10000)
}

/**
 * The character the font draws for `ch`: itself, else its base letter (é as e; the font has no
 * accented letters), else `?`.
 */
export function drawable(ch: string): string {
  if (ch === ' ' || glyph(ch)) return ch
  const base = ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  return base.length === 1 && glyph(base) ? base : '?'
}

/** The glyph for a character, through `drawable`; blank for a space. */
export function glyphFor(ch: string): Uint8Array {
  return glyph(drawable(ch)) as Uint8Array
}

/** What a window pixel is: outside the window, field, or white line. */
export const OUT = 0
export const FIELD = 1
export const WHITE = 2
export type Role = typeof OUT | typeof FIELD | typeof WHITE

/**
 * One axis of the frame. `d` is the distance in pixels from the window's outer edge, `band` the
 * border cell's size on that axis (CELL_W or CELL_H). Inside the border cell, from the content
 * side outwards: PAD_PX field, BORDER_PX white, MARGIN_PX field, then nothing.
 */
function axis(d: number, band: number): 'out' | 'margin' | 'white' | 'in' {
  if (d >= band) return 'in'
  const fromContent = band - 1 - d
  if (fromContent < PAD_PX) return 'in'
  if (fromContent < PAD_PX + BORDER_PX) return 'white'
  if (fromContent < PAD_PX + BORDER_PX + MARGIN_PX) return 'margin'
  return 'out'
}

/** The plate a title or footer sits on: picture-pixel x range, or null. */
export function plateOf(
  win: Win,
  spans: readonly Span[] | undefined,
): { from: number; to: number } | null {
  if (!spans || spans.length === 0) return null
  const cells = spans.reduce((n, s) => n + spanCells(s), 0)
  const last = Math.min(win.columns - 2, 2 + cells)
  if (last < 1) return null
  return { from: CELL_W, to: (last + 1) * CELL_W }
}

/** The frame's role for picture pixel (px, py) of a window, plates included. */
export function frameRole(win: Win, px: number, py: number): Role {
  const w = win.columns * CELL_W
  const h = win.rows * CELL_H
  if (py < CELL_H || py >= h - CELL_H) {
    const plate = plateOf(win, py < CELL_H ? win.title : win.footer)
    if (plate && px >= plate.from && px < plate.to) return FIELD
  }
  const ax = axis(Math.min(px, w - 1 - px), CELL_W)
  const ay = axis(Math.min(py, h - 1 - py), CELL_H)
  if (ax === 'out' || ay === 'out') return OUT
  if (ax === 'margin' && ay === 'margin') return OUT // the margin's corner pixel is cut
  if (ax === 'margin' || ay === 'margin') return FIELD
  if (ax === 'white' && ay === 'white') {
    // The white line's outermost corner pixel is cut (DQ V's 1 px rounding).
    const dx = Math.min(px, w - 1 - px)
    const dy = Math.min(py, h - 1 - py)
    if (dx === CELL_W - PAD_PX - BORDER_PX && dy === CELL_H - PAD_PX - BORDER_PX) return FIELD
    return WHITE
  }
  if (ax === 'white' || ay === 'white') return WHITE
  return FIELD
}
