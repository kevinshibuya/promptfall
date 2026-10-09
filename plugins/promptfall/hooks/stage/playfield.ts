// The band as one picture (ADR 0011): the shell over the band's whole box, the playfield centred
// on it, the stage above the strip inside one window line; on Loot and World the strip alone. Pure; the Image path draws its bitmap,
// the Raster draws the same placement in cells, the Svg path reuses its placement.
import { encode } from '../sprites/base64'
import { windowFrame } from '../windows/image'
import type { Scene } from '../windows/kit'
import { sceneWords } from '../windows/raster'
import { BORDER_PX, BORDER_RGB, CELL_H, CELL_W, FIELD_RGB, PAD_PX } from '../windows/tuning'
import type { Frame } from './compose'
import type { Box } from './layout'
import type { StageNumber } from './model'
import { CLEAR, rasterWords } from './raster'
import { DESKTOP_COLUMN_PX, DESKTOP_ROW_PX, HIRES_SCALE, STAGE_MAX_COLUMNS } from './tuning'

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
 * so no stage row or column is spent on it (ADR 0010). With no stage its top sits over the strip
 * windows' top lines, as its bottom does over their bottom ones.
 */
function drawLine(band: Frame, at: Placement, full: Box, stage: boolean): void {
  const pfLeft = at.x * CELL_W
  const pfRight = (at.x + at.columns) * CELL_W - 1
  const left = at.x > 0 ? pfLeft - BORDER_PX : pfLeft + LINE_IN
  const right = at.x + at.columns < full.columns ? pfRight + BORDER_PX : pfRight - LINE_IN
  const top = at.y * CELL_H + (stage ? LINE_IN : LINE_IN_STRIP)
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
 * The band as one bitmap on the windows' grid, CELL_W × CELL_H pixels a cell: the shell over
 * `band`, and on it the playfield, `stage` (a 1.5x frame) in the rows the strip leaves above
 * `strip`, inside the line. Loot and World pass no stage: the playfield is the strip alone.
 * Every pixel is opaque.
 */
export function composeBand(band: Box, stage: Frame | null, strip: Scene): Frame {
  const width = band.columns * CELL_W
  const height = band.rows * CELL_H
  const out: Frame = { width, height, rgba: new Uint8ClampedArray(width * height * 4) }
  words(out).fill(FIELD)
  const at = playfieldOf(band)
  const stageRows = at.rows - strip.rows
  const x0 = at.x * CELL_W
  const y0 = at.y * CELL_H
  if (stage) drawStage(out, stage, x0, y0, at.columns * CELL_W, stageRows * CELL_H)
  drawStrip(out, strip, x0, y0 + stageRows * CELL_H)
  drawLine(out, at, band, stage !== null)
  return out
}

// The Svg band: the desktop, VS Code and mobile keep two Svgs, the stage's and the strip's, since
// one of both would pass the host's character cap. Each is the band's width on the windows' grid
// and draws its share of the shell and the line, so stacked they read as one of each.

const hex = (rgb: number) => `#${(rgb & 0xffffff).toString(16).padStart(6, '0')}`

/**
 * The share of its natural height the stage Svg draws its stage at (ADR 0004): at the band's
 * width the stage can be taller than the rows the strip leaves, and the desktop scrolls the rest
 * away, so the whole stage scales down to them, the zoomed-out view of ADR 0010; under two rows
 * left it does not. The stage Svg keeps the band's width, so a fitted stage sits on the shell.
 */
export function svgFit(
  props: { bodyColumns: number; maxRows: number },
  box: Box,
  strip: { columns: number; rows: number },
  extra: number,
): number {
  const stripPx =
    (props.bodyColumns * DESKTOP_COLUMN_PX * strip.rows * CELL_H) / (strip.columns * CELL_W)
  const stripRows = Math.ceil(stripPx / DESKTOP_ROW_PX) + extra
  const cap = (props.maxRows - stripRows) * DESKTOP_ROW_PX
  const natural = (props.bodyColumns * DESKTOP_COLUMN_PX * box.rows * 2) / box.columns
  return natural > cap && cap >= DESKTOP_ROW_PX * 2 ? cap / natural : 1
}

/**
 * One Svg's share of the band's frame, `w × h` pixels on the windows' grid: `under`, the shell
 * behind everything it draws, and `over`, the shell outside the line and the line, drawn last.
 * The stage's share (`top`) is the line's top and sides, open at its bottom edge; the strip's
 * (`bottom`) the sides from its top edge down to the bottom line, over the outer windows' own.
 * On Loot and World the strip Svg is the whole playfield (`both`): the line all round, its top
 * over the windows' top lines. The line sits where `composeBand` draws it when the playfield
 * fills the band: 2 pixels wide, LINE_IN from each side, LINE_IN from the top over a stage and
 * LINE_IN_STRIP over a strip, LINE_IN_STRIP from the bottom, corners cut.
 */
export function svgFrame(
  w: number,
  h: number,
  edge: 'top' | 'bottom' | 'both',
): { under: string; over: string } {
  const l = LINE_IN
  const r = w - LINE_IN
  const b = BORDER_PX
  // The line's outer outline, and the line itself: the outline less its inside.
  let outline: string
  let line: string
  if (edge === 'top') {
    const t = LINE_IN
    outline = `M${l + 1} ${t}H${r - 1}V${t + 1}H${r}V${h}H${l}V${t + 1}H${l + 1}Z`
    line = `M${l + 1} ${t}H${r - 1}V${t + 1}H${r}V${h}H${r - b}V${t + b}H${l + b}V${h}H${l}V${t + 1}H${l + 1}Z`
  } else if (edge === 'bottom') {
    const e = h - LINE_IN_STRIP
    outline = `M${l} 0H${r}V${e - 1}H${r - 1}V${e}H${l + 1}V${e - 1}H${l}Z`
    line = `M${l} 0H${l + b}V${e - b}H${r - b}V0H${r}V${e - 1}H${r - 1}V${e}H${l + 1}V${e - 1}H${l}Z`
  } else {
    const t = LINE_IN_STRIP
    const e = h - LINE_IN_STRIP
    outline = `M${l + 1} ${t}H${r - 1}V${t + 1}H${r}V${e - 1}H${r - 1}V${e}H${l + 1}V${e - 1}H${l}V${t + 1}H${l + 1}Z`
    // A ring: the outline less its inside, by the even-odd rule.
    line = `${outline}M${l + b} ${t + b}V${e - b}H${r - b}V${t + b}Z`
  }
  const ring = edge === 'both' ? ' fill-rule="evenodd"' : ''
  return {
    under: `<rect width="${w}" height="${h}" fill="${hex(FIELD_RGB)}"/>`,
    over:
      `<path fill="${hex(FIELD_RGB)}" fill-rule="evenodd" d="M0 0H${w}V${h}H0Z${outline}"/>` +
      `<path fill="${hex(BORDER_RGB)}"${ring} d="${line}"/>`,
  }
}

// The Raster's band: the same placement in cells, the line in the strip windows' box-drawing text.

/** The fewest shell cells a side for the line to sit in the margin; under it, it sits inside. */
const LINE_MARGIN_CELLS = 2
const SPACE = 0x20
const cp = (ch: string): number => ch.codePointAt(0) ?? SPACE

/** The stage frame with every transparent pixel the shell's, so no cell shows the terminal. */
function onShell(stage: Frame): Frame {
  const out: Frame = { ...stage, rgba: stage.rgba.slice() }
  const px = words(out)
  for (let i = 0; i < px.length; i++) if (((px[i] ?? 0) & ALPHA) === 0) px[i] = FIELD
  return out
}

/** Copies `src`'s cells, `columns` wide, into the band at (x0, y0); a CLEAR cell is the shell's. */
function lay(
  dst: Uint32Array,
  band: Box,
  src: Uint32Array,
  columns: number,
  x0: number,
  y0: number,
) {
  const rows = src.length / 3 / columns
  for (let y = 0; y < rows && y0 + y < band.rows; y++) {
    for (let x = 0; x < columns && x0 + x < band.columns; x++) {
      const s = (y * columns + x) * 3
      if (src[s + 2] === CLEAR) continue
      dst.set(src.subarray(s, s + 3), ((y0 + y) * band.columns + x0 + x) * 3)
    }
  }
}

/**
 * The band as Raster cells, `band` columns by rows, base64: the shell's cells, and on them the
 * playfield at `playfieldOf`, `stage` (a 1x frame of the stage rows shown, its sky cropped on a
 * short band) above `strip`, inside one line; Loot and World pass no stage. The line takes the
 * shell's margin when it is two cells or more a side; under that it sits over the playfield's
 * outermost columns, so 160 to 163 columns draw like 160. Its top row is over the stage's top
 * row, or the strip's own top line with no stage, and its bottom row over the strip's own bottom
 * line, each window side meeting it. A damage number stays inside it.
 */
export function composeBandCells(
  band: Box,
  stage: Frame | null,
  numbers: readonly StageNumber[],
  strip: Scene,
): string {
  const cells = new Uint32Array(band.columns * band.rows * 3)
  for (let i = 0; i < cells.length; i += 3) cells.set([SPACE, FIELD_RGB, FIELD_RGB], i)
  const at = playfieldOf(band)
  const stageRows = at.rows - strip.rows
  const inside = at.x < LINE_MARGIN_CELLS
  const left = inside ? at.x : at.x - 1
  const right = inside ? at.x + at.columns - 1 : at.x + at.columns
  const inset = inside ? 1 : 0
  if (stage) {
    const kept = numbers.map((n) => ({
      ...n,
      x: Math.max(inset, Math.min(stage.width - inset - n.text.length, n.x)),
      y: Math.max(2, n.y),
    }))
    lay(cells, band, rasterWords(onShell(stage), kept), stage.width, at.x, at.y)
  }
  lay(cells, band, sceneWords(strip), strip.columns, at.x, at.y + stageRows)

  const top = at.y
  const bottom = at.y + at.rows - 1
  const put = (x: number, y: number, ch: string) =>
    cells.set([cp(ch), BORDER_RGB, FIELD_RGB], (y * band.columns + x) * 3)
  const under = (x: number, y: number) => cells[(y * band.columns + x) * 3]
  for (let x = left + 1; x < right; x++) {
    // A window's side comes up to meet the top line (no stage) and down to meet the bottom one.
    const above = under(x, top) === cp('╭') || under(x, top) === cp('╮')
    put(x, top, above ? '┬' : '─')
    const below = under(x, bottom) === cp('╰') || under(x, bottom) === cp('╯')
    put(x, bottom, below ? '┴' : '─')
  }
  for (let y = top + 1; y < bottom; y++) {
    // Over the strip's outer windows, their top lines run into the line's sides.
    put(left, y, under(left, y) === cp('╭') ? '├' : '│')
    put(right, y, under(right, y) === cp('╮') ? '┤' : '│')
  }
  put(left, top, '╭')
  put(right, top, '╮')
  put(left, bottom, '╰')
  put(right, bottom, '╯')
  return encode(new Uint8Array(cells.buffer))
}
