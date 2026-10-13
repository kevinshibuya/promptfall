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
  /** The sim's heroFill: gauge gained per 100 ms of battle time, Haste and Guard applied, so a renderer can fill smoothly. */
  gaugePerStep: number
  /** Haste is on: the gauge fills at the hasted rate. */
  hasted: boolean
  /** Guard is on: the gauge holds and the hero acts on nobody. */
  guarding: boolean
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
  /** A mishap enraged it: its next hit lands harder. */
  enraged: boolean
}
/**
 * What wrote a Loot row: a kill's drop or its auto-vendoring, which wait for the chest's reveal,
 * or anything else (a trade, a recruit, a boss's reward), which never waits.
 */
export type LootKind = 'drop' | 'vendored' | 'market'
/** A Loot row. `itemId` is the dropped item's id, the key to its chest; null for a row of no item. */
export type LootView = { text: string; rarity: string; kind: LootKind; itemId: string | null }
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
  /** The sandbox save: the purse says `Sandbox` and the account never links. */
  sandbox: boolean
}
export type GameView = {
  heroes: HeroView[]
  enemies: EnemyView[]
  zone: number
  zoneName: string
  wave: number
  gold: number
  farm: boolean
  /** The account's auto-vendor setting. */
  autoVendor: boolean
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
  tallies: TalliesView
  guarantees: GuaranteesView
}
export type Prefs = { collapsed: boolean; bandTab: BandTab }

/** One integer per rarity. */
export type RarityCountsView = Record<RarityName, number>
/** The sim's tallies, counted from version 16: what the Journal's bestiary and collection read. */
export type TalliesView = {
  /** Per enemy definition: spawns met and kills. */
  enemies: Record<string, { seen: number; defeated: number }>
  /** Per item base: 1 at each rarity the party has held it in. */
  collection: Record<string, RarityCountsView>
  zoneBosses: number
  /** Zone bosses beaten with no wipe in their zone. */
  cleanZoneBosses: number
  turnBosses: number
  drops: RarityCountsView
  recruits: RarityCountsView
  reforges: number
  goldEarned: number
}
/** Per tavern guarantee, the recruits until one of its rarity or better is certain: 1 is the next. */
export type GuaranteesView = { rare: number; epic: number; legendary: number }

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
/** A Market filter or an order-form field a pick window sets. */
export type PickField = 'base' | 'cls' | 'minRarity' | 'orderBase' | 'orderRarity' | 'orderAffix'
/** A sub-window open over a list (grill 1.20, 1.21). `at` is its ▶ row. */
export type PaneMenu =
  | { kind: 'actions'; tab: 'inventory' | 'heroes'; id: string; at: number }
  | { kind: 'equip'; itemId: string; at: number }
  | { kind: 'reforge'; itemId: string; at: number }
  | {
      kind: 'confirm'
      action: 'vendor' | 'dismiss' | 'buy' | 'cancel-listing' | 'cancel-order' | 'reset' | 'delete'
      /** The item, hero, listing or order; '' for reset and delete. */
      id: string
      /** 0 Yes, 1 No. */
      at: number
    }
  | { kind: 'filter'; at: number } // the Market filter window
  | { kind: 'pick'; field: PickField; at: number }
/** The ▶ row of a list: the id it was on, and its index then (for when the id is gone). */
export type PaneCursor = { id: string; index: number }
export type DialogState = {
  /** The open sub-window over the list. */
  menu: PaneMenu | null
  partyPick: string[]
  paneNotice: string | null
  /** The device-flow code while a GitHub link is polling. */
  link: { code: string; url: string } | null
  /** The sell flow; the sell window shows exactly while this is set. */
  sell: SellState | null
  /** Each list's ▶ row; a tab missing here reads as null. */
  cursor: Partial<Record<DialogTab, PaneCursor | null>>
  /** The order form's ▶ row (Orders, while `orders.form` is set and no pick is open). */
  formAt: number
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
/** The cues' volume step; off plays none. */
export type Sound = 'off' | 'quiet' | 'normal' | 'loud'
/** Per machine, in `$.store` under `promptfall:settings`. */
export type Settings = {
  sound: Sound
  motion: 'full' | 'still'
  renderer: 'auto' | 'image' | 'raster'
  /**
   * The verdict the last probe on this machine landed on, null before the first: what the band
   * lays out with while this session's probe is pending. Not the player's choice, so a probe
   * still runs and a changed terminal is found out.
   */
  probed: 'image' | 'raster' | null
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
      /** Per session, never stored: a play here was skipped or refused, so no cue is tried again. */
      soundSilent: boolean
      /** Per session: the surface it started on, so a hot reload (which starts with none) keeps it. */
      surface: 'terminal' | 'desktop' | null
    }
  }
}
