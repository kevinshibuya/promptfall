import { expect, test } from 'claude-code/testing'
import type { Listing } from './vendor/protocol.js'
import { createInitialState, type Item } from './vendor/sim.js'
import { listingView, toAccountView, toGameView } from './view'

/** An Uncommon tier-3 blade whose Brutal rolled 4: it counts as 14 at ×3.5. */
const blade: Item = {
  id: 'iT',
  base: 'mithril_blade',
  rarity: 'uncommon',
  tier: 3,
  affixes: [{ id: 'brutal', value: 4 }],
  equippedBy: null,
  tradeableAt: null,
}

test('a Loot row carries its item and its kind; a hero contract sold off is a market row', () => {
  const state = {
    ...createInitialState(1),
    lootLog: [
      { k: 'item', itemId: 'i1', base: 'silk_robe', rarity: 'rare', vendoredFor: null },
      { k: 'item', itemId: 'i2', base: 'oak_staff', rarity: 'common', vendoredFor: 3 },
      { k: 'item', itemId: 'i3', base: 'contract', rarity: 'rare', vendoredFor: 90 },
    ],
  } as never
  const view = toGameView(state, 'a1', false, toAccountView(null, null, 'in-process', 0))
  expect(view.loot.map(({ kind, itemId }) => ({ kind, itemId }))).toEqual([
    { kind: 'drop', itemId: 'i1' },
    { kind: 'vendored', itemId: 'i2' },
    { kind: 'market', itemId: 'i3' },
  ])
  expect(view.loot[2]?.text).toBe('Hero contract sold for 90g')
})

test("a listing reads an item's affixes at its tier", () => {
  const listing: Listing = {
    id: 'l1',
    sellerId: 'a2',
    sellerName: 'Cy',
    goods: { kind: 'item', item: blade },
    price: 50,
    createdAt: 0,
    expiresAt: 1,
  }
  expect(listingView(listing).detail).toBe('Brutal +14')
  const tier1 = { ...listing, goods: { kind: 'item', item: { ...blade, tier: 1 } } } as Listing
  expect(listingView(tier1).detail).toBe('Brutal +4')
})

test("an inventory item's affixes and reforge price read its tier", () => {
  const state = { ...createInitialState(1), inventory: [blade] }
  const view = toGameView(state, 'a1', false, toAccountView(null, null, 'in-process', 0))
  const item = view.inventory.find((i) => i.id === 'iT')
  expect(item?.affixes).toEqual(['Brutal +14 atk'])
  // An Uncommon's 25G at ×3.5, floored.
  expect(item?.reforgeCost).toBe(87)
})
