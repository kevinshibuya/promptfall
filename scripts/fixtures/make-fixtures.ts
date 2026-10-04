// Writes the PNG fixtures sprites.test.ts reads: `tsx scripts/fixtures/make-fixtures.ts`.
import { join } from 'node:path'
import { blank, writePng } from '../png'

const NES = [0x000000, 0xc84c0c, 0xfcfcfc, 0x2038ec, 0x00a800, 0xf0bc3c, 0x887000, 0x5c94fc]
// 17 distinct colours of the NES master, for a 17-colour snes sprite.
const SEVENTEEN = [
  0x747474, 0x24188c, 0x0000a8, 0x44009c, 0x8c0074, 0xa80010, 0xa40000, 0x7c0800, 0x402c00,
  0x004400, 0x005000, 0x003c14, 0x183c5c, 0x000000, 0xbcbcbc, 0x0070ec, 0x2038ec,
]

function image(width: number, height: number, colour: (x: number, y: number) => number | null) {
  const img = blank(width, height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const c = colour(x, y)
      if (c === null) continue
      img.data.set([(c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff, 255], (y * width + x) * 4)
    }
  }
  return img
}

const at = (list: number[], i: number) => list[i % list.length] ?? 0
const dir = import.meta.dirname
// Column bands of n colours, the first column transparent.
const bands = (w: number, h: number, n: number) =>
  image(w, h, (x) => (x === 0 ? null : at(NES, (x - 1) % n)))

writePng(join(dir, 'nes-4.png'), bands(16, 16, 4))
writePng(join(dir, 'nes-5.png'), bands(16, 16, 5))
writePng(
  join(dir, 'nes-12x9.png'),
  image(12, 9, (x, y) => at(NES, (x + y) % 2)),
)
writePng(
  join(dir, 'nes-17x16.png'),
  image(17, 16, () => at(NES, 1)),
)
writePng(
  join(dir, 'snes-17.png'),
  image(17, 2, (x) => at(SEVENTEEN, x)),
)
writePng(
  join(dir, 'snes-48x34.png'),
  image(48, 34, (x, y) => at(NES, (x + y) % 2)),
)
