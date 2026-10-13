import { describe, expect, it } from 'vitest'
import { content } from './content'
import { hashState } from './hash'
import { rollContract } from './heroes'
import { vendorValue } from './loot'
import { createInitialState } from './state'
import { replay, step } from './step'
import type { Effect, Enemy, EnemyKind, Event, GameState, Item, Rarity } from './types'

const s0 = createInitialState(1)

function zone(n: number) {
  const z = content.zones[n - 1]
  if (!z) throw new Error(`zone ${n}`)
  return z
}

function item(id: string, base: string, rarity: Rarity): Item {
  return { id, base, rarity, tier: 1, affixes: [], equippedBy: null, tradeableAt: null }
}

function run(state: GameState, events: Event[]): GameState {
  const r = replay(state, events)
  const rejected = r.effects.find((e) => e.k === 'rejected')
  if (rejected?.k === 'rejected') throw new Error(`rejected: ${rejected.reason}`)
  return r.state
}

/** The state with one enemy of this definition on the field, alone, at `hp`. */
function facing(state: GameState, def: string, kind: EnemyKind, hp = 1): GameState {
  const enemy: Enemy = { id: 'etally', def, kind, hp, maxHp: 999, enraged: false }
  return {
    ...state,
    encounter: { enemies: [enemy], queue: [], waveSize: 0, spawnedInWave: 0 },
    battle: { gauges: [{ id: 'etally', g: 0 }], queue: [], busy: 0 },
  }
}

/** Ticks until the enemy on the field falls. */
function fightToKill(state: GameState): { state: GameState; effects: Effect[] } {
  let s = state
  const effects: Effect[] = []
  for (let i = 0; i < 50 && s.stats.kills === state.stats.kills; i++) {
    const r = step(s, { t: 'tick' })
    s = r.state
    effects.push(...r.effects)
  }
  if (s.stats.kills === state.stats.kills) throw new Error('no kill')
  return { state: s, effects }
}

describe('the bestiary tallies', () => {
  it('starts at zero', () => {
    expect(s0.tallies.enemies).toEqual({})
    expect(s0.tallies.collection).toEqual({})
    expect(s0.tallies.zoneBosses).toBe(0)
  })

  it('a spawn raises seen for its definition', () => {
    const s = step(s0, { t: 'tool_call', hint: 'swift' }).state
    const def = s.encounter?.enemies[0]?.def
    if (!def) throw new Error('no spawn')
    expect(s.tallies.enemies[def]).toEqual({ seen: 1, defeated: 0 })
    const again = step(s, { t: 'tool_call', hint: 'swift' }).state
    expect(again.tallies.enemies[def]).toEqual({ seen: 2, defeated: 0 })
  })

  it('a kill raises defeated for that definition', () => {
    const def = zone(1).enemies[0] ?? ''
    const { state } = fightToKill(facing(s0, def, 'wave'))
    expect(state.tallies.enemies[def]?.defeated).toBe(1)
    expect(state.tallies.zoneBosses).toBe(0)
    expect(state.tallies.turnBosses).toBe(0)
  })

  it('a zone boss kill raises the zone boss count, and the clean count with no wipe in the zone', () => {
    const boss = zone(1).boss
    const clean = fightToKill(facing({ ...s0, wave: 11 }, boss, 'zone_boss')).state
    expect(clean.tallies.enemies[boss]?.defeated).toBe(1)
    expect(clean.tallies.zoneBosses).toBe(1)
    expect(clean.tallies.cleanZoneBosses).toBe(1)
    expect(clean.tallies.turnBosses).toBe(0)

    const wiped = fightToKill(facing({ ...s0, wave: 11, zoneWipes: 1 }, boss, 'zone_boss')).state
    expect(wiped.tallies.zoneBosses).toBe(1)
    expect(wiped.tallies.cleanZoneBosses).toBe(0)
    // The kill resets the zone's wipe count; the clean mark was read before it.
    expect(wiped.zoneWipes).toBe(0)
  })

  it('a turn boss kill raises the turn boss count alone', () => {
    const boss = zone(1).turnBoss
    const s = fightToKill(facing(s0, boss, 'turn_boss')).state
    expect(s.tallies.turnBosses).toBe(1)
    expect(s.tallies.zoneBosses).toBe(0)
    expect(s.tallies.enemies[boss]?.defeated).toBe(1)
  })

  it('the existing kill and boss totals stay where they are', () => {
    const s = fightToKill(facing(s0, zone(1).turnBoss, 'turn_boss')).state
    expect(s.stats).toEqual({ kills: 1, bosses: 1, wipes: 0 })
  })
})

describe('the collection and the drop tallies', () => {
  it('a drop marks the base at its rarity and counts the drop by rarity', () => {
    const s = run(s0, [
      { t: 'sandbox_item', base: 'steel_longsword', rarity: 'rare' },
      { t: 'sandbox_item', base: 'steel_longsword', rarity: 'rare' },
      { t: 'sandbox_item', base: 'steel_longsword', rarity: 'epic' },
    ])
    expect(s.tallies.collection.steel_longsword).toEqual({
      common: 0,
      uncommon: 0,
      rare: 1,
      epic: 1,
      legendary: 0,
    })
    expect(s.tallies.drops).toEqual({ common: 0, uncommon: 0, rare: 2, epic: 1, legendary: 0 })
  })

  it('a drop vendored for lack of room or by the setting still marks and counts', () => {
    const full: GameState = {
      ...s0,
      inventoryCap: 1,
      inventory: [item('ifull', 'oak_staff', 'common')],
    }
    const a = step(full, { t: 'sandbox_item', base: 'steel_longsword', rarity: 'uncommon' })
    expect(a.effects.some((e) => e.k === 'drop_vendored' && e.cause === 'full')).toBe(true)
    expect(a.state.tallies.collection.steel_longsword?.uncommon).toBe(1)
    expect(a.state.tallies.drops.uncommon).toBe(1)

    // No hero of the starting party draws a bow: the setting sells a Common one.
    const b = step(
      { ...s0, autoVendor: true },
      { t: 'sandbox_item', base: 'oak_bow', rarity: 'common' },
    )
    expect(b.effects.some((e) => e.k === 'drop_vendored' && e.cause === 'setting')).toBe(true)
    expect(b.state.tallies.collection.oak_bow?.common).toBe(1)
    expect(b.state.tallies.drops.common).toBe(1)
  })

  it('a purchase, a filled order, a reward and a return mark the collection and count no drop', () => {
    const rich = { ...s0, gold: 1000 }
    const events: Event[] = [
      {
        t: 'bought',
        listingId: 'L1',
        goods: { kind: 'item', item: item('t1', 'steel_longsword', 'rare') },
        price: 10,
      },
      { t: 'order_filled', orderId: 'O1', item: item('t2', 'oak_bow', 'epic'), price: 10 },
      {
        t: 'rewarded',
        bossId: 'wb',
        goods: { kind: 'item', item: item('t3', 'oak_staff', 'legendary') },
        gold: 0,
      },
      {
        t: 'returned',
        listingId: 'L2',
        goods: { kind: 'item', item: item('t4', 'oak_staff', 'uncommon') },
      },
    ]
    const s = run(rich, events)
    expect(s.tallies.collection.steel_longsword?.rare).toBe(1)
    expect(s.tallies.collection.oak_bow?.epic).toBe(1)
    expect(s.tallies.collection.oak_staff).toMatchObject({ legendary: 1, uncommon: 1 })
    expect(s.tallies.drops).toEqual({ common: 0, uncommon: 0, rare: 0, epic: 0, legendary: 0 })
  })
})

describe('the recruit and reforge tallies', () => {
  it('a tavern recruit, a contract and a sandbox recruit each count a recruit by rarity', () => {
    const tavern = step({ ...s0, gold: 1000 }, { t: 'recruit' })
    const hired = tavern.effects.find((e) => e.k === 'hero_recruited')
    if (hired?.k !== 'hero_recruited') throw new Error('no recruit')
    expect(tavern.state.tallies.recruits[hired.hero.rarity]).toBe(1)

    const sandbox = step(s0, { t: 'sandbox_recruit', rarity: 'epic' }).state
    expect(sandbox.tallies.recruits).toEqual({
      common: 0,
      uncommon: 0,
      rare: 0,
      epic: 1,
      legendary: 0,
    })

    const s = structuredClone(s0)
    const effects: Effect[] = []
    rollContract(s, effects)
    const contract = effects.find((e) => e.k === 'hero_recruited')
    if (contract?.k !== 'hero_recruited') throw new Error('no contract')
    expect(s.tallies.recruits[contract.hero.rarity]).toBe(1)
  })

  it('a reforge counts', () => {
    const blade: Item = {
      ...item('iA', 'steel_longsword', 'rare'),
      affixes: [{ id: 'brutal', value: 2 }],
    }
    const s = step(
      { ...s0, gold: 1000, inventory: [blade] },
      {
        t: 'reforge',
        itemId: 'iA',
        affixIndex: 0,
      },
    ).state
    expect(s.tallies.reforges).toBe(1)
  })
})

describe('the gold earned tally', () => {
  const blade = item('iA', 'steel_longsword', 'rare')
  const rich: GameState = { ...s0, gold: 1000, inventory: [blade, item('iB', 'oak_bow', 'rare')] }

  it('adds kill gold', () => {
    const { state, effects } = fightToKill(facing(s0, zone(1).enemies[0] ?? '', 'wave'))
    const gold = effects.reduce((sum, e) => sum + (e.k === 'gold' ? e.amount : 0), 0)
    expect(gold).toBeGreaterThan(0)
    expect(state.tallies.goldEarned).toBe(gold)
  })

  it('adds vendoring, of a drop, an item and a contract', () => {
    const vendored = step(rich, { t: 'vendor', itemId: 'iA' }).state
    expect(vendored.tallies.goldEarned).toBe(vendorValue(blade))

    const full = { ...s0, inventoryCap: 0 }
    const dropped = step(full, { t: 'sandbox_item', base: 'steel_longsword', rarity: 'rare' })
    expect(dropped.state.tallies.goldEarned).toBe(vendorValue(item('x', 'steel_longsword', 'rare')))

    const s = structuredClone({ ...s0, rosterCap: 4 })
    const effects: Effect[] = []
    rollContract(s, effects)
    const paid = effects.find((e) => e.k === 'gold')
    if (paid?.k !== 'gold') throw new Error('no contract gold')
    expect(s.tallies.goldEarned).toBe(paid.amount)
  })

  it("adds a sale's net, a reward's gold and a credit", () => {
    const s = run(rich, [
      { t: 'listed', listingId: 'L1', kind: 'item', id: 'iA', fee: 5 },
      {
        t: 'sold',
        listingId: 'L1',
        kind: 'item',
        base: 'steel_longsword',
        rarity: 'rare',
        price: 100,
        net: 95,
      },
      {
        t: 'order_sold',
        orderId: 'O1',
        itemId: 'iB',
        base: 'oak_bow',
        rarity: 'rare',
        price: 50,
        net: 48,
      },
      { t: 'rewarded', bossId: 'wb', goods: null, gold: 45 },
      { t: 'credited', gold: 300, reason: 'goal:1' },
    ])
    expect(s.tallies.goldEarned).toBe(95 + 48 + 45 + 300)
  })

  it('never counts a refund, escrow coming back or a purchase', () => {
    const s = run(rich, [
      { t: 'order_placed', orderId: 'O1', escrow: 400 },
      { t: 'order_refunded', orderId: 'O1', escrow: 400 },
      {
        t: 'bought',
        listingId: 'L1',
        goods: { kind: 'item', item: item('t1', 'oak_staff', 'common') },
        price: 10,
      },
      { t: 'order_placed', orderId: 'O2', escrow: 100 },
      { t: 'order_filled', orderId: 'O2', item: item('t2', 'oak_staff', 'common'), price: 100 },
    ])
    expect(s.gold).toBe(1000 - 10 - 100)
    expect(s.tallies.goldEarned).toBe(0)
  })
})

describe('the tallies and the hash', () => {
  it('every tally moves the hash', () => {
    const base = run(s0, [{ t: 'sandbox_item', base: 'oak_staff', rarity: 'common' }])
    const t = base.tallies
    const variants: GameState['tallies'][] = [
      { ...t, enemies: { ...t.enemies, goblin_scout: { seen: 1, defeated: 0 } } },
      { ...t, enemies: { ...t.enemies, goblin_scout: { seen: 0, defeated: 1 } } },
      { ...t, collection: { ...t.collection, oak_staff: { ...emptyMarks(), rare: 1 } } },
      { ...t, zoneBosses: t.zoneBosses + 1 },
      { ...t, cleanZoneBosses: t.cleanZoneBosses + 1 },
      { ...t, turnBosses: t.turnBosses + 1 },
      { ...t, drops: { ...t.drops, legendary: 1 } },
      { ...t, recruits: { ...t.recruits, rare: 1 } },
      { ...t, reforges: t.reforges + 1 },
      { ...t, goldEarned: t.goldEarned + 1 },
    ]
    const hashes = new Set([
      hashState(base),
      ...variants.map((v) => hashState({ ...base, tallies: v })),
    ])
    expect(hashes.size).toBe(variants.length + 1)
  })
})

function emptyMarks(): Record<Rarity, number> {
  return { common: 0, uncommon: 0, rare: 0, epic: 0, legendary: 0 }
}
