// Cuts a magenta-keyed sprite sheet into one RGBA PNG per cell, cropped, scaled and quantised.
// The port of docs/plans/phase-4-concepts/slice.py with its three fixes: a wider magenta key
// (the fringe), cropping to the main run of rows and columns (neighbours bleed across cells),
// and a palette from opaque pixels only.
//
// tsx scripts/slice-sheet.ts <sheet.png> <out-dir> --grid <cols>x<rows> [--row <r>]
//   --colours <n> (--size <n> | --fit <w>x<h>) [--names a,b,c]
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { blank, medianCut, nearest, type Rgba, readPng, rgbOf, writePng } from './png'

export type SliceOptions = {
  cols: number
  rows: number
  row: number | null
  colours: number
  size: number | null
  fit: { width: number; height: number } | null
}

/** Magenta with a fringe: the key and the anti-aliased band around it. */
export function isKey(r: number, g: number, b: number): boolean {
  return r > 120 && b > 120 && g < 120 && Math.abs(r - b) < 90 && Math.min(r, b) - g > 60
}

/** The longest run of indices holding more than one opaque pixel, a gap of up to 3 bridged. */
export function mainRun(values: readonly number[], size: number): [number, number] {
  const hit = new Array<number>(size).fill(0)
  for (const v of values) hit[v] = (hit[v] ?? 0) + 1
  const runs: [number, number][] = []
  let start: number | null = null
  let end = 0
  let gap = 0
  for (let i = 0; i < size; i++) {
    if ((hit[i] ?? 0) > 1) {
      if (start === null) start = i
      gap = 0
      end = i
    } else if (start !== null) {
      gap += 1
      if (gap > 3) {
        runs.push([start, end])
        start = null
      }
    }
  }
  if (start !== null) runs.push([start, end])
  if (runs.length === 0) return [0, size - 1]
  return runs.reduce((best, r) => (r[1] - r[0] > best[1] - best[0] ? r : best))
}

function crop(sheet: Rgba, x0: number, y0: number, x1: number, y1: number): Rgba {
  const out = blank(x1 - x0, y1 - y0)
  for (let y = y0; y < y1; y++) {
    const from = (y * sheet.width + x0) * 4
    out.data.set(sheet.data.subarray(from, from + (x1 - x0) * 4), (y - y0) * out.width * 4)
  }
  return out
}

/** One cell: crop to the main run, block-sample to the target, key to alpha, quantise. */
export function sliceCell(cell: Rgba, options: SliceOptions): Rgba {
  const { width: w, height: h, data } = cell
  const xs: number[] = []
  const ys: number[] = []
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      if (!isKey(data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0)) {
        xs.push(x)
        ys.push(y)
      }
    }
  }
  const [y0, y1] = mainRun(ys, h)
  const keptX = xs.filter((_, i) => (ys[i] ?? -1) >= y0 && (ys[i] ?? -1) <= y1)
  const [x0, x1] = mainRun(keptX, w)
  const art = crop(cell, x0, y0, x1 + 1, y1 + 1)
  const aw = art.width
  const ah = art.height
  const scale =
    options.fit !== null
      ? Math.min(options.fit.width / aw, options.fit.height / ah)
      : (options.size ?? 16) / Math.max(aw, ah)
  const tw = Math.max(1, Math.round(aw * scale))
  const th = Math.max(1, Math.round(ah * scale))
  const small = blank(tw, th)
  for (let y = 0; y < th; y++) {
    for (let x = 0; x < tw; x++) {
      // Each target pixel takes the centre of its source block.
      const sx = Math.min(aw - 1, Math.floor(((x + 0.5) * aw) / tw))
      const sy = Math.min(ah - 1, Math.floor(((y + 0.5) * ah) / th))
      const si = (sy * aw + sx) * 4
      const r = art.data[si] ?? 0
      const g = art.data[si + 1] ?? 0
      const b = art.data[si + 2] ?? 0
      if (isKey(r, g, b)) continue
      small.data.set([r, g, b, 255], (y * tw + x) * 4)
    }
  }
  const counts = new Map<number, number>()
  for (let i = 0; i < small.data.length; i += 4) {
    if (small.data[i + 3] === 0) continue
    const rgb = rgbOf(small.data, i)
    counts.set(rgb, (counts.get(rgb) ?? 0) + 1)
  }
  const palette = medianCut(counts, options.colours)
  for (let i = 0; i < small.data.length; i += 4) {
    if (small.data[i + 3] === 0) continue
    const p = nearest(rgbOf(small.data, i), palette)
    small.data.set([(p >> 16) & 0xff, (p >> 8) & 0xff, p & 0xff], i)
  }
  if (options.size === null) return small
  // Pad to the square canvas, bottom-centred.
  const n = options.size
  const out = blank(n, n)
  const ox = Math.floor((n - tw) / 2)
  const oy = n - th
  for (let y = 0; y < th; y++) {
    out.data.set(small.data.subarray(y * tw * 4, (y + 1) * tw * 4), ((oy + y) * n + ox) * 4)
  }
  return out
}

export function sliceSheet(sheet: Rgba, options: SliceOptions): Rgba[] {
  const cw = sheet.width / options.cols
  const ch = sheet.height / options.rows
  const out: Rgba[] = []
  for (let cy = 0; cy < options.rows; cy++) {
    if (options.row !== null && cy !== options.row) continue
    for (let cx = 0; cx < options.cols; cx++) {
      const cell = crop(
        sheet,
        Math.floor(cx * cw),
        Math.floor(cy * ch),
        Math.floor((cx + 1) * cw),
        Math.floor((cy + 1) * ch),
      )
      out.push(sliceCell(cell, options))
    }
  }
  return out
}

function parseArgs(argv: string[]): {
  sheet: string
  out: string
  options: SliceOptions
  names: string[]
} {
  const [sheet, out, ...rest] = argv
  const flag = (name: string) => {
    const i = rest.indexOf(`--${name}`)
    return i >= 0 ? rest[i + 1] : undefined
  }
  const pair = (s: string | undefined) => {
    const m = /^(\d+)x(\d+)$/.exec(s ?? '')
    return m ? { a: Number(m[1]), b: Number(m[2]) } : null
  }
  const grid = pair(flag('grid'))
  const fit = pair(flag('fit'))
  const size = flag('size')
  const colours = Number(flag('colours'))
  if (!sheet || !out || !grid || !colours || (size === undefined) === (fit === null)) {
    throw new Error(
      'usage: tsx scripts/slice-sheet.ts <sheet.png> <out-dir> --grid <cols>x<rows> [--row <r>] --colours <n> (--size <n> | --fit <w>x<h>) [--names a,b,c]',
    )
  }
  const row = flag('row')
  return {
    sheet,
    out,
    names: flag('names')?.split(',') ?? [],
    options: {
      cols: grid.a,
      rows: grid.b,
      row: row === undefined ? null : Number(row),
      colours,
      size: size === undefined ? null : Number(size),
      fit: fit ? { width: fit.a, height: fit.b } : null,
    },
  }
}

function main(): void {
  const { sheet, out, options, names } = parseArgs(process.argv.slice(2))
  mkdirSync(out, { recursive: true })
  const cells = sliceSheet(readPng(sheet), options)
  cells.forEach((cell, i) => {
    const path = join(out, `${names[i] ?? i}.png`)
    writePng(path, cell)
    console.log(`${path} ${cell.width}x${cell.height}`)
  })
}

if (import.meta.url === `file://${process.argv[1]}`) main()
