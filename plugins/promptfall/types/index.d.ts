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
/** The account as the dialog shows it; `linked` is the GitHub login. */
export type AccountView = {
  linked: string | null
  /** The server's label: `in-process` or its URL. */
  server: string
  marketOpen: boolean
  returns: number
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
  account: AccountView
}
export type Prefs = { collapsed: boolean; bandTab: BandTab }
export type DialogState = {
  itemPick: string | null
  partyPick: string[]
  paneNotice: string | null
  /** The device-flow code while a GitHub link is polling. */
  link: { code: string; url: string } | null
}

declare module 'claude-code' {
  interface PluginState {
    promptfall: {
      view: GameView | null
      prefs: Prefs
      mode: Mode
      dialogTab: DialogTab
      notice: string | null
      dialog: DialogState
      leaseOwner: string | null
      /** The server URL this machine plays on; null for the in-process ledger. */
      server: string | null
    }
  }
}
