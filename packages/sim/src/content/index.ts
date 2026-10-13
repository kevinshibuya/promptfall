import { achievements } from './achievements'
import { affixes } from './affixes'
import { enemies } from './enemies'
import { epithets } from './epithets'
import { expansions } from './expansions'
import { goals } from './goals'
import { heroTemplates } from './heroes'
import { hunts } from './hunts'
import { itemBases } from './items'
import { rarity } from './rarity'
import { tactics } from './tactics'
import { tavern } from './tavern'
import { itemTierMultBp } from './tiers'
import { traits } from './traits'
import type { Content } from './types'
import { xpToNext } from './xp'
import { zones } from './zones'

export {
  achievementCount,
  type JournalCounts,
  LADDER_GOLD,
  ONE_OFF_GOLD,
} from './achievements'
export { TIER_GROWTH_BP } from './enemies'
export { huntAt, huntCount } from './hunts'
export { ZONES_PER_ITEM_TIER } from './tiers'
export type {
  AchievementMetric,
  AchievementRow,
  AchievementStep,
  AffixDef,
  Archetype,
  Content,
  EnemyDef,
  GoalKind,
  GoalRow,
  HeroTemplate,
  HuntKind,
  HuntRow,
  ItemBase,
  RarityRule,
  Tactic,
  Tactics,
  TargetRule,
  TraitDef,
  WeightRule,
  ZoneDef,
} from './types'
export type { ZoneAt } from './zone'
export { enemyAt, LADDER_END, oddsAt, zoneAt } from './zone'

export const content: Content = {
  zones,
  enemies,
  itemBases,
  affixes,
  heroTemplates,
  traits,
  epithets,
  rarity,
  tavern,
  expansions,
  tactics,
  xpToNext,
  itemTierMultBp,
  achievements,
  goals,
  hunts,
}
