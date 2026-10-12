import { describe, expect, it } from 'vitest'
import { buildEnemies, ENEMY_TUNING, enemies, TIER_GROWTH_BP } from './enemies'
import { enemyAt } from './zone'

describe('buildEnemies', () => {
  it("scales a zone's xp by its zoneXpBp, boss multipliers on top", () => {
    const base = buildEnemies({ ...ENEMY_TUNING, zoneXpBp: [] })
    const zoneXpBp = [10000, 10000, 5000]
    const tuned = buildEnemies({ ...ENEMY_TUNING, zoneXpBp })

    const wave = base.bog_lurker?.xp ?? 0
    expect(tuned.bog_lurker?.xp).toBe(Math.floor((wave * 5000) / 10000))
    expect(tuned.sigh_hag?.xp).toBe(Math.floor((wave * 5000) / 10000) * 8)
    expect(tuned.bramble_wolf?.xp).toBe(base.bramble_wolf?.xp)
  })

  it("scales a zone boss's hp by its zone's zoneBossHpBp, and nothing else", () => {
    const base = buildEnemies({ ...ENEMY_TUNING, zoneBossHpBp: [] })
    const tuned = buildEnemies({ ...ENEMY_TUNING, zoneBossHpBp: [10000, 10000, 25000] })

    const boss = base.sigh_hag
    if (!boss) throw new Error('no boss')
    expect(tuned.sigh_hag?.stats).toEqual({
      ...boss.stats,
      hp: Math.floor((boss.stats.hp * 25000) / 10000),
    })
    expect(tuned.sigh_hag?.xp).toBe(boss.xp)
    expect(tuned.elder_treant).toEqual(base.elder_treant)
    expect(tuned.bog_lurker).toEqual(base.bog_lurker)
    expect(tuned.giant_heron).toEqual(base.giant_heron)
  })
})

describe('the tier ramp', () => {
  // Sim 12's numbers, when tier 2 opened on a ×2.78 step and grew ×1.04 a zone: the ramp keeps
  // zone 24 and tier 3 where they were, since 1.1325¹² = 2.78 × 1.04¹² = 4.45. The two products
  // agree to the fourth decimal and not past it, so atk lands on the same point and def, floored
  // from a smaller baseline, one or two points above. Hp follows zone 12's since sim 12: sim 14
  // (#153) raised its wave hp from 4750 to zoneHpBp's and its boss's by zoneBossHpBp, so tier
  // hp is sim 12's times that factor, to within the floors.
  const SIM_12_ZONE_12_HP_BP = 4750
  const SIM_12: Record<number, Record<string, { hp: number; atk: number; def: number }>> = {
    24: {
      road_slime: { hp: 3850, atk: 337, def: 409 },
      field_rat: { hp: 2200, atk: 422, def: 220 },
      goblin_scout: { hp: 3300, atk: 464, def: 283 },
      hedge_sprite: { hp: 2475, atk: 527, def: 252 },
      bandit_captain: { hp: 19250, atk: 844, def: 378 },
      wild_boar: { hp: 8250, atk: 506, def: 346 },
    },
    36: {
      road_slime: { hp: 6164, atk: 540, def: 655 },
      field_rat: { hp: 3522, atk: 676, def: 352 },
      goblin_scout: { hp: 5283, atk: 743, def: 453 },
      hedge_sprite: { hp: 3962, atk: 845, def: 403 },
      bandit_captain: { hp: 30821, atk: 1352, def: 604 },
      wild_boar: { hp: 13209, atk: 811, def: 554 },
    },
  }

  for (const zone of [24, 36]) {
    it(`keeps zone ${zone}'s atk and def at sim 12's and its hp at zone 12's, one enemy per archetype`, () => {
      const hpBp = ENEMY_TUNING.zoneHpBp[11] ?? 0
      const bossBp = ENEMY_TUNING.zoneBossHpBp[11] ?? 0
      for (const [id, was] of Object.entries(SIM_12[zone] ?? {})) {
        const now = enemyAt(id, zone)
        const factor =
          (hpBp / SIM_12_ZONE_12_HP_BP) * (now?.kind === 'zone_boss' ? bossBp / 10000 : 1)
        expect((now?.stats.hp ?? 0) / was.hp / factor, `${id} hp`).toBeCloseTo(1, 2)
        expect(now?.stats.atk, `${id} atk`).toBe(was.atk)
        expect(now?.stats.def, `${id} def`).toBeGreaterThanOrEqual(was.def)
        expect(now?.stats.def, `${id} def`).toBeLessThanOrEqual(Math.ceil(was.def * 1.005))
      }
    })
  }

  it('opens tier 2 on zone 12 grown once at ×1.1325, with no step: stats, xp and gold alike', () => {
    const top = enemies.unwritten_one
    const boss = enemyAt('bandit_captain', 13)
    if (!top || !boss) throw new Error('no boss')
    expect(TIER_GROWTH_BP).toEqual([11325, 10400])
    for (const stat of ['hp', 'atk', 'def'] as const) {
      expect(boss.stats[stat] / top.stats[stat], stat).toBeCloseTo(1.1325, 1)
    }
    expect(boss.xp / top.xp).toBeCloseTo(1.1325, 1)
    expect(boss.gold[1] / top.gold[1]).toBeCloseTo(1.1325, 1)
  })

  it('grows xp and gold at the stats’ rate, through tier 2 and on into tier 3', () => {
    const top = enemies.unwritten_one
    const at24 = enemyAt('bandit_captain', 24)
    const at36 = enemyAt('bandit_captain', 36)
    if (!top || !at24 || !at36) throw new Error('no boss')
    for (const [at, ratio] of [
      [at24, 1.1325 ** 12],
      [at36, 1.1325 ** 12 * 1.04 ** 12],
    ] as const) {
      expect(at.stats.hp / top.stats.hp).toBeCloseTo(ratio, 1)
      expect(at.xp / top.xp).toBeCloseTo(ratio, 0)
      expect(at.gold[1] / top.gold[1]).toBeCloseTo(ratio, 0)
    }
  })
})
