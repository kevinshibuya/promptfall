import type { OrdersState, RarityName } from '../../types'
import type { GameHandle } from '../engine'
import { validPrice } from '../vendor/ledger.js'
import { baseTier, type Item, vendorValue } from '../vendor/sim.js'
import { listingView, orderView } from '../view'
import { type After, errorText, flash, refusalText, type Updater } from './trade'

/** Preset max prices where the surface has no Input: multiples of the base's vendor value. */
export const PRESETS = [2, 3, 5, 8]

/** Syncs, then loads this account's listings, orders and returns. */
export async function loadOrders(
  game: GameHandle,
  upd: Updater<OrdersState>,
  after: After,
): Promise<void> {
  await upd((s) => ({ ...s, busy: true }))
  try {
    // The primary's read expires what is due; the sync after it brings the returns and refunds home.
    const r = await game.market.myOrders()
    if ('reason' in r) throw new Error('Playing in another session')
    await game.sync()
    await upd((s) => ({
      ...s,
      busy: false,
      mine: {
        listings: r.listings.map(listingView),
        orders: r.orders.map(orderView),
        returns: r.returns,
      },
    }))
  } catch (error) {
    await upd((s) => ({ ...s, busy: false }))
    await flash(upd, after, errorText(error))
  }
}

/** Runs a trade from the Orders tab; a refusal shows in red; then reloads. */
export async function ordersTrade(
  game: GameHandle,
  call: Parameters<GameHandle['trade']>[0],
  upd: Updater<OrdersState>,
  after: After,
): Promise<boolean> {
  let done = false
  try {
    const r = await game.trade(call)
    if (r.ok) done = true
    else await flash(upd, after, refusalText(r.reason))
  } catch (error) {
    await flash(upd, after, errorText(error))
  }
  await loadOrders(game, upd, after)
  return done
}

/**
 * Places the order form: one order at a time (Enter and Place order both submit), and only a
 * whole-number price; the form closes once the order is placed.
 */
export async function placeOrder(
  game: GameHandle,
  current: OrdersState,
  upd: Updater<OrdersState>,
  after: After,
): Promise<void> {
  const form = current.form
  if (current.busy || !form || !/^\d+$/.test(form.maxPrice)) return
  if (!validPrice(Number(form.maxPrice))) return
  await upd((o) => ({ ...o, busy: true }))
  const input = {
    base: form.base,
    minRarity: form.minRarity,
    affixId: form.affixId,
    maxPrice: Number(form.maxPrice),
  }
  const done = await ordersTrade(game, (c, a) => c.placeOrder(a, input), upd, after)
  if (done) await upd((o) => ({ ...o, form: null }))
}

/** The rare vendor value of a base: what the presets multiply. */
export function baseValue(base: string, rarity: RarityName): number {
  const probe: Item = {
    id: 'p',
    base,
    rarity,
    tier: baseTier(base),
    affixes: [],
    equippedBy: null,
    tradeableAt: null,
  }
  return vendorValue(probe)
}
