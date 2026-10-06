// The pane's ring stops and actions (docs/plans/2026-10-06-ui-pr2-pane-windows.md, "Ring stops and
// pane actions"): the builders return actions as data and the mount runs them.
import type { DialogTab, PaneMenu } from '../../../types'
import type { PlayerEvent } from '../../vendor/sim.js'
import type { PaneScene } from '../../windows/kit'

export type PaneAction =
  | { t: 'tab'; tab: DialogTab }
  | { t: 'open'; menu: PaneMenu } // opens a command, pick or Yes/No window
  | { t: 'back' } // closes the open sub-window, else the sell flow; nothing at the top level
  | { t: 'event'; event: PlayerEvent; keep?: true } // applied through `act`; closes the menu unless `keep`
  | { t: 'party'; heroId: string } // toggles a pick; the third pick sends set_party
  | { t: 'sell'; kind: 'item' | 'hero'; id: string } // openSell; closes the menu
  | { t: 'accept'; orderId: string; price: number } // sellTrade with fillOrder
  | { t: 'list'; price: number } // sellTrade with list
  | { t: 'price' } // focuses the price Input
  | { t: 'claim' } // play here (secondary mode)
  | { t: 'none' } // the cursor stops here; Enter does nothing

export type Stop = {
  /** The hidden Button's key: what ui.focus and ui.press name. Unique in the pane. */
  key: string
  /** One lowercase letter or digit, or none. */
  hotkey?: string
  action: PaneAction
  /** True for the stops the ▶ cursor lands on; false for tab, back and claim Buttons. */
  cursor: boolean
  /** A cursor stop's row in its window (list row, menu item, 0 Yes / 1 No). */
  index?: number
}

export type PaneBuild = {
  scene: PaneScene
  /** In ring order: the order the hidden Buttons are mounted. */
  stops: readonly Stop[]
  /** The cursor stop the ring belongs on now: the open window's ▶ row, else the list's. */
  focus: string | null
  /** True while the sell price Input shows under the picture. */
  priceInput: boolean
}
