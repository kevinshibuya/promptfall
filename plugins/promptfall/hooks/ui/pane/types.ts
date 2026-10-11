// The pane's ring stops and actions (docs/plans/2026-10-06-ui-pr2-pane-windows.md, "Ring stops and
// pane actions"; PR 3's "Ring stops, actions, the field"): the builders return actions as data and
// the mount runs them.
import type { DialogTab, MarketQuery, OrdersState, PaneMenu, Settings } from '../../../types'
import type { PlayerEvent } from '../../vendor/sim.js'
import type { PaneScene } from '../../windows/kit'

export type PaneFieldKey = 'price' | 'order-price' | 'compose'

/** An Input under the picture. Shown only where the surface has an Input. */
export type PaneField = {
  key: PaneFieldKey
  label: string
  placeholder: string
  value: string
  submitLabel: string
}

export type PaneAction =
  | { t: 'tab'; tab: DialogTab }
  | { t: 'open'; menu: PaneMenu } // opens a command, pick, filter or Yes/No window
  | { t: 'back' } // see the mount's Back rule
  | { t: 'event'; event: PlayerEvent; keep?: true } // applied through `act`; closes the menu unless `keep`
  | { t: 'party'; heroId: string } // toggles a pick; the third pick sends set_party
  | { t: 'sell'; kind: 'item' | 'hero'; id: string } // openSell; closes the menu
  | { t: 'accept'; orderId: string; price: number } // sellTrade with fillOrder
  | { t: 'list'; price: number } // sellTrade with list
  | { t: 'field'; key: PaneFieldKey } // focuses the field under the picture
  | { t: 'claim' } // play here (secondary mode)
  | { t: 'none' } // the cursor stops here; Enter does nothing
  | { t: 'query'; query: MarketQuery; menu: PaneMenu | null } // loadMarket, cursor.market cleared, then `menu`
  | { t: 'buy'; listingId: string } // confirmBuy; closes the menu
  | { t: 'cancel'; what: 'listing' | 'order'; id: string } // ordersTrade cancel; closes the menu
  | { t: 'form'; form: NonNullable<OrdersState['form']> | null; menu: PaneMenu | null } // sets orders.form, then `menu`
  | { t: 'place' } // places the order form (placeOrder)
  | { t: 'setting'; patch: Partial<Settings> } // merges into the stored settings
  | { t: 'band'; collapsed: boolean } // prefs.collapsed
  | { t: 'off' } // game()?.setOff(true)
  | { t: 'link' } // game()?.link()
  | { t: 'reset' } // game()?.reset(); closes the menu
  | { t: 'delete' } // game()?.deleteAccount(); closes the menu

export type Stop = {
  /** The hidden Button's key: what ui.focus and ui.press name. Unique in the pane. */
  key: string
  /** One lowercase letter or digit, or none. */
  hotkey?: string
  action: PaneAction
  /** True for the stops the ▶ cursor lands on; false for tab, back and claim Buttons. */
  cursor: boolean
  /** A cursor stop's row in its window (list stop position, menu item, 0 Yes / 1 No). */
  index?: number
}

export type PaneBuild = {
  scene: PaneScene
  /** In ring order: the order the hidden Buttons are mounted. */
  stops: readonly Stop[]
  /** The cursor stop the ring belongs on now: the open window's ▶ row, else the list's. */
  focus: string | null
  /** The field under the picture, or null. */
  field: PaneField | null
  /** The device-flow URL under the picture (Account), or null. */
  link: { url: string } | null
}
