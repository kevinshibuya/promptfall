import { expect, test } from 'claude-code/testing'
import type { HuntView, WorldState } from '../../types'
import { wave } from '../stage/fixtures'
import { strip } from '../stage/scenarios'
import type { Scene, Win } from '../windows/kit'
import { stripScene } from './strip'
import { recordsRow, worldRows } from './world-rows'

const NOW = 1_000_000
const HOUR = 3_600_000
const DAY = 24 * HOUR

/** A fresh snapshot with no boss up and no hunt, chat closed, the hunt on, and `flags` on top. */
function worldWith(flags: Record<string, boolean>, hunt: HuntView | null = null): WorldState {
  return {
    snapshot: {
      serverNow: NOW,
      speed: 1,
      online: 1,
      zones: [{ zone: 1, count: 1 }],
      here: [],
      boss: null,
      hunt,
      chat: [],
      flags: {
        'chat.enabled': false,
        'presence.enabled': true,
        'hunt.enabled': true,
        ...flags,
      },
    },
    fetchedAt: NOW,
    stale: false,
    messages: [],
    chatMark: 0,
    clock: { serverNow: NOW, clientNow: NOW, speed: 1 },
    committedDealt: null,
  }
}

const messageText = (scene: Scene) =>
  (scene.windows.find((w) => w.key === 'message') as Win).lines
    .flatMap((l) => l.spans)
    .map((s) => ('text' in s ? s.text : ''))
    .join('')

test('the presence row names the running zone as today inside tier 1, by its tier past it', () => {
  const world = worldWith({})
  expect(worldRows({ ...wave(), zone: 12 }, world, NOW)[0]?.text).toBe(
    '1 online · zone 12: nobody else here',
  )
  expect(worldRows({ ...wave(), zone: 13 }, world, NOW)[0]?.text).toBe(
    '1 online · T2 Z1: nobody else here',
  )
})

test('the World rows say the boss is off in place', () => {
  const view = wave()
  const off = worldRows(view, worldWith({ 'worldboss.enabled': false }), NOW)[1]
  expect(off?.text).toBe('highest zone 1 · kills 0 · wipes 0 · world boss is off')
  // On, with no boss up: the records as they were.
  const on = worldRows(view, worldWith({ 'worldboss.enabled': true }), NOW)[1]
  expect(on?.text).toBe('highest zone 1 · kills 0 · wipes 0')
  const tier2 = worldRows(
    { ...view, highestZone: 13 },
    worldWith({ 'worldboss.enabled': true }),
    NOW,
  )
  expect(tier2[1]?.text).toBe('highest zone T2 Z1 · kills 0 · wipes 0')
  // Before the first snapshot the bootstrap config's flag decides.
  const before: WorldState = { ...worldWith({}), snapshot: null }
  expect(worldRows(view, before, NOW)[1]?.text).toMatch(/ · world boss and hunt are off$/)
  const open = { ...view, account: { ...view.account, bossOpen: true } }
  expect(worldRows(open, before, NOW)[1]?.text).toBe(
    'highest zone 1 · kills 0 · wipes 0 · hunt is off',
  )
  const both = { ...view, account: { ...view.account, bossOpen: true, huntOpen: true } }
  expect(worldRows(both, before, NOW)[1]?.text).toBe('highest zone 1 · kills 0 · wipes 0')
  // The strip's World tab draws the same row while chat is closed, when the row has room for it.
  const input = strip('strip-world')
  const world = worldWith({ 'worldboss.enabled': false })
  const shown = (columns: number, w = world) =>
    messageText(stripScene({ ...input, world: w, columns }).scene)
  expect(shown(114)).toContain('highest zone 1 · kills 0 · wipes 0 · world boss is off')
  expect(shown(140)).toContain('highest zone 1 · kills 0 · wipes 0 · world boss is off')
  // At 120 the enemy window leaves 36 cells: the records whole, the note dropped.
  expect(shown(120)).toContain('highest zone 1 · kills 0 · wipes 0')
  expect(shown(120)).not.toContain('world boss')
  expect(shown(140, worldWith({ 'worldboss.enabled': true }))).not.toContain('world boss')
})

const HUNT: HuntView = {
  name: 'casters',
  target: 20_000,
  count: 12_400,
  endsAt: NOW + 3 * DAY + 5 * HOUR,
  yours: 120,
}

test("the records row shows the week's hunt after the highest zone and the kills, with its bar when there is room", () => {
  const view = wave()
  const world = worldWith({ 'worldboss.enabled': true }, HUNT)
  expect(worldRows(view, world, NOW)[1]?.text).toBe(
    'highest zone 1 · kills 0 · Hunt: casters ████░░░░ 12,400 / 20,000, 3 days left · wipes 0',
  )
  // Narrower, the bar goes, then the wipes, then the hunt.
  expect(recordsRow(view, world, 88, NOW)).toBe(
    'highest zone 1 · kills 0 · Hunt: casters ████░░░░ 12,400 / 20,000, 3 days left · wipes 0',
  )
  expect(recordsRow(view, world, 87, NOW)).toBe(
    'highest zone 1 · kills 0 · Hunt: casters 12,400 / 20,000, 3 days left · wipes 0',
  )
  expect(recordsRow(view, world, 78, NOW)).toBe(
    'highest zone 1 · kills 0 · Hunt: casters 12,400 / 20,000, 3 days left',
  )
  expect(recordsRow(view, world, 68, NOW)).toBe('highest zone 1 · kills 0 · wipes 0')
  // The days left fall to one, then to hours; a count past the target fills the bar.
  const late = worldWith({ 'worldboss.enabled': true }, { ...HUNT, endsAt: NOW + DAY + HOUR })
  expect(worldRows(view, late, NOW)[1]?.text).toMatch(/, 1 day left · wipes 0$/)
  const last = worldWith(
    { 'worldboss.enabled': true },
    { ...HUNT, count: 25_000, endsAt: NOW + 16 * HOUR },
  )
  expect(worldRows(view, last, NOW)[1]?.text).toMatch(/ ████████ 25,000 \/ 20,000, 16h left · /)
  // The boss off still says so after the hunt.
  expect(worldRows(view, worldWith({ 'worldboss.enabled': false }, HUNT), NOW)[1]?.text).toBe(
    'highest zone 1 · kills 0 · Hunt: casters ████░░░░ 12,400 / 20,000, 3 days left · wipes 0 · world boss is off',
  )
  // The strip's World tab draws it while chat is closed, when the row has room for it: at 160
  // columns the message window has 76 cells, at 140 it has 56.
  const input = strip('strip-world')
  const shown = (columns: number) => messageText(stripScene({ ...input, world, columns }).scene)
  expect(shown(160)).toContain(
    'highest zone 1 · kills 0 · Hunt: casters 12,400 / 20,000, 3 days left',
  )
  expect(shown(140)).toContain('highest zone 1 · kills 0 · wipes 0')
  expect(shown(140)).not.toContain('Hunt')
})

test('the records row says the hunt is off in place, and both when the world boss is off too', () => {
  const view = wave()
  const huntOff = worldWith({ 'hunt.enabled': false, 'worldboss.enabled': true }, HUNT)
  expect(worldRows(view, huntOff, NOW)[1]?.text).toBe(
    'highest zone 1 · kills 0 · wipes 0 · hunt is off',
  )
  const both = worldWith({ 'hunt.enabled': false, 'worldboss.enabled': false })
  expect(worldRows(view, both, NOW)[1]?.text).toBe(
    'highest zone 1 · kills 0 · wipes 0 · world boss and hunt are off',
  )
})
