import {
  DAY_MS,
  DEFAULT_REST_DAYS,
  dayOf,
  type Journal,
  type KeyValue,
  nextMonday,
  type RestDaysRefusal,
  type Weekday,
  weekdayOf,
} from '@promptfall/protocol'
import {
  achievementCount,
  content,
  type DailyGoal,
  dailyGoal,
  type GameState,
  type GoalKind,
  goalCount,
  goalGold,
} from '@promptfall/sim'
import { type AccountRecord, author } from './books'

/**
 * One account's journal, stored beside its record: what it has been paid for and its days. The
 * ledger writes it at each commit and on a rest-days write, never on a read.
 */
export type JournalRecord = {
  /** Per achievement id, the steps crossed (from 1) with the server time each was paid. */
  achievements: Record<string, { step: number; at: number }[]>
  /** Days a goal was met, rest days included. */
  goalsMet: number
  /** The day the last commit fell on: its goal, the zone it opened at, and the counts it opened with. */
  day: {
    index: number
    goal: DailyGoal
    zone: number
    baseline: Record<GoalKind, number>
    met: boolean
  } | null
  /** Work days met in a row, and the last work day met. */
  streak: { length: number; lastMet: number | null }
  /**
   * The rest-day sets, each from the day index it applies from, oldest first. A day is judged by
   * the set in force on it, so a change never reaches back. Pruned to what the streak still reads.
   */
  rest: { from: number; days: Weekday[] }[]
}

export const journalKey = (accountId: string) => `pf:acct:${accountId}:journal`

export function emptyJournal(): JournalRecord {
  return {
    achievements: {},
    goalsMet: 0,
    day: null,
    streak: { length: 0, lastMet: null },
    rest: [{ from: 0, days: [...DEFAULT_REST_DAYS] }],
  }
}

export async function loadJournal(kv: KeyValue, accountId: string): Promise<JournalRecord> {
  const raw = (await kv.get(journalKey(accountId))) as JournalRecord | undefined
  return raw ?? emptyJournal()
}

/** The rest days in force on a day. */
export function restDaysOn(journal: JournalRecord, day: number): Weekday[] {
  let days: Weekday[] = [...DEFAULT_REST_DAYS]
  for (const entry of journal.rest) if (entry.from <= day) days = entry.days
  return days
}

export function isWorkDay(journal: JournalRecord, day: number): boolean {
  return !restDaysOn(journal, day).includes(weekdayOf(day))
}

/**
 * Whether a work day after `lastMet` and before `today` went unmet. Two rest days a week leave a
 * work day in any seven, so a gap past eight days is a miss without looking.
 */
function missedSince(journal: JournalRecord, lastMet: number, today: number): boolean {
  if (today - lastMet > 8) return true
  for (let day = lastMet + 1; day < today; day++) if (isWorkDay(journal, day)) return true
  return false
}

/** The streak as of `today`: zero once a work day since the last met one went unmet. */
function streakOn(journal: JournalRecord, today: number): number {
  const { length, lastMet } = journal.streak
  return lastMet !== null && missedSince(journal, lastMet, today) ? 0 : length
}

function baselineOf(state: GameState): Record<GoalKind, number> {
  return {
    kills: goalCount('kills', state),
    zone_bosses: goalCount('zone_bosses', state),
    rare_drops: goalCount('rare_drops', state),
    turn_boss: goalCount('turn_boss', state),
  }
}

/** Drops the rest-day sets no day from the last met one (or today) on is judged by. */
function pruneRest(journal: JournalRecord, today: number): void {
  // A last met day past eight days back is a broken streak: no day before today is read again.
  const { lastMet } = journal.streak
  const pivot = lastMet !== null && today - lastMet <= 8 ? Math.min(lastMet, today) : today
  let keep = 0
  journal.rest.forEach((entry, i) => {
    if (entry.from <= pivot) keep = i
  })
  journal.rest = journal.rest.slice(keep)
}

/**
 * The commit hook, after the batch settles, on the committed state only: opens the day when it
 * changed, pays the goal on the commit that meets it and grows the streak, then pays each
 * achievement step newly crossed. Every payment is a `credited` event authored onto the record.
 */
export async function onCommit(kv: KeyValue, record: AccountRecord, now: number): Promise<void> {
  const accountId = record.account.accountId
  const state = record.committedState
  const journal = await loadJournal(kv, accountId)
  const today = dayOf(now)
  journal.streak.length = streakOn(journal, today)

  if (journal.day?.index !== today) {
    journal.day = {
      index: today,
      goal: dailyGoal(today, accountId, state.zone),
      zone: state.zone,
      baseline: baselineOf(state),
      met: false,
    }
  }
  const day = journal.day
  if (!day.met && progressOf(day, state) >= day.goal.target) {
    day.met = true
    journal.goalsMet += 1
    author(record, { t: 'credited', gold: goalGold(day.zone), reason: `goal:${today}` })
    // A rest day neither counts nor breaks: only a work day moves the streak.
    if (isWorkDay(journal, today)) {
      const { lastMet } = journal.streak
      const follows = lastMet !== null && lastMet < today && !missedSince(journal, lastMet, today)
      journal.streak = { length: follows ? journal.streak.length + 1 : 1, lastMet: today }
    }
  }

  const counts = { goalsMet: journal.goalsMet, streak: journal.streak.length }
  for (const row of content.achievements) {
    const value = achievementCount(row.reads, state, counts)
    const crossed = journal.achievements[row.id] ?? []
    row.steps.forEach((step, i) => {
      const n = i + 1
      if (value < step.at || crossed.some((c) => c.step === n)) return
      author(record, { t: 'credited', gold: step.gold, reason: `achievement:${row.id}:${n}` })
      crossed.push({ step: n, at: now })
    })
    if (crossed.length > 0) journal.achievements[row.id] = crossed
  }

  pruneRest(journal, today)
  await kv.set(journalKey(accountId), journal)
}

function progressOf(day: NonNullable<JournalRecord['day']>, state: GameState): number {
  return Math.max(0, goalCount(day.goal.kind, state) - day.baseline[day.goal.kind])
}

/**
 * The journal as the read answers it, from the committed state. Writes nothing: a day not opened
 * yet answers its goal at progress 0, and a streak broken since the last commit answers 0.
 */
export function journalView(journal: JournalRecord, record: AccountRecord, now: number): Journal {
  const state = record.committedState
  const today = dayOf(now)
  const open = journal.day?.index === today ? journal.day : null
  const pending = journal.rest.filter((e) => e.from > today).at(-1)
  return {
    achievements: Object.entries(journal.achievements).map(([id, steps]) => ({
      id,
      steps: steps.map((s) => ({ ...s })),
    })),
    day: {
      index: today,
      goal: open?.goal ?? dailyGoal(today, record.account.accountId, state.zone),
      progress: open ? progressOf(open, state) : 0,
      met: open?.met ?? false,
      resetsAt: (today + 1) * DAY_MS,
    },
    goalsMet: journal.goalsMet,
    streak: { length: streakOn(journal, today), lastMet: journal.streak.lastMet },
    restDays: {
      current: [...restDaysOn(journal, today)],
      next: pending ? { days: [...pending.days], from: pending.from } : null,
    },
  }
}

/** Why a rest-day set is refused, or null for two distinct weekdays. */
export function restDaysRefusal(days: readonly number[]): RestDaysRefusal | null {
  if (days.length !== 2) return 'rest_days_count'
  if (!days.every((d) => Number.isInteger(d) && d >= 1 && d <= 7)) return 'rest_days_range'
  if (days[0] === days[1]) return 'rest_days_same'
  return null
}

/** Stores a valid set as the rest days from next Monday, replacing a set still to come. */
export function setRestDays(journal: JournalRecord, days: Weekday[], now: number): void {
  const today = dayOf(now)
  journal.rest = [
    ...journal.rest.filter((e) => e.from <= today),
    { from: nextMonday(today), days: [...days].sort((a, b) => a - b) },
  ]
  pruneRest(journal, today)
}
