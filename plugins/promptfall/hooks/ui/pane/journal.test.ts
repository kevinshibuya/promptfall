import { expect, test } from 'claude-code/testing'
import type { DialogState, GameView, JournalState, PaneMenu } from '../../../types'
import { JOURNAL_DEFAULT } from '../../state'
import { dayOf } from '../../vendor/protocol.js'
import { content, dailyGoal } from '../../vendor/sim.js'
import { tilePositions } from '../../windows/kit'
import { DOWN_RGB, GAUGE_FULL_RGB } from '../../windows/tuning'
import { journalLoaded, paneInput, paneView } from './fixtures'
import { TAB_LABELS, tabWindow } from './frame'
import type { PaneInput } from './input'
import { goalWords, journalPane } from './journal'
import { linesOf, textOf, win } from './testing'

/** Five hours before day 0 resets. */
const NOW = 86_400_000 - 5 * 3_600_000

function input(
  view: Partial<GameView> = {},
  journal: Partial<JournalState> = {},
  dialog: Partial<DialogState> = {},
  patch: Partial<PaneInput> = {},
): PaneInput {
  const base = paneInput({
    tab: 'journal',
    view: { ...paneView(), zone: 3, highestZone: 3, ...view },
    serverNow: NOW,
    remainingMs: (deadline) => deadline - NOW,
    ...patch,
  })
  return {
    ...base,
    journal: { ...journalLoaded(), ...journal },
    dialog: { ...base.dialog, ...dialog },
  }
}
const cursors = (b: ReturnType<typeof journalPane>) => b.stops.filter((s) => s.cursor)
const message = (b: ReturnType<typeof journalPane>) =>
  linesOf(win(b, 'message')).map((l) => l.trim())
const page = (menu: PaneMenu) => input({}, {}, { menu })

test('the list: Today with the goal, its progress, the reset and the streak; a row per zone reached; Collection; Achievements', () => {
  const b = journalPane(input())
  const list = win(b, 'list')
  expect(list?.title).toEqual([{ text: 'Journal' }])
  const lines = linesOf(list)
  expect(lines[0]).toBe('  Today')
  expect(list?.lines[0]?.rule).toBe(true)
  expect(lines[1]).toMatch(/^▶ Kill 150 enemies +45\/150$/)
  expect(lines[2]).toBe('  Resets in 5 h · streak 3 work days')
  expect(lines[3]).toBe('  Bestiary')
  expect(list?.lines[3]?.rule).toBe(true)
  expect(lines[4]).toMatch(/^ {2}Zone 1, Greenmeadow Road +0\/6$/)
  expect(lines[5]).toMatch(/^ {2}Zone 2, Whisperwood +0\/6$/)
  expect(lines[6]).toMatch(/^ {2}Zone 3, Marsh of Sighs +0\/6$/)
  expect(lines[7]).toMatch(/^ {2}Collection +0\/200$/)
  expect(lines[8]).toMatch(/^ {2}Achievements +3\/47$/)
  expect(lines).toHaveLength(9)
  expect(cursors(b).map((s) => [s.key, s.action])).toEqual([
    ['row:today', { t: 'none' }],
    ['row:zone-1', { t: 'open', menu: { kind: 'journal_zone', zone: 1, at: 0 } }],
    ['row:zone-2', { t: 'open', menu: { kind: 'journal_zone', zone: 2, at: 0 } }],
    ['row:zone-3', { t: 'open', menu: { kind: 'journal_zone', zone: 3, at: 0 } }],
    ['row:collection', { t: 'open', menu: { kind: 'journal_collection', at: 0 } }],
    ['row:achievements', { t: 'open', menu: { kind: 'journal_achievements', at: 0 } }],
  ])
  expect(message(b)).toEqual([
    'Tab or arrows: move.',
    'Travel from a zone page, or /promptfall travel <zone>.',
  ])
})

test('a zone row counts its enemies defeated out of six; past tier 1 every base zone has a row', () => {
  const zone1 = content.zones[0]
  const enemies = Object.fromEntries(
    (zone1?.enemies ?? []).map((id, i) => [id, { seen: 9, defeated: i < 2 ? 4 : 0 }]),
  )
  const tallies = { ...paneView().tallies, enemies }
  const b = journalPane(input({ tallies }))
  expect(linesOf(win(b, 'list'))[4]).toMatch(/^ {2}Zone 1, Greenmeadow Road +2\/6$/)
  const tier2 = journalPane(input({ zone: 15, highestZone: 15 }))
  const zones = cursors(tier2).filter((s) => s.key.startsWith('row:zone-'))
  expect(zones.map((s) => s.key)).toEqual(content.zones.map((z) => `row:zone-${z.index}`))
})

test('the rows fit one line at 100 columns', () => {
  const b = journalPane(input({ zone: 12, highestZone: 12 }, {}, {}, { columns: 100 }))
  const list = win(b, 'list')
  const inner = (list?.columns ?? 0) - 2
  for (const line of linesOf(list)) expect(line.length).toBeLessThanOrEqual(inner)
})

test('before the read the goal comes from the daily goal function at the local day; the busy row shows', () => {
  const b = journalPane(input({}, { ...JOURNAL_DEFAULT, busy: true }))
  const goal = dailyGoal(dayOf(NOW), 'a1', 3)
  const lines = linesOf(win(b, 'list'))
  expect(lines[1]).toMatch(new RegExp(`^▶ ${goalWords(goal)} +…$`))
  expect(lines[2]).toBe('  Loading…')
  expect(lines.at(-1)).toMatch(/^ {2}Achievements +…$/)
})

test('a met goal reads met in gold; a failed read flashes its error', () => {
  const loaded = journalLoaded().journal
  const met = journalPane(
    input({}, { journal: loaded ? { ...loaded, day: { ...loaded.day, met: true } } : null }),
  )
  expect(win(met, 'list')?.lines[1]?.spans).toContainEqual(
    expect.objectContaining({ text: expect.stringMatching(/met$/), rgb: GAUGE_FULL_RGB }),
  )
  const failed = journalPane(input({}, { ...JOURNAL_DEFAULT, error: 'Server unreachable' }))
  expect(win(failed, 'message')?.lines[0]?.spans).toContainEqual({
    text: 'Server unreachable',
    rgb: DOWN_RGB,
  })
})

test('the goal words', () => {
  expect(goalWords({ kind: 'kills', target: 150 })).toBe('Kill 150 enemies')
  expect(goalWords({ kind: 'zone_bosses', target: 1 })).toBe('Beat 1 zone boss')
  expect(goalWords({ kind: 'zone_bosses', target: 3 })).toBe('Beat 3 zone bosses')
  expect(goalWords({ kind: 'rare_drops', target: 2 })).toBe('Find 2 Rare or better drops')
  expect(goalWords({ kind: 'turn_boss', target: 1 })).toBe('Beat a turn boss')
})

test('the detail follows the ▶: today, a zone, the collection, the achievements', () => {
  const today = linesOf(win(journalPane(input()), 'detail'))
  expect(today).toEqual([
    ' Today',
    ' Kill 150 enemies',
    ' Progress 45 of 150',
    ' Resets in 5 h',
    ' Streak: 3 work days',
    ' Rest days: Sat, Sun',
  ])
  const zone = journalPane(input({}, {}, { cursor: { journal: { id: 'zone-3', index: 3 } } }))
  expect(linesOf(win(zone, 'detail'))).toEqual([
    ' Zone 3, Marsh of Sighs',
    ' 0 of 6 enemies defeated',
    ' The party is here.',
  ])
  expect(message(zone)[0]).toBe('Enter: open its page. Tab or arrows: move.')
})

test('a zone page: six enemies with seen and defeated counts and marks, the boss apart, Travel here', () => {
  const z = content.zones[0]
  if (!z) throw new Error('no zone 1')
  const tallies = {
    ...paneView().tallies,
    enemies: { road_slime: { seen: 12, defeated: 8 }, [z.boss]: { seen: 1, defeated: 0 } },
  }
  const b = journalPane(input({ tallies }, {}, { menu: { kind: 'journal_zone', zone: 1, at: 0 } }))
  const menu = win(b, 'menu')
  const lines = linesOf(menu)
  expect(lines[0]).toMatch(/^ Greenmeadow Road +seen +won$/)
  expect(lines[1]).toMatch(/^▶\* Road Slime +12 +8$/)
  expect(lines[2]).toMatch(/^ · Field Rat +0 +0$/)
  expect(lines[5]).toMatch(/^ · Bandit Captain +1 +0$/)
  expect(lines[6]).toMatch(/^ · Wild Boar +0 +0$/)
  expect(lines[7]).toBe(' Travel here')
  expect(menu?.lines[7]?.spans).toContainEqual({ text: 'T', rgb: GAUGE_FULL_RGB })
  expect(menu?.alt).toMatch(/Bandit Captain, the zone boss/)
  // The boss's name is drawn apart from the wave enemies'.
  const bossName = menu?.lines[5]?.spans.find((s) => 'text' in s && s.text.includes('Bandit'))
  const waveName = menu?.lines[2]?.spans.find((s) => 'text' in s && s.text.includes('Field'))
  expect(bossName && 'rgb' in bossName ? bossName.rgb : null).not.toBe(
    waveName && 'rgb' in waveName ? waveName.rgb : null,
  )
  const items = cursors(b)
  expect(items).toHaveLength(7)
  expect(items.at(-1)).toMatchObject({
    key: 'menu:6',
    hotkey: 't',
    action: { t: 'event', event: { t: 'travel', zone: 1 } },
  })
  // The list stays beside the page; the page takes the detail column.
  expect(win(b, 'detail')).toBeUndefined()
  expect(b.focus).toBe('menu:0')
  expect(message(b)[0]).toBe('Enter on Travel here: go there. q: back.')
})

test('Travel here is absent on the zone the party is in, and does nothing in a read-only view', () => {
  const here = journalPane(page({ kind: 'journal_zone', zone: 3, at: 0 }))
  expect(linesOf(win(here, 'menu'))).not.toContain(' Travel here')
  expect(cursors(here)).toHaveLength(6)
  const ro = journalPane(
    input({}, {}, { menu: { kind: 'journal_zone', zone: 1, at: 0 } }, { readOnly: true }),
  )
  expect(cursors(ro).at(-1)?.action).toEqual({ t: 'none' })
})

test('past tier 1 a zone page offers each tier reached of that base zone', () => {
  const b = journalPane(
    input({ zone: 14, highestZone: 15 }, {}, { menu: { kind: 'journal_zone', zone: 3, at: 0 } }),
  )
  const travel = cursors(b).filter((s) => s.action.t === 'event')
  expect(travel.map((s) => s.action)).toEqual([
    { t: 'event', event: { t: 'travel', zone: 3 } },
    { t: 'event', event: { t: 'travel', zone: 15 } },
  ])
  expect(linesOf(win(b, 'menu')).slice(-2)).toEqual([
    ' Travel to zone 3',
    ' Travel to tier 2, zone 3',
  ])
  // On tier 2's zone 2 the page for base zone 2 leaves out the zone the party is in.
  const two = journalPane(
    input({ zone: 14, highestZone: 15 }, {}, { menu: { kind: 'journal_zone', zone: 2, at: 0 } }),
  )
  expect(
    cursors(two)
      .filter((s) => s.action.t === 'event')
      .map((s) => s.action),
  ).toEqual([{ t: 'event', event: { t: 'travel', zone: 2 } }])
})

test('the Collection page: every base with five rarity marks, held or not', () => {
  const tallies = {
    ...paneView().tallies,
    collection: { iron_sword: { common: 1, uncommon: 0, rare: 1, epic: 0, legendary: 0 } },
  }
  const b = journalPane(input({ tallies }, {}, { menu: { kind: 'journal_collection', at: 0 } }))
  const bases = Object.values(content.itemBases)
  expect(cursors(b)).toHaveLength(bases.length)
  const lines = linesOf(win(b, 'menu'))
  expect(lines[0]).toBe(' Collection · 2 of 200 held')
  expect(lines[1]).toMatch(/^▶Iron Sword +C·R··$/)
  expect(lines[2]).toMatch(/^ Bronze Axe +·····$/)
  expect(win(b, 'menu')?.alt).toMatch(/Iron Sword: common, rare/)
  expect(message(b)).toEqual([
    'q: back.',
    'C U R E L: held in common, uncommon, rare, epic, legendary.',
  ])
})

test('the Achievements page: a ladder as one row with step marks, next gold and last date; a one-off with mark and date', () => {
  const b = journalPane(page({ kind: 'journal_achievements', at: 0 }))
  expect(cursors(b)).toHaveLength(content.achievements.length)
  const lines = linesOf(win(b, 'menu'))
  expect(lines[0]).toBe(' Achievements · 3 of 47 steps')
  expect(lines[1]).toMatch(/^▶Kills +\*\*·· +1,500g +Oct 13$/)
  expect(lines[2]).toMatch(/^ Zone bosses +···· +100g$/)
  const epic = lines.find((l) => l.includes('A first Epic'))
  expect(epic).toMatch(/^ A first Epic +\* +Oct 12$/)
  const legendary = lines.find((l) => l.includes('A first Legendary'))
  expect(legendary).toMatch(/^ A first Legendary +· +500g$/)
  const loading = journalPane(
    input(
      {},
      { ...JOURNAL_DEFAULT, busy: true },
      { menu: { kind: 'journal_achievements', at: 0 } },
    ),
  )
  expect(linesOf(win(loading, 'menu')).slice(1)).toEqual(['▶Loading…'])
})

test('u opens the Journal, ninth, between Odds and Chat, its u gold; nothing takes the rungs’ j and k', () => {
  expect(TAB_LABELS.map((t) => t.tab)).toEqual([
    'inventory',
    'heroes',
    'market',
    'orders',
    'account',
    'odds',
    'journal',
    'chat',
    'leaderboards',
  ])
  const b = journalPane(input())
  expect(b.stops.find((s) => s.key === 'tab-journal')).toMatchObject({
    hotkey: 'u',
    action: { t: 'tab', tab: 'journal' },
  })
  expect(b.stops.some((s) => s.hotkey === 'j' || s.hotkey === 'k')).toBe(false)
  const tabs = tabWindow(120, 'journal')
  expect(textOf(tabs.lines[0]?.spans ?? [])).toMatch(/Odds +▶Journal +Chat/)
  expect(tabs.lines[0]?.spans).toContainEqual({ text: 'u', rgb: GAUGE_FULL_RGB })
})

test('wide and narrow pass tilePositions, the list and a page', () => {
  for (const columns of [120, 60]) {
    for (const menu of [null, { kind: 'journal_collection' as const, at: 0 }]) {
      const b = journalPane(input({}, {}, { menu }, { columns }))
      const pos = tilePositions(b.scene)
      for (const w of b.scene.windows)
        expect([w.key, pos.get(w.key)]).toEqual([w.key, { x: w.x, y: w.y ?? 0 }])
    }
  }
})
