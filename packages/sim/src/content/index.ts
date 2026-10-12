import { affixes } from './affixes'
import { enemies } from './enemies'
import { epithets } from './epithets'
import { expansions } from './expansions'
import { heroTemplates } from './heroes'
import { itemBases } from './items'
import { rarity } from './rarity'
import { tactics } from './tactics'
import { tavern } from './tavern'
import { traits } from './traits'
import type { Content } from './types'
import { zones } from './zones'

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
export { LADDER_END, zoneAt } from './zone'

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
  xpToNext: (level: number) => 110 * level * level,
}
