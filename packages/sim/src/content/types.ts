import type { EnemyKind, HeroClass, Rarity, Slot, Stat, Stats } from '../types'

export type EnemyDef = {
  id: string
  name: string
  glyph: string
  zone: number
  kind: EnemyKind
  stats: Stats
  xp: number
  gold: [number, number]
  dropBp: number
  contractBp: number
}
export type ZoneDef = {
  index: number
  name: string
  enemies: string[]
  boss: string
  turnBoss: string
  rarityWeights: Record<Rarity, number>
  bossRarityWeights: Record<Rarity, number>
}
export type ItemBase = {
  id: string
  name: string
  glyph: string
  slot: Slot
  classes: HeroClass[]
  stats: Partial<Stats>
  minZone: number
}
export type AffixDef = {
  id: string
  name: string
  slots: Slot[]
  stat: Stat
  range: [number, number]
}
export type HeroTemplate = {
  id: string
  name: string
  cls: HeroClass
  glyph: string
  base: Stats
  growth: Stats
}
export type TraitDef = { id: string; name: string; stat: Stat; rangeBp: [number, number] }
export type RarityRule = {
  affixCount: number
  traitCount: number
  levelCap: number
  statMultBp: number
  vendorGoldPerZone: number
  reforgeCost: number
}
export type Content = {
  zones: ZoneDef[]
  enemies: Record<string, EnemyDef>
  itemBases: Record<string, ItemBase>
  affixes: Record<string, AffixDef>
  heroTemplates: Record<string, HeroTemplate>
  traits: Record<string, TraitDef>
  epithets: string[]
  rarity: Record<Rarity, RarityRule>
  tavern: { baseCost: number; costGrowthBp: number; odds: Record<Rarity, number> }
  expansions: {
    inventory: { step: number; max: number; costs: number[] }
    roster: { step: number; max: number; costs: number[] }
  }
  xpToNext: (level: number) => number
}
