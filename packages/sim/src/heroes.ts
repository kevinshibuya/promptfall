import { content } from './content'
import { draw, drawWeighted, heroStats, newId } from './progression'
import { compareCodeUnits } from './rng'
import type { Effect, GameState, Hero, Rarity, Trait } from './types'

/** Rolls a hero on a draft state. Draw order: template, traits, epithet; then the id. */
export function generateHero(s: GameState, rarity: Rarity, templateId?: string): Hero {
  let template = templateId ? content.heroTemplates[templateId] : undefined
  if (!template) {
    const ids = Object.keys(content.heroTemplates).sort(compareCodeUnits)
    template = content.heroTemplates[ids[draw(s, ids.length)] ?? '']
  }
  if (!template) throw new Error('no hero templates')
  const pool = Object.keys(content.traits).sort(compareCodeUnits)
  const traits: Trait[] = []
  for (let i = 0; i < content.rarity[rarity].traitCount && pool.length > 0; i++) {
    const [id] = pool.splice(draw(s, pool.length), 1)
    const def = id ? content.traits[id] : undefined
    if (!def || !id) continue
    const [min, max] = def.rangeBp
    traits.push({ id, valueBp: min + draw(s, max - min + 1) })
  }
  const epithet = content.epithets[draw(s, content.epithets.length)] ?? ''
  const hero: Hero = {
    id: newId(s, 'h'),
    template: template.id,
    cls: template.cls,
    epithet,
    rarity,
    traits,
    level: 1,
    xp: 0,
    hp: 1,
    equipment: { weapon: null, armour: null, accessory: null },
  }
  hero.hp = heroStats(s, hero).hp
  return hero
}

/** Adds a rolled hero to the roster on a draft state. */
export function recruitHero(
  s: GameState,
  hero: Hero,
  via: 'contract' | 'tavern',
  effects: Effect[],
): void {
  s.roster.push(hero)
  effects.push({ k: 'hero_recruited', hero, via })
  pushLog(s, { k: 'hero', heroId: hero.id, template: hero.template, rarity: hero.rarity, via })
}

export function pushLog(s: GameState, entry: GameState['lootLog'][number]): void {
  s.lootLog.push(entry)
  if (s.lootLog.length > 50) s.lootLog.splice(0, s.lootLog.length - 50)
}

/** A boss contract: recruit, or vendor it when the roster is full. */
export function rollContract(s: GameState, effects: Effect[]): void {
  const zone = content.zones[s.zone - 1]
  if (!zone) return
  const rarity = drawWeighted(s, zone.bossRarityWeights)
  const hero = generateHero(s, rarity)
  if (s.roster.length < s.rosterCap) {
    recruitHero(s, hero, 'contract', effects)
    return
  }
  const gold = 3 * content.rarity[rarity].vendorGoldPerZone * s.zone
  s.gold += gold
  effects.push({ k: 'gold', amount: gold })
  pushLog(s, { k: 'item', itemId: hero.id, base: 'contract', rarity, vendoredFor: gold })
}
