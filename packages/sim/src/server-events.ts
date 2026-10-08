import { SPAWN_GAUGE_MAX } from './battle'
import { content } from './content'
import { clone, draft, reject } from './draft'
import { generateHero, pushLog, recruitHero } from './heroes'
import { rollItemOf, takeDrop } from './loot'
import { changeZone, checkWipe, draw, findHero, grantXp, newId, partyHeroes } from './progression'
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

export function bossEngaged(state: GameState, event: Of<'boss_engaged'>): StepResult {
  if (state.boss !== null) return unapplicable(state, event, 'already_engaged')
  return draft(state, (s) => {
    const { hp } = event.stats
    const id = newId(s, 'e')
    // The old encounter and queue go; a pending turn boss and the turn's tool calls stay.
    s.encounter = {
      enemies: [{ id, def: 'world_boss', kind: 'world_boss', hp, maxHp: hp }],
      queue: [],
      waveSize: 0,
      spawnedInWave: 0,
    }
    s.battle.gauges.push({ id, g: draw(s, SPAWN_GAUGE_MAX + 1) })
    s.boss = {
      bossId: event.bossId,
      name: event.name,
      glyph: event.glyph,
      stats: { ...event.stats },
      dealt: 0,
    }
  })
}

export function bossDisengaged(state: GameState, event: Of<'boss_disengaged'>): StepResult {
  if (state.boss?.bossId !== event.bossId) return unapplicable(state, event, 'not_engaged')
  return draft(state, (s) => {
    const id = s.encounter?.enemies.find((e) => e.kind === 'world_boss')?.id
    s.battle.gauges = s.battle.gauges.filter((e) => e.id !== id)
    s.battle.queue = s.battle.queue.filter((q) => q !== id)
    s.encounter = null
    s.boss = null
  })
}

export function rewarded(state: GameState, event: Of<'rewarded'>): StepResult {
  const goods = event.goods
  if (goods) {
    const full = noRoom(state, goods)
    if (full) return unapplicable(state, event, full)
  }
  return draft(state, (s, effects) => {
    s.gold += event.gold
    if (goods) {
      insert(s, goods)
      const { base, rarity } =
        goods.kind === 'item'
          ? goods.item
          : { base: goods.hero.template, rarity: goods.hero.rarity }
      pushLog(s, { k: 'reward', base, rarity, gold: event.gold })
    }
    effects.push({ k: 'rewarded', bossId: event.bossId, goods: clone(goods), gold: event.gold })
  })
}

// Sandbox grants: each hands out what play would earn, through the path play takes.

function noSuchZone(zone: number): boolean {
  return !Number.isInteger(zone) || content.zones[zone - 1] === undefined
}

function noSuchRarity(rarity: string): boolean {
  return !Object.hasOwn(content.rarity, rarity)
}

/** The encounter goes with no drops and no XP, and the battle resets as a wipe resets it. */
function endEncounter(s: GameState): void {
  s.encounter = null
  s.battle = { gauges: [], queue: [], busy: 0 }
}

export function sandboxBoss(state: GameState, event: Of<'sandbox_boss'>): StepResult {
  if (state.boss) return unapplicable(state, event, 'boss_mode')
  if (noSuchZone(event.zone)) return unapplicable(state, event, 'no_such_zone')
  return draft(state, (s) => {
    if (s.zone !== event.zone) changeZone(s, event.zone)
    endEncounter(s)
    // The next empty tick spawns it: the zone boss at the boss wave, the turn boss when pending.
    if (event.boss === 'zone_boss') {
      s.wave = 11
      s.pendingTurnBoss = false
    } else s.pendingTurnBoss = true
  })
}

export function sandboxItem(state: GameState, event: Of<'sandbox_item'>): StepResult {
  if (!Object.hasOwn(content.itemBases, event.base)) {
    return unapplicable(state, event, 'unknown_base')
  }
  if (noSuchRarity(event.rarity)) return unapplicable(state, event, 'unknown_rarity')
  return draft(state, (s, effects) => {
    takeDrop(s, rollItemOf(s, event.base, event.rarity), effects)
  })
}

export function sandboxLevel(state: GameState, event: Of<'sandbox_level'>): StepResult {
  const hero = findHero(state, event.heroId)
  if (!hero) return unapplicable(state, event, 'unknown_hero')
  if (event.level <= hero.level) return unapplicable(state, event, 'level_not_above')
  const cap = content.rarity[hero.rarity].levelCap
  if (hero.level >= cap) return unapplicable(state, event, 'level_cap')
  return draft(state, (s, effects) => {
    const h = findHero(s, event.heroId)
    // One grant per level, each exactly what the level still needs, so each pushes its level_up.
    while (h && h.level < event.level && h.level < cap) {
      grantXp(s, h, content.xpToNext(h.level) - h.xp, effects)
    }
  })
}

export function sandboxZone(state: GameState, event: Of<'sandbox_zone'>): StepResult {
  if (state.boss) return unapplicable(state, event, 'boss_mode')
  if (noSuchZone(event.zone)) return unapplicable(state, event, 'no_such_zone')
  return draft(state, (s) => {
    changeZone(s, event.zone)
    endEncounter(s)
  })
}

export function sandboxRecruit(state: GameState, event: Of<'sandbox_recruit'>): StepResult {
  if (noSuchRarity(event.rarity)) return unapplicable(state, event, 'unknown_rarity')
  if (state.roster.length >= state.rosterCap) return unapplicable(state, event, 'roster_full')
  return draft(state, (s, effects) => {
    recruitHero(s, generateHero(s, event.rarity), 'sandbox', effects)
  })
}

export function sandboxWipe(state: GameState, event: Of<'sandbox_wipe'>): StepResult {
  if (state.boss) return unapplicable(state, event, 'boss_mode')
  return draft(state, (s, effects) => {
    for (const hero of partyHeroes(s)) hero.hp = 0
    checkWipe(s, effects)
  })
}
