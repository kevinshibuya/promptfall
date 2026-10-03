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

/** Relative weights of a bot's action each tick. */
export const ACTION_WEIGHTS = { list: 4, buy: 3, order: 2, cancel: 1 } as const

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

/** Real milliseconds between bot actions at speed 1. */
export const BOT_TICK_MS = 20_000
