// Cuts a zone backdrop from a gpt-image-2 sheet: the painted band (everything that is not the
// magenta key) is resampled to the full stage's width at 1.5x (240 px) and at 1x (160 px), fitted
// to the stage's boss height (51 and 34 rows: the top is cropped, or the sky extended), and
// quantised to at most 16 colours so the pixels stay flat. The stage bottom-anchors the result, so
// the painting's ground must sit on the band's bottom edge.
//
// tsx scripts/backdrop.ts <sheet.png> --zone <n> [--fit width|height] [--colours <n>] [--band <y0,y1>]
//   [--sample vote|mean] [--out <dir>]
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { blank, medianCut, nearest, type Rgba, readPng, rgbOf, writePng } from './png'
import { isKey } from './slice-sheet'
import { BACKDROP, BACKDROP_COLOURS, BACKDROP_HIRES } from './sprites'

export type Band = { x0: number; y0: number; x1: number; y1: number }
export type BackdropOptions = {
  /** Which side of the band meets the canvas exactly; the other is cropped or extended. */
  fit: 'width' | 'height'
  colours: number
  /** The block rule: `vote` snaps the sheet first and keeps flat blocks; `mean` averages. */
  sample: 'vote' | 'mean'
  /** The band's rows, when the key detection is not to be trusted (inclusive, exclusive). */
  band?: { y0: number; y1: number }
}

/** The bounding box of every pixel that is not the magenta key; null for an all-key sheet. */
export function paintedBand(sheet: Rgba): Band | null {
  let x0 = sheet.width
  let y0 = sheet.height
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < sheet.height; y++) {
    for (let x = 0; x < sheet.width; x++) {
      const i = (y * sheet.width + x) * 4
      const d = sheet.data
      if ((d[i + 3] ?? 0) < 128 || isKey(d[i] ?? 0, d[i + 1] ?? 0, d[i + 2] ?? 0)) continue
      x0 = Math.min(x0, x)
      y0 = Math.min(y0, y)
      x1 = Math.max(x1, x)
      y1 = Math.max(y1, y)
    }
  }
  return x1 < 0 ? null : { x0, y0, x1: x1 + 1, y1: y1 + 1 }
}

/**
 * The band's painted pixels snapped to a median-cut palette of `n` colours: one rgb per band
 * pixel, row-major, -1 for the key. The sheet's blocks come back flat, so the vote below is clean.
 */
export function snapBand(
  sheet: Rgba,
  band: Band,
  n: number,
): { rgb: Int32Array; palette: number[] } {
  const bw = band.x1 - band.x0
  const bh = band.y1 - band.y0
  const raw = new Int32Array(bw * bh).fill(-1)
  const counts = new Map<number, number>()
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      const p = ((band.y0 + y) * sheet.width + band.x0 + x) * 4
      const r = sheet.data[p] ?? 0
      const g = sheet.data[p + 1] ?? 0
      const b = sheet.data[p + 2] ?? 0
      if ((sheet.data[p + 3] ?? 0) < 128 || isKey(r, g, b)) continue
      const rgb = (r << 16) | (g << 8) | b
      raw[y * bw + x] = rgb
      counts.set(rgb, (counts.get(rgb) ?? 0) + 1)
    }
  }
  const palette = medianCut(counts, n)
  const snapped = new Map<number, number>()
  const rgb = new Int32Array(bw * bh)
  for (let p = 0; p < raw.length; p++) {
    const v = raw[p] ?? -1
    if (v < 0) {
      rgb[p] = -1
      continue
    }
    let s = snapped.get(v)
    if (s === undefined) {
      s = nearest(v, palette)
      snapped.set(v, s)
    }
    rgb[p] = s
  }
  return { rgb, palette }
}

/**
 * The band resampled to `W × H`: each output pixel the commonest painted colour of its source
 * block after the snap (`vote`, the sprite cut's rule: a block straddling two of the sheet's
 * pixel blocks takes the one it mostly covers), or the mean of the raw painted pixels (`mean`).
 * Key pixels are left out; a block with none takes its left neighbour, else the one above.
 */
export function resample(
  sheet: Rgba,
  band: Band,
  W: number,
  H: number,
  opts: { sample: 'vote' | 'mean'; colours: number } = { sample: 'vote', colours: 16 },
): Rgba {
  const out = blank(W, H)
  const bw = band.x1 - band.x0
  const bh = band.y1 - band.y0
  const snapped = opts.sample === 'vote' ? snapBand(sheet, band, opts.colours).rgb : null
  for (let j = 0; j < H; j++) {
    const sy0 = Math.floor((j * bh) / H)
    const sy1 = Math.max(sy0 + 1, Math.floor(((j + 1) * bh) / H))
    for (let i = 0; i < W; i++) {
      const sx0 = Math.floor((i * bw) / W)
      const sx1 = Math.max(sx0 + 1, Math.floor(((i + 1) * bw) / W))
      let n = 0
      const sum = [0, 0, 0]
      const votes = new Map<number, number>()
      for (let y = sy0; y < sy1; y++) {
        for (let x = sx0; x < sx1; x++) {
          if (snapped) {
            const v = snapped[y * bw + x] ?? -1
            if (v < 0) continue
            votes.set(v, (votes.get(v) ?? 0) + 1)
            n++
            continue
          }
          const p = ((band.y0 + y) * sheet.width + band.x0 + x) * 4
          const r = sheet.data[p] ?? 0
          const g = sheet.data[p + 1] ?? 0
          const b = sheet.data[p + 2] ?? 0
          if ((sheet.data[p + 3] ?? 0) < 128 || isKey(r, g, b)) continue
          sum[0] = (sum[0] ?? 0) + r
          sum[1] = (sum[1] ?? 0) + g
          sum[2] = (sum[2] ?? 0) + b
          n++
        }
      }
      const o = (j * W + i) * 4
      if (n > 0 && snapped) {
        // The commonest; the lowest rgb on a tie, so the cut is deterministic.
        let best = -1
        let bestN = 0
        for (const [rgb, k] of [...votes.entries()].sort((a, b) => a[0] - b[0])) {
          if (k > bestN) {
            best = rgb
            bestN = k
          }
        }
        out.data.set([(best >> 16) & 0xff, (best >> 8) & 0xff, best & 0xff, 255], o)
      } else if (n > 0) {
        out.data.set(
          [
            Math.round((sum[0] ?? 0) / n),
            Math.round((sum[1] ?? 0) / n),
            Math.round((sum[2] ?? 0) / n),
            255,
          ],
          o,
        )
      } else if (i > 0) out.data.copyWithin(o, o - 4, o)
      else if (j > 0) out.data.copyWithin(o, o - W * 4, o - W * 4 + 4)
      else out.data.set([0, 0, 0, 255], o)
    }
  }
  return out
}

/** `image` fitted to `W × H` from the bottom-centre: cropped, or extended from its edges. */
export function fitCanvas(image: Rgba, W: number, H: number): Rgba {
  const out = blank(W, H)
  const ox = Math.floor((W - image.width) / 2)
  const oy = H - image.height
  for (let y = 0; y < H; y++) {
    const sy = Math.min(image.height - 1, Math.max(0, y - oy))
    for (let x = 0; x < W; x++) {
      const sx = Math.min(image.width - 1, Math.max(0, x - ox))
      const s = (sy * image.width + sx) * 4
      out.data.set(image.data.subarray(s, s + 4), (y * W + x) * 4)
    }
  }
  return out
}

/** Every pixel snapped to a median-cut palette of at most `n` colours. */
export function quantise(image: Rgba, n: number): { image: Rgba; palette: number[] } {
  const counts = new Map<number, number>()
  for (let p = 0; p < image.width * image.height; p++) {
    const rgb = rgbOf(image.data, p * 4)
    counts.set(rgb, (counts.get(rgb) ?? 0) + 1)
  }
  const palette = medianCut(counts, n)
  const out = blank(image.width, image.height)
  for (let p = 0; p < image.width * image.height; p++) {
    const rgb = nearest(rgbOf(image.data, p * 4), palette)
    out.data.set([(rgb >> 16) & 0xff, (rgb >> 8) & 0xff, rgb & 0xff, 255], p * 4)
  }
  return { image: out, palette }
}

/** The band resampled so one side meets `W × H`, fitted to the canvas, quantised. */
export function cutBackdrop(
  sheet: Rgba,
  band: Band,
  W: number,
  H: number,
  opts: BackdropOptions,
): { image: Rgba; resampled: { width: number; height: number }; palette: number[] } {
  const bw = band.x1 - band.x0
  const bh = band.y1 - band.y0
  const scale = opts.fit === 'width' ? W / bw : H / bh
  const rw = opts.fit === 'width' ? W : Math.max(1, Math.round(bw * scale))
  const rh = opts.fit === 'height' ? H : Math.max(1, Math.round(bh * scale))
  const resampled = resample(sheet, band, rw, rh, { sample: opts.sample, colours: opts.colours })
  const { image, palette } = quantise(fitCanvas(resampled, W, H), opts.colours)
  return { image, resampled: { width: rw, height: rh }, palette }
}

export function backdropFrom(
  sheet: Rgba,
  opts: BackdropOptions,
): { full: Rgba; hires: Rgba; band: Band; report: string[] } | { error: string } {
  const found = paintedBand(sheet)
  if (!found) return { error: 'the sheet is all magenta' }
  const band = opts.band ? { ...found, y0: opts.band.y0, y1: opts.band.y1 } : found
  const hires = cutBackdrop(sheet, band, BACKDROP_HIRES.width, BACKDROP_HIRES.height, opts)
  const full = cutBackdrop(sheet, band, BACKDROP.width, BACKDROP.height, opts)
  const report = [
    `band: x ${band.x0}..${band.x1}, y ${band.y0}..${band.y1} (${band.x1 - band.x0} x ${band.y1 - band.y0})`,
    `1.5x: resampled ${hires.resampled.width} x ${hires.resampled.height} into ${BACKDROP_HIRES.width} x ${BACKDROP_HIRES.height}, ${hires.palette.length} colours`,
    `1x: resampled ${full.resampled.width} x ${full.resampled.height} into ${BACKDROP.width} x ${BACKDROP.height}, ${full.palette.length} colours`,
  ]
  return { full: full.image, hires: hires.image, band, report }
}

function parseArgs(argv: string[]): {
  sheet: string
  zone: number
  out: string
  opts: BackdropOptions
} {
  const flag = (name: string) => {
    const i = argv.indexOf(`--${name}`)
    return i >= 0 ? argv[i + 1] : undefined
  }
  const sheet = argv[0]
  const zone = Number(flag('zone'))
  if (!sheet || sheet.startsWith('--') || !Number.isInteger(zone) || zone < 1) {
    throw new Error(
      'usage: tsx scripts/backdrop.ts <sheet.png> --zone <n> [--fit width|height] [--colours <n>] [--band <y0,y1>] [--sample vote|mean] [--out <dir>]',
    )
  }
  const colours = Number(flag('colours') ?? BACKDROP_COLOURS)
  if (!Number.isInteger(colours) || colours < 2 || colours > BACKDROP_COLOURS) {
    throw new Error(`--colours ${flag('colours')}: an integer from 2 to ${BACKDROP_COLOURS}`)
  }
  const fit = flag('fit') ?? 'width'
  if (fit !== 'width' && fit !== 'height') throw new Error(`--fit ${fit}: width or height`)
  const sample = flag('sample') ?? 'vote'
  if (sample !== 'vote' && sample !== 'mean') throw new Error(`--sample ${sample}: vote or mean`)
  const bandFlag = flag('band')
  const band = bandFlag
    ? (() => {
        const [y0, y1] = bandFlag.split(',').map(Number)
        if (y0 === undefined || y1 === undefined || !(y0 < y1))
          throw new Error(`--band ${bandFlag}`)
        return { y0, y1 }
      })()
    : undefined
  return {
    sheet,
    zone,
    out: flag('out') ?? 'art',
    opts: { fit, colours, band, sample },
  }
}

function main(): void {
  const { sheet, zone, out, opts } = parseArgs(process.argv.slice(2))
  const result = backdropFrom(readPng(sheet), opts)
  if ('error' in result) {
    console.error(result.error)
    process.exit(1)
  }
  for (const line of result.report) console.log(line)
  const fullDir = join(out, 'backdrops')
  const hiresDir = join(out, 'backdrops-hires')
  mkdirSync(fullDir, { recursive: true })
  mkdirSync(hiresDir, { recursive: true })
  const fullPath = join(fullDir, `zone-${zone}.png`)
  const hiresPath = join(hiresDir, `zone-${zone}.png`)
  writePng(fullPath, result.full)
  writePng(hiresPath, result.hires)
  console.log(fullPath)
  console.log(hiresPath)
}

if (import.meta.url === `file://${process.argv[1]}`) main()
