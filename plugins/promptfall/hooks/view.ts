import type { EnemyView, GameView, HeroView, ItemView, LootView, RosterHeroView } from '../types'
import { content, type GameState, heroStats, type Item, type LootEntry } from './vendor/sim.js'

const LOOT_LINES = 12

export function heroName(template: string, epithet: string): string {
  const name = content.heroTemplates[template]?.name ?? template
  return epithet ? `${name} ${epithet}` : name
}

export function vendorValue(item: Item): number {
  const minZone = content.itemBases[item.base]?.minZone ?? 1
  return content.rarity[item.rarity].vendorGoldPerZone * minZone
}

export function tavernPrice(state: GameState): number {
  const { baseCost, costGrowthBp } = content.tavern
  return Math.floor((baseCost * (10000 + costGrowthBp * state.recruits)) / 10000)
}

function expansionCost(
  cap: number,
  start: number,
  rule: { step: number; max: number; costs: number[] },
): number | null {
  if (cap >= rule.max) return null
  return rule.costs[Math.floor((cap - start) / rule.step)] ?? null
}

function lootLine(entry: LootEntry): LootView {
  if (entry.k === 'hero') {
    const glyph = content.heroTemplates[entry.template]?.glyph ?? '@'
    const name = content.heroTemplates[entry.template]?.name ?? entry.template
    return { text: `${glyph} ${name} joined (${entry.rarity})`, rarity: entry.rarity }
  }
  if (entry.k === 'trade') {
    const name =
      entry.kind === 'hero'
        ? (content.heroTemplates[entry.base]?.name ?? entry.base)
        : (content.itemBases[entry.base]?.name ?? entry.base)
    return { text: `${entry.what} ${name}`, rarity: entry.rarity }
  }
  const base = content.itemBases[entry.base]
  const name = entry.base === 'contract' ? 'Hero contract' : (base?.name ?? entry.base)
  if (entry.vendoredFor !== null) {
    return { text: `${name} sold for ${entry.vendoredFor}g`, rarity: entry.rarity }
  }
  return { text: `${base?.glyph ?? '?'} ${name} (${entry.rarity})`, rarity: entry.rarity }
}

function itemView(item: Item): ItemView {
  const base = content.itemBases[item.base]
  return {
    id: item.id,
    name: base?.name ?? item.base,
    glyph: base?.glyph ?? '?',
    slot: base?.slot ?? 'weapon',
    rarity: item.rarity,
    affixes: item.affixes.map((a) => {
      const def = content.affixes[a.id]
      return def ? `${def.name} +${a.value} ${def.stat}` : a.id
    }),
    equippedBy: item.equippedBy,
    classes: base?.classes ?? [],
    vendorValue: vendorValue(item),
    reforgeCost: content.rarity[item.rarity].reforgeCost,
  }
}

/** Everything the band and the dialog draw, derived from the state alone. */
export function toGameView(state: GameState, accountId: string, firstRun: boolean): GameView {
  const heroes: HeroView[] = []
  for (const id of state.party) {
    const hero = state.roster.find((h) => h.id === id)
    if (!hero) continue
    heroes.push({
      id: hero.id,
      name: heroName(hero.template, hero.epithet),
      cls: hero.cls,
      glyph: content.heroTemplates[hero.template]?.glyph ?? '@',
      level: hero.level,
      hp: hero.hp,
      maxHp: heroStats(state, hero).hp,
      alive: hero.hp > 0,
    })
  }
  const enemies: EnemyView[] = (state.encounter?.enemies ?? []).map((e) => {
    const def = content.enemies[e.def]
    return {
      name: def?.name ?? e.def,
      glyph: def?.glyph ?? '?',
      hp: e.hp,
      maxHp: e.maxHp,
      kind: e.kind,
    }
  })
  const loot = state.lootLog.slice(-LOOT_LINES).map(lootLine)
  const roster: RosterHeroView[] = state.roster.map((hero) => ({
    id: hero.id,
    name: heroName(hero.template, hero.epithet),
    cls: hero.cls,
    glyph: content.heroTemplates[hero.template]?.glyph ?? '@',
    rarity: hero.rarity,
    level: hero.level,
    traits: hero.traits.map((t) => {
      const def = content.traits[t.id]
      return def ? `${def.name} +${Math.floor(t.valueBp / 100)}% ${def.stat}` : t.id
    }),
    inParty: state.party.includes(hero.id),
    inPendingParty: state.pendingParty?.includes(hero.id) ?? false,
  }))
  return {
    heroes,
    enemies,
    zone: state.zone,
    zoneName: content.zones[state.zone - 1]?.name ?? `Zone ${state.zone}`,
    wave: state.wave,
    gold: state.gold,
    farm: state.farm,
    lastDrop: loot[loot.length - 1] ?? null,
    loot,
    highestZone: state.highestZone,
    kills: state.stats.kills,
    wipes: state.stats.wipes,
    inventory: state.inventory.map(itemView),
    inventoryCap: state.inventoryCap,
    roster,
    rosterCap: state.rosterCap,
    tavernPrice: tavernPrice(state),
    nextInventoryCost: expansionCost(state.inventoryCap, 30, content.expansions.inventory),
    nextRosterCost: expansionCost(state.rosterCap, 24, content.expansions.roster),
    accountId,
    firstRun,
  }
}
