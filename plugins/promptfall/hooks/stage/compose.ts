import { decodePixels } from '../sprites/index'
import type { SpriteArt } from '../sprites/types'
import { drawOutlinedText, glyphBlock } from './font'
import type { Mark, StageActor, StageModel } from './model'
import { FLASH_RGB } from './tuning'

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

/** A disc: the pixels whose centres lie within `r` of (cx, cy), dithered at `alpha` as `blit` is. */
function disc(frame: Frame, cx: number, cy: number, r: number, rgb: number, alpha: number): void {
  if (alpha <= 0 || r <= 0) return
  const level = alpha * 16
  const y0 = Math.max(0, Math.floor(cy - r))
  const y1 = Math.min(frame.height - 1, Math.ceil(cy + r))
  const x0 = Math.max(0, Math.floor(cx - r))
  const x1 = Math.min(frame.width - 1, Math.ceil(cx + r))
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - cx
      const dy = y + 0.5 - cy
      if (dx * dx + dy * dy > r * r) continue
      if (level <= (BAYER[y % 4]?.[x % 4] ?? 0)) continue
      put(frame, x, y, rgb)
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
 * on the bottom two rows, three at scale 1.5), the actors in slot order (a hasted hero's speed
 * lines under it), Guard's shield (white while a hit lands on it), the glows, the chests, the items rising from them, the campfire, the
 * effect sprites, then (when `numbers`) the damage numbers. Raster draws numbers as text cells
 * instead.
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
  const mark = (a: StageActor, m: Mark, palette = m.art.palette) =>
    blit(frame, m.art, palette, a.x + m.dx, a.y + m.dy, false, a.alpha)
  for (const a of model.actors) {
    // Haste's speed lines trail the idle pair, a pattern per frame, under the hero and under the
    // next one along.
    if (a.speedLines && (a.pose === 'idle' || a.pose === 'idle_b'))
      mark(a, a.speedLines[a.pose === 'idle_b' ? 1 : 0])
    blit(frame, a.art, a.palette, a.x + a.poses[a.pose].dx, a.y, a.flipX, a.alpha)
  }
  for (const a of model.actors) {
    const s = a.shield
    if (s)
      mark(a, s, s.flashing ? s.art.palette.map((c, i) => (i === 0 ? c : FLASH_RGB)) : undefined)
  }
  for (const g of model.glows) disc(frame, g.x, g.y, g.r, g.rgb, g.alpha)
  for (const c of model.chests) blit(frame, c.art, c.art.palette, c.x, c.y, false, c.alpha)
  for (const d of model.drops) blit(frame, d.art, d.art.palette, d.x, d.y, false, d.alpha)
  const fire = model.campfire
  if (fire) blit(frame, fire.art, fire.art.palette, fire.x, fire.y, false, fire.alpha)
  for (const e of model.effects) blit(frame, e.art, e.art.palette, e.x, e.y, e.flipX, 1)
  const block = glyphBlock(model.scale)
  if (opts.numbers) {
    for (const n of model.numbers) drawOutlinedText(frame, n.text, n.x, n.y, n.rgb, block)
  }
  return frame
}

/** The bottom `height` pixel rows of a frame: a stage cropped to the cells a short band has. */
export function cropBottom(frame: Frame, height: number): Frame {
  const h = Math.max(0, Math.min(frame.height, height))
  if (h === frame.height) return frame
  const from = (frame.height - h) * frame.width * 4
  return { width: frame.width, height: h, rgba: frame.rgba.slice(from) }
}

/**
 * For each of `to` pixels, the `from` pixels its footprint covers and the share of each: the tap
 * weights the band composer scales a zoomed-out scene with, and the Raster's resample votes with.
 */
export function taps(from: number, to: number): [number, number][][] {
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
