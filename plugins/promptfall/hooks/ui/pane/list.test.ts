import { expect, test } from 'claude-code/testing'
import { tilePositions, type Win } from '../../windows/kit'
import { paneInput } from './fixtures'
import { type ListRow, type ListSpec, listPane, type PanelBuild } from './list'
import { linesOf, textOf, win } from './testing'
import type { PaneAction } from './types'

const NONE: PaneAction = { t: 'none' }
const heading = (text: string): ListRow => ({ spans: [{ text }], rule: true, alt: text })
const row = (id: string, hotkey?: string): ListRow => ({
  key: `row:${id}`,
  ...(hotkey ? { hotkey } : {}),
  spans: [{ text: id }],
  action: { t: 'open', menu: { kind: 'filter', at: 0 } },
  alt: id,
})
const note = (text: string): ListRow => ({ spans: [{ text }], alt: text })

function spec(patch: Partial<ListSpec> = {}): ListSpec {
  return {
    title: [{ text: 'List' }],
    altTitle: 'List',
    rows: [],
    empty: 'Nothing.',
    cursor: 0,
    detail: null,
    menu: null,
    yesNo: null,
    panel: null,
    error: null,
    state: ['first', 'second'],
    field: null,
    link: null,
    ...patch,
  }
}
const cursorStops = (b: ReturnType<typeof listPane>) => b.stops.filter((s) => s.cursor)

test('headings take no stop and carry the divider; the rows with a key are the stops in order', () => {
  const b = listPane(
    paneInput(),
    spec({ rows: [heading('Mine'), row('a', 'f'), row('b'), heading('Theirs'), row('c')] }),
  )
  expect(cursorStops(b).map((s) => [s.key, s.index])).toEqual([
    ['row:a', 0],
    ['row:b', 1],
    ['row:c', 2],
  ])
  expect(cursorStops(b)[0]?.hotkey).toBe('f')
  const list = win(b, 'list')
  expect(list?.lines.map((l) => l.rule === true)).toEqual([true, false, false, true, false])
  // The ▶ sits on the first stop's line, not the heading's.
  expect(linesOf(list).slice(0, 2)).toEqual(['  Mine', '▶ a'])
  expect(b.focus).toBe('row:a')
})

test("the ▶ row's line sets the page: the stop at line 18 of 20 shows lines 15 to 19", () => {
  const rows = [heading('top'), ...Array.from({ length: 19 }, (_, i) => row(`r${i + 1}`))]
  // Line 18 is stop 17.
  const b = listPane(paneInput(), spec({ rows, cursor: 17 }))
  const lines = linesOf(win(b, 'list'))
  expect(lines.length).toBe(5)
  expect(lines[0]).toBe('  r15')
  expect(lines[3]).toBe('▶ r18')
  expect(textOf(win(b, 'list')?.footer ?? [])).toBe('16-20/20')
})

test('fromEnd cuts the pages from the last line back', () => {
  const rows = Array.from({ length: 31 }, (_, i) => row(`m${i}`))
  const newest = listPane(paneInput(), spec({ rows, cursor: 30, fromEnd: true }))
  const shown = linesOf(win(newest, 'list'))
  expect(shown.length).toBe(15)
  expect([shown[0], shown[14]]).toEqual(['  m16', '▶ m30'])
  const back = linesOf(
    win(listPane(paneInput(), spec({ rows, cursor: 10, fromEnd: true })), 'list'),
  )
  expect([back[0], back[14]]).toEqual(['  m1', '  m15'])
})

test('a list of only keyless lines mounts one row:empty stop carrying emptyAction', () => {
  const field: PaneAction = { t: 'field', key: 'compose' }
  const b = listPane(paneInput(), spec({ rows: [note('Closed.')], cursor: -1, emptyAction: field }))
  expect(cursorStops(b)).toEqual([{ key: 'row:empty', action: field, cursor: true, index: 0 }])
  expect(b.focus).toBe('row:empty')
  const none = listPane(paneInput(), spec({ cursor: -1 }))
  expect(cursorStops(none)).toEqual([{ key: 'row:empty', action: NONE, cursor: true, index: 0 }])
  expect(linesOf(win(none, 'list'))).toEqual(['  Nothing.'])
})

const panel =
  (at = 1) =>
  (rect: { x: number; y: number; columns: number; rows: number }): PanelBuild => {
    const w: Win = {
      key: 'form',
      ...rect,
      lines: [
        { spans: [{ text: 'Form' }], rule: true },
        { spans: [{ text: 'a' }] },
        { spans: [{ text: 'b' }] },
      ],
      alt: 'form',
    }
    return {
      win: w,
      stops: [
        { key: 'menu:0', action: NONE, cursor: true, index: 0 },
        { key: 'menu:1', action: { t: 'place' }, cursor: true, index: 1 },
      ],
      at,
      state: ['panel state', 'q: back.'],
      field: {
        key: 'order-price',
        label: 'max price',
        placeholder: 'gold',
        value: '',
        submitLabel: 'place',
      },
    }
  }

test('a panel replaces the detail window, its stops the rows, its state and field the spec’s', () => {
  const b = listPane(
    paneInput(),
    spec({ rows: [row('a'), row('b')], detail: () => [], panel: panel() }),
  )
  expect(win(b, 'detail')).toBeUndefined()
  expect([win(b, 'form')?.x, win(b, 'form')?.columns, win(b, 'form')?.rows]).toEqual([80, 40, 17])
  expect(cursorStops(b).map((s) => s.key)).toEqual(['menu:0', 'menu:1'])
  expect(b.focus).toBe('menu:1')
  expect(b.field?.key).toBe('order-price')
  expect(textOf(win(b, 'message')?.lines[0]?.spans ?? [])).toBe(' panel state')
})

test('a wholeColumn menu takes the panel’s slot', () => {
  const items = [
    { label: 'any', action: NONE },
    { label: 'rare', action: NONE },
  ]
  const b = listPane(
    paneInput(),
    spec({
      rows: [row('a')],
      panel: panel(),
      menu: { header: [{ text: 'Rarity' }], items, at: 1, wholeColumn: true },
    }),
  )
  expect(win(b, 'form')).toBeUndefined()
  const menu = win(b, 'menu')
  expect([menu?.x, menu?.y, menu?.columns, menu?.rows]).toEqual([80, 3, 40, 17])
  expect(b.focus).toBe('menu:1')
  expect(b.field).toBeNull()
  for (const w of b.scene.windows)
    expect(tilePositions(b.scene).get(w.key)).toEqual({ x: w.x, y: w.y ?? 0 })
})

test('a short pane draws no tab window but keeps the tab stops for their hotkeys', () => {
  const b = listPane(paneInput({ rows: 14 }), spec({ rows: [row('a')] }))
  expect(win(b, 'tab')).toBeUndefined()
  expect(win(b, 'list')?.y).toBe(0)
  expect(b.stops.filter((s) => s.key.startsWith('tab-')).length).toBe(9)
  for (const w of b.scene.windows)
    expect(tilePositions(b.scene).get(w.key)).toEqual({ x: w.x, y: w.y ?? 0 })
})
