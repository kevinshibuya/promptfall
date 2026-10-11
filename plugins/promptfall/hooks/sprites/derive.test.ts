import { expect, test } from 'claude-code/testing'
import { decode, encode } from './base64'
import { lighten, opaqueBox, opaqueRows, shear, squash } from './derive'
import type { SpriteArt } from './types'

/** A `width` × `height` art whose rows `top..top+rows-1` hold index `1 + (row % 3)` at columns 4..(4+row%5). */
function figure(width: number, height: number, top: number, rows: number): SpriteArt {
  const px = new Uint8Array(width * height)
  for (let r = 0; r < rows; r++) {
    const y = top + r
    for (let x = 4; x <= 4 + (r % 5); x++) px[y * width + x] = 1 + (r % 3)
  }
  return { width, height, palette: [0, 0xff0000, 0x00ff00, 0x0000ff], pixels: encode(px) }
}

const row = (art: SpriteArt, y: number): number[] =>
  Array.from(decode(art.pixels).subarray(y * art.width, (y + 1) * art.width))

test('squash drops the middle row of a 10-row figure and moves the rows above it down one', () => {
  const art = figure(24, 24, 10, 10)
  const out = squash(art)
  expect(out.width).toBe(24)
  expect(out.height).toBe(24)
  expect(out.palette).toEqual(art.palette)
  expect(opaqueRows(out)).toEqual({ r0: 11, r1: 19 })
  // the old top row is now one lower
  expect(row(out, 11)).toEqual(row(art, 10))
  // rows above the middle (10..14) sit at 11..15; the middle row 15 is gone; rows 16..19 stay
  for (let y = 10; y < 15; y++) expect(row(out, y + 1)).toEqual(row(art, y))
  for (let y = 16; y <= 19; y++) expect(row(out, y)).toEqual(row(art, y))
  expect(row(out, 10).every((v) => v === 0)).toBe(true)
})

test('squash returns a figure under 3 rows as is', () => {
  const art = figure(24, 24, 5, 2)
  expect(squash(art)).toBe(art)
})

test('squash and shear are memoised per art', () => {
  const art = figure(24, 24, 0, 24)
  expect(squash(art)).toBe(squash(art))
  expect(shear(art)).toBe(shear(art))
})

test('shear leans a 24-row figure: grow 2, width 26, top row in place, bottom row 2 right', () => {
  const art = figure(24, 24, 0, 24)
  const { art: out, grow } = shear(art)
  expect(grow).toBe(2)
  expect(out.width).toBe(26)
  expect(out.height).toBe(24)
  expect(out.palette).toEqual(art.palette)
  const pad = (r: number[], left: number) => [
    ...new Array(left).fill(0),
    ...r,
    ...new Array(2 - left).fill(0),
  ]
  expect(row(out, 0)).toEqual(pad(row(art, 0), 0))
  expect(row(out, 23)).toEqual(pad(row(art, 23), 2))
})

test('shear leaves a 1-row figure alone', () => {
  const art = figure(24, 24, 3, 1)
  const out = shear(art)
  expect(out.art).toBe(art)
  expect(out.grow).toBe(0)
})

test('lighten keeps black and white and lifts the mid grey to 0xa9a9a9', () => {
  expect(lighten(0)).toBe(0)
  expect(lighten(0xffffff)).toBe(0xffffff)
  expect(lighten(0x808080)).toBe(0xa9a9a9)
})

test('opaqueBox of one pixel at (5, 12) is that pixel; an empty art is null', () => {
  const px = new Uint8Array(16 * 16)
  px[12 * 16 + 5] = 1
  const art: SpriteArt = { width: 16, height: 16, palette: [0, 0xffffff], pixels: encode(px) }
  expect(opaqueBox(art)).toEqual({ x0: 5, y0: 12, x1: 5, y1: 12 })
  expect(opaqueRows(art)).toEqual({ r0: 12, r1: 12 })
  const empty: SpriteArt = { ...art, pixels: encode(new Uint8Array(256)) }
  expect(opaqueBox(empty)).toBe(null)
  expect(opaqueRows(empty)).toBe(null)
})
