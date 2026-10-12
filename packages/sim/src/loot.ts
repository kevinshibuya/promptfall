import { content, ZONES_PER_ITEM_TIER, zoneAt } from './content'
import type { EnemyDef } from './content/types'
import { pushLog, rollContract } from './heroes'
import { draw, drawBp, drawWeighted, newId, partyHeroes } from './progression'
import { compareCodeUnits } from './rng'
import { createInitialState } from './state'
import type { Affix, Effect, GameState, HeroClass, Item, Rarity, StepResult } from './types'

export function vendorValue(item: Item): number {
  const minZone = content.itemBases[item.base]?.minZone ?? 1
  return content.rarity[item.rarity].vendorGoldPerZone * minZone
}

/** The item tier of a base's drops: its minimum zone 1 to 3 is tier 1, 10 to 12 tier 4. */
export function baseTier(baseId: string): number {
  const minZone = content.itemBases[baseId]?.minZone ?? 1
  return Math.max(1, Math.ceil(minZone / ZONES_PER_ITEM_TIER))
}

/** An item tier's multiplier in basis points; a tier off the table counts as tier 1. */
function tierMultBp(tier: number): number {
  return content.itemTierMultBp[tier - 1] ?? 10000
}

/**
 * What an affix counts for on its item, in stats and wherever it is shown: the stored flat roll
 * scaled by the item's tier, floored. The sim and the plugin read it here and nowhere else.
 */
export function affixValue(item: Item, affix: Affix): number {
  return Math.floor((affix.value * tierMultBp(item.tier)) / 10000)
}

/** The gold a reforge costs: the rarity's price scaled by the item's tier, floored. */
export function reforgeCost(item: Item): number {
  return Math.floor((content.rarity[item.rarity].reforgeCost * tierMultBp(item.tier)) / 10000)
}

function rollItem(s: GameState, boss: boolean): Item | null {
  return rollItemFor(
    s,
    boss,
    partyHeroes(s).map((h) => h.cls),
  )
}

/** The draw order of ordinary drops: rarity, then base, then affixes. */
function rollItemFor(s: GameState, boss: boolean, classes: readonly HeroClass[]): Item | null {
  const zone = zoneAt(s.zone)?.def
  if (!zone) return null
  const rarity = drawWeighted(s, boss ? zone.bossRarityWeights : zone.rarityWeights)
  const bases = Object.keys(content.itemBases)
    .sort(compareCodeUnits)
    .filter((id) => {
      const b = content.itemBases[id]
      return b !== undefined && b.minZone <= s.zone && b.classes.some((c) => classes.includes(c))
    })
  if (bases.length === 0) return null
  const baseId = bases[draw(s, bases.length)] ?? ''
  return rollItemOf(s, baseId, rarity)
}

/** An item of this base and rarity, in its base's tier: its affixes, then its id. */
export function rollItemOf(s: GameState, baseId: string, rarity: Rarity): Item {
  const affixes = rollAffixes(s, baseId, rarity)
  return {
    id: newId(s, 'i'),
    base: baseId,
    rarity,
    tier: baseTier(baseId),
    affixes,
    equippedBy: null,
    tradeableAt: null,
  }
}

/** The affixes of an item of this base and rarity: each one's id, then its flat roll. */
function rollAffixes(s: GameState, baseId: string, rarity: Rarity): Affix[] {
  const slot = content.itemBases[baseId]?.slot
  const pool = Object.keys(content.affixes)
    .sort(compareCodeUnits)
    .filter((id) => slot !== undefined && content.affixes[id]?.slots.includes(slot))
  const affixes: Affix[] = []
  for (let i = 0; i < content.rarity[rarity].affixCount && pool.length > 0; i++) {
    const [id] = pool.splice(draw(s, pool.length), 1)
    const def = id ? content.affixes[id] : undefined
    if (!def || !id) continue
    const [min, max] = def.range
    affixes.push({ id, value: min + draw(s, max - min + 1) })
  }
  return affixes
}

/** A boss-rarity item of the zone for a party of these classes, drawn from `seed` alone. `id` is '' for the caller to replace. */
export function rollRewardItem(
  seed: number,
  zone: number,
  classes: readonly HeroClass[],
): Item | null {
  const scratch: GameState = { ...createInitialState(seed), zone }
  const item = rollItemFor(scratch, true, classes)
  return item ? { ...item, id: '' } : null
}

/** Takes a dropped item in on a draft: into the inventory, or vendored when it is full. */
export function takeDrop(s: GameState, item: Item, effects: Effect[]): void {
  const gold = s.inventory.length < s.inventoryCap ? null : vendorValue(item)
  if (gold === null) {
    s.inventory.push(item)
    effects.push({ k: 'drop', item })
  } else {
    s.gold += gold
    effects.push({ k: 'drop_vendored', item, gold })
  }
  pushLog(s, {
    k: 'item',
    itemId: item.id,
    base: item.base,
    rarity: item.rarity,
    vendoredFor: gold,
  })
}

/**
 * Rolls the drops of a killed enemy. Works on a draft: the state passed in is
 * mutated and returned, so callers inside a step keep their references.
 */
export function rollDrops(state: GameState, def: EnemyDef): StepResult {
  const s = state
  const effects: Effect[] = []
  const boss = def.kind !== 'wave'
  if (drawBp(s) < def.dropBp) {
    const item = rollItem(s, boss)
    if (item) takeDrop(s, item, effects)
  }
  if (boss && def.contractBp > 0 && drawBp(s) < def.contractBp) rollContract(s, effects)
  return { state: s, effects }
}

export function rerollAffix(s: GameState, item: Item, index: number): void {
  const affix = item.affixes[index]
  const def = affix ? content.affixes[affix.id] : undefined
  if (!affix || !def) return
  const [min, max] = def.range
  affix.value = min + draw(s, max - min + 1)
}
