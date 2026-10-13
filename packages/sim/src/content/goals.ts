import type { GoalRow } from './types'

/**
 * The daily goal's pool: the ledger and the plugin draw one row a day per account (`dailyGoal`).
 * A target is `base`, plus `step` for every `everyZones` zones past zone 1 at the day's first
 * commit. Data no sim rule reads. The world boss is not in it: its flag can be off.
 */
export const goals: GoalRow[] = [
  { kind: 'kills', base: 150, step: 10, everyZones: 1 },
  { kind: 'zone_bosses', base: 2, step: 1, everyZones: 12 },
  { kind: 'rare_drops', base: 3, step: 1, everyZones: 6 },
  { kind: 'turn_boss', base: 1, step: 0, everyZones: 1 },
]
