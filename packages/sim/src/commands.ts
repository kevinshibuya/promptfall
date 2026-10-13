import { content, LADDER_END } from './content'
import { draft, reject } from './draft'
import { generateHero, recruitHero } from './heroes'
import { reforgeCost, rerollAffix, vendorValue } from './loot'
import {
  applyPendingParty,
  changeZone,
  clampHp,
  drawWeighted,
  endEncounter,
  findHero,
} from './progression'
import { earn } from './tallies'
import type { Event, GameState, GuaranteeRarity, Rarity, StepResult } from './types'
import { GUARANTEE_RARITIES, RARITIES } from './types'

type Of<K extends Event['t']> = Extract<Event, { t: K }>

export function tavernPrice(state: GameState): number {
  const { baseCost, costGrowthBp } = content.tavern
  return Math.floor((baseCost * (10000 + costGrowthBp * state.recruits)) / 10000)
}

/** Per guarantee, the recruits until one of its rarity or better is certain: 1 means the next. */
export function tavernGuarantees(state: GameState): Record<GuaranteeRarity, number> {
  const out = { rare: 0, epic: 0, legendary: 0 }
  for (const r of GUARANTEE_RARITIES) {
    out[r] = Math.max(1, content.tavern.guarantees[r] - (state.guarantee?.[r] ?? 0))
  }
  return out
}

const rank = (r: Rarity) => RARITIES.indexOf(r)

/**
 * A tavern recruit's rarity on a draft: every count rises, the odds roll, the floor is the highest
 * rarity whose count reached its threshold, and the result resets every count at or below it.
 */
function tavernRarity(s: GameState): Rarity {
  let floor: Rarity = 'common'
  for (const r of GUARANTEE_RARITIES) {
    s.guarantee[r] += 1
    if (s.guarantee[r] >= content.tavern.guarantees[r]) floor = r
  }
  const roll = drawWeighted(s, content.tavern.odds)
  const rarity = rank(roll) >= rank(floor) ? roll : floor
  for (const r of GUARANTEE_RARITIES) if (rank(r) <= rank(rarity)) s.guarantee[r] = 0
  return rarity
}

export function nextExpansionCost(state: GameState, which: 'inventory' | 'roster'): number | null {
  const rule = content.expansions[which]
  const start = which === 'inventory' ? 30 : 24
  const cap = which === 'inventory' ? state.inventoryCap : state.rosterCap
  if (cap >= rule.max) return null
  return rule.costs[Math.floor((cap - start) / rule.step)] ?? null
}

export function equip(state: GameState, event: Of<'equip'>): StepResult {
  const hero = findHero(state, event.heroId)
  if (!hero) return reject(state, event, 'unknown_hero')
  const item = state.inventory.find((i) => i.id === event.itemId)
  if (!item) return reject(state, event, 'unknown_item')
  const base = content.itemBases[item.base]
  if (!base?.classes.includes(hero.cls)) return reject(state, event, 'class_mismatch')
  if (item.equippedBy !== null && item.equippedBy !== hero.id) {
    return reject(state, event, 'already_equipped')
  }
  return draft(state, (s) => {
    const h = findHero(s, event.heroId)
    const it = s.inventory.find((i) => i.id === event.itemId)
    if (!h || !it) return
    // An item worn in another slot of the same hero cannot happen: slots are per base.
    const oldId = h.equipment[base.slot]
    if (oldId && oldId !== it.id) {
      const old = s.inventory.find((i) => i.id === oldId)
      if (old) old.equippedBy = null
    }
    h.equipment[base.slot] = it.id
    it.equippedBy = h.id
    clampHp(s, h)
  })
}

export function unequip(state: GameState, event: Of<'unequip'>): StepResult {
  const hero = findHero(state, event.heroId)
  if (!hero) return reject(state, event, 'unknown_hero')
  if (!hero.equipment[event.slot]) return reject(state, event, 'slot_empty')
  return draft(state, (s) => {
    const h = findHero(s, event.heroId)
    if (!h) return
    const it = s.inventory.find((i) => i.id === h.equipment[event.slot])
    if (it) it.equippedBy = null
    h.equipment[event.slot] = null
    clampHp(s, h)
  })
}

export function vendor(state: GameState, event: Of<'vendor'>): StepResult {
  const item = state.inventory.find((i) => i.id === event.itemId)
  if (!item) return reject(state, event, 'unknown_item')
  if (item.equippedBy !== null) return reject(state, event, 'item_equipped')
  return draft(state, (s) => {
    s.inventory = s.inventory.filter((i) => i.id !== event.itemId)
    earn(s, vendorValue(item))
  })
}

export function reforge(state: GameState, event: Of<'reforge'>): StepResult {
  const item = state.inventory.find((i) => i.id === event.itemId)
  if (!item) return reject(state, event, 'unknown_item')
  const index = event.affixIndex
  if (!Number.isInteger(index) || index < 0 || index >= item.affixes.length) {
    return reject(state, event, 'bad_affix_index')
  }
  const cost = reforgeCost(item)
  if (state.gold < cost) return reject(state, event, 'not_enough_gold')
  return draft(state, (s) => {
    const it = s.inventory.find((i) => i.id === event.itemId)
    if (!it) return
    s.gold -= cost
    s.tallies.reforges += 1
    rerollAffix(s, it, index)
    const wearer = it.equippedBy ? findHero(s, it.equippedBy) : undefined
    if (wearer) clampHp(s, wearer)
  })
}

export function setParty(state: GameState, event: Of<'set_party'>): StepResult {
  const ids = event.heroIds
  for (const id of ids) if (!findHero(state, id)) return reject(state, event, 'unknown_hero')
  if (new Set(ids).size !== ids.length) return reject(state, event, 'duplicate_hero')
  return draft(state, (s, effects) => {
    const party: [string, string, string] = [ids[0], ids[1], ids[2]]
    if (s.encounter === null && s.wave === 1 && s.stats.kills === 0) {
      s.party = party
      s.pendingParty = null
      effects.push({ k: 'party_applied', heroIds: [...party] })
    } else {
      s.pendingParty = party
    }
  })
}

export function recruit(state: GameState, event: Of<'recruit'>): StepResult {
  const price = tavernPrice(state)
  if (state.gold < price) return reject(state, event, 'not_enough_gold')
  if (state.roster.length >= state.rosterCap) return reject(state, event, 'roster_full')
  return draft(state, (s, effects) => {
    s.gold -= price
    s.recruits += 1
    recruitHero(s, generateHero(s, tavernRarity(s)), 'tavern', effects)
  })
}

export function travel(state: GameState, event: Of<'travel'>): StepResult {
  const { zone } = event
  if (!Number.isInteger(zone)) return reject(state, event, 'bad_zone')
  if (zone < 1) return reject(state, event, 'zone_below_1')
  if (zone > Math.min(state.highestZone, LADDER_END))
    return reject(state, event, 'zone_not_reached')
  if (zone === state.zone) return reject(state, event, 'already_in_zone')
  if (state.boss) return reject(state, event, 'boss_mode')
  return draft(state, (s, effects) => {
    const from = s.zone
    endEncounter(s)
    changeZone(s, zone)
    effects.push({ k: 'traveled', from, to: zone })
    applyPendingParty(s, effects)
  })
}

export function dismiss(state: GameState, event: Of<'dismiss'>): StepResult {
  const hero = findHero(state, event.heroId)
  if (!hero) return reject(state, event, 'unknown_hero')
  if (state.party.includes(hero.id) || state.pendingParty?.includes(hero.id)) {
    return reject(state, event, 'in_party')
  }
  if (state.roster.filter((h) => h.cls === hero.cls).length <= 1) {
    return reject(state, event, 'last_of_class')
  }
  return draft(state, (s) => {
    for (const it of s.inventory) if (it.equippedBy === hero.id) it.equippedBy = null
    s.roster = s.roster.filter((h) => h.id !== hero.id)
    s.gold += content.rarity[hero.rarity].vendorGoldPerZone * 2
  })
}

export function setFarm(state: GameState, event: Of<'set_farm'>): StepResult {
  return draft(state, (s) => {
    s.farm = event.on === true
  })
}

export function setAutoVendor(state: GameState, event: Of<'set_auto_vendor'>): StepResult {
  return draft(state, (s) => {
    s.autoVendor = event.on === true
  })
}

function expand(
  state: GameState,
  event: Of<'expand_inventory'> | Of<'expand_roster'>,
  which: 'inventory' | 'roster',
): StepResult {
  const cost = nextExpansionCost(state, which)
  if (cost === null) return reject(state, event, 'at_max')
  if (state.gold < cost) return reject(state, event, 'not_enough_gold')
  const step = content.expansions[which].step
  return draft(state, (s) => {
    s.gold -= cost
    if (which === 'inventory') s.inventoryCap += step
    else s.rosterCap += step
  })
}

export function expandInventory(state: GameState, event: Of<'expand_inventory'>): StepResult {
  return expand(state, event, 'inventory')
}

export function expandRoster(state: GameState, event: Of<'expand_roster'>): StepResult {
  return expand(state, event, 'roster')
}
