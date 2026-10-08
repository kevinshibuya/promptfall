// Half-block cell packing after claude-toons (MIT, copyright 2026 Anshu Chimala; see NOTICE.md):
// each terminal cell shows two stage pixels, the top as the foreground of '▀' and the bottom as
// its background, with '▄' and the terminal's default colour where only one of them is opaque.
import { decode, encode } from '../sprites/base64'
import type { Frame } from './compose'
import type { StageNumber } from './model'

/** The terminal's default colour: bit 24 alone. */
export const CLEAR = 0x01000000
const UPPER = 0x2580 // ▀
const LOWER = 0x2584 // ▄
const SPACE = 0x20

function pixel(frame: Frame, x: number, y: number): number | null {
  const i = (y * frame.width + x) * 4
  if (!frame.rgba[i + 3]) return null
  return ((frame.rgba[i] ?? 0) << 16) | ((frame.rgba[i + 1] ?? 0) << 8) | (frame.rgba[i + 2] ?? 0)
}

/** Writes one little-endian u32 at word `w`. */
function put(bytes: Uint8Array, w: number, value: number): void {
  const i = w * 4
  bytes[i] = value & 0xff
  bytes[i + 1] = (value >>> 8) & 0xff
  bytes[i + 2] = (value >>> 16) & 0xff
  bytes[i + 3] = (value >>> 24) & 0xff
}

/**
 * Raster cells for a frame composed with `numbers: false`, then each number's glyphs as text
 * cells at cell (floor x, floor y / 2), clamped inside the box: fg its colour, bg the scene pixel
 * under the cell (the backdrop, or CLEAR where there is none), so a number is not a box.
 */
export function encodeRaster(frame: Frame, numbers: readonly StageNumber[]): string {
  const columns = frame.width
  const rows = Math.floor(frame.height / 2)
  const bytes = new Uint8Array(columns * rows * 12)
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < columns; cx++) {
      const top = pixel(frame, cx, cy * 2)
      const bottom = pixel(frame, cx, cy * 2 + 1)
      const w = (cy * columns + cx) * 3
      if (top !== null) {
        put(bytes, w, UPPER)
        put(bytes, w + 1, top)
        put(bytes, w + 2, bottom ?? CLEAR)
      } else if (bottom !== null) {
        put(bytes, w, LOWER)
        put(bytes, w + 1, bottom)
        put(bytes, w + 2, CLEAR)
      } else {
        put(bytes, w, SPACE)
        put(bytes, w + 1, CLEAR)
        put(bytes, w + 2, CLEAR)
      }
    }
  }
  for (const n of numbers) {
    const x0 = Math.max(0, Math.min(columns - n.text.length, Math.floor(n.x)))
    const y = Math.max(0, Math.min(rows - 1, Math.floor(n.y / 2)))
    for (let c = 0; c < n.text.length && x0 + c < columns; c++) {
      const w = (y * columns + x0 + c) * 3
      put(bytes, w, n.text.charCodeAt(c))
      put(bytes, w + 1, n.rgb)
      put(bytes, w + 2, pixel(frame, x0 + c, y * 2) ?? CLEAR)
    }
  }
  return encode(bytes)
}

/** Distinct (fg, bg) pairs in encoded cells, for the 1024-pair budget. */
export function rasterPairs(cells: string): number {
  const bytes = decode(cells)
  const word = (w: number) =>
    ((bytes[w * 4] ?? 0) |
      ((bytes[w * 4 + 1] ?? 0) << 8) |
      ((bytes[w * 4 + 2] ?? 0) << 16) |
      ((bytes[w * 4 + 3] ?? 0) << 24)) >>>
    0
  const pairs = new Set<string>()
  for (let w = 0; w + 2 < bytes.length / 4; w += 3) pairs.add(`${word(w + 1)}:${word(w + 2)}`)
  return pairs.size
}
