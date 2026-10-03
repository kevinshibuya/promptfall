import type { DialogState, MarketState, OrdersState, Prefs } from '../types'

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
