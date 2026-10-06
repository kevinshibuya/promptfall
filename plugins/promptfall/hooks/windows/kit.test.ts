import { expect, test } from 'claude-code/testing'
import { decode } from '../sprites/base64'
import { testArt } from './fixtures'
import { fitArt, type PaneScene, placeLine, spanCells, tilePositions, type Win } from './kit'

const win = (key: string, columns: number, rows: number): Win => ({
  key,
  x: 0,
  columns,
  rows,
  lines: [],
  alt: key,
})

test('tilePositions walks rows across and columns down, gaps and nested trees included', () => {
  const scene: PaneScene = {
    columns: 30,
    rows: 12,
    windows: [win('a', 10, 4), win('b', 10, 3), win('c', 10, 4), win('d', 20, 5)],
    alt: '',
    tiles: {
      column: [
        {
          row: [
            { win: 'a' },
            { column: [{ gap: { columns: 10, rows: 1 } }, { win: 'b' }] },
            { win: 'c' },
          ],
        },
        { row: [{ gap: { columns: 10, rows: 2 } }, { win: 'd' }] },
      ],
    },
  }
  const at = tilePositions(scene)
  expect(at.get('a')).toEqual({ x: 0, y: 0 })
  expect(at.get('b')).toEqual({ x: 10, y: 1 })
  expect(at.get('c')).toEqual({ x: 20, y: 0 })
  // The first row is as tall as its tallest child: b's column, 1 + 3.
  expect(at.get('d')).toEqual({ x: 10, y: 4 })
})

test('tilePositions refuses a tile naming no window', () => {
  const scene: PaneScene = { columns: 1, rows: 1, windows: [], alt: '', tiles: { win: 'x' } }
  expect(() => tilePositions(scene)).toThrow()
})

test('an art span takes two cells and is placed whole, or not at all', () => {
  const art = testArt(16, 16, [])
  expect(spanCells({ art })).toBe(2)
  expect(placeLine([{ text: 'A' }, { art }], 3)).toEqual([
    { x: 0, span: 0, kind: 'text', text: 'A', rgb: 0xf0f0e8 },
    { x: 1, span: 1, kind: 'art', art },
  ])
  expect(placeLine([{ text: 'A' }, { art }], 2).map((p) => p.kind)).toEqual(['text'])
})

test('fitArt keeps a 16 × 16 art native and centres a smaller one', () => {
  const full = testArt(16, 16, [])
  expect(fitArt(full)).toEqual({ art: full, dx: 0, dy: 0 })
  const small = testArt(10, 8, [])
  expect(fitArt(small)).toEqual({ art: small, dx: 3, dy: 4 })
})

test('fitArt scales a 48 × 34 art down by 3 to 16 × 11, nearest-neighbour, centred', () => {
  const big = testArt(48, 34, [[15, 12]])
  const { art, dx, dy } = fitArt(big)
  expect([art.width, art.height, dx, dy]).toEqual([16, 11, 0, 2])
  const px = decode(art.pixels)
  expect(px[4 * 16 + 5]).toBe(1)
  expect([...px].filter((v) => v === 1).length).toBe(1)
})
