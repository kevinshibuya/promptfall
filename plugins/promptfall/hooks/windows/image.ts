// The image encoder: one window as an RGBA picture at CELL_W × CELL_H pixels per cell, for the
// terminals that draw pictures. `encodeImage(windowFrame(win), WINDOW_SCALE)` makes its source.
import { decodePixels } from '../sprites/index'
import type { Frame } from '../stage/compose'
import {
  barPixels,
  chars,
  fitArt,
  frameRole,
  glyphFor,
  OUT,
  type Placed,
  placeLine,
  type Span,
  WHITE,
  type Win,
} from './kit'
import {
  BAR_BACK_RGB,
  BAR_H,
  BAR_Y,
  BORDER_RGB,
  CELL_H,
  CELL_W,
  FIELD_RGB,
  MARGIN_PX,
} from './tuning'

/** The window's Image key, one per size: a keyed Image that changes size keeps its first placement. */
export function windowKey(win: Win): string {
  return `win-${win.key}-${win.columns}x${win.rows}`
}

function put(f: Frame, x: number, y: number, rgb: number): void {
  if (x < 0 || y < 0 || x >= f.width || y >= f.height) return
  const i = (y * f.width + x) * 4
  f.rgba[i] = (rgb >>> 16) & 0xff
  f.rgba[i + 1] = (rgb >>> 8) & 0xff
  f.rgba[i + 2] = rgb & 0xff
  f.rgba[i + 3] = 255
}

function drawGlyph(f: Frame, ch: string, x: number, y: number, rgb: number): void {
  if (ch === ' ') return
  const rows = glyphFor(ch)
  for (let gy = 0; gy < CELL_H; gy++) {
    const bits = rows[gy] ?? 0
    if (bits === 0) continue
    for (let gx = 0; gx < CELL_W; gx++) if (bits & (0x80 >> gx)) put(f, x + gx, y + gy, rgb)
  }
}

function drawPlaced(f: Frame, placed: readonly Placed[], x0: number, y0: number): void {
  for (const p of placed) {
    const x = x0 + p.x * CELL_W
    if (p.kind === 'text') {
      for (const [i, ch] of chars(p.text).entries()) drawGlyph(f, ch, x + i * CELL_W, y0, p.rgb)
    } else if (p.kind === 'cursor') {
      drawGlyph(f, '▶', x, y0, BORDER_RGB)
    } else if (p.kind === 'art') {
      const { art, dx, dy } = fitArt(p.art)
      const px = decodePixels(art)
      for (let ay = 0; ay < art.height; ay++)
        for (let ax = 0; ax < art.width; ax++) {
          const v = px[ay * art.width + ax] ?? 0
          // Index 0 is transparent: the field shows through.
          if (v !== 0) put(f, x + dx + ax, y0 + dy + ay, art.palette[v] ?? 0)
        }
    } else {
      const filled = barPixels(p.cells, p.fill)
      for (let bx = 0; bx < p.cells * CELL_W; bx++) {
        const rgb = bx < filled ? p.rgb : BAR_BACK_RGB
        for (let by = 0; by < BAR_H; by++) put(f, x + bx, y0 + BAR_Y + by, rgb)
      }
    }
  }
}

/** The title or footer's spans, laid from cell 2 up to the last cell before the corner. */
function drawBorderText(f: Frame, win: Win, spans: readonly Span[] | undefined, y0: number): void {
  if (!spans || spans.length === 0) return
  drawPlaced(f, placeLine(spans, Math.max(0, win.columns - 4)), 2 * CELL_W, y0)
}

/** A window at native size: frame, title and footer, inner lines. Alpha 0 outside the frame. */
export function windowFrame(win: Win): Frame {
  const width = win.columns * CELL_W
  const height = win.rows * CELL_H
  const f: Frame = { width, height, rgba: new Uint8ClampedArray(width * height * 4) }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const role = frameRole(win, x, y)
      if (role === OUT) continue
      put(f, x, y, role === WHITE ? BORDER_RGB : FIELD_RGB)
    }
  }
  drawBorderText(f, win, win.title, 0)
  drawBorderText(f, win, win.footer, (win.rows - 1) * CELL_H)
  const inner = win.columns - 2
  for (const [r, line] of win.lines.slice(0, win.rows - 2).entries()) {
    const y0 = (r + 1) * CELL_H
    drawPlaced(f, placeLine(line.spans, inner, line.reveal), CELL_W, y0)
    if (line.rule) {
      // From the left white line to the right one, so the divider joins the frame.
      const from = MARGIN_PX + 1
      const to = width - MARGIN_PX - 2
      for (let x = from; x <= to; x++) put(f, x, y0 + CELL_H - 1, BORDER_RGB)
    }
  }
  return f
}
