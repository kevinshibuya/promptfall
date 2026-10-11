import { expect, test } from 'claude-code/testing'
import type { OrderView, SellState } from '../../../types'
import type { Span, Win } from '../../windows/kit'
import { HERO_PRESETS, ITEM_PRESETS } from '../sell'
import { paneInput, paneView } from './fixtures'
import type { PaneInput } from './input'
import { sellWindow } from './sell'

const RECT = { x: 80, y: 3, columns: 40, rows: 17 }
const textOf = (spans: readonly Span[]) =>
  spans
    .map((s) =>
      'text' in s
        ? s.text
        : 'cursor' in s
          ? s.cursor
            ? '▶'
            : ' '
          : 'gap' in s
            ? ' '.repeat(s.gap)
            : '',
    )
    .join('')
const linesOf = (w: Win) => w.lines.map((l) => textOf(l.spans).trimEnd())

function order(id: string, maxPrice: number): OrderView {
  return {
    id,
    base: 'silk_robe',
    name: 'Silk Robe',
    minRarity: 'rare',
    affix: null,
    maxPrice,
    expiresAt: 0,
  }
}
function withSell(sell: Partial<SellState>, patch: Partial<PaneInput> = {}): PaneInput {
  const input = paneInput(patch)
  const s: SellState = {
    kind: 'item',
    id: 'i2',
    matching: [],
    price: '',
    error: null,
    at: 0,
    ...sell,
  }
  return { ...input, dialog: { ...input.dialog, sell: s } }
}

test('an item gone from the inventory', () => {
  const b = sellWindow(withSell({ id: 'nope' }), RECT)
  expect(linesOf(b.win)).toEqual([' Sell', ' It is no longer yours.'])
  expect(b.stops).toEqual([])
})

test('the market gate, the cooldown, a party hero, unequip first', () => {
  const closed = paneView()
  closed.account = { ...closed.account, marketOpen: false }
  expect(linesOf(sellWindow(withSell({}, { view: closed }), RECT).win)).toEqual([
    ' Sell Silk Robe',
    ' The market is closed.',
  ])
  const cooling = paneView()
  cooling.inventory = cooling.inventory.map((i) => (i.id === 'i2' ? { ...i, tradeableAt: 1 } : i))
  const cool = withSell({}, { view: cooling, remainingMs: () => 3 * 3_600_000 })
  expect(linesOf(sellWindow(cool, RECT).win)[1]).toBe(' Tradeable in 3h')
  expect(linesOf(sellWindow(withSell({ kind: 'hero', id: 'h2' }), RECT).win)).toEqual([
    ' Sell Mira',
    ' In the party',
  ])
  const geared = paneView()
  geared.roster = geared.roster.map((h) =>
    h.id === 'h4' ? { ...h, equipment: { weapon: 'i1', armour: null, accessory: 'i3' } } : h,
  )
  const b = sellWindow(withSell({ kind: 'hero', id: 'h4', at: 1 }, { view: geared }), RECT)
  expect(linesOf(b.win)).toEqual([
    ' Sell Lyra',
    ' Unequip first',
    ' Unequip weapon',
    '▶Unequip accessory',
  ])
  expect(b.stops.map((s) => s.action)).toEqual([
    { t: 'event', event: { t: 'unequip', heroId: 'h4', slot: 'weapon' }, keep: true },
    { t: 'event', event: { t: 'unequip', heroId: 'h4', slot: 'accessory' }, keep: true },
  ])
})

test('an item with two matching orders lists them with nets, then Set a price', () => {
  const b = sellWindow(withSell({ matching: [order('o1', 1200), order('o2', 900)] }), RECT)
  expect(linesOf(b.win)).toEqual([
    ' Sell Silk Robe',
    ' Buy orders',
    '▶1,200G, you get 1,140G',
    ' 900G, you get 855G',
    ' Set a price',
  ])
  expect(b.stops.map((s) => [s.key, s.action])).toEqual([
    ['menu:0', { t: 'accept', orderId: 'o1', price: 1200 }],
    ['menu:1', { t: 'accept', orderId: 'o2', price: 900 }],
    ['menu:2', { t: 'field', key: 'price' }],
  ])
  expect(b.field?.key).toBe('price')
  expect(b.state).toEqual(['Pick an order or set a price.', 'q: back.'])
  expect(b.win.lines[0]?.rule).toBe(true)
})

test('no orders reads so; a hero has no orders section', () => {
  expect(linesOf(sellWindow(withSell({}), RECT).win)).toEqual([
    ' Sell Silk Robe',
    ' Buy orders',
    ' No buy orders match.',
    '▶Set a price',
  ])
  expect(linesOf(sellWindow(withSell({ kind: 'hero', id: 'h5' }), RECT).win)).toEqual([
    ' Sell Bram',
    '▶Set a price',
  ])
})

test('with no Input the presets replace Set a price, and list at their price', () => {
  const b = sellWindow(withSell({}, { hasInput: false }), RECT)
  const presets = ITEM_PRESETS.map((m) => m * 120)
  expect(b.stops.map((s) => s.action)).toEqual(presets.map((price) => ({ t: 'list', price })))
  expect(linesOf(b.win).slice(-4)).toEqual(['▶240G', ' 360G', ' 600G', ' 960G'])
  expect(b.field).toBeNull()
  const hero = sellWindow(withSell({ kind: 'hero', id: 'h5' }, { hasInput: false }), RECT)
  expect(hero.stops.map((s) => s.action)).toEqual(
    HERO_PRESETS.map((price) => ({ t: 'list', price })),
  )
})

test('a typed price: the fee line when valid, the range line when not', () => {
  expect(sellWindow(withSell({ price: '1200' }), RECT).state).toEqual([
    // The ledger's listing fee on 1,200 is 24G; the sale keeps 1,140G.
    'Fee 24G · you get 1,140G',
    'q: back.',
  ])
  expect(sellWindow(withSell({ price: '0' }), RECT).state[0]).toBe(
    'A price from 1 to 1,000,000 gold',
  )
  expect(sellWindow(withSell({ price: 'abc' }), RECT).state[0]).toBe(
    'A price from 1 to 1,000,000 gold',
  )
})
