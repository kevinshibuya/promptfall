import type { On } from 'claude-code'
import { expect, type TestBody, test } from 'claude-code/testing'
import type { DialogState } from '../../../types'
import { DIALOG_DEFAULT } from '../../state'
import type { PlayerEvent } from '../../vendor/sim.js'
import type { PaneScene, Win } from '../../windows/kit'
import { paneInput } from './fixtures'
import { inventoryPane } from './inventory'
import {
  type ActionContext,
  closed,
  focusMove,
  type PaneDraw,
  paneElement,
  runAction,
  stepCursor,
  takeRefocus,
  withCursor,
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
  priceInput: false,
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
      price: null,
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

function context(state: { d: DialogState }, events: PlayerEvent[]): ActionContext {
  return {
    upd: async (fn) => {
      state.d = fn(state.d)
    },
    game: () => null,
    act: async (event) => {
      events.push(event)
    },
    openTab: async () => undefined,
    after: () => undefined,
    remaining: () => undefined,
    focusPrice: async () => undefined,
    dialog: async () => state.d,
  }
}

test('actions: open, back, an event closing the menu, the third pick sending the party', async () => {
  const state = { d: DIALOG_DEFAULT }
  const events: PlayerEvent[] = []
  const ctx = context(state, events)
  takeRefocus()
  await runAction({ t: 'open', menu: { kind: 'actions', tab: 'inventory', id: 'i2', at: 0 } }, ctx)
  expect(state.d.menu?.kind).toBe('actions')
  // An action that changes the stops asks the next drawing to put the ring on its focus.
  expect(takeRefocus()).toBe(true)
  expect(takeRefocus()).toBe(false)
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
