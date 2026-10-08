import { expect, test } from 'claude-code/testing'
import { decode } from '../sprites/base64'
import type { Frame } from './compose'
import { CLEAR, encodeRaster, rasterPairs } from './raster'

function frame(width: number, height: number, opaque: Record<string, number>): Frame {
  const rgba = new Uint8ClampedArray(width * height * 4)
  for (const [at, rgb] of Object.entries(opaque)) {
    const [x, y] = at.split(',').map(Number)
    const i = ((y ?? 0) * width + (x ?? 0)) * 4
    rgba.set([(rgb >> 16) & 0xff, (rgb >> 8) & 0xff, rgb & 0xff, 255], i)
  }
  return { width, height, rgba }
}

function cells(encoded: string): number[][] {
  const b = decode(encoded)
  const out: number[][] = []
  for (let i = 0; i < b.length; i += 12) {
    const w = (o: number) =>
      ((b[i + o] ?? 0) |
        ((b[i + o + 1] ?? 0) << 8) |
        ((b[i + o + 2] ?? 0) << 16) |
        ((b[i + o + 3] ?? 0) << 24)) >>>
      0
    out.push([w(0), w(4), w(8)])
  }
  return out
}

test('one cell per case of its two pixels', () => {
  expect(cells(encodeRaster(frame(1, 2, { '0,0': 0xff0000, '0,1': 0x00ff00 }), []))).toEqual([
    [0x2580, 0xff0000, 0x00ff00],
  ])
  expect(cells(encodeRaster(frame(1, 2, { '0,0': 0xff0000 }), []))).toEqual([
    [0x2580, 0xff0000, CLEAR],
  ])
  expect(cells(encodeRaster(frame(1, 2, { '0,1': 0x0000ff }), []))).toEqual([
    [0x2584, 0x0000ff, CLEAR],
  ])
  expect(cells(encodeRaster(frame(1, 2, {}), []))).toEqual([[0x20, CLEAR, CLEAR]])
})

test('the cell count is columns * rows', () => {
  expect(cells(encodeRaster(frame(7, 6, {}), []))).toHaveLength(21)
})

test('a number replaces the cells under it over the scene pixel there, clamped inside the box', () => {
  const c = cells(
    encodeRaster(frame(6, 4, { '1,2': 0xff0000 }), [{ text: '42', x: 1.5, y: 3, rgb: 0xffffff }]),
  )
  // The '4' sits on a red pixel: its cell keeps red behind it; the '2' on nothing keeps CLEAR.
  expect(c[6 + 1]).toEqual([0x34, 0xffffff, 0xff0000])
  expect(c[6 + 2]).toEqual([0x32, 0xffffff, CLEAR])
  const last = cells(encodeRaster(frame(6, 4, {}), [{ text: '123', x: 5, y: 3, rgb: 0xffffff }]))
  expect(last.slice(9, 12).map((x) => x[0])).toEqual([0x31, 0x32, 0x33])
})

test('rasterPairs counts distinct pairs', () => {
  const f = frame(3, 2, { '0,0': 0xff0000, '1,0': 0xff0000, '2,1': 0x00ff00 })
  expect(rasterPairs(encodeRaster(f, []))).toBe(2)
})
