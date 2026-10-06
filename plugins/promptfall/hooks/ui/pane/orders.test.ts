import { expect, test } from 'claude-code/testing'
import type { DialogState, OrdersState, PaneMenu } from '../../../types'
import { tilePositions } from '../../windows/kit'
import { DIM_RGB, WARN_RGB } from '../../windows/tuning'
import { baseValue, PRESETS } from '../orders'
import { GATE_UNLINKED } from '../trade'
import { ordersMine, paneInput, paneView } from './fixtures'
import type { PaneInput } from './input'
import { NEW_ORDER, ordersPane } from './orders'
import { linesOf, win } from './testing'

function input(
  orders: Partial<OrdersState> = {},
  dialog: Partial<DialogState> = {},
  patch: Partial<PaneInput> = {},
): PaneInput {
  const base = paneInput({ tab: 'orders', remainingMs: (d) => d, ...patch })
  return {
    ...base,
    orders: { ...ordersMine(), ...orders },
    dialog: { ...base.dialog, ...dialog },
  }
}
const cursors = (b: ReturnType<typeof ordersPane>) => b.stops.filter((s) => s.cursor)
const message = (b: ReturnType<typeof ordersPane>) =>
  linesOf(win(b, 'message')).map((l) => l.trim())
const at = (id: string, index: number) => ({ cursor: { orders: { id, index } } })
const formed = (
  form: Partial<NonNullable<OrdersState['form']>> = {},
  dialog: Partial<DialogState> = {},
  patch: Partial<PaneInput> = {},
) => input({ form: { ...NEW_ORDER, ...form } }, dialog, patch)

test('the rows in order: returns, both headings, the price columns, New buy order', () => {
  const b = ordersPane(input())
  const list = win(b, 'list')
  expect(linesOf(list)).toEqual([
    '  Returns waiting: 2',
    '  My listings',
    `▶ Silk Robe${' '.repeat(63)}900G`,
    `  Jade Ring${' '.repeat(61)}2,400G`,
    '  My buy orders',
    `  Steel Longsword rare+${' '.repeat(48)}≤1,200G`,
    '  New buy order',
  ])
  expect(list?.lines.map((l) => l.rule === true)).toEqual([
    false,
    true,
    false,
    false,
    true,
    false,
    false,
  ])
  expect(list?.lines[0]?.spans).toContainEqual({ text: 'Returns waiting: 2', rgb: WARN_RGB })
  expect(cursors(b).map((s) => s.key)).toEqual(['row:l-L4', 'row:l-L5', 'row:o-O1', 'row:new'])
  expect(cursors(b)[3]?.action).toEqual({ t: 'form', form: NEW_ORDER, menu: null })
})

test('Enter on a listing and an order opens its Yes/No; Yes cancels the right one', () => {
  const b = ordersPane(input())
  expect(cursors(b)[0]?.action).toEqual({
    t: 'open',
    menu: { kind: 'confirm', action: 'cancel-listing', id: 'L4', at: 0 },
  })
  expect(cursors(b)[2]?.action).toEqual({
    t: 'open',
    menu: { kind: 'confirm', action: 'cancel-order', id: 'O1', at: 0 },
  })
  const listing = ordersPane(
    input({}, { menu: { kind: 'confirm', action: 'cancel-listing', id: 'L4', at: 0 } }),
  )
  expect(cursors(listing)[0]?.action).toEqual({ t: 'cancel', what: 'listing', id: 'L4' })
  expect(message(listing)).toEqual(['Cancel the listing of Silk Robe? The fee is kept.', ''])
  const order = ordersPane(
    input({}, { menu: { kind: 'confirm', action: 'cancel-order', id: 'O1', at: 1 } }),
  )
  expect(cursors(order)[0]?.action).toEqual({ t: 'cancel', what: 'order', id: 'O1' })
  expect(order.focus).toBe('no')
  expect(message(order)).toEqual(['Cancel the buy order? 1,200G comes back.', ''])
})

test('the detail of a listing, an order and New buy order; the messages', () => {
  expect(linesOf(win(ordersPane(input()), 'detail'))).toEqual([
    ' Silk Robe',
    ' Rare armour',
    ' Ward +3',
    '',
    ' Listed for 900G',
    ' Expires in 6d',
  ])
  const order = ordersPane(input({}, at('o-O1', 2)))
  expect(linesOf(win(order, 'detail'))).toEqual([
    ' Buy order',
    ' Steel Longsword',
    ' Rare or better',
    ' With Vicious',
    ' Up to 1,200G, held',
    ' Expires in 6d',
  ])
  expect(message(order)).toEqual([
    'Enter: cancel it. Tab or arrows: move.',
    'Returned goods wait for a free slot.',
  ])
  const add = ordersPane(input({}, at('new', 3)))
  expect(linesOf(win(add, 'detail'))).toEqual([
    ' New buy order',
    ' Gold is held until the order fills or',
    ' you cancel it.',
  ])
  expect(message(add)[0]).toBe('Enter: place a buy order.')
})

test('empty sections read None.; not loaded reads Loading while busy', () => {
  const empty = ordersPane(input({ mine: { listings: [], orders: [], returns: 0 } }))
  expect(linesOf(win(empty, 'list'))).toEqual([
    '  My listings',
    '  None.',
    '  My buy orders',
    '  None.',
    '▶ New buy order',
  ])
  expect(win(empty, 'list')?.lines[1]?.spans).toContainEqual({ text: 'None.', rgb: DIM_RGB })
  const busy = ordersPane(input({ mine: null, busy: true }))
  expect(linesOf(win(busy, 'list'))).toEqual(['  Loading your orders…'])
  expect(cursors(busy).map((s) => s.key)).toEqual(['row:empty'])
})

test('read-only: rows do nothing and no New buy order; a gate: no New buy order, the gate line', () => {
  const ro = ordersPane(input({}, {}, { readOnly: true }))
  expect(cursors(ro).map((s) => s.action.t)).toEqual(['none', 'none', 'none'])
  const view = { ...paneView(), account: { ...paneView().account, linked: null } }
  const gated = ordersPane(input({}, {}, { view }))
  expect(cursors(gated).map((s) => s.key)).not.toContain('row:new')
  expect(win(gated, 'message')?.lines[0]?.spans).toContainEqual({
    text: GATE_UNLINKED,
    rgb: WARN_RGB,
  })
})

test('the form: Set a price as a field, then Price and Place order once the price is valid', () => {
  const b = ordersPane(formed())
  expect(win(b, 'detail')).toBeUndefined()
  expect(linesOf(win(b, 'form'))).toEqual([
    ' New buy order',
    '▶Base: Steel Longsword',
    ' Rarity: rare+',
    ' Affix: any',
    ' Set a price',
    ' Place order',
  ])
  expect(cursors(b)[3]?.action).toEqual({ t: 'field', key: 'order-price' })
  expect(cursors(b)[4]?.action).toEqual({ t: 'none' })
  expect(win(b, 'form')?.lines[5]?.spans).toContainEqual({ text: 'Place order', rgb: DIM_RGB })
  expect(b.field).toEqual({
    key: 'order-price',
    label: 'max price',
    placeholder: 'gold',
    value: '',
    submitLabel: 'place',
  })
  expect(message(b)).toEqual(['Pick what to buy, then a price.', 'q: back.'])
  const priced = ordersPane(formed({ maxPrice: '1200', affixId: 'keen' }, { formAt: 4 }))
  expect(linesOf(win(priced, 'form')).slice(3)).toEqual([
    ' Affix: Keen',
    ' Price: 1,200G',
    '▶Place order',
  ])
  expect(cursors(priced)[4]?.action).toEqual({ t: 'place' })
  expect(priced.focus).toBe('menu:4')
  expect(message(priced)).toEqual([
    'Buy order: Steel Longsword rare+, with Keen, up to 1,200G.',
    'q: back.',
  ])
  const bad = ordersPane(formed({ maxPrice: '0' }))
  expect(message(bad)[0]).toBe('A price from 1 to 1,000,000 gold')
  expect(cursors(bad)[4]?.action).toEqual({ t: 'none' })
})

test('with no Input the form lists the four presets', () => {
  const b = ordersPane(formed({}, {}, { hasInput: false }))
  const value = baseValue('steel_longsword', 'rare')
  expect(
    cursors(b)
      .slice(3, 7)
      .map((s) => s.action),
  ).toEqual(
    PRESETS.map((m) => ({
      t: 'form',
      form: { ...NEW_ORDER, maxPrice: String(value * m) },
      menu: null,
    })),
  )
  expect(b.field).toBeNull()
})

test('a Base pick takes the form’s slot; picking returns to the form', () => {
  const m: PaneMenu = { kind: 'pick', field: 'orderBase', at: 34 }
  const b = ordersPane(formed({}, { menu: m }))
  expect(win(b, 'form')).toBeUndefined()
  const menu = win(b, 'menu')
  expect([menu?.x, menu?.columns, menu?.rows]).toEqual([80, 40, 17])
  expect(cursors(b).length).toBe(40)
  expect(cursors(b)[0]?.action).toEqual({
    t: 'form',
    form: { ...NEW_ORDER, base: 'astral_robe' },
    menu: null,
  })
  expect(message(b)).toEqual(['Which base?', 'q: back.'])
  const affix = ordersPane(formed({}, { menu: { kind: 'pick', field: 'orderAffix', at: 0 } }))
  expect(linesOf(win(affix, 'menu'))[1]).toBe('▶any')
  // The base pick opens on the current base.
  expect(cursors(ordersPane(formed()))[0]?.action).toEqual({
    t: 'open',
    menu: { kind: 'pick', field: 'orderBase', at: 34 },
  })
})

test('with the form set, read-only or a gate shows no form', () => {
  expect(win(ordersPane(formed({}, {}, { readOnly: true })), 'form')).toBeUndefined()
  const view = { ...paneView(), account: { ...paneView().account, linked: null } }
  expect(win(ordersPane(formed({}, {}, { view })), 'form')).toBeUndefined()
})

test('wide and narrow scenes, with each sub-window, pass tilePositions', () => {
  const cases: PaneInput[] = [
    input(),
    input({}, { menu: { kind: 'confirm', action: 'cancel-order', id: 'O1', at: 0 } }),
    formed(),
    formed({}, { menu: { kind: 'pick', field: 'orderRarity', at: 0 } }),
  ]
  for (const columns of [120, 60]) {
    for (const c of cases) {
      const b = ordersPane({ ...c, columns })
      const pos = tilePositions(b.scene)
      for (const w of b.scene.windows)
        expect([w.key, pos.get(w.key)]).toEqual([w.key, { x: w.x, y: w.y ?? 0 }])
    }
  }
})
