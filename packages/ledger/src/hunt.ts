import {
  HUNT_THRESHOLD_BP,
  type HuntView,
  type KeyValue,
  WEEK_MS,
  weekStartOf,
} from '@promptfall/protocol'
import { type GameState, type HuntKind, huntAt, huntCount } from '@promptfall/sim'
import { type AccountRecord, isCurrent } from './books'
import { payReward } from './boss'
import type { WorldContext } from './world'

export const HUNT_KEY = 'pf:world:hunt'

/** This week's hunt (or last week's, until an advance closes it). `contributions` keys are the accounts that counted. */
export type HuntRecord = {
  huntId: string
  /** The table row's id. */
  row: string
  name: string
  kind: HuntKind
  target: number
  /** Monday 00:00 UTC on the server clock, the damage board's week. */
  weekStart: number
  endsAt: number
  count: number
  contributions: Record<string, number>
  /** Set once the contributors are paid; the next week's record replaces it in the same advance. */
  closed: boolean
}

const huntOn = (ctx: WorldContext) => ctx.flags['hunt.enabled'] !== false

export async function loadHunt(kv: KeyValue): Promise<HuntRecord | null> {
  const raw = (await kv.get(HUNT_KEY)) as HuntRecord | undefined
  return raw ?? null
}

/** The record of the week starting at `weekStart`, from the table, nobody counted yet. */
function newHunt(weekStart: number): HuntRecord {
  const week = Math.floor(weekStart / WEEK_MS)
  const row = huntAt(week)
  return {
    huntId: `h${week.toString(36)}`,
    row: row.id,
    name: row.name,
    kind: row.kind,
    target: row.target,
    weekStart,
    endsAt: weekStart + WEEK_MS,
    count: 0,
    contributions: {},
    closed: false,
  }
}

/** What a poll shows: the stored hunt until its end; null after, with none, or with the flag off. */
export function toHuntView(
  ctx: WorldContext,
  hunt: HuntRecord | null,
  accountId: string,
): HuntView | null {
  if (!hunt || !huntOn(ctx) || hunt.closed || ctx.now >= hunt.endsAt) return null
  const { name, target, count, endsAt } = hunt
  return { name, target, count, endsAt, yours: hunt.contributions[accountId] ?? 0 }
}

/**
 * Pays each contributor at or above the threshold of the target one reward at its zone, whether
 * or not the count reached the target, then closes the record. Skips rather than throws, so
 * `closed` is always written.
 */
async function closeHunt(ctx: WorldContext, hunt: HuntRecord): Promise<void> {
  for (const [id, contribution] of Object.entries(hunt.contributions)) {
    if (contribution * 10_000 < hunt.target * HUNT_THRESHOLD_BP) continue
    const record = await ctx.books.load(id)
    if (!record || !isCurrent(record)) continue
    await payReward(ctx, record, hunt.huntId, 'hunt')
    await ctx.books.syncReturnsQueue(record)
    await ctx.books.save(record)
  }
  hunt.closed = true
  await ctx.books.kv.set(HUNT_KEY, hunt)
}

/**
 * Closes a stored hunt whose week has ended, then opens this week's when none is stored for it.
 * Runs beside the boss's advance, in the world poll and the sweep; nothing with the flag off.
 */
export async function advanceHunt(ctx: WorldContext): Promise<void> {
  if (!huntOn(ctx)) return
  const stored = await loadHunt(ctx.books.kv)
  if (stored && !stored.closed && ctx.now >= stored.endsAt) await closeHunt(ctx, stored)
  const weekStart = weekStartOf(ctx.now)
  if (stored && stored.weekStart === weekStart) return
  await ctx.books.kv.set(HUNT_KEY, newHunt(weekStart))
}

/**
 * A commit's part: the record's count for the hunt's kind less what it was before the batch, added
 * to the count and the account's contribution. Bots count nothing, and nothing counts with the
 * flag off or outside the stored week.
 */
export async function countHunt(
  ctx: WorldContext,
  record: AccountRecord,
  before: GameState,
): Promise<void> {
  if (record.bot || !huntOn(ctx)) return
  const hunt = await loadHunt(ctx.books.kv)
  if (!hunt || hunt.closed || ctx.now < hunt.weekStart || ctx.now >= hunt.endsAt) return
  const delta = huntCount(hunt.kind, record.state) - huntCount(hunt.kind, before)
  if (delta <= 0) return
  const id = record.account.accountId
  hunt.count += delta
  hunt.contributions[id] = (hunt.contributions[id] ?? 0) + delta
  await ctx.books.kv.set(HUNT_KEY, hunt)
}
