import { content } from './content'
import type { EnemyDef } from './content/types'
import { pushLog, rollContract } from './heroes'
import { draw, drawBp, drawWeighted, newId, partyHeroes } from './progression'
import { compareCodeUnits } from './rng'
import type { Affix, Effect, GameState, Item, StepResult } from './types'

export function vendorValue(item: Item): number {
  const minZone = content.itemBases[item.base]?.minZone ?? 1
  return content.rarity[item.rarity].vendorGoldPerZone * minZone
}

function rollItem(s: GameState, boss: boolean): Item | null {
  const zone = content.zones[s.zone - 1]
  if (!zone) return null
  const rarity = drawWeighted(s, boss ? zone.bossRarityWeights : zone.rarityWeights)
  const classes = partyHeroes(s).map((h) => h.cls)
  const bases = Object.keys(content.itemBases)
    .sort(compareCodeUnits)
    .filter((id) => {
      const b = content.itemBases[id]
      return b !== undefined && b.minZone <= s.zone && b.classes.some((c) => classes.includes(c))
    })
  if (bases.length === 0) return null
  const baseId = bases[draw(s, bases.length)] ?? ''
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
  return { id: newId(s, 'i'), base: baseId, rarity, affixes, equippedBy: null, tradeableAt: null }
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
    if (item) {
      if (s.inventory.length < s.inventoryCap) {
        s.inventory.push(item)
        effects.push({ k: 'drop', item })
        pushLog(s, {
          k: 'item',
          itemId: item.id,
          base: item.base,
          rarity: item.rarity,
          vendoredFor: null,
        })
      } else {
        const gold = vendorValue(item)
        s.gold += gold
        effects.push({ k: 'drop_vendored', item, gold })
        pushLog(s, {
          k: 'item',
          itemId: item.id,
          base: item.base,
          rarity: item.rarity,
          vendoredFor: gold,
        })
      }
    }
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
