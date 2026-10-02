export const SIM_VERSION = 1 as const

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
}
export type EnemyKind = 'wave' | 'zone_boss' | 'turn_boss'
export type Enemy = { id: string; def: string; kind: EnemyKind; hp: number; maxHp: number }
export type Encounter = {
  enemies: Enemy[]
  queue: { def: string; kind: EnemyKind }[]
  waveSize: number
  spawnedInWave: number
}
export type LootEntry =
  | { k: 'item'; itemId: string; base: string; rarity: Rarity; vendoredFor: number | null }
  | { k: 'hero'; heroId: string; template: string; rarity: Rarity; via: 'contract' | 'tavern' }

export type Event =
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
export type EventKind = Event['t']

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
