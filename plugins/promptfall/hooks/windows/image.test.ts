import { expect, test } from 'claude-code/testing'
import type { Frame } from '../stage/compose'
import { imageBytes } from '../stage/image'
import { IMAGE_MAX_BYTES } from '../stage/tuning'
import { testArt } from './fixtures'
import { glyph } from './glyphs'
import { windowFrame, windowKey, windowSource } from './image'
import type { Win } from './kit'
import {
  BAR_BACK_RGB,
  BAR_Y,
  BORDER_RGB,
  FIELD_RGB,
  HP_BAR_RGB,
  TEXT_RGB,
  WINDOW_SCALE,
} from './tuning'

const T = -1
function at(f: Frame, x: number, y: number): number {
  const i = (y * f.width + x) * 4
  if (f.rgba[i + 3] === 0) return T
  return ((f.rgba[i] ?? 0) << 16) | ((f.rgba[i + 1] ?? 0) << 8) | (f.rgba[i + 2] ?? 0)
}
const win = (patch: Partial<Win> = {}): Win => ({
  key: 'w',
  x: 0,
  columns: 10,
  rows: 3,
  lines: [],
  alt: 'w',
  ...patch,
})
/** Glyph pixels drawn in a cell, as the font's row bytes. */
function cellRows(f: Frame, cx: number, cy: number, rgb: number): number[] {
  const rows: number[] = []
  for (let y = 0; y < 16; y++) {
    let bits = 0
    for (let x = 0; x < 8; x++) if (at(f, cx * 8 + x, cy * 16 + y) === rgb) bits |= 0x80 >> x
    rows.push(bits)
  }
  return rows
}

test('a 10 × 3 window is 80 × 48 picture pixels, keyed by its size', () => {
  const f = windowFrame(win())
  expect([f.width, f.height]).toEqual([80, 48])
  expect(windowKey(win())).toBe('win-w-10x3')
})

test('the top-left corner matches the transcribed bitmap; the others mirror it', () => {
  const f = windowFrame(win())
  const role = (x: number, y: number) => {
    const p = at(f, x, y)
    return p === T ? '-' : p === BORDER_RGB ? '#' : p === FIELD_RGB ? '.' : '?'
  }
  const rows = Array.from({ length: 16 }, (_, y) =>
    Array.from({ length: 8 }, (_, x) => role(x, y)).join(''),
  )
  expect(rows).toEqual([
    ...Array(9).fill('--------'),
    '--......',
    '-..#####',
    '-.######',
    '-.##....',
    '-.##....',
    '-.##....',
    '-.##....',
  ])
  expect(role(79, 10)).toBe('-')
  expect(role(78, 10)).toBe('.')
  expect(role(77, 10)).toBe('.')
  expect(role(76, 10)).toBe('#')
  expect(role(77, 47 - 10)).toBe('.')
  expect(role(2, 47 - 11)).toBe('#')
  // The middle row's border cells: field inside the line.
  expect(rows.length).toBe(16)
  expect([role(0, 24), role(1, 24), role(2, 24), role(3, 24), role(4, 24)]).toEqual([
    '-',
    '.',
    '#',
    '#',
    '.',
  ])
})

test('a title sits on a field plate in the top border, its glyphs in TEXT_RGB', () => {
  const f = windowFrame(win({ title: [{ text: 'Hi' }] }))
  expect(cellRows(f, 2, 0, TEXT_RGB)).toEqual([...(glyph('H') as Uint8Array)])
  expect(cellRows(f, 3, 0, TEXT_RGB)).toEqual([...(glyph('i') as Uint8Array)])
  // The plate breaks the white line from cell 1 to one cell past the text.
  expect(at(f, 8, 10)).toBe(FIELD_RGB)
  expect(at(f, 8 * 4 + 7, 10)).toBe(FIELD_RGB)
  expect(at(f, 8 * 5, 10)).toBe(BORDER_RGB)
})

test('a bar at 5000 over 4 cells fills 16 px over the back', () => {
  const f = windowFrame(win({ lines: [{ spans: [{ bar: 5000, cells: 4, rgb: HP_BAR_RGB }] }] }))
  const y = 16 + BAR_Y
  const row = Array.from({ length: 32 }, (_, x) => at(f, 8 + x, y))
  expect(row.filter((p) => p === HP_BAR_RGB)).toHaveLength(16)
  expect(row.filter((p) => p === BAR_BACK_RGB)).toHaveLength(16)
  expect(row[0]).toBe(HP_BAR_RGB)
})

test('reveal 3 on "Hello" draws exactly three glyphs', () => {
  const f = windowFrame(win({ lines: [{ spans: [{ text: 'Hello' }], reveal: 3 }] }))
  const drawn = [1, 2, 3, 4, 5].map((cx) => cellRows(f, cx, 1, TEXT_RGB).some((b) => b !== 0))
  expect(drawn).toEqual([true, true, true, false, false])
})

test('a character the font lacks draws as ?; the cursor draws ▶', () => {
  const f = windowFrame(win({ lines: [{ spans: [{ cursor: true }, { text: '♞' }] }] }))
  expect(cellRows(f, 1, 1, TEXT_RGB)).toEqual([...(glyph('▶') as Uint8Array)])
  expect(cellRows(f, 2, 1, TEXT_RGB)).toEqual([...(glyph('?') as Uint8Array)])
})

test('a rule line draws a 1 px white line joined to both side borders', () => {
  const f = windowFrame(win({ lines: [{ spans: [{ text: 'A' }], rule: true }] }))
  const y = 16 + 15
  expect(at(f, 2, y)).toBe(BORDER_RGB)
  expect(at(f, 40, y)).toBe(BORDER_RGB)
  expect(at(f, 77, y)).toBe(BORDER_RGB)
  expect(at(f, 40, y - 1)).toBe(FIELD_RGB)
})

test('the widest strip window (80 columns) stays inside the byte cap and the 2048 px side', () => {
  const f = windowFrame(win({ columns: 80, rows: 5 }))
  expect(imageBytes(f, WINDOW_SCALE)).toBeLessThan(IMAGE_MAX_BYTES)
  expect(f.width * WINDOW_SCALE).toBeLessThan(2048)
})

test('an art span draws the fitted sprite at its cell, index 0 left as field', () => {
  const art = testArt(16, 16, [
    [0, 0],
    [15, 15],
  ])
  const f = windowFrame(win({ columns: 6, rows: 3, lines: [{ spans: [{ gap: 1 }, { art }] }] }))
  // Inner cell 1 starts at picture x 16; the inner row at y 16.
  expect(at(f, 16, 16)).toBe(0xe83830)
  expect(at(f, 31, 31)).toBe(0xe83830)
  expect(at(f, 17, 16)).toBe(FIELD_RGB)
})

test('windowSource encodes a window once: the same content answers the same source', () => {
  const a = windowSource(win({ title: [{ text: 'Party' }] }))
  const b = windowSource(win({ title: [{ text: 'Party' }] }))
  expect(b).toBe(a)
  const c = windowSource(win({ title: [{ text: 'Loot' }] }))
  expect(c).not.toBe(a)
  expect(c.png).not.toBe(a.png)
})
