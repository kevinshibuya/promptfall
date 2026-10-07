// Cuts a magenta-keyed sprite sheet into one RGBA PNG per sprite. Sprites are found by the magenta
// gutters between them; each one's native pixel grid is recovered from its black outline, read
// back one art pixel a block, then shrunk to the canvas by an outline-aware majority vote and
// quantised. The rules are load-bearing: docs/plans/2026-10-07-promptfall-phase-4-pr2-art.md,
// Task 1.
//
// tsx scripts/slice-sheet.ts <sheet.png> <out-dir> --grid <cols>x<rows> [--row <r>]
//   --colours <n> (--size <n> | --fit <w>x<h>) [--names a,kind/b,…] [--native <dir>]
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { blank, medianCut, nearest, type Rgba, readPng, writePng } from './png'

export type SliceOptions = {
  /** Sprites per row. */
  cols: number
  /** Rows of sprites. */
  rows: number
  row: number | null
  colours: number
  size: number | null
  fit: { width: number; height: number } | null
}

export type SliceResult =
  | { art: Rgba; native: Rgba; block: number; fromMedian: boolean }
  | { error: string }

/**
 * The near-pure magenta ground and its anti-aliased pink fringe. Sprite purples stay art: they sit
 * at red 160 or below (the sheets' ground is 230 to 253 in red and blue, under 25 in green).
 */
export function isKey(r: number, g: number, b: number): boolean {
  return r >= 180 && b >= 180 && Math.abs(r - b) < 60 && Math.min(r, b) - g >= 100
}

/** Transparent, in the sampled colour space. */
const T = -1

type Box = { x0: number; y0: number; x1: number; y1: number }

function px(sheet: Rgba, x: number, y: number): number {
  const i = (y * sheet.width + x) * 4
  const d = sheet.data
  const r = d[i] ?? 0
  const g = d[i + 1] ?? 0
  const b = d[i + 2] ?? 0
  return isKey(r, g, b) || (d[i + 3] ?? 0) < 128 ? T : (r << 16) | (g << 8) | b
}

const dark = (c: number) => c !== T && c >> 16 < 50 && ((c >> 8) & 0xff) < 50 && (c & 0xff) < 50

function differs(a: number, b: number): boolean {
  if (a === T || b === T) return a !== b
  const dr = (a >> 16) - (b >> 16)
  const dg = ((a >> 8) & 0xff) - ((b >> 8) & 0xff)
  const db = (a & 0xff) - (b & 0xff)
  return dr * dr + dg * dg + db * db > 40 * 40
}

/** The value counted most often; ties go to the one counted first. */
function commonest<K>(counts: Map<K, number>, fallback: K): K {
  let best = fallback
  let bestN = 0
  for (const [k, n] of counts) {
    if (n > bestN) {
      best = k
      bestN = n
    }
  }
  return best
}

/**
 * Runs of occupied indices, merged across the narrowest gaps until `count` remain. Null when there
 * are fewer runs than `count`: sprites touch with no gutter between them.
 */
export function gutterRuns(occupied: readonly boolean[], count: number): [number, number][] | null {
  const runs: [number, number][] = []
  occupied.forEach((on, i) => {
    if (!on) return
    const last = runs[runs.length - 1]
    if (last && last[1] === i - 1) last[1] = i
    else runs.push([i, i])
  })
  if (runs.length < count) return null
  while (runs.length > count) {
    let pick = 0
    for (let i = 1; i < runs.length - 1; i++) {
      const gap = (runs[i + 1] as [number, number])[0] - (runs[i] as [number, number])[1]
      const best = (runs[pick + 1] as [number, number])[0] - (runs[pick] as [number, number])[1]
      if (gap < best) pick = i
    }
    const [a, b] = [runs[pick] as [number, number], runs[pick + 1] as [number, number]]
    runs.splice(pick, 2, [a[0], b[1]])
  }
  return runs
}

/** The sprite's box: its column run × its band, trimmed to its non-key pixels. */
function trim(sheet: Rgba, box: Box): Box | null {
  let x0 = box.x1
  let y0 = box.y1
  let x1 = -1
  let y1 = -1
  for (let y = box.y0; y <= box.y1; y++) {
    for (let x = box.x0; x <= box.x1; x++) {
      if (px(sheet, x, y) === T) continue
      x0 = Math.min(x0, x)
      y0 = Math.min(y0, y)
      x1 = Math.max(x1, x)
      y1 = Math.max(y1, y)
    }
  }
  return x1 < 0 ? null : { x0, y0, x1, y1 }
}

/** The art-pixel size from the outline: the commonest dark run, refined by its neighbours. */
function blockSize(sheet: Rgba, box: Box): number | null {
  const runs = new Map<number, number>()
  for (let y = box.y0; y <= box.y1; y += 2) {
    let run = 0
    for (let x = box.x0; x <= box.x1 + 1; x++) {
      if (x <= box.x1 && dark(px(sheet, x, y))) {
        run++
        continue
      }
      if (run >= 4) runs.set(run, (runs.get(run) ?? 0) + 1)
      run = 0
    }
  }
  if (runs.size === 0) return null
  let m = 0
  let mN = 0
  for (const [len, n] of runs) {
    if (n > mN || (n === mN && len < m)) {
      m = len
      mN = n
    }
  }
  let num = 0
  let den = 0
  for (let d = -1; d <= 1; d++) {
    const n = runs.get(m + d) ?? 0
    num += (m + d) * n
    den += n
  }
  return num / den
}

/** The grid offset in [0, b) that puts the most colour transitions on a grid line. */
function gridOffset(transitions: readonly number[], b: number): number {
  let best = 0
  let bestHits = -1
  for (let o = 0; o < b; o += 0.25) {
    let hits = 0
    for (const t of transitions) {
      const r = (((t - o) % b) + b) % b
      if (Math.min(r, b - r) <= 1.5) hits++
    }
    if (hits > bestHits) {
      best = o
      bestHits = hits
    }
  }
  return best
}

/** Reads the sprite back one value per art pixel, trimmed; T for transparent. */
function nativeGrid(sheet: Rgba, box: Box, b: number): { w: number; h: number; px: number[] } {
  const inBox = (x: number, y: number) =>
    x >= box.x0 && x <= box.x1 && y >= box.y0 && y <= box.y1 ? px(sheet, x, y) : T
  const trX: number[] = []
  const trY: number[] = []
  for (let y = box.y0; y <= box.y1; y += 2) {
    for (let x = box.x0; x <= box.x1 + 1; x++) {
      if (differs(inBox(x - 1, y), inBox(x, y))) trX.push(x)
    }
  }
  for (let x = box.x0; x <= box.x1; x += 2) {
    for (let y = box.y0; y <= box.y1 + 1; y++) {
      if (differs(inBox(x, y - 1), inBox(x, y))) trY.push(y)
    }
  }
  const ox = gridOffset(trX, b)
  const oy = gridOffset(trY, b)
  const sx = ox + Math.floor((box.x0 - ox) / b) * b
  const sy = oy + Math.floor((box.y0 - oy) / b) * b
  const nw = Math.ceil((box.x1 + 1 - sx) / b)
  const nh = Math.ceil((box.y1 + 1 - sy) / b)
  const FRACTIONS = [0.3, 0.4, 0.5, 0.6, 0.7]
  const all: number[] = []
  for (let j = 0; j < nh; j++) {
    for (let i = 0; i < nw; i++) {
      const counts = new Map<number, number>()
      for (const v of FRACTIONS) {
        for (const u of FRACTIONS) {
          const k = inBox(Math.floor(sx + (i + u) * b), Math.floor(sy + (j + v) * b))
          counts.set(k, (counts.get(k) ?? 0) + 1)
        }
      }
      all.push(commonest(counts, T))
    }
  }
  let l = nw
  let r = -1
  let t = nh
  let bt = -1
  all.forEach((v, k) => {
    if (v === T) return
    const i = k % nw
    const j = Math.floor(k / nw)
    l = Math.min(l, i)
    r = Math.max(r, i)
    t = Math.min(t, j)
    bt = Math.max(bt, j)
  })
  if (r < 0) return { w: 0, h: 0, px: [] }
  const w = r - l + 1
  const h = bt - t + 1
  const out: number[] = []
  for (let j = t; j <= bt; j++) for (let i = l; i <= r; i++) out.push(all[j * nw + i] ?? T)
  return { w, h, px: out }
}

/** Shrinks, never grows: transparent by majority, else black when the outline holds a third. */
function shrink(
  nat: { w: number; h: number; px: number[] },
  tw: number,
  th: number,
): { w: number; h: number; px: number[] } {
  const s = Math.min(1, tw / nat.w, th / nat.h)
  const w = Math.max(1, Math.round(nat.w * s))
  const h = Math.max(1, Math.round(nat.h * s))
  const range = (k: number, n: number, of: number): [number, number] => {
    const a = Math.floor((k * of) / n)
    return [a, Math.max(Math.floor(((k + 1) * of) / n), a + 1)]
  }
  const out: number[] = []
  for (let j = 0; j < h; j++) {
    const [ja, jb] = range(j, h, nat.h)
    for (let i = 0; i < w; i++) {
      const [ia, ib] = range(i, w, nat.w)
      const counts = new Map<number, number>()
      let n = 0
      let clear = 0
      let dk = 0
      for (let y = ja; y < jb; y++) {
        for (let x = ia; x < ib; x++) {
          const v = nat.px[y * nat.w + x] ?? T
          n++
          if (v === T) clear++
          else if (dark(v)) dk++
          else counts.set(v, (counts.get(v) ?? 0) + 1)
        }
      }
      if (clear * 2 > n) out.push(T)
      else if (dk * 3 >= n - clear) out.push(0)
      else out.push(commonest(counts, 0))
    }
  }
  return { w, h, px: out }
}

function toRgba(grid: { w: number; h: number; px: number[] }): Rgba {
  const img = blank(grid.w, grid.h)
  grid.px.forEach((v, k) => {
    if (v !== T) img.data.set([v >> 16, (v >> 8) & 0xff, v & 0xff, 255], k * 4)
  })
  return img
}

/** One measured sprite: native grid, shrink, quantise, pad. */
function cut(sheet: Rgba, box: Box, b: number, options: SliceOptions) {
  const nat = nativeGrid(sheet, box, b)
  if (nat.w === 0) throw new Error('no sprite on the grid')
  const target = options.fit ?? { width: options.size ?? 16, height: options.size ?? 16 }
  const small = shrink(nat, target.width, target.height)
  const counts = new Map<number, number>()
  for (const v of small.px) if (v !== T && v !== 0) counts.set(v, (counts.get(v) ?? 0) + 1)
  const palette = [0, ...medianCut(counts, options.colours - 1)]
  const art = toRgba({ ...small, px: small.px.map((v) => (v === T ? T : nearest(v, palette))) })
  if (options.size === null) return { art, native: toRgba(nat) }
  // Pad to the square canvas, bottom-centred.
  const n = options.size
  const out = blank(n, n)
  const ox = Math.floor((n - small.w) / 2)
  const oy = n - small.h
  for (let y = 0; y < small.h; y++) {
    out.data.set(art.data.subarray(y * small.w * 4, (y + 1) * small.w * 4), ((oy + y) * n + ox) * 4)
  }
  return { art: out, native: toRgba(nat) }
}

function median(values: readonly number[]): number {
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? (s[mid] ?? 0) : ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2
}

/** One result per sprite in reading order, `--row` keeping a single row. */
export function sliceSheet(sheet: Rgba, options: SliceOptions): SliceResult[] {
  const { cols, rows } = options
  const keep = (r: number) => options.row === null || options.row === r
  const occupiedRows = Array.from({ length: sheet.height }, (_, y) => {
    for (let x = 0; x < sheet.width; x++) if (px(sheet, x, y) !== T) return true
    return false
  })
  const bands = gutterRuns(occupiedRows, rows)
  const slots: ({ row: number; box: Box } | { error: string })[] = []
  for (let r = 0; r < rows; r++) {
    const band = bands?.[r]
    if (!band) {
      for (let c = 0; c < cols; c++) slots.push({ error: `row ${r}: sprites touch, no gutter` })
      continue
    }
    const occupiedCols = Array.from({ length: sheet.width }, (_, x) => {
      for (let y = band[0]; y <= band[1]; y++) if (px(sheet, x, y) !== T) return true
      return false
    })
    const runs = gutterRuns(occupiedCols, cols)
    for (let c = 0; c < cols; c++) {
      const run = runs?.[c]
      const box = run && trim(sheet, { x0: run[0], y0: band[0], x1: run[1], y1: band[1] })
      slots.push(box ? { row: r, box } : { error: `row ${r}: sprites touch, no gutter` })
    }
  }
  const blocks = slots.map((s) => ('box' in s ? blockSize(sheet, s.box) : null))
  const measured = blocks.filter((b): b is number => b !== null)
  const mid = median(measured)
  const out: SliceResult[] = []
  slots.forEach((slot, i) => {
    const row = Math.floor(i / cols)
    if (!keep(row)) return
    if (!('box' in slot)) {
      out.push(slot)
      return
    }
    const raw = blocks[i]
    if (raw === null || raw === undefined) {
      out.push({ error: 'no outline found' })
      return
    }
    const fromMedian = raw < 0.7 * mid || raw > 1.4 * mid
    const block = fromMedian ? mid : raw
    try {
      out.push({ ...cut(sheet, slot.box, block, options), block, fromMedian })
    } catch (e) {
      out.push({ error: e instanceof Error ? e.message : String(e) })
    }
  })
  return out
}

function parseArgs(argv: string[]): {
  sheet: string
  out: string
  native: string | null
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
      'usage: tsx scripts/slice-sheet.ts <sheet.png> <out-dir> --grid <cols>x<rows> [--row <r>] --colours <n> (--size <n> | --fit <w>x<h>) [--names a,kind/b,…] [--native <dir>]',
    )
  }
  const names = flag('names')?.split(',') ?? []
  const nested = names.find((n) => n.split('/').length > 2)
  if (nested) throw new Error(`--names: at most one "/" per name: ${nested}`)
  const row = flag('row')
  return {
    sheet,
    out,
    native: flag('native') ?? null,
    names,
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

function write(path: string, img: Rgba): void {
  mkdirSync(dirname(path), { recursive: true })
  writePng(path, img)
}

function main(): void {
  const { sheet, out, native, options, names } = parseArgs(process.argv.slice(2))
  const results = sliceSheet(readPng(sheet), options)
  let failed = false
  results.forEach((r, i) => {
    const name = names[i] ?? String(i)
    if ('error' in r) {
      failed = true
      console.log(`${name}: ${r.error}`)
      return
    }
    const path = join(out, `${name}.png`)
    write(path, r.art)
    if (native !== null) write(join(native, `${name}.png`), r.native)
    const block = `block ${r.block.toFixed(2)}${r.fromMedian ? ' (median)' : ''}`
    console.log(
      `${path} ${r.art.width}x${r.art.height} native ${r.native.width}x${r.native.height} ${block}`,
    )
  })
  if (failed) process.exitCode = 1
}

if (import.meta.url === `file://${process.argv[1]}`) main()
