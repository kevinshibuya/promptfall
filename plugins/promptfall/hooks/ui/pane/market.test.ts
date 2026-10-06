import { expect, test } from 'claude-code/testing'
import type { DialogState, MarketState, PaneMenu } from '../../../types'
import { RARITY_RGB } from '../../stage/tuning'
import { tilePositions } from '../../windows/kit'
import { DOWN_RGB, GAUGE_FULL_RGB, WARN_RGB } from '../../windows/tuning'
import { GATE_UNLINKED } from '../trade'
import { marketPage, paneInput, paneView } from './fixtures'
import type { PaneInput } from './input'
import { marketPane, searchText } from './market'
import { linesOf, textOf, win } from './testing'

function input(
  market: Partial<MarketState> = {},
  dialog: Partial<DialogState> = {},
  patch: Partial<PaneInput> = {},
): PaneInput {
  const base = paneInput({ tab: 'market', remainingMs: (d) => d, ...patch })
  return {
    ...base,
    market: { ...marketPage(), ...market },
    dialog: { ...base.dialog, ...dialog },
  }
}
const menu = (m: PaneMenu, market: Partial<MarketState> = {}) => input(market, { menu: m })
const cursors = (b: ReturnType<typeof marketPane>) => b.stops.filter((s) => s.cursor)
const message = (b: ReturnType<typeof marketPane>) =>
  linesOf(win(b, 'message')).map((l) => l.trim())

test('the title, the rows in order, the price and seller columns, yours', () => {
  const b = marketPane(input())
  const list = win(b, 'list')
  expect(textOf(list?.title ?? [])).toBe('Market: items, cheapest · 1,240G')
  expect(cursors(b).map((s) => s.key)).toEqual([
    'row:filters',
    'row:L1',
    'row:L2',
    'row:L3',
    'row:next',
  ])
  const lines = linesOf(list)
  expect(lines[0]).toBe('     Filters')
  expect(lines[1]).toMatch(/^▶ @@ Steel Longsword +mira +1,200G$/)
  expect(lines[2]).toMatch(/^ {2}@@ Sela the Bold +yours +4,800G$/)
  expect(lines[3]?.endsWith('tomas    25,000G')).toBe(true)
  expect(lines[4]).toBe('     Next page')
  expect(lines[1]?.length).toBe(78)
  // The `f` of Filters is gold; the names in their rarity colours.
  expect(list?.lines[0]?.spans).toContainEqual({ text: 'F', rgb: GAUGE_FULL_RGB })
  expect(list?.lines[2]?.spans).toContainEqual({ text: 'Sela the Bold', rgb: RARITY_RGB.epic })
  expect(cursors(b)[0]?.hotkey).toBe('f')
})

test('Enter on a listing asks to buy it; on yours it does nothing; the default ▶ is the first listing', () => {
  const b = marketPane(input())
  expect(b.focus).toBe('row:L1')
  const at = (key: string) => cursors(b).find((s) => s.key === key)?.action
  expect(at('row:L1')).toEqual({
    t: 'open',
    menu: { kind: 'confirm', action: 'buy', id: 'L1', at: 0 },
  })
  expect(at('row:L2')).toEqual({ t: 'none' })
  expect(at('row:next')).toEqual({
    t: 'query',
    query: { kind: 'item', sort: 'price', page: 1 },
    menu: null,
  })
  // With nothing listed the ▶ starts on Filters.
  const empty = marketPane(input({ page: { listings: [], page: 0, total: 0 } }))
  expect(empty.focus).toBe('row:filters')
  expect(linesOf(win(empty, 'list'))[1]).toBe('  No listings match.')
})

test('a later page has Previous page before the listings', () => {
  const page = marketPage().page
  const b = marketPane(
    input({
      query: { kind: 'item', sort: 'price', page: 2 },
      page: page ? { ...page, page: 2 } : null,
    }),
  )
  expect(cursors(b).map((s) => s.key)).toEqual([
    'row:filters',
    'row:prev',
    'row:L1',
    'row:L2',
    'row:L3',
  ])
  expect(cursors(b)[1]?.action).toEqual({
    t: 'query',
    query: { kind: 'item', sort: 'price', page: 1 },
    menu: null,
  })
})

test('the filter window: its items, and the query each flips', () => {
  const q = {
    kind: 'item' as const,
    base: 'iron_sword',
    minRarity: 'rare' as const,
    sort: 'price' as const,
    page: 1,
  }
  const b = marketPane(menu({ kind: 'filter', at: 1 }, { query: q }))
  expect(linesOf(win(b, 'menu'))).toEqual([
    ' Filters',
    ' Kind: items',
    '▶Sort: cheapest',
    ' Base: Iron Sword',
    ' Rarity: rare+',
  ])
  expect(b.focus).toBe('menu:1')
  const actions = cursors(b).map((s) => s.action)
  // The kind flip drops the base and keeps the rarity.
  expect(actions[0]).toEqual({
    t: 'query',
    query: { kind: 'hero', sort: 'price', page: 0, minRarity: 'rare' },
    menu: { kind: 'filter', at: 0 },
  })
  expect(actions[1]).toEqual({
    t: 'query',
    query: { ...q, sort: 'newest', page: 0 },
    menu: { kind: 'filter', at: 1 },
  })
  expect(actions[2]).toEqual({ t: 'open', menu: { kind: 'pick', field: 'base', at: 15 } })
  expect(actions[3]).toEqual({ t: 'open', menu: { kind: 'pick', field: 'minRarity', at: 1 } })
  expect(message(b)).toEqual(['Change the search.', 'q: back.'])
  const heroes = marketPane(
    menu({ kind: 'filter', at: 0 }, { query: { kind: 'hero', sort: 'newest', page: 0 } }),
  )
  expect(linesOf(win(heroes, 'menu'))[3]).toBe(' Class: any')
})

test('a Base pick lists 41 items, any first, pages, and picking returns to the filter window', () => {
  const b = marketPane(menu({ kind: 'pick', field: 'base', at: 20 }))
  const items = cursors(b)
  expect(items.length).toBe(41)
  const m = win(b, 'menu')
  expect(textOf(m?.footer ?? [])).toMatch(/\/41/)
  expect(items[0]?.action).toEqual({
    t: 'query',
    query: { kind: 'item', sort: 'price', page: 0 },
    menu: { kind: 'filter', at: 2 },
  })
  expect(items[1]?.action).toMatchObject({
    query: { base: 'astral_robe' },
    menu: { kind: 'filter', at: 2 },
  })
  expect(message(b)).toEqual(['Show which base?', 'q: back.'])
  const rarity = marketPane(menu({ kind: 'pick', field: 'minRarity', at: 2 }))
  expect(linesOf(win(rarity, 'menu'))).toEqual([' Rarity', ' any', ' rare', '▶epic', ' legendary'])
  expect(cursors(rarity)[2]?.action).toMatchObject({
    query: { minRarity: 'epic', page: 0 },
    menu: { kind: 'filter', at: 3 },
  })
})

test('the buy Yes/No: its question, and Yes runs buy', () => {
  const b = marketPane(menu({ kind: 'confirm', action: 'buy', id: 'L3', at: 0 }))
  expect(cursors(b).map((s) => [s.key, s.action])).toEqual([
    ['yes', { t: 'buy', listingId: 'L3' }],
    ['no', { t: 'back' }],
  ])
  expect(message(b)).toEqual(['Buy Phoenix Pendant for 25,000G?', ''])
  expect(linesOf(win(b, 'detail'))[0]).toBe(' Phoenix Pendant')
})

test('a gate: the listings do nothing, the gate line in the message window; read-only keeps Filters', () => {
  const view = { ...paneView(), account: { ...paneView().account, linked: null } }
  const b = marketPane(input({}, {}, { view }))
  expect(cursors(b).find((s) => s.key === 'row:L1')?.action).toEqual({ t: 'none' })
  expect(win(b, 'message')?.lines[0]?.spans).toContainEqual({ text: GATE_UNLINKED, rgb: WARN_RGB })
  expect(message(b)[1]).toBe('Browsing still works.')
  const ro = marketPane(input({}, {}, { readOnly: true, mode: 'secondary' }))
  expect(cursors(ro).find((s) => s.key === 'row:L1')?.action).toEqual({ t: 'none' })
  expect(cursors(ro)[0]?.action).toEqual({ t: 'open', menu: { kind: 'filter', at: 0 } })
  // A filter window still opens over a read-only list.
  expect(
    win(marketPane(input({}, { menu: { kind: 'filter', at: 0 } }, { readOnly: true })), 'menu'),
  ).toBeDefined()
})

test('market.error reads red; no page reads Loading while busy, else Nothing loaded yet', () => {
  const b = marketPane(input({ error: 'Not enough gold' }))
  expect(win(b, 'message')?.lines[0]?.spans).toContainEqual({
    text: 'Not enough gold',
    rgb: DOWN_RGB,
  })
  const busy = marketPane(input({ page: null, busy: true }))
  expect(linesOf(win(busy, 'list'))).toEqual(['▶    Filters', '  Loading the market…'])
  expect(message(busy)).toEqual(['Enter: change the search.', 'Loading the market…'])
  expect(linesOf(win(marketPane(input({ page: null })), 'list'))[1]).toBe('  Nothing loaded yet.')
})

test('the messages on a listing, your listing and a page row', () => {
  expect(message(marketPane(input()))).toEqual([
    'Enter: buy. Tab or arrows: move.',
    'Page 1 of 3 · 23 listings.',
  ])
  const yours = marketPane(input({}, { cursor: { market: { id: 'L2', index: 2 } } }))
  expect(message(yours)).toEqual(['This listing is yours.', 'Tab or arrows: move.'])
  const next = marketPane(input({}, { cursor: { market: { id: 'next', index: 4 } } }))
  expect(message(next)).toEqual(['Enter: next page.', 'Page 1 of 3 · 23 listings.'])
})

test('the detail of a listing and of Filters', () => {
  expect(linesOf(win(marketPane(input()), 'detail'))).toEqual([
    ' Steel Longsword',
    ' Rare weapon',
    ' Keen +2, Swift +1',
    '',
    ' Seller mira',
    ' Price 1,200G',
    ' Expires in 6d',
  ])
  const hero = marketPane(input({}, { cursor: { market: { id: 'L2', index: 2 } } }))
  expect(linesOf(win(hero, 'detail')).slice(1, 5)).toEqual([
    ' Epic Archer',
    ' archer · Brave',
    '',
    ' Your listing',
  ])
  const filters = marketPane(input({}, { cursor: { market: { id: 'filters', index: 0 } } }))
  expect(linesOf(win(filters, 'detail'))).toEqual([
    ' Search',
    ' Kind    items',
    ' Sort    cheapest',
    ' Base    any',
    ' Rarity  any',
    '',
    ' Page 1 of 3 · 23 listings',
  ])
})

test('searchText names every set filter', () => {
  expect(
    searchText({ kind: 'hero', cls: 'black_mage', minRarity: 'epic', sort: 'newest', page: 0 }),
  ).toBe('heroes, BMage, epic+, newest')
})

test('wide and narrow scenes, with each sub-window, pass tilePositions', () => {
  const menus: (PaneMenu | null)[] = [
    null,
    { kind: 'filter', at: 0 },
    { kind: 'pick', field: 'base', at: 0 },
    { kind: 'confirm', action: 'buy', id: 'L1', at: 1 },
  ]
  for (const columns of [120, 60]) {
    for (const m of menus) {
      const b = marketPane(input({}, { menu: m }, { columns }))
      const at = tilePositions(b.scene)
      for (const w of b.scene.windows)
        expect([w.key, at.get(w.key)]).toEqual([w.key, { x: w.x, y: w.y ?? 0 }])
    }
  }
  // Narrow drops the seller column under 40 cells.
  const narrow = linesOf(win(marketPane(input({}, {}, { columns: 40 })), 'list'))
  expect(narrow[1]?.includes('mira')).toBe(false)
})

test('the narrow band keeps the seller and the price in its four lines', () => {
  const b = marketPane(input({}, {}, { columns: 60 }))
  expect(linesOf(win(b, 'detail'))).toEqual([
    ' Steel Longsword',
    ' Rare weapon',
    ' Seller mira',
    ' Price 1,200G',
  ])
})
