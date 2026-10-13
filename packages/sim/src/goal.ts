import { content, enemyAt, zoneAt } from './content'
import type { GoalKind } from './content/types'
import { fnv1a32 } from './hash'
import { nextU32 } from './rng'
import type { GameState } from './types'

export type DailyGoal = { kind: GoalKind; target: number }

/**
 * The day's goal for an account: a row of the goal table drawn with the sim's PRNG, seeded from a
 * hash of the UTC day index and the account id, its target scaled to the party's zone. Pure: the
 * ledger and the plugin derive the same goal from the same inputs. No sim rule reads it.
 */
export function dailyGoal(day: number, accountId: string, zone: number): DailyGoal {
  const { u } = nextU32(fnv1a32(`${day}:${accountId}`, 0x811c9dc5))
  const row = content.goals[u % content.goals.length]
  if (!row) throw new Error('dailyGoal: the goal table is empty')
  const zonesPast = Math.max(0, Math.floor(zone) - 1)
  return { kind: row.kind, target: row.base + row.step * Math.floor(zonesPast / row.everyZones) }
}

/** What a goal of this kind counts, read from the state: progress is its rise since the day opened. */
export function goalCount(kind: GoalKind, state: GameState): number {
  const t = state.tallies
  switch (kind) {
    case 'kills':
      return state.stats.kills
    case 'zone_bosses':
      return t.zoneBosses
    case 'rare_drops':
      return t.drops.rare + t.drops.epic + t.drops.legendary
    case 'turn_boss':
      return t.turnBosses
  }
}

/** A met goal pays this many of its zone's mean wave kill gold: about an hour of kills at the reference cadence. */
export const GOAL_GOLD_KILLS = 300

/**
 * What the day's goal pays, from the zone the day opened at: the mean over the zone's four wave
 * enemies of each one's gold range midpoint, times `GOAL_GOLD_KILLS`, rounded. 0 off the ladder.
 */
export function goalGold(zone: number): number {
  const wave = zoneAt(zone)?.def.enemies ?? []
  const mids = wave.flatMap((id) => {
    const gold = enemyAt(id, zone)?.gold
    return gold ? [(gold[0] + gold[1]) / 2] : []
  })
  if (mids.length === 0) return 0
  return Math.round((mids.reduce((a, b) => a + b, 0) / mids.length) * GOAL_GOLD_KILLS)
}
