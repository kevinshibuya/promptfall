import { expect, test } from 'claude-code/testing'
import type { Listing } from './vendor/protocol.js'
import { createInitialState, fill, heroFill, heroStats, type Item, step } from './vendor/sim.js'
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

test("an item's affixes carry their value and their tier-scaled range", () => {
  const account = toAccountView(null, null, 'in-process', 0)
  const at = (tier: number) =>
    toGameView({ ...createInitialState(1), inventory: [{ ...blade, tier }] }, 'a1', false, account)
      .inventory[0]
  // Brutal rolls 2 to 4: at ×3.5 its 4 counts 14 and its ends 7 and 14, floored as the value is.
  expect(at(3)?.affixRolls).toEqual([{ value: 14, min: 7, max: 14 }])
  expect(at(1)?.affixRolls).toEqual([{ value: 4, min: 2, max: 4 }])
  // The strings stay beside the field.
  expect(at(3)?.affixes).toEqual(['Brutal +14 atk'])
})

test('a hero fills at the sim’s own rate, hasted and guarding, and the views carry the states', () => {
  const account = toAccountView(null, null, 'in-process', 0)
  let s = step(createInitialState(1), { t: 'tool_call' }).state
  const knight = s.roster[0]
  if (!knight) throw new Error('no knight')
  const plain = toGameView(s, 'a1', false, account)
  expect(plain.heroes[0]).toMatchObject({ hasted: false, guarding: false })
  expect(plain.heroes[0]?.gaugePerStep).toBe(fill(heroStats(s, knight).spd))
  expect(plain.enemies[0]?.enraged).toBe(false)

  s = step(step(s, { t: 'turn_start' }).state, { t: 'tool_mishap' }).state
  const hasted = toGameView(s, 'a1', false, account)
  expect(hasted.heroes[0]).toMatchObject({ hasted: true, guarding: false })
  expect(hasted.heroes[0]?.gaugePerStep).toBe(heroFill(s, knight))
  expect(hasted.heroes[0]?.gaugePerStep).toBeGreaterThan(plain.heroes[0]?.gaugePerStep ?? 0)
  expect(hasted.enemies[0]?.enraged).toBe(true)

  s = step(s, { t: 'guard', on: true }).state
  const guarding = toGameView(s, 'a1', false, account)
  expect(guarding.heroes[0]).toMatchObject({ hasted: true, guarding: true, gaugePerStep: 0 })
})

test('the view carries the tallies and the recruits remaining to each guarantee', () => {
  const account = toAccountView(null, null, 'in-process', 0)
  const s0 = createInitialState(1)
  const fresh = toGameView(s0, 'a1', false, account)
  expect(fresh.tallies.goldEarned).toBe(0)
  expect(fresh.tallies.enemies).toEqual({})
  expect(fresh.guarantees).toEqual({ rare: 20, epic: 80, legendary: 400 })

  // The call opens a wave: its enemy and the draw come on together, and the sandbox kills the front.
  let s = step(s0, { t: 'tool_call' }).state
  const front = s.encounter?.enemies[0]
  if (!front) throw new Error('nothing spawned')
  const seen = s.encounter?.enemies.filter((e) => e.def === front.def).length
  s = step(s, { t: 'sandbox_item', base: 'oak_staff', rarity: 'epic' }).state
  s = { ...s, guarantee: { rare: 19, epic: 3, legendary: 7 } }
  const v = toGameView(s, 'a1', false, account)
  expect(v.tallies.enemies).toEqual(s.tallies.enemies)
  expect(v.tallies.enemies[front.def]).toEqual({ seen, defeated: 1 })
  expect(v.tallies.collection.oak_staff?.epic).toBe(1)
  expect(v.tallies.drops.epic).toBe(1)
  expect(v.tallies.goldEarned).toBe(s.tallies.goldEarned)
  expect(v.guarantees).toEqual({ rare: 1, epic: 77, legendary: 393 })

  // A state from before version 16 reads as zero.
  const { tallies: _t, guarantee: _g, ...old } = s0
  const before = toGameView(old as typeof s0, 'a1', false, account)
  expect(before.tallies.zoneBosses).toBe(0)
  expect(before.guarantees).toEqual({ rare: 20, epic: 80, legendary: 400 })
})
