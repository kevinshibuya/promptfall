import {
  BOSS_BASE_HP,
  BOSS_GRID_MS,
  BOSS_THRESHOLD_BP,
  BOSS_TOP_BONUS,
  BOSS_WINDOW_MS,
  type BossView,
  type KeyValue,
  weekStartOf,
} from '@promptfall/protocol'
import {
  content,
  type GameState,
  type Goods,
  type HeroClass,
  rollRewardItem,
  type Stats,
} from '@promptfall/sim'
import { type AccountRecord, author, hasRoom, isCurrent, publicName } from './books'
import { WORLD_BOSSES } from './boss-config'
import { nextLedgerId } from './ids'
import { BOARDS_KEY, type StoredBoards, type WorldContext } from './world'

export const BOSS_KEY = 'pf:world:boss'

/** The live (or last) world boss. `contributions` keys are the engaged accounts. */
export type BossRecord = {
  bossId: string
  name: string
  glyph: string
  spawnedAt: number
  endsAt: number
  maxHp: number
  hp: number
  contributions: Record<string, number>
  /** Set once rewards and disengages are authored; stays stored until the next spawn replaces it. */
  closed: boolean
}

/** Zone 1's zone boss stats, carried verbatim: the sim scales them to each party's zone. */
function bossStats(): Stats {
  const stats = content.enemies[content.zones[0]?.boss ?? '']?.stats
  if (!stats) throw new Error('content has no zone 1 boss')
  return { ...stats }
}

export async function loadBoss(kv: KeyValue): Promise<BossRecord | null> {
  const raw = (await kv.get(BOSS_KEY)) as BossRecord | undefined
  return raw ?? null
}

async function saveBoss(kv: KeyValue, boss: BossRecord): Promise<void> {
  await kv.set(BOSS_KEY, boss)
}

/** What a poll shows: the stored boss until `endsAt`, closed or not; null after, or with the flag off. */
export function toBossView(
  ctx: WorldContext,
  boss: BossRecord | null,
  accountId: string,
): BossView | null {
  if (!boss || ctx.flags['worldboss.enabled'] === false || ctx.now >= boss.endsAt) return null
  const { bossId, name, glyph, maxHp, hp, spawnedAt, endsAt } = boss
  return {
    bossId,
    name,
    glyph,
    maxHp,
    hp,
    spawnedAt,
    endsAt,
    yours: boss.contributions[accountId] ?? 0,
  }
}

/** True when this boss still takes engagements and damage. */
export function isLive(ctx: WorldContext, boss: BossRecord): boolean {
  return !boss.closed && boss.hp > 0 && ctx.now < boss.endsAt
}

/**
 * Puts a current record in boss mode for this boss: a stale engagement is
 * disengaged first. Checks the sim's preconditions so `author` never throws.
 */
export function engage(record: AccountRecord, boss: BossRecord): void {
  if (!isCurrent(record)) return
  const engaged = record.state.boss
  if (engaged?.bossId !== boss.bossId) {
    if (engaged) author(record, { t: 'boss_disengaged', bossId: engaged.bossId })
    author(record, {
      t: 'boss_engaged',
      bossId: boss.bossId,
      name: boss.name,
      glyph: boss.glyph,
      stats: bossStats(),
    })
  }
  boss.contributions[record.account.accountId] ??= 0
}

/** Leaves boss mode when the record is in it for this boss; otherwise skips and logs. */
export function disengage(ctx: WorldContext, record: AccountRecord, bossId: string): void {
  if (record.state.boss?.bossId === bossId) {
    author(record, { t: 'boss_disengaged', bossId })
    return
  }
  ctx.log(`boss ${bossId}: ${record.account.accountId} was not engaged, nothing to disengage`)
}

function partyClasses(state: GameState): HeroClass[] {
  const classes: HeroClass[] = []
  for (const id of state.party) {
    const hero = state.roster.find((h) => h.id === id)
    if (hero) classes.push(hero.cls)
  }
  return classes
}

/** The sim's valuation of a boss contract vendored into a full roster, reused for an item of the rarity. */
function rewardGold(rarity: keyof typeof content.rarity, zone: number): number {
  return 3 * content.rarity[rarity].vendorGoldPerZone * zone
}

/**
 * Pays every contributor and disengages them, then closes the boss. The
 * threshold gates the guaranteed drop (`allPaid`, the sandbox's settle, lifts
 * it for every engaged account); the top contributors of a killed boss get one
 * bonus roll each, with no threshold. Skips rather than throws, so `closed` is
 * always written.
 */
export async function settleBoss(
  ctx: WorldContext,
  boss: BossRecord,
  options: { expired: boolean; inHand: AccountRecord | null; allPaid?: boolean },
): Promise<void> {
  const kv = ctx.books.kv
  const threshold = Math.floor((BOSS_BASE_HP * BOSS_THRESHOLD_BP) / 10000)
  const top = Object.entries(boss.contributions)
    .filter(([, value]) => value > 0)
    .sort(([a, x], [b, y]) => y - x || (a < b ? -1 : a > b ? 1 : 0))
    .slice(0, BOSS_TOP_BONUS)
    .map(([id]) => id)
  for (const [id, contribution] of Object.entries(boss.contributions)) {
    const record =
      options.inHand?.account.accountId === id ? options.inHand : await ctx.books.load(id)
    if (!record || !isCurrent(record)) continue
    const rolls =
      (options.allPaid || contribution >= threshold ? 1 : 0) +
      (!options.expired && top.includes(id) ? 1 : 0)
    for (let i = 0; i < rolls; i++) {
      const zone = record.state.zone
      const rolled = rollRewardItem(ctx.seedSource() >>> 0, zone, partyClasses(record.state))
      if (!rolled) {
        author(record, {
          t: 'rewarded',
          bossId: boss.bossId,
          goods: null,
          gold: rewardGold('rare', zone),
        })
        continue
      }
      const item = { ...rolled, id: await nextLedgerId(kv, 'r') }
      const goods: Goods = { kind: 'item', item }
      const gold = rewardGold(item.rarity, zone)
      if (hasRoom(record.state, goods)) {
        author(record, { t: 'rewarded', bossId: boss.bossId, goods, gold })
      } else {
        // No free slot: the item waits in returns and arrives as `returned` when one frees.
        record.returns.push({ listingId: boss.bossId, goods })
        author(record, { t: 'rewarded', bossId: boss.bossId, goods: null, gold })
      }
    }
    await ctx.books.syncReturnsQueue(record)
    disengage(ctx, record, boss.bossId)
    await ctx.books.save(record)
  }
  boss.closed = true
  await saveBoss(kv, boss)
}

/** Settles an open boss whose window passed, or whose flag went off, as expired. */
async function settleIfOver(ctx: WorldContext, stored: BossRecord | null): Promise<void> {
  const on = ctx.flags['worldboss.enabled'] !== false
  if (stored && !stored.closed && (ctx.now >= stored.endsAt || !on)) {
    await settleBoss(ctx, stored, { expired: true, inHand: null })
  }
}

/** A new boss record whose window starts at `spawnAt`, sized by who is online, at least one. */
function newBoss(bossId: string, spawnAt: number, online: string[]): BossRecord {
  const gridIndex = Math.floor(spawnAt / BOSS_GRID_MS)
  const def = WORLD_BOSSES[gridIndex % WORLD_BOSSES.length] ?? { name: 'World Boss', glyph: '☠' }
  const hp = BOSS_BASE_HP * Math.max(1, online.length)
  return {
    bossId,
    name: def.name,
    glyph: def.glyph,
    spawnedAt: spawnAt,
    endsAt: spawnAt + BOSS_WINDOW_MS,
    maxHp: hp,
    hp,
    contributions: {},
    closed: false,
  }
}

function onlineIds(ctx: WorldContext): string[] {
  return [...ctx.presence.entries()]
    .filter(([, entry]) => ctx.now - entry.at < ctx.ttl)
    .map(([id]) => id)
}

/** Engages the online accounts with a new boss, then stores it in place of the last one. */
async function openBoss(ctx: WorldContext, boss: BossRecord, online: string[]): Promise<void> {
  for (const id of online) {
    const record = await ctx.books.load(id)
    if (!record) continue
    engage(record, boss)
    await ctx.books.save(record)
  }
  await saveBoss(ctx.books.kv, boss)
}

/**
 * Settles an open boss whose window passed (or whose flag went off), then
 * spawns this grid point's boss if its window is open and no stored boss is
 * still showing. Runs first in the world poll and the sweep, before any
 * record loads.
 */
export async function advanceBoss(ctx: WorldContext): Promise<void> {
  const stored = await loadBoss(ctx.books.kv)
  await settleIfOver(ctx, stored)
  const gridIndex = Math.floor(ctx.now / BOSS_GRID_MS)
  const spawnAt = gridIndex * BOSS_GRID_MS
  if (ctx.flags['worldboss.enabled'] === false || ctx.now >= spawnAt + BOSS_WINDOW_MS) return
  // The stored boss shows until its `endsAt`, settled or not, so a poller sees it go down;
  // the grid waits for it. A grid point's own boss ends with its window, so a served point
  // never spawns again, even after a sandbox boss replaced it.
  if (stored && ctx.now < stored.endsAt) return
  const online = onlineIds(ctx)
  await openBoss(ctx, newBoss(`wb${gridIndex.toString(36)}`, spawnAt, online), online)
}

/** The sandbox's spawn: a boss whose window starts now, off the grid. False while one is open. */
export async function spawnNow(ctx: WorldContext): Promise<boolean> {
  const stored = await loadBoss(ctx.books.kv)
  await settleIfOver(ctx, stored)
  if (stored && !stored.closed) return false
  const online = onlineIds(ctx)
  const bossId = await nextLedgerId(ctx.books.kv, 'sb')
  await openBoss(ctx, newBoss(bossId, ctx.now, online), online)
  return true
}

/**
 * The sandbox's settle: the open boss ends now as if its window had passed,
 * every engaged account paid, and shows at zero HP until its `endsAt`. False
 * with none open.
 */
export async function settleNow(ctx: WorldContext): Promise<boolean> {
  const stored = await loadBoss(ctx.books.kv)
  if (!stored || stored.closed) return false
  stored.hp = 0
  await settleBoss(ctx, stored, { expired: true, inHand: null, allPaid: true })
  return true
}

/** What the replayed batch dealt to the stored boss before the commit; null when it counts for nothing. */
export function dealtBefore(before: GameState, after: GameState): number | null {
  if (!before.boss || !after.boss || before.boss.bossId !== after.boss.bossId) return null
  return before.boss.dealt
}

/**
 * A committed batch's contribution: the `dealt` delta goes to the boss's HP,
 * the account's tally and the weekly board, whole, past the remaining HP too.
 * The killing commit settles the boss with this record in hand.
 */
export async function contribute(
  ctx: WorldContext,
  record: AccountRecord,
  prevDealt: number | null,
): Promise<void> {
  const next = record.state.boss
  if (prevDealt === null || !next) return
  const kv = ctx.books.kv
  const boss = await loadBoss(kv)
  // The flag turned off is the window closing, as in advanceBoss, even before a poll settles it.
  if (ctx.flags['worldboss.enabled'] === false) return
  if (!boss || boss.bossId !== next.bossId || !isLive(ctx, boss)) return
  const delta = next.dealt - prevDealt
  if (delta <= 0) return
  const id = record.account.accountId
  boss.hp = Math.max(0, boss.hp - delta)
  boss.contributions[id] = (boss.contributions[id] ?? 0) + delta
  const weekStart = weekStartOf(ctx.now)
  const boards = ((await kv.get(BOARDS_KEY)) as StoredBoards | undefined) ?? {
    zone: [],
    week: { start: weekStart, damage: {} },
  }
  const week = boards.week.start === weekStart ? boards.week : { start: weekStart, damage: {} }
  const value = (week.damage[id]?.value ?? 0) + delta
  await kv.set(BOARDS_KEY, {
    ...boards,
    week: {
      start: weekStart,
      damage: { ...week.damage, [id]: { name: publicName(record), value } },
    },
  } satisfies StoredBoards)
  if (boss.hp === 0) await settleBoss(ctx, boss, { expired: false, inHand: record })
  else await saveBoss(kv, boss)
}
