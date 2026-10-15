import { expect, test } from 'claude-code/testing'
import { decode } from '../sprites/base64'
import { CLEAR } from '../stage/raster'
import { testArt } from './fixtures'
import type { Scene, Win } from './kit'
import { sceneCells } from './raster'
import { BAR_BACK_RGB, BORDER_RGB, FIELD_RGB, HP_BAR_RGB } from './tuning'

type Cell = { ch: string; fg: number; bg: number }
function cells(scene: Scene): Cell[][] {
  const bytes = decode(sceneCells(scene))
  const words = new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4)
  return Array.from({ length: scene.rows }, (_, y) =>
    Array.from({ length: scene.columns }, (_, x) => {
      const w = (y * scene.columns + x) * 3
      return {
        ch: String.fromCodePoint(words[w] ?? 32),
        fg: words[w + 1] ?? 0,
        bg: words[w + 2] ?? 0,
      }
    }),
  )
}
const text = (row: Cell[] | undefined) => (row ?? []).map((c) => c.ch).join('')
const win = (patch: Partial<Win> = {}): Win => ({
  key: 'w',
  x: 0,
  columns: 10,
  rows: 3,
  lines: [],
  alt: 'w',
  ...patch,
})
const scene = (...windows: Win[]): Scene => ({ columns: 12, rows: 3, windows, alt: '' })

test('a 10 × 3 window is box-drawn on the field, its title cut into the top line', () => {
  const g = cells(scene(win({ title: [{ text: 'Hi' }] })))
  expect(text(g[0])).toBe('╭ Hi ────╮  ')
  expect(text(g[1])).toBe('│        │  ')
  expect(text(g[2])).toBe('╰────────╯  ')
  expect(g[0]?.[0]).toEqual({ ch: '╭', fg: BORDER_RGB, bg: FIELD_RGB })
  expect(g[1]?.[11]).toEqual({ ch: ' ', fg: CLEAR, bg: CLEAR })
})

test('a bar at 5000 over 4 cells gives two filled ▬ and two empty', () => {
  const g = cells(scene(win({ lines: [{ spans: [{ bar: 5000, cells: 4, rgb: HP_BAR_RGB }] }] })))
  const bar = g[1]?.slice(1, 5) ?? []
  expect(bar.map((c) => c.ch).join('')).toBe('▬▬▬▬')
  expect(bar.map((c) => c.fg)).toEqual([HP_BAR_RGB, HP_BAR_RGB, BAR_BACK_RGB, BAR_BACK_RGB])
})

test('text, the cursor, reveal and the ? fallback', () => {
  const g = cells(
    scene(win({ lines: [{ spans: [{ cursor: true }, { text: 'H♞!' }], reveal: 2 }] })),
  )
  expect(text(g[1]).slice(1, 5)).toBe('▶H? ')
})

test('two windows side by side keep their own frames', () => {
  const g = cells({
    columns: 8,
    rows: 3,
    windows: [win({ columns: 4 }), win({ key: 'b', x: 4, columns: 4 })],
    alt: '',
  })
  expect(text(g[0])).toBe('╭──╮╭──╮')
  expect(text(g[2])).toBe('╰──╯╰──╯')
})

test('an accented letter draws as its base letter, a symbol the font lacks as ?', () => {
  const g = cells(scene(win({ lines: [{ spans: [{ text: 'Zoé♞' }] }] })))
  expect(text(g[1]).slice(1, 5)).toBe('Zoe?')
})

test('a window at y = 3 lands at row 3', () => {
  const g = cells({ columns: 10, rows: 6, windows: [win({ y: 3 })], alt: '' })
  expect(text(g[2])).toBe('          ')
  expect(text(g[3])).toBe('╭────────╮')
  expect(text(g[5])).toBe('╰────────╯')
})

test('an art span draws two blank cells', () => {
  const art = testArt(16, 16, [[0, 0]])
  const line = { spans: [{ text: 'A' }, { art }, { text: 'B' }] }
  const g = cells({ columns: 10, rows: 3, windows: [win({ lines: [line] })], alt: '' })
  expect(text(g[1])).toBe('│A  B    │')
})

test("an art span's mark draws its glyph in the art's two cells, in its colour", () => {
  const art = testArt(16, 16, [[0, 0]])
  const line = { spans: [{ text: 'A' }, { art, mark: { ch: '█', rgb: 0x3080e8 } }, { text: 'B' }] }
  const g = cells({ columns: 10, rows: 3, windows: [win({ lines: [line] })], alt: '' })
  expect(text(g[1])).toBe('│A██B    │')
  expect(g[1]?.slice(2, 4)).toEqual([
    { ch: '█', fg: 0x3080e8, bg: FIELD_RGB },
    { ch: '█', fg: 0x3080e8, bg: FIELD_RGB },
  ])
})
