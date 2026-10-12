import type { Rarity } from '../types'

/**
 * The reference party at one base zone: "a party at its tier's level in its tier's gear", as one
 * definition. The Knight is the hero the feel probe measures; the others stay Common.
 */
export type ReferenceRow = {
  zone: number
  /** The level the party is expected to hold on arriving at the zone. */
  level: number
  knightRarity: Rarity
  /** The item tier worn: tier t is the bases whose minimum zone is 3t-2 to 3t. */
  gearTier: number
  gearRarity: Rarity
}

/** Starting values; the tuning ticket of spec #130 sets them by the harness. */
export const REFERENCE_PARTY: readonly ReferenceRow[] = [
  { zone: 1, level: 3, knightRarity: 'common', gearTier: 1, gearRarity: 'common' },
  { zone: 2, level: 6, knightRarity: 'common', gearTier: 1, gearRarity: 'common' },
  { zone: 3, level: 9, knightRarity: 'common', gearTier: 1, gearRarity: 'uncommon' },
  { zone: 4, level: 12, knightRarity: 'common', gearTier: 2, gearRarity: 'uncommon' },
  { zone: 5, level: 16, knightRarity: 'rare', gearTier: 2, gearRarity: 'rare' },
  { zone: 6, level: 20, knightRarity: 'rare', gearTier: 2, gearRarity: 'rare' },
  { zone: 7, level: 24, knightRarity: 'rare', gearTier: 3, gearRarity: 'rare' },
  { zone: 8, level: 28, knightRarity: 'rare', gearTier: 3, gearRarity: 'rare' },
  { zone: 9, level: 32, knightRarity: 'epic', gearTier: 3, gearRarity: 'epic' },
  { zone: 10, level: 36, knightRarity: 'epic', gearTier: 4, gearRarity: 'epic' },
  { zone: 11, level: 40, knightRarity: 'epic', gearTier: 4, gearRarity: 'epic' },
  { zone: 12, level: 45, knightRarity: 'epic', gearTier: 4, gearRarity: 'epic' },
]

/** The live hour a player plausibly holds a Legendary Knight: when the harness grants one. */
export const LEGENDARY_AT_HOUR = 60

/** The reference row of a base zone, 1 to 12. */
export function referenceRow(base: number): ReferenceRow {
  const row = REFERENCE_PARTY[Math.min(Math.max(base, 1), REFERENCE_PARTY.length) - 1]
  if (!row) throw new Error('the reference party table is empty')
  return row
}
