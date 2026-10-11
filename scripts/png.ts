import { readFileSync, writeFileSync } from 'node:fs'
import { PNG } from 'pngjs'

/** Straight RGBA, 4 bytes a pixel, row-major. */
export type Rgba = { width: number; height: number; data: Uint8Array }

export function readPng(path: string): Rgba {
  const png = PNG.sync.read(readFileSync(path))
  return { width: png.width, height: png.height, data: new Uint8Array(png.data) }
}

export function writePng(path: string, image: Rgba): void {
  const png = new PNG({ width: image.width, height: image.height })
  png.data = Buffer.from(image.data)
  writeFileSync(path, PNG.sync.write(png))
}

export function blank(width: number, height: number): Rgba {
  return { width, height, data: new Uint8Array(width * height * 4) }
}

export const rgbOf = (data: Uint8Array, i: number): number =>
  ((data[i] ?? 0) << 16) | ((data[i + 1] ?? 0) << 8) | (data[i + 2] ?? 0)

export function hex(rgb: number): string {
  return `#${rgb.toString(16).padStart(6, '0')}`
}

export function parseHex(s: string): number {
  if (!/^#[0-9a-fA-F]{6}$/.test(s)) throw new Error(`not a #rrggbb colour: ${s}`)
  return Number.parseInt(s.slice(1), 16)
}

export function distance(a: number, b: number): number {
  const dr = ((a >> 16) & 0xff) - ((b >> 16) & 0xff)
  const dg = ((a >> 8) & 0xff) - ((b >> 8) & 0xff)
  const db = (a & 0xff) - (b & 0xff)
  return dr * dr + dg * dg + db * db
}

/** The entry of `palette` nearest `rgb` by squared RGB distance; the first on a tie. */
export function nearest(rgb: number, palette: readonly number[]): number {
  let best = palette[0] ?? 0
  let bestD = Number.POSITIVE_INFINITY
  for (const p of palette) {
    const d = distance(rgb, p)
    if (d < bestD) {
      best = p
      bestD = d
    }
  }
  return best
}

/**
 * Median cut over weighted colours: split the box with the widest channel range at its weighted
 * median until there are `n` boxes or none splits; each box answers its weighted mean.
 * Deterministic: input order does not matter.
 */
export function medianCut(counts: ReadonlyMap<number, number>, n: number): number[] {
  type Box = { colours: [number, number][] }
  const channel = (rgb: number, c: number) => (rgb >> (16 - c * 8)) & 0xff
  const all = [...counts.entries()].sort((a, b) => a[0] - b[0])
  if (all.length <= n) return all.map(([rgb]) => rgb)
  const range = (box: Box): [number, number] => {
    let best: [number, number] = [0, -1]
    for (let c = 0; c < 3; c++) {
      let lo = 255
      let hi = 0
      for (const [rgb] of box.colours) {
        lo = Math.min(lo, channel(rgb, c))
        hi = Math.max(hi, channel(rgb, c))
      }
      if (hi - lo > best[1]) best = [c, hi - lo]
    }
    return best
  }
  const boxes: Box[] = [{ colours: all }]
  while (boxes.length < n) {
    let pick = -1
    let pickRange = 0
    boxes.forEach((box, i) => {
      if (box.colours.length < 2) return
      const [, r] = range(box)
      if (r > pickRange) {
        pick = i
        pickRange = r
      }
    })
    if (pick < 0) break
    const box = boxes[pick] as Box
    const [c] = range(box)
    const sorted = [...box.colours].sort(
      (a, b) => channel(a[0], c) - channel(b[0], c) || a[0] - b[0],
    )
    const total = sorted.reduce((s, [, w]) => s + w, 0)
    let acc = 0
    let cut = 1
    for (let i = 0; i < sorted.length - 1; i++) {
      acc += (sorted[i] as [number, number])[1]
      cut = i + 1
      if (acc * 2 >= total) break
    }
    boxes.splice(pick, 1, { colours: sorted.slice(0, cut) }, { colours: sorted.slice(cut) })
  }
  return boxes
    .map((box) => {
      let w = 0
      const sum = [0, 0, 0]
      for (const [rgb, count] of box.colours) {
        w += count
        for (let c = 0; c < 3; c++) sum[c] = (sum[c] ?? 0) + channel(rgb, c) * count
      }
      const [r, g, b] = sum.map((v) => Math.round(v / w))
      return ((r ?? 0) << 16) | ((g ?? 0) << 8) | (b ?? 0)
    })
    .sort((a, b) => a - b)
}
