import { expect } from 'claude-code/testing'
import type { GameView } from '../types'
import {
  goalWords,
  type SummarySnapshot,
  sinceWords,
  snapshotFor,
  snapshotOf,
  stampFor,
  summaryLine,
} from './summary'
import { test } from './testing'
import { DAY_MS } from './vendor/protocol.js'
import { content, createInitialState, dailyGoal } from './vendor/sim.js'
import { toAccountView, toGameView } from './view'

const MINUTE = 60_000
const NOW = 30 * DAY_MS

function view(patch: {
  kills?: number
  zoneBosses?: number
  levels?: number[]
  drops?: Partial<Record<'common' | 'uncommon' | 'rare' | 'epic' | 'legendary', number>>
  goldEarned?: number
  highestZone?: number
}): GameView {
  const s0 = createInitialState(7)
  const state = {
    ...s0,
    highestZone: patch.highestZone ?? s0.highestZone,
    stats: { ...s0.stats, kills: patch.kills ?? 0 },
    roster: s0.roster.map((h, i) => ({ ...h, level: patch.levels?.[i] ?? h.level })),
    tallies: {
      ...s0.tallies,
      zoneBosses: patch.zoneBosses ?? 0,
      drops: { ...s0.tallies.drops, ...patch.drops },
      goldEarned: patch.goldEarned ?? 0,
    },
  }
  const account = toAccountView(
    { accountId: 'acct-1', seed: 7, createdAt: 0, displayName: null, linked: null },
    null,
    'in-process',
    0,
    false,
  )
  return toGameView(state, 'acct-1', false, account)
}

const base = view({})
const before: SummarySnapshot = snapshotOf(base, 'acct-1')
const goal = (v: GameView) => goalWords(dailyGoal(30, 'acct-1', v.zone))

test('the line counts each part from the snapshot and ends with the day goal', () => {
  const levels = base.roster.map((h, i) => h.level + (i === 0 ? 2 : 0))
  const after = view({
    kills: 412,
    zoneBosses: 3,
    levels,
    drops: { rare: 0, epic: 2, legendary: 1, common: 9 },
    goldEarned: 1200,
    highestZone: 5,
  })
  expect(summaryLine(before, after, NOW - 2 * DAY_MS, NOW, 30)).toBe(
    `${sinceWords(NOW - 2 * DAY_MS, NOW)}: 412 kills, 3 bosses, 2 levels, 1 Legendary, 2 Epics, 1,200 gold, zone 5 reached. Today's goal: ${goal(after)}.`,
  )
})

test('parts at zero are left out, and singulars read as one', () => {
  const after = view({ kills: 1, drops: { rare: 3 } })
  expect(summaryLine(before, after, NOW - 11 * MINUTE, NOW, 30)).toBe(
    `Since your last session: 1 kill, 3 Rares. Today's goal: ${goal(after)}.`,
  )
})

test('every part at zero raises nothing', () => {
  expect(summaryLine(before, base, NOW - 2 * DAY_MS, NOW, 30)).toBeNull()
  // A level lost to a dismiss is not a negative part: the line still says nothing.
  const fewer = view({ levels: base.roster.map(() => 1) })
  expect(summaryLine(snapshotOf(view({ levels: [9, 9, 9] }), 'acct-1'), fewer, 0, NOW, 30)).toBe(
    null,
  )
})

test('the gap names the weekday from a day up and the last session under it', () => {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  const at = NOW - DAY_MS
  expect(sinceWords(at, NOW)).toBe(`Since ${days[new Date(at).getDay()]}`)
  expect(sinceWords(at + 1, NOW)).toBe('Since your last session')
})

test('a zone past 12 reads in tier words', () => {
  const after = view({ highestZone: 13 })
  expect(summaryLine(before, after, NOW - 11 * MINUTE, NOW, 30)).toBe(
    `Since your last session: tier 2, zone 1 reached. Today's goal: ${goal(after)}.`,
  )
})

test('the goal reads as the thing to do', () => {
  expect(goalWords({ kind: 'kills', target: 40 })).toBe('kill 40 enemies')
  expect(goalWords({ kind: 'zone_bosses', target: 1 })).toBe('beat 1 zone boss')
  expect(goalWords({ kind: 'rare_drops', target: 3 })).toBe('see 3 Rare or better drops')
  expect(goalWords({ kind: 'turn_boss', target: 1 })).toBe('beat one turn boss')
  expect(content.goals.length).toBeGreaterThan(0)
})

test("another account's records read as none", () => {
  expect(snapshotFor(before, 'acct-1')).toEqual(before)
  expect(snapshotFor(before, 'acct-2')).toBeNull()
  expect(snapshotFor({ account: 'acct-1' }, 'acct-1')).toBeNull()
  expect(stampFor({ account: 'acct-1', at: 5 }, 'acct-1')).toBe(5)
  expect(stampFor({ account: 'acct-1', at: 5 }, 'acct-2')).toBeNull()
  expect(stampFor(undefined, 'acct-1')).toBeNull()
})
