import type {
  ActionId,
  EnemyKind,
  GuaranteeRarity,
  HeroClass,
  Rarity,
  Slot,
  Stat,
  Stats,
} from '../types'

export type Archetype = 'brute' | 'swift' | 'tank' | 'caster' | 'boss' | 'turn_boss'

export type EnemyDef = {
  id: string
  name: string
  glyph: string
  zone: number
  kind: EnemyKind
  archetype: Archetype
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
export type WeightRule =
  | { kind: 'fixed'; weight: number }
  /** 0 while the lowest ally is at or above belowBp of max HP; then scale × d² / (belowBp/2)², d = belowBp − lowestBp */
  | { kind: 'ally_need'; belowBp: number; scale: number }
export type TargetRule =
  /** No target to choose (attack_all). */
  | { kind: 'none' }
  /** The front foe (encounter.enemies[0]) weighs `front`, every other foe `other`. */
  | { kind: 'front'; front: number; other: number }
  /** The foe with the lowest current HP (first on a tie) weighs `weakest`, every other foe `other`. */
  | { kind: 'weakest'; weakest: number; other: number }
  /** A living foe of this class weighs `match`, every other living foe `other`. */
  | { kind: 'class'; cls: HeroClass; match: number; other: number }
  /** One candidate, weight 1: the living ally with the lowest HP %, first in order on a tie. */
  | { kind: 'ally_lowest' }
export type Tactic = {
  action: ActionId
  weight: WeightRule
  target: TargetRule
  /** Skipped while fewer allies than this live (the unit counts itself). */
  minAllies?: number
}
export type Tactics = {
  heroes: Record<HeroClass, Tactic[]>
  enemies: Record<Archetype | 'world_boss', Tactic[]>
}
/** What a daily goal counts: kills, zone bosses, Rare or better drops, or one turn boss. */
export type GoalKind = 'kills' | 'zone_bosses' | 'rare_drops' | 'turn_boss'
/** A goal row: its target is `base`, plus `step` for every `everyZones` zones past zone 1. */
export type GoalRow = { kind: GoalKind; base: number; step: number; everyZones: number }

/** What an achievement row reads, from the state or from the account's journal. */
export type AchievementMetric =
  | 'kills'
  | 'zone_bosses'
  | 'turn_bosses'
  | 'rare_drops'
  | 'legendary_drops'
  | 'recruits'
  | 'reforges'
  | 'gold_earned'
  | 'goals_met'
  | 'streak'
  | 'zones_complete'
  | 'bases_complete'
  | 'epic_held'
  | 'legendary_held'
  | 'highest_zone'
  | 'tier'
  | 'clean_zone_bosses'
  | 'classes_capped'
/** A step is crossed when its row's metric reaches `at`; it pays `gold`, and its toast says `words`. */
export type AchievementStep = { at: number; gold: number; words: string }
/** A ladder has two to four steps, a one-off one. Steps are numbered from 1. */
export type AchievementRow = {
  id: string
  name: string
  reads: AchievementMetric
  steps: AchievementStep[]
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
  tavern: {
    baseCost: number
    costGrowthBp: number
    odds: Record<Rarity, number>
    /** The tavern guarantee: a recruit of each rarity or better comes within this many recruits. */
    guarantees: Record<GuaranteeRarity, number>
  }
  expansions: {
    inventory: { step: number; max: number; costs: number[] }
    roster: { step: number; max: number; costs: number[] }
  }
  tactics: Tactics
  xpToNext: (level: number) => number
  /** An item tier's multiplier in basis points, tier 1 first. */
  itemTierMultBp: readonly number[]
  /** The ledger's achievement table: data no sim rule reads. */
  achievements: AchievementRow[]
  /** The daily goal's pool: data no sim rule reads. */
  goals: GoalRow[]
}
