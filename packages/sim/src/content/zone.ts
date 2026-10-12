import { buildTierEnemies, ENEMY_TUNING, enemies, TIER_GROWTH_BP } from './enemies'
import type { EnemyDef, ZoneDef } from './types'
import { zones } from './zones'

/** The last zone of the ladder, tier 3's zone 12: the advance gate farms from here, and no zone past it exists. */
export const LADDER_END = 36

export type ZoneAt = {
  /** The zone within its tier, 1 to 12: whose enemies, boss, weights, name and backdrop it has. */
  base: number
  tier: number
  def: ZoneDef
}

/**
 * A running zone number as its tier and base zone, with the base zone's content: 13 is tier 2's
 * zone 1. Every content lookup by zone goes through here. Nothing for a zone below 1.
 */
export function zoneAt(zone: number): ZoneAt | undefined {
  if (!Number.isInteger(zone) || zone < 1) return undefined
  const base = ((zone - 1) % zones.length) + 1
  const def = zones[base - 1]
  if (!def) return undefined
  return { base, tier: Math.floor((zone - 1) / zones.length) + 1, def }
}

const tierEnemies = buildTierEnemies(ENEMY_TUNING, TIER_GROWTH_BP, LADDER_END)

/**
 * An enemy as it fights at a running zone: the content's own inside tier 1, past it zone 12's
 * numbers grown per zone. Every lookup of an enemy's numbers by zone goes through here. Nothing
 * for an unknown enemy or a zone off the ladder.
 */
export function enemyAt(id: string, zone: number): EnemyDef | undefined {
  const at = zoneAt(zone)
  if (!at || zone > LADDER_END) return undefined
  return at.tier === 1 ? enemies[id] : tierEnemies[zone]?.[id]
}

/** The zone whose rarity weights a running zone drops at: its base zone in tier 1, zone 12 past it. */
export function oddsAt(zone: number): ZoneDef | undefined {
  const at = zoneAt(zone)
  if (!at) return undefined
  return at.tier === 1 ? at.def : zones[zones.length - 1]
}
