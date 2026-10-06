import { expect, test } from 'claude-code/testing'
import type { DialogState, GameView } from '../../../types'
import { RARITY_RGB } from '../../stage/tuning'
import { content, RARITIES } from '../../vendor/sim.js'
import { tilePositions } from '../../windows/kit'
import { DIM_RGB } from '../../windows/tuning'
import { paneInput, paneView } from './fixtures'
import type { PaneInput } from './input'
import { oddsPane, percent } from './odds'
import { linesOf, win } from './testing'

function input(
  view: Partial<GameView> = {},
  dialog: Partial<DialogState> = {},
  patch: Partial<PaneInput> = {},
): PaneInput {
  const base = paneInput({
    tab: 'odds',
    view: { ...paneView(), nextInventoryCost: 500, nextRosterCost: 400, ...view },
    ...patch,
  })
  return { ...base, dialog: { ...base.dialog, ...dialog } }
}
const cursors = (b: ReturnType<typeof oddsPane>) => b.stops.filter((s) => s.cursor)
const message = (b: ReturnType<typeof oddsPane>) => linesOf(win(b, 'message')).map((l) => l.trim())

/** Today's dialog arithmetic, as `oddsLine` wrote it. */
function shares(weights: Record<string, number>): string[] {
  const total = RARITIES.reduce((sum, r) => sum + (weights[r] ?? 0), 0)
  return RARITIES.map((r) => percent(weights[r] ?? 0, total))
}

test('the table: a heading, one line per rarity with zone, boss and tavern, as today', () => {
  const b = oddsPane(input())
  const list = win(b, 'list')
  expect(list?.title).toEqual([{ text: 'Odds · zone 1' }])
  const lines = linesOf(list)
  expect(lines[0]).toBe('  Rarity        Zone    Boss  Tavern')
  expect(list?.lines[0]?.rule).toBe(true)
  const zone = content.zones[0]
  const z = shares(zone?.rarityWeights ?? {})
  const boss = shares(zone?.bossRarityWeights ?? {})
  const tavern = shares(content.tavern.odds)
  for (const [i, r] of RARITIES.entries()) {
    const want = `  ${r.padEnd(10)}${(z[i] ?? '').padStart(8)}${(boss[i] ?? '').padStart(8)}${(tavern[i] ?? '').padStart(8)}`
    expect(lines[i + 1]).toBe(want.trimEnd())
    expect(list?.lines[i + 1]?.spans[2]).toMatchObject({ rgb: RARITY_RGB[r] })
  }
  expect(lines[6]).toBe('  Expansions')
  expect(list?.lines[6]?.rule).toBe(true)
})

test('the expansion rows: their events, dim when gold is short, at max with no stop', () => {
  const b = oddsPane(input())
  expect(cursors(b).map((s) => [s.key, s.action])).toEqual([
    ['row:expand-inventory', { t: 'event', event: { t: 'expand_inventory' } }],
    ['row:expand-roster', { t: 'event', event: { t: 'expand_roster' } }],
  ])
  expect(linesOf(win(b, 'list'))[7]).toMatch(/^▶ Inventory \+10 slots +500G$/)
  const short = oddsPane(input({ gold: 450 }))
  expect(win(short, 'list')?.lines[7]?.spans).toContainEqual({
    text: 'Inventory +10 slots',
    rgb: DIM_RGB,
  })
  expect(win(short, 'list')?.lines[8]?.spans).toContainEqual({
    text: 'Roster +4 heroes',
    rgb: TEXT,
  })
  const max = oddsPane(input({ nextInventoryCost: null }))
  expect(linesOf(win(max, 'list'))[7]).toBe('  Inventory at max')
  expect(cursors(max).map((s) => s.key)).toEqual(['row:expand-roster'])
  const none = oddsPane(input({ nextInventoryCost: null, nextRosterCost: null }))
  expect(cursors(none).map((s) => s.key)).toEqual(['row:empty'])
  expect(message(none)[0]).toBe('Tab or arrows: move.')
})
const TEXT = 0xf0f0e8

test('read-only rows do nothing', () => {
  const b = oddsPane(input({}, {}, { readOnly: true }))
  expect(cursors(b).map((s) => s.action)).toEqual([{ t: 'none' }, { t: 'none' }])
})

test('the detail of each expansion, and the message', () => {
  const b = oddsPane(input())
  expect(linesOf(win(b, 'detail'))).toEqual([
    ' Inventory',
    ' 3 of 20 slots',
    ' +10 for 500G',
    ' You have 1,240G',
  ])
  const roster = oddsPane(input({}, { cursor: { odds: { id: 'expand-roster', index: 1 } } }))
  expect(linesOf(win(roster, 'detail'))).toEqual([
    ' Roster',
    ' 5 of 6 heroes',
    ' +4 for 400G',
    ' You have 1,240G',
  ])
  expect(message(b)).toEqual([
    'Enter: buy it. Tab or arrows: move.',
    'Drop odds in zone 1, its boss, and the tavern.',
  ])
})

test('wide and narrow pass tilePositions', () => {
  for (const columns of [120, 60]) {
    const b = oddsPane(input({}, {}, { columns }))
    const pos = tilePositions(b.scene)
    for (const w of b.scene.windows)
      expect([w.key, pos.get(w.key)]).toEqual([w.key, { x: w.x, y: w.y ?? 0 }])
  }
})
