import { decodePixels } from '../sprites/index'
import type { SpriteArt } from '../sprites/types'
import { drawText } from './font'
import type { StageModel } from './model'

/** RGBA, alpha 0 or 255 only. */
export type Frame = { width: number; height: number; rgba: Uint8ClampedArray }

/** The 4 × 4 Bayer matrix: a pixel of an actor at `alpha` shows where alpha * 16 > bayer[y % 4][x % 4]. */
const BAYER: readonly (readonly number[])[] = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
]

const decoded = new WeakMap<SpriteArt, Uint8Array>()

function pixelsOf(art: SpriteArt): Uint8Array {
  let px = decoded.get(art)
  if (!px) {
    px = decodePixels(art)
    decoded.set(art, px)
  }
  return px
}

function blankFrame(width: number, height: number): Frame {
  return { width, height, rgba: new Uint8ClampedArray(width * height * 4) }
}

function put(frame: Frame, x: number, y: number, rgb: number): void {
  const i = (y * frame.width + x) * 4
  frame.rgba[i] = (rgb >> 16) & 0xff
  frame.rgba[i + 1] = (rgb >> 8) & 0xff
  frame.rgba[i + 2] = rgb & 0xff
  frame.rgba[i + 3] = 255
}

function blit(
  frame: Frame,
  art: SpriteArt,
  palette: readonly number[],
  x0: number,
  y0: number,
  flipX: boolean,
  alpha: number,
): void {
  if (alpha <= 0) return
  const px = pixelsOf(art)
  const level = alpha * 16
  for (let y = 0; y < art.height; y++) {
    const fy = y0 + y
    if (fy < 0 || fy >= frame.height) continue
    for (let x = 0; x < art.width; x++) {
      const v = px[y * art.width + (flipX ? art.width - 1 - x : x)] ?? 0
      if (v === 0) continue
      const fx = x0 + x
      if (fx < 0 || fx >= frame.width) continue
      if (level <= (BAYER[fy % 4]?.[fx % 4] ?? 0)) continue
      put(frame, fx, fy, palette[v] ?? 0)
    }
  }
}

/**
 * The stage as pixels: the ground strip on the bottom two rows, the actors in slot order, the
 * drops, then (when `numbers`) the damage numbers. Raster draws numbers as text cells instead.
 */
export function composeFrame(model: StageModel, opts: { numbers: boolean }): Frame {
  const frame = blankFrame(model.box.columns, model.box.rows * 2)
  for (let y = Math.max(0, frame.height - 2); y < frame.height; y++) {
    for (let x = 0; x < frame.width; x++) put(frame, x, y, model.ground)
  }
  for (const a of model.actors) blit(frame, a.art, a.palette, a.x, a.y, a.flipX, a.alpha)
  for (const d of model.drops) blit(frame, d.art, d.art.palette, d.x, d.y, false, d.alpha)
  if (opts.numbers) for (const n of model.numbers) drawText(frame, n.text, n.x, n.y, n.rgb)
  return frame
}

/** One sprite alone, for the list sprites. */
export function artFrame(art: SpriteArt, palette: readonly number[] = art.palette): Frame {
  const frame = blankFrame(art.width, art.height)
  blit(frame, art, palette, 0, 0, false, 1)
  return frame
}
