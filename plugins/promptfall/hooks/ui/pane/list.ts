// What the Inventory and Heroes panes share: a list window with a detail window beside or under
// it, a command, pick or Yes/No window over it, or the sell window in its place; the tab and
// message windows; and the ring stops in order (tabs, the cursor stops, back, claim).
import type { Line, Span, Win } from '../../windows/kit'
import {
  assemble,
  listWindow,
  type MenuItem,
  menuWindow,
  messageWindow,
  paneLayout,
  paneSlots,
  type Rect,
  type Sub,
  TAB_LABELS,
  tabWindow,
  yesNoWindow,
} from './frame'
import { messageLines, type PaneInput } from './input'
import { sellWindow } from './sell'
import type { PaneAction, PaneBuild, Stop } from './types'

export type ListRow = {
  /** The row stop's key: `row:<id>`. */
  key: string
  spans: Span[]
  action: PaneAction
  /** The row as a screen reader reads it. */
  alt: string
}

export type ListSpec = {
  title: Span[]
  /** How the list's alt opens: `Inventory 3 of 20`. */
  altTitle: string
  rows: readonly ListRow[]
  /** The line drawn when there are no rows; it takes no stop. */
  empty: string
  /** The ▶ row; -1 when there are no rows. */
  cursor: number
  /** The detail window's lines for an inner width, its header line first; null draws none. */
  detail: ((inner: number) => Line[]) | null
  /** An open command or pick window: its items carry their actions. */
  menu: { header: Span[]; items: readonly (MenuItem & { action: PaneAction })[]; at: number } | null
  /** An open Yes/No: Yes runs `yes`, No goes back. */
  yesNo: { at: number; yes: PaneAction } | null
  /** The message window's lines when rules 1 to 4 do not apply. */
  state: [string, string]
}

function tabStops(): Stop[] {
  return TAB_LABELS.map((t) => ({
    key: `tab-${t.tab}`,
    hotkey: t.hotkey,
    action: { t: 'tab', tab: t.tab },
    cursor: false,
  }))
}

function tailStops(input: PaneInput): Stop[] {
  const stops: Stop[] = [{ key: 'back', hotkey: 'q', action: { t: 'back' }, cursor: false }]
  if (input.readOnly && input.mode === 'secondary')
    stops.push({ key: 'claim', hotkey: 'p', action: { t: 'claim' }, cursor: false })
  return stops
}

export function listPane(input: PaneInput, spec: ListSpec): PaneBuild {
  const layout = paneLayout(input.columns, input.rows)
  if (layout.kind === 'small') {
    const [first, second] = messageLines(input, spec.state)
    return {
      scene: assemble(layout, { message: messageWindow(layout, first, second) }),
      stops: tabStops(),
      focus: null,
      priceInput: false,
    }
  }
  const sell = !input.readOnly && input.dialog.sell ? input.dialog.sell : null
  let sub: Sub = { kind: 'none' }
  let sellRows = 0
  if (sell) {
    // A dry run on a tall rect counts the sell window's rows for the narrow band's height.
    const probe = sellWindow(input, { x: 0, y: 0, columns: layout.columns, rows: 1000 })
    sellRows = probe.win.lines.length - 1
    sub = { kind: 'menu', items: sellRows }
  } else if (spec.yesNo) sub = { kind: 'yesno' }
  else if (spec.menu) sub = { kind: 'menu', items: spec.menu.items.length }
  const slots = paneSlots(layout, sub, sell !== null)

  const list = listWindow({
    key: 'list',
    ...slots.list,
    title: spec.title,
    lines:
      spec.rows.length > 0
        ? spec.rows.map((r) => ({ spans: r.spans }))
        : [{ spans: [{ text: spec.empty }] }],
    cursor: spec.cursor,
    alt: `${spec.altTitle}: ${
      spec.rows.length > 0
        ? spec.rows.map((r, i) => (i === spec.cursor ? `▶ ${r.alt}` : r.alt)).join('; ')
        : spec.empty
    }`,
  })

  const right = []
  let cursorStops: Stop[] = spec.rows.map((r, i) => ({
    key: r.key,
    action: r.action,
    cursor: true,
    index: i,
  }))
  let focus: string | null = spec.rows[spec.cursor]?.key ?? null
  let state = spec.state
  let priceInput = false
  let yesNo: Win | undefined

  const detail = (rect: Rect) => {
    const lines = spec.detail ? spec.detail(rect.columns - 2) : []
    return {
      key: 'detail',
      ...rect,
      lines,
      alt: lines
        .map((l) => l.spans.map((s) => ('text' in s ? s.text : '')).join(''))
        .filter((t) => t.trim())
        .join('. '),
    }
  }
  if (slots.detail && spec.detail) right.push(detail(slots.detail))
  else if (slots.detail) right.push({ key: 'detail', ...slots.detail, lines: [], alt: '' })

  if (sell && slots.menu) {
    const built = sellWindow(input, slots.menu)
    right.push(built.win)
    cursorStops = built.stops
    focus = built.stops.length > 0 ? `menu:${Math.min(sell.at, built.stops.length - 1)}` : null
    state = built.state
    priceInput = built.priceInput
  } else if (spec.yesNo && slots.yesNo) {
    yesNo = yesNoWindow(slots.yesNo.x, slots.yesNo.y, spec.yesNo.at)
    cursorStops = [
      { key: 'yes', hotkey: 'y', action: spec.yesNo.yes, cursor: true, index: 0 },
      { key: 'no', hotkey: 'n', action: { t: 'back' }, cursor: true, index: 1 },
    ]
    focus = spec.yesNo.at === 1 ? 'no' : 'yes'
  } else if (spec.menu && slots.menu) {
    const at = Math.max(0, Math.min(spec.menu.items.length - 1, spec.menu.at))
    right.push(
      menuWindow({
        key: 'menu',
        ...slots.menu,
        header: spec.menu.header,
        items: spec.menu.items,
        at,
      }),
    )
    cursorStops = spec.menu.items.map((item, i) => ({
      key: `menu:${i}`,
      ...(item.hotkey ? { hotkey: item.hotkey } : {}),
      action: item.action,
      cursor: true,
      index: i,
    }))
    focus = spec.menu.items.length > 0 ? `menu:${at}` : null
  }

  const [first, second] = messageLines(input, state)
  const scene = assemble(layout, {
    tab: tabWindow(layout.columns, input.tab),
    list,
    right,
    ...(yesNo ? { yesNo } : {}),
    message: messageWindow(layout, first, second),
  })
  return {
    scene,
    stops: [...tabStops(), ...cursorStops, ...tailStops(input)],
    focus,
    priceInput,
  }
}
