export const SIM_VERSION = 15 as const

export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary'
export const RARITIES: readonly Rarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary']
export type HeroClass = 'knight' | 'black_mage' | 'white_mage' | 'archer'
export type Slot = 'weapon' | 'armour' | 'accessory'
export type Stat = 'hp' | 'atk' | 'def' | 'spd'
export type Stats = Record<Stat, number>

export type Affix = {
  id: string
  /** The flat roll, as stored: what it counts for is scaled by its item's tier (`affixValue`). */
  value: number
}
export type Item = {
  id: string
  base: string
  rarity: Rarity
  /** 1 to 6, set at the drop: it scales the affixes' rolls at read and the reforge price. */
  tier: number
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
export type EnemyKind = 'wave' | 'zone_boss' | 'turn_boss' | 'world_boss'
export type Enemy = {
  id: string
  def: string
  kind: EnemyKind
  hp: number
  maxHp: number
  /** Set by a mishap: its next attack lands harder, then it clears. */
  enraged: boolean
}
/** A wave enemy's archetype: what a tool call's hint names. Every zone's wave list holds one of each. */
export type WaveArchetype = 'swift' | 'brute' | 'caster' | 'tank'
export const WAVE_ARCHETYPES: readonly WaveArchetype[] = ['swift', 'brute', 'caster', 'tank']
export type Encounter = {
  enemies: Enemy[]
  queue: { def: string; kind: EnemyKind }[]
  waveSize: number
  spawnedInWave: number
}
/** Battle time state carried across ticks. Arrays, not records: canonical order is insertion order. */
export type Battle = {
  /** One entry per unit on the field (living party heroes, encounter enemies). 0..GAUGE_FULL. */
  gauges: { id: string; g: number }[]
  /** Unit ids whose gauge is full, in the order they filled. Head acts next. */
  queue: string[]
  /** Steps left in the running action; 0 when nobody is acting. Carries across ticks. */
  busy: number
}
export type ActionId = 'attack' | 'attack_all' | 'heal'
export type TradeKind = 'item' | 'hero'
export type Goods = { kind: 'item'; item: Item } | { kind: 'hero'; hero: Hero }

export type RecruitVia = 'contract' | 'tavern' | 'sandbox'

export type LootEntry =
  | { k: 'item'; itemId: string; base: string; rarity: Rarity; vendoredFor: number | null }
  | { k: 'hero'; heroId: string; template: string; rarity: Rarity; via: RecruitVia }
  | {
      k: 'trade'
      what: 'sold' | 'bought' | 'returned'
      kind: TradeKind
      base: string
      rarity: Rarity
      gold: number
    }
  | { k: 'reward'; base: string; rarity: Rarity; gold: number }

export type PlayerEvent =
  | { t: 'tick' }
  /** `hint` names the wave enemy the call spawns; absent, the draw is uniform. */
  | { t: 'tool_call'; hint?: WaveArchetype }
  | { t: 'turn_start' }
  | { t: 'turn_end' }
  | { t: 'rest' }
  | { t: 'tool_mishap' }
  | { t: 'camp' }
  | { t: 'guard'; on: boolean }
  | { t: 'equip'; heroId: string; itemId: string }
  | { t: 'unequip'; heroId: string; slot: Slot }
  | { t: 'vendor'; itemId: string }
  | { t: 'reforge'; itemId: string; affixIndex: number }
  | { t: 'set_party'; heroIds: [string, string, string] }
  | { t: 'recruit' }
  | { t: 'dismiss'; heroId: string }
  | { t: 'set_farm'; on: boolean }
  | { t: 'set_auto_vendor'; on: boolean }
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
  /** Boss mode: the encounter becomes one undying `world_boss` with these (zone 1 baseline) stats. */
  | { t: 'boss_engaged'; bossId: string; name: string; glyph: string; stats: Stats }
  | { t: 'boss_disengaged'; bossId: string }
  /** One reward roll; `goods` null when the item waited in returns. */
  | { t: 'rewarded'; bossId: string; goods: Goods | null; gold: number }
  | SandboxEvent

/** Authored only by a host with the sandbox on. Each hands out what play would earn, through play's own path. */
export type SandboxEvent =
  /** Moves the party to the zone, ends the encounter, and has the next empty tick spawn that boss. */
  | { t: 'sandbox_boss'; zone: number; boss: 'zone_boss' | 'turn_boss' }
  | { t: 'sandbox_item'; base: string; rarity: Rarity }
  | { t: 'sandbox_level'; heroId: string; level: number }
  | { t: 'sandbox_zone'; zone: number }
  | { t: 'sandbox_recruit'; rarity: Rarity }
  | { t: 'sandbox_wipe' }

export type Event = PlayerEvent | ServerEvent
export type EventKind = Event['t']
export type PlayerEventKind = PlayerEvent['t']
export type ServerEventKind = ServerEvent['t']
export type SandboxEventKind = SandboxEvent['t']
export const SANDBOX_EVENT_KINDS: readonly SandboxEventKind[] = [
  'sandbox_boss',
  'sandbox_item',
  'sandbox_level',
  'sandbox_zone',
  'sandbox_recruit',
  'sandbox_wipe',
]
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
  'boss_engaged',
  'boss_disengaged',
  'rewarded',
  ...SANDBOX_EVENT_KINDS,
]

export type Effect =
  | { k: 'drop'; item: Item }
  /** A drop sold on pickup: `full` for a full inventory, `setting` for the auto-vendor setting. */
  | { k: 'drop_vendored'; item: Item; gold: number; cause: 'full' | 'setting' }
  | { k: 'gold'; amount: number }
  | { k: 'level_up'; heroId: string; level: number }
  | { k: 'wave_cleared'; zone: number; wave: number }
  | { k: 'zone_cleared'; zone: number; advancedTo: number }
  | { k: 'boss_spawned'; kind: 'zone_boss' | 'turn_boss'; def: string }
  | { k: 'hero_fell'; heroId: string }
  /** The party fell and restarts `zone`, the one it is in, at wave 1. */
  | { k: 'wipe'; zone: number }
  /** The party's third wipe in a zone: it fell back to `zone`, one lower, or restarts zone 1. */
  | { k: 'retreat'; zone: number }
  | { k: 'party_applied'; heroIds: [string, string, string] }
  | { k: 'hero_recruited'; hero: Hero; via: RecruitVia }
  | { k: 'rejected'; event: Event; reason: string }
  | { k: 'rewarded'; bossId: string; goods: Goods | null; gold: number }
  | { k: 'traded'; entry: Extract<LootEntry, { k: 'trade' }> }
  /** Output only: one per attack, by and target actor ids (Hero.id or Enemy.id); feeds no hash. */
  | { k: 'hit'; by: string; target: string; amount: number }
  /** Output only: an action starts. Every effect after it, up to the next `act`, is this action's. at: battle ms into this tick, 0..1999. */
  | { k: 'act'; actor: string; action: ActionId; at: number }
  /** Output only: a heal landed; amount is the HP actually restored. */
  | { k: 'heal'; by: string; target: string; amount: number }
  /** Haste turned on or off: emitted on the change only. */
  | { k: 'haste'; on: boolean }
  /** Guard turned on or off: emitted on the change only. */
  | { k: 'guard'; on: boolean }
  /** A mishap enraged this enemy (an Enemy.id). */
  | { k: 'enraged'; enemyId: string }
  /** The party camped: each party hero and the HP it restored. */
  | { k: 'camp'; heals: { heroId: string; amount: number }[] }

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
  /** The auto-vendor setting, off on every save: Commons, and Uncommons past zone 3, sold on pickup. */
  autoVendor: boolean
  highestZone: number
  /** Wipes in the current zone since it was entered or its zone boss last fell; the third retreats. */
  zoneWipes: number
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
  /** Ticks of Haste left; 0 is off. Set by turn_start, cleared by turn_end and rest. */
  hasteTicks: number
  /** Ticks of Guard left; 0 is off. Set by guard on, cleared by guard off and rest. */
  guardTicks: number
  lootLog: LootEntry[]
  stats: { kills: number; bosses: number; wipes: number }
  /** Boss mode: set by boss_engaged, cleared by boss_disengaged. `dealt` is the party's tally for this boss. */
  boss: { bossId: string; name: string; glyph: string; stats: Stats; dealt: number } | null
  battle: Battle
}

export type StepResult = { state: GameState; effects: Effect[] }
