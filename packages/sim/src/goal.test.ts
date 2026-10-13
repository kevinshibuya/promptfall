import { describe, expect, it } from 'vitest'
import { content, enemyAt, LADDER_END } from './content'
import { type DailyGoal, dailyGoal, goalCount, goalGold } from './goal'
import { createInitialState } from './state'
import type { GameState } from './types'

const DAY0 = 20_000

function goalsOver(days: number, accountId: string, zone: number): DailyGoal[] {
  return Array.from({ length: days }, (_, i) => dailyGoal(DAY0 + i, accountId, zone))
}

describe('the daily goal', () => {
  it('is the same for the same day, account and zone on every call', () => {
    for (let i = 0; i < 10; i++) {
      expect(dailyGoal(DAY0 + i, 'acct-a', 4)).toEqual(dailyGoal(DAY0 + i, 'acct-a', 4))
    }
  })

  it('differs at least once over thirty consecutive days', () => {
    const kinds = new Set(goalsOver(30, 'acct-a', 1).map((g) => g.kind))
    expect(kinds.size).toBeGreaterThanOrEqual(2)
  })

  it('reads the account: two accounts do not share every day', () => {
    const a = goalsOver(30, 'acct-a', 1).map((g) => g.kind)
    const b = goalsOver(30, 'acct-b', 1).map((g) => g.kind)
    expect(a).not.toEqual(b)
  })

  it('draws every kind in the table, and never the world boss', () => {
    const kinds = new Set(goalsOver(400, 'acct-a', 1).map((g) => g.kind))
    expect([...kinds].sort()).toEqual(content.goals.map((g) => g.kind).sort())
    expect(content.goals.map((g) => g.kind)).not.toContain('world_boss')
  })

  it("scales each kind's target to the zone from its base", () => {
    for (const row of content.goals) {
      // A day whose draw is this row, at zone 1 and at the ladder's end.
      const day = Array.from({ length: 400 }, (_, i) => DAY0 + i).find(
        (d) => dailyGoal(d, 'acct-a', 1).kind === row.kind,
      )
      if (day === undefined) throw new Error(`no day draws ${row.kind}`)
      expect(dailyGoal(day, 'acct-a', 1)).toEqual({ kind: row.kind, target: row.base })
      const far = dailyGoal(day, 'acct-a', 36)
      expect(far.kind).toBe(row.kind)
      expect(far.target).toBe(row.base + row.step * Math.floor(35 / row.everyZones))
      if (row.step > 0) expect(far.target).toBeGreaterThan(row.base)
    }
  })

  it('the turn boss goal is one turn boss at every zone', () => {
    const row = content.goals.find((g) => g.kind === 'turn_boss')
    expect(row).toMatchObject({ base: 1, step: 0 })
  })
})

describe('the goal count', () => {
  const s0 = createInitialState(1)
  const later: GameState = {
    ...s0,
    stats: { ...s0.stats, kills: 40 },
    tallies: {
      ...s0.tallies,
      zoneBosses: 3,
      turnBosses: 2,
      drops: { common: 9, uncommon: 4, rare: 2, epic: 1, legendary: 1 },
    },
  }

  it('measures each kind from the state', () => {
    expect(goalCount('kills', later)).toBe(40)
    expect(goalCount('zone_bosses', later)).toBe(3)
    expect(goalCount('turn_boss', later)).toBe(2)
    expect(goalCount('rare_drops', later)).toBe(4)
    for (const row of content.goals) expect(goalCount(row.kind, s0)).toBe(0)
  })
})

describe('the goal gold', () => {
  it("is 300 times the mean of the zone's wave gold midpoints", () => {
    for (const zone of [1, 7, 13, LADDER_END]) {
      const base = content.zones[(zone - 1) % 12]
      if (!base) throw new Error(`zone ${zone}`)
      const mids = base.enemies.map((id) => {
        const [min, max] = enemyAt(id, zone)?.gold ?? [0, 0]
        return (min + max) / 2
      })
      const mean = mids.reduce((a, b) => a + b, 0) / mids.length
      expect(goalGold(zone)).toBe(Math.round(mean * 300))
    }
  })

  it('grows with the zone and pays nothing off the ladder', () => {
    expect(goalGold(1)).toBeGreaterThan(0)
    expect(goalGold(12)).toBeGreaterThan(goalGold(1))
    expect(goalGold(0)).toBe(0)
    expect(goalGold(LADDER_END + 1)).toBe(0)
  })
})
