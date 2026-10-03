export const SIM_VERSION = 2 as const

export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary'
export const RARITIES: readonly Rarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary']
export type HeroClass = 'knight' | 'black_mage' | 'white_mage' | 'archer'
export type Slot = 'weapon' | 'armour' | 'accessory'
export type Stat = 'hp' | 'atk' | 'def' | 'spd'
export type Stats = Record<Stat, number>

export type Affix = { id: string; value: number }
export type Item = {
  id: string
  base: string
  rarity: Rarity
  affixes: Affix[]
  equippedBy: string | null
  /** Server epoch ms before which the ledger refuses to list it; null when never traded. Data, never a rule. */
  tradeableAt: number | null
}
export type Trait = { id: string; valueBp: number }
export type Hero = {
  id: string
  template: string
  cls: HeroClass
  epithet: string
  rarity: Rarity
  traits: Trait[]
  level: number
  xp: number
  hp: number
  equipment: Record<Slot, string | null>
  /** Server epoch ms before which the ledger refuses to list it; null when never traded. Data, never a rule. */
  tradeableAt: number | null
}
export type EnemyKind = 'wave' | 'zone_boss' | 'turn_boss'
export type Enemy = { id: string; def: string; kind: EnemyKind; hp: number; maxHp: number }
export type Encounter = {
  enemies: Enemy[]
  queue: { def: string; kind: EnemyKind }[]
  waveSize: number
  spawnedInWave: number
}
export type TradeKind = 'item' | 'hero'
export type Goods = { kind: 'item'; item: Item } | { kind: 'hero'; hero: Hero }

export type LootEntry =
  | { k: 'item'; itemId: string; base: string; rarity: Rarity; vendoredFor: number | null }
  | { k: 'hero'; heroId: string; template: string; rarity: Rarity; via: 'contract' | 'tavern' }
  | {
      k: 'trade'
      what: 'sold' | 'bought' | 'returned'
      kind: TradeKind
      base: string
      rarity: Rarity
      gold: number
    }

export type PlayerEvent =
  | { t: 'tick' }
  | { t: 'tool_call' }
  | { t: 'turn_end' }
  | { t: 'rest' }
  | { t: 'equip'; heroId: string; itemId: string }
  | { t: 'unequip'; heroId: string; slot: Slot }
  | { t: 'vendor'; itemId: string }
  | { t: 'reforge'; itemId: string; affixIndex: number }
  | { t: 'set_party'; heroIds: [string, string, string] }
  | { t: 'recruit' }
  | { t: 'dismiss'; heroId: string }
  | { t: 'set_farm'; on: boolean }
  | { t: 'expand_inventory' }
  | { t: 'expand_roster' }

/** Authored only by the ledger. Each carries everything the sim needs; the sim judges nothing. */
export type ServerEvent =
  | { t: 'listed'; listingId: string; kind: TradeKind; id: string; fee: number }
  | { t: 'returned'; listingId: string; goods: Goods }
  | {
      t: 'sold'
      listingId: string
      kind: TradeKind
      base: string
      rarity: Rarity
      price: number
      net: number
    }
  | { t: 'bought'; listingId: string; goods: Goods; price: number }
  | { t: 'order_placed'; orderId: string; escrow: number }
  | { t: 'order_refunded'; orderId: string; escrow: number }
  | { t: 'order_filled'; orderId: string; item: Item; price: number }
  | {
      t: 'order_sold'
      orderId: string
      itemId: string
      base: string
      rarity: Rarity
      price: number
      net: number
    }
  | { t: 'credited'; gold: number; reason: string }

export type Event = PlayerEvent | ServerEvent
export type EventKind = Event['t']
export type PlayerEventKind = PlayerEvent['t']
export type ServerEventKind = ServerEvent['t']
export const SERVER_EVENT_KINDS: readonly ServerEventKind[] = [
  'listed',
  'returned',
  'sold',
  'bought',
  'order_placed',
  'order_refunded',
  'order_filled',
  'order_sold',
  'credited',
]

export type Effect =
  | { k: 'drop'; item: Item }
  | { k: 'drop_vendored'; item: Item; gold: number }
  | { k: 'gold'; amount: number }
  | { k: 'level_up'; heroId: string; level: number }
  | { k: 'wave_cleared'; zone: number; wave: number }
  | { k: 'zone_cleared'; zone: number; advancedTo: number }
  | { k: 'boss_spawned'; kind: 'zone_boss' | 'turn_boss'; def: string }
  | { k: 'hero_fell'; heroId: string }
  | { k: 'wipe'; retreatedTo: number }
  | { k: 'party_applied'; heroIds: [string, string, string] }
  | { k: 'hero_recruited'; hero: Hero; via: 'contract' | 'tavern' }
  | { k: 'rejected'; event: Event; reason: string }
  | { k: 'traded'; entry: Extract<LootEntry, { k: 'trade' }> }

export type GameState = {
  v: typeof SIM_VERSION
  seed: number
  rng: number
  counter: number
  tick: number
  gold: number
  zone: number
  wave: number
  farm: boolean
  highestZone: number
  roster: Hero[]
  party: [string, string, string]
  pendingParty: [string, string, string] | null
  inventory: Item[]
  inventoryCap: number
  rosterCap: number
  recruits: number
  turnToolCalls: number
  encounter: Encounter | null
  pendingTurnBoss: boolean
  lootLog: LootEntry[]
  stats: { kills: number; bosses: number; wipes: number }
}

export type StepResult = { state: GameState; effects: Effect[] }
