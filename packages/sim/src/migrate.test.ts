import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { content } from './content'
import { hashState } from './hash'
import { type MigrationChain, migrate, migrateGoods, type VersionedState } from './migrate'
import { heroStats } from './progression'
import { createInitialState } from './state'
import { step } from './step'
import type { GameState, Goods } from './types'
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
    const r = migrate({ ...s0, v: SIM_VERSION - 2 })
    expect(r).toEqual({
      ok: false,
      reason: 'gap',
      from: SIM_VERSION - 2,
      to: SIM_VERSION,
      at: SIM_VERSION - 2,
    })
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
    // Level-1 Commons with nothing worn: the templates' base HP.
    expect(hero(s, 'h0').hp).toBe(60)
    expect(hero(s, 'h1').hp).toBe(36)
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
    expect(migrateGoods(g, SIM_VERSION - 2)).toEqual({
      ok: false,
      reason: 'gap',
      from: SIM_VERSION - 2,
      to: SIM_VERSION,
      at: SIM_VERSION - 2,
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
