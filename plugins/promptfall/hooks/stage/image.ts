import { encode } from '../sprites/base64'
import type { Frame } from './compose'

/** A frame composed with `numbers: true`, upscaled nearest-neighbour by `scale`, as an ImageSource. */
export function encodeImage(
  frame: Frame,
  scale: number,
): { rgba: string; width: number; height: number } {
  const width = frame.width * scale
  const height = frame.height * scale
  if (scale === 1) return { rgba: encode(new Uint8Array(frame.rgba.buffer)), width, height }
  const out = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    const sy = Math.floor(y / scale)
    for (let x = 0; x < width; x++) {
      const si = (sy * frame.width + Math.floor(x / scale)) * 4
      const di = (y * width + x) * 4
      out[di] = frame.rgba[si] ?? 0
      out[di + 1] = frame.rgba[si + 1] ?? 0
      out[di + 2] = frame.rgba[si + 2] ?? 0
      out[di + 3] = frame.rgba[si + 3] ?? 0
    }
  }
  return { rgba: encode(out), width, height }
}

export function imageBytes(frame: Frame, scale: number): number {
  return frame.width * frame.height * 4 * scale * scale
}
