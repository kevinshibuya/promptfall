/**
 * An item's tier multiplies its affixes' rolls at read and its reforge price, in basis points:
 * tier 1 first. A base's minimum zone puts its drops in tiers 1 to 4; tiers 5 and 6 are the
 * ladder's later tiers' drops.
 */
export const itemTierMultBp: readonly number[] = [10000, 20000, 35000, 60000, 100000, 160000]

/** The zones of a base's minimum zone in one item tier: 1 to 3 is tier 1, 10 to 12 tier 4. */
export const ZONES_PER_ITEM_TIER = 3
