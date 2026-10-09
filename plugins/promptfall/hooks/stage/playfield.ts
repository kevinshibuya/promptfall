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

function put(f: Frame, i: number, rgb: number): void {
  f.rgba[i] = (rgb >>> 16) & 0xff
  f.rgba[i + 1] = (rgb >>> 8) & 0xff
  f.rgba[i + 2] = rgb & 0xff
  f.rgba[i + 3] = 255
}

/**
 * The stage frame (1.5x art) over the shell into `w × h` pixels at (x0, y0). A frame of the
 * stage's own rows draws at 16/3 pixels an art pixel, nearest-neighbour, so the art stays crisp;
 * a zoomed-out scene, wider than the playfield, is scaled into it with area averaging.
 */
function drawStage(band: Frame, stage: Frame, x0: number, y0: number, w: number, h: number): void {
  if (stage.height * CELL_H === h * 2 * HIRES_SCALE) {
    for (let y = 0; y < h; y++) {
      const sy = Math.min(stage.height - 1, Math.floor((y * 2 * HIRES_SCALE) / CELL_H))
      for (let x = 0; x < w; x++) {
        const sx = Math.min(stage.width - 1, Math.floor((x * HIRES_SCALE) / CELL_W))
        const si = (sy * stage.width + sx) * 4
        const rgb = (stage.rgba[si + 3] ?? 0) === 0 ? FIELD_RGB : rgbAt(stage, si)
        put(band, ((y0 + y) * band.width + x0 + x) * 4, rgb)
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
  for (const win of scene.windows) {
    const f = windowFrame(win)
    const left = x0 + win.x * CELL_W
    const top = y0 + (win.y ?? 0) * CELL_H
    for (let y = 0; y < f.height; y++) {
      for (let x = 0; x < f.width; x++) {
        const si = (y * f.width + x) * 4
        if ((f.rgba[si + 3] ?? 0) === 0) continue
        band.rgba.set(f.rgba.subarray(si, si + 4), ((top + y) * band.width + left + x) * 4)
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
  for (let y = 0; y < band.height; y++) {
    for (let x = 0; x < band.width; x++) {
      const i = (y * band.width + x) * 4
      if (x < left || x > right || y < top || y > bottom) {
        put(band, i, FIELD_RGB)
        continue
      }
      const dx = Math.min(x - left, right - x)
      const dy = Math.min(y - top, bottom - y)
      if (dx >= BORDER_PX && dy >= BORDER_PX) continue
      put(band, i, dx === 0 && dy === 0 ? FIELD_RGB : BORDER_RGB)
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
  for (let i = 0; i < out.rgba.length; i += 4) put(out, i, FIELD_RGB)
  const at = playfieldOf(band)
  const stageRows = at.rows - strip.rows
  const x0 = at.x * CELL_W
  const y0 = at.y * CELL_H
  drawStage(out, stage, x0, y0, at.columns * CELL_W, stageRows * CELL_H)
  drawStrip(out, strip, x0, y0 + stageRows * CELL_H)
  drawLine(out, at, band)
  return out
}
