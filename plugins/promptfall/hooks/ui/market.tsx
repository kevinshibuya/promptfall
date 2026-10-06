// The Market tab's reads and trades; its windows are ui/pane/market.ts.
import type { MarketQuery, MarketState } from '../../types'
import type { GameHandle } from '../engine'
import { listingView } from '../view'
import { type After, errorText, flash, refusalText, type Updater } from './trade'

/** Syncs, then browses with `query`; any change of filter comes here with page 0. */
export async function loadMarket(
  game: GameHandle,
  query: MarketQuery,
  upd: Updater<MarketState>,
  after: After,
): Promise<void> {
  await upd((s) => ({ ...s, query, busy: true }))
  try {
    // The read expires what is due; the sync after it brings the returns and refunds home.
    const r = await game.market.browse(query)
    if ('reason' in r) throw new Error('Playing in another session')
    await game.sync()
    await upd((s) => ({
      ...s,
      busy: false,
      page: { listings: r.listings.map(listingView), page: r.page, total: r.total },
    }))
  } catch (error) {
    await upd((s) => ({ ...s, busy: false }))
    await flash(upd, after, errorText(error))
  }
}

/** Buys a listing the person said Yes to, then syncs and refetches `query`. */
export async function confirmBuy(
  game: GameHandle,
  id: string,
  query: MarketQuery,
  upd: Updater<MarketState>,
  after: After,
): Promise<void> {
  await upd((s) => ({ ...s, busy: true }))
  try {
    const r = await game.trade((client, auth) => client.buy(auth, id))
    if (!r.ok) await flash(upd, after, refusalText(r.reason))
  } catch (error) {
    await flash(upd, after, errorText(error))
  }
  await loadMarket(game, query, upd, after)
}
