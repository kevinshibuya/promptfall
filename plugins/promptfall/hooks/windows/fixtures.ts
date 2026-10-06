// Test fixtures for the window kit's tests.
import { encode } from '../sprites/base64'
import type { SpriteArt } from '../sprites/types'

/** An art `width × height`, index 1 at each listed pixel. */
export function testArt(width: number, height: number, on: [number, number][]): SpriteArt {
  const px = new Uint8Array(width * height)
  for (const [x, y] of on) px[y * width + x] = 1
  return { width, height, palette: [0, 0xe83830], pixels: encode(px) }
}
