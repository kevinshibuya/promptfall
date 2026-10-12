import { affixes } from './affixes'
import { enemies } from './enemies'
import { epithets } from './epithets'
import { expansions } from './expansions'
import { heroTemplates } from './heroes'
import { itemBases } from './items'
import { rarity } from './rarity'
import { tactics } from './tactics'
import { tavern } from './tavern'
import { itemTierMultBp } from './tiers'
import { traits } from './traits'
import type { Content } from './types'
import { xpToNext } from './xp'
import { zones } from './zones'

export { TIER_ENTRY_BP, TIER_GROWTH_BP } from './enemies'
export { ZONES_PER_ITEM_TIER } from './tiers'
export type {
  AffixDef,
  Archetype,
  Content,
  EnemyDef,
  HeroTemplate,
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
}
