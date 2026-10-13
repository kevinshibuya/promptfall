import type { DailyGoal } from '@promptfall/sim'
import { z } from 'zod'
import { type Banned, RefusedBannedSchema } from './market'

// The account's journal as the ledger answers it: achievements, the day's goal, the streak and the
// rest days. Never a server event, never sim state.

/** A day of the week, ISO: 1 is Monday, 7 is Sunday. */
export type Weekday = number

export type Journal = {
  /** Each achievement with a step crossed, its crossed steps (numbered from 1) with the server time of each. */
  achievements: { id: string; steps: { step: number; at: number }[] }[]
  /** Today: its UTC day index, its goal, the progress since the day's first commit, met, and when it resets. */
  day: { index: number; goal: DailyGoal; progress: number; met: boolean; resetsAt: number }
  /** Days a goal was met, rest days included. */
  goalsMet: number
  /** Work days met in a row; `lastMet` is the last work day met, a day index. */
  streak: { length: number; lastMet: number | null }
  /** The rest days in force, and the set to come with the day index of the Monday it applies from. */
  restDays: { current: Weekday[]; next: { days: Weekday[]; from: number } | null }
}

export type RestDaysRefusal = 'rest_days_count' | 'rest_days_same' | 'rest_days_range'

export type RestDaysResult =
  | { ok: true; journal: Journal }
  | { ok: false; reason: RestDaysRefusal | 'unauthorized' }
  | ({ ok: false } & Banned)

// Contract-visible numbers and the calendar, shared by the ledger, the suite and the plugin.

export const DAY_MS = 86_400_000
/** A fresh journal rests on Saturday and Sunday. */
export const DEFAULT_REST_DAYS: readonly Weekday[] = [6, 7]

/** The UTC day index holding `now`: day 0 began at the epoch. */
export function dayOf(now: number): number {
  return Math.floor(now / DAY_MS)
}

/** The ISO weekday of a day index: day 0 was a Thursday. */
export function weekdayOf(day: number): Weekday {
  return ((((day + 3) % 7) + 7) % 7) + 1
}

/** The day index of the first Monday after `day`: a Monday's next Monday is a week on. */
export function nextMonday(day: number): number {
  return day + 8 - weekdayOf(day)
}

const count = z.number().int().nonnegative()
const weekday = z.number().int().min(1).max(7)

export const DailyGoalSchema: z.ZodType<DailyGoal> = z.object({
  kind: z.enum(['kills', 'zone_bosses', 'rare_drops', 'turn_boss']),
  target: z.number().int().positive(),
})

export const JournalSchema: z.ZodType<Journal> = z.object({
  achievements: z.array(
    z.object({
      id: z.string().min(1).max(64),
      steps: z.array(z.object({ step: z.number().int().positive(), at: count })),
    }),
  ),
  day: z.object({
    index: count,
    goal: DailyGoalSchema,
    progress: count,
    met: z.boolean(),
    resetsAt: count,
  }),
  goalsMet: count,
  streak: z.object({ length: count, lastMet: count.nullable() }),
  restDays: z.object({
    current: z.array(weekday).max(7),
    next: z.object({ days: z.array(weekday).max(7), from: count }).nullable(),
  }),
})

export const RestDaysResultSchema: z.ZodType<RestDaysResult> = z.union([
  z.object({ ok: z.literal(true), journal: JournalSchema }),
  z.object({
    ok: z.literal(false),
    reason: z.enum(['rest_days_count', 'rest_days_same', 'rest_days_range', 'unauthorized']),
  }),
  RefusedBannedSchema,
])

/** Loose on purpose: the ledger refuses a bad set with its reason, never the schema. */
export const RestDaysBodySchema = z.object({ days: z.array(z.number()).max(16) })
