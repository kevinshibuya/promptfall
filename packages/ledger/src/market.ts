import type {
  ListingPage,
  ListingQuery,
  MarketResult,
  MyOrders,
  NewOrder,
  Order,
} from '@promptfall/protocol'
import type { TradeKind } from '@promptfall/sim'
import type { AccountRecord, Books } from './books'

// Phase 2, PR 1: the market refuses every mutation and answers empty reads.
// PR 2 replaces this module with the rules.

export type MarketContext = {
  books: Books
  now: number
  flags: Record<string, boolean>
}

const closed: MarketResult = { ok: false, reason: 'market_closed' }

/** Closes listings and orders past their expiry. Nothing can be open in PR 1. */
export async function expireDue(_ctx: MarketContext): Promise<void> {}

export async function browse(
  _ctx: MarketContext,
  _record: AccountRecord,
  query: ListingQuery,
): Promise<ListingPage> {
  return { listings: [], page: query.page, total: 0 }
}

export async function list(
  _ctx: MarketContext,
  _record: AccountRecord,
  _input: { kind: TradeKind; id: string; price: number },
): Promise<MarketResult> {
  return closed
}

export async function cancelListing(
  _ctx: MarketContext,
  _record: AccountRecord,
  _listingId: string,
): Promise<MarketResult> {
  return closed
}

export async function buy(
  _ctx: MarketContext,
  _record: AccountRecord,
  _listingId: string,
): Promise<MarketResult> {
  return closed
}

export async function myOrders(_ctx: MarketContext, record: AccountRecord): Promise<MyOrders> {
  return { listings: [], orders: [], returns: record.returns.length }
}

export async function placeOrder(
  _ctx: MarketContext,
  _record: AccountRecord,
  _input: NewOrder,
): Promise<MarketResult> {
  return closed
}

export async function cancelOrder(
  _ctx: MarketContext,
  _record: AccountRecord,
  _orderId: string,
): Promise<MarketResult> {
  return closed
}

export async function matchingOrders(
  _ctx: MarketContext,
  _record: AccountRecord,
  _itemId: string,
): Promise<Order[]> {
  return []
}

export async function fillOrder(
  _ctx: MarketContext,
  _record: AccountRecord,
  _orderId: string,
  _itemId: string,
): Promise<MarketResult> {
  return closed
}
