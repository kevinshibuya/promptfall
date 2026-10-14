// Half-block cell packing after claude-toons (MIT, copyright 2026 Anshu Chimala; see NOTICE.md):
// each terminal cell shows two stage pixels, the top as the foreground of '▀' and the bottom as
// its background, with '▄' and the terminal's default colour where only one of them is opaque.
import { decode, encode } from '../sprites/base64'
import { type Frame, taps } from './compose'
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

/**
 * Raster cells for a frame composed with `numbers: false`, then each number's glyphs as text
 * cells at cell (floor x, floor y / 2), clamped inside the box: fg its colour, bg the scene pixel
 * under the cell (the backdrop, or CLEAR where there is none), so a number is not a box.
 */
export function encodeRaster(frame: Frame, numbers: readonly StageNumber[]): string {
  // Uint32Array is host-endian; every host the engine runs on is little-endian, as Raster reads.
  return encode(new Uint8Array(rasterWords(frame, numbers).buffer))
}

/** encodeRaster's cells as words: per cell a codepoint, then fg, then bg. */
export function rasterWords(frame: Frame, numbers: readonly StageNumber[]): Uint32Array {
  const columns = frame.width
  const rows = Math.floor(frame.height / 2)
  const words = new Uint32Array(columns * rows * 3)
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < columns; cx++) {
      const top = pixel(frame, cx, cy * 2)
      const bottom = pixel(frame, cx, cy * 2 + 1)
      const w = (cy * columns + cx) * 3
      if (top !== null) {
        words[w] = UPPER
        words[w + 1] = top
        words[w + 2] = bottom ?? CLEAR
      } else if (bottom !== null) {
        words[w] = LOWER
        words[w + 1] = bottom
        words[w + 2] = CLEAR
      } else {
        words[w] = SPACE
        words[w + 1] = CLEAR
        words[w + 2] = CLEAR
      }
    }
  }
  for (const n of numbers) {
    const x0 = Math.max(0, Math.min(columns - n.text.length, Math.floor(n.x)))
    const y = Math.max(0, Math.min(rows - 1, Math.floor(n.y / 2)))
    for (let c = 0; c < n.text.length && x0 + c < columns; c++) {
      const w = (y * columns + x0 + c) * 3
      words[w] = n.text.charCodeAt(c)
      words[w + 1] = n.rgb
      words[w + 2] = pixel(frame, x0 + c, y * 2) ?? CLEAR
    }
  }
  return words
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

/** Past this a vote is a win, not a tie: the shares are sums of products of thirds. */
const TIE = 1e-9

/** The index of each pixel's heaviest tap, the first on a tie. */
function heaviest(row: readonly [number, number][][]): Int32Array {
  return Int32Array.from(row, (t) => {
    let best = 0
    for (let i = 1; i < t.length; i++) if ((t[i]?.[1] ?? 0) > (t[best]?.[1] ?? 0) + TIE) best = i
    return t[best]?.[0] ?? 0
  })
}

/**
 * `frame` resampled into `width × height` pixels, snapped and never blended: each pixel takes the
 * one colour of the frame that covers most of its footprint, by the band composer's tap weights.
 * Clear votes as a colour, so a pixel mostly over nothing stays clear. A tie goes to the colour of
 * the pixel's heaviest tap. No colour enters that the frame does not hold.
 */
export function resample(frame: Frame, width: number, height: number): Frame {
  if (width === frame.width && height === frame.height) return frame
  const xs = taps(frame.width, width)
  const ys = taps(frame.height, height)
  const hx = heaviest(xs)
  const hy = heaviest(ys)
  // Each source pixel as one key: its rgb, or -1 where clear.
  const key = new Int32Array(frame.width * frame.height)
  for (let i = 0; i < key.length; i++) {
    const j = i * 4
    key[i] = frame.rgba[j + 3]
      ? ((frame.rgba[j] ?? 0) << 16) | ((frame.rgba[j + 1] ?? 0) << 8) | (frame.rgba[j + 2] ?? 0)
      : -1
  }
  const most = (t: [number, number][][]) => Math.max(1, ...t.map((r) => r.length))
  const keys = new Int32Array(most(xs) * most(ys) + 1)
  const shares = new Float64Array(keys.length)
  const rgba = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    const rowTaps = ys[y] ?? []
    for (let x = 0; x < width; x++) {
      // The heaviest tap's colour stands first, so a tie keeps it.
      keys[0] = key[(hy[y] ?? 0) * frame.width + (hx[x] ?? 0)] ?? -1
      shares[0] = 0
      let n = 1
      for (const [sy, wy] of rowTaps) {
        for (const [sx, wx] of xs[x] ?? []) {
          const k = key[sy * frame.width + sx] ?? -1
          let j = 0
          while (j < n && keys[j] !== k) j++
          if (j === n) {
            keys[n] = k
            shares[n] = 0
            n++
          }
          shares[j] = (shares[j] ?? 0) + wx * wy
        }
      }
      let best = 0
      for (let j = 1; j < n; j++) if ((shares[j] ?? 0) > (shares[best] ?? 0) + TIE) best = j
      const rgb = keys[best] ?? -1
      if (rgb < 0) continue
      const i = (y * width + x) * 4
      rgba[i] = (rgb >> 16) & 0xff
      rgba[i + 1] = (rgb >> 8) & 0xff
      rgba[i + 2] = rgb & 0xff
      rgba[i + 3] = 255
    }
  }
  return { width, height, rgba }
}

/**
 * The Raster's stage: a scene frame (composed with `numbers: false`) resampled into the pixels of
 * `box`'s cells, a column and half a row each, and its numbers moved through the same factor, so
 * each lands as text on the cell its scene position maps to.
 */
export function intoCells(
  scene: Frame,
  numbers: readonly StageNumber[],
  box: { columns: number; rows: number },
): { frame: Frame; numbers: StageNumber[] } {
  const frame = resample(scene, box.columns, box.rows * 2)
  const fx = frame.width / scene.width
  const fy = frame.height / scene.height
  return { frame, numbers: numbers.map((n) => ({ ...n, x: n.x * fx, y: n.y * fy })) }
}
