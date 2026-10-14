import { expect, test } from 'claude-code/testing'
import { decode } from '../sprites/base64'
import type { Frame } from './compose'
import { CLEAR, encodeRaster, intoCells, rasterPairs, resample } from './raster'

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

/** Every pixel of a `width × height` frame from `at(x, y)`: an rgb, or null for clear. */
function painted(
  width: number,
  height: number,
  at: (x: number, y: number) => number | null,
): Frame {
  const opaque: Record<string, number> = {}
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const rgb = at(x, y)
      if (rgb !== null) opaque[`${x},${y}`] = rgb
    }
  }
  return frame(width, height, opaque)
}

/** A frame's rows as rgb, null where clear. */
function rows(f: Frame): (number | null)[][] {
  const out: (number | null)[][] = []
  for (let y = 0; y < f.height; y++) {
    const row: (number | null)[] = []
    for (let x = 0; x < f.width; x++) {
      const i = (y * f.width + x) * 4
      row.push(
        f.rgba[i + 3]
          ? ((f.rgba[i] ?? 0) << 16) | ((f.rgba[i + 1] ?? 0) << 8) | (f.rgba[i + 2] ?? 0)
          : null,
      )
    }
    out.push(row)
  }
  return out
}

const A = 0xff0000
const B = 0x0000ff
const W = 0xffffff

test('resample snaps a 3 by 3 checker into 2 by 2 pixels of the colour each corner carries', () => {
  // Each pixel covers its corner (4/9), two edges (2/9 each) and the centre (1/9): A takes 5/9.
  const checker = painted(3, 3, (x, y) => ((x + y) % 2 === 0 ? A : B))
  expect(rows(resample(checker, 2, 2))).toEqual([
    [A, A],
    [A, A],
  ])
})

test('resample keeps a transparent column clear: transparency votes too', () => {
  const half = painted(3, 3, (x) => (x < 2 ? A : null))
  expect(rows(resample(half, 2, 2))).toEqual([
    [A, null],
    [A, null],
  ])
})

test('resample keeps a one-pixel outline in the column nearest would drop', () => {
  // Nearest reads columns 0, 1, 3 and 4: the line at 2 would go.
  const line = painted(6, 3, (x) => (x === 2 ? W : B))
  expect(rows(resample(line, 4, 2))).toEqual([
    [B, W, B, B],
    [B, W, B, B],
  ])
})

test('resample takes an odd column count: a 176-pixel frame into 117 cells', () => {
  const edges = painted(176, 3, (x) => (x === 2 || x === 175 ? A : null))
  const out = rows(resample(edges, 117, 2))
  expect(out[0]).toHaveLength(117)
  for (const row of out) {
    expect(row.flatMap((rgb, x) => (rgb === null ? [] : [x]))).toEqual([1, 116])
  }
})

test('a number at a scene position lands on its mapped cell as text, over the scene pixel there', () => {
  // A 6 × 6 scene into 4 columns of 2 rows: (3, 3) maps to pixel (2, 2), the top of cell (2, 1).
  const scene = painted(6, 6, (x, y) => (x >= 3 && x < 5 && y >= 3 && y < 5 ? A : null))
  const { frame: shown, numbers } = intoCells(scene, [{ text: '7', x: 3, y: 3, rgb: W }], {
    columns: 4,
    rows: 2,
  })
  const c = cells(encodeRaster(shown, numbers))
  expect(c).toHaveLength(8)
  expect(c[4 + 2]).toEqual([0x37, W, A])
  // The cell beside it keeps its half blocks.
  expect(c[4 + 3]?.[0]).not.toBe(0x37)
})
