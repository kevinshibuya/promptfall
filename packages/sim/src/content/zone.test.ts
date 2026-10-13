import { describe, expect, it } from 'vitest'
import { enemyAt, LADDER_END, oddsAt, TIER_GROWTH_BP, zoneAt } from '../index'
import { content } from './index'

/** `bp` applied `k` times, as a plain ratio. */
const grown = (bp: number, k: number) => (bp / 10000) ** k
const [TIER2_BP = 0, TIER3_BP = 0] = TIER_GROWTH_BP
/** A zone boss's atk before its move scales it (#169); any other enemy's atk. */
const baseAtk = (e: { baseAtk?: number; stats: { atk: number } }) => e.baseAtk ?? e.stats.atk

describe('zoneAt', () => {
  it('answers zone 1 as tier 1, base zone 1, with its content', () => {
    expect(zoneAt(1)).toEqual({ base: 1, tier: 1, def: content.zones[0] })
    expect(zoneAt(1)?.def.name).toBe('Greenmeadow Road')
  })

  it('answers zone 12 as tier 1, base zone 12', () => {
    expect(zoneAt(12)).toEqual({ base: 12, tier: 1, def: content.zones[11] })
    expect(zoneAt(12)?.def.name).toBe('The Unwritten Reach')
  })

  it('answers zone 13 as tier 2, base zone 1, with zone 1 content', () => {
    expect(zoneAt(13)).toEqual({ base: 1, tier: 2, def: content.zones[0] })
  })

  it('answers zone 36 as tier 3, base zone 12', () => {
    expect(zoneAt(36)).toMatchObject({ base: 12, tier: 3 })
  })

  it('answers nothing for a zone below 1 or not a whole number', () => {
    expect(zoneAt(0)).toBeUndefined()
    expect(zoneAt(-3)).toBeUndefined()
    expect(zoneAt(1.5)).toBeUndefined()
    expect(zoneAt(Number.NaN)).toBeUndefined()
  })
})

describe('LADDER_END', () => {
  it('is tier 3’s zone 12', () => {
    expect(LADDER_END).toBe(36)
    expect(zoneAt(LADDER_END)).toMatchObject({ base: 12, tier: 3 })
  })
})

describe('enemyAt', () => {
  it('is the content’s enemy inside tier 1', () => {
    for (const zone of [1, 7, 12]) {
      for (const id of zoneAt(zone)?.def.enemies ?? []) {
        expect(enemyAt(id, zone)).toEqual(content.enemies[id])
      }
    }
  })

  it('gives zone 13 zone 1’s roster at zone 12’s numbers for its kind, grown once', () => {
    const boss = enemyAt('bandit_captain', 13)
    const top = content.enemies.unwritten_one
    if (!boss || !top) throw new Error('no boss')
    expect(boss).toMatchObject({ id: 'bandit_captain', name: 'Bandit Captain', zone: 13 })
    expect(boss.kind).toBe('zone_boss')
    const g = grown(TIER2_BP, 1)
    // No step at the tier's door: stats, xp and gold grow alike, atk read before each boss's move
    // scales it (#169).
    for (const stat of ['hp', 'def'] as const) {
      expect(boss.stats[stat] / top.stats[stat], stat).toBeCloseTo(g, 1)
    }
    expect(baseAtk(boss) / baseAtk(top), 'atk').toBeCloseTo(g, 1)
    expect(boss.stats.spd).toBe(top.stats.spd)
    expect(boss.xp / top.xp).toBeCloseTo(g, 1)
    expect(boss.gold[1]).toBeGreaterThanOrEqual(top.gold[1])
    // The Road Slime is a tank, as the Quill Golem is.
    const slime = enemyAt('road_slime', 13)
    const golem = content.enemies.quill_golem
    expect(slime?.stats.hp).toBeGreaterThan(golem?.stats.hp ?? Number.POSITIVE_INFINITY)
  })

  it('grows with every zone from 13 to 36, a continuation and not a restart', () => {
    const boss = (zone: number) => enemyAt(zoneAt(zone)?.def.boss ?? '', zone)
    let before = content.enemies.unwritten_one
    for (let zone = 13; zone <= LADDER_END; zone++) {
      const at = boss(zone)
      for (const stat of ['hp', 'def'] as const) {
        expect(at?.stats[stat], `zone ${zone} ${stat}`).toBeGreaterThan(before?.stats[stat] ?? 0)
      }
      // Atk before each boss's move scales it (#169): the moves differ zone to zone.
      expect(at && baseAtk(at), `zone ${zone} atk`).toBeGreaterThan(before ? baseAtk(before) : 0)
      // A small xp floors back for a zone or two, so it never shrinks and grows over the tier.
      expect(at?.xp, `zone ${zone} xp`).toBeGreaterThanOrEqual(before?.xp ?? 0)
      before = at
    }
    const top = content.enemies.unwritten_one
    const ramp = grown(TIER2_BP, 12)
    const at24 = boss(24)
    expect((at24 ? baseAtk(at24) : 0) / (top ? baseAtk(top) : 1)).toBeCloseTo(ramp, 0)
    expect((boss(24)?.xp ?? 0) / (top?.xp ?? 1)).toBeCloseTo(ramp, 0)
    expect((boss(36)?.xp ?? 0) / (top?.xp ?? 1)).toBeCloseTo(ramp * grown(TIER3_BP, 12), 0)
    expect((boss(36)?.gold[1] ?? 0) / (top?.gold[1] ?? 1)).toBeGreaterThan(2)
  })

  it('answers nothing for an unknown enemy or a zone off the ladder', () => {
    expect(enemyAt('nobody', 13)).toBeUndefined()
    expect(enemyAt('road_slime', 0)).toBeUndefined()
    expect(enemyAt('road_slime', LADDER_END + 1)).toBeUndefined()
  })
})

describe('oddsAt', () => {
  it('is the base zone inside tier 1 and zone 12 past it', () => {
    expect(oddsAt(4)).toBe(content.zones[3])
    expect(oddsAt(13)).toBe(content.zones[11])
    expect(oddsAt(36)).toBe(content.zones[11])
    expect(oddsAt(0)).toBeUndefined()
  })
})
