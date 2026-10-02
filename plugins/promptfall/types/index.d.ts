export type BandTab = 'party' | 'loot' | 'world'
export type DialogTab = 'inventory' | 'heroes' | 'account' | 'odds'
export type Mode = 'primary' | 'secondary' | 'paused' | 'off'
export type HeroView = {
  id: string
  name: string
  cls: string
  glyph: string
  level: number
  hp: number
  maxHp: number
  alive: boolean
}
export type EnemyView = { name: string; glyph: string; hp: number; maxHp: number; kind: string }
export type LootView = { text: string; rarity: string }
export type ItemView = {
  id: string
  name: string
  glyph: string
  slot: string
  rarity: string
  affixes: string[]
  equippedBy: string | null
  classes: string[]
  vendorValue: number
  reforgeCost: number
}
export type RosterHeroView = {
  id: string
  name: string
  cls: string
  glyph: string
  rarity: string
  level: number
  traits: string[]
  inParty: boolean
  inPendingParty: boolean
}
export type GameView = {
  heroes: HeroView[]
  enemies: EnemyView[]
  zone: number
  zoneName: string
  wave: number
  gold: number
  farm: boolean
  lastDrop: LootView | null
  loot: LootView[]
  highestZone: number
  kills: number
  wipes: number
  inventory: ItemView[]
  inventoryCap: number
  roster: RosterHeroView[]
  rosterCap: number
  tavernPrice: number
  nextInventoryCost: number | null
  nextRosterCost: number | null
  accountId: string
  firstRun: boolean
}
export type Prefs = { collapsed: boolean; bandTab: BandTab }
export type DialogState = {
  itemPick: string | null
  partyPick: string[]
  paneNotice: string | null
}

declare module 'claude-code' {
  interface PluginState {
    promptfall: {
      view: GameView | null
      prefs: Prefs
      mode: Mode
      previousMode: Mode | null
      dialogTab: DialogTab
      notice: string | null
      dialog: DialogState
      leaseOwner: string | null
    }
  }
}
