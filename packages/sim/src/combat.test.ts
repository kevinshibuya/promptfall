import { describe, expect, it } from 'vitest'
import { scaledBossStats } from './combat'
import { content } from './content'
import { heroStats, livingParty } from './progression'
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
      tradeableAt: null,
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

  it('two or three White Mages still fight: one heal lands per round', () => {
    // Before the rule, three level 5 White Mages on seed 1 went 1155 rounds without a kill.
    for (const n of [2, 3]) {
      const s0 = createInitialState(1)
      const wm = s0.roster.find((h) => h.cls === 'white_mage')
      const knight = s0.roster.find((h) => h.cls === 'knight')
      if (!wm || !knight) throw new Error('roster')
      const extra = ['hw2', 'hw3'].map((id) => ({ ...wm, id, level: 5 }))
      const roster = [
        ...s0.roster.map((h) => ({ ...h, level: 5, hp: h.id === knight.id && n === 2 ? 0 : h.hp })),
        ...extra,
      ]
      const party: [string, string, string] =
        n === 3 ? [wm.id, 'hw2', 'hw3'] : [wm.id, 'hw2', knight.id]
      let s: GameState = { ...s0, roster, party }
      let since = 0
      let worst = 0
      for (let i = 0; i < 2000; i++) {
        const r = step(s, { t: 'tick' })
        s = r.state
        const progress = r.effects.some((e) => e.k === 'gold' || e.k === 'wipe') || !s.encounter
        since = progress ? 0 : since + 1
        worst = Math.max(worst, since)
      }
      expect({ n, worst: worst < 200 }).toEqual({ n, worst: true })
    }
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
      tradeableAt: null,
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

describe('the hit effect', () => {
  type Hit = Extract<Effect, { k: 'hit' }>
  const hits = (effects: Effect[]): Hit[] => effects.filter((e): e is Hit => e.k === 'hit')

  it('one round yields one hit per attack, in actor order, with the right ids', () => {
    const s = injectEnemy(injectEnemy(createInitialState(5), 'road_slime'), 'road_slime')
    const enemies = s.encounter?.enemies ?? []
    const heroIds = new Set(livingParty(s).map((h) => h.id))
    const enemyIds = new Set(enemies.map((e) => e.id))
    const r = run(s, [{ t: 'tick' }])
    const list = hits(r.effects)
    expect(list.length).toBeGreaterThan(0)
    for (const h of list) {
      expect(h.amount).toBeGreaterThan(0)
      const heroSide = heroIds.has(h.by)
      expect(heroSide || enemyIds.has(h.by)).toBe(true)
      expect(heroSide ? enemyIds.has(h.target) : heroIds.has(h.target)).toBe(true)
    }
    // Every living actor acts once, in the round's speed order (stable: heroes before enemies).
    const actors = [
      ...livingParty(s).map((h) => ({ id: h.id, spd: heroStats(s, h).spd })),
      ...enemies.map((e) => ({ id: e.id, spd: content.enemies[e.def]?.stats.spd ?? 0 })),
    ].sort((a, b) => b.spd - a.spd)
    const order = list.map((h) => h.by).filter((by, i, all) => all[i - 1] !== by)
    expect(order).toEqual(actors.map((a) => a.id).filter((id) => order.includes(id)))
    expect(new Set(order).size).toBe(order.length)
    // The black mage sweeps: one hit per enemy.
    const mage = livingParty(s).find((h) => h.cls === 'black_mage')
    if (mage) expect(list.filter((h) => h.by === mage.id)).toHaveLength(enemies.length)
  })

  it('a world-boss hit reports its amount while the boss hp stays put', () => {
    const engaged = run(createInitialState(1), [
      {
        t: 'boss_engaged',
        bossId: 'wb1',
        name: 'The Promptwyrm',
        glyph: '☠',
        stats: { hp: 630, atk: 14, def: 4, spd: 5 },
      },
    ]).state
    const boss = engaged.encounter?.enemies[0]
    if (!boss) throw new Error('no boss')
    const r = run(engaged, [{ t: 'tick' }])
    const onBoss = hits(r.effects).filter((h) => h.target === boss.id)
    expect(onBoss.length).toBeGreaterThan(0)
    const dealt = onBoss.reduce((sum, h) => sum + h.amount, 0)
    expect(r.state.boss?.dealt).toBe((engaged.boss?.dealt ?? 0) + dealt)
    expect(r.state.encounter?.enemies[0]?.hp).toBe(boss.hp)
    expect(hits(r.effects).some((h) => h.by === boss.id)).toBe(scaledBossStats(engaged).atk > 0)
  })

  it('a heal yields no hit', () => {
    const s0 = injectEnemy(createInitialState(5), 'road_slime')
    const mage = s0.roster.find((h) => h.cls === 'white_mage')
    const knight = s0.roster.find((h) => h.cls === 'knight')
    if (!mage || !knight) throw new Error('roster')
    const max = heroStats(s0, knight).hp
    const s: GameState = {
      ...s0,
      roster: s0.roster.map((h) => (h.id === knight.id ? { ...h, hp: Math.floor(max / 2) } : h)),
    }
    const r = run(s, [{ t: 'tick' }])
    expect(hits(r.effects).filter((h) => h.by === mage.id)).toEqual([])
  })

  it("a kill's drop follows the hit that killed its enemy", () => {
    for (let seed = 1; seed < 400; seed++) {
      const s0 = injectEnemy(createInitialState(seed), 'goblin_scout')
      const enc = s0.encounter
      const enemy = enc?.enemies[0]
      if (!enc || !enemy) throw new Error('enc')
      const s: GameState = { ...s0, encounter: { ...enc, enemies: [{ ...enemy, hp: 1 }] } }
      const r = run(s, [{ t: 'tick' }])
      const at = r.effects.findIndex((e) => e.k === 'drop' || e.k === 'drop_vendored')
      if (at < 0) continue
      const before = hits(r.effects.slice(0, at))
      expect(before.at(-1)?.target).toBe(enemy.id)
      return
    }
    throw new Error('no drop in 400 seeds')
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
