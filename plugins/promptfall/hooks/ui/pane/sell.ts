// The sell window (docs/plans/2026-10-06-ui-pr2-pane-windows.md, "Sell window"): it replaces the
// detail window while `dialog.sell` is set, and decides what to show as the sell panel does.

import { RARITY_RGB } from '../../stage/tuning'
import { listingFee, saleNet, validPrice } from '../../vendor/ledger.js'
import type { Line, Span, Win } from '../../windows/kit'
import { DIM_RGB, TEXT_RGB } from '../../windows/tuning'
import { clip, formatCount } from '../format'
import { sellState } from '../sell'
import { formatRemaining } from '../time'
import { page, type Rect } from './frame'
import type { PaneInput } from './input'
import type { PanelBuild } from './list'
import type { PaneAction, PaneField, Stop } from './types'

export type { Rect } from './frame'

const gold = (n: number) => `${formatCount(n)}G`
const SLOT_WORD: Record<string, string> = {
  weapon: 'weapon',
  armour: 'armour',
  accessory: 'accessory',
}

type Row = { text: string; rgb?: number; action?: PaneAction }

export function sellWindow(input: PaneInput, at: Rect): PanelBuild {
  const sell = input.dialog.sell
  if (!sell) throw new Error('sellWindow without a sell flow')
  const panel = sellState(input.view, input.world, sell, input.remainingMs)
  const rows: Row[] = []
  let header: Span[] = [{ text: 'Sell' }]
  let state: [string, string] = ['', 'q: back.']
  let field: PaneField | null = null
  if (panel.kind === 'gone') {
    rows.push({ text: 'It is no longer yours.' })
  } else {
    header = [{ text: `Sell ${panel.name}`, rgb: RARITY_RGB[panel.rarity] ?? TEXT_RGB }]
    if (panel.kind === 'gate') rows.push({ text: panel.line })
    else if (panel.kind === 'cooldown')
      rows.push({ text: `Tradeable in ${formatRemaining(panel.leftMs)}` })
    else if (panel.kind === 'party') rows.push({ text: 'In the party' })
    else if (panel.kind === 'unequip') {
      rows.push({ text: 'Unequip first' })
      for (const slot of panel.slots) {
        rows.push({
          text: `Unequip ${SLOT_WORD[slot] ?? slot}`,
          action: {
            t: 'event',
            event: { t: 'unequip', heroId: panel.heroId, slot },
            keep: true,
          },
        })
      }
    } else {
      if (panel.orders) {
        rows.push({ text: 'Buy orders' })
        if (panel.orders.length === 0) rows.push({ text: 'No buy orders match.', rgb: DIM_RGB })
        for (const order of panel.orders) {
          rows.push({
            text: `${gold(order.maxPrice)}, you get ${gold(saleNet(order.maxPrice))}`,
            action: { t: 'accept', orderId: order.id, price: order.maxPrice },
          })
        }
      }
      if (input.hasInput) {
        rows.push({ text: 'Set a price', action: { t: 'field', key: 'price' } })
        field = {
          key: 'price',
          label: 'price',
          placeholder: 'gold',
          value: sell.price,
          submitLabel: 'list',
        }
      } else {
        for (const p of panel.presets) rows.push({ text: gold(p), action: { t: 'list', price: p } })
      }
      const price = panel.price
      const typed = sell.price !== ''
      state = [
        validPrice(price)
          ? `Fee ${gold(listingFee(price))} · you get ${gold(saleNet(price))}`
          : typed
            ? 'A price from 1 to 1,000,000 gold'
            : 'Pick an order or set a price.',
        'q: back.',
      ]
    }
  }

  const items = rows.flatMap((r, line) => (r.action ? [{ row: r, line }] : []))
  const cursor = items.length === 0 ? -1 : Math.max(0, Math.min(items.length - 1, sell.at))
  const inner = at.columns - 2
  const shown = Math.max(1, at.rows - 3)
  const cursorLine = items[cursor]?.line ?? 0
  const start = page(cursorLine, shown)
  const lines: Line[] = [
    { spans: [{ gap: 1 }, ...header.map((s) => clipSpan(s, inner - 1))], rule: true },
    ...rows.slice(start, start + shown).map((r, i) => {
      const isItem = r.action !== undefined
      const on = isItem && start + i === cursorLine
      const body: Span = { text: clip(r.text, inner - 1), rgb: r.rgb ?? TEXT_RGB }
      return { spans: isItem ? [{ cursor: on }, body] : [{ gap: 1 }, body] }
    }),
  ]
  const end = Math.min(rows.length, start + shown)
  const footer: Span[] | undefined =
    rows.length > shown
      ? [
          { text: `${start + 1}-${end}/${rows.length}` },
          ...(end < rows.length ? [{ text: '▼' }] : []),
        ]
      : undefined
  const win: Win = {
    key: 'sell',
    ...at,
    ...(footer ? { footer } : {}),
    lines,
    alt: [
      header.map((s) => ('text' in s ? s.text : '')).join(''),
      ...rows.map((r, line) => (line === cursorLine && r.action ? `▶ ${r.text}` : r.text)),
    ].join('. '),
  }
  const stops: Stop[] = items.map((it, i) => ({
    key: `menu:${i}`,
    action: it.row.action as PaneAction,
    cursor: true,
    index: i,
  }))
  return { win, stops, at: cursor, state, field }
}

function clipSpan(s: Span, width: number): Span {
  return 'text' in s ? { ...s, text: clip(s.text, width) } : s
}
