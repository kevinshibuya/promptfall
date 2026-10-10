import { z } from 'zod'
import type {
  Account,
  AccountInfo,
  BatchAck,
  Bootstrap,
  BootstrapRefused,
  LinkPoll,
  LinkRefused,
  LinkStart,
  ServerConfig,
} from './client'
import {
  DeliverySchema,
  type ListingPage,
  ListingPageSchema,
  MarketResultSchema,
  type MyOrders,
  MyOrdersSchema,
  type Order,
  OrderSchema,
  type Unauthorized,
  UnauthorizedSchema,
} from './market'
import { GameStateSchema, HEX16, PlayerEventKindSchema } from './schemas'
import {
  type Boards,
  BoardsSchema,
  ChatResultSchema,
  type WorldSnapshot,
  WorldSnapshotSchema,
} from './world'

// Every response body, as the HTTP fake sends it and HttpClient checks it.

const count = z.number().int().nonnegative()

export const AccountSchema: z.ZodType<Account> = z.object({
  accountId: z.string().min(1).max(128),
  seed: count,
  createdAt: count,
  displayName: z.string().max(128).nullable(),
  linked: z.object({ provider: z.literal('github'), login: z.string().min(1).max(64) }).nullable(),
})

export const ServerConfigSchema: z.ZodType<ServerConfig> = z.object({
  minClientVersion: z.string(),
  simVersion: count,
  flags: z.record(z.boolean()),
  serverNow: count,
  speed: z.number().positive(),
})

export const BootstrapSchema: z.ZodType<Bootstrap> = z.object({
  deviceToken: z.string().min(1).max(128),
  account: AccountSchema,
  config: ServerConfigSchema,
  state: GameStateSchema,
  seq: count,
  hash: HEX16,
  cursor: count,
  delivery: DeliverySchema,
})

export const BootstrapRefusedSchema: z.ZodType<BootstrapRefused> = z.object({
  refusal: z.enum(['rate_limited', 'banned']),
  message: z.string().min(1).max(200),
})

export const BootstrapResponseSchema = z.union([BootstrapRefusedSchema, BootstrapSchema])

const adopt = {
  ok: z.literal(false),
  seq: count,
  state: GameStateSchema,
  hash: HEX16,
  cursor: count,
}

export const BatchAckSchema: z.ZodType<BatchAck> = z.union([
  z.object({
    ok: z.literal(true),
    seq: count,
    hash: HEX16,
    duplicate: z.boolean(),
    delivery: DeliverySchema,
  }),
  z.object({ ok: z.literal(false), reason: z.literal('unauthorized') }),
  z.object({
    ok: z.literal(false),
    reason: z.literal('version_gate'),
    minClientVersion: z.string(),
  }),
  z.object({ ok: z.literal(false), reason: z.literal('sim_version'), simVersion: count }),
  z.object({ ok: z.literal(false), reason: z.literal('cursor_behind'), delivery: DeliverySchema }),
  z.object({ ...adopt, reason: z.enum(['seq_mismatch', 'cursor_mismatch']) }),
  z.object({ ...adopt, reason: z.literal('hash_mismatch'), revokedItemIds: z.array(z.string()) }),
  z.object({ ...adopt, reason: z.literal('rate_capped'), kind: PlayerEventKindSchema }),
])

function orUnauthorized<T>(schema: z.ZodType<T>): z.ZodType<T | Unauthorized> {
  return z.union([UnauthorizedSchema, schema])
}

export const AccountInfoSchema: z.ZodType<AccountInfo> = z.object({
  account: AccountSchema,
  returns: count,
  config: ServerConfigSchema,
  delivery: DeliverySchema,
})

export const LinkStartSchema: z.ZodType<LinkStart> = z.object({
  code: z.string().min(1).max(32),
  url: z.string().min(1),
  intervalMs: count,
})

export const LinkRefusedSchema: z.ZodType<LinkRefused> = z.object({
  refusal: z.literal('link_unavailable'),
  message: z.string().min(1).max(200),
})

export const LinkPollSchema: z.ZodType<LinkPoll> = z.union([
  z.object({ status: z.literal('pending') }),
  z.object({ status: z.literal('linked'), account: AccountSchema }),
  z.object({
    status: z.literal('ended'),
    reason: z.enum(['denied', 'expired', 'unavailable']),
    message: z.string().min(1).max(200),
  }),
])

export const HealthSchema = z.object({
  ok: z.literal(true),
  simVersion: count,
  seed: count,
  speed: z.number().positive(),
  now: count,
})
export type Health = z.infer<typeof HealthSchema>

export const AccountResponseSchema = orUnauthorized(AccountInfoSchema)
export const LinkStartResponseSchema = orUnauthorized(z.union([LinkRefusedSchema, LinkStartSchema]))
export const LinkPollResponseSchema = orUnauthorized(LinkPollSchema)
export const ListingPageResponseSchema: z.ZodType<ListingPage | Unauthorized> =
  orUnauthorized(ListingPageSchema)
export const MyOrdersResponseSchema: z.ZodType<MyOrders | Unauthorized> =
  orUnauthorized(MyOrdersSchema)
export const MatchingOrdersResponseSchema: z.ZodType<Order[] | Unauthorized> = orUnauthorized(
  z.array(OrderSchema),
)
export const WorldResponseSchema: z.ZodType<WorldSnapshot | Unauthorized> =
  orUnauthorized(WorldSnapshotSchema)
export const BoardsResponseSchema: z.ZodType<Boards | Unauthorized> = orUnauthorized(BoardsSchema)
export { ChatResultSchema, MarketResultSchema }

/** The error bodies of non-200 answers. */
export const ErrorBodySchema = z.union([
  z.object({ error: z.literal('schema'), issues: z.array(z.unknown()) }),
  z.object({ error: z.literal('route') }),
  z.object({ error: z.literal('internal') }),
])
