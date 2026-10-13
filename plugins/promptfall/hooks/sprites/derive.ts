import { decode, encode } from './base64'
import type { SpriteArt } from './types'

/**
 * The derived frames: idle B, the hit frame and Guard's stance are fixed transforms of the idle
 * art, never drawn.
 */

export type OpaqueRows = { r0: number; r1: number }
export type OpaqueBox = { x0: number; y0: number; x1: number; y1: number }
export type Sheared = { art: SpriteArt; grow: number }

const boxes = new WeakMap<SpriteArt, OpaqueBox | null>()
const squashed = new WeakMap<SpriteArt, SpriteArt>()
const sheared = new WeakMap<SpriteArt, Sheared>()
const stances = new WeakMap<SpriteArt, Sheared>()

/** The first and last rows holding an opaque pixel; null for an empty art. */
export function opaqueRows(art: SpriteArt): OpaqueRows | null {
  const box = opaqueBox(art)
  return box ? { r0: box.y0, r1: box.y1 } : null
}

/** The smallest box holding every opaque pixel, inclusive; null for an empty art. */
export function opaqueBox(art: SpriteArt): OpaqueBox | null {
  const hit = boxes.get(art)
  if (hit !== undefined) return hit
  const px = decode(art.pixels)
  let x0 = art.width
  let y0 = art.height
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < art.height; y++) {
    for (let x = 0; x < art.width; x++) {
      if (px[y * art.width + x] === 0) continue
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      y1 = y
    }
  }
  const box = x1 < 0 ? null : { x0, y0, x1, y1 }
  boxes.set(art, box)
  return box
}

/** The row `squash` drops, or null when the figure is under 3 rows and nothing moves. */
export function squashRow(art: SpriteArt): { r0: number; m: number } | null {
  const rows = opaqueRows(art)
  if (!rows) return null
  const h = rows.r1 - rows.r0 + 1
  if (h < 3) return null
  return { r0: rows.r0, m: rows.r0 + Math.floor(h / 2) }
}

/** Idle B: rows `r0..m-1` move down one, row `m` is dropped, the rows below stay. */
export function squash(art: SpriteArt): SpriteArt {
  const hit = squashed.get(art)
  if (hit) return hit
  const cut = squashRow(art)
  let out = art
  if (cut) {
    const src = decode(art.pixels)
    const px = src.slice()
    const w = art.width
    for (let y = cut.m; y > cut.r0; y--) px.set(src.subarray((y - 1) * w, y * w), y * w)
    px.fill(0, cut.r0 * w, (cut.r0 + 1) * w)
    out = { width: art.width, height: art.height, palette: art.palette, pixels: encode(px) }
  }
  squashed.set(art, out)
  return out
}

/**
 * The hit frame's per-row shift: row `y` of the idle art lands at `x + shift(y)` in a canvas `k`
 * wider. The top row keeps its columns and the bottom row moves `k` right, so a caller placing
 * the output `k` further left keeps the feet and leans the head back. Null under 2 rows.
 */
export function shearShifts(
  art: SpriteArt,
): { k: number; r0: number; r1: number; shift: (y: number) => number } | null {
  const rows = opaqueRows(art)
  if (!rows) return null
  const { r0, r1 } = rows
  const h = r1 - r0 + 1
  if (h < 2) return null
  const k = Math.max(1, Math.round(h / 12))
  return { k, r0, r1, shift: (y) => k - Math.round((k * (r1 - y)) / (r1 - r0)) }
}

/** The hit silhouette: the idle art leaned back by `grow` columns. */
export function shear(art: SpriteArt): Sheared {
  const hit = sheared.get(art)
  if (hit) return hit
  const s = shearShifts(art)
  let out: Sheared = { art, grow: 0 }
  if (s) {
    const src = decode(art.pixels)
    const w = art.width + s.k
    const px = new Uint8Array(w * art.height)
    for (let y = s.r0; y <= s.r1; y++) {
      px.set(src.subarray(y * art.width, (y + 1) * art.width), y * w + s.shift(y))
    }
    out = {
      art: { width: w, height: art.height, palette: art.palette, pixels: encode(px) },
      grow: s.k,
    }
  }
  sheared.set(art, out)
  return out
}

/** The hit palette: gamma 0.6 per channel, black and white fixed. */
export function lighten(rgb: number): number {
  const ch = (v: number) => Math.round(255 * (v / 255) ** 0.6)
  return (ch((rgb >> 16) & 0xff) << 16) | (ch((rgb >> 8) & 0xff) << 8) | ch(rgb & 0xff)
}

/**
 * Guard's stance: idle B's one-row squash leaned forward, the hit's lean the other way. The top
 * row moves `grow` columns right and the bottom row keeps its columns, so the head goes toward the
 * art's facing; a flipped caller places the output `grow` further left to keep the feet.
 */
export function stance(art: SpriteArt): Sheared {
  const hit = stances.get(art)
  if (hit) return hit
  const low = squash(art)
  const s = shearShifts(low)
  let out: Sheared = { art: low, grow: 0 }
  if (s) {
    const src = decode(low.pixels)
    const w = low.width + s.k
    const px = new Uint8Array(w * low.height)
    for (let y = s.r0; y <= s.r1; y++) {
      px.set(src.subarray(y * low.width, (y + 1) * low.width), y * w + s.k - s.shift(y))
    }
    out = {
      art: { width: w, height: low.height, palette: low.palette, pixels: encode(px) },
      grow: s.k,
    }
  }
  stances.set(art, out)
  return out
}
