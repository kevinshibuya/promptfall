import { expect, test } from 'claude-code/testing'
import { createInitialState } from './vendor/sim.js'
import { toAccountView, toGameView } from './view'

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
