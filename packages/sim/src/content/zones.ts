import type { Rarity } from '../types'
import { zoneRosters } from './enemies'
import type { ZoneDef } from './types'

const NAMES = [
  'Greenmeadow Road',
  'Whisperwood',
  'Marsh of Sighs',
  'Old Barrow Hills',
  'Saltglass Coast',
  'Emberfall Caves',
  'Frostvein Pass',
  'Sunken Abbey',
  'Ashen Waste',
  'Starfall Spire',
  "Hollow King's Court",
  'The Unwritten Reach',
]

// Rarity weights shift one notch toward the rare end every zone.
function weights(zone: number, boss: boolean): Record<Rarity, number> {
  const z = zone - 1
  if (boss) {
    return {
      common: Math.max(1000, 4000 - z * 250),
      uncommon: 3500,
      rare: 1800 + z * 120,
      epic: 550 + z * 90,
      legendary: 150 + z * 40,
    }
  }
  return {
    common: Math.max(2000, 7000 - z * 400),
    uncommon: 2200 + z * 150,
    rare: 650 + z * 150,
    epic: 130 + z * 70,
    legendary: 20 + z * 15,
  }
}

export const zones: ZoneDef[] = NAMES.map((name, i) => {
  const roster = zoneRosters[i] ?? []
  return {
    index: i + 1,
    name,
    enemies: roster.slice(0, 4),
    boss: roster[4] ?? '',
    turnBoss: roster[5] ?? '',
    rarityWeights: weights(i + 1, false),
    bossRarityWeights: weights(i + 1, true),
  }
})
