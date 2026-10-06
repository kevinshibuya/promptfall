// The pane's frame (docs/plans/2026-10-06-ui-pr2-pane-windows.md, "Layout"): where the windows
// sit, and the windows every tab shares: the tab window, the message window, a paged list, a
// command or pick window, the Yes/No. Pure: no surface code.
import type { DialogTab, PaneCursor } from '../../../types'
import type { Line, PaneScene, Span, Tile, Win } from '../../windows/kit'
import {
  DETAIL_COLUMNS,
  GAUGE_FULL_RGB,
  MESSAGE_ROWS,
  NARROW_DETAIL_ROWS,
  PANE_MAX_COLUMNS,
  PANE_MIN_COLUMNS,
  PANE_ROWS,
  PANE_WIDE_COLUMNS,
  TEXT_RGB,
  YESNO_COLUMNS,
} from '../../windows/tuning'

export type Rect = { x: number; y: number; columns: number; rows: number }

export type PaneLayout = {
  kind: 'wide' | 'narrow' | 'small'
  columns: number
  rows: number
  /** The tab window's rows: its border and the lines the labels take. */
  tabRows: number
  /** The rows between the tab window and the message window. */
  middle: { y: number; rows: number }
}

/** The tabs, in today's order with today's hotkeys. */
export const TAB_LABELS: readonly { tab: DialogTab; label: string; hotkey: string }[] = [
  { tab: 'inventory', label: 'Inventory', hotkey: 'i' },
  { tab: 'heroes', label: 'Heroes', hotkey: 'h' },
  { tab: 'market', label: 'Market', hotkey: 'm' },
  { tab: 'orders', label: 'Orders', hotkey: 'r' },
  { tab: 'account', label: 'Account', hotkey: 'a' },
  { tab: 'odds', label: 'Odds', hotkey: 'o' },
  { tab: 'chat', label: 'Chat', hotkey: 'c' },
  { tab: 'leaderboards', label: 'Leaderboards', hotkey: 'b' },
]

/** The smallest middle each layout needs: wide, a list beside a detail window; narrow, a band. */
const WIDE_MIDDLE_MIN = 9
const NARROW_MIDDLE_MIN = NARROW_DETAIL_ROWS + 4

/** The tab labels' lines in `inner` cells: a cursor cell, the label, two gap cells each. */
function tabLines(inner: number): DialogTab[][] {
  const lines: DialogTab[][] = [[]]
  let x = 0
  for (const t of TAB_LABELS) {
    const need = 1 + [...t.label].length
    const line = lines.at(-1) as DialogTab[]
    if (line.length > 0 && x + need > inner) {
      lines.push([t.tab])
      x = need + 2
    } else {
      line.push(t.tab)
      x += need + 2
    }
  }
  return lines
}

export function paneLayout(columns: number, rows: number): PaneLayout {
  const W = Math.min(PANE_MAX_COLUMNS, columns)
  const H = Math.min(PANE_ROWS, rows)
  const small: PaneLayout = {
    kind: 'small',
    columns: W,
    rows: MESSAGE_ROWS,
    tabRows: 0,
    middle: { y: 0, rows: 0 },
  }
  if (W < PANE_MIN_COLUMNS) return small
  const tabRows = 2 + tabLines(W - 4).length
  const middle = { y: tabRows, rows: H - MESSAGE_ROWS - tabRows }
  if (W >= PANE_WIDE_COLUMNS) {
    return middle.rows < WIDE_MIDDLE_MIN
      ? small
      : { kind: 'wide', columns: W, rows: H, tabRows, middle }
  }
  return middle.rows < NARROW_MIDDLE_MIN
    ? small
    : { kind: 'narrow', columns: W, rows: H, tabRows, middle }
}

/** A label with its hotkey letter (the first occurrence, ignoring case) drawn gold. */
export function hotkeySpans(label: string, hotkey?: string, rgb: number = TEXT_RGB): Span[] {
  const at = hotkey ? label.toLowerCase().indexOf(hotkey.toLowerCase()) : -1
  if (at < 0) return [{ text: label, rgb }]
  const spans: Span[] = []
  if (at > 0) spans.push({ text: label.slice(0, at), rgb })
  spans.push({ text: label.slice(at, at + 1), rgb: GAUGE_FULL_RGB })
  if (at + 1 < label.length) spans.push({ text: label.slice(at + 1), rgb })
  return spans
}

export function tabWindow(columns: number, tab: DialogTab): Win {
  const lines: Line[] = tabLines(columns - 4).map((tabs) => ({
    spans: [
      { gap: 1 },
      ...tabs.flatMap((t, i): Span[] => {
        const label = TAB_LABELS.find((l) => l.tab === t)
        if (!label) return []
        return [
          ...(i > 0 ? [{ gap: 2 }] : []),
          { cursor: t === tab },
          ...hotkeySpans(label.label, label.hotkey),
        ]
      }),
    ],
  }))
  const current = TAB_LABELS.find((l) => l.tab === tab)?.label ?? tab
  return {
    key: 'tab',
    x: 0,
    y: 0,
    columns,
    rows: 2 + lines.length,
    lines,
    alt: `Tabs: ${TAB_LABELS.map((l) => (l.tab === tab ? `▶ ${l.label}` : l.label)).join(', ')}. On ${current}.`,
  }
}

const altOf = (spans: readonly Span[]) =>
  spans
    .map((s) => ('text' in s ? s.text : 'cursor' in s && s.cursor ? '▶ ' : ''))
    .join('')
    .trim()

export function messageWindow(layout: PaneLayout, first: Span[], second: Span[]): Win {
  return {
    key: 'message',
    x: 0,
    y: layout.rows - MESSAGE_ROWS,
    columns: layout.columns,
    rows: MESSAGE_ROWS,
    lines: [{ spans: [{ gap: 1 }, ...first] }, { spans: [{ gap: 1 }, ...second] }],
    alt: [altOf(first), altOf(second)].filter(Boolean).join(' '),
  }
}

/** The first row of the page holding `index`, `shown` rows to a page. */
export function page(index: number, shown: number): number {
  if (shown <= 0) return 0
  return Math.floor(Math.max(0, index) / shown) * shown
}

/** The page footer while rows are hidden: `16-30/40`, with `▼` while a later page exists. */
function pageFooter(start: number, shown: number, total: number): Span[] | undefined {
  if (total <= shown) return undefined
  const end = Math.min(total, start + shown)
  const spans: Span[] = [{ text: `${start + 1}-${end}/${total}` }]
  if (end < total) spans.push({ text: '▼' })
  return spans
}

/**
 * A list window: each line gets the ▶ cell and a gap in front; the page holding `cursor` shows,
 * with its footer. `cursor` -1 shows no ▶.
 */
export function listWindow(opts: {
  key: string
  x: number
  y: number
  columns: number
  rows: number
  title: Span[]
  lines: Line[]
  cursor: number
  alt: string
}): Win {
  const shown = Math.max(1, opts.rows - 2)
  const start = page(opts.cursor, shown)
  const lines = opts.lines.slice(start, start + shown).map((line, i) => ({
    ...line,
    spans: [{ cursor: start + i === opts.cursor }, { gap: 1 }, ...line.spans],
  }))
  const footer = pageFooter(start, shown, opts.lines.length)
  return {
    key: opts.key,
    x: opts.x,
    y: opts.y,
    columns: opts.columns,
    rows: opts.rows,
    title: opts.title,
    ...(footer ? { footer } : {}),
    lines,
    alt: opts.alt,
  }
}

export type MenuItem = { label: string; hotkey?: string; rgb?: number }

/** A command or pick window: a header line with a rule, then the items, paged by `at`. */
export function menuWindow(opts: {
  key: string
  x: number
  y: number
  columns: number
  rows: number
  header: Span[]
  items: readonly MenuItem[]
  at: number
}): Win {
  const shown = Math.max(1, opts.rows - 3)
  const start = page(opts.at, shown)
  const lines: Line[] = [
    { spans: [{ gap: 1 }, ...opts.header], rule: true },
    ...opts.items.slice(start, start + shown).map((item, i) => ({
      spans: [{ cursor: start + i === opts.at }, ...hotkeySpans(item.label, item.hotkey, item.rgb)],
    })),
  ]
  const footer = pageFooter(start, shown, opts.items.length)
  const chosen = opts.items[opts.at]?.label
  return {
    key: opts.key,
    x: opts.x,
    y: opts.y,
    columns: opts.columns,
    rows: opts.rows,
    ...(footer ? { footer } : {}),
    lines,
    alt: `${altOf(opts.header)}: ${opts.items.map((i) => (i.label === chosen ? `▶ ${i.label}` : i.label)).join(', ')}`,
  }
}

export function yesNoWindow(x: number, y: number, at: number): Win {
  return {
    key: 'yesno',
    x,
    y,
    columns: YESNO_COLUMNS,
    rows: 4,
    lines: [
      { spans: [{ gap: 1 }, { cursor: at === 0 }, ...hotkeySpans('Yes', 'y')] },
      { spans: [{ gap: 1 }, { cursor: at === 1 }, ...hotkeySpans('No', 'n')] },
    ],
    alt: at === 0 ? '▶ Yes, No' : 'Yes, ▶ No',
  }
}

/** What sits beside or under the list: nothing extra, a command, pick or sell window of `items`, or the Yes/No. */
export type Sub = { kind: 'none' } | { kind: 'menu'; items: number } | { kind: 'yesno' }

export type Slots = {
  list: Rect
  /** Absent when a sell window takes the whole column (`menu` then holds it). */
  detail?: Rect
  menu?: Rect
  yesNo?: Rect
}

/**
 * Where the list, the detail window and a sub-window go. A sell window is a `menu` with
 * `wholeColumn`: it replaces the detail window in the wide layout.
 */
export function paneSlots(layout: PaneLayout, sub: Sub, wholeColumn = false): Slots {
  const { columns: W, middle } = layout
  const M = middle.rows
  const y = middle.y
  if (layout.kind === 'wide') {
    const list = { x: 0, y, columns: W - DETAIL_COLUMNS, rows: M }
    const x = W - DETAIL_COLUMNS
    if (sub.kind === 'menu' && wholeColumn)
      return { list, menu: { x, y, columns: DETAIL_COLUMNS, rows: M } }
    if (sub.kind === 'menu') {
      const rows = Math.min(3 + sub.items, M - 3)
      return {
        list,
        detail: { x, y, columns: DETAIL_COLUMNS, rows: M - rows },
        menu: { x, y: y + M - rows, columns: DETAIL_COLUMNS, rows },
      }
    }
    if (sub.kind === 'yesno') {
      return {
        list,
        detail: { x, y, columns: DETAIL_COLUMNS, rows: M - 4 },
        yesNo: { x: W - YESNO_COLUMNS, y: y + M - 4, columns: YESNO_COLUMNS, rows: 4 },
      }
    }
    return { list, detail: { x, y, columns: DETAIL_COLUMNS, rows: M } }
  }
  const band =
    sub.kind === 'menu'
      ? Math.max(NARROW_DETAIL_ROWS, Math.min(3 + sub.items, M - 4))
      : NARROW_DETAIL_ROWS
  const list = { x: 0, y, columns: W, rows: M - band }
  const by = y + M - band
  if (sub.kind === 'menu') return { list, menu: { x: 0, y: by, columns: W, rows: band } }
  if (sub.kind === 'yesno') {
    return {
      list,
      detail: { x: 0, y: by, columns: W - YESNO_COLUMNS, rows: band },
      yesNo: { x: W - YESNO_COLUMNS, y: by, columns: YESNO_COLUMNS, rows: 4 },
    }
  }
  return { list, detail: { x: 0, y: by, columns: W, rows: band } }
}

/**
 * The scene and its tile tree. `right` is the detail column (wide) or the band (narrow), top to
 * bottom; the Yes/No sits at the column's foot, right-aligned (wide), or at the band's right end
 * (narrow).
 */
export function assemble(
  layout: PaneLayout,
  parts: { tab?: Win; list?: Win; right?: Win[]; yesNo?: Win; message: Win },
): PaneScene {
  const windows: Win[] = []
  const tile = (w: Win | undefined): Tile[] => {
    if (!w) return []
    windows.push(w)
    return [{ win: w.key }]
  }
  const top = tile(parts.tab)
  let middle: Tile[] = []
  if (parts.list) {
    const list = tile(parts.list)
    const right: Tile[] = (parts.right ?? []).flatMap(tile)
    if (layout.kind === 'wide') {
      if (parts.yesNo) {
        right.push({
          row: [
            { gap: { columns: DETAIL_COLUMNS - YESNO_COLUMNS, rows: 4 } },
            ...tile(parts.yesNo),
          ],
        })
      }
      middle = [{ row: [...list, { column: right }] }]
    } else if (parts.yesNo) {
      const band = (parts.right ?? [])[0]?.rows ?? NARROW_DETAIL_ROWS
      middle = [
        ...list,
        {
          row: [
            ...right,
            {
              column: [
                ...tile(parts.yesNo),
                ...(band > 4 ? [{ gap: { columns: YESNO_COLUMNS, rows: band - 4 } }] : []),
              ],
            },
          ],
        },
      ]
    } else {
      middle = [...list, ...right]
    }
  }
  const bottom = tile(parts.message)
  return {
    columns: layout.columns,
    rows: layout.rows,
    windows,
    alt: windows.map((w) => w.alt).join(' '),
    tiles: { column: [...top, ...middle, ...bottom] },
  }
}

/** The ▶ row of a list: the id's row if it is still there, else the stored index clamped. */
export function cursorRow(cursor: PaneCursor | null, ids: readonly string[]): number {
  if (ids.length === 0) return -1
  if (!cursor) return 0
  const at = ids.indexOf(cursor.id)
  if (at >= 0) return at
  return Math.max(0, Math.min(ids.length - 1, cursor.index))
}
