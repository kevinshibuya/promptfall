// The band as one picture (ADR 0011): the shell over the band's whole box, the playfield centred
// on it, the stage above the strip inside one window line. Pure; the Image path draws its bitmap,
// the Raster and Svg paths reuse its placement.
import { windowFrame } from '../windows/image'
import type { Scene } from '../windows/kit'
import { BORDER_PX, BORDER_RGB, CELL_H, CELL_W, FIELD_RGB, PAD_PX } from '../windows/tuning'
import type { Frame } from './compose'
import type { Box } from './layout'
import { HIRES_SCALE, STAGE_MAX_COLUMNS } from './tuning'

/** The playfield within the band's box, in cells: its column and row offsets and its size. */
export type Placement = { x: number; y: number; columns: number; rows: number }

/** The playfield's cells: `min(columns, 160)` wide, every row of the band, centred. */
export function playfieldOf(band: Box): Placement {
  const columns = Math.min(band.columns, STAGE_MAX_COLUMNS)
  return { x: Math.floor((band.columns - columns) / 2), y: 0, columns, rows: band.rows }
}

/**
 * How far in from the band's edge the line sits where the playfield fills it. A window's white
 * line sits CELL_W - PAD_PX - BORDER_PX in from its side: inside the stage's outermost art pixel
 * (16/3 wide) and on the strip windows' outer side lines. At the bottom it is the strip's own
 * line, CELL_H - PAD_PX - BORDER_PX up.
 */
const LINE_IN = CELL_W - PAD_PX - BORDER_PX
const LINE_IN_STRIP = CELL_H - PAD_PX - BORDER_PX

// The band is drawn a whole pixel at a time, through a Uint32Array over the RGBA bytes, and in
// spans the runtime fills or copies natively: a frame is a few hundred thousand pixels, every
// busy beat, in the hooks' runtime.

/** An opaque `rgb` as one RGBA pixel read as a 32-bit word, in the platform's byte order. */
function word(rgb: number): number {
  const px = Uint8Array.of((rgb >>> 16) & 0xff, (rgb >>> 8) & 0xff, rgb & 0xff, 255)
  return new Uint32Array(px.buffer)[0] ?? 0
}

const FIELD = word(FIELD_RGB)
const BORDER = word(BORDER_RGB)
/** The alpha byte alone: a pixel ANDed with it is 0 where the pixel is transparent. */
const ALPHA = word(0)

/** The frame's pixels as words; a frame whose bytes do not start on a word is copied first. */
function words(f: Frame): Uint32Array {
  const { buffer, byteOffset, length } = f.rgba
  return byteOffset % 4 === 0
    ? new Uint32Array(buffer, byteOffset, length / 4)
    : new Uint32Array(f.rgba.slice().buffer)
}

/**
 * The stage frame (1.5x art) over the shell into `w × h` pixels at (x0, y0). A frame of the
 * stage's own rows draws at 16/3 pixels an art pixel, nearest-neighbour, so the art stays crisp;
 * a zoomed-out scene, wider than the playfield, is scaled into it with area averaging.
 */
function drawStage(band: Frame, stage: Frame, x0: number, y0: number, w: number, h: number): void {
  if (stage.height * CELL_H === h * 2 * HIRES_SCALE) {
    const src = words(stage)
    const dst = words(band)
    const xs = new Int32Array(w)
    for (let x = 0; x < w; x++) {
      xs[x] = Math.min(stage.width - 1, Math.floor((x * HIRES_SCALE) / CELL_W))
    }
    let last = -1
    for (let y = 0; y < h; y++) {
      const sy = Math.min(stage.height - 1, Math.floor((y * 2 * HIRES_SCALE) / CELL_H))
      const at = (y0 + y) * band.width + x0
      // An art row spans 16/3 band rows: the first draws it, the rest copy the row above.
      if (sy === last) {
        dst.copyWithin(at, at - band.width, at - band.width + w)
        continue
      }
      last = sy
      const row = sy * stage.width
      for (let x = 0; x < w; x++) {
        const px = src[row + (xs[x] ?? 0)] ?? 0
        dst[at + x] = (px & ALPHA) === 0 ? FIELD : px | ALPHA
      }
    }
    return
  }
  const xs = taps(stage.width, w)
  const ys = taps(stage.height, h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0
      let g = 0
      let b = 0
      for (const [sy, wy] of ys[y] ?? []) {
        for (const [sx, wx] of xs[x] ?? []) {
          const si = (sy * stage.width + sx) * 4
          const rgb = (stage.rgba[si + 3] ?? 0) === 0 ? FIELD_RGB : rgbAt(stage, si)
          const k = wx * wy
          r += ((rgb >>> 16) & 0xff) * k
          g += ((rgb >>> 8) & 0xff) * k
          b += (rgb & 0xff) * k
        }
      }
      const di = ((y0 + y) * band.width + x0 + x) * 4
      band.rgba[di] = Math.round(r)
      band.rgba[di + 1] = Math.round(g)
      band.rgba[di + 2] = Math.round(b)
      band.rgba[di + 3] = 255
    }
  }
}

function rgbAt(f: Frame, i: number): number {
  return ((f.rgba[i] ?? 0) << 16) | ((f.rgba[i + 1] ?? 0) << 8) | (f.rgba[i + 2] ?? 0)
}

/** For each of `to` pixels, the `from` pixels its footprint covers and the share of each. */
function taps(from: number, to: number): [number, number][][] {
  const step = from / to
  const out: [number, number][][] = []
  for (let i = 0; i < to; i++) {
    const a = i * step
    const b = a + step
    const row: [number, number][] = []
    for (let s = Math.floor(a); s < Math.min(from, Math.ceil(b)); s++) {
      const cover = Math.min(b, s + 1) - Math.max(a, s)
      if (cover > 0) row.push([s, cover / step])
    }
    out.push(row)
  }
  return out
}

/** The strip's windows, each opaque pixel as it is; the shell shows between and around them. */
function drawStrip(band: Frame, scene: Scene, x0: number, y0: number): void {
  const dst = words(band)
  for (const win of scene.windows) {
    const f = windowFrame(win)
    const src = words(f)
    const left = x0 + win.x * CELL_W
    const top = y0 + (win.y ?? 0) * CELL_H
    for (let y = 0; y < f.height; y++) {
      const row = y * f.width
      const at = (top + y) * band.width + left
      // Each run of opaque pixels in one copy; the transparent ones between leave the shell.
      let x = 0
      while (x < f.width) {
        while (x < f.width && ((src[row + x] ?? 0) & ALPHA) === 0) x++
        const from = x
        while (x < f.width && ((src[row + x] ?? 0) & ALPHA) !== 0) x++
        if (x > from) dst.set(src.subarray(row + from, row + x), at + from)
      }
    }
  }
}

/**
 * The line: BORDER_PX white with cut corners, the shell outside it. With shell beside the
 * playfield it sits just outside it; where the playfield meets the band's edge it sits over the
 * stage's outermost art pixel (the top, a side) and over the strip's own outer line (the bottom),
 * so no stage row or column is spent on it (ADR 0010).
 */
function drawLine(band: Frame, at: Placement, full: Box): void {
  const pfLeft = at.x * CELL_W
  const pfRight = (at.x + at.columns) * CELL_W - 1
  const left = at.x > 0 ? pfLeft - BORDER_PX : pfLeft + LINE_IN
  const right = at.x + at.columns < full.columns ? pfRight + BORDER_PX : pfRight - LINE_IN
  const top = at.y * CELL_H + LINE_IN
  const bottom = (at.y + at.rows) * CELL_H - 1 - LINE_IN_STRIP
  const dst = words(band)
  for (let y = 0; y < band.height; y++) {
    const row = y * band.width
    if (y < top || y > bottom) {
      dst.fill(FIELD, row, row + band.width)
      continue
    }
    dst.fill(FIELD, row, row + Math.max(0, left))
    dst.fill(FIELD, row + right + 1, row + band.width)
    if (y - top < BORDER_PX || bottom - y < BORDER_PX) {
      dst.fill(BORDER, row + left, row + right + 1)
    } else {
      dst.fill(BORDER, row + left, row + left + BORDER_PX)
      dst.fill(BORDER, row + right - BORDER_PX + 1, row + right + 1)
    }
    // The corners are cut: the line's own corner pixel is the shell.
    if (y === top || y === bottom) {
      dst[row + left] = FIELD
      dst[row + right] = FIELD
    }
  }
}

/**
 * The Party tab's band as one bitmap on the windows' grid, CELL_W × CELL_H pixels a cell: the
 * shell over `band`, and on it the playfield, `stage` (a 1.5x frame) in the rows the strip leaves
 * above `strip`, inside the line. Every pixel is opaque.
 */
export function composeBand(band: Box, stage: Frame, strip: Scene): Frame {
  const width = band.columns * CELL_W
  const height = band.rows * CELL_H
  const out: Frame = { width, height, rgba: new Uint8ClampedArray(width * height * 4) }
  words(out).fill(FIELD)
  const at = playfieldOf(band)
  const stageRows = at.rows - strip.rows
  const x0 = at.x * CELL_W
  const y0 = at.y * CELL_H
  drawStage(out, stage, x0, y0, at.columns * CELL_W, stageRows * CELL_H)
  drawStrip(out, strip, x0, y0 + stageRows * CELL_H)
  drawLine(out, at, band)
  return out
}
