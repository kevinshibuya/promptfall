import type { Goods, HeroClass, Rarity, TradeKind } from '@promptfall/sim'
import { z } from 'zod'
import type { Delivery } from './client'
import {
  GoodsSchema,
  HeroClassSchema,
  RaritySchema,
  ServerEventSchema,
  TradeKindSchema,
} from './schemas'

export type Listing = {
  id: string
  sellerId: string
  sellerName: string
  goods: Goods
  price: number
  createdAt: number
  expiresAt: number
}

export type Order = {
  id: string
  buyerId: string
  base: string
  minRarity: Rarity
  affixId: string | null
  maxPrice: number
  createdAt: number
  expiresAt: number
}

export type ListingQuery = {
  kind: TradeKind
  base?: string
  cls?: HeroClass
  minRarity?: Rarity
  sort: 'price' | 'newest'
  /** 0-based, 10 per page. */
  page: number
}

export type ListingPage = { listings: Listing[]; page: number; total: number }

export type MarketRefusal =
  | 'market_closed'
  | 'not_linked'
  | 'unknown_goods'
  | 'not_tradeable_rarity'
  | 'in_cooldown'
  | 'in_party'
  | 'equipped'
  | 'bad_price'
  | 'not_enough_gold'
  | 'no_space'
  | 'buyer_full'
  | 'self_trade'
  | 'gone'
  | 'not_owner'
  | 'no_match'
  | 'unauthorized'

export type MarketResult =
  | { ok: true; delivery: Delivery }
  | { ok: false; reason: MarketRefusal }
  | ({ ok: false } & Banned)

export type NewOrder = { base: string; minRarity: Rarity; affixId: string | null; maxPrice: number }

export type MyOrders = { listings: Listing[]; orders: Order[]; returns: number }

export type Unauthorized = { reason: 'unauthorized' }

/** An account the operator banned: every authenticated call answers it, the reason in the message. */
export type Banned = { reason: 'banned'; message: string }

export const LISTINGS_PER_PAGE = 10

const id = z.string().min(1).max(64)
const count = z.number().int().nonnegative()
const price = z.number().int()

export const DeliverySchema: z.ZodType<Delivery> = z.object({
  cursor: count,
  events: z.array(z.object({ n: z.number().int().positive(), event: ServerEventSchema })),
})

export const ListingSchema: z.ZodType<Listing> = z.object({
  id,
  sellerId: z.string().min(1).max(128),
  sellerName: z.string().max(128),
  goods: GoodsSchema,
  price: count,
  createdAt: count,
  expiresAt: count,
})

export const OrderSchema: z.ZodType<Order> = z.object({
  id,
  buyerId: z.string().min(1).max(128),
  base: id,
  minRarity: RaritySchema,
  affixId: id.nullable(),
  maxPrice: count,
  createdAt: count,
  expiresAt: count,
})

// Optional fields: zod infers `x?: T | undefined`, which exactOptionalPropertyTypes
// will not assign to `x?: T`; the cast is sound because absent keys are dropped.
export const ListingQuerySchema = z
  .object({
    kind: TradeKindSchema,
    base: id.optional(),
    cls: HeroClassSchema.optional(),
    minRarity: RaritySchema.optional(),
    sort: z.enum(['price', 'newest']),
    page: z.number().int().nonnegative().max(100_000),
  })
  .strict() as unknown as z.ZodType<ListingQuery>

export const ListingPageSchema: z.ZodType<ListingPage> = z.object({
  listings: z.array(ListingSchema),
  page: count,
  total: count,
})

export const MARKET_REFUSALS = [
  'market_closed',
  'not_linked',
  'unknown_goods',
  'not_tradeable_rarity',
  'in_cooldown',
  'in_party',
  'equipped',
  'bad_price',
  'not_enough_gold',
  'no_space',
  'buyer_full',
  'self_trade',
  'gone',
  'not_owner',
  'no_match',
  'unauthorized',
] as const satisfies readonly MarketRefusal[]

export const BannedSchema: z.ZodType<Banned> = z.object({
  reason: z.literal('banned'),
  message: z.string().min(1).max(200),
})

/** A banned answer where refusals carry `ok: false`: batches, trades and chat. */
export const RefusedBannedSchema = z.object({
  ok: z.literal(false),
  reason: z.literal('banned'),
  message: z.string().min(1).max(200),
})

export const MarketResultSchema: z.ZodType<MarketResult> = z.union([
  z.object({ ok: z.literal(true), delivery: DeliverySchema }),
  z.object({ ok: z.literal(false), reason: z.enum(MARKET_REFUSALS) }),
  RefusedBannedSchema,
])

/** The price is checked by the ledger (`bad_price`), so the schema only wants an integer. */
export const NewOrderSchema: z.ZodType<NewOrder> = z.object({
  base: id,
  minRarity: RaritySchema,
  affixId: id.nullable(),
  maxPrice: price,
})

export const MyOrdersSchema: z.ZodType<MyOrders> = z.object({
  listings: z.array(ListingSchema),
  orders: z.array(OrderSchema),
  returns: count,
})

export const UnauthorizedSchema: z.ZodType<Unauthorized> = z.object({
  reason: z.literal('unauthorized'),
})

/** The body of `POST /v1/listings`. */
export const NewListingSchema = z.object({ kind: TradeKindSchema, id, price })
