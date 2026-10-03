import { clone, draft, reject } from './draft'
import { pushLog } from './heroes'
import { findHero } from './progression'
import type { Effect, Event, GameState, Goods, LootEntry, StepResult } from './types'

// Server events are authored by the ledger, which has already judged them.
// The handlers apply them as carried and only refuse what cannot be applied.

type Of<K extends Event['t']> = Extract<Event, { t: K }>
type TradeEntry = Extract<LootEntry, { k: 'trade' }>

function unapplicable(state: GameState, event: Event, detail: string): StepResult {
  return reject(state, event, `server_event_unapplicable:${detail}`)
}

/** The detail of the first cap the goods do not fit under, or null. */
function noRoom(state: GameState, goods: Goods): string | null {
  if (goods.kind === 'item') {
    return state.inventory.length < state.inventoryCap ? null : 'inventory_full'
  }
  return state.roster.length < state.rosterCap ? null : 'roster_full'
}

function insert(s: GameState, goods: Goods): void {
  if (goods.kind === 'item') s.inventory.push(clone(goods.item))
  else s.roster.push(clone(goods.hero))
}

function goodsEntry(goods: Goods, what: TradeEntry['what'], gold: number): TradeEntry {
  return goods.kind === 'item'
    ? { k: 'trade', what, kind: 'item', base: goods.item.base, rarity: goods.item.rarity, gold }
    : { k: 'trade', what, kind: 'hero', base: goods.hero.template, rarity: goods.hero.rarity, gold }
}

function logTrade(s: GameState, effects: Effect[], entry: TradeEntry): void {
  pushLog(s, entry)
  effects.push({ k: 'traded', entry: { ...entry } })
}

export function listed(state: GameState, event: Of<'listed'>): StepResult {
  if (event.kind === 'item') {
    const item = state.inventory.find((i) => i.id === event.id)
    if (!item) return unapplicable(state, event, 'unknown_item')
    if (item.equippedBy !== null) return unapplicable(state, event, 'equipped')
  } else {
    const hero = findHero(state, event.id)
    if (!hero) return unapplicable(state, event, 'unknown_hero')
    if (state.party.includes(hero.id) || state.pendingParty?.includes(hero.id)) {
      return unapplicable(state, event, 'in_party')
    }
    if (Object.values(hero.equipment).some((id) => id !== null)) {
      return unapplicable(state, event, 'equipped')
    }
  }
  if (state.gold < event.fee) return unapplicable(state, event, 'not_enough_gold')
  return draft(state, (s) => {
    if (event.kind === 'item') s.inventory = s.inventory.filter((i) => i.id !== event.id)
    else s.roster = s.roster.filter((h) => h.id !== event.id)
    s.gold -= event.fee
  })
}

export function returned(state: GameState, event: Of<'returned'>): StepResult {
  const full = noRoom(state, event.goods)
  if (full) return unapplicable(state, event, full)
  return draft(state, (s, effects) => {
    insert(s, event.goods)
    logTrade(s, effects, goodsEntry(event.goods, 'returned', 0))
  })
}

export function sold(state: GameState, event: Of<'sold'>): StepResult {
  return draft(state, (s, effects) => {
    s.gold += event.net
    const { kind, base, rarity, net } = event
    logTrade(s, effects, { k: 'trade', what: 'sold', kind, base, rarity, gold: net })
  })
}

export function bought(state: GameState, event: Of<'bought'>): StepResult {
  if (state.gold < event.price) return unapplicable(state, event, 'not_enough_gold')
  const full = noRoom(state, event.goods)
  if (full) return unapplicable(state, event, full)
  return draft(state, (s, effects) => {
    s.gold -= event.price
    insert(s, event.goods)
    logTrade(s, effects, goodsEntry(event.goods, 'bought', event.price))
  })
}

export function orderPlaced(state: GameState, event: Of<'order_placed'>): StepResult {
  if (state.gold < event.escrow) return unapplicable(state, event, 'not_enough_gold')
  return draft(state, (s) => {
    s.gold -= event.escrow
  })
}

export function orderRefunded(state: GameState, event: Of<'order_refunded'>): StepResult {
  return draft(state, (s) => {
    s.gold += event.escrow
  })
}

export function orderFilled(state: GameState, event: Of<'order_filled'>): StepResult {
  const goods: Goods = { kind: 'item', item: event.item }
  const full = noRoom(state, goods)
  if (full) return unapplicable(state, event, full)
  return draft(state, (s, effects) => {
    insert(s, goods)
    logTrade(s, effects, goodsEntry(goods, 'bought', event.price))
  })
}

export function orderSold(state: GameState, event: Of<'order_sold'>): StepResult {
  const item = state.inventory.find((i) => i.id === event.itemId)
  if (!item) return unapplicable(state, event, 'unknown_item')
  if (item.equippedBy !== null) return unapplicable(state, event, 'equipped')
  return draft(state, (s, effects) => {
    s.inventory = s.inventory.filter((i) => i.id !== event.itemId)
    s.gold += event.net
    const { base, rarity, net } = event
    logTrade(s, effects, { k: 'trade', what: 'sold', kind: 'item', base, rarity, gold: net })
  })
}

export function credited(state: GameState, event: Of<'credited'>): StepResult {
  return draft(state, (s, effects) => {
    s.gold += event.gold
    effects.push({ k: 'gold', amount: event.gold })
  })
}
