import type { On } from 'claude-code'
import { expect, type TestBody } from 'claude-code/testing'
import type { DialogState, JournalState, MarketState, OrdersState } from '../../../types'
import type { GameHandle } from '../../engine'
import { DIALOG_DEFAULT, JOURNAL_DEFAULT, MARKET_DEFAULT, ORDERS_DEFAULT } from '../../state'
import { test } from '../../testing'
import type { PlayerEvent } from '../../vendor/sim.js'
import type { PaneScene, Win } from '../../windows/kit'
import { loadMarket } from '../market'
import { placeOrder } from '../orders'
import { chatPane } from './chat'
import { chatWorld, journalLoaded, marketPage, paneInput, paneView } from './fixtures'
import { inventoryPane } from './inventory'
import { marketPane } from './market'
import {
  type ActionContext,
  closed,
  focusFrom,
  focusMove,
  type PaneDraw,
  paneElement,
  placed,
  refocusKey,
  ringMoved,
  ringOnInput,
  runAction,
  stepCursor,
  stopsSignature,
  withCursor,
  writesCursor,
} from './mount'
import type { PaneBuild, Stop } from './types'

const w = (key: string, x: number, y: number, columns: number, rows: number): Win => ({
  key,
  x,
  y,
  columns,
  rows,
  lines: [{ spans: [{ text: key }] }],
  alt: `${key} alt`,
})
const SCENE: PaneScene = {
  columns: 40,
  rows: 8,
  windows: [w('top', 0, 0, 40, 4), w('bottom', 0, 4, 40, 4)],
  alt: 'two rows',
  tiles: { column: [{ win: 'top' }, { win: 'bottom' }] },
}
const tab = (t: 'inventory' | 'market'): Stop => ({
  key: `tab-${t}`,
  hotkey: t[0],
  action: { t: 'tab', tab: t },
  cursor: false,
})
const row = (id: string, index: number): Stop => ({
  key: `row:${id}`,
  action: { t: 'event', event: { t: 'vendor', itemId: id } },
  cursor: true,
  index,
})
const BACK: Stop = { key: 'back', hotkey: 'q', action: { t: 'back' }, cursor: false }
const BUILD: PaneBuild = {
  scene: SCENE,
  stops: [tab('inventory'), tab('market'), row('a', 0), row('b', 1), row('c', 2), BACK],
  focus: 'row:a',
  field: null,
  link: null,
}
const PROPS = {
  title: 'Promptfall',
  isFocused: true,
  bodyColumns: 60,
  placement: 'inline' as const,
  scroll: { offset: 0, bodyRows: 24 },
  view: {},
}

/**
 * A test-only pane drawing BUILD through paneElement. Its Buttons sit beneath the plugins, so a
 * press cannot reach them here: dialog.test.ts presses the real pane's stops.
 */
function testPane(on: On, renderer: PaneDraw['renderer']) {
  on('ui.render', { component: 'Pane', requestId: 'pane-test' }, async ($, e) =>
    paneElement({
      els: $.ui.resolve(e) as PaneDraw['els'],
      surface: e.surface,
      renderer,
      bodyColumns: e.props.bodyColumns,
      build: BUILD,
      run: () => undefined,
      move: () => undefined,
      field: { onInput: () => undefined, onSubmit: () => undefined },
      probe: null,
    }),
  )
}
const mountPane = ($: Parameters<TestBody>[0], surface: 'terminal' | 'desktop') =>
  $.ui.mount({
    plugin: 'promptfall',
    surface,
    component: 'Pane',
    requestId: 'pane-test',
    props: PROPS,
  })

test('raster terminals draw one Raster of the scene, centred, with the stops hidden beside it', async ($, on) => {
  testPane(on, 'raster')
  const ui = await mountPane($, 'terminal')
  const raster = await ui.find({ type: 'Raster' })
  expect([raster?.props.columns, raster?.props.rows]).toEqual([40, 8])
  expect((await ui.find({ key: 'pane-picture' }))?.props.paddingLeft).toBe(10)
  expect((await ui.find({ key: 'stops' }))?.props.width).toBe(0)
  const buttons = await ui.findAll({ type: 'Button' })
  expect(buttons.map((b) => b.key)).toEqual([
    'tab-inventory',
    'tab-market',
    'row:a',
    'row:b',
    'row:c',
    'back',
  ])
  expect((await ui.find({ key: 'row:a' }))?.props.autoFocus).toBe(true)
  expect(await ui.find({ key: 'rung-up' })).toBeUndefined()
  await ui.unmount()
})

test('image terminals draw one Image per window, with distinct keys, in the tile tree', async ($, on) => {
  testPane(on, 'image')
  const ui = await mountPane($, 'terminal')
  const images = await ui.findAll({ type: 'Image' })
  expect(images.map((i) => i.key)).toEqual(['win-top-40x4', 'win-bottom-40x4'])
  expect(images.map((i) => i.props.alt)).toEqual(['top alt', 'bottom alt'])
  expect(await ui.find({ type: 'Raster' })).toBeUndefined()
  await ui.unmount()
})

test('the desktop draws one sized Svg with the scene alt, the stops absolute, and the ▲ ▼ ok back row', async ($, on) => {
  testPane(on, 'image')
  const ui = await mountPane($, 'desktop')
  const svg = await ui.find({ type: 'Svg' })
  expect(svg?.props.alt).toBe('two rows')
  expect([svg?.props.width, svg?.props.height]).toEqual([320, 128])
  expect((await ui.find({ key: 'stops' }))?.props.position).toBe('absolute')
  const rung = (await ui.findAll({ type: 'Button' })).filter((b) => b.key?.startsWith('rung-'))
  expect(rung.map((b) => [b.key, b.props.label, b.props.hotkey])).toEqual([
    ['rung-up', '▲', 'k'],
    ['rung-down', '▼', 'j'],
    ['rung-ok', 'ok', undefined],
    ['rung-back', 'back', undefined],
  ])
  await ui.unmount()
})

test('focus onto a row stop lands and writes the cursor with its index', () => {
  const move = focusMove(BUILD, 'row:b', 'row:a')
  expect(move).toEqual({ t: 'land', stop: row('b', 1), redirect: false })
  if (move.t !== 'land') return
  const d = withCursor(DIALOG_DEFAULT, 'inventory', move.stop)
  expect(d.cursor.inventory).toEqual({ id: 'b', index: 1 })
})

test('Tab off the last row wraps to the first; Shift+Tab off the first row wraps to the last', () => {
  // Tab from row:c reaches back, then (past an engine stop) the tabs: forward to row:a.
  expect(focusMove(BUILD, 'back', 'row:c')).toEqual({
    t: 'land',
    stop: row('a', 0),
    redirect: true,
  })
  expect(focusMove(BUILD, 'tab-inventory', 'row:c')).toEqual({
    t: 'land',
    stop: row('a', 0),
    redirect: true,
  })
  // Shift+Tab from row:a reaches the last tab: backward, past back, to row:c.
  expect(focusMove(BUILD, 'tab-market', 'row:a')).toEqual({
    t: 'land',
    stop: row('c', 2),
    redirect: true,
  })
  expect(focusMove(BUILD, 'back', 'row:a')).toEqual({
    t: 'land',
    stop: row('a', 0),
    redirect: true,
  })
})

test('engine stops and elements outside the build pass; no cursor stops keeps the ring', () => {
  expect(focusMove(BUILD, undefined, 'row:a')).toEqual({ t: 'pass' })
  expect(focusMove(BUILD, 'price', 'row:a')).toEqual({ t: 'pass' })
  const empty: PaneBuild = { ...BUILD, stops: [tab('inventory'), BACK], focus: null }
  expect(focusMove(empty, 'back', null)).toEqual({ t: 'keep' })
})

test('the cursor of an open window: menu.at, or sell.at while selling', () => {
  const stop: Stop = { key: 'menu:2', action: { t: 'none' }, cursor: true, index: 2 }
  const menu: DialogState = { ...DIALOG_DEFAULT, menu: { kind: 'equip', itemId: 'i', at: 0 } }
  expect(withCursor(menu, 'inventory', stop).menu).toEqual({ kind: 'equip', itemId: 'i', at: 2 })
  const sell = { kind: 'item' as const, id: 'i', matching: [], price: '', error: null, at: 0 }
  expect(withCursor({ ...DIALOG_DEFAULT, sell }, 'inventory', stop).sell?.at).toBe(2)
})

test('rung (c) steps the ▶ among the cursor stops, wrapping', () => {
  expect(stepCursor(BUILD, 1)?.key).toBe('row:b')
  expect(stepCursor(BUILD, -1)?.key).toBe('row:c')
})

function context(
  state: {
    d: DialogState
    market?: MarketState
    orders?: OrdersState
    journal?: JournalState
    tab?: 'orders'
  },
  events: PlayerEvent[],
  game: GameHandle | null = null,
): ActionContext {
  return {
    upd: async (fn) => {
      state.d = fn(state.d)
    },
    game: () => game,
    act: async (event) => {
      events.push(event)
    },
    openTab: async () => undefined,
    after: () => undefined,
    remaining: () => undefined,
    focusField: async () => undefined,
    dialog: async () => state.d,
    updMarket: async (fn) => {
      state.market = fn(state.market ?? MARKET_DEFAULT)
    },
    updOrders: async (fn) => {
      state.orders = fn(state.orders ?? ORDERS_DEFAULT)
    },
    updJournal: async (fn) => {
      state.journal = fn(state.journal ?? JOURNAL_DEFAULT)
    },
    market: async () => state.market ?? MARKET_DEFAULT,
    orders: async () => state.orders ?? ORDERS_DEFAULT,
    setSettings: async () => undefined,
    setCollapsed: async () => undefined,
    tab: async () => state.tab ?? 'inventory',
  }
}

test('actions: open, back, an event closing the menu, the third pick sending the party', async () => {
  const state = { d: DIALOG_DEFAULT }
  const events: PlayerEvent[] = []
  const ctx = context(state, events)
  await runAction({ t: 'open', menu: { kind: 'actions', tab: 'inventory', id: 'i2', at: 0 } }, ctx)
  expect(state.d.menu?.kind).toBe('actions')
  // With a menu open the next drawing focuses its first item.
  expect(inventoryPane({ ...paneInput(), dialog: state.d }).focus).toBe('menu:0')
  await runAction({ t: 'back' }, ctx)
  expect(state.d.menu).toBeNull()
  state.d = { ...state.d, menu: { kind: 'confirm', action: 'vendor', id: 'i2', at: 0 } }
  await runAction({ t: 'event', event: { t: 'vendor', itemId: 'i2' } }, ctx)
  expect(events).toEqual([{ t: 'vendor', itemId: 'i2' }])
  expect(state.d.menu).toBeNull()
  const sell = { kind: 'hero' as const, id: 'h4', matching: [], price: '', error: null, at: 0 }
  state.d = { ...state.d, sell }
  await runAction(
    { t: 'event', event: { t: 'unequip', heroId: 'h4', slot: 'weapon' }, keep: true },
    ctx,
  )
  expect(state.d.sell).toEqual(sell)
  await runAction({ t: 'back' }, ctx)
  expect(state.d.sell).toBeNull()
  for (const id of ['h1', 'h4', 'h5']) await runAction({ t: 'party', heroId: id }, ctx)
  expect(events.at(-1)).toEqual({ t: 'set_party', heroIds: ['h1', 'h4', 'h5'] })
  expect(state.d.partyPick).toEqual([])
  await runAction({ t: 'party', heroId: 'h2' }, ctx)
  await runAction({ t: 'party', heroId: 'h2' }, ctx)
  expect(state.d.partyPick).toEqual([])
})

test('a closed pane leaves no sub-window and no sell flow', () => {
  const sell = { kind: 'item' as const, id: 'i', matching: [], price: '', error: null, at: 0 }
  const d = closed({
    ...DIALOG_DEFAULT,
    menu: { kind: 'equip', itemId: 'i', at: 0 },
    sell,
    partyPick: ['h1'],
  })
  expect([d.menu, d.sell, d.partyPick]).toEqual([null, null, ['h1']])
})

test('the ring goes back on the ▶ when the stops or the open window change', () => {
  const menu: PaneBuild = {
    ...BUILD,
    stops: [
      tab('inventory'),
      { key: 'menu:0', action: { t: 'none' }, cursor: true, index: 0 },
      BACK,
    ],
    focus: 'menu:0',
  }
  const sig = (b: PaneBuild, w: string) => stopsSignature(b, w)
  const place = (b: PaneBuild, s: string) => {
    if (refocusKey('t', s, b) !== false) placed('t', s)
  }
  // The first drawing of an instance: its autoFocus places the ring.
  expect(refocusKey('t', sig(BUILD, 'inventory'), BUILD)).toBe(false)
  // The same stops (a cursor move): the ring is already there.
  const moved = { ...BUILD, focus: 'row:b' }
  expect(refocusKey('t', sig(moved, 'inventory'), moved)).toBe(false)
  // A menu opens: changed, and stays changed until a focus took.
  expect(refocusKey('t', sig(menu, 'actions:a'), menu)).toBe('menu:0')
  expect(refocusKey('t', sig(menu, 'actions:a'), menu)).toBe('menu:0')
  placed('t', sig(menu, 'actions:a'))
  // A reforge pick with as many items: the same keys, another window.
  expect(refocusKey('t', sig(menu, 'reforge:a'), menu)).toBe('menu:0')
  place(menu, sig(menu, 'reforge:a'))
  // A row inserted above the ring (a recruit, a drop).
  place(BUILD, sig(BUILD, 'inventory'))
  const inserted = { ...BUILD, stops: [row('new', 0), ...BUILD.stops] }
  expect(refocusKey('t', sig(inserted, 'inventory'), inserted)).toBe('row:a')
})

test('a row inserted while the ring is on a field puts the ring back on the field', () => {
  const field = {
    key: 'compose' as const,
    label: 'say',
    placeholder: 'a message',
    value: 'two',
    submitLabel: 'send',
  }
  const a: PaneBuild = { ...BUILD, field }
  const b: PaneBuild = { ...a, stops: [row('o1', 0), ...a.stops] }
  refocusKey('p', stopsSignature(a, 'chat'), a)
  ringOnInput('p', true)
  // A chat message arrives while the person types: the ring goes back to the field, not the ▶.
  expect(refocusKey('p', stopsSignature(b, 'chat'), b)).toBe('compose')
  placed('p', stopsSignature(b, 'chat'))
  // The field is gone (the tab changed): the ring goes back on the ▶.
  expect(refocusKey('p', stopsSignature(BUILD, 'inventory'), BUILD)).toBe('row:a')
})

/** A game handle stub: the market reads and trades the PR 3 actions reach, recorded. */
function stubGame() {
  const calls: string[] = []
  const handle = {
    market: {
      browse: async (q: { page: number }) => {
        calls.push(`browse ${q.page}`)
        return { listings: [], page: q.page, total: 0 }
      },
      myOrders: async () => {
        calls.push('myOrders')
        return { listings: [], orders: [], returns: 0 }
      },
    },
    sync: async () => undefined,
    trade: async (call: (client: Record<string, unknown>, auth: string) => Promise<unknown>) =>
      call(
        {
          buy: async (_auth: string, id: string) => {
            calls.push(`buy ${id}`)
            return { ok: true }
          },
          cancelListing: async (_auth: string, id: string) => {
            calls.push(`cancelListing ${id}`)
            return { ok: true }
          },
        },
        'auth',
      ),
    reset: () => {
      calls.push('reset')
    },
    deleteAccount: () => {
      calls.push('deleteAccount')
    },
  }
  return { calls, game: handle as unknown as GameHandle }
}

test('query clears cursor.market, sets the menu, then browses through the game handle', async () => {
  const { calls, game } = stubGame()
  const state: { d: DialogState; market?: MarketState } = {
    d: {
      ...DIALOG_DEFAULT,
      cursor: { market: { id: 'L1', index: 1 } },
      menu: { kind: 'pick', field: 'base', at: 3 },
    },
  }
  const query = { kind: 'item' as const, sort: 'price' as const, page: 0, base: 'iron_sword' }
  await runAction({ t: 'query', query, menu: { kind: 'filter', at: 2 } }, context(state, [], game))
  expect(state.d.cursor.market).toBeNull()
  expect(state.d.menu).toEqual({ kind: 'filter', at: 2 })
  expect(calls).toEqual(['browse 0'])
  expect(state.market?.query).toEqual(query)
  // Without a game handle it does nothing.
  const none = { d: DIALOG_DEFAULT }
  await runAction({ t: 'query', query, menu: null }, context(none, []))
  expect(none.d).toBe(DIALOG_DEFAULT)
})

test('buy closes the menu and buys once; cancel cancels; reset and delete close the menu and act', async () => {
  const { calls, game } = stubGame()
  const state: { d: DialogState } = {
    d: { ...DIALOG_DEFAULT, menu: { kind: 'confirm', action: 'buy', id: 'L1', at: 0 } },
  }
  await runAction({ t: 'buy', listingId: 'L1' }, context(state, [], game))
  expect(state.d.menu).toBeNull()
  expect(calls.filter((c) => c.startsWith('buy'))).toEqual(['buy L1'])
  state.d = { ...state.d, menu: { kind: 'confirm', action: 'cancel-listing', id: 'L4', at: 0 } }
  await runAction({ t: 'cancel', what: 'listing', id: 'L4' }, context(state, [], game))
  expect(calls).toContain('cancelListing L4')
  state.d = { ...state.d, menu: { kind: 'confirm', action: 'reset', id: '', at: 0 } }
  await runAction({ t: 'reset' }, context(state, [], game))
  expect(state.d.menu).toBeNull()
  expect(calls.at(-1)).toBe('reset')
  state.d = { ...state.d, menu: { kind: 'confirm', action: 'delete', id: '', at: 0 } }
  await runAction({ t: 'delete' }, context(state, [], game))
  expect(state.d.menu).toBeNull()
  expect(calls.at(-1)).toBe('deleteAccount')
})

test('a rest-days pick toggles its days; the second closes it and sends the pair, the journal answering', async () => {
  const sent: number[][] = []
  const answer = journalLoaded().journal
  if (!answer) throw new Error('journalLoaded holds no journal')
  const next = { days: [2, 4], from: 20_384 }
  const game = {
    setRestDays: async (days: number[]) => {
      sent.push(days)
      return { ok: true, journal: { ...answer, restDays: { current: [6, 7], next } } }
    },
  } as unknown as GameHandle
  const state: { d: DialogState; journal?: JournalState } = {
    d: { ...DIALOG_DEFAULT, menu: { kind: 'rest_days', picked: [], at: 1 } },
  }
  await runAction({ t: 'rest_day', day: 2 }, context(state, [], game))
  expect(state.d.menu).toEqual({ kind: 'rest_days', picked: [2], at: 1 })
  await runAction({ t: 'rest_day', day: 2 }, context(state, [], game))
  expect(state.d.menu).toEqual({ kind: 'rest_days', picked: [], at: 1 })
  expect(sent).toEqual([])
  await runAction({ t: 'rest_day', day: 4 }, context(state, [], game))
  await runAction({ t: 'rest_day', day: 2 }, context(state, [], game))
  expect(state.d.menu).toBeNull()
  expect(sent).toEqual([[4, 2]])
  expect(state.journal?.journal?.restDays).toEqual({ current: [6, 7], next })
  // A press with the pick closed sends nothing.
  await runAction({ t: 'rest_day', day: 5 }, context(state, [], game))
  expect(sent).toHaveLength(1)
})

test('a refused or failed rest-days write flashes in the journal slice', async () => {
  const answers: unknown[] = [{ ok: false, reason: 'rest_days_same' }]
  const game = {
    setRestDays: async () => {
      const a = answers.shift()
      if (a instanceof Error) throw a
      return a
    },
  } as unknown as GameHandle
  const pick = (): DialogState => ({
    ...DIALOG_DEFAULT,
    menu: { kind: 'rest_days', picked: [3], at: 0 },
  })
  const state: { d: DialogState; journal?: JournalState } = { d: pick() }
  await runAction({ t: 'rest_day', day: 5 }, context(state, [], game))
  expect(state.journal?.error).toBe('Pick two different days')
  answers.push(new Error('unreachable'))
  state.d = pick()
  await runAction({ t: 'rest_day', day: 5 }, context(state, [], game))
  expect(state.journal?.error).toBe('Server unreachable')
})

test('Back: a Market pick returns to its filter row; an order pick keeps the form; then the form closes', async () => {
  const form = { base: 'steel_longsword', minRarity: 'rare' as const, affixId: null, maxPrice: '' }
  const market = {
    d: { ...DIALOG_DEFAULT, menu: { kind: 'pick' as const, field: 'minRarity' as const, at: 2 } },
  }
  await runAction({ t: 'back' }, context(market, []))
  expect(market.d.menu).toEqual({ kind: 'filter', at: 3 })
  await runAction({ t: 'back' }, context(market, []))
  expect(market.d.menu).toBeNull()
  const orders: { d: DialogState; orders?: OrdersState; tab: 'orders' } = {
    d: { ...DIALOG_DEFAULT, menu: { kind: 'pick', field: 'orderBase', at: 0 } },
    orders: { ...ORDERS_DEFAULT, form },
    tab: 'orders',
  }
  await runAction({ t: 'back' }, context(orders, []))
  expect(orders.d.menu).toBeNull()
  expect(orders.orders?.form).toEqual(form)
  await runAction({ t: 'back' }, context(orders, []))
  expect(orders.orders?.form).toBeNull()
})

test('form opens with its ▶ on the first row; a pick changing it keeps the ▶', async () => {
  const form = { base: 'steel_longsword', minRarity: 'rare' as const, affixId: null, maxPrice: '' }
  const state: { d: DialogState; orders?: OrdersState } = { d: { ...DIALOG_DEFAULT, formAt: 4 } }
  await runAction({ t: 'form', form, menu: null }, context(state, []))
  expect([state.orders?.form, state.d.formAt]).toEqual([form, 0])
  state.d = { ...state.d, formAt: 1, menu: { kind: 'pick', field: 'orderRarity', at: 0 } }
  await runAction(
    { t: 'form', form: { ...form, minRarity: 'epic' }, menu: null },
    context(state, []),
  )
  expect([state.orders?.form?.minRarity, state.d.formAt, state.d.menu]).toEqual(['epic', 1, null])
})

test('on Orders with only the form open, a focus onto menu:3 writes formAt', () => {
  const stop: Stop = { key: 'menu:3', action: { t: 'none' }, cursor: true, index: 3 }
  expect(withCursor(DIALOG_DEFAULT, 'orders', stop).formAt).toBe(3)
  expect(withCursor(DIALOG_DEFAULT, 'market', stop)).toBe(DIALOG_DEFAULT)
})

test('leaving the chat field onto back lands on the newest row, not the oldest', () => {
  const view = { ...paneView(), account: { ...paneView().account, chatOpen: true } }
  const b = chatPane({ ...paneInput({ tab: 'chat', view, world: chatWorld(30) }) })
  const left = focusFrom(b, 'back', true)
  expect(left.t === 'land' ? left.stop.key : null).toBe('row:newest')
  // Without the field's mark, Tab past back wraps forward to the oldest row, as in PR 2.
  const wrapped = focusFrom(b, 'back', false)
  expect(wrapped.t === 'land' ? wrapped.stop.key : null).toBe('row:m-1')
  expect(focusFrom(b, 'compose', true)).toEqual({ t: 'pass' })
})

const withUnder = (field: PaneBuild['field'], link: PaneBuild['link']): PaneBuild => ({
  ...BUILD,
  field,
  link,
})
function underPane(on: On, build: PaneBuild) {
  on('ui.render', { component: 'Pane', requestId: 'pane-test' }, async ($, e) =>
    paneElement({
      els: $.ui.resolve(e) as PaneDraw['els'],
      surface: e.surface,
      renderer: 'raster',
      bodyColumns: e.props.bodyColumns,
      build,
      run: () => undefined,
      move: () => undefined,
      field: { onInput: () => undefined, onSubmit: () => undefined },
      probe: null,
    }),
  )
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`a build's link draws a Link under the picture on ${surface}`, async ($, on) => {
    underPane(on, withUnder(null, { url: 'https://github.com/login/device' }))
    const ui = await mountPane($, surface)
    // An inline element carries no key in the drawn tree: the Link is found by its type.
    const link = await ui.find({ type: 'Link' })
    expect([link?.type, link?.props.href]).toEqual(['Link', 'https://github.com/login/device'])
    await ui.unmount()
  })
}

test("a build's compose field draws an Input keyed compose with its props", async ($, on) => {
  const field = {
    key: 'compose' as const,
    label: 'say',
    placeholder: 'a message',
    value: 'hi',
    submitLabel: 'send',
  }
  underPane(on, withUnder(field, null))
  const ui = await mountPane($, 'terminal')
  const input = await ui.find({ key: 'compose' })
  expect([input?.type, input?.props.label, input?.props.value]).toEqual(['Input', 'say', 'hi'])
  await ui.unmount()
})

test('the ring landing on the ▶ itself writes no cursor, so a drawn default stays a default', async () => {
  // Market drawn before its page loads: the ▶ defaults to Filters, and autoFocus lands there.
  const before = marketPane({ ...paneInput({ tab: 'market' }) })
  expect(before.focus).toBe('row:filters')
  const landed = focusMove(before, 'row:filters', before.focus)
  expect(writesCursor(before, landed)).toBe(false)
  // So once the page loads the ▶ starts on the first listing.
  const after = marketPane({ ...paneInput({ tab: 'market', market: marketPage() }) })
  expect(after.focus).toBe('row:L1')
  // A person's move, and a redirect, write it.
  expect(writesCursor(after, focusMove(after, 'row:L2', after.focus))).toBe(true)
  expect(writesCursor(after, focusMove(after, 'back', after.focus))).toBe(true)
})

test('a second Yes before the redraw buys, cancels or resets nothing more', async () => {
  const { calls, game } = stubGame()
  const state: { d: DialogState } = {
    d: { ...DIALOG_DEFAULT, menu: { kind: 'confirm', action: 'buy', id: 'L1', at: 0 } },
  }
  const ctx = context(state, [], game)
  await Promise.all([
    runAction({ t: 'buy', listingId: 'L1' }, ctx),
    runAction({ t: 'buy', listingId: 'L1' }, ctx),
  ])
  expect(calls.filter((c) => c.startsWith('buy'))).toEqual(['buy L1'])
  // With no Yes/No open, cancel, reset and delete do nothing.
  await runAction({ t: 'cancel', what: 'order', id: 'O1' }, ctx)
  await runAction({ t: 'reset' }, ctx)
  await runAction({ t: 'delete' }, ctx)
  expect(calls).not.toContain('reset')
  expect(calls).not.toContain('deleteAccount')
})

test('a tab switch closes the sell flow and any sub-window', async () => {
  const sell = { kind: 'item' as const, id: 'i1', matching: [], price: '', error: null, at: 1 }
  const state: { d: DialogState } = {
    d: { ...DIALOG_DEFAULT, sell, menu: { kind: 'filter', at: 0 } },
  }
  await runAction({ t: 'tab', tab: 'market' }, context(state, []))
  expect([state.d.sell, state.d.menu]).toEqual([null, null])
  // So a move in Market's filter window writes its row, not a hidden sell window's.
  const stop: Stop = { key: 'menu:2', action: { t: 'none' }, cursor: true, index: 2 }
  const open = { ...state.d, menu: { kind: 'filter' as const, at: 0 } }
  expect(withCursor(open, 'market', stop).menu).toEqual({ kind: 'filter', at: 2 })
})

test('a Chat cursor left on the empty line follows the messages when they come', () => {
  const view = { ...paneView(), account: { ...paneView().account, chatOpen: true } }
  const b = chatPane({
    ...paneInput({ tab: 'chat', view, world: chatWorld(30) }),
    dialog: { ...DIALOG_DEFAULT, cursor: { chat: { id: 'empty', index: 0 } } },
  })
  expect(b.focus).toBe('row:newest')
})

test('a market page for a query no longer current is dropped', async () => {
  const pending: ((page: number) => void)[] = []
  const game = {
    market: {
      browse: (q: { page: number }) =>
        new Promise((resolve) => {
          pending.push(() => resolve({ listings: [], page: q.page, total: 0 }))
        }),
    },
    sync: async () => undefined,
  } as unknown as GameHandle
  let market: MarketState = MARKET_DEFAULT
  const upd = async (fn: (m: MarketState) => MarketState) => {
    market = fn(market)
  }
  const items = { kind: 'item' as const, sort: 'price' as const, page: 0 }
  const heroes = { kind: 'hero' as const, sort: 'price' as const, page: 3 }
  const first = loadMarket(game, items, upd, () => undefined)
  const second = loadMarket(game, heroes, upd, () => undefined)
  await Promise.resolve()
  pending[1]?.(3)
  await second
  pending[0]?.(0)
  await first
  expect(market.query).toEqual(heroes)
  expect(market.page?.page).toBe(3)
})

test('placeOrder sends nothing for a price out of range', async () => {
  const { calls, game } = stubGame()
  const form = { base: 'iron_sword', minRarity: 'rare' as const, affixId: null, maxPrice: '0' }
  await placeOrder(
    game,
    { ...ORDERS_DEFAULT, form },
    async () => undefined,
    () => undefined,
  )
  expect(calls).toEqual([])
})

test('on a terminal with a field, the hidden stops follow the field in the ring', async ($, on) => {
  const field = {
    key: 'compose' as const,
    label: 'say',
    placeholder: 'a message',
    value: '',
    submitLabel: 'send',
  }
  underPane(on, withUnder(field, null))
  const ui = await mountPane($, 'terminal')
  const order = (await ui.findAll({}))
    .map((e) => e.key)
    .filter((k) => k === 'compose' || k === 'row:a')
  // The field first: a row inserted among the stops (a message arriving) leaves its place alone.
  expect(order).toEqual(['compose', 'row:a'])
  await ui.unmount()
})

test('Shift+Tab off a field: past the engine stop the ring is off it, and lands leaving it', () => {
  const field = {
    key: 'compose' as const,
    label: 'say',
    placeholder: 'a message',
    value: '',
    submitLabel: 'send',
  }
  const a: PaneBuild = { ...BUILD, field }
  const b: PaneBuild = { ...a, stops: [row('o1', 0), ...a.stops] }
  refocusKey('s', stopsSignature(a, 'chat'), a)
  ringOnInput('s', true)
  // Shift+Tab: the engine stop first. A message arriving now goes back on the ▶, not the field.
  expect(ringMoved('s', undefined)).toBe(false)
  expect(refocusKey('s', stopsSignature(b, 'chat'), b)).toBe('row:a')
  placed('s', stopsSignature(b, 'chat'))
  // The next landing (the last tab) still counts as leaving the field: the ▶, not a wrap.
  expect(ringMoved('s', 'tab-market')).toBe(true)
  expect(ringMoved('s', 'row:b')).toBe(false)
})

test('Tab off a field onto the first tab lands on the ▶', () => {
  const left = focusFrom({ ...BUILD, focus: 'row:b' }, 'tab-inventory', true)
  expect(left.t === 'land' ? left.stop.key : null).toBe('row:b')
})

test('off a terminal a field the ring is on is left alone when the stops change', () => {
  const field = {
    key: 'compose' as const,
    label: 'say',
    placeholder: 'a message',
    value: '',
    submitLabel: 'send',
  }
  const a: PaneBuild = { ...BUILD, field }
  const b: PaneBuild = { ...a, stops: [row('o1', 0), ...a.stops] }
  refocusKey('d', stopsSignature(a, 'chat'), a, false)
  ringOnInput('d', true)
  expect(refocusKey('d', stopsSignature(b, 'chat'), b, false)).toBe(false)
})
