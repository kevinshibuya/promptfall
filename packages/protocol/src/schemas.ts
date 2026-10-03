import type {
  GameState,
  Goods,
  Hero,
  Item,
  PlayerEvent,
  Rarity,
  ServerEvent,
} from '@promptfall/sim'
import { z } from 'zod'

export const HEX16 = z.string().regex(/^[0-9a-f]{16}$/)

/** A player event with the client's timestamp. Server events never pass this schema. */
export type TimedEvent = PlayerEvent & { at: number }

const id = z.string().min(1).max(64)
const at = z.number().int().nonnegative()
const int = z.number().int()
const count = z.number().int().nonnegative()
const slot = z.enum(['weapon', 'armour', 'accessory'])

export const RaritySchema: z.ZodType<Rarity> = z.enum([
  'common',
  'uncommon',
  'rare',
  'epic',
  'legendary',
])
export const HeroClassSchema = z.enum(['knight', 'black_mage', 'white_mage', 'archer'])
export const TradeKindSchema = z.enum(['item', 'hero'])

const PlayerEventSchema = z.discriminatedUnion('t', [
  z.object({ t: z.literal('tick'), at }),
  z.object({ t: z.literal('tool_call'), at }),
  z.object({ t: z.literal('turn_end'), at }),
  z.object({ t: z.literal('rest'), at }),
  z.object({ t: z.literal('equip'), heroId: id, itemId: id, at }),
  z.object({ t: z.literal('unequip'), heroId: id, slot, at }),
  z.object({ t: z.literal('vendor'), itemId: id, at }),
  z.object({ t: z.literal('reforge'), itemId: id, affixIndex: int, at }),
  z.object({ t: z.literal('set_party'), heroIds: z.tuple([id, id, id]), at }),
  z.object({ t: z.literal('recruit'), at }),
  z.object({ t: z.literal('dismiss'), heroId: id, at }),
  z.object({ t: z.literal('set_farm'), on: z.boolean(), at }),
  z.object({ t: z.literal('expand_inventory'), at }),
  z.object({ t: z.literal('expand_roster'), at }),
])

export const TimedEventSchema: z.ZodType<TimedEvent> = PlayerEventSchema

export const PLAYER_EVENT_KINDS = [
  'tick',
  'tool_call',
  'turn_end',
  'rest',
  'equip',
  'unequip',
  'vendor',
  'reforge',
  'set_party',
  'recruit',
  'dismiss',
  'set_farm',
  'expand_inventory',
  'expand_roster',
] as const satisfies readonly PlayerEvent['t'][]
export const PlayerEventKindSchema = z.enum(PLAYER_EVENT_KINDS)

export const ItemSchema: z.ZodType<Item> = z.object({
  id,
  base: id,
  rarity: RaritySchema,
  affixes: z.array(z.object({ id, value: int })),
  equippedBy: id.nullable(),
  tradeableAt: count.nullable(),
})

export const HeroSchema: z.ZodType<Hero> = z.object({
  id,
  template: id,
  cls: HeroClassSchema,
  epithet: z.string(),
  rarity: RaritySchema,
  traits: z.array(z.object({ id, valueBp: int })),
  level: int,
  xp: count,
  hp: count,
  equipment: z.object({ weapon: id.nullable(), armour: id.nullable(), accessory: id.nullable() }),
  tradeableAt: count.nullable(),
})

export const GoodsSchema: z.ZodType<Goods> = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('item'), item: ItemSchema }),
  z.object({ kind: z.literal('hero'), hero: HeroSchema }),
])

export const ServerEventSchema: z.ZodType<ServerEvent> = z.discriminatedUnion('t', [
  z.object({
    t: z.literal('listed'),
    listingId: id,
    kind: TradeKindSchema,
    id,
    fee: count,
  }),
  z.object({ t: z.literal('returned'), listingId: id, goods: GoodsSchema }),
  z.object({
    t: z.literal('sold'),
    listingId: id,
    kind: TradeKindSchema,
    base: id,
    rarity: RaritySchema,
    price: count,
    net: count,
  }),
  z.object({ t: z.literal('bought'), listingId: id, goods: GoodsSchema, price: count }),
  z.object({ t: z.literal('order_placed'), orderId: id, escrow: count }),
  z.object({ t: z.literal('order_refunded'), orderId: id, escrow: count }),
  z.object({ t: z.literal('order_filled'), orderId: id, item: ItemSchema, price: count }),
  z.object({
    t: z.literal('order_sold'),
    orderId: id,
    itemId: id,
    base: id,
    rarity: RaritySchema,
    price: count,
    net: count,
  }),
  z.object({ t: z.literal('credited'), gold: count, reason: z.string().max(64) }),
])

/** Structural check of a sim state: the fields every version has; the rest passes through. */
export const GameStateSchema = z
  .object({
    v: count,
    seed: count,
    gold: count,
    inventory: z.array(z.unknown()),
    roster: z.array(z.unknown()),
  })
  .passthrough() as unknown as z.ZodType<GameState>

export type Batch = {
  batchId: string
  accountId: string
  seq: number
  clientVersion: string
  simVersion: number
  /** The last server event id the client applied; 0 for a fresh account. */
  cursor: number
  baseHash: string
  resultHash: string
  events: TimedEvent[]
}

const SEMVER = /^\d+\.\d+\.\d+$/

export const BatchSchema: z.ZodType<Batch> = z.object({
  batchId: z.string().min(16).max(64),
  accountId: z.string().min(1).max(128),
  seq: count,
  clientVersion: z.string().regex(SEMVER),
  simVersion: count,
  cursor: count,
  baseHash: HEX16,
  resultHash: HEX16,
  events: z.array(TimedEventSchema).min(1).max(2000),
})

export function compareSemver(a: string, b: string): -1 | 0 | 1 {
  const pa = a.split('.').map((n) => Number.parseInt(n, 10) || 0)
  const pb = b.split('.').map((n) => Number.parseInt(n, 10) || 0)
  for (let i = 0; i < 3; i++) {
    const x = pa[i] ?? 0
    const y = pb[i] ?? 0
    if (x < y) return -1
    if (x > y) return 1
  }
  return 0
}
