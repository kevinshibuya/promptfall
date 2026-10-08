import { decodePixels } from '../sprites/index'
import type { SpriteArt } from '../sprites/types'
import { drawOutlinedText, glyphBlock } from './font'
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
 * Where a backdrop's top-left lands in a `width × height` frame: bottom-anchored, centred. A frame
 * narrower or shorter than the painting crops it (the sides, then the sky); a wider one (the Image
 * stage zooming out for a boss, ADR 0004) continues it with mirrored copies on each side, so the
 * scenery goes on without a seam; a taller one cannot happen and would repeat the top row.
 */
export function backdropOrigin(
  art: { width: number; height: number },
  width: number,
  height: number,
): { x: number; y: number } {
  return { x: Math.floor((width - art.width) / 2), y: height - art.height }
}

/** Column `i` of the painting continued past its edges by mirroring: -1 is 0, `w` is `w - 1`. */
export function mirrored(i: number, w: number): number {
  const period = 2 * w
  const m = ((i % period) + period) % period
  return m < w ? m : period - 1 - m
}

/** The whole frame painted from the backdrop: mirrored past its sides, the top row above it. */
function drawBackdrop(frame: Frame, art: SpriteArt): void {
  const px = pixelsOf(art)
  const { x: ox, y: oy } = backdropOrigin(art, frame.width, frame.height)
  for (let y = 0; y < frame.height; y++) {
    const sy = Math.min(art.height - 1, Math.max(0, y - oy))
    for (let x = 0; x < frame.width; x++) {
      const sx = mirrored(x - ox, art.width)
      put(frame, x, y, art.palette[px[sy * art.width + sx] ?? 0] ?? 0)
    }
  }
}

/**
 * The stage as pixels: the zone's backdrop over the whole frame (or, without one, the ground strip
 * on the bottom two rows, three at scale 1.5), the actors in slot order, the drops, the effect
 * sprites, then (when `numbers`) the damage numbers. Raster draws numbers as text cells instead.
 */
export function composeFrame(model: StageModel, opts: { numbers: boolean }): Frame {
  const { width, height } = frameSize(model)
  const frame = blankFrame(width, height)
  if (model.backdrop) drawBackdrop(frame, model.backdrop)
  else {
    const ground = Math.round(2 * model.scale)
    for (let y = Math.max(0, frame.height - ground); y < frame.height; y++) {
      for (let x = 0; x < frame.width; x++) put(frame, x, y, model.ground)
    }
  }
  for (const a of model.actors) {
    blit(frame, a.art, a.palette, a.x + a.poses[a.pose].dx, a.y, a.flipX, a.alpha)
  }
  for (const d of model.drops) blit(frame, d.art, d.art.palette, d.x, d.y, false, d.alpha)
  for (const e of model.effects) blit(frame, e.art, e.art.palette, e.x, e.y, e.flipX, 1)
  const block = glyphBlock(model.scale)
  if (opts.numbers) {
    for (const n of model.numbers) drawOutlinedText(frame, n.text, n.x, n.y, n.rgb, block)
  }
  return frame
}

/** The frame's size in stage pixels: the box's columns and half-block rows, times the scale. */
export function frameSize(model: { box: { columns: number; rows: number }; scale: number }): {
  width: number
  height: number
} {
  return {
    width: Math.ceil(model.box.columns * model.scale),
    height: Math.ceil(model.box.rows * 2 * model.scale),
  }
}

/** One sprite alone, for the list sprites. */
export function artFrame(art: SpriteArt, palette: readonly number[] = art.palette): Frame {
  const frame = blankFrame(art.width, art.height)
  blit(frame, art, palette, 0, 0, false, 1)
  return frame
}
