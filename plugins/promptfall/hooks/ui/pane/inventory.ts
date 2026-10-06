// The Inventory tab as windows (docs/plans/2026-10-06-ui-pr2-pane-windows.md, "Window contents"):
// the item list, the item's detail, its command window, the equip and reforge picks, the vendor
// Yes/No, and the sell window in the detail's place.
import type { ItemView, PaneMenu } from '../../../types'
import { spriteFor } from '../../sprites/index'
import { RARITY_RGB } from '../../stage/tuning'
import type { Line, Span } from '../../windows/kit'
import { DIM_RGB, MOVE_HELP, TEXT_RGB } from '../../windows/tuning'
import { CLASS_LABEL, clip, formatCount } from '../format'
import type { Slot } from '../sell'
import { formatRemaining } from '../time'
import { cursorRow, type MenuItem, paneLayout, paneSlots } from './frame'
import type { PaneInput } from './input'
import { type ListRow, type ListSpec, listPane } from './list'
import type { PaneAction, PaneBuild } from './types'

const TRADEABLE = new Set(['rare', 'epic', 'legendary'])
export const gold = (n: number) => `${formatCount(n)}G`
export const capital = (s: string) => (s ? `${s[0]?.toUpperCase()}${s.slice(1)}` : s)
const WEARER_CELLS = 7
const VALUE_CELLS = 5

/** A list row's text: the art and the name on the left, the columns right-aligned. */
export function rowSpans(
  inner: number,
  art: Span | null,
  name: Span & { text: string },
  columns: { text: string; cells: number; rgb?: number }[],
): Span[] {
  // The ▶ cell and a gap come first (listWindow adds them).
  const width = inner - 2
  const left: Span[] = art ? [art, { gap: 1 }] : []
  const leftCells = art ? 3 : 0
  const right: Span[] = []
  let rightCells = 0
  for (const [i, c] of columns.entries()) {
    if (i > 0) {
      right.push({ gap: 1 })
      rightCells += 1
    }
    right.push({ text: clip(c.text, c.cells).padStart(c.cells), rgb: c.rgb ?? TEXT_RGB })
    rightCells += c.cells
  }
  const nameCells = Math.max(0, width - leftCells - rightCells - 1)
  const shown = clip(name.text, nameCells)
  return [
    ...left,
    { ...name, text: shown },
    { gap: Math.max(1, nameCells - [...shown].length + 1) },
    ...right,
  ]
}

function itemDetail(input: PaneInput, item: ItemView, inner: number): Line[] {
  const { view } = input
  const wearer = item.equippedBy ? view.roster.find((h) => h.id === item.equippedBy) : undefined
  const lines: Line[] = [
    {
      spans: [
        { gap: 1 },
        { text: clip(item.name, inner - 1), rgb: RARITY_RGB[item.rarity] ?? TEXT_RGB },
      ],
      rule: true,
    },
    { spans: [{ gap: 1 }, { text: `${capital(item.rarity)} ${item.slot}` }] },
    ...item.affixes.map((a) => ({ spans: [{ gap: 1 }, { text: clip(a, inner - 1) }] })),
    { spans: [] },
    { spans: [{ gap: 1 }, { text: wearer ? `Worn by ${wearer.name}` : 'Not worn' }] },
    {
      spans: [
        { gap: 1 },
        { text: clip(`For ${item.classes.map((c) => CLASS_LABEL[c] ?? c).join(', ')}`, inner - 1) },
      ],
    },
    { spans: [{ gap: 1 }, { text: `Shop value ${gold(item.vendorValue)}` }] },
  ]
  if (item.affixes.length > 0)
    lines.push({ spans: [{ gap: 1 }, { text: `Reforge ${gold(item.reforgeCost)}` }] })
  const left = item.tradeableAt === null ? 0 : input.remainingMs(item.tradeableAt)
  if (left > 0)
    lines.push({ spans: [{ gap: 1 }, { text: `Tradeable in ${formatRemaining(left)}` }] })
  return lines
}

type Command = MenuItem & { action: PaneAction }

/** The item's command window, in the plan's order, with what each opens or applies. */
export function itemCommands(input: PaneInput, item: ItemView): Command[] {
  const worn = item.equippedBy !== null
  const out: Command[] = []
  if (!worn) {
    const can = input.view.roster.some((h) => item.classes.includes(h.cls))
    out.push(
      can
        ? {
            label: 'Equip',
            hotkey: 'e',
            action: { t: 'open', menu: { kind: 'equip', itemId: item.id, at: 0 } },
          }
        : { label: 'Equip', rgb: DIM_RGB, action: { t: 'none' } },
    )
  } else if (item.equippedBy) {
    out.push({
      label: 'Unequip',
      hotkey: 'u',
      action: {
        t: 'event',
        event: { t: 'unequip', heroId: item.equippedBy, slot: item.slot as Slot },
      },
    })
  }
  if (!worn && TRADEABLE.has(item.rarity) && input.running)
    out.push({ label: 'Sell', hotkey: 's', action: { t: 'sell', kind: 'item', id: item.id } })
  if (!worn) {
    out.push({
      label: `Vendor ${gold(item.vendorValue)}`,
      hotkey: 'v',
      action: { t: 'open', menu: { kind: 'confirm', action: 'vendor', id: item.id, at: 0 } },
    })
  }
  if (item.affixes.length > 0) {
    out.push({
      label: `Reforge ${gold(item.reforgeCost)}`,
      hotkey: 'f',
      action: { t: 'open', menu: { kind: 'reforge', itemId: item.id, at: 0 } },
    })
  }
  return out
}

const header = (text: string): Span[] => [{ text }]

/** The list window's inner width: the same whatever sub-window is open. */
export function listInner(input: PaneInput): number {
  const layout = paneLayout(input.columns, input.rows)
  return layout.kind === 'small' ? 0 : paneSlots(layout, { kind: 'none' }).list.columns - 2
}

export function inventoryPane(input: PaneInput): PaneBuild {
  const { view, dialog } = input
  const items = view.inventory
  const cursor = cursorRow(
    dialog.cursor.inventory ?? null,
    items.map((i) => i.id),
  )
  const inner = listInner(input)
  const rows: ListRow[] = items.map((item) => {
    const wearer = item.equippedBy ? view.roster.find((h) => h.id === item.equippedBy) : undefined
    const columns = [
      ...(inner >= 30
        ? [
            {
              text: wearer ? (wearer.name.split(' ')[0] ?? '') : '',
              cells: WEARER_CELLS,
              rgb: DIM_RGB,
            },
          ]
        : []),
      { text: gold(item.vendorValue), cells: VALUE_CELLS },
    ]
    return {
      key: `row:${item.id}`,
      spans: rowSpans(
        inner,
        input.art ? { art: spriteFor('item', item.base).full } : null,
        { text: item.name, rgb: RARITY_RGB[item.rarity] ?? TEXT_RGB },
        columns,
      ),
      action: input.readOnly
        ? { t: 'none' }
        : { t: 'open', menu: { kind: 'actions', tab: 'inventory', id: item.id, at: 0 } },
      alt: `${item.name}, ${item.rarity} ${item.slot}, ${gold(item.vendorValue)}${wearer ? `, worn by ${wearer.name}` : ''}`,
    }
  })
  const current = items[cursor]
  const menu: PaneMenu | null = input.readOnly ? null : dialog.menu
  const subject = !menu ? null : 'itemId' in menu ? menu.itemId : 'id' in menu ? menu.id : null
  const menuItem = subject !== null ? items.find((i) => i.id === subject) : undefined

  const spec: ListSpec = {
    title: [{ text: `Inventory ${items.length}/${view.inventoryCap} · ${gold(view.gold)}` }],
    altTitle: `Inventory ${items.length} of ${view.inventoryCap}, ${gold(view.gold)}`,
    rows,
    empty: 'Nothing yet.',
    cursor,
    detail: current ? (w) => itemDetail(input, current, w) : null,
    menu: null,
    yesNo: null,
    state:
      items.length === 0
        ? ['Items drop as the party fights.', '']
        : [`Enter: actions. ${MOVE_HELP}`, ''],
  }

  if (menu && menuItem) {
    if (menu.kind === 'actions' && menu.tab === 'inventory') {
      const commands = itemCommands(input, menuItem)
      const at = Math.max(0, Math.min(commands.length - 1, menu.at))
      spec.menu = { header: header(menuItem.name), items: commands, at }
      spec.state = [
        `What will you do with ${menuItem.name}?`,
        commands[at]?.action.t === 'none' ? 'No hero of a class can wear it.' : 'q: back.',
      ]
    } else if (menu.kind === 'equip') {
      const heroes = view.roster.filter((h) => menuItem.classes.includes(h.cls))
      spec.menu = {
        header: header('Equip on'),
        items: heroes.map((h) => ({
          label: `${h.name}  ${CLASS_LABEL[h.cls] ?? h.cls} L${h.level}`,
          action: { t: 'event', event: { t: 'equip', heroId: h.id, itemId: menuItem.id } },
        })),
        at: menu.at,
      }
      spec.state = [`Equip ${menuItem.name} on whom?`, 'q: back.']
    } else if (menu.kind === 'reforge') {
      spec.menu = {
        header: header(`Reforge ${gold(menuItem.reforgeCost)}`),
        items: menuItem.affixes.map((a, i) => ({
          label: a,
          action: { t: 'event', event: { t: 'reforge', itemId: menuItem.id, affixIndex: i } },
        })),
        at: menu.at,
      }
      spec.state = ['Reforge which affix?', `It costs ${gold(menuItem.reforgeCost)}. q: back.`]
    } else if (menu.kind === 'confirm' && menu.action === 'vendor') {
      spec.yesNo = { at: menu.at, yes: { t: 'event', event: { t: 'vendor', itemId: menuItem.id } } }
      spec.state = [`Sell ${menuItem.name} to the shop for ${gold(menuItem.vendorValue)}?`, '']
    }
    // While a sub-window is open the detail shows its item, not the ▶ row's.
    spec.detail = (w) => itemDetail(input, menuItem, w)
  }
  return listPane(input, spec)
}
