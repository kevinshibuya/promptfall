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
    expect(golden.boss).toBeNull()
    expect(golden.encounter?.enemies.length).toBeGreaterThan(0)
    const s = migrated(
      golden,
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
    // Commons with nothing worn: the level-1 Knight at the template's base HP, the level-2 Black
    // Mage at a base of 36 and one level's growth of 5.
    expect(hero(s, 'h0').hp).toBe(60)
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
    expect(hero(s, 'h0').hp).toBe(60)
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
      expect(step(after, { t: 'tick' }).effects.filter((e) => e.k === 'rejected')).toEqual([])
    })
  }

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
      expect(step(after, { t: 'tick' }).effects.filter((e) => e.k === 'rejected')).toEqual([])
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
      expect(step(after, { t: 'tick' }).effects.filter((e) => e.k === 'rejected')).toEqual([])
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
      expect(step(after, { t: 'tick' }).effects.filter((e) => e.k === 'rejected')).toEqual([])
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
