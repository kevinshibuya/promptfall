import type { GameView } from '../types'
import { formatCount } from './ui/format'
import type { KeyValue } from './vendor/protocol.js'
import { DAY_MS } from './vendor/protocol.js'
import { type DailyGoal, dailyGoal } from './vendor/sim.js'
import { zonePhrase } from './zone-words'

// The session summary: what the party did in the play since the last session on this machine,
// said once when a session becomes primary. Two records per server setting, beside the shown
// cursor and under the store's prefix, so a reset wipes them: the snapshot of the counts the line
// is a difference from, and the stamp of when the account was last seen playing. Each carries its
// account id; another account's reads as none.

/** A stamp this old or younger is a break, not a return: nothing is said and the snapshot stays. */
export const SUMMARY_GAP_MS = 10 * 60_000
/** How often a primary refreshes the stamp. */
export const STAMP_MS = 5 * 60_000
/** How long the line holds the message window, as the welcome does. */
export const SUMMARY_MS = 20_000

/** The counts a summary is a difference from, taken when a session becomes primary. */
export type SummarySnapshot = {
  account: string
  kills: number
  zoneBosses: number
  /** The sum of the roster's levels. */
  levels: number
  drops: { rare: number; epic: number; legendary: number }
  goldEarned: number
  highestZone: number
}

export const snapshotKey = (tokenKey: string) => `${tokenKey}:snapshot`
export const stampKey = (tokenKey: string) => `${tokenKey}:stamp`

export function snapshotOf(view: GameView, account: string): SummarySnapshot {
  const { drops } = view.tallies
  return {
    account,
    kills: view.kills,
    zoneBosses: view.tallies.zoneBosses,
    levels: view.roster.reduce((sum, hero) => sum + hero.level, 0),
    drops: { rare: drops.rare, epic: drops.epic, legendary: drops.legendary },
    goldEarned: view.tallies.goldEarned,
    highestZone: view.highestZone,
  }
}

const isCount = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)

/** The stored snapshot if it is `account`'s and whole, else null. */
export function snapshotFor(stored: unknown, account: string): SummarySnapshot | null {
  if (typeof stored !== 'object' || stored === null) return null
  const s = stored as Partial<SummarySnapshot>
  if (s.account !== account || typeof s.drops !== 'object' || s.drops === null) return null
  const counts = [s.kills, s.zoneBosses, s.levels, s.goldEarned, s.highestZone]
  const drops = [s.drops.rare, s.drops.epic, s.drops.legendary]
  return [...counts, ...drops].every(isCount) ? (s as SummarySnapshot) : null
}

/** The stamp's time if it is `account`'s, else null. */
export function stampFor(stored: unknown, account: string): number | null {
  if (typeof stored !== 'object' || stored === null) return null
  const { account: of, at } = stored as { account?: unknown; at?: unknown }
  return of === account && isCount(at) ? at : null
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** "Since Tuesday", the stamp's local weekday, from a day up; "Since your last session" under it. */
export function sinceWords(stampAt: number, now: number): string {
  if (now - stampAt < DAY_MS) return 'Since your last session'
  return `Since ${WEEKDAYS[new Date(stampAt).getDay()]}`
}

const counted = (n: number, one: string, many: string) =>
  `${formatCount(n)} ${n === 1 ? one : many}`

/** The day's goal as the thing to do: "kill 40 enemies". */
export function goalWords(goal: DailyGoal): string {
  const n = goal.target
  switch (goal.kind) {
    case 'kills':
      return `kill ${counted(n, 'enemy', 'enemies')}`
    case 'zone_bosses':
      return `beat ${counted(n, 'zone boss', 'zone bosses')}`
    case 'rare_drops':
      return `see ${counted(n, 'Rare or better drop', 'Rare or better drops')}`
    case 'turn_boss':
      return n === 1 ? 'beat one turn boss' : `beat ${counted(n, 'turn boss', 'turn bosses')}`
  }
}

/** The parts of the line: each a difference from the snapshot, those at zero left out. */
function parts(snapshot: SummarySnapshot, view: GameView): string[] {
  const now = snapshotOf(view, snapshot.account)
  const gained = (n: number, was: number) => Math.max(0, n - was)
  const out: string[] = []
  const add = (n: number, one: string, many: string) => {
    if (n > 0) out.push(counted(n, one, many))
  }
  add(gained(now.kills, snapshot.kills), 'kill', 'kills')
  add(gained(now.zoneBosses, snapshot.zoneBosses), 'boss', 'bosses')
  // A dismiss takes levels away: the line never says fewer.
  add(gained(now.levels, snapshot.levels), 'level', 'levels')
  add(gained(now.drops.legendary, snapshot.drops.legendary), 'Legendary', 'Legendaries')
  add(gained(now.drops.epic, snapshot.drops.epic), 'Epic', 'Epics')
  add(gained(now.drops.rare, snapshot.drops.rare), 'Rare', 'Rares')
  const gold = gained(now.goldEarned, snapshot.goldEarned)
  if (gold > 0) out.push(`${formatCount(gold)} gold`)
  if (now.highestZone > snapshot.highestZone) out.push(`${zonePhrase(now.highestZone)} reached`)
  return out
}

/**
 * "Since Tuesday: 412 kills, 3 bosses, … Today's goal: kill 40 enemies.", or null when every part
 * is zero. The goal is the daily goal at `day` and the view's zone, as the Journal shows it before
 * its read answers.
 */
export function summaryLine(
  snapshot: SummarySnapshot,
  view: GameView,
  stampAt: number,
  now: number,
  day: number,
): string | null {
  const said = parts(snapshot, view)
  if (said.length === 0) return null
  const goal = goalWords(dailyGoal(day, snapshot.account, view.zone))
  return `${sinceWords(stampAt, now)}: ${said.join(', ')}. Today's goal: ${goal}.`
}

/** The two records of one server setting, read and written by the primary only. */
export class SummaryRecords {
  constructor(private readonly kv: KeyValue) {}

  /**
   * A session became primary on `account`: the line to raise, or null. A first launch and a stamp
   * of another account or none say nothing; a stamp more than SUMMARY_GAP_MS old says the line. In
   * both cases the snapshot is retaken, after the line; a younger stamp keeps it. The stamp is
   * refreshed either way.
   */
  async onPrimary(at: {
    tokenKey: string
    account: string
    view: GameView
    now: number
    day: number
    firstRun: boolean
  }): Promise<string | null> {
    const { tokenKey, account, view, now } = at
    const stamp = at.firstRun ? null : stampFor(await this.kv.get(stampKey(tokenKey)), account)
    if (stamp !== null && now - stamp <= SUMMARY_GAP_MS) {
      await this.stamp(tokenKey, account, now)
      return null
    }
    const snapshot =
      stamp === null ? null : snapshotFor(await this.kv.get(snapshotKey(tokenKey)), account)
    const line = snapshot && summaryLine(snapshot, view, stamp ?? now, now, at.day)
    await this.kv.set(snapshotKey(tokenKey), snapshotOf(view, account))
    await this.stamp(tokenKey, account, now)
    return line
  }

  /** The account was seen playing at `now`. */
  stamp(tokenKey: string, account: string, now: number): Promise<void> {
    return this.kv.set(stampKey(tokenKey), { account, at: now })
  }
}
