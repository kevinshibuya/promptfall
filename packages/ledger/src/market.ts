import {
  LISTINGS_PER_PAGE,
  type Listing,
  type ListingPage,
  type ListingQuery,
  type MarketRefusal,
  type MarketResult,
  type MyOrders,
  type NewOrder,
  type Order,
} from '@promptfall/protocol'
import { content, type GameState, type Goods, type Item, type TradeKind } from '@promptfall/sim'
import { type AccountRecord, author, type Books, deliveryOf, hasRoom, publicName } from './books'
import {
  atLeast,
  EXPIRY_MS,
  goodsBase,
  goodsRarity,
  listingFee,
  saleNet,
  tradeableRarity,
  transfer,
  validPrice,
} from './goods'
import { nextLedgerId } from './ids'

export type MarketContext = {
  books: Books
  now: number
  flags: Record<string, boolean>
}

const LISTINGS_KEY = 'pf:listings'
const ORDERS_KEY = 'pf:orders'
const listingKey = (id: string) => `pf:listing:${id}`
const orderKey = (id: string) => `pf:order:${id}`

function refuse(reason: MarketRefusal): MarketResult {
  return { ok: false, reason }
}

function open(ctx: MarketContext): boolean {
  return ctx.flags['market.enabled'] !== false
}

// ---------------------------------------------------------------------------
// Storage

async function ids(ctx: MarketContext, key: string): Promise<string[]> {
  const raw = await ctx.books.kv.get(key)
  return Array.isArray(raw) ? (raw as string[]) : []
}

async function openListings(ctx: MarketContext): Promise<Listing[]> {
  const out: Listing[] = []
  for (const id of await ids(ctx, LISTINGS_KEY)) {
    const listing = (await ctx.books.kv.get(listingKey(id))) as Listing | undefined
    if (listing) out.push(listing)
  }
  return out
}

async function openOrders(ctx: MarketContext): Promise<Order[]> {
  const out: Order[] = []
  for (const id of await ids(ctx, ORDERS_KEY)) {
    const order = (await ctx.books.kv.get(orderKey(id))) as Order | undefined
    if (order) out.push(order)
  }
  return out
}

async function openListing(ctx: MarketContext, id: string): Promise<Listing | null> {
  if (!(await ids(ctx, LISTINGS_KEY)).includes(id)) return null
  return ((await ctx.books.kv.get(listingKey(id))) as Listing | undefined) ?? null
}

async function openOrder(ctx: MarketContext, id: string): Promise<Order | null> {
  if (!(await ids(ctx, ORDERS_KEY)).includes(id)) return null
  return ((await ctx.books.kv.get(orderKey(id))) as Order | undefined) ?? null
}

async function closeListing(ctx: MarketContext, id: string): Promise<void> {
  await ctx.books.kv.set(
    LISTINGS_KEY,
    (await ids(ctx, LISTINGS_KEY)).filter((x) => x !== id),
  )
  await ctx.books.kv.delete(listingKey(id))
}

async function closeOrder(ctx: MarketContext, id: string): Promise<void> {
  await ctx.books.kv.set(
    ORDERS_KEY,
    (await ids(ctx, ORDERS_KEY)).filter((x) => x !== id),
  )
  await ctx.books.kv.delete(orderKey(id))
}

async function counterparty(ctx: MarketContext, accountId: string): Promise<AccountRecord> {
  const record = await ctx.books.load(accountId)
  if (!record) throw new Error(`market: no account ${accountId}`)
  return record
}

/** Unchanged goods back to their owner: into a free slot, or onto the returns queue. */
async function giveBack(
  ctx: MarketContext,
  record: AccountRecord,
  listing: Listing,
): Promise<void> {
  if (hasRoom(record.state, listing.goods)) {
    author(record, { t: 'returned', listingId: listing.id, goods: listing.goods })
  } else {
    record.returns.push({ listingId: listing.id, goods: listing.goods })
    await ctx.books.syncReturnsQueue(record)
  }
}

/** The goods as the effective state holds them, or null. */
function owned(state: GameState, kind: TradeKind, id: string): Goods | null {
  if (kind === 'item') {
    const item = state.inventory.find((i) => i.id === id)
    return item ? { kind: 'item', item } : null
  }
  const hero = state.roster.find((h) => h.id === id)
  return hero ? { kind: 'hero', hero } : null
}

/** The seller-side checks shared by `list` and `fillOrder`, after the gates. */
function sellerRefusal(
  ctx: MarketContext,
  state: GameState,
  goods: Goods | null,
): MarketRefusal | null {
  if (!goods) return 'unknown_goods'
  if (!tradeableRarity(goodsRarity(goods))) return 'not_tradeable_rarity'
  const tradeableAt = goods.kind === 'item' ? goods.item.tradeableAt : goods.hero.tradeableAt
  if (tradeableAt !== null && tradeableAt > ctx.now) return 'in_cooldown'
  if (goods.kind === 'item') {
    if (goods.item.equippedBy !== null) return 'equipped'
  } else {
    if (Object.values(goods.hero.equipment).some((id) => id !== null)) return 'equipped'
    const id = goods.hero.id
    if (state.party.includes(id) || state.pendingParty?.includes(id)) return 'in_party'
  }
  return null
}

function gateRefusal(ctx: MarketContext, record: AccountRecord): MarketRefusal | null {
  if (!open(ctx)) return 'market_closed'
  if (!record.account.linked) return 'not_linked'
  return null
}

function matches(order: Order, item: Item): boolean {
  return (
    order.base === item.base &&
    atLeast(item.rarity, order.minRarity) &&
    (order.affixId === null || item.affixes.some((a) => a.id === order.affixId))
  )
}

async function finish(
  ctx: MarketContext,
  records: AccountRecord[],
  caller: AccountRecord,
): Promise<MarketResult> {
  for (const record of records) {
    await ctx.books.deliverReturns(record)
    await ctx.books.save(record)
  }
  return { ok: true, delivery: deliveryOf(caller) }
}

// ---------------------------------------------------------------------------
// Expiry

/** Closes listings and orders past `expiresAt`: goods go back as a cancel does, escrows are refunded. */
export async function expireDue(ctx: MarketContext): Promise<void> {
  for (const listing of await openListings(ctx)) {
    if (listing.expiresAt > ctx.now) continue
    const seller = await counterparty(ctx, listing.sellerId)
    await giveBack(ctx, seller, listing)
    await ctx.books.save(seller)
    await closeListing(ctx, listing.id)
  }
  for (const order of await openOrders(ctx)) {
    if (order.expiresAt > ctx.now) continue
    const buyer = await counterparty(ctx, order.buyerId)
    author(buyer, { t: 'order_refunded', orderId: order.id, escrow: order.maxPrice })
    await ctx.books.save(buyer)
    await closeOrder(ctx, order.id)
  }
}

/**
 * Closes every open listing and order of an account being deleted. Nothing goes back: the goods
 * and the escrow leave with the account, and no counterparty is touched.
 */
export async function closeAllOf(ctx: MarketContext, accountId: string): Promise<void> {
  for (const listing of await openListings(ctx)) {
    if (listing.sellerId === accountId) await closeListing(ctx, listing.id)
  }
  for (const order of await openOrders(ctx)) {
    if (order.buyerId === accountId) await closeOrder(ctx, order.id)
  }
}

// ---------------------------------------------------------------------------
// Reads

export async function browse(
  ctx: MarketContext,
  _record: AccountRecord,
  query: ListingQuery,
): Promise<ListingPage> {
  const rows = (await openListings(ctx)).filter((l) => {
    if (l.goods.kind !== query.kind) return false
    if (query.base !== undefined && goodsBase(l.goods) !== query.base) return false
    if (query.cls !== undefined && (l.goods.kind !== 'hero' || l.goods.hero.cls !== query.cls))
      return false
    if (query.minRarity !== undefined && !atLeast(goodsRarity(l.goods), query.minRarity))
      return false
    return true
  })
  const newest = (a: Listing, b: Listing) =>
    b.createdAt - a.createdAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)
  rows.sort(query.sort === 'price' ? (a, b) => a.price - b.price || newest(a, b) : newest)
  const start = query.page * LISTINGS_PER_PAGE
  return {
    listings: rows.slice(start, start + LISTINGS_PER_PAGE),
    page: query.page,
    total: rows.length,
  }
}

export async function myOrders(ctx: MarketContext, record: AccountRecord): Promise<MyOrders> {
  const id = record.account.accountId
  return {
    listings: (await openListings(ctx)).filter((l) => l.sellerId === id),
    orders: (await openOrders(ctx)).filter((o) => o.buyerId === id),
    returns: record.returns.length,
  }
}

export async function matchingOrders(
  ctx: MarketContext,
  record: AccountRecord,
  itemId: string,
): Promise<Order[]> {
  const item = record.state.inventory.find((i) => i.id === itemId)
  if (!item) return []
  return (await openOrders(ctx))
    .filter((o) => o.buyerId !== record.account.accountId && matches(o, item))
    .sort((a, b) => b.maxPrice - a.maxPrice || a.createdAt - b.createdAt)
}

// ---------------------------------------------------------------------------
// Listings

export async function list(
  ctx: MarketContext,
  record: AccountRecord,
  input: { kind: TradeKind; id: string; price: number },
): Promise<MarketResult> {
  const gate = gateRefusal(ctx, record)
  if (gate) return refuse(gate)
  const goods = owned(record.state, input.kind, input.id)
  const refusal = sellerRefusal(ctx, record.state, goods)
  if (refusal || !goods) return refuse(refusal ?? 'unknown_goods')
  if (!validPrice(input.price)) return refuse('bad_price')
  const fee = listingFee(input.price)
  if (record.state.gold < fee) return refuse('not_enough_gold')
  const id = await nextLedgerId(ctx.books.kv, 'L')
  author(record, { t: 'listed', listingId: id, kind: input.kind, id: input.id, fee })
  const listing: Listing = {
    id,
    sellerId: record.account.accountId,
    sellerName: publicName(record),
    goods,
    price: input.price,
    createdAt: ctx.now,
    expiresAt: ctx.now + EXPIRY_MS,
  }
  await ctx.books.kv.set(listingKey(id), listing)
  await ctx.books.kv.set(LISTINGS_KEY, [...(await ids(ctx, LISTINGS_KEY)), id])
  return finish(ctx, [record], record)
}

export async function cancelListing(
  ctx: MarketContext,
  record: AccountRecord,
  listingId: string,
): Promise<MarketResult> {
  const listing = await openListing(ctx, listingId)
  if (!listing) return refuse('gone')
  if (listing.sellerId !== record.account.accountId) return refuse('not_owner')
  await giveBack(ctx, record, listing)
  await closeListing(ctx, listing.id)
  return finish(ctx, [record], record)
}

export async function buy(
  ctx: MarketContext,
  record: AccountRecord,
  listingId: string,
): Promise<MarketResult> {
  const listing = await openListing(ctx, listingId)
  if (!listing) return refuse('gone')
  if (listing.sellerId === record.account.accountId) return refuse('self_trade')
  const gate = gateRefusal(ctx, record)
  if (gate) return refuse(gate)
  if (record.state.gold < listing.price) return refuse('not_enough_gold')
  if (!hasRoom(record.state, listing.goods)) return refuse('no_space')
  const seller = await counterparty(ctx, listing.sellerId)
  const goods = await transfer(
    listing.goods,
    ctx.now,
    () => nextLedgerId(ctx.books.kv, 't'),
    record.state,
  )
  author(record, { t: 'bought', listingId, goods, price: listing.price })
  author(seller, {
    t: 'sold',
    listingId,
    kind: listing.goods.kind,
    base: goodsBase(listing.goods),
    rarity: goodsRarity(listing.goods),
    price: listing.price,
    net: saleNet(listing.price),
  })
  await closeListing(ctx, listing.id)
  return finish(ctx, [record, seller], record)
}

// ---------------------------------------------------------------------------
// Buy orders

export async function placeOrder(
  ctx: MarketContext,
  record: AccountRecord,
  input: NewOrder,
): Promise<MarketResult> {
  const gate = gateRefusal(ctx, record)
  if (gate) return refuse(gate)
  if (!validPrice(input.maxPrice)) return refuse('bad_price')
  if (!tradeableRarity(input.minRarity)) return refuse('not_tradeable_rarity')
  // Own keys only: a name off the prototype (`constructor`, `toString`) is no base and no affix.
  if (!Object.hasOwn(content.itemBases, input.base)) return refuse('unknown_goods')
  if (input.affixId !== null && !Object.hasOwn(content.affixes, input.affixId)) {
    return refuse('unknown_goods')
  }
  if (record.state.gold < input.maxPrice) return refuse('not_enough_gold')
  const id = await nextLedgerId(ctx.books.kv, 'O')
  author(record, { t: 'order_placed', orderId: id, escrow: input.maxPrice })
  const order: Order = {
    id,
    buyerId: record.account.accountId,
    base: input.base,
    minRarity: input.minRarity,
    affixId: input.affixId,
    maxPrice: input.maxPrice,
    createdAt: ctx.now,
    expiresAt: ctx.now + EXPIRY_MS,
  }
  await ctx.books.kv.set(orderKey(id), order)
  await ctx.books.kv.set(ORDERS_KEY, [...(await ids(ctx, ORDERS_KEY)), id])
  return finish(ctx, [record], record)
}

export async function cancelOrder(
  ctx: MarketContext,
  record: AccountRecord,
  orderId: string,
): Promise<MarketResult> {
  const order = await openOrder(ctx, orderId)
  if (!order) return refuse('gone')
  if (order.buyerId !== record.account.accountId) return refuse('not_owner')
  author(record, { t: 'order_refunded', orderId, escrow: order.maxPrice })
  await closeOrder(ctx, orderId)
  return finish(ctx, [record], record)
}

export async function fillOrder(
  ctx: MarketContext,
  record: AccountRecord,
  orderId: string,
  itemId: string,
): Promise<MarketResult> {
  const order = await openOrder(ctx, orderId)
  if (!order) return refuse('gone')
  const gate = gateRefusal(ctx, record)
  if (gate) return refuse(gate)
  const goods = owned(record.state, 'item', itemId)
  const refusal = sellerRefusal(ctx, record.state, goods)
  if (refusal || goods?.kind !== 'item') return refuse(refusal ?? 'unknown_goods')
  if (order.buyerId === record.account.accountId) return refuse('self_trade')
  if (!matches(order, goods.item)) return refuse('no_match')
  const buyer = await counterparty(ctx, order.buyerId)
  if (!hasRoom(buyer.state, goods)) return refuse('buyer_full')
  const moved = await transfer(goods, ctx.now, () => nextLedgerId(ctx.books.kv, 't'), buyer.state)
  if (moved.kind !== 'item') throw new Error('market: an order fill moved a hero')
  author(record, {
    t: 'order_sold',
    orderId,
    itemId,
    base: goods.item.base,
    rarity: goods.item.rarity,
    price: order.maxPrice,
    net: saleNet(order.maxPrice),
  })
  author(buyer, { t: 'order_filled', orderId, item: moved.item, price: order.maxPrice })
  await closeOrder(ctx, orderId)
  return finish(ctx, [record, buyer], record)
}
