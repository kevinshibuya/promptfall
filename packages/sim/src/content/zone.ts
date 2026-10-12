import type { ZoneDef } from './types'
import { zones } from './zones'

/** The last zone of the ladder: the advance gate farms from here, and no zone past it exists. */
export const LADDER_END = 12

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
