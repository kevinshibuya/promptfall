import {
  BOARD_ROWS,
  type BoardRow,
  type Boards,
  CHAT_BUCKET_CAPACITY,
  CHAT_KEEP,
  CHAT_MAX_CHARS,
  CHAT_REFILL_MS,
  CHAT_SERVE,
  type ChatMessage,
  type ChatResult,
  HERE_MAX,
  type KeyValue,
  type WorldSnapshot,
  weekStartOf,
} from '@promptfall/protocol'
import { isBlocked } from './blocklist'
import { type AccountRecord, type Books, isCurrent, publicName } from './books'
import { BOSS_KEY, engage, isLive, loadBoss, toBossView } from './boss'

/** Who polled, in the `Ledger` instance's memory only: never in the store. */
export type Presence = Map<string, { zone: number; name: string; at: number }>

export type WorldContext = {
  books: Books
  now: number
  flags: Record<string, boolean>
  presence: Presence
  /** Online means a heartbeat inside this many server-clock ms. */
  ttl: number
  speed: number
  /** Draws reward items. */
  seedSource: () => number
  log: (line: string) => void
}

export const CHAT_KEY = 'pf:chat'
export const BOARDS_KEY = 'pf:boards'

export type StoredChat = { nextId: number; messages: ChatMessage[] }
export type StoredBoards = {
  zone: BoardRow[]
  week: { start: number; damage: Record<string, { name: string; value: number }> }
}

type Bucket = { tokens: number; refillAt: number }

async function loadChat(kv: KeyValue): Promise<StoredChat> {
  const raw = (await kv.get(CHAT_KEY)) as StoredChat | undefined
  return raw ?? { nextId: 1, messages: [] }
}

async function loadBoards(kv: KeyValue, now: number): Promise<StoredBoards> {
  const raw = (await kv.get(BOARDS_KEY)) as StoredBoards | undefined
  return raw ?? { zone: [], week: { start: weekStartOf(now), damage: {} } }
}

// ---------------------------------------------------------------------------
// Presence

/** Drops entries past the TTL; what is left is online. */
function prune(ctx: WorldContext): void {
  for (const [id, entry] of ctx.presence) {
    if (!(ctx.now - entry.at < ctx.ttl)) ctx.presence.delete(id)
  }
}

/** The world poll: stamps the caller present and answers the snapshot. Writes nothing to the store. */
export async function world(
  ctx: WorldContext,
  record: AccountRecord,
  since: number,
): Promise<WorldSnapshot> {
  const presenceOn = ctx.flags['presence.enabled'] !== false
  const id = record.account.accountId
  prune(ctx)
  if (presenceOn && isCurrent(record)) {
    ctx.presence.set(id, { zone: record.state.zone, name: publicName(record), at: ctx.now })
  }
  let online = 0
  let zones: WorldSnapshot['zones'] = []
  let here: string[] = []
  if (presenceOn) {
    const counts = new Map<number, number>()
    for (const entry of ctx.presence.values()) {
      counts.set(entry.zone, (counts.get(entry.zone) ?? 0) + 1)
    }
    online = ctx.presence.size
    zones = [...counts.entries()]
      .sort(([a], [b]) => a - b)
      .map(([zone, count]) => ({ zone, count }))
    const mine = ctx.presence.get(id)
    if (mine) {
      here = [...ctx.presence.entries()]
        .filter(([other, entry]) => other !== id && entry.zone === mine.zone)
        .sort(([, a], [, b]) => b.at - a.at)
        .slice(0, HERE_MAX)
        .map(([, entry]) => entry.name)
    }
  }
  // The boss: an online, current account not engaged yet joins on its poll. With presence
  // off nobody is ever stamped, so the poll itself counts as being online.
  const boss = await loadBoss(ctx.books.kv)
  if (
    boss &&
    ctx.flags['worldboss.enabled'] !== false &&
    isLive(ctx, boss) &&
    (!presenceOn || ctx.presence.has(id)) &&
    isCurrent(record) &&
    !(id in boss.contributions)
  ) {
    engage(record, boss)
    await ctx.books.save(record)
    await ctx.books.kv.set(BOSS_KEY, boss)
  }
  let chat: ChatMessage[] = []
  if (ctx.flags['chat.enabled'] !== false) {
    const { messages } = await loadChat(ctx.books.kv)
    chat = since <= 0 ? messages.slice(-CHAT_SERVE) : messages.filter((m) => m.id > since)
  }
  return {
    serverNow: ctx.now,
    speed: ctx.speed,
    online,
    zones,
    here,
    boss: toBossView(ctx, boss, id),
    chat,
    flags: ctx.flags,
  }
}

// ---------------------------------------------------------------------------
// Chat

/**
 * The bucket refilled by whole periods, the remainder carried while it is
 * filling. A full bucket stores no credit: its clock restarts at `now`, so a
 * burst after a long idle is the capacity and no more. Absent means full.
 */
export function refillChat(bucket: Bucket | undefined, now: number): Bucket {
  if (!bucket) return { tokens: CHAT_BUCKET_CAPACITY, refillAt: now }
  const n = Math.floor(Math.max(0, now - bucket.refillAt) / CHAT_REFILL_MS)
  const tokens = Math.min(CHAT_BUCKET_CAPACITY, bucket.tokens + n)
  return {
    tokens,
    refillAt: tokens === CHAT_BUCKET_CAPACITY ? now : bucket.refillAt + n * CHAT_REFILL_MS,
  }
}

export async function chat(
  ctx: WorldContext,
  record: AccountRecord,
  text: string,
): Promise<ChatResult> {
  if (ctx.flags['chat.enabled'] === false) return { ok: false, reason: 'chat_closed' }
  if (!record.account.linked) return { ok: false, reason: 'not_linked' }
  // Control characters never reach a client's Text.
  const trimmed = text.replace(/\p{Cc}/gu, '').trim()
  if (trimmed === '') return { ok: false, reason: 'empty' }
  if (trimmed.length > CHAT_MAX_CHARS) return { ok: false, reason: 'too_long' }
  if (isBlocked(trimmed)) return { ok: false, reason: 'blocked' }
  const bucket = refillChat(record.chat, ctx.now)
  if (bucket.tokens < 1) return { ok: false, reason: 'rate_limited' }
  record.chat = { tokens: bucket.tokens - 1, refillAt: bucket.refillAt }
  const stored = await loadChat(ctx.books.kv)
  const message: ChatMessage = {
    id: stored.nextId,
    name: publicName(record),
    text: trimmed,
    at: ctx.now,
  }
  await ctx.books.save(record)
  await ctx.books.kv.set(CHAT_KEY, {
    nextId: stored.nextId + 1,
    messages: [...stored.messages, message].slice(-CHAT_KEEP),
  } satisfies StoredChat)
  return { ok: true, message }
}

// ---------------------------------------------------------------------------
// Leaderboards

/** A read: a later week answers the reset without writing it. */
export async function leaderboards(ctx: WorldContext): Promise<Boards> {
  const weekStart = weekStartOf(ctx.now)
  if (ctx.flags['leaderboards.enabled'] === false) {
    return { highestZone: [], damage: [], weekStart }
  }
  const boards = await loadBoards(ctx.books.kv, ctx.now)
  const damage =
    boards.week.start === weekStart
      ? Object.entries(boards.week.damage)
          .map(([accountId, { name, value }]) => ({ accountId, name, value }))
          .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name))
          .slice(0, BOARD_ROWS)
      : []
  return { highestZone: boards.zone, damage, weekStart }
}

/**
 * Offers a row to the highest-zone board: an account's row takes the new name
 * and the higher value; a new one goes in when there is room or it beats the
 * last row. Ties keep the earlier row first. Writes only on a change.
 */
export async function offerZone(kv: KeyValue, now: number, row: BoardRow): Promise<void> {
  const boards = await loadBoards(kv, now)
  const before = JSON.stringify(boards.zone)
  const rows = boards.zone.map((r) => ({ ...r }))
  const mine = rows.find((r) => r.accountId === row.accountId)
  if (mine) {
    mine.name = row.name
    mine.value = Math.max(mine.value, row.value)
  } else {
    const last = rows.at(-1)
    if (rows.length < BOARD_ROWS || (last && row.value > last.value)) rows.push({ ...row })
  }
  rows.sort((a, b) => b.value - a.value)
  const zone = rows.slice(0, BOARD_ROWS)
  if (JSON.stringify(zone) === before) return
  await kv.set(BOARDS_KEY, { ...boards, zone } satisfies StoredBoards)
}
