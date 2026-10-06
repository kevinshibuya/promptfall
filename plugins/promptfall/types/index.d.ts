export type BandTab = 'party' | 'loot' | 'world'
export type DialogTab =
  | 'inventory'
  | 'heroes'
  | 'market'
  | 'orders'
  | 'account'
  | 'odds'
  | 'chat'
  | 'leaderboards'
export type Mode = 'primary' | 'secondary' | 'paused' | 'off'
export type HeroView = {
  id: string
  name: string
  /** The name without its epithet: the combat log and the party window. */
  shortName: string
  cls: string
  glyph: string
  level: number
  hp: number
  maxHp: number
  alive: boolean
  rarity: string
  /** 0..10000, the hero's action gauge after the last applied tick. */
  gauge: number
  /** True while the hero waits in the action queue. */
  queued: boolean
  /** fill(spd): gauge gained per 100 ms of battle time, so a renderer can fill smoothly. */
  gaugePerStep: number
}
export type EnemyView = {
  id: string
  /** The content id; 'world_boss' for the world boss, which has none. */
  def: string
  name: string
  glyph: string
  hp: number
  maxHp: number
  kind: string
}
export type LootView = { text: string; rarity: string }
export type ItemView = {
  id: string
  /** The item base's content id: the sprite key. */
  base: string
  name: string
  glyph: string
  slot: string
  rarity: string
  affixes: string[]
  equippedBy: string | null
  classes: string[]
  vendorValue: number
  reforgeCost: number
  /** Server epoch ms before which it cannot be listed; null when never traded. */
  tradeableAt: number | null
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
  /** Server epoch ms before which it cannot be listed; null when never traded. */
  tradeableAt: number | null
  /** Ids of the items it wears, by slot. */
  equipment: { weapon: string | null; armour: string | null; accessory: string | null }
}
/** The account as the dialog shows it; `linked` is the GitHub login. */
export type AccountView = {
  linked: string | null
  /** The server's label: `in-process` or its URL. */
  server: string
  marketOpen: boolean
  /** The bootstrap config's flags: what `gates` falls back to before the first world snapshot. */
  chatOpen: boolean
  presenceOpen: boolean
  leaderboardsOpen: boolean
  bossOpen: boolean
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
  /** Boss mode: the world boss this party is engaged with and what it has dealt (committed and local). */
  boss: { bossId: string; name: string; glyph: string; dealt: number } | null
}
export type Prefs = { collapsed: boolean; bandTab: BandTab }

export type TradeKindView = 'item' | 'hero'
export type RarityName = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary'
export type HeroClassName = 'knight' | 'black_mage' | 'white_mage' | 'archer'

/** A listing as the Market and Orders tabs draw it. */
export type ListingView = {
  id: string
  kind: TradeKindView
  name: string
  rarity: string
  /** Affixes of an item, traits and class of a hero. */
  detail: string
  sellerId: string
  sellerName: string
  price: number
  expiresAt: number
  /** An item listing's base, else null: the sprite key. */
  base: string | null
  /** A hero listing's class, else null: the sprite key. */
  cls: string | null
}
export type OrderView = {
  id: string
  base: string
  name: string
  minRarity: string
  affix: string | null
  maxPrice: number
  expiresAt: number
}
/** The Market tab's query: what `browse` is asked. */
export type MarketQuery = {
  kind: TradeKindView
  base?: string
  cls?: HeroClassName
  minRarity?: RarityName
  sort: 'price' | 'newest'
  page: number
}
export type MarketState = {
  query: MarketQuery
  page: { listings: ListingView[]; page: number; total: number } | null
  busy: boolean
  /** The listing id waiting for `y` to buy. */
  confirm: string | null
  error: string | null
}
export type OrdersState = {
  mine: { listings: ListingView[]; orders: OrderView[]; returns: number } | null
  form: { base: string; minRarity: RarityName; affixId: string | null; maxPrice: string } | null
  busy: boolean
  error: string | null
}
export type SellState = {
  kind: TradeKindView
  id: string
  matching: OrderView[]
  price: string
  error: string | null
  /** The sell window's ▶ row. */
  at: number
}
/** A sub-window open over the Inventory or Heroes list (grill 1.20). `at` is its ▶ row. */
export type PaneMenu =
  | { kind: 'actions'; tab: 'inventory' | 'heroes'; id: string; at: number }
  | { kind: 'equip'; itemId: string; at: number }
  | { kind: 'reforge'; itemId: string; at: number }
  | { kind: 'confirm'; action: 'vendor' | 'dismiss'; id: string; at: number } // at 0 Yes, 1 No
/** The ▶ row of a list: the id it was on, and its index then (for when the id is gone). */
export type PaneCursor = { id: string; index: number }
export type DialogState = {
  itemPick: string | null
  /** The open sub-window; replaces itemPick (UI PR 2, Task 9). */
  menu: PaneMenu | null
  partyPick: string[]
  paneNotice: string | null
  /** The device-flow code while a GitHub link is polling. */
  link: { code: string; url: string } | null
  /** The sell flow; the sell window shows exactly while this is set. */
  sell: SellState | null
  cursor: { inventory: PaneCursor | null; heroes: PaneCursor | null }
}

// The world poll's shapes, structurally the protocol's (`WorldSnapshot`, `ChatMessage`, `BossView`):
// the contract imports nothing.
export type ChatMessage = { id: number; name: string; text: string; at: number }
export type BossView = {
  bossId: string
  name: string
  glyph: string
  maxHp: number
  hp: number
  spawnedAt: number
  endsAt: number
  yours: number
}
export type WorldSnapshot = {
  serverNow: number
  speed: number
  online: number
  zones: { zone: number; count: number }[]
  here: string[]
  boss: BossView | null
  chat: ChatMessage[]
  flags: Record<string, boolean>
}

export type BoardRow = { accountId: string; name: string; value: number }
export type Boards = { highestZone: BoardRow[]; damage: BoardRow[]; weekStart: number }

/** The Chat tab's compose box: the draft is the Input's value, cleared after a post. */
export type ChatState = { draft: string; busy: boolean; error: string | null }
export type BoardsState = { boards: Boards | null; busy: boolean; error: string | null }

/** The world poll's result, published by the session's poller. */
export type WorldState = {
  snapshot: WorldSnapshot | null
  /** Client clock of the last fresh snapshot. */
  fetchedAt: number | null
  /** True once WORLD_STALE_MS passed since `fetchedAt` without a fresh one. */
  stale: boolean
  /** The client's chat buffer: at most 200, ascending id. */
  messages: ChatMessage[]
  /** The id of the last message a poll delivered; sent as `since`; moves only on a poll. */
  chatMark: number
  /** From the snapshot's serverNow and speed. */
  clock: { serverNow: number; clientNow: number; speed: number } | null
  /** PR 2: what this party had committed for the live boss when the snapshot arrived. Null subtracts nothing. */
  committedDealt: { bossId: string; dealt: number } | null
}

/** The terminal's stage renderer: decided by the probe, or forced by `settings.renderer`. */
export type Renderer = 'unknown' | 'image' | 'raster'
/** Per machine, in `$.store` under `promptfall:settings`. */
export type Settings = {
  sound: boolean
  motion: 'full' | 'still'
  renderer: 'auto' | 'image' | 'raster'
}

// Inside the augmentation below, `Settings` names the engine's own export: alias ours outside it.
export type PromptfallSettings = Settings
export type PromptfallRenderer = Renderer

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
      market: MarketState
      orders: OrdersState
      world: WorldState
      chat: ChatState
      boards: BoardsState
      /** The store's settings, mirrored for the drawings. */
      settings: PromptfallSettings
      /** Per session, owned by ui/band.tsx. */
      renderer: PromptfallRenderer
    }
  }
}
