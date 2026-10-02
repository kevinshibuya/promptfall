import { affixes } from './affixes'
import { enemies } from './enemies'
import { epithets } from './epithets'
import { expansions } from './expansions'
import { heroTemplates } from './heroes'
import { itemBases } from './items'
import { rarity } from './rarity'
import { tavern } from './tavern'
import { traits } from './traits'
import type { Content } from './types'
import { zones } from './zones'

export type {
  AffixDef,
  Content,
  EnemyDef,
  HeroTemplate,
  ItemBase,
  RarityRule,
  TraitDef,
  ZoneDef,
} from './types'

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
  xpToNext: (level: number) => 10 * level * level,
}
