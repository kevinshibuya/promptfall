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
    const want = `${i === 0 ? '▶' : ' '} ${r.padEnd(10)}${(z[i] ?? '').padStart(8)}${(boss[i] ?? '').padStart(8)}${(tavern[i] ?? '').padStart(8)}`
    expect(lines[i + 1]).toBe(want.trimEnd())
    expect(list?.lines[i + 1]?.spans[2]).toMatchObject({ rgb: RARITY_RGB[r] })
  }
  expect(lines.slice(6, 9)).toEqual([
    '  Rare guaranteed in 20 recruits',
    '  Epic guaranteed in 80 recruits',
    '  Legendary guaranteed in 400 recruits',
  ])
  expect(lines[9]).toBe('  Rarity multiplies base stats, heroes and items alike.')
  expect(list?.lines[9]?.spans).toContainEqual({
    text: 'Rarity multiplies base stats, heroes and items alike.',
    rgb: DIM_RGB,
  })
  expect(lines[10]).toBe('  Reforge is priced by rarity and tier.')
  expect(list?.lines[10]?.spans).toContainEqual({
    text: 'Reforge is priced by rarity and tier.',
    rgb: DIM_RGB,
  })
  expect(lines[11]).toBe('  Expansions')
  expect(list?.lines[11]?.rule).toBe(true)
  // The rarity rows are stops that do nothing; the ▶ starts on the first.
  expect(b.focus).toBe('row:r-common')
  expect(message(b)[0]).toBe('Tab or arrows: move.')
})

test('the guarantee rows read the counts in the view; a count of 1 is the next recruit', () => {
  const lines = linesOf(
    win(oddsPane(input({ guarantees: { rare: 13, epic: 61, legendary: 377 } })), 'list'),
  )
  expect(lines.slice(6, 9)).toEqual([
    '  Rare guaranteed in 13 recruits',
    '  Epic guaranteed in 61 recruits',
    '  Legendary guaranteed in 377 recruits',
  ])
  const next = linesOf(
    win(oddsPane(input({ guarantees: { rare: 1, epic: 2, legendary: 1 } })), 'list'),
  )
  expect(next.slice(6, 9)).toEqual([
    '  Rare guaranteed on the next recruit',
    '  Epic guaranteed in 2 recruits',
    '  Legendary guaranteed on the next recruit',
  ])
})

test("past tier 1 the title names the tier and the table shows zone 12's odds", () => {
  const b = oddsPane(input({ zone: 13 }))
  const list = win(b, 'list')
  expect(list?.title).toEqual([{ text: 'Odds · tier 2, zone 1' }])
  const zone = content.zones[11]
  const z = shares(zone?.rarityWeights ?? {})
  const boss = shares(zone?.bossRarityWeights ?? {})
  const lines = linesOf(list)
  expect(lines[5]).toContain(`${z[4] ?? ''}`.padStart(8) + `${boss[4] ?? ''}`.padStart(8))
})

test('a short pane shows the table: the ▶ starts on it and Down walks on to the expansions', () => {
  // 120 × 16 keeps the tab window: 7 list lines. The expansion rows sit on the second page.
  const b = oddsPane(input({}, {}, { rows: 16 }))
  const lines = linesOf(win(b, 'list'))
  expect(lines[1]?.startsWith('▶ common')).toBe(true)
  expect(lines.some((l) => l.includes('legendary'))).toBe(true)
  const on = oddsPane(
    input({}, { cursor: { odds: { id: 'expand-roster', index: 6 } } }, { rows: 16 }),
  )
  expect(linesOf(win(on, 'list')).some((l) => /^ {2}Inventory \+10 slots +500G$/.test(l))).toBe(
    true,
  )
})

test('the expansion rows: their events, dim when gold is short, at max with no stop', () => {
  const b = oddsPane(input())
  expect(
    cursors(b)
      .slice(5)
      .map((s) => [s.key, s.action]),
  ).toEqual([
    ['row:expand-inventory', { t: 'event', event: { t: 'expand_inventory' } }],
    ['row:expand-roster', { t: 'event', event: { t: 'expand_roster' } }],
  ])
  expect(linesOf(win(b, 'list'))[12]).toMatch(/^ {2}Inventory \+10 slots +500G$/)
  const short = oddsPane(input({ gold: 450 }))
  expect(win(short, 'list')?.lines[12]?.spans).toContainEqual({
    text: 'Inventory +10 slots',
    rgb: DIM_RGB,
  })
  expect(win(short, 'list')?.lines[13]?.spans).toContainEqual({
    text: 'Roster +4 heroes',
    rgb: TEXT,
  })
  const max = oddsPane(input({ nextInventoryCost: null }))
  expect(linesOf(win(max, 'list'))[12]).toBe('  Inventory at max')
  expect(cursors(max).at(-1)?.key).toBe('row:expand-roster')
  expect(cursors(max).some((s) => s.key === 'row:expand-inventory')).toBe(false)
})
const TEXT = 0xf0f0e8

test('read-only rows do nothing', () => {
  const b = oddsPane(input({}, {}, { readOnly: true }))
  expect(cursors(b).every((s) => s.action.t === 'none')).toBe(true)
  expect(cursors(b)).toHaveLength(7)
})

test('the detail of each expansion, and the message', () => {
  const b = oddsPane(input({}, { cursor: { odds: { id: 'expand-inventory', index: 5 } } }))
  expect(linesOf(win(b, 'detail'))).toEqual([
    ' Inventory',
    ' 3 of 20 slots',
    ' +10 for 500G',
    ' You have 1,240G',
  ])
  const roster = oddsPane(input({}, { cursor: { odds: { id: 'expand-roster', index: 6 } } }))
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

test('the message names the tier past tier 1 and reads as today inside it', () => {
  expect(message(oddsPane(input({ zone: 12 })))[1]).toBe(
    'Drop odds in zone 12, its boss, and the tavern.',
  )
  expect(message(oddsPane(input({ zone: 13 })))[1]).toBe(
    'Drop odds in tier 2, zone 1, its boss, and the tavern.',
  )
})

test('wide and narrow pass tilePositions', () => {
  for (const columns of [120, 60]) {
    const b = oddsPane(input({}, {}, { columns }))
    const pos = tilePositions(b.scene)
    for (const w of b.scene.windows)
      expect([w.key, pos.get(w.key)]).toEqual([w.key, { x: w.x, y: w.y ?? 0 }])
  }
})
