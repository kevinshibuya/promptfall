import type { Rarity } from '../types'

/**
 * The reference party at one base zone: "a party at its tier's level in its tier's gear", as one
 * definition. The Knight is the hero the feel probe measures; the others stay Common.
 */
export type ReferenceRow = {
  zone: number
  /** The level the party holds while it fights the zone at the reference cadence. */
  level: number
  knightRarity: Rarity
  /** The item tier worn: tier t is the bases whose minimum zone is 3t-2 to 3t. */
  gearTier: number
  gearRarity: Rarity
}

/**
 * Tuned by the harness for sim version 6 (ticket #138): each row is where the arc runs of
 * `arc.test.ts` put the party, and the zone's enemy atk is set so the probe holds its band on it.
 */
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
]

/** The live hour a player plausibly holds a Legendary Knight: when the harness grants one. */
export const LEGENDARY_AT_HOUR = 17

/** The reference row of a base zone, 1 to 12. */
export function referenceRow(base: number): ReferenceRow {
  const row = REFERENCE_PARTY[Math.min(Math.max(base, 1), REFERENCE_PARTY.length) - 1]
  if (!row) throw new Error('the reference party table is empty')
  return row
}
