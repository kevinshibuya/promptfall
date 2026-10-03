import { z } from 'zod'

// World data: presence, the chat tail, the boards and the live boss. Never a server event, never sim state.

export type ChatMessage = { id: number; name: string; text: string; at: number }

export type ChatRefusal =
  | 'not_linked'
  | 'chat_closed'
  | 'empty'
  | 'too_long'
  | 'rate_limited'
  | 'blocked'
  | 'unauthorized'

export type ChatResult = { ok: true; message: ChatMessage } | { ok: false; reason: ChatRefusal }

export type BossView = {
  bossId: string
  name: string
  glyph: string
  maxHp: number
  /** 0 from the killing commit until `endsAt`, then the boss leaves the snapshot. */
  hp: number
  /** Server epoch ms. */
  spawnedAt: number
  endsAt: number
  /** The caller's tallied contribution. */
  yours: number
}

export type WorldSnapshot = {
  serverNow: number
  /** The server clock's rate, as `ServerConfig.speed`; a secondary never bootstraps. */
  speed: number
  online: number
  /** Ascending zone, counts above 0 only. */
  zones: { zone: number; count: number }[]
  /** Names in the caller's zone, caller excluded, at most `HERE_MAX`, most recent heartbeat first. */
  here: string[]
  boss: BossView | null
  /** Ascending id. */
  chat: ChatMessage[]
  /** The resolved flags, the same object as `ServerConfig.flags`. */
  flags: Record<string, boolean>
}

export type BoardRow = { accountId: string; name: string; value: number }

/** At most `BOARD_ROWS` rows each, value descending. */
export type Boards = { highestZone: BoardRow[]; damage: BoardRow[]; weekStart: number }

// Contract-visible numbers, imported by the ledger, the suite and the plugin.

/** Online means a heartbeat inside this many real ms. */
export const PRESENCE_TTL_MS = 45_000
export const HERE_MAX = 10
/** UTF-16 units after trimming, the unit `String.length` and Zod's `.max` count. */
export const CHAT_MAX_CHARS = 200
export const CHAT_BUCKET_CAPACITY = 5
export const CHAT_REFILL_MS = 10_000
export const CHAT_KEEP = 200
export const CHAT_SERVE = 50
export const BOARD_ROWS = 20

// The world boss (PR 2). The base is sized by measured sustained damage: see the phase 3 plan.

/** Bosses spawn on this grid of the server clock, from epoch zero. */
export const BOSS_GRID_MS = 10_800_000
/** A boss lives this long, or until dead. */
export const BOSS_WINDOW_MS = 1_200_000
/** HP per account online at the spawn. */
export const BOSS_BASE_HP = 4000
/** A contribution at or above this share of BOSS_BASE_HP, in basis points, earns the guaranteed drop. */
export const BOSS_THRESHOLD_BP = 500
/** The top contributors of a killed boss each get one bonus roll. */
export const BOSS_TOP_BONUS = 3

const DAY_MS = 86_400_000

/** Monday 00:00 UTC of the week holding `now` (day 0 was a Thursday). */
export function weekStartOf(now: number): number {
  const days = Math.floor(now / DAY_MS)
  return (days - ((days + 3) % 7)) * DAY_MS
}

const count = z.number().int().nonnegative()

export const ChatMessageSchema: z.ZodType<ChatMessage> = z.object({
  id: z.number().int().positive(),
  name: z.string().max(128),
  text: z.string().min(1).max(CHAT_MAX_CHARS),
  at: count,
})

export const ChatResultSchema: z.ZodType<ChatResult> = z.union([
  z.object({ ok: z.literal(true), message: ChatMessageSchema }),
  z.object({
    ok: z.literal(false),
    reason: z.enum([
      'not_linked',
      'chat_closed',
      'empty',
      'too_long',
      'rate_limited',
      'blocked',
      'unauthorized',
    ]),
  }),
])

export const ChatBodySchema = z.object({ text: z.string().max(2000) })

export const BossViewSchema: z.ZodType<BossView> = z.object({
  bossId: z.string().min(1).max(64),
  name: z.string().max(128),
  glyph: z.string().max(8),
  maxHp: count,
  hp: count,
  spawnedAt: count,
  endsAt: count,
  yours: count,
})

export const WorldSnapshotSchema: z.ZodType<WorldSnapshot> = z.object({
  serverNow: count,
  speed: z.number().positive(),
  online: count,
  zones: z.array(
    z.object({ zone: z.number().int().positive(), count: z.number().int().positive() }),
  ),
  here: z.array(z.string().max(128)).max(HERE_MAX),
  boss: BossViewSchema.nullable(),
  chat: z.array(ChatMessageSchema),
  flags: z.record(z.boolean()),
})

export const BoardRowSchema: z.ZodType<BoardRow> = z.object({
  accountId: z.string().min(1).max(128),
  name: z.string().max(128),
  value: count,
})

export const BoardsSchema: z.ZodType<Boards> = z.object({
  highestZone: z.array(BoardRowSchema).max(BOARD_ROWS),
  damage: z.array(BoardRowSchema).max(BOARD_ROWS),
  // An integer, not a count: the week holding the first days of the epoch began in 1969.
  weekStart: z.number().int(),
})
