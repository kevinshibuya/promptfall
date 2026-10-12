import type { Rarity } from '../types'

/**
 * The reference party at one running zone: "a party at its tier's level in its tier's gear", as
 * one definition. The Knight is the hero the feel probe measures; the others stay Common unless
 * the row names them.
 */
export type ReferenceRow = {
  zone: number
  /** The level the party holds while it fights the zone at the reference cadence. */
  level: number
  knightRarity: Rarity
  /**
   * The item tier worn: tiers 1 to 4 are the bases whose minimum zone is 3t-2 to 3t; tiers 5 and
   * 6, the later ladder tiers' drops, are tier 4's bases at that tier.
   */
  gearTier: number
  gearRarity: Rarity
  /**
   * Where the gear's affixes roll in their ranges, in basis points: 0 the floor, 10000 the top.
   * Absent, the gear has no affixes, as tier 1's rows.
   */
  rollBp?: number
  /** The Black Mage and the White Mage beside the Knight; Common at the Knight's level when absent. */
  others?: { rarity: Rarity; level: number }
}

/**
 * Tuned by the harness for sim version 6 (ticket #138): each row is where the arc runs of
 * `arc.test.ts` put the party, and the zone's enemy atk is set so the probe holds its band on it.
 */
const CAPPED = {
  level: 50,
  knightRarity: 'legendary',
  others: { rarity: 'epic', level: 45 },
} as const satisfies Partial<ReferenceRow>

export const REFERENCE_PARTY: readonly ReferenceRow[] = [
  { zone: 1, level: 4, knightRarity: 'common', gearTier: 1, gearRarity: 'common' },
  { zone: 2, level: 4, knightRarity: 'common', gearTier: 1, gearRarity: 'common' },
  { zone: 3, level: 6, knightRarity: 'common', gearTier: 1, gearRarity: 'rare' },
  { zone: 4, level: 6, knightRarity: 'common', gearTier: 1, gearRarity: 'rare' },
  { zone: 5, level: 8, knightRarity: 'common', gearTier: 2, gearRarity: 'rare' },
  { zone: 6, level: 11, knightRarity: 'common', gearTier: 2, gearRarity: 'rare' },
  { zone: 7, level: 14, knightRarity: 'common', gearTier: 2, gearRarity: 'rare' },
  { zone: 8, level: 17, knightRarity: 'common', gearTier: 3, gearRarity: 'rare' },
  { zone: 9, level: 23, knightRarity: 'legendary', gearTier: 3, gearRarity: 'rare' },
  { zone: 10, level: 27, knightRarity: 'legendary', gearTier: 3, gearRarity: 'uncommon' },
  { zone: 11, level: 32, knightRarity: 'legendary', gearTier: 3, gearRarity: 'uncommon' },
  { zone: 12, level: 37, knightRarity: 'legendary', gearTier: 3, gearRarity: 'uncommon' },
  // Tier 2 ramps from zone 12 (#152), so its first zone takes the party that clears zone 12.
  { zone: 13, level: 37, knightRarity: 'legendary', gearTier: 3, gearRarity: 'uncommon' },
  // The rest of the later tiers (#143): a capped party, the Knight Legendary at 50 and Epics at 45,
  // in the tier's item tier, from Epic at low rolls to Legendary at high on a tier's last zone.
  { zone: 24, ...CAPPED, gearTier: 5, gearRarity: 'legendary', rollBp: 10000 },
  // Tier 3 opens in tier 2's last gear: no tier-6 Epic at low rolls beats a tier-5 Legendary at high.
  { zone: 25, ...CAPPED, gearTier: 5, gearRarity: 'legendary', rollBp: 10000 },
  { zone: 30, ...CAPPED, gearTier: 6, gearRarity: 'epic', rollBp: 10000 },
  { zone: 36, ...CAPPED, gearTier: 6, gearRarity: 'legendary', rollBp: 10000 },
]

/** The live hour a player plausibly holds a Legendary Knight: when the harness grants one. */
export const LEGENDARY_AT_HOUR = 9

/** The reference row of a running zone: its own, or the last row below it; zone 1's below zone 1. */
export function referenceRow(zone: number): ReferenceRow {
  let row = REFERENCE_PARTY[0]
  for (const r of REFERENCE_PARTY) if (r.zone <= zone) row = r
  if (!row) throw new Error('the reference party table is empty')
  return row
}
