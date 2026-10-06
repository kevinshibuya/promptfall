import { expect, test } from 'claude-code/testing'
import type { BoardsState, DialogState, GameView, WorldState } from '../../../types'
import { WORLD_DEFAULT } from '../../state'
import { tilePositions } from '../../windows/kit'
import { GAUGE_FULL_RGB, TEXT_RGB, WARN_RGB } from '../../windows/tuning'
import { boardsLoaded, paneInput, paneView } from './fixtures'
import type { PaneInput } from './input'
import { boardsPane } from './leaderboards'
import { linesOf, win } from './testing'

const openView = (open = true): GameView => ({
  ...paneView(),
  account: { ...paneView().account, leaderboardsOpen: open, presenceOpen: true },
})
function input(
  boards: Partial<BoardsState> = {},
  dialog: Partial<DialogState> = {},
  patch: Partial<PaneInput> = {},
): PaneInput {
  const base = paneInput({ tab: 'leaderboards', view: openView(), ...patch })
  return {
    ...base,
    boards: { ...boardsLoaded(), ...boards },
    dialog: { ...base.dialog, ...dialog },
  }
}
const cursors = (b: ReturnType<typeof boardsPane>) => b.stops.filter((s) => s.cursor)
const message = (b: ReturnType<typeof boardsPane>) =>
  linesOf(win(b, 'message')).map((l) => l.trim())

test('both headings, the rows with their values, your rows gold, every row a stop doing nothing', () => {
  const b = boardsPane(input())
  const list = win(b, 'list')
  const lines = linesOf(list)
  expect(lines[0]).toBe('  Highest zone')
  expect(list?.lines[0]?.rule).toBe(true)
  expect(lines[1]).toMatch(/^▶ 1\. player0 +zone 12$/)
  expect(lines[1]?.length).toBe(78)
  expect(list?.lines[3]?.spans).toContainEqual({ text: '3. kevin', rgb: GAUGE_FULL_RGB })
  expect(list?.lines[1]?.spans).toContainEqual({ text: '1. player0', rgb: TEXT_RGB })
  expect(cursors(b).length).toBe(40)
  expect(cursors(b).every((s) => s.action.t === 'none')).toBe(true)
  expect(cursors(b)[0]?.key).toBe('row:z-p0')
  expect(cursors(b)[20]?.key).toBe('row:d-a1')
  expect(message(b)).toEqual(['Tab or arrows: move.', 'The boss board resets Monday 00:00 UTC.'])
})

test('the 42 lines page by the ▶', () => {
  const b = boardsPane(input({}, { cursor: { leaderboards: { id: 'd-p5', index: 25 } } }))
  const lines = linesOf(win(b, 'list'))
  // Line 27 (the damage board's sixth row) is on the second page: lines 15 to 29.
  expect(lines.length).toBe(15)
  expect(lines[12]).toMatch(/^▶ 6\. player5 +85,000$/)
  expect(lines[6]).toBe('  Boss damage this week')
})

test('no boss damage yet, loading, closed', () => {
  const loaded = boardsLoaded().boards
  const none = boardsPane(
    input(
      { boards: loaded ? { ...loaded, damage: [] } : null },
      { cursor: { leaderboards: { id: 'z-p19', index: 19 } } },
    ),
  )
  expect(linesOf(win(none, 'list')).at(-1)).toBe('  No boss damage yet this week.')
  const loading = boardsPane(input({ boards: null, busy: true }))
  expect(linesOf(win(loading, 'list'))).toEqual(['  Loading…'])
  const closed = boardsPane(input({}, {}, { view: openView(false) }))
  expect(linesOf(win(closed, 'list'))).toEqual(['  Leaderboards are closed.'])
  expect(win(closed, 'message')?.lines[0]?.spans).toContainEqual({
    text: 'Leaderboards are closed.',
    rgb: WARN_RGB,
  })
  expect(cursors(closed).map((s) => s.key)).toEqual(['row:empty'])
})

test('the detail: who is online, as a sentence', () => {
  const world: WorldState = {
    ...WORLD_DEFAULT,
    snapshot: {
      serverNow: 0,
      speed: 1,
      online: 8,
      zones: [
        { zone: 1, count: 3 },
        { zone: 2, count: 5 },
      ],
      here: [],
      boss: null,
      chat: [],
      flags: {},
    },
  }
  expect(linesOf(win(boardsPane(input({}, {}, { world })), 'detail'))).toEqual([
    ' Online',
    ' Online by zone: z1 3 · z2 5',
  ])
  expect(linesOf(win(boardsPane(input()), 'detail'))[1]).toBe(' Connecting to the world…')
})

test('wide and narrow pass tilePositions', () => {
  for (const columns of [120, 60]) {
    const b = boardsPane(input({}, {}, { columns }))
    const pos = tilePositions(b.scene)
    for (const w of b.scene.windows)
      expect([w.key, pos.get(w.key)]).toEqual([w.key, { x: w.x, y: w.y ?? 0 }])
  }
})

test('an empty boss board is a stop, so a short pane pages to it', () => {
  const loaded = boardsLoaded().boards
  const boards = {
    boards: loaded ? { ...loaded, highestZone: loaded.highestZone.slice(0, 7), damage: [] } : null,
  }
  const b = boardsPane(input(boards, {}, { rows: 14 }))
  expect(cursors(b).at(-1)?.key).toBe('row:d-none')
  const last = boardsPane(
    input(boards, { cursor: { leaderboards: { id: 'd-none', index: 7 } } }, { rows: 14 }),
  )
  expect(linesOf(win(last, 'list'))).toContain('  Boss damage this week')
  expect(linesOf(win(last, 'list'))).toContain('▶ No boss damage yet this week.')
})
