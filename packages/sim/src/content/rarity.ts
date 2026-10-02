import type { Rarity } from '../types'
import type { RarityRule } from './types'

export const rarity: Record<Rarity, RarityRule> = {
  common: {
    affixCount: 0,
    traitCount: 0,
    levelCap: 20,
    statMultBp: 10000,
    vendorGoldPerZone: 2,
    reforgeCost: 10,
  },
  uncommon: {
    affixCount: 1,
    traitCount: 1,
    levelCap: 30,
    statMultBp: 11000,
    vendorGoldPerZone: 5,
    reforgeCost: 25,
  },
  rare: {
    affixCount: 2,
    traitCount: 2,
    levelCap: 40,
    statMultBp: 12000,
    vendorGoldPerZone: 15,
    reforgeCost: 60,
  },
  epic: {
    affixCount: 3,
    traitCount: 3,
    levelCap: 45,
    statMultBp: 13500,
    vendorGoldPerZone: 40,
    reforgeCost: 150,
  },
  legendary: {
    affixCount: 4,
    traitCount: 4,
    levelCap: 50,
    statMultBp: 15000,
    vendorGoldPerZone: 100,
    reforgeCost: 400,
  },
}
