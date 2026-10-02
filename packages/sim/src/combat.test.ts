import { describe, expect, it } from 'vitest'
import { content } from './content'
import { heroStats } from './progression'
import { createInitialState } from './state'
import { step } from './step'
import type { Effect, Enemy, EnemyKind, Event, GameState, Item } from './types'

describe('combat', () => {
  it('kills at least one enemy and grants gold within 40 ticks from the initial state', () => {
    const r = run(createInitialState(7), times(40, { t: 'tick' } as const))
    expect(r.state.stats.kills).toBeGreaterThanOrEqual(1)
    expect(r.state.gold).toBeGreaterThan(0)
    expect(r.effects.some((e) => e.k === 'gold')).toBe(true)
    expect(r.state.tick).toBeGreaterThan(0)
  })

  it('a zone 12 boss wipes a level 1 party at zone 3 and retreats to zone 2 at full hp', () => {
    let s: GameState = { ...createInitialState(3), zone: 3, highestZone: 3, wave: 4 }
    s = injectEnemy(s, 'unwritten_one')
    const r = run(s, times(50, { t: 'tick' } as const))
    const wipe = r.effects.find((e) => e.k === 'wipe')
    expect(wipe).toEqual({ k: 'wipe', retreatedTo: 2 })
    // Stop at the wipe: replay up to it.
    let t = s
    for (let i = 0; i < 50; i++) {
      const step = run(t, [{ t: 'tick' }])
      t = step.state
      if (step.effects.some((e) => e.k === 'wipe')) break
    }
    expect(t.zone).toBe(2)
    expect(t.wave).toBe(1)
    expect(t.encounter).toBeNull()
    expect(t.stats.wipes).toBe(1)
    for (const id of t.party) {
      const hero = t.roster.find((h) => h.id === id)
      if (!hero) throw new Error('missing hero')
      expect(hero.hp).toBe(heroStats(t, hero).hp)
    }
  })

  it('a white mage left alone attacks instead of healing herself', () => {
    // Seen live: Knight and Black Mage down, two Goblin Scouts, the White Mage
    // in a Healer's Mace healing herself as fast as they hurt her. Nobody
    // attacked, and the fight never ended.
    const s0 = createInitialState(12)
    const mage = s0.roster.find((h) => h.cls === 'white_mage')
    if (!mage) throw new Error('mage')
    const roster = s0.roster.map((h) =>
      h.cls === 'knight' || h.cls === 'black_mage'
        ? { ...h, hp: 0 }
        : h.id === mage.id
          ? { ...h, hp: 14, equipment: { ...h.equipment, weapon: 'imace' } }
          : h,
    )
    const mace: Item = {
      id: 'imace',
      base: 'healers_mace',
      rarity: 'common',
      affixes: [],
      equippedBy: mage.id,
    }
    let s: GameState = injectEnemy(
      injectEnemy({ ...s0, roster, inventory: [mace] }, 'goblin_scout'),
      'goblin_scout',
    )
    const enc = s.encounter
    const [a, b] = enc?.enemies ?? []
    if (!enc || !a || !b) throw new Error('enc')
    s = {
      ...s,
      encounter: {
        ...enc,
        enemies: [
          { ...a, hp: 61 },
          { ...b, hp: 65 },
        ],
      },
    }
    const r = run(s, times(30, { t: 'tick' } as const))
    const wiped = r.effects.some((e) => e.k === 'wipe')
    const hurt = r.effects.length > 0 && (r.state.encounter?.enemies ?? []).some((e) => e.hp < 61)
    expect(wiped || hurt || r.state.stats.kills > 0).toBe(true)
  })

  it('heroStats adds a rare weapon at 12000 bp plus its affixes', () => {
    const s0 = createInitialState(1)
    const knight = s0.roster[0]
    if (!knight) throw new Error('no knight')
    const item: Item = {
      id: 'iX',
      base: 'steel_longsword',
      rarity: 'rare',
      affixes: [
        { id: 'brutal', value: 5 },
        { id: 'swift', value: 2 },
      ],
      equippedBy: knight.id,
    }
    const equipped = { ...knight, equipment: { ...knight.equipment, weapon: 'iX' } }
    const s: GameState = {
      ...s0,
      inventory: [item],
      roster: [equipped, ...s0.roster.slice(1)],
    }
    const before = heroStats(s0, knight)
    const after = heroStats(s, equipped)
    const baseAtk = content.itemBases.steel_longsword?.stats.atk ?? 0
    expect(after.atk).toBe(before.atk + Math.floor((baseAtk * 12000) / 10000) + 5)
    expect(after.spd).toBe(before.spd + 2)
    expect(after.def).toBe(before.def)
  })
})

// Helpers

function run(state: GameState, events: Event[]): { state: GameState; effects: Effect[] } {
  let s = state
  const effects: Effect[] = []
  for (const e of events) {
    const r = step(s, e)
    s = r.state
    effects.push(...r.effects)
  }
  return { state: s, effects }
}

function times<T>(n: number, value: T): T[] {
  return Array.from({ length: n }, () => value)
}

function injectEnemy(state: GameState, defId: string, kind?: EnemyKind): GameState {
  const def = content.enemies[defId]
  if (!def) throw new Error(`unknown enemy ${defId}`)
  const enemy: Enemy = {
    id: `etest${state.counter}`,
    def: defId,
    kind: kind ?? def.kind,
    hp: def.stats.hp,
    maxHp: def.stats.hp,
  }
  const encounter = state.encounter ?? { enemies: [], queue: [], waveSize: 0, spawnedInWave: 0 }
  return {
    ...state,
    counter: state.counter + 1,
    encounter: { ...encounter, enemies: [...encounter.enemies, enemy] },
  }
}
