import type { GameState } from '../types'
import { rarity } from './rarity'
import type { AchievementMetric, AchievementRow } from './types'
import { zoneAt } from './zone'
import { zones } from './zones'

/** A ladder's steps pay these, in order: a three-step ladder pays the first three. */
export const LADDER_GOLD = [100, 400, 1500, 5000] as const
/** What a one-off pays. */
export const ONE_OFF_GOLD = 500

function ladder(
  id: string,
  name: string,
  reads: AchievementMetric,
  steps: [number, string][],
): AchievementRow {
  return {
    id,
    name,
    reads,
    steps: steps.map(([at, words], i) => ({ at, gold: LADDER_GOLD[i] ?? 0, words })),
  }
}

function oneOff(id: string, name: string, reads: AchievementMetric, at: number): AchievementRow {
  return { id, name, reads, steps: [{ at, gold: ONE_OFF_GOLD, words: name }] }
}

/**
 * The ledger's achievement table: each row names what it reads (`achievementCount`) and its steps.
 * The ledger evaluates it at each commit and pays a step once, with reason
 * `achievement:<id>:<step>`. Data no sim rule reads: a change here needs no bump.
 */
export const achievements: AchievementRow[] = [
  ladder('kills', 'Kills', 'kills', [
    [100, 'a hundred kills'],
    [1000, 'a thousand kills'],
    [10_000, 'ten thousand kills'],
    [100_000, 'a hundred thousand kills'],
  ]),
  ladder('zone_bosses', 'Zone bosses', 'zone_bosses', [
    [10, 'ten zone bosses'],
    [50, 'fifty zone bosses'],
    [200, 'two hundred zone bosses'],
    [1000, 'a thousand zone bosses'],
  ]),
  ladder('turn_bosses', 'Turn bosses', 'turn_bosses', [
    [10, 'ten turn bosses'],
    [100, 'a hundred turn bosses'],
    [1000, 'a thousand turn bosses'],
  ]),
  ladder('rare_drops', 'Rare finds', 'rare_drops', [
    [10, 'ten Rare or better drops'],
    [100, 'a hundred Rare or better drops'],
    [1000, 'a thousand Rare or better drops'],
  ]),
  ladder('legendary_drops', 'Legendary finds', 'legendary_drops', [
    [1, 'a Legendary drop'],
    [10, 'ten Legendary drops'],
    [50, 'fifty Legendary drops'],
  ]),
  ladder('recruits', 'Recruits', 'recruits', [
    [5, 'five recruits'],
    [25, 'twenty-five recruits'],
    [100, 'a hundred recruits'],
  ]),
  ladder('reforges', 'Reforges', 'reforges', [
    [10, 'ten reforges'],
    [100, 'a hundred reforges'],
  ]),
  ladder('gold_earned', 'Gold earned', 'gold_earned', [
    [10_000, 'ten thousand gold earned'],
    [100_000, 'a hundred thousand gold earned'],
    [1_000_000, 'a million gold earned'],
  ]),
  ladder('goals_met', 'Daily goals', 'goals_met', [
    [10, 'ten daily goals'],
    [50, 'fifty daily goals'],
    [200, 'two hundred daily goals'],
  ]),
  ladder('streak', 'Streak', 'streak', [
    [5, 'a five-day streak'],
    [20, 'a twenty-day streak'],
    [60, 'a sixty-day streak'],
    [250, 'a 250-day streak'],
  ]),
  ladder('zones_complete', 'Bestiary', 'zones_complete', [
    [1, 'a zone with every enemy defeated'],
    [4, 'four zones with every enemy defeated'],
    [8, 'eight zones with every enemy defeated'],
    [12, 'every zone with every enemy defeated'],
  ]),
  ladder('bases_complete', 'Collection', 'bases_complete', [
    [1, 'a base held in every rarity'],
    [10, 'ten bases held in every rarity'],
    [35, 'thirty-five bases held in every rarity'],
  ]),
  oneOff('first_epic', 'a first Epic', 'epic_held', 1),
  oneOff('first_legendary', 'a first Legendary', 'legendary_held', 1),
  oneOff('zone_6', 'zone 6 reached', 'highest_zone', 6),
  oneOff('zone_12', 'zone 12 cleared', 'highest_zone', 13),
  oneOff('tier_2', 'tier 2 reached', 'tier', 2),
  oneOff('tier_3', 'tier 3 reached', 'tier', 3),
  oneOff('clean_boss', 'a zone boss beaten with no wipe', 'clean_zone_bosses', 1),
  oneOff('all_capped', 'all four classes at their cap', 'classes_capped', 4),
]

/** What the journal adds to the state for the rows that read it. */
export type JournalCounts = { goalsMet: number; streak: number }

const sum = (counts: Record<string, number>) => Object.values(counts).reduce((a, b) => a + b, 0)

/** The count an achievement metric reads, from the state and the journal. */
export function achievementCount(
  metric: AchievementMetric,
  state: GameState,
  journal: JournalCounts,
): number {
  const t = state.tallies
  switch (metric) {
    case 'kills':
      return state.stats.kills
    case 'zone_bosses':
      return t.zoneBosses
    case 'turn_bosses':
      return t.turnBosses
    case 'rare_drops':
      return t.drops.rare + t.drops.epic + t.drops.legendary
    case 'legendary_drops':
      return t.drops.legendary
    case 'recruits':
      return sum(t.recruits)
    case 'reforges':
      return t.reforges
    case 'gold_earned':
      return t.goldEarned
    case 'goals_met':
      return journal.goalsMet
    case 'streak':
      return journal.streak
    case 'zones_complete':
      return zones.filter((z) =>
        [...z.enemies, z.boss, z.turnBoss].every((id) => (t.enemies[id]?.defeated ?? 0) > 0),
      ).length
    case 'bases_complete':
      return Object.values(t.collection).filter((marks) => Object.values(marks).every((m) => m > 0))
        .length
    // A rarity held by any route (#162): a recruit, a collection mark, or a hero in the roster,
    // which is how a bought hero arrives.
    case 'epic_held':
      return (
        t.recruits.epic +
        Object.values(t.collection).filter((m) => m.epic > 0).length +
        state.roster.filter((h) => h.rarity === 'epic').length
      )
    case 'legendary_held':
      return (
        t.recruits.legendary +
        Object.values(t.collection).filter((m) => m.legendary > 0).length +
        state.roster.filter((h) => h.rarity === 'legendary').length
      )
    case 'highest_zone':
      return state.highestZone
    case 'tier':
      return zoneAt(state.highestZone)?.tier ?? 1
    case 'clean_zone_bosses':
      return t.cleanZoneBosses
    case 'classes_capped':
      return new Set(
        state.roster.filter((h) => h.level >= rarity[h.rarity].levelCap).map((h) => h.cls),
      ).size
  }
}
