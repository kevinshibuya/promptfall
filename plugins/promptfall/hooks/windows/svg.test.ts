import { expect, test } from 'claude-code/testing'
import type { Line, Scene, Track, Win } from './kit'
import { sceneSvg } from './svg'
import { GAUGE_FULL_RGB, GAUGE_RGB, STRIP_SVG_MAX_CHARS } from './tuning'

const win = (patch: Partial<Win> = {}): Win => ({
  key: 'w',
  x: 0,
  columns: 10,
  rows: 3,
  lines: [],
  alt: 'w',
  ...patch,
})
const opts = { smil: true, width: 400 }

test('native viewBox, width in CSS px, height in proportion', () => {
  const svg = sceneSvg({ columns: 10, rows: 3, windows: [win()], alt: '' }, [], opts)
  expect(svg).toContain('viewBox="0 0 80 48"')
  expect(svg).toContain('width="400" height="240"')
  expect(svg).toContain('shape-rendering="crispEdges"')
})

test('a two-window scene defines each glyph once and uses it per character', () => {
  const a = win({ lines: [{ spans: [{ text: 'AA' }] }] })
  const b = win({ key: 'b', x: 10, lines: [{ spans: [{ text: 'AB' }] }] })
  const svg = sceneSvg({ columns: 20, rows: 3, windows: [a, b], alt: '' }, [], opts)
  expect(svg.match(/<symbol /g)).toHaveLength(2)
  expect(svg.match(/<use href="#g0"/g)).toHaveLength(3)
})

test('a bar track animates its width through the keys; two keys at one time are a jump', () => {
  const line: Line = { spans: [{ bar: 2000, cells: 4, rgb: GAUGE_RGB }] }
  const track: Track = {
    kind: 'bar',
    window: 'w',
    line: 0,
    span: 0,
    fullRgb: GAUGE_FULL_RGB,
    keys: [
      { at: 0, fill: 2000 },
      { at: 500, fill: 10000 },
      { at: 500, fill: 0 },
      { at: 1000, fill: 5000 },
    ],
  }
  const svg = sceneSvg(
    { columns: 10, rows: 3, windows: [win({ lines: [line] })], alt: '' },
    [track],
    opts,
  )
  expect(svg).toContain('values="6;32;0;16" keyTimes="0;0.5;0.5;1"')
  expect(svg).toContain('#f8d038')
})

test('a cursor track shows ▶ over each interval', () => {
  const line: Line = { spans: [{ cursor: true }, { text: 'A' }] }
  const track: Track = {
    kind: 'cursor',
    window: 'w',
    line: 0,
    span: 0,
    on: [{ from: 100, until: 600 }],
  }
  const svg = sceneSvg(
    { columns: 10, rows: 3, windows: [win({ lines: [line] })], alt: '' },
    [track],
    opts,
  )
  expect(svg).toContain(
    'visibility="hidden"><set attributeName="visibility" to="visible" begin="100ms" end="600ms"/>',
  )
})

test('a lines track shows each frame in turn; typing steps a clip one cell per charMs', () => {
  const frames = [
    { at: 200, lines: [{ spans: [{ text: 'Hit!' }] }], typing: { line: 0, charMs: 18 } },
    { at: 900, lines: [{ spans: [{ text: 'Done' }] }] },
  ]
  const track: Track = { kind: 'lines', window: 'w', frames }
  const svg = sceneSvg({ columns: 10, rows: 3, windows: [win()], alt: '' }, [track], opts)
  expect(svg).toContain('<set attributeName="visibility" to="hidden" begin="200ms"/>')
  expect(svg).toContain('values="0;8;16;24;32" calcMode="discrete" begin="200ms" dur="72ms"')
  expect(svg).toContain('to="visible" begin="900ms"')
})

test('a five-second lines track at 200 characters a frame stays under the strip budget', () => {
  const text = 'Aldric hits Wood Goblin for 12.'
  const frames = Array.from({ length: 50 }, (_, i) => ({
    at: i * 100,
    lines: [
      { spans: [{ cursor: true }, { text: 'Party Loot World' }] },
      { spans: [{ text: `${text}${text}${text}`.slice(0, 100) }] },
      { spans: [{ text: `${text}${text}${text}`.slice(0, 100) }] },
    ],
    typing: { line: 2, charMs: 18 },
  }))
  const big: Scene = { columns: 110, rows: 5, windows: [win({ columns: 110, rows: 5 })], alt: '' }
  const svg = sceneSvg(big, [{ kind: 'lines', window: 'w', frames }], opts)
  expect(svg.length).toBeLessThanOrEqual(STRIP_SVG_MAX_CHARS)
  // Cut from the tail, not dropped whole: the first frames still show.
  expect(svg).toContain('to="visible" begin="100ms"')
})

test('smil false emits no animation at all', () => {
  const line: Line = { spans: [{ bar: 2000, cells: 4, rgb: GAUGE_RGB }] }
  const track: Track = {
    kind: 'bar',
    window: 'w',
    line: 0,
    span: 0,
    fullRgb: GAUGE_FULL_RGB,
    keys: [
      { at: 0, fill: 0 },
      { at: 9, fill: 1 },
    ],
  }
  const svg = sceneSvg(
    { columns: 10, rows: 3, windows: [win({ lines: [line] })], alt: '' },
    [track],
    { smil: false, width: 80 },
  )
  expect(svg).not.toContain('<animate')
  expect(svg).not.toContain('<set')
})

test('a cursor off at render time still lights on its track', () => {
  const line: Line = { spans: [{ cursor: false }, { text: 'A' }] }
  const track: Track = {
    kind: 'cursor',
    window: 'w',
    line: 0,
    span: 0,
    on: [{ from: 500, until: 900 }],
  }
  const svg = sceneSvg(
    { columns: 10, rows: 3, windows: [win({ lines: [line] })], alt: '' },
    [track],
    opts,
  )
  expect(svg).toContain(
    'visibility="hidden"><set attributeName="visibility" to="visible" begin="500ms" end="900ms"/>',
  )
  // Without a track an off cursor draws nothing.
  const still = sceneSvg(
    { columns: 10, rows: 3, windows: [win({ lines: [line] })], alt: '' },
    [],
    opts,
  )
  expect(still).not.toContain('<set')
})

test('a typing frame can start part-way: its clip opens at the cells already shown', () => {
  const frames = [
    { at: 0, lines: [{ spans: [{ text: 'Hit it!' }] }], typing: { line: 0, charMs: 10, from: 3 } },
  ]
  const svg = sceneSvg(
    { columns: 10, rows: 3, windows: [win()], alt: '' },
    [{ kind: 'lines', window: 'w', frames }],
    opts,
  )
  expect(svg).toContain(
    'width="24" height="16"><animate attributeName="width" values="24;32;40;48;56"',
  )
})
