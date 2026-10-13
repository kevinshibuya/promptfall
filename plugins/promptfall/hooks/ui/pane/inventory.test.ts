import { expect, test } from 'claude-code/testing'
import type { DialogState, PaneMenu } from '../../../types'
import { RARITY_RGB } from '../../stage/tuning'
import { createInitialState, type Item } from '../../vendor/sim.js'
import { toAccountView, toGameView } from '../../view'
import { tilePositions } from '../../windows/kit'
import { DIM_RGB } from '../../windows/tuning'
import { item, paneInput, paneView } from './fixtures'
import type { PaneInput } from './input'
import { inventoryPane } from './inventory'
import { linesOf, textOf, win } from './testing'

function withDialog(patch: Partial<DialogState>, input: Partial<PaneInput> = {}): PaneInput {
  const base = paneInput(input)
  return { ...base, dialog: { ...base.dialog, ...patch } }
}
const menu = (m: PaneMenu) => withDialog({ menu: m })
const at = (id: string, index = 0) => ({ cursor: { inventory: { id, index }, heroes: null } })

test('the list rows: sprite, name in its rarity colour, wearer and shop value right-aligned', () => {
  const b = inventoryPane(paneInput())
  const list = win(b, 'list')
  expect(textOf(list?.title ?? [])).toBe('Inventory 3/20 · 1,240G')
  const rows = linesOf(list)
  expect(rows[0]).toBe(`▶ @@ Iron Sword${' '.repeat(51)}Aldric   12G`)
  expect(rows[1]).toBe(`  @@ Silk Robe${' '.repeat(60)}120G`)
  expect(rows[0]?.length).toBe(78)
  const silk = list?.lines[1]?.spans.find((s) => 'text' in s && s.text === 'Silk Robe')
  expect(silk).toEqual({ text: 'Silk Robe', rgb: RARITY_RGB.rare })
  const wearer = list?.lines[0]?.spans.find((s) => 'text' in s && s.text.trim() === 'Aldric')
  expect(wearer && 'rgb' in wearer ? wearer.rgb : 0).toBe(DIM_RGB)
})

test('raster draws no sprite cells; a 40-column pane keeps every column', () => {
  expect(
    linesOf(win(inventoryPane(paneInput({ art: false })), 'list'))[0]?.startsWith('▶ Iron Sword'),
  ).toBe(true)
  expect(win(inventoryPane(paneInput({ columns: 32 })), 'list')).toBeUndefined()
  const n = linesOf(win(inventoryPane(paneInput({ columns: 40 })), 'list'))
  expect(n[0]).toBe('▶ @@ Iron Sword           Aldric   12G')
})

test("the cursor row's detail lines", () => {
  const b = inventoryPane(withDialog(at('i2')))
  expect(linesOf(win(b, 'detail'))).toEqual([
    ' Silk Robe',
    ' Rare armour',
    ' +3 Defence',
    ' +5% Speed',
    '',
    ' Not worn',
    ' For BMage, WMage',
    ' Shop value 120G',
    ' Reforge 30G',
  ])
  expect(b.focus).toBe('row:i2')
  expect(linesOf(win(inventoryPane(paneInput()), 'detail'))).toEqual([
    ' Iron Sword',
    ' Common weapon',
    '',
    ' Worn by Aldric',
    ' For Knight',
    ' Shop value 12G',
  ])
})

test('the command window, per item, in order, with hotkeys', () => {
  const items = (id: string) => {
    const b = inventoryPane(menu({ kind: 'actions', tab: 'inventory', id, at: 0 }))
    return b.stops
      .filter((s) => s.key.startsWith('menu:'))
      .map((s) => [s.key, s.hotkey ?? '', s.action.t])
  }
  expect(items('i1')).toEqual([['menu:0', 'n', 'event']])
  expect(items('i2')).toEqual([
    ['menu:0', 'e', 'open'],
    ['menu:1', 's', 'sell'],
    ['menu:2', 'v', 'open'],
    ['menu:3', 'f', 'open'],
  ])
  const b = inventoryPane(menu({ kind: 'actions', tab: 'inventory', id: 'i3', at: 2 }))
  expect(linesOf(win(b, 'menu'))).toEqual([
    ' Jade Ring',
    ' Equip',
    ' Sell',
    '▶Vendor 300G',
    ' Reforge 30G',
  ])
  expect(b.focus).toBe('menu:2')
  expect(textOf(win(b, 'message')?.lines[0]?.spans ?? [])).toBe(' What will you do with Jade Ring?')
  // While the command window is open only its items are cursor stops.
  expect(b.stops.some((s) => s.key.startsWith('row:'))).toBe(false)
})

test("a tier-3 item's command window prices Reforge at its tier and its detail reads the affix at it", () => {
  const blade: Item = {
    id: 'iT',
    base: 'mithril_blade',
    rarity: 'uncommon',
    tier: 3,
    affixes: [{ id: 'brutal', value: 4 }],
    equippedBy: null,
    tradeableAt: null,
  }
  const state = { ...createInitialState(1), inventory: [blade] }
  const view = toGameView(state, 'a1', false, toAccountView(null, null, 'in-process', 0))
  const b = inventoryPane(
    withDialog({ menu: { kind: 'actions', tab: 'inventory', id: 'iT', at: 0 } }, { view }),
  )
  // An Uncommon's 25G at tier 3's ×3.5, floored; its Brutal rolled 4 and counts 14.
  expect(linesOf(win(b, 'menu'))).toContain(' Reforge 87G')
  expect(linesOf(win(b, 'detail'))).toContain(' Brutal +14 atk')
})

test('Unequip applies unequip; Vendor opens the Yes/No whose yes vendors', () => {
  const worn = inventoryPane(menu({ kind: 'actions', tab: 'inventory', id: 'i1', at: 0 }))
  expect(worn.stops.find((s) => s.key === 'menu:0')?.action).toEqual({
    t: 'event',
    event: { t: 'unequip', heroId: 'h1', slot: 'weapon' },
  })
  const silk = inventoryPane(menu({ kind: 'actions', tab: 'inventory', id: 'i2', at: 0 }))
  expect(silk.stops.find((s) => s.key === 'menu:2')?.action).toEqual({
    t: 'open',
    menu: { kind: 'confirm', action: 'vendor', id: 'i2', at: 0 },
  })
  const yn = inventoryPane(menu({ kind: 'confirm', action: 'vendor', id: 'i2', at: 0 }))
  expect(yn.stops.filter((s) => s.cursor).map((s) => [s.key, s.hotkey, s.action])).toEqual([
    ['yes', 'y', { t: 'event', event: { t: 'vendor', itemId: 'i2' } }],
    ['no', 'n', { t: 'back' }],
  ])
  expect(linesOf(win(yn, 'yesno'))).toEqual([' ▶Yes', '  No'])
  expect(textOf(win(yn, 'message')?.lines[0]?.spans ?? [])).toBe(
    ' Sell Silk Robe to the shop for 120G?',
  )
  expect(yn.focus).toBe('yes')
})

test('the equip pick lists only heroes of the item classes; with none Equip is dim and inert', () => {
  const b = inventoryPane(menu({ kind: 'equip', itemId: 'i2', at: 1 }))
  expect(linesOf(win(b, 'menu'))).toEqual([' Equip on', ' Mira  BMage L4', '▶Tomas  WMage L4'])
  expect(b.stops.find((s) => s.key === 'menu:1')?.action).toEqual({
    t: 'event',
    event: { t: 'equip', heroId: 'h3', itemId: 'i2' },
  })
  const view = paneView()
  view.inventory.push(item('i4', { name: 'Bone Staff', classes: ['necromancer'] }))
  const none = inventoryPane(
    withDialog({ menu: { kind: 'actions', tab: 'inventory', id: 'i4', at: 0 } }, { view }),
  )
  const equip = win(none, 'menu')?.lines[1]?.spans.find((s) => 'text' in s)
  expect(equip).toEqual({ text: 'Equip', rgb: DIM_RGB })
  expect(none.stops.find((s) => s.key === 'menu:0')?.action).toEqual({ t: 'none' })
  expect(textOf(win(none, 'message')?.lines[1]?.spans ?? [])).toBe(
    ' No hero of a class can wear it.',
  )
})

test('the reforge pick: one item per affix', () => {
  const b = inventoryPane(menu({ kind: 'reforge', itemId: 'i2', at: 0 }))
  expect(linesOf(win(b, 'menu'))).toEqual([' Reforge 30G', '▶+3 Defence', ' +5% Speed'])
  expect(b.stops.find((s) => s.key === 'menu:1')?.action).toEqual({
    t: 'event',
    event: { t: 'reforge', itemId: 'i2', affixIndex: 1 },
  })
})

test('read-only rows do nothing, and no sub-window opens', () => {
  const b = inventoryPane(
    withDialog(
      { menu: { kind: 'actions', tab: 'inventory', id: 'i2', at: 0 } },
      { readOnly: true, mode: 'secondary' },
    ),
  )
  expect(win(b, 'menu')).toBeUndefined()
  expect(b.stops.filter((s) => s.key.startsWith('row:')).every((s) => s.action.t === 'none')).toBe(
    true,
  )
  expect(b.stops.at(-1)).toEqual({
    key: 'claim',
    hotkey: 'p',
    action: { t: 'claim' },
    cursor: false,
  })
})

test('a cursor on a vendored id falls to the same index', () => {
  const view = paneView()
  view.inventory = view.inventory.filter((i) => i.id !== 'i2')
  const b = inventoryPane(withDialog(at('i2', 1), { view }))
  expect(b.focus).toBe('row:i3')
})

test('the sell window replaces the detail window', () => {
  const sell = { kind: 'item' as const, id: 'i2', matching: [], price: '', error: null, at: 0 }
  const b = inventoryPane(withDialog({ sell }))
  expect(win(b, 'detail')).toBeUndefined()
  expect(win(b, 'sell')?.columns).toBe(40)
  expect(win(b, 'sell')?.rows).toBe(17)
  expect(b.focus).toBe('menu:0')
  expect(b.field?.key).toBe('price')
})

test('wide and narrow scenes, with each sub-window, pass tilePositions', () => {
  const sell = { kind: 'item' as const, id: 'i2', matching: [], price: '', error: null, at: 0 }
  const dialogs: Partial<DialogState>[] = [
    {},
    { menu: { kind: 'actions', tab: 'inventory', id: 'i2', at: 0 } },
    { menu: { kind: 'confirm', action: 'vendor', id: 'i2', at: 1 } },
    { sell },
  ]
  for (const columns of [120, 60]) {
    for (const d of dialogs) {
      const b = inventoryPane(withDialog(d, { columns }))
      const positions = tilePositions(b.scene)
      for (const w of b.scene.windows)
        expect([w.key, positions.get(w.key)]).toEqual([w.key, { x: w.x, y: w.y ?? 0 }])
    }
  }
})

test('40 items at 120 × 24 show 15 rows and the footer', () => {
  const view = paneView()
  view.inventory = Array.from({ length: 40 }, (_, i) => item(`x${i}`))
  const b = inventoryPane(withDialog(at('x20', 20), { view }))
  const list = win(b, 'list')
  expect(list?.lines.length).toBe(15)
  expect(textOf(list?.footer ?? [])).toBe('16-30/40▼')
  expect(b.stops.filter((s) => s.key.startsWith('row:')).length).toBe(40)
})

test('an empty inventory: one line, its row:empty stop doing nothing (grill 1.21)', () => {
  const view = paneView()
  view.inventory = []
  const b = inventoryPane(paneInput({ view }))
  expect(linesOf(win(b, 'list'))).toEqual(['  Nothing yet.'])
  expect(b.stops.filter((s) => s.cursor)).toEqual([
    { key: 'row:empty', action: { t: 'none' }, cursor: true, index: 0 },
  ])
  expect(b.focus).toBe('row:empty')
  expect(textOf(win(b, 'message')?.lines[0]?.spans ?? [])).toBe(' Items drop as the party fights.')
})
