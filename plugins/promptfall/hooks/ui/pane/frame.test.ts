import { expect, test } from 'claude-code/testing'
import type { Span, Win } from '../../windows/kit'
import { tilePositions } from '../../windows/kit'
import { DOWN_RGB, GAUGE_FULL_RGB, TEXT_RGB, WARN_RGB } from '../../windows/tuning'
import { paneInput } from './fixtures'
import {
  assemble,
  cursorRow,
  hotkeySpans,
  listWindow,
  menuWindow,
  messageWindow,
  type PaneLayout,
  page,
  paneLayout,
  paneSlots,
  type Rect,
  type Sub,
  tabWindow,
  yesNoWindow,
} from './frame'
import { messageLines } from './input'

const blank = (key: string, r: Rect): Win => ({ key, ...r, lines: [], alt: key })
const textOf = (spans: readonly Span[]) => spans.map((s) => ('text' in s ? s.text : '')).join('')

test('120 × 24 is wide: a 3-row tab window and a 17-row middle', () => {
  const l = paneLayout(120, 24)
  expect(l.kind).toBe('wide')
  expect(l.tabRows).toBe(3)
  expect(l.middle).toEqual({ y: 3, rows: 17 })
  expect(tabWindow(120, 'inventory').rows).toBe(3)
})

test('60 × 24 is narrow; wider bodies and taller panes clamp to 120 × 24', () => {
  expect(paneLayout(60, 24).kind).toBe('narrow')
  expect(paneLayout(200, 40)).toEqual(paneLayout(120, 24))
})

test('at 40 columns the tab labels take 3 lines', () => {
  expect(paneLayout(40, 24).tabRows).toBe(5)
  const lines = tabWindow(40, 'heroes').lines.map((l) => textOf(l.spans))
  expect(lines).toEqual(['InventoryHeroesMarket', 'OrdersAccountOddsChat', 'Leaderboards'])
})

test('under 40 columns, or a middle under the floors, is too small', () => {
  expect(paneLayout(39, 24).kind).toBe('small')
  // Wide needs a 9-row middle: 3 tab rows + 8 + 4 message rows is one short.
  expect(paneLayout(120, 15).kind).toBe('small')
  expect(paneLayout(120, 16).kind).toBe('wide')
  // Narrow needs 10.
  const tabRows = paneLayout(60, 24).tabRows
  expect(paneLayout(60, tabRows + 4 + 9).kind).toBe('small')
  expect(paneLayout(60, tabRows + 4 + 10).kind).toBe('narrow')
})

test('the hotkey letter is drawn gold at its first occurrence, ignoring case', () => {
  expect(hotkeySpans('Leaderboards', 'b')).toEqual([
    { text: 'Leader', rgb: TEXT_RGB },
    { text: 'b', rgb: GAUGE_FULL_RGB },
    { text: 'oards', rgb: TEXT_RGB },
  ])
  expect(hotkeySpans('Orders', 'r')[1]).toEqual({ text: 'r', rgb: GAUGE_FULL_RGB })
  expect(hotkeySpans('Account', 'a')[0]).toEqual({ text: 'A', rgb: GAUGE_FULL_RGB })
  expect(hotkeySpans('Odds', 'x')).toEqual([{ text: 'Odds', rgb: TEXT_RGB }])
})

test('the tab window puts ▶ on the current tab', () => {
  const spans = tabWindow(120, 'market').lines[0]?.spans ?? []
  const cursors = spans.filter((s) => 'cursor' in s)
  expect(cursors.length).toBe(8)
  expect(cursors.map((s) => 'cursor' in s && s.cursor)).toEqual([
    false,
    false,
    true,
    false,
    false,
    false,
    false,
    false,
  ])
})

test('page: the first row of the page holding the index', () => {
  expect([page(0, 15), page(14, 15), page(15, 15), page(39, 15)]).toEqual([0, 0, 15, 30])
})

test('a list pages by its cursor, with the footer and ▼ while a later page exists', () => {
  const lines = Array.from({ length: 40 }, (_, i) => ({ spans: [{ text: `row ${i}` }] }))
  const opts = { key: 'list', x: 0, y: 3, columns: 80, rows: 17, title: [], lines, alt: '' }
  const second = listWindow({ ...opts, cursor: 20 })
  expect(second.lines.length).toBe(15)
  expect(textOf(second.lines[0]?.spans ?? [])).toBe('row 15')
  expect(textOf(second.footer ?? [])).toBe('16-30/40▼')
  expect(second.lines[5]?.spans[0]).toEqual({ cursor: true })
  const last = listWindow({ ...opts, cursor: 39 })
  expect(textOf(last.footer ?? [])).toBe('31-40/40')
  expect(listWindow({ ...opts, lines: lines.slice(0, 15), cursor: 0 }).footer).toBeUndefined()
})

test('a 20-item menu pages by at', () => {
  const items = Array.from({ length: 20 }, (_, i) => ({ label: `item ${i}` }))
  const w = menuWindow({ key: 'm', x: 0, y: 0, columns: 40, rows: 10, header: [], items, at: 9 })
  // 7 items a page: the header line, then items 7 to 13.
  expect(w.lines.length).toBe(8)
  expect(textOf(w.lines[1]?.spans ?? [])).toBe('item 7')
  expect(w.lines[3]?.spans[0]).toEqual({ cursor: true })
  expect(textOf(w.footer ?? [])).toBe('8-14/20▼')
})

test('a command window of 12 items in a 17-row middle is 14 rows and leaves the detail 3', () => {
  const s = paneSlots(paneLayout(120, 24), { kind: 'menu', items: 12 })
  expect(s.menu?.rows).toBe(14)
  expect(s.detail?.rows).toBe(3)
})

function scene(layout: PaneLayout, sub: Sub, wholeColumn = false) {
  const s = paneSlots(layout, sub, wholeColumn)
  const right = [
    ...(s.detail ? [blank('detail', s.detail)] : []),
    ...(s.menu ? [blank('menu', s.menu)] : []),
  ]
  return assemble(layout, {
    tab: tabWindow(layout.columns, 'inventory'),
    list: blank('list', s.list),
    right,
    ...(s.yesNo ? { yesNo: yesNoWindow(s.yesNo.x, s.yesNo.y, 0) } : {}),
    message: messageWindow(layout, [], []),
  })
}

test('assemble: the tile tree agrees with every window for wide and narrow, every sub', () => {
  const subs: [Sub, boolean][] = [
    [{ kind: 'none' }, false],
    [{ kind: 'menu', items: 5 }, false],
    [{ kind: 'menu', items: 12 }, true],
    [{ kind: 'yesno' }, false],
  ]
  for (const layout of [paneLayout(120, 24), paneLayout(60, 24), paneLayout(96, 20)]) {
    for (const [sub, whole] of subs) {
      const sc = scene(layout, sub, whole)
      const at = tilePositions(sc)
      for (const w of sc.windows)
        expect([w.key, at.get(w.key)]).toEqual([w.key, { x: w.x, y: w.y ?? 0 }])
      // Every window inside the picture, the message at its foot.
      for (const w of sc.windows) {
        expect(w.x + w.columns).toBeLessThanOrEqual(sc.columns)
        expect((w.y ?? 0) + w.rows).toBeLessThanOrEqual(sc.rows)
      }
    }
  }
})

test('cursorRow: the id, else the stored index clamped, else the top', () => {
  expect(cursorRow({ id: 'b', index: 0 }, ['a', 'b', 'c'])).toBe(1)
  expect(cursorRow({ id: 'gone', index: 2 }, ['a', 'b'])).toBe(1)
  expect(cursorRow(null, ['a'])).toBe(0)
  expect(cursorRow(null, [])).toBe(-1)
})

test('messageLines: too small, read-only secondary, a refusal', () => {
  const state: [string, string] = ['Enter: actions.', 'second']
  const small = messageLines(paneInput({ columns: 36 }), state)
  expect([textOf(small[0]), textOf(small[1])]).toEqual([
    'The pane needs more room.',
    'Widen it or give it more rows.',
  ])
  const ro = messageLines(paneInput({ readOnly: true, mode: 'secondary' }), state)
  expect(ro[0]).toEqual([
    { text: 'Playing in another session: this view is read-only.', rgb: WARN_RGB },
  ])
  expect(textOf(ro[1])).toBe('p: play here.')
  const dialog = { ...paneInput().dialog, paneNotice: 'not_enough_gold' }
  const refused = messageLines(paneInput({ dialog }), state)
  expect(refused[0]).toEqual([{ text: 'Refused: not_enough_gold', rgb: DOWN_RGB }])
  expect(textOf(refused[1])).toBe('second')
})
