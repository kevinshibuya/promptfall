import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { content } from './content'
import { hashState } from './hash'
import { type MigrationChain, migrate, migrateGoods, type VersionedState } from './migrate'
import { heroStats } from './progression'
import { createInitialState } from './state'
import { step } from './step'
import type { GameState, Goods, Item } from './types'
import { SIM_VERSION } from './types'

const FIXTURES = join(import.meta.dirname, 'fixtures')

function fixture(name: string): GameState {
  return JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')) as GameState
}

/** Each kind's committed fixture of the lowest version. */
function oldest(kind: 'golden' | 'deep'): string {
  const pattern = kind === 'deep' ? /^v(\d+)-deep\.json$/ : /^v(\d+)\.json$/
  const versions = readdirSync(FIXTURES)
    .map((name) => pattern.exec(name)?.[1])
    .filter((v) => v !== undefined)
    .map(Number)
    .sort((a, b) => a - b)
  const v = versions[0]
  if (v === undefined) throw new Error(`no ${kind} fixture`)
  return kind === 'deep' ? `v${v}-deep.json` : `v${v}.json`
}

const golden = fixture(`v${SIM_VERSION}.json`)
const deep = fixture(`v${SIM_VERSION}-deep.json`)
const NEXT = SIM_VERSION + 1

function chainOf(...steps: ((s: VersionedState) => VersionedState)[]): MigrationChain {
  return Object.fromEntries(steps.map((state, i) => [SIM_VERSION + i, { state }]))
}

function migrated(state: GameState, chain: MigrationChain, to = NEXT): GameState {
  const r = migrate(state, { chain, to })
  if (!r.ok) throw new Error(`refused: ${r.reason}`)
  return r.state
}

/** A step's result walked the rest of the chain: only a current state steps on the current rules. */
function current(s: GameState): GameState {
  const r = migrate(s)
  if (!r.ok) throw new Error(`refused: ${r.reason}`)
  return r.state
}

function hero(s: GameState, id: string) {
  const h = s.roster.find((x) => x.id === id)
  if (!h) throw new Error(`no hero ${id}`)
  return h
}

const s0 = createInitialState(1)
/** The chain starts at version 5: no record below it exists (spec #130). */
const UNCHAINED = 4

describe('the deep fixture', () => {
  it('holds what a later step has to transform', () => {
    expect(deep.zone).toBe(10)
    expect(deep.boss).not.toBeNull()
    expect(deep.gold).toBeGreaterThan(0)
    expect(deep.inventory).toHaveLength(deep.inventoryCap)
    for (const rarity of ['epic', 'rare'] as const) {
      const h = deep.roster.find((x) => x.rarity === rarity && deep.party.includes(x.id))
      if (!h) throw new Error(`no ${rarity} in the party`)
      expect(h.hp).toBeGreaterThan(0)
      expect(h.hp).toBeLessThan(heroStats(deep, h).hp)
      expect(Object.values(h.equipment).every((id) => id !== null)).toBe(true)
    }
    const minZones = deep.inventory
      .filter((i) => i.affixes.length > 0)
      .map((i) => content.itemBases[i.base]?.minZone)
    expect(minZones).toContain(7)
    expect(minZones).toContain(10)
  })

  it("holds tallies and the tavern guarantee's counts above zero", () => {
    expect(Object.keys(deep.tallies.enemies).length).toBeGreaterThan(0)
    expect(Object.keys(deep.tallies.collection).length).toBeGreaterThan(0)
    expect(Object.values(deep.tallies.drops).some((n) => n > 0)).toBe(true)
    expect(Object.values(deep.tallies.recruits).some((n) => n > 0)).toBe(true)
    expect(deep.tallies.reforges).toBeGreaterThan(0)
    expect(deep.tallies.goldEarned).toBeGreaterThan(0)
    expect(Object.values(deep.guarantee).every((n) => n > 0)).toBe(true)
  })

  it('holds a reactive event in play: Haste and Guard on, the world boss enraged', () => {
    expect(deep.hasteTicks).toBeGreaterThan(0)
    expect(deep.guardTicks).toBeGreaterThan(0)
    expect(deep.encounter?.enemies.filter((e) => e.enraged).map((e) => e.kind)).toEqual([
      'world_boss',
    ])
  })
})

describe('migrate refuses', () => {
  it('a state ahead of the target version', () => {
    const r = migrate({ ...s0, v: SIM_VERSION + 1 })
    expect(r).toEqual({ ok: false, reason: 'ahead', from: SIM_VERSION + 1, to: SIM_VERSION })
  })

  it('a version the chain has no step for', () => {
    const r = migrate({ ...s0, v: UNCHAINED })
    expect(r).toEqual({ ok: false, reason: 'gap', from: UNCHAINED, to: SIM_VERSION, at: UNCHAINED })
  })

  it('a chain that stops short of the target', () => {
    const r = migrate(golden, { chain: chainOf((s) => s), to: SIM_VERSION + 2 })
    expect(r).toEqual({
      ok: false,
      reason: 'gap',
      from: SIM_VERSION,
      to: SIM_VERSION + 2,
      at: NEXT,
    })
  })
})

describe('migrate walks a stub step', () => {
  const stub = chainOf((s) => ({ ...s, stubbed: true }))

  for (const [name, state] of [
    ['golden', golden],
    ['deep', deep],
  ] as const) {
    it(`takes the ${name} fixture to the next version, and the result hashes and steps`, () => {
      const r = migrate(state, { chain: stub, to: NEXT })
      if (!r.ok) throw new Error(r.reason)
      expect(r.from).toBe(SIM_VERSION)
      expect(r.steps).toBe(1)
      expect(r.state.v).toBe(NEXT)
      expect((r.state as VersionedState).stubbed).toBe(true)
      expect(r.state.gold).toBe(state.gold)
      expect(r.state.roster.map((h) => [h.id, h.level])).toEqual(
        state.roster.map((h) => [h.id, h.level]),
      )
      expect(r.state.inventory.map((i) => i.id)).toEqual(state.inventory.map((i) => i.id))
      expect(hashState(r.state)).toMatch(/^[0-9a-f]{16}$/)
      const next = step(r.state, { t: 'tick' })
      expect(next.effects.filter((e) => e.k === 'rejected')).toEqual([])
    })
  }

  it('leaves the stored state it was handed alone', () => {
    const before = JSON.stringify(golden)
    migrated(
      golden,
      chainOf((s) => ({ ...s, gold: 1 })),
    )
    expect(JSON.stringify(golden)).toBe(before)
  })
})

describe('the clear', () => {
  it('empties the encounter and the battle outside boss mode, so the next tick spawns', () => {
    // The golden script ends between turns on an empty field: a tool call puts an enemy on it.
    const fighting = step(golden, { t: 'tool_call' }).state
    expect(fighting.boss).toBeNull()
    expect(fighting.encounter?.enemies.length).toBeGreaterThan(0)
    const s = migrated(
      fighting,
      chainOf((x) => x),
    )
    expect(s.encounter).toBeNull()
    expect(s.battle).toEqual({ gauges: [], queue: [], busy: 0 })
    expect(step(s, { t: 'tick' }).state.encounter?.enemies.length).toBe(1)
  })

  it('leaves the encounter and the battle as they are in boss mode', () => {
    expect(deep.boss).not.toBeNull()
    const s = migrated(
      deep,
      chainOf((x) => x),
    )
    expect(s.encounter).toEqual(deep.encounter)
    expect(s.battle).toEqual(deep.battle)
    expect(s.boss).toEqual(deep.boss)
  })
})

describe('the clamp', () => {
  const overfull = (s: VersionedState): VersionedState => {
    const state = s as unknown as GameState
    return { ...s, roster: state.roster.map((h) => ({ ...h, hp: 1_000_000 })) }
  }

  it("lowers a hero's HP to its new maximum", () => {
    const s = migrated(golden, chainOf(overfull))
    // Commons with nothing worn: the level-3 Knight at a base of 60 and two levels' growth of 9,
    // the level-2 Black Mage at a base of 36 and one level's growth of 5.
    expect(hero(s, 'h0').hp).toBe(78)
    expect(hero(s, 'h1').hp).toBe(41)
  })

  it('never raises HP: wounded heroes stay wounded and the fallen stay down', () => {
    const s = migrated(
      deep,
      chainOf((x) => x),
    )
    for (const h of deep.roster) expect(hero(s, h.id).hp).toBe(h.hp)
    // The v5 deep fixture's Common Knight fell in its zone 5 fight; the v6 rules let it live.
    const fallen = migrate(fixture('v5-deep.json'))
    if (!fallen.ok) throw new Error(fallen.reason)
    expect(hero(fallen.state, 'h0').hp).toBe(0)
  })

  it('runs once, at the end of the chain, not between steps', () => {
    let seen: number | undefined
    const record = (s: VersionedState): VersionedState => {
      seen = (s as unknown as GameState).roster[0]?.hp
      return s
    }
    const s = migrated(golden, chainOf(overfull, record), SIM_VERSION + 2)
    expect(seen).toBe(1_000_000)
    expect(hero(s, 'h0').hp).toBe(78)
  })
})

describe('the goods rule', () => {
  const item = deep.inventory[0]
  const held = deep.roster[4]
  if (!item || !held) throw new Error('deep fixture')
  const goods: Goods[] = [
    { kind: 'item', item },
    { kind: 'hero', hero: held },
  ]

  it("applies a step's goods transform to an item and a hero handed to it", () => {
    const chain: MigrationChain = {
      [SIM_VERSION]: {
        state: (s) => s,
        goods: (g) =>
          g.kind === 'item'
            ? { kind: 'item', item: { ...g.item, base: 'renamed' } }
            : { kind: 'hero', hero: { ...g.hero, epithet: 'Renamed' } },
      },
    }
    const out = goods.map((g) => migrateGoods(g, SIM_VERSION, { chain, to: NEXT }))
    expect(out).toEqual([
      { ok: true, goods: { kind: 'item', item: { ...item, base: 'renamed' } } },
      { ok: true, goods: { kind: 'hero', hero: { ...held, epithet: 'Renamed' } } },
    ])
  })

  it('is the identity for a step that names none', () => {
    const out = goods.map((g) =>
      migrateGoods(g, SIM_VERSION, { chain: chainOf((s) => s), to: NEXT }),
    )
    expect(out).toEqual(goods.map((g) => ({ ok: true, goods: g })))
  })

  it('refuses goods from a version the chain has no step for', () => {
    const [g] = goods
    if (!g) throw new Error('goods')
    expect(migrateGoods(g, UNCHAINED)).toEqual({
      ok: false,
      reason: 'gap',
      from: UNCHAINED,
      to: SIM_VERSION,
      at: UNCHAINED,
    })
  })
})

describe('the 5→6 step: ratio mitigation and the flatter xp curve', () => {
  // Stats are derived, so the step only zeroes the xp into each hero's level; the clear and the
  // clamp run at the chain's end. The hashes pin the step's output on the current rules.
  const PINNED = { golden: '642c61eb81b0f819', deep: '4260c6f6df3435d4' } as const

  for (const kind of ['golden', 'deep'] as const) {
    const before = fixture(kind === 'deep' ? 'v5-deep.json' : 'v5.json')
    const r = migrate(before, { to: 6 })
    if (!r.ok) throw new Error(r.reason)
    const after = r.state

    it(`keeps every hero's level on the ${kind} fixture and zeroes the xp into it`, () => {
      expect(before.roster.some((h) => h.xp > 0)).toBe(true)
      expect(after.v).toBe(6)
      expect(after.roster.map((h) => [h.id, h.level])).toEqual(
        before.roster.map((h) => [h.id, h.level]),
      )
      for (const h of after.roster) expect(h.xp).toBe(0)
    })

    it(`copies the ${kind} fixture's items, gold, zone and party untouched`, () => {
      expect(after.inventory).toEqual(before.inventory)
      expect(after.gold).toBe(before.gold)
      expect(after.zone).toBe(before.zone)
      expect(after.party).toEqual(before.party)
    })

    it(`hashes the ${kind} fixture to its pinned value, and the result steps`, () => {
      expect(hashState(after)).toBe(PINNED[kind])
      expect(step(current(after), { t: 'tick' }).effects.filter((e) => e.k === 'rejected')).toEqual(
        [],
      )
    })
  }

  it("the 5→6 goods rule zeroes a held hero's xp and leaves an item alone", () => {
    const v5 = fixture('v5-deep.json')
    const held = v5.roster.find((h) => h.xp > 0)
    const [item] = v5.inventory
    if (!held || !item) throw new Error('deep fixture')
    expect(migrateGoods({ kind: 'hero', hero: held }, 5, { to: 6 })).toEqual({
      ok: true,
      goods: { kind: 'hero', hero: { ...held, xp: 0 } },
    })
    expect(migrateGoods({ kind: 'item', item }, 5, { to: 6 })).toEqual({
      ok: true,
      goods: { kind: 'item', item },
    })
  })

  it('clears the encounter outside boss mode and keeps the world boss in it', () => {
    const golden5 = migrate(fixture('v5.json'), { to: 6 })
    const deep5 = migrate(fixture('v5-deep.json'), { to: 6 })
    if (!golden5.ok || !deep5.ok) throw new Error('refused')
    expect(golden5.state.encounter).toBeNull()
    expect(deep5.state.boss).not.toBeNull()
    expect(deep5.state.encounter?.enemies[0]?.kind).toBe('world_boss')
  })
})

describe('the 6→7 step: hero rarity multiplies base stats and growth', () => {
  // Stats are derived and the xp curve is unchanged, so the step is the identity: levels and xp
  // are kept. A higher maximum never lowers HP, so the clamp leaves every hero as it was.
  const PINNED = { golden: 'affceb5dedb937ff', deep: '05bece3d8ae89243' } as const

  for (const kind of ['golden', 'deep'] as const) {
    const before = fixture(kind === 'deep' ? 'v6-deep.json' : 'v6.json')
    const r = migrate(before, { to: 7 })
    if (!r.ok) throw new Error(r.reason)
    const after = r.state

    it(`keeps every hero's level, xp and HP on the ${kind} fixture`, () => {
      expect(before.roster.some((h) => h.xp > 0)).toBe(true)
      expect(after.v).toBe(7)
      expect(after.roster.map((h) => [h.id, h.level, h.xp, h.hp])).toEqual(
        before.roster.map((h) => [h.id, h.level, h.xp, h.hp]),
      )
    })

    it(`copies the ${kind} fixture's items, gold, zone and party untouched`, () => {
      expect(after.inventory).toEqual(before.inventory)
      expect(after.gold).toBe(before.gold)
      expect(after.zone).toBe(before.zone)
      expect(after.party).toEqual(before.party)
    })

    it(`hashes the ${kind} fixture to its pinned value, and the result steps`, () => {
      expect(hashState(after)).toBe(PINNED[kind])
      expect(step(current(after), { t: 'tick' }).effects.filter((e) => e.k === 'rejected')).toEqual(
        [],
      )
    })
  }

  it('clears the encounter outside boss mode and keeps the world boss in it', () => {
    const golden6 = migrate(fixture('v6.json'), { to: 7 })
    const deep6 = migrate(fixture('v6-deep.json'), { to: 7 })
    if (!golden6.ok || !deep6.ok) throw new Error('refused')
    expect(golden6.state.encounter).toBeNull()
    expect(deep6.state.boss).not.toBeNull()
    expect(deep6.state.encounter?.enemies[0]?.kind).toBe('world_boss')
  })
})

describe('the 7→8 step: an item carries its tier', () => {
  // The tier comes from each item's base, and the roll is what is stored, so no affix changes;
  // the tier scales it at read. Levels, xp and HP are kept: nothing else changes shape.
  const PINNED = { golden: '825df69707110269', deep: '9993826bbc4bb0a1' } as const
  const tierOf = (base: string) => Math.ceil((content.itemBases[base]?.minZone ?? 1) / 3)

  for (const kind of ['golden', 'deep'] as const) {
    const before = fixture(kind === 'deep' ? 'v7-deep.json' : 'v7.json')
    const r = migrate(before, { to: 8 })
    if (!r.ok) throw new Error(r.reason)
    const after = r.state

    it(`gives every item of the ${kind} fixture its base's tier and keeps every roll`, () => {
      expect(before.inventory.length).toBeGreaterThan(0)
      expect(after.v).toBe(8)
      expect(after.inventory).toEqual(before.inventory.map((i) => ({ ...i, tier: tierOf(i.base) })))
    })

    it(`keeps every hero's level, xp and HP and the gold, zone and party of the ${kind} fixture`, () => {
      expect(after.roster.map((h) => [h.id, h.level, h.xp, h.hp])).toEqual(
        before.roster.map((h) => [h.id, h.level, h.xp, h.hp]),
      )
      expect(after.gold).toBe(before.gold)
      expect(after.zone).toBe(before.zone)
      expect(after.party).toEqual(before.party)
    })

    it(`hashes the ${kind} fixture to its pinned value, and the result steps`, () => {
      expect(hashState(after)).toBe(PINNED[kind])
      expect(step(current(after), { t: 'tick' }).effects.filter((e) => e.k === 'rejected')).toEqual(
        [],
      )
    })
  }

  it('puts tiers 3 and 4 in the deep fixture, whose affixes now count at ×3.5 and ×6', () => {
    const r = migrate(fixture('v7-deep.json'), { to: 8 })
    if (!r.ok) throw new Error(r.reason)
    const tiers = new Set(r.state.inventory.filter((i) => i.affixes.length > 0).map((i) => i.tier))
    expect(tiers).toContain(3)
    expect(tiers).toContain(4)
  })

  it("adds the tier to an item handed to its goods rule and leaves a hero's alone", () => {
    const v7 = fixture('v7-deep.json')
    const [item] = v7.inventory
    const held = v7.roster[4]
    if (!item || !held) throw new Error('deep fixture')
    const { tier: _, ...untiered } = item as Item & { tier?: number }
    expect(migrateGoods({ kind: 'item', item: untiered as Item }, 7, { to: 8 })).toEqual({
      ok: true,
      goods: { kind: 'item', item: { ...untiered, tier: tierOf(item.base) } },
    })
    expect(migrateGoods({ kind: 'hero', hero: held }, 7, { to: 8 })).toEqual({
      ok: true,
      goods: { kind: 'hero', hero: held },
    })
  })
})

describe('the 8→9 step: a wipe restarts the zone, the third is a retreat', () => {
  // The state gains the zone's wipe count, at zero: no save remembers its wipes in a zone, and a
  // count of zero only defers a retreat. The rest heal is a rule, not a field.
  const PINNED = { golden: '9d3731860a401b10', deep: '8e2e1be6ce01768c' } as const

  for (const kind of ['golden', 'deep'] as const) {
    const before = fixture(kind === 'deep' ? 'v8-deep.json' : 'v8.json')
    const r = migrate(before, { to: 9 })
    if (!r.ok) throw new Error(r.reason)
    const after = r.state

    it(`starts the ${kind} fixture's wipe count at zero`, () => {
      expect('zoneWipes' in before).toBe(false)
      expect(after.v).toBe(9)
      expect(after.zoneWipes).toBe(0)
    })

    it(`keeps every hero's level, xp and HP and the items, gold, zone and party of the ${kind} fixture`, () => {
      expect(after.roster.map((h) => [h.id, h.level, h.xp, h.hp])).toEqual(
        before.roster.map((h) => [h.id, h.level, h.xp, h.hp]),
      )
      expect(after.inventory).toEqual(before.inventory)
      expect(after.gold).toBe(before.gold)
      expect(after.zone).toBe(before.zone)
      expect(after.party).toEqual(before.party)
      expect(after.stats).toEqual(before.stats)
    })

    it(`hashes the ${kind} fixture to its pinned value, and the result steps`, () => {
      expect(hashState(after)).toBe(PINNED[kind])
      expect(step(current(after), { t: 'tick' }).effects.filter((e) => e.k === 'rejected')).toEqual(
        [],
      )
    })
  }

  it('leaves goods alone', () => {
    const v8 = fixture('v8-deep.json')
    const [item] = v8.inventory
    if (!item) throw new Error('deep fixture')
    expect(migrateGoods({ kind: 'item', item }, 8, { to: 9 })).toEqual({
      ok: true,
      goods: { kind: 'item', item },
    })
  })
})

describe('the 9→10 step: the auto-vendor setting', () => {
  // The state gains the auto-vendor flag, off: nothing the player did not ask for sells an item.
  const PINNED = { golden: 'd876160b858cf8cd', deep: 'f7a5ec40c27f192e' } as const

  for (const kind of ['golden', 'deep'] as const) {
    const before = fixture(kind === 'deep' ? 'v9-deep.json' : 'v9.json')
    const r = migrate(before, { to: 10 })
    if (!r.ok) throw new Error(r.reason)
    const after = r.state

    it(`starts the ${kind} fixture's auto-vendor setting off`, () => {
      expect('autoVendor' in before).toBe(false)
      expect(after.v).toBe(10)
      expect(after.autoVendor).toBe(false)
    })

    it(`keeps every hero's level, xp and HP and the items, gold, zone and party of the ${kind} fixture`, () => {
      expect(after.roster.map((h) => [h.id, h.level, h.xp, h.hp])).toEqual(
        before.roster.map((h) => [h.id, h.level, h.xp, h.hp]),
      )
      expect(after.inventory).toEqual(before.inventory)
      expect(after.gold).toBe(before.gold)
      expect(after.zone).toBe(before.zone)
      expect(after.zoneWipes).toBe(before.zoneWipes)
      expect(after.party).toEqual(before.party)
      expect(after.stats).toEqual(before.stats)
    })

    it(`hashes the ${kind} fixture to its pinned value, and the result steps`, () => {
      expect(hashState(after)).toBe(PINNED[kind])
      expect(step(current(after), { t: 'tick' }).effects.filter((e) => e.k === 'rejected')).toEqual(
        [],
      )
    })
  }

  it('leaves goods alone', () => {
    const v9 = fixture('v9-deep.json')
    const [item] = v9.inventory
    if (!item) throw new Error('deep fixture')
    expect(migrateGoods({ kind: 'item', item }, 9, { to: 10 })).toEqual({
      ok: true,
      goods: { kind: 'item', item },
    })
  })
})

describe('the 10→11 step: tiers', () => {
  // Zone 12's boss opens tier 2: the running zone number and every field keep their shape.
  const PINNED = { golden: '44c344a2ce5e44b4', deep: '676937b7250d020d' } as const

  for (const kind of ['golden', 'deep'] as const) {
    const before = fixture(kind === 'deep' ? 'v10-deep.json' : 'v10.json')
    const r = migrate(before, { to: 11 })
    if (!r.ok) throw new Error(r.reason)
    const after = r.state

    it(`keeps every field of the ${kind} fixture but the version, the encounter and the battle`, () => {
      expect(after.v).toBe(11)
      const { v: _v, encounter: _e, battle: _b, ...rest } = after
      const { v: _v0, encounter: _e0, battle: _b0, ...was } = before as unknown as typeof after
      expect(rest).toEqual(was)
    })

    it(`hashes the ${kind} fixture to its pinned value, and the result steps`, () => {
      expect(hashState(after)).toBe(PINNED[kind])
      expect(step(current(after), { t: 'tick' }).effects.filter((e) => e.k === 'rejected')).toEqual(
        [],
      )
    })
  }

  it('leaves goods alone', () => {
    const v10 = fixture('v10-deep.json')
    const [item] = v10.inventory
    if (!item) throw new Error('deep fixture')
    expect(migrateGoods({ kind: 'item', item }, 10, { to: 11 })).toEqual({
      ok: true,
      goods: { kind: 'item', item },
    })
  })
})

describe('the 11→12 step: the arc retuned for the dedicated player', () => {
  // Content constants moved and nothing else: every field keeps its shape and value.
  const PINNED = { golden: '4f2c40dd963b883b', deep: '5db7645dbccbf897' } as const

  for (const kind of ['golden', 'deep'] as const) {
    const before = fixture(kind === 'deep' ? 'v11-deep.json' : 'v11.json')
    const r = migrate(before, { to: 12 })
    if (!r.ok) throw new Error(r.reason)
    const after = r.state

    it(`keeps every field of the ${kind} fixture but the version, the encounter and the battle`, () => {
      expect(after.v).toBe(12)
      const { v: _v, encounter: _e, battle: _b, ...rest } = after
      const { v: _v0, encounter: _e0, battle: _b0, ...was } = before as unknown as typeof after
      expect(rest).toEqual(was)
    })

    it(`hashes the ${kind} fixture to its pinned value, and the result steps`, () => {
      expect(hashState(after)).toBe(PINNED[kind])
      expect(step(current(after), { t: 'tick' }).effects.filter((e) => e.k === 'rejected')).toEqual(
        [],
      )
    })
  }

  it('leaves goods alone', () => {
    const v11 = fixture('v11-deep.json')
    const [item] = v11.inventory
    if (!item) throw new Error('deep fixture')
    expect(migrateGoods({ kind: 'item', item }, 11, { to: 12 })).toEqual({
      ok: true,
      goods: { kind: 'item', item },
    })
  })
})

describe('the 12→13 step: tier odds for contracts, the tier ramp', () => {
  // A rule and content constants moved and nothing else: every field keeps its shape and value.
  const PINNED = { golden: 'dbecd3ebfdcac781', deep: '575db2b950c5f53f' } as const

  for (const kind of ['golden', 'deep'] as const) {
    const before = fixture(kind === 'deep' ? 'v12-deep.json' : 'v12.json')
    const r = migrate(before, { to: 13 })
    if (!r.ok) throw new Error(r.reason)
    const after = r.state

    it(`keeps every field of the ${kind} fixture but the version, the encounter and the battle`, () => {
      expect(after.v).toBe(13)
      const { v: _v, encounter: _e, battle: _b, ...rest } = after
      const { v: _v0, encounter: _e0, battle: _b0, ...was } = before as unknown as typeof after
      expect(rest).toEqual(was)
    })

    it(`hashes the ${kind} fixture to its pinned value, and the result steps`, () => {
      expect(hashState(after)).toBe(PINNED[kind])
      expect(step(current(after), { t: 'tick' }).effects.filter((e) => e.k === 'rejected')).toEqual(
        [],
      )
    })
  }

  it('leaves goods alone', () => {
    const v12 = fixture('v12-deep.json')
    const [item] = v12.inventory
    const [hero] = v12.roster
    if (!item || !hero) throw new Error('deep fixture')
    for (const goods of [
      { kind: 'item', item },
      { kind: 'hero', hero },
    ] as const) {
      expect(migrateGoods(goods, 12, { to: 13 })).toEqual({ ok: true, goods })
    }
  })
})

describe('the 13→14 step: the tier-1 arc slowed outside the kill rate', () => {
  // Content constants moved and nothing else: every field keeps its shape and value.
  const PINNED = { golden: '6a5ac1e47d62fb5e', deep: '847c5a583968a89a' } as const

  for (const kind of ['golden', 'deep'] as const) {
    const before = fixture(kind === 'deep' ? 'v13-deep.json' : 'v13.json')
    const r = migrate(before, { to: 14 })
    if (!r.ok) throw new Error(r.reason)
    const after = r.state

    it(`keeps every field of the ${kind} fixture but the version, the encounter and the battle`, () => {
      expect(after.v).toBe(14)
      const { v: _v, encounter: _e, battle: _b, ...rest } = after
      const { v: _v0, encounter: _e0, battle: _b0, ...was } = before as unknown as typeof after
      expect(rest).toEqual(was)
    })

    it(`hashes the ${kind} fixture to its pinned value, and the result steps`, () => {
      expect(hashState(after)).toBe(PINNED[kind])
      expect(step(current(after), { t: 'tick' }).effects.filter((e) => e.k === 'rejected')).toEqual(
        [],
      )
    })
  }

  it('leaves goods alone', () => {
    const v13 = fixture('v13-deep.json')
    const [item] = v13.inventory
    const [hero] = v13.roster
    if (!item || !hero) throw new Error('deep fixture')
    for (const goods of [
      { kind: 'item', item },
      { kind: 'hero', hero },
    ] as const) {
      expect(migrateGoods(goods, 13, { to: 14 })).toEqual({ ok: true, goods })
    }
  })
})

describe('the 14→15 step: the reactive events', () => {
  // The state gains Haste's and Guard's countdowns at zero and every enemy its enraged flag, off.
  const PINNED = { golden: '0d8fad39b4f3bdc7', deep: '0c8d8999fbd8c08f' } as const

  for (const kind of ['golden', 'deep'] as const) {
    const before = fixture(kind === 'deep' ? 'v14-deep.json' : 'v14.json')
    const r = migrate(before, { to: 15 })
    if (!r.ok) throw new Error(r.reason)
    const after = r.state

    it(`starts the ${kind} fixture with both countdowns at zero and no enemy enraged`, () => {
      expect(after.v).toBe(15)
      expect(after.hasteTicks).toBe(0)
      expect(after.guardTicks).toBe(0)
      expect(after.encounter?.enemies.some((e) => e.enraged !== false) ?? false).toBe(false)
    })

    it(`keeps every other field of the ${kind} fixture`, () => {
      const { v: _v, encounter: _e, battle: _b, hasteTicks: _h, guardTicks: _g, ...rest } = after
      const { v: _v0, encounter: _e0, battle: _b0, ...was } = before as unknown as typeof after
      expect(rest).toEqual(was)
    })

    it(`hashes the ${kind} fixture to its pinned value, and the result steps`, () => {
      expect(hashState(after)).toBe(PINNED[kind])
      expect(step(current(after), { t: 'tick' }).effects.filter((e) => e.k === 'rejected')).toEqual(
        [],
      )
    })
  }

  it("keeps the deep fixture's world boss, enraged off", () => {
    const before = fixture('v14-deep.json')
    const r = migrate(before, { to: 15 })
    if (!r.ok) throw new Error(r.reason)
    expect(r.state.encounter?.enemies).toEqual(
      before.encounter?.enemies.map((e) => ({ ...e, enraged: false })),
    )
  })

  it('leaves goods alone', () => {
    const v14 = fixture('v14-deep.json')
    const [item] = v14.inventory
    const [hero] = v14.roster
    if (!item || !hero) throw new Error('deep fixture')
    for (const goods of [
      { kind: 'item', item },
      { kind: 'hero', hero },
    ] as const) {
      expect(migrateGoods(goods, 14, { to: 15 })).toEqual({ ok: true, goods })
    }
  })
})

describe('the 15→16 step: the tallies, travel and the tavern guarantee', () => {
  // Every tally at zero but the zone boss count, seeded from the boss total; the guarantee's
  // counts at zero.
  const PINNED = { golden: 'db3c5b83722435b5', deep: '114a718ec0b2c6b4' } as const
  const ZERO = { common: 0, uncommon: 0, rare: 0, epic: 0, legendary: 0 }

  for (const kind of ['golden', 'deep'] as const) {
    const before = fixture(kind === 'deep' ? 'v15-deep.json' : 'v15.json')
    const r = migrate(before, { to: 16 })
    if (!r.ok) throw new Error(r.reason)
    const after = r.state

    it(`starts the ${kind} fixture's tallies at zero but the zone bosses, and its counts at zero`, () => {
      expect(after.v).toBe(16)
      expect(after.tallies).toEqual({
        enemies: {},
        collection: {},
        zoneBosses: before.stats.bosses,
        cleanZoneBosses: 0,
        turnBosses: 0,
        drops: ZERO,
        recruits: ZERO,
        reforges: 0,
        goldEarned: 0,
      })
      expect(after.guarantee).toEqual({ rare: 0, epic: 0, legendary: 0 })
    })

    it(`keeps every other field of the ${kind} fixture`, () => {
      const { v: _v, encounter: _e, battle: _b, tallies: _t, guarantee: _g, ...rest } = after
      const { v: _v0, encounter: _e0, battle: _b0, ...was } = before as unknown as typeof after
      expect(rest).toEqual(was)
    })

    it(`hashes the ${kind} fixture to its pinned value, and the result steps`, () => {
      expect(hashState(after)).toBe(PINNED[kind])
      expect(step(current(after), { t: 'tick' }).effects.filter((e) => e.k === 'rejected')).toEqual(
        [],
      )
    })
  }

  it("seeds the zone boss tally from a veteran's boss total, turn bosses and all", () => {
    const veteran = { ...fixture('v15.json'), stats: { kills: 4100, bosses: 37, wipes: 9 } }
    const r = migrate(veteran, { to: 16 })
    if (!r.ok) throw new Error(r.reason)
    expect(r.state.tallies.zoneBosses).toBe(37)
    expect(r.state.tallies.turnBosses).toBe(0)
    expect(r.state.stats).toEqual(veteran.stats)
  })

  it('leaves goods alone', () => {
    const v15 = fixture('v15-deep.json')
    const [item] = v15.inventory
    const [hero] = v15.roster
    if (!item || !hero) throw new Error('deep fixture')
    for (const goods of [
      { kind: 'item', item },
      { kind: 'hero', hero },
    ] as const) {
      expect(migrateGoods(goods, 15, { to: 16 })).toEqual({ ok: true, goods })
    }
  })
})

describe('the 16→17 step: the zone bosses’ moves', () => {
  // Identity in shape: the moves live in content and combat, and rage reads HP at the hit.
  const PINNED = { golden: 'ce7a2f8f8b62d6b1', deep: '171e4027d61cd4e1' } as const

  for (const kind of ['golden', 'deep'] as const) {
    const before = fixture(kind === 'deep' ? 'v16-deep.json' : 'v16.json')
    const r = migrate(before, { to: 17 })
    if (!r.ok) throw new Error(r.reason)
    const after = r.state

    it(`keeps every field of the ${kind} fixture but the version and the cleared fight`, () => {
      expect(after.v).toBe(17)
      const { v: _v, encounter: _e, battle: _b, ...rest } = after
      const { v: _v0, encounter: _e0, battle: _b0, ...was } = before as unknown as typeof after
      expect(rest).toEqual(was)
    })

    it(`hashes the ${kind} fixture to its pinned value, and the result steps`, () => {
      expect(hashState(after)).toBe(PINNED[kind])
      expect(step(after, { t: 'tick' }).effects.filter((e) => e.k === 'rejected')).toEqual([])
    })
  }

  it('leaves goods alone', () => {
    const v16 = fixture('v16-deep.json')
    const [item] = v16.inventory
    const [hero] = v16.roster
    if (!item || !hero) throw new Error('deep fixture')
    for (const goods of [
      { kind: 'item', item },
      { kind: 'hero', hero },
    ] as const) {
      expect(migrateGoods(goods, 16, { to: 17 })).toEqual({ ok: true, goods })
    }
  })
})

describe('the chain', () => {
  for (const kind of ['golden', 'deep'] as const) {
    it(`takes the oldest ${kind} fixture to the current version`, () => {
      const name = oldest(kind)
      const state = fixture(name)
      const r = migrate(state)
      if (!r.ok) throw new Error(r.reason)
      expect(r.state.v).toBe(SIM_VERSION)
      expect(r.steps).toBe(SIM_VERSION - state.v)
      expect(r.state.roster.map((h) => h.level)).toEqual(state.roster.map((h) => h.level))
      expect(hashState(r.state)).toMatch(/^[0-9a-f]{16}$/)
      expect(step(r.state, { t: 'tick' }).effects.filter((e) => e.k === 'rejected')).toEqual([])
    })
  }
})
