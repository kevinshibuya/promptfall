import { content, type Effect } from './vendor/sim.js'
import { heroName, tradeName } from './view'

const TOAST_RARITIES = new Set(['rare', 'epic', 'legendary'])

/** The toast an effect earns on the primary, or null. */
export function effectToast(effect: Effect): string | null {
  switch (effect.k) {
    case 'drop': {
      if (!TOAST_RARITIES.has(effect.item.rarity)) return null
      const base = content.itemBases[effect.item.base]
      return `${base?.glyph ?? '?'} ${base?.name ?? effect.item.base} (${effect.item.rarity})`
    }
    case 'level_up':
      return `Level ${effect.level}`
    case 'zone_cleared':
      return effect.advancedTo > effect.zone
        ? `Zone ${effect.zone} cleared, on to ${content.zones[effect.advancedTo - 1]?.name ?? effect.advancedTo}`
        : `Zone ${effect.zone} cleared`
    case 'wipe':
      return `Party wiped, retreating to zone ${effect.retreatedTo}`
    case 'hero_recruited':
      return `${heroName(effect.hero.template, effect.hero.epithet)} joined (${effect.hero.rarity})`
    case 'rewarded': {
      if (!effect.goods) return `Boss reward: ${effect.gold} gold`
      const goods = effect.goods
      if (goods.kind === 'hero') {
        return `Boss reward: ${heroName(goods.hero.template, goods.hero.epithet)} (${goods.hero.rarity})`
      }
      const name = content.itemBases[goods.item.base]?.name ?? goods.item.base
      return `Boss reward: ${name} (${goods.item.rarity})`
    }
    case 'traded': {
      const name = tradeName(effect.entry.kind, effect.entry.base)
      if (effect.entry.what === 'sold') return `Sold ${name} for ${effect.entry.gold}g`
      if (effect.entry.what === 'bought') return `Bought ${name} for ${effect.entry.gold}g`
      return `${name} returned to you`
    }
    default:
      return null
  }
}
