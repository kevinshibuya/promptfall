import { zoneAt } from './vendor/sim.js'

// A running zone as the player reads it: one formatter for the titles, the toasts, the log and
// the boards, so a tier past 12 reads the same everywhere.

/** "zone 4" inside tier 1, "tier 2, zone 1" past it. */
export function zonePhrase(zone: number): string {
  const at = zoneAt(zone)
  return at && at.tier > 1 ? `tier ${at.tier}, zone ${at.base}` : `zone ${zone}`
}

/** The phrase at the head of a line or a title: "Zone 4", "Tier 2, zone 1". */
export function zoneHead(zone: number): string {
  const phrase = zonePhrase(zone)
  return phrase.charAt(0).toUpperCase() + phrase.slice(1)
}

/** The phrase and the zone's name: "tier 2, zone 1, Greenmeadow Road". No name when it has none. */
export function zoneWords(zone: number): string {
  const name = zoneAt(zone)?.def.name
  return name ? `${zonePhrase(zone)}, ${name}` : zonePhrase(zone)
}

/**
 * A zone on a board or a row: "12" inside tier 1, "T2 Z1" past it. `word` leads the number
 * inside tier 1 only, for a row that says "z12" or "zone 12" there.
 */
export function zoneMark(zone: number, word = ''): string {
  const at = zoneAt(zone)
  return at && at.tier > 1 ? `T${at.tier} Z${at.base}` : `${word}${zone}`
}
