import { describe, expect, it } from 'vitest'
import { GAUGE_FULL, scaled } from './battle'
import { hitDamage } from './combat'
import { content, enemyAt, zoneAt } from './content'
import { actionWeights, pickAction, type Unit } from './picker'
import { heroStats, livingParty } from './progression'
import { createInitialState } from './state'
import { step } from './step'
import type { Effect, Enemy, GameState } from './types'

const BOSS = 'boss'

/**
 * The starting party against one zone boss at its own zone, the boss's gauge a step from full so
 * it acts first in the next tick. `hpBp` is the boss's HP share in basis points.
 */
function bossFight(
  defId: string,
  seed: number,
  hpBp = 10000,
  zone = content.enemies[defId]?.zone ?? 1,
): GameState {
  const max = enemyAt(defId, zone)?.stats.hp ?? 1
  const boss: Enemy = {
    id: BOSS,
    def: defId,
    kind: 'zone_boss',
    hp: Math.max(1, Math.floor((max * hpBp) / 10000)),
    maxHp: max,
    enraged: false,
  }
  return {
    ...createInitialState(seed),
    zone,
    highestZone: zone,
    encounter: { enemies: [boss], queue: [], waveSize: 1, spawnedInWave: 1 },
    battle: { gauges: [{ id: BOSS, g: GAUGE_FULL - 1 }], queue: [], busy: 0 },
  }
}

/** The boss's first act in these effects and every effect after it up to the next act. */
function firstBossAction(effects: Effect[]): Effect[] {
  const first = effects.findIndex((e) => e.k === 'act' && e.actor === BOSS)
  if (first < 0) return []
  const next = effects.findIndex((e, i) => i > first && e.k === 'act')
  return effects.slice(first, next < 0 ? undefined : next)
}

function hits(effects: Effect[]): Extract<Effect, { k: 'hit' }>[] {
  return effects.filter((e): e is Extract<Effect, { k: 'hit' }> => e.k === 'hit')
}

/** A hit's range from this attack on this hero: the variance roll's floor and ceiling. */
function hitRange(atk: number, def: number): [number, number] {
  return [hitDamage(atk, def, 9000), hitDamage(atk, def, 11000)]
}

function defOf(s: GameState, heroId: string): number {
  const hero = s.roster.find((h) => h.id === heroId)
  if (!hero) throw new Error(`no hero ${heroId}`)
  return heroStats(s, hero).def
}

describe('the zone bosses’ moves', () => {
  const BY_ZONE = [
    'strike_twice',
    'heal_self',
    'hit_all',
    'rage',
    'strike_twice',
    'heal_self',
    'hit_all',
    'rage',
    'strike_twice',
    'heal_self',
    'hit_all',
    'rage',
  ]

  it('spreads four moves over the twelve zones: 1, 5 and 9 strike twice, 2, 6 and 10 heal, 3, 7 and 11 hit all, 4, 8 and 12 rage', () => {
    const moves = content.zones.map((z) => content.enemies[z.boss]?.move)
    expect(moves).toEqual(BY_ZONE)
  })

  it('gives no turn boss and no wave enemy a move', () => {
    for (const def of Object.values(content.enemies)) {
      if (def.kind !== 'zone_boss') expect(def.move, def.id).toBeUndefined()
    }
  })

  it('carries a base zone’s move to the tiers: zone 13 strikes twice, zone 36 rages', () => {
    for (const zone of [13, 14, 24, 25, 36]) {
      const boss = zoneAt(zone)?.def.boss ?? ''
      expect(enemyAt(boss, zone)?.move).toBe(BY_ZONE[(zone - 1) % 12])
    }
  })
})

describe('strikes twice', () => {
  it('lands two hits on one target in one act, each from 70% of its attack', () => {
    const atk = enemyAt('bandit_captain', 1)?.stats.atk ?? 0
    for (let seed = 1; seed <= 20; seed++) {
      const s = bossFight('bandit_captain', seed)
      const action = firstBossAction(step(s, { t: 'tick' }).effects)
      expect(action[0]).toMatchObject({ k: 'act', actor: BOSS, action: 'attack_twice' })
      const [first, second, ...more] = hits(action)
      expect(more).toEqual([])
      expect(first?.target).toBeDefined()
      expect(second?.target).toBe(first?.target)
      const [lo, hi] = hitRange(Math.floor((atk * 7000) / 10000), defOf(s, first?.target ?? ''))
      for (const hit of [first, second]) {
        expect(hit?.amount).toBeGreaterThanOrEqual(lo)
        expect(hit?.amount).toBeLessThanOrEqual(hi)
      }
    }
  })

  it('every strike-twice boss strikes twice, and a turn boss attacks once', () => {
    for (const id of ['bandit_captain', 'glass_leviathan', 'waste_tyrant']) {
      const action = firstBossAction(step(bossFight(id, 3), { t: 'tick' }).effects)
      expect(action[0], id).toMatchObject({ action: 'attack_twice' })
    }
    const turn = bossFight('wild_boar', 3)
    const enemy = turn.encounter?.enemies[0]
    if (enemy) enemy.kind = 'turn_boss'
    const action = firstBossAction(step(turn, { t: 'tick' }).effects)
    expect(action[0]).toMatchObject({ action: 'attack' })
    expect(hits(action)).toHaveLength(1)
  })

  it('zone 13’s boss, zone 1’s in tier 2, strikes twice, and stops at a fallen target', () => {
    // A level-1 party at zone 13: the first hit may fell its target, and then the second never lands.
    const action = firstBossAction(
      step(bossFight('bandit_captain', 4, 10000, 13), { t: 'tick' }).effects,
    )
    expect(action[0]).toMatchObject({ action: 'attack_twice' })
    const struck = hits(action)
    const fell = action.find((e) => e.k === 'hero_fell')
    if (struck.length === 1) expect(fell).toEqual({ k: 'hero_fell', heroId: struck[0]?.target })
    else expect(struck.map((h) => h.target)).toEqual([struck[0]?.target, struck[0]?.target])
  })

  it('the world boss at zone 1 attacks once', () => {
    const s = step(createInitialState(4), {
      t: 'boss_engaged',
      bossId: 'wb1',
      name: 'The Promptwyrm',
      glyph: '☠',
      stats: { hp: 900, atk: 14, def: 4, spd: 5 },
    }).state
    const boss = s.encounter?.enemies[0]
    if (!boss) throw new Error('no world boss')
    s.battle = { gauges: [{ id: boss.id, g: GAUGE_FULL - 1 }], queue: [], busy: 0 }
    const r = step(s, { t: 'tick' })
    const first = r.effects.findIndex((e) => e.k === 'act' && e.actor === boss.id)
    expect(r.effects[first]).toMatchObject({ action: 'attack' })
    expect(r.effects[first + 1]).toMatchObject({ k: 'hit', by: boss.id })
    const after = r.effects[first + 2]
    expect(after?.k === 'hit' && after.by === boss.id).toBe(false)
  })
})

describe('hits the whole party', () => {
  const unit = (s: GameState): Unit => {
    const enemy = s.encounter?.enemies[0]
    if (!enemy) throw new Error('no boss')
    return { side: 'enemy', enemy }
  }

  it('sweeps one action in three beside its single attack while the party stands', () => {
    const s = bossFight('sigh_hag', 1)
    expect(actionWeights(s, unit(s))).toEqual({ attack: 150, attack_all: 75 })
    // One mage down: the single attack weighs less, the sweep as much.
    const mage = s.roster.find((h) => h.cls === 'black_mage')
    if (mage) mage.hp = 0
    expect(actionWeights(s, unit(s))).toEqual({ attack: 130, attack_all: 75 })
    let sweeps = 0
    for (let i = 0; i < 300; i++) {
      const at = bossFight('sigh_hag', 1)
      at.rng = (i * 2654435761 + 17) >>> 0
      if (pickAction(at, unit(at))?.action === 'attack_all') sweeps++
    }
    expect(sweeps).toBeGreaterThanOrEqual(80)
    expect(sweeps).toBeLessThanOrEqual(120)
  })

  it('hits every living hero once in one act, each from 60% of its attack', () => {
    const atk = enemyAt('sigh_hag', 3)?.stats.atk ?? 0
    let swept = 0
    for (let seed = 1; seed <= 60; seed++) {
      const s = bossFight('sigh_hag', seed)
      const action = firstBossAction(step(s, { t: 'tick' }).effects)
      if (!action[0] || !('action' in action[0]) || action[0].action !== 'attack_all') continue
      swept++
      expect(action[0]).toMatchObject({ k: 'act', actor: BOSS, action: 'attack_all' })
      const struck = hits(action)
      expect(struck.map((h) => h.target)).toEqual(livingParty(s).map((h) => h.id))
      for (const hit of struck) {
        const [lo, hi] = hitRange(Math.floor((atk * 6000) / 10000), defOf(s, hit.target))
        expect(hit.amount).toBeGreaterThanOrEqual(lo)
        expect(hit.amount).toBeLessThanOrEqual(hi)
      }
    }
    expect(swept).toBeGreaterThan(0)
  })
})

describe('heals itself', () => {
  const unit = (s: GameState): Unit => {
    const enemy = s.encounter?.enemies[0]
    if (!enemy) throw new Error('no boss')
    return { side: 'enemy', enemy }
  }

  /** The boss's choices over many rng positions at this HP share. */
  function heals(hpBp: number): number {
    let n = 0
    for (let i = 0; i < 500; i++) {
      const s = bossFight('elder_treant', 1, hpBp)
      s.rng = (i * 2654435761 + 17) >>> 0
      const choice = pickAction(s, unit(s))
      if (choice?.action === 'heal') {
        expect(choice.targetId).toBe(BOSS)
        n++
      }
    }
    return n
  }

  it('never heals at half its HP or above, and heals more the lower it is', () => {
    expect(heals(10000)).toBe(0)
    expect(heals(5000)).toBe(0)
    const quarter = heals(2500)
    const tenth = heals(1000)
    expect(quarter).toBeGreaterThan(0)
    expect(tenth).toBeGreaterThan(quarter)
  })

  it('heals itself for 50% of its attack, scaled by power, with a heal effect and no hit', () => {
    const atk = enemyAt('elder_treant', 2)?.stats.atk ?? 0
    let seen = 0
    for (let seed = 1; seed <= 60; seed++) {
      const s = bossFight('elder_treant', seed, 1000)
      const r = step(s, { t: 'tick' })
      const action = firstBossAction(r.effects)
      if (action[0]?.k !== 'act' || action[0].action !== 'heal') continue
      seen++
      expect(action.slice(1)).toEqual([
        { k: 'heal', by: BOSS, target: BOSS, amount: scaled(Math.floor((atk * 5000) / 10000)) },
      ])
    }
    expect(seen).toBeGreaterThan(0)
  })

  it('a heal never takes it past its maximum', () => {
    // 1 of 11: deep under half, and 10 short of a maximum its heal of 16 would pass.
    const s = bossFight('elder_treant', 1)
    const boss = s.encounter?.enemies[0]
    if (!boss) throw new Error('no boss')
    boss.hp = 1
    boss.maxHp = 11
    const amounts: number[] = []
    for (let seed = 1; seed <= 60; seed++) {
      const r = step({ ...s, rng: seed * 7919 }, { t: 'tick' })
      const heal = firstBossAction(r.effects).find((e) => e.k === 'heal')
      if (heal?.k === 'heal') amounts.push(heal.amount)
    }
    expect(amounts.length).toBeGreaterThan(0)
    expect(new Set(amounts)).toEqual(new Set([10]))
  })
})

describe('rages under half its HP', () => {
  const atk = enemyAt('barrow_king', 4)?.stats.atk ?? 0

  function firstHit(hpBp: number, seed: number) {
    const s = bossFight('barrow_king', seed, hpBp)
    const [hit] = hits(firstBossAction(step(s, { t: 'tick' }).effects))
    if (!hit) throw new Error('no hit')
    return { hit, def: defOf(s, hit.target) }
  }

  it('hits from its attack above half and from 150% of it under half', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const above = firstHit(6000, seed)
      const [lo, hi] = hitRange(atk, above.def)
      expect(above.hit.amount).toBeGreaterThanOrEqual(lo)
      expect(above.hit.amount).toBeLessThanOrEqual(hi)
      const under = firstHit(4999, seed)
      const [rlo, rhi] = hitRange(Math.floor((atk * 15000) / 10000), under.def)
      expect(under.hit.amount).toBeGreaterThanOrEqual(rlo)
      expect(under.hit.amount).toBeLessThanOrEqual(rhi)
    }
  })

  it('scales both ways when it is also enraged, on that one hit', () => {
    const s = bossFight('barrow_king', 5, 4000)
    const boss = s.encounter?.enemies[0]
    if (boss) boss.enraged = true
    const r = step(s, { t: 'tick' })
    const [hit] = hits(firstBossAction(r.effects))
    if (!hit) throw new Error('no hit')
    const both = Math.floor((Math.floor((atk * 15000) / 10000) * 15000) / 10000)
    const [lo, hi] = hitRange(both, defOf(s, hit.target))
    expect(hit.amount).toBeGreaterThanOrEqual(lo)
    expect(hit.amount).toBeLessThanOrEqual(hi)
    expect(r.state.encounter?.enemies[0]?.enraged).toBe(false)
  })

  it('emits raging once, on the hit that takes it under half', () => {
    // A boss a point above half: the party's first hit takes it under, and no later hit raises it again.
    const s = bossFight('barrow_king', 2)
    const boss = s.encounter?.enemies[0]
    if (!boss) throw new Error('no boss')
    boss.hp = Math.floor(boss.maxHp / 2) + 1
    if (s.battle.gauges[0]) s.battle.gauges[0].g = 0
    let state = s
    const all: Effect[] = []
    for (let i = 0; i < 6; i++) {
      const r = step(state, { t: 'tick' })
      all.push(...r.effects)
      state = r.state
    }
    const raging = all.flatMap((e, i) => (e.k === 'raging' ? [i] : []))
    expect(raging).toHaveLength(1)
    const at = raging[0] ?? -1
    expect(all[at]).toEqual({ k: 'raging', enemyId: BOSS })
    expect(all[at - 1]).toMatchObject({ k: 'hit', target: BOSS })
  })

  it('a boss with another move never rages', () => {
    const s = bossFight('bandit_captain', 2)
    const boss = s.encounter?.enemies[0]
    if (!boss) throw new Error('no boss')
    boss.hp = Math.floor(boss.maxHp / 2) + 1
    let state = s
    for (let i = 0; i < 6; i++) {
      const r = step(state, { t: 'tick' })
      expect(r.effects.some((e) => e.k === 'raging')).toBe(false)
      state = r.state
    }
  })
})
