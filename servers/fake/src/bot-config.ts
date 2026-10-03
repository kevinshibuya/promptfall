import type { Rarity } from '@promptfall/sim'

// Tuning for the HTTP fake's bots. Nothing here is a rule: the ledger judges every trade.

export const BOT_NAMES = [
  'Ashgrove',
  'Brindle',
  'Corvina',
  'Dunmore',
  'Elspeth',
  'Fenwick',
  'Galloway',
  'Hollis',
  'Isolde',
  'Jory',
  'Kestrel',
  'Lark',
  'Morrow',
  'Nettle',
  'Oswin',
  'Perrin',
] as const

export const BOT_START_GOLD = 50_000
/** Below this a bot is credited a stipend before it acts. */
export const STIPEND_FLOOR = 2000
export const STIPEND = 1000

/** Relative weights of a bot's market action each act. Chat runs on its own cadence. */
export const ACTION_WEIGHTS = { list: 4, buy: 3, order: 2, fill: 2, cancel: 1 } as const

/** An item lists at vendor value × (LIST_MULT_MIN + roll(LIST_MULT_SPREAD)). */
export const LIST_MULT_MIN = 3
export const LIST_MULT_SPREAD = 6
/** A bot buys an item listed under vendor value × this. */
export const BUY_UNDER_MULT = 4
/** A bot's buy order offers the base's rare vendor value × this. */
export const ORDER_MULT = 3

/** What a bot asks for a hero, and pays at most. */
export const HERO_PRICE: Record<Rarity, number> = {
  common: 0,
  uncommon: 0,
  rare: 1500,
  epic: 6000,
  legendary: 25_000,
}

/** Virtual ms between one bot's acts: the scheduler fires every BOT_TICK_MS / count / speed real ms. */
export const BOT_TICK_MS = 20_000

/** A bot's batch holds BATCH_TICKS_MIN + roll(BATCH_TICKS_SPREAD) ticks: an idle human's cadence. */
export const BATCH_TICKS_MIN = 4
export const BATCH_TICKS_SPREAD = 3
/** A tool call before every this-many-th tick. */
export const TOOL_CALL_EVERY = 3
/** A turn end at the end of every this-many-th batch. */
export const TURN_END_EVERY_BATCHES = 2
/** A rest at the start of every this-many-th batch. */
export const REST_EVERY_BATCHES = 4
/** Every this-many-th act of a bot posts one of BOT_LINES. */
export const CHAT_EVERY_TICKS = 6

/** What bots say. No blocklisted word. */
export const BOT_LINES = [
  'anyone selling a rare bow?',
  'zone 2 bandits hit hard today',
  'just found an epic, feeling lucky',
  'buying steel longswords, good price',
  'my white mage carries this party',
  'gg everyone',
  'that boss took three tries',
  'resting up before the next push',
  'market is busy tonight',
  'who else is grinding zone 1?',
  'listed a few spares, take a look',
  'one more wave then I sleep',
] as const
