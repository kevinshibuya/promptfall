// What every tab's pane shares: a list window with a detail window beside or under it, a command,
// pick or Yes/No window over it, or a panel (the sell window, the order form) in its place; the
// tab and message windows; and the ring stops in order (tabs, the cursor stops, back, claim).
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
import { type FrameInput, type MessageLine, messageLines } from './input'
import type { PaneAction, PaneBuild, PaneField, Stop } from './types'

export type ListRow = {
  /** `row:<id>`; absent for a line that takes no stop (a heading, a note). */
  key?: string
  hotkey?: string
  spans: Span[]
  /** Present exactly when `key` is. */
  action?: PaneAction
  /** A heading: DQ's divider under the line. */
  rule?: true
  /** The row as a screen reader reads it. */
  alt: string
}

/** A window in the detail window's place: the sell window, the order form. */
export type PanelBuild = {
  win: Win
  /** `menu:<i>` per item. */
  stops: Stop[]
  /** The panel's ▶ item; -1 with none. */
  at: number
  state: [MessageLine, MessageLine]
  field: PaneField | null
}

export type ListSpec = {
  title: Span[]
  /** How the list's alt opens: `Inventory 3 of 20`. */
  altTitle: string
  rows: readonly ListRow[]
  /** The line drawn when there are no rows. */
  empty: string
  /** The ▶ as a stop position among the rows with a key; -1 with none. */
  cursor: number
  /** The detail window's lines for an inner width, its header line first; null draws none. */
  detail: ((inner: number) => Line[]) | null
  /** An open command or pick window: its items carry their actions. */
  menu: {
    header: Span[]
    items: readonly (MenuItem & { action: PaneAction })[]
    at: number
    /** A pick over a panel: takes the panel's slot. */
    wholeColumn?: true
  } | null
  /** An open Yes/No: Yes runs `yes`, No goes back. */
  yesNo: { at: number; yes: PaneAction } | null
  /** A window in the detail window's place; `build` is called with its slot. */
  panel: ((at: Rect) => PanelBuild) | null
  /** Rule 4's text: the tab's error. */
  error: string | null
  /** The message window's lines when rules 1 to 4 do not apply. */
  state: [MessageLine, MessageLine]
  /** Pages cut from the last line back (Chat). */
  fromEnd?: true
  /** The `row:empty` stop's action when no row has a key; `none` when absent. */
  emptyAction?: PaneAction
  /** The field when no panel brings one (Chat's compose), else null. */
  field: PaneField | null
  link: { url: string } | null
}

function tabStops(): Stop[] {
  return TAB_LABELS.map((t) => ({
    key: `tab-${t.tab}`,
    hotkey: t.hotkey,
    action: { t: 'tab', tab: t.tab },
    cursor: false,
  }))
}

function tailStops(input: FrameInput): Stop[] {
  const stops: Stop[] = [{ key: 'back', hotkey: 'q', action: { t: 'back' }, cursor: false }]
  if (input.readOnly && input.mode === 'secondary')
    stops.push({ key: 'claim', hotkey: 'p', action: { t: 'claim' }, cursor: false })
  return stops
}

export function listPane(input: FrameInput, spec: ListSpec): PaneBuild {
  const layout = paneLayout(input.columns, input.rows)
  if (layout.kind === 'small') {
    const [first, second] = messageLines(input, spec.error, spec.state)
    return {
      scene: assemble(layout, { message: messageWindow(layout, first, second) }),
      stops: tabStops(),
      focus: null,
      field: null,
      link: null,
    }
  }
  const whole = spec.menu?.wholeColumn === true
  const panel = !whole && spec.panel ? spec.panel : null
  let sub: Sub = { kind: 'none' }
  if (panel) {
    // A dry run on a tall rect counts the panel's rows for the narrow band's height.
    const probe = panel({ x: 0, y: 0, columns: layout.columns, rows: 1000 })
    sub = { kind: 'menu', items: probe.win.lines.length - 1 }
  } else if (spec.menu && whole) sub = { kind: 'menu', items: spec.menu.items.length }
  else if (spec.yesNo) sub = { kind: 'yesno' }
  else if (spec.menu) sub = { kind: 'menu', items: spec.menu.items.length }
  const slots = paneSlots(layout, sub, panel !== null || whole)

  // The rows with a key are the stops; with none, the first line is a stop that does nothing.
  const keyed = spec.rows.flatMap((r, line) => (r.key ? [{ row: r, line }] : []))
  const at = keyed.length === 0 ? -1 : Math.max(0, Math.min(keyed.length - 1, spec.cursor))
  const cursorLine = keyed[at]?.line ?? -1
  let cursorStops: Stop[] =
    keyed.length === 0
      ? [{ key: 'row:empty', action: spec.emptyAction ?? { t: 'none' }, cursor: true, index: 0 }]
      : keyed.map((k, i) => ({
          key: k.row.key as string,
          ...(k.row.hotkey ? { hotkey: k.row.hotkey } : {}),
          action: k.row.action ?? { t: 'none' },
          cursor: true,
          index: i,
        }))
  let focus: string | null = keyed[at]?.row.key ?? 'row:empty'

  const list = listWindow({
    key: 'list',
    ...slots.list,
    title: spec.title,
    lines:
      spec.rows.length > 0
        ? spec.rows.map((r) => ({ spans: r.spans, ...(r.rule ? { rule: true } : {}) }))
        : [{ spans: [{ text: spec.empty }] }],
    cursor: cursorLine,
    ...(spec.fromEnd ? { fromEnd: true } : {}),
    alt: `${spec.altTitle}: ${
      spec.rows.length > 0
        ? spec.rows.map((r, i) => (i === cursorLine ? `▶ ${r.alt}` : r.alt)).join('; ')
        : spec.empty
    }`,
  })

  const right = []
  let state = spec.state
  let field = spec.field
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

  if (panel && slots.menu) {
    const built = panel(slots.menu)
    right.push(built.win)
    cursorStops = built.stops
    focus = built.at >= 0 && built.stops.length > 0 ? `menu:${built.at}` : null
    state = built.state
    field = built.field
  } else if (spec.yesNo && slots.yesNo && !whole) {
    yesNo = yesNoWindow(slots.yesNo.x, slots.yesNo.y, spec.yesNo.at)
    cursorStops = [
      { key: 'yes', hotkey: 'y', action: spec.yesNo.yes, cursor: true, index: 0 },
      { key: 'no', hotkey: 'n', action: { t: 'back' }, cursor: true, index: 1 },
    ]
    focus = spec.yesNo.at === 1 ? 'no' : 'yes'
  } else if (spec.menu && slots.menu) {
    const menuAt = Math.max(0, Math.min(spec.menu.items.length - 1, spec.menu.at))
    right.push(
      menuWindow({
        key: 'menu',
        ...slots.menu,
        header: spec.menu.header,
        items: spec.menu.items,
        at: menuAt,
      }),
    )
    cursorStops = spec.menu.items.map((item, i) => ({
      key: `menu:${i}`,
      ...(item.hotkey ? { hotkey: item.hotkey } : {}),
      action: item.action,
      cursor: true,
      index: i,
    }))
    focus = spec.menu.items.length > 0 ? `menu:${menuAt}` : null
  }

  const [first, second] = messageLines(input, spec.error, state)
  const scene = assemble(layout, {
    ...(layout.tabRows > 0 ? { tab: tabWindow(layout.columns, input.tab) } : {}),
    list,
    right,
    ...(yesNo ? { yesNo } : {}),
    message: messageWindow(layout, first, second),
  })
  return {
    scene,
    stops: [...tabStops(), ...cursorStops, ...tailStops(input)],
    focus,
    field,
    link: spec.link,
  }
}
