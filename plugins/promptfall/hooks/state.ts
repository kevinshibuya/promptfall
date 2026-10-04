import type {
  BoardsState,
  ChatState,
  DialogState,
  MarketState,
  OrdersState,
  Prefs,
  Settings,
  WorldState,
} from '../types'

// The session's values are declared in types/index.d.ts. The scan behind
// `claude plugin validate` reads an atom only where it is declared in the
// module that calls `read` or `update`, so each module declares the atoms it
// uses, as `atom({ plugin: 'promptfall', key }, initial)`, with these initials.

export const PREFS_DEFAULT: Prefs = { collapsed: false, bandTab: 'party' }
export const DIALOG_DEFAULT: DialogState = {
  itemPick: null,
  partyPick: [],
  paneNotice: null,
  link: null,
  sell: null,
}
export const MARKET_DEFAULT: MarketState = {
  query: { kind: 'item', sort: 'price', page: 0 },
  page: null,
  busy: false,
  confirm: null,
  error: null,
}
export const ORDERS_DEFAULT: OrdersState = { mine: null, form: null, busy: false, error: null }
export const WORLD_DEFAULT: WorldState = {
  snapshot: null,
  fetchedAt: null,
  stale: false,
  messages: [],
  chatMark: 0,
  clock: null,
  committedDealt: null,
}
export const CHAT_DEFAULT: ChatState = { draft: '', busy: false, error: null }
export const BOARDS_DEFAULT: BoardsState = { boards: null, busy: false, error: null }
export const SETTINGS_DEFAULT: Settings = { sound: false, motion: 'full', renderer: 'auto' }
/** The store key of the settings, under `promptfall:`; `reset()` keeps it as it keeps the lease. */
export const SETTINGS_KEY = 'settings'

/** The stored settings over the defaults; a missing or malformed field takes its default. */
export function parseSettings(raw: unknown): Settings {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<
    Record<keyof Settings, unknown>
  >
  return {
    sound: typeof r.sound === 'boolean' ? r.sound : SETTINGS_DEFAULT.sound,
    motion: r.motion === 'still' || r.motion === 'full' ? r.motion : SETTINGS_DEFAULT.motion,
    renderer:
      r.renderer === 'image' || r.renderer === 'raster' || r.renderer === 'auto'
        ? r.renderer
        : SETTINGS_DEFAULT.renderer,
  }
}
