import { encode } from '../sprites/base64'
import type { Frame } from './compose'
import { encodePng, toBase64 } from './png'

/** The frame's pixels upscaled nearest-neighbour by `scale`. */
function upscale(
  frame: Frame,
  scale: number,
): { bytes: Uint8Array; width: number; height: number } {
  const width = frame.width * scale
  const height = frame.height * scale
  const src = new Uint8Array(frame.rgba.buffer, frame.rgba.byteOffset, frame.rgba.byteLength)
  if (scale === 1) return { bytes: src, width, height }
  const out = new Uint8Array(width * height * 4)
  if (Number.isInteger(scale)) {
    // Each source row once, its pixels repeated across; then the row copied down `scale - 1` times.
    const stride = width * 4
    for (let sy = 0; sy < frame.height; sy++) {
      const base = sy * scale * stride
      for (let sx = 0; sx < frame.width; sx++) {
        const si = (sy * frame.width + sx) * 4
        for (let k = 0; k < scale; k++) {
          const di = base + (sx * scale + k) * 4
          out[di] = src[si] ?? 0
          out[di + 1] = src[si + 1] ?? 0
          out[di + 2] = src[si + 2] ?? 0
          out[di + 3] = src[si + 3] ?? 0
        }
      }
      for (let r = 1; r < scale; r++) out.copyWithin(base + r * stride, base, base + stride)
    }
    return { bytes: out, width, height }
  }
  for (let y = 0; y < height; y++) {
    const sy = Math.floor(y / scale)
    for (let x = 0; x < width; x++) {
      const si = (sy * frame.width + Math.floor(x / scale)) * 4
      const di = (y * width + x) * 4
      out[di] = src[si] ?? 0
      out[di + 1] = src[si + 1] ?? 0
      out[di + 2] = src[si + 2] ?? 0
      out[di + 3] = src[si + 3] ?? 0
    }
  }
  return { bytes: out, width, height }
}

/** A frame composed with `numbers: true`, upscaled nearest-neighbour by `scale`, as raw RGBA. */
export function encodeImage(
  frame: Frame,
  scale: number,
): { rgba: string; width: number; height: number } {
  const { bytes, width, height } = upscale(frame, scale)
  return { rgba: encode(bytes), width, height }
}

/** The same pixels as `encodeImage`, as a PNG: what the terminal is sent, a fraction of the bytes. */
export function pngImage(frame: Frame, scale: number): { png: string } {
  const { bytes, width, height } = upscale(frame, scale)
  return { png: toBase64(encodePng(bytes, width, height)) }
}

export function imageBytes(frame: Frame, scale: number): number {
  return frame.width * frame.height * 4 * scale * scale
}
