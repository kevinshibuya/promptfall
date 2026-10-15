import { expect, test } from 'claude-code/testing'
import type { GameView, HuntView, WorldState } from '../../types'
import { wave } from '../stage/fixtures'
import { strip } from '../stage/scenarios'
import type { Scene, Win } from '../windows/kit'
import { stripScene } from './strip'
import { recordsRow, worldRows, worldTabRows } from './world-rows'

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
  // The full strip is 116 columns or more, the enemy window always in it (the stage on every tab).
  const input = strip('strip-world')
  const world = worldWith({ 'worldboss.enabled': false })
  const shown = (columns: number, w = world) =>
    messageText(stripScene({ ...input, world: w, columns }).scene)
  expect(shown(140)).toContain('highest zone 1 · kills 0 · wipes 0 · world boss is off')
  // At 120 the enemy window leaves 36 cells: the records shortened, the note kept.
  expect(shown(120)).toContain('Z1 K0 W0 · world boss is off')
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
  // Narrower, the counts shorten, then the time, then the records, then the bar to 4 cells; the
  // records go before the hunt, and the bar last.
  const chain = [
    [
      88,
      'highest zone 1 · kills 0 · Hunt: casters ████░░░░ 12,400 / 20,000, 3 days left · wipes 0',
    ],
    [87, 'highest zone 1 · kills 0 · Hunt: casters ████░░░░ 12.4k / 20k, 3 days left · wipes 0'],
    [83, 'highest zone 1 · kills 0 · Hunt casters ████░░░░ 12.4k / 20k 3d · wipes 0'],
    [72, 'Z1 K0 W0 · Hunt casters ████░░░░ 12.4k / 20k 3d'],
    [46, 'Z1 K0 W0 · Hunt casters ██░░ 12.4k / 20k 3d'],
    [42, 'Hunt casters ██░░ 12.4k / 20k 3d'],
    [31, 'Hunt casters ██░░ 12k/20k 3d'],
    [27, 'Hunt casters 12k/20k 3d'],
    [22, 'Z1 K0 W0'],
  ] as const
  for (const [cells, row] of chain)
    expect(recordsRow(view, world, cells, NOW), `${cells}`).toBe(row)
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
  // The strip's World tab draws it in its first row whatever chat shows: at 160 columns the
  // message window has 76 cells, at 140 it has 56.
  const input = strip('strip-world')
  const shown = (columns: number) => messageText(stripScene({ ...input, world, columns }).scene)
  expect(shown(160)).toContain(
    'highest zone 1 · kills 0 · Hunt casters ████░░░░ 12.4k / 20k 3d · wipes 0',
  )
  expect(shown(140)).toContain('Z1 K0 W0 · Hunt casters ████░░░░ 12.4k / 20k 3d')
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

/** The hunt on, the world boss on, chat open, `messages` in the chat tail, a remote server. */
function chatWorld(messages: WorldState['messages']): WorldState {
  const w = worldWith({ 'chat.enabled': true, 'worldboss.enabled': true }, HUNT)
  return { ...w, messages }
}
const remote = (view: GameView): GameView => ({
  ...view,
  account: { ...view.account, server: 'https://promptfall.example' },
})
const SAY = { id: 1, name: 'Kit', text: 'anyone farming zone 1?', at: NOW - 5000 }

test('the World tab at two rows: the records row, then chat; neither displaces the other', () => {
  const view = remote(wave())
  const live = worldTabRows(view, chatWorld([SAY]), 2, 30, NOW)
  expect(live.rows).toEqual([
    { text: 'Hunt casters ██░░ 12k/20k 3d', dim: false },
    { text: 'Kit: anyone farming zone 1?', dim: false },
  ])
  // Chat quiet, closed, or on the in-process fake: a dim word in row two, row one unchanged.
  const quiet = worldTabRows(view, chatWorld([]), 2, 30, NOW).rows
  expect(quiet).toEqual([live.rows[0], { text: 'chat is quiet', dim: true }])
  const closed = { ...chatWorld([SAY]), snapshot: worldWith({}, HUNT).snapshot }
  expect(worldTabRows(view, closed, 2, 30, NOW).rows[1]).toEqual({
    text: 'chat is closed',
    dim: true,
  })
  expect(worldTabRows(wave(), closed, 2, 30, NOW).rows[1]).toEqual({
    text: 'chat needs a server',
    dim: true,
  })
  // A message longer than the row is cut with an ellipsis, the one cut the World rows make.
  const long = { ...SAY, text: 'has anyone found the iron sword in zone four yet' }
  const cut = worldTabRows(view, chatWorld([long]), 2, 30, NOW).rows[1]
  expect(cut).toEqual({ text: 'Kit: has anyone found the iro…', dim: false })
})

test('at two rows presence is for the command line: the names, then the zone, then the count', () => {
  const quiet = chatWorld([])
  const snapshot = quiet.snapshot as NonNullable<WorldState['snapshot']>
  const world = { ...quiet, snapshot: { ...snapshot, online: 13, here: ['Bea', 'Kit'] } }
  const { presence } = worldTabRows(wave(), world, 2, 30, NOW)
  expect(presence).toEqual({
    parts: [['13 online', 'zone 1: Bea, Kit'], ['13 online', 'zone 1'], ['13 online']],
    dim: false,
  })
  expect(worldTabRows(wave(), { ...world, stale: true }, 2, 30, NOW).presence?.dim).toBe(true)
  // The gated texts take its place, dim.
  const off = worldWith({ 'presence.enabled': false })
  expect(worldTabRows(wave(), off, 2, 30, NOW).presence).toEqual({
    parts: [['presence is off']],
    dim: true,
  })
  const before: WorldState = { ...world, snapshot: null }
  const open = { ...wave(), account: { ...wave().account, presenceOpen: true } }
  expect(worldTabRows(open, before, 2, 30, NOW).presence).toEqual({
    parts: [['connecting to the world…']],
    dim: true,
  })
})

test('the World tab at four rows, for the compact band: presence, records, chat, blank', () => {
  const view = remote(wave())
  const { rows, presence } = worldTabRows(view, chatWorld([SAY]), 4, 30, NOW)
  expect(presence).toBeNull()
  expect(rows).toEqual([
    { text: '1 online · zone 1', dim: false },
    { text: 'Hunt casters ██░░ 12k/20k 3d', dim: false },
    { text: 'Kit: anyone farming zone 1?', dim: false },
    { text: '', dim: false },
  ])
})

test('the records row keeps the off notices at the full band’s narrowest, the records short or gone', () => {
  for (const cells of [30, 34]) {
    const bossOff = worldWith({ 'worldboss.enabled': false }, HUNT)
    expect(recordsRow(wave(), bossOff, cells, NOW)).toBe('Z1 K0 W0 · world boss is off')
    const huntOff = worldWith({ 'hunt.enabled': false, 'worldboss.enabled': true }, HUNT)
    expect(recordsRow(wave(), huntOff, cells, NOW)).toBe('Z1 K0 W0 · hunt is off')
    const both = worldWith({ 'hunt.enabled': false, 'worldboss.enabled': false })
    expect(recordsRow(wave(), both, cells, NOW)).toBe('world boss and hunt are off')
  }
  // With the hunt on and nothing off: the hunt with its bar at both widths.
  const on = worldWith({ 'worldboss.enabled': true }, HUNT)
  expect(recordsRow(wave(), on, 30, NOW)).toBe('Hunt casters ██░░ 12k/20k 3d')
  expect(recordsRow(wave(), on, 34, NOW)).toBe('Hunt casters ██░░ 12.4k / 20k 3d')
  // The short records: the zone, the kills and the wipes as letters, a big count in thousands.
  const veteran = { ...wave(), highestZone: 9, kills: 184, wipes: 90 }
  const quiet = worldWith({ 'worldboss.enabled': true })
  expect(recordsRow(veteran, quiet, 30, NOW)).toBe('Z9 K184 W90')
  expect(recordsRow({ ...veteran, kills: 12_480 }, quiet, 30, NOW)).toBe('Z9 K12.4k W90')
})
