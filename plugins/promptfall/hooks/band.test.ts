import type { On, RenderElement, UiBlitArgs } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { GameView, Prefs, Settings, WorldState } from '../types'
import { boss, turnBoss, wave, worldBoss } from './stage/fixtures'
import {
  DESKTOP_COLUMN_PX_CEILING,
  DESKTOP_ROW_PX,
  DESKTOP_TEXT_ROWS,
  DISSOLVE_MS,
  DROP_MS,
  SVG_INTERACTIVE,
} from './stage/tuning'
import { SETTINGS_DEFAULT } from './state'
import { bossSegment, worldRows } from './ui/band'
import { Ledger } from './vendor/ledger.js'
import { MemoryKeyValue, type WorldSnapshot } from './vendor/protocol.js'
import { createInitialState } from './vendor/sim.js'
import { WORLD_STALE_MS } from './world'

const SURFACES = ['terminal', 'desktop'] as const

function harness(on: On) {
  const data = new Map<string, unknown>()
  const states = new Map<string, unknown>()
  on('store.get', (_$, e) => ({ value: data.get(e.key) }))
  on('store.set', (_$, e) => {
    data.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined }
  })
  on('store.delete', (_$, e) => {
    data.delete(e.key)
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...data.keys()] }))
  on('state.set', async (_$, e, next) => {
    states.set(e.key, e.value)
    return next(e)
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('ui.toast', () => ({ value: undefined }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  // The engine's own band, drawn when the plugin passes.
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box } = $.ui.resolve(e)
    return h(Box, { key: 'engine-band' }) as RenderElement
  })
  const clock = mock.clock(on, { now: 1_000_000 })
  const blits: (UiBlitArgs & { at: number })[] = []
  const invalidations: number[] = []
  const plays: { asset: string; gain: number | undefined }[] = []
  on('ui.blit', (_$, e) => {
    blits.push({ ...e, at: clock.now() })
    return { value: {} }
  })
  on('ui.invalidate', (_$, e, next) => {
    invalidations.push(clock.now())
    return next(e)
  })
  on('audio.play', (_$, e) => {
    plays.push({ asset: e.clip.asset ?? '', gain: e.gain })
    return { value: undefined }
  })
  // A view the band and the stage loop read in place of the game's own, when set.
  const shown: { view: GameView | null; world: WorldState | null } = { view: null, world: null }
  on('state.get', (_$, e, next) => {
    if (e.key === 'view' && shown.view) return { value: { value: shown.view, version: 1 } }
    if (e.key === 'world' && shown.world) return { value: { value: shown.world, version: 1 } }
    return next(e)
  })
  return { data, states, clock, blits, invalidations, plays, shown }
}

/** Stores machine settings before session.start reads them. */
function settings(data: Map<string, unknown>, patch: Partial<Settings>) {
  data.set('promptfall:settings', { ...SETTINGS_DEFAULT, ...patch })
}

function band(bodyColumns = 120, maxRows = 8, hasSurvey = false) {
  return {
    component: 'AbovePrompt' as const,
    requestId: 'band-test',
    props: {
      hasSurvey,
      isWorking: false,
      maxRows,
      bodyColumns,
      scroll: { offset: 0, bodyRows: maxRows },
      view: {},
    },
  }
}

/** The band's rows: the compact layout's left column, else the band's own children. */
async function rows(ui: {
  find: (q: { key: string }) => Promise<{ children: unknown[] } | undefined>
}) {
  const root = (await ui.find({ key: 'compact-rows' })) ?? (await ui.find({ key: 'band' }))
  return (root?.children ?? []).filter((c) => typeof c === 'object')
}

/** The band's height in terminal rows: the stage's rows count, the full layout's text rows too. */
async function height(ui: {
  find: (q: {
    key: string
  }) => Promise<{ props: Record<string, unknown>; children: unknown[] } | undefined>
}) {
  if (await ui.find({ key: 'compact-rows' })) return 4
  const stage = await ui.find({ key: 'stage' })
  const empty = await ui.find({ key: 'stage-empty' })
  const all = await rows(ui)
  if (stage) return Number(stage.props.rows) + all.length - 1
  if (empty) return empty.children.filter((c) => typeof c === 'object').length + all.length - 1
  return all.length
}

test('the band draws the party and the zone, and passes during a survey', async ($, on) => {
  const { states } = harness(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const view = states.get('view') as GameView
  expect(view.heroes).toHaveLength(3)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'promptfall', surface, ...band() })
    for (const hero of view.heroes) {
      expect(await ui.find({ text: new RegExp(hero.name.split(' ')[0] ?? '') })).toBeDefined()
    }
    expect(await ui.find({ text: /Greenmeadow Road/ })).toBeDefined()
    // A terminal 120 × 8 is the compact stage; the desktop always draws the full one (ADR 0004).
    expect(await rows(ui)).toHaveLength(surface === 'terminal' ? 4 : 3)
    await ui.unmount()

    const survey = await $.ui.mount({ plugin: 'promptfall', surface, ...band(120, 8, true) })
    expect(await survey.find({ key: 'band' })).toBeUndefined()
    expect(await survey.find({ key: 'engine-band' })).toBeDefined()
    await survey.unmount()
  }
})

test('narrow terminals get one row', async ($, on) => {
  harness(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...band(80) })
  expect(await rows(ui)).toHaveLength(1)
  // A notice (here the first-run welcome) shows on the one line too.
  expect(await ui.find({ text: /Welcome to Promptfall/ })).toBeDefined()
  await ui.unmount()
})

test('a narrow desktop still draws the full stage', async ($, on) => {
  harness(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'desktop', ...band(80) })
  expect(await ui.find({ type: 'Svg' })).toBeDefined()
  expect(await rows(ui)).toHaveLength(3)
  await ui.unmount()
})

test('tabs and collapse write prefs', async ($, on) => {
  const { states } = harness(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'promptfall', surface, ...band() })
    await ui.press({ key: 'tab-loot' })
    expect((states.get('prefs') as Prefs).bandTab).toBe('loot')
    await ui.press({ key: 'tab-party' })
    await ui.press({ key: 'collapse' })
    expect((states.get('prefs') as Prefs).collapsed).toBe(true)
    expect(await rows(ui)).toHaveLength(1)
    await ui.press({ key: 'collapse' })
    expect((states.get('prefs') as Prefs).collapsed).toBe(false)
    expect(await rows(ui)).toHaveLength(surface === 'terminal' ? 4 : 3)
    await ui.unmount()
  }
})

test('a secondary session shows one row saying so', async ($, on) => {
  const { data, states, clock } = harness(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  // Another session takes the lease once ours lapses.
  data.set('promptfall:lease', { owner: 'someone-else', until: 9_999_999_999_999 })
  await clock.advance(10_000)
  expect(states.get('mode')).toBe('secondary')
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'promptfall', surface, ...band() })
    const all = await rows(ui)
    expect(all).toHaveLength(1)
    expect(await ui.find({ text: /^playing in another session/ })).toBeDefined()
    await ui.unmount()
  }
})

test('with no game view the band is the notice on one line', async ($, on) => {
  const { data } = harness(on)
  const old = { ...createInitialState(5), v: 1 }
  data.set('promptfall:deviceToken', 'token-1')
  data.set('promptfall:pf:token:token-1', 'acct-1')
  data.set('promptfall:pf:acct:acct-1:record', {
    account: { accountId: 'acct-1', seed: 5, createdAt: 0, displayName: null, linked: null },
    state: old,
    seq: 0,
    refillAt: { tick: 0, tool_call: 0, rest: 0, turn_end: 0 },
    buckets: { tick: 70, tool_call: 140, rest: 30, turn_end: 30 },
    committed: [],
  })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...band() })
  expect(
    await ui.find({
      text: /^Promptfall: this machine's data is from an older version/,
    }),
  ).toBeDefined()
  await ui.unmount()
})

/** A remote server: the vendored ledger for the account routes, canned snapshots for the world poll. */
function remoteWorld(on: On) {
  const ledger = new Ledger({
    kv: new MemoryKeyValue(),
    now: async () => 1_000_000,
    minClientVersion: '0.1.0',
    seedSource: () => 777,
    tokenSource: () => crypto.randomUUID(),
    linkApprover: async () => ({ login: 'remote-player' }),
  })
  const net = {
    down: false,
    world: (): WorldSnapshot => ({
      serverNow: 1_000_000,
      speed: 1,
      online: 13,
      zones: [{ zone: 1, count: 13 }],
      here: ['Ashgrove', 'Brindle'],
      boss: null,
      chat: [{ id: 4, name: 'Corvina', text: 'gg everyone', at: 1 }],
      flags: { 'chat.enabled': true, 'presence.enabled': true },
    }),
  }
  on('http.fetch', async (_$, e) => {
    const path = (e.url.split('?')[0] ?? '').replace(/^https?:\/\/[^/]+/, '')
    const method = e.init?.method ?? 'GET'
    const auth = { deviceToken: (e.init?.headers?.authorization ?? '').replace(/^Bearer /, '') }
    const body = e.init?.body ? JSON.parse(e.init.body) : undefined
    let result: unknown
    if (method === 'GET' && path === '/v1/world') {
      if (net.down) throw new Error('connect ECONNREFUSED')
      result = net.world()
    } else if (method === 'POST' && path === '/v1/bootstrap') result = await ledger.bootstrap(body)
    else if (method === 'POST' && path === '/v1/batches') result = await ledger.submit(body, auth)
    else if (method === 'GET' && path === '/v1/account') result = await ledger.account(auth)
    else return { value: { status: 404, ok: false, headers: {}, text: '{"error":"route"}' } }
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify(result) } }
  })
  return net
}

const RUN = {
  origin: { kind: 'composer' },
  presentation: { isFullscreen: false, columns: 120 },
} as const

test('the World tab reads the in-process world: one online, chat needs a server', async ($, on) => {
  const { states } = harness(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  expect((states.get('world') as WorldState).snapshot?.online).toBe(1)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'promptfall', surface, ...band() })
    await ui.press({ key: 'tab-world' })
    expect(await ui.find({ text: /^1 online · zone 1: nobody else here$/ })).toBeDefined()
    expect(await ui.find({ text: /^highest zone 1 · kills \d+ · wipes \d+/ })).toBeDefined()
    expect(await ui.find({ text: 'chat needs a server' })).toBeDefined()
    expect(await ui.find({ text: /Multiplayer arrives/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('the World tab shows who is here and the last chat line, and dims a stale snapshot', async ($, on) => {
  const { clock, states } = harness(on)
  const net = remoteWorld(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.command.run({ ...RUN, command: 'promptfall', args: 'server http://test' })
  await clock.advance(1)
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...band() })
  await ui.press({ key: 'tab-world' })
  const first = await ui.find({ type: 'Text', text: '13 online · zone 1: Ashgrove, Brindle' })
  expect(first).toBeDefined()
  expect(first?.props.dimColor).toBeFalsy()
  expect(await ui.find({ text: 'Corvina: gg everyone' })).toBeDefined()
  net.down = true
  await clock.advance(WORLD_STALE_MS)
  expect((states.get('world') as WorldState).stale).toBe(true)
  expect((await ui.find({ type: 'Text', text: /^13 online/ }))?.props.dimColor).toBe(true)
  await ui.unmount()
})

test('the snapshot flags win over the bootstrap config: chat closed while the config said open', async ($, on) => {
  const { clock, states } = harness(on)
  const net = remoteWorld(on)
  const open = net.world
  net.world = () => ({ ...open(), flags: { 'chat.enabled': false } })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.command.run({ ...RUN, command: 'promptfall', args: 'server http://test' })
  await clock.advance(1)
  expect((states.get('view') as GameView).account.chatOpen).toBe(true)
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...band() })
  await ui.press({ key: 'tab-world' })
  expect(await ui.find({ text: 'chat is closed' })).toBeDefined()
  await ui.unmount()
})

// ---------------------------------------------------------------------------
// The world boss

const BOSS = {
  bossId: 'wb1',
  name: 'The Promptwyrm',
  glyph: '☠',
  maxHp: 10_000,
  hp: 6_200,
  spawnedAt: 1_000_000,
  endsAt: 1_000_000 + 11 * 60_000 + 30_000,
  yours: 0,
}

function bossWorld(
  boss: WorldSnapshot['boss'],
  committedDealt: WorldState['committedDealt'],
): WorldState {
  return {
    snapshot: {
      serverNow: 1_000_000,
      speed: 1,
      online: 13,
      zones: [{ zone: 1, count: 13 }],
      here: [],
      boss,
      chat: [],
      flags: {},
    },
    fetchedAt: 1_000_000,
    stale: false,
    messages: [],
    chatMark: 0,
    clock: { serverNow: 1_000_000, clientNow: 1_000_000, speed: 1 },
    committedDealt,
  }
}

test('the boss line and the status segment read the snapshot, less what this party dealt since', async ($, on) => {
  const { states } = harness(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const plain = states.get('view') as GameView
  const view = (dealt: number): GameView => ({
    ...plain,
    boss: { bossId: 'wb1', name: BOSS.name, glyph: '☠', dealt },
  })
  const now = 1_000_000
  // The view's tally equals the committed one: the server's HP as it is.
  const even = bossWorld(BOSS, { bossId: 'wb1', dealt: 0 })
  expect(bossSegment(view(0), even, now)).toBe('boss 62% · 11m')
  expect(worldRows(view(0), even, now)[1]?.text).toBe(
    'World boss The Promptwyrm █████░░░ 62% · 11m left · you 0',
  )
  // 300 dealt locally past the committed 200: 5,900 shown.
  const ahead = bossWorld(BOSS, { bossId: 'wb1', dealt: 200 })
  expect(bossSegment(view(500), ahead, now)).toBe('boss 59% · 11m')
  // A secondary has no committed reading: nothing is subtracted.
  expect(bossSegment(view(500), bossWorld(BOSS, null), now)).toBe('boss 62% · 11m')
  // Down: no segment, and the World row says so.
  const down = bossWorld({ ...BOSS, hp: 0 }, null)
  expect(bossSegment(view(500), down, now)).toBeNull()
  expect(worldRows(view(500), down, now)[1]?.text).toBe('The Promptwyrm is down · you 500')
})

/** A remote ledger at http://test whose clock the test moves; `boss` overrides the snapshot's. */
function bossNet(on: On) {
  const net = {
    now: 10_800_000 - 1_000,
    boss: undefined as WorldSnapshot['boss'] | undefined,
  }
  const ledger = new Ledger({
    kv: new MemoryKeyValue(),
    now: async () => net.now,
    minClientVersion: '0.1.0',
    seedSource: () => 777,
    tokenSource: () => crypto.randomUUID(),
    linkApprover: async () => ({ login: 'remote-player' }),
  })
  on('http.fetch', async (_$, e) => {
    const [full, query = ''] = e.url.split('?')
    const path = (full ?? '').replace(/^https?:\/\/[^/]+/, '')
    const method = e.init?.method ?? 'GET'
    const auth = { deviceToken: (e.init?.headers?.authorization ?? '').replace(/^Bearer /, '') }
    const body = e.init?.body ? JSON.parse(e.init.body) : undefined
    let result: unknown
    if (method === 'GET' && path === '/v1/world') {
      const w = await ledger.world(auth, Number(/since=(\d+)/.exec(query)?.[1] ?? 0))
      result = net.boss !== undefined && !('reason' in w) ? { ...w, boss: net.boss } : w
    } else if (method === 'POST' && path === '/v1/bootstrap') result = await ledger.bootstrap(body)
    else if (method === 'POST' && path === '/v1/batches') result = await ledger.submit(body, auth)
    else if (method === 'GET' && path === '/v1/account') result = await ledger.account(auth)
    else return { value: { status: 404, ok: false, headers: {}, text: '{"error":"route"}' } }
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify(result) } }
  })
  return net
}

test('in boss mode the first enemy slot is the boss with its bar; without the boss in the snapshot, the name and you', async ($, on) => {
  const { clock, states } = harness(on)
  const net = bossNet(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.command.run({ ...RUN, command: 'promptfall', args: 'server http://test' })
  await clock.advance(1)
  net.now = 10_800_000 + 1_000
  await clock.advance(30_000)
  const view = states.get('view') as GameView
  const world = states.get('world') as WorldState
  const boss = world.snapshot?.boss
  if (!boss || !view.boss) throw new Error('not in boss mode')
  expect(view.boss.bossId).toBe(boss.bossId)
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...band(150) })
  await ui.press({ key: 'tab-party' })
  expect(
    await ui.find({ type: 'Text', text: new RegExp(`⚔ ${boss.glyph} ${boss.name}\\s*$`) }),
  ).toBeDefined()
  expect(await ui.find({ key: 'boss-slot' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /\/4,000\s*$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /boss \d+% · / })).toBeDefined()
  await ui.unmount()
  net.boss = null
  await clock.advance(5_000)
  const again = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...band(150) })
  expect(await again.find({ key: 'boss-slot' })).toBeUndefined()
  // The name keeps the first row; what you dealt takes the bar's place on the second.
  expect(
    await again.find({ type: 'Text', text: new RegExp(`⚔ ${boss.glyph} ${boss.name}\\s*$`) }),
  ).toBeDefined()
  expect(await again.find({ type: 'Text', text: /^ {3}you \d+/ })).toBeDefined()
  await again.unmount()
})

// ---------------------------------------------------------------------------
// The stage

const RASTER = { renderer: 'raster' } as const

test('the full layout: a 120 × 8 Raster, the party line and the status row, 10 rows', async ($, on) => {
  const { data, shown } = harness(on)
  settings(data, RASTER)
  shown.view = wave()
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...band(120, 20) })
  const stage = await ui.find({ key: 'stage' })
  expect(stage?.type).toBe('Raster')
  expect([stage?.props.columns, stage?.props.rows]).toEqual([120, 8])
  expect(await height(ui)).toBe(10)
  const party = await ui.find({ key: 'row-party' })
  expect(party?.text).toContain('⚔')
  await ui.unmount()
})

for (const [name, view, rowsOf] of [
  ['a zone boss grows the stage to 17 rows', boss, 17],
  ['a turn boss grows the stage to 12 rows', turnBoss, 12],
] as const) {
  test(name, async ($, on) => {
    const { data, shown } = harness(on)
    settings(data, RASTER)
    shown.view = view()
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
    const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...band(120, 20) })
    const stage = await ui.find({ key: 'stage' })
    expect([stage?.props.columns, stage?.props.rows]).toEqual([120, rowsOf])
    expect(await height(ui)).toBe(rowsOf + 2)
    await ui.unmount()
  })
}

test('too short for the boss: compact, then full again once the boss is gone', async ($, on) => {
  const { data, shown, clock } = harness(on)
  settings(data, RASTER)
  shown.view = boss()
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...band(120, 12) })
  expect(await height(ui)).toBe(4)
  const stage = await ui.find({ key: 'stage' })
  expect([stage?.props.columns, stage?.props.rows]).toEqual([52, 4])
  shown.view = wave()
  await clock.advance(DISSOLVE_MS + DROP_MS + 1)
  await ui.unmount()
  const after = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...band(120, 12) })
  expect(await height(after)).toBe(10)
  await after.unmount()
})

test('110 columns is compact with the enemy slots; 99 is one row', async ($, on) => {
  const { data, shown } = harness(on)
  settings(data, RASTER)
  shown.view = wave()
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...band(110, 20) })
  expect(await height(ui)).toBe(4)
  expect(await ui.find({ text: /⚔ \? Goblin/ })).toBeDefined()
  await ui.unmount()
  const narrow = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...band(99, 20) })
  expect(await rows(narrow)).toHaveLength(1)
  expect(await narrow.find({ key: 'stage' })).toBeUndefined()
  await narrow.unmount()
})

test('the image renderer draws an Image with an alt, keyed by its size', async ($, on) => {
  const { data } = harness(on)
  settings(data, { renderer: 'image' })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...band(120, 20) })
  const stage = await ui.find({ key: 'stage-120x8' })
  expect(stage?.type).toBe('Image')
  expect([stage?.props.columns, stage?.props.rows]).toEqual([120, 8])
  expect(String(stage?.props.alt)).toMatch(/^Zone 1/)
  await ui.unmount()
})

test('a boss growing the image stage mounts a new Image, and the loop blits to it', async ($, on) => {
  // Ghostty kept a grown keyed Image at its first placement's height: each size is its own key.
  const { data, shown, clock, blits } = harness(on)
  settings(data, { renderer: 'image' })
  shown.view = wave()
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...band(120, 20) })
  expect(await ui.find({ key: 'stage-120x8' })).toBeDefined()
  shown.view = boss()
  await clock.advance(1_000)
  await ui.unmount()
  const grown = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...band(120, 20) })
  expect(await grown.find({ key: 'stage-120x8' })).toBeUndefined()
  expect((await grown.find({ key: 'stage-120x17' }))?.props.rows).toBe(17)
  const before = blits.length
  await clock.advance(1_000)
  const after = blits.slice(before)
  expect(after.length).toBeGreaterThan(0)
  for (const b of after) expect(b).toMatchObject({ key: 'stage-120x17', rows: 17 })
  await grown.unmount()
})

test('while the renderer is unknown the stage rows are empty and the status row probes', async ($, on) => {
  harness(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...band(120, 20) })
  expect(await ui.find({ key: 'stage' })).toBeUndefined()
  const status = await ui.find({ key: 'row-status' })
  expect(
    status?.children.some((c) => (c as { props?: { key?: string } }).props?.key === 'probe'),
  ).toBe(true)
  const probe = await ui.find({ key: 'probe' })
  expect(probe?.type).toBe('Image')
  expect([probe?.props.columns, probe?.props.rows]).toEqual([1, 1])
  expect(await height(ui)).toBe(10)
  await ui.unmount()
})

test('the desktop draws an Svg with its alt', async ($, on) => {
  harness(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'desktop', ...band(120, 20) })
  // The desktop's Svg keeps no key: find it by type.
  const stage = await ui.find({ type: 'Svg' })
  expect(stage?.type).toBe('Svg')
  // An image: SMIL runs in it and a new source swaps in without the frame's blank reload.
  expect(stage?.props.isInteractive).toBe(SVG_INTERACTIVE)
  expect(SVG_INTERACTIVE).toBe(false)
  expect(String(stage?.props.alt)).toMatch(/^Zone 1/)
  await ui.unmount()
})

for (const [columns, art] of [
  [95, 116],
  [60, 116],
  [130, 130],
] as const) {
  test(`the desktop at ${columns} × 12 draws the full stage ${art} pixels wide`, async ($, on) => {
    harness(on)
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
    const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'desktop', ...band(columns, 12) })
    const stage = await ui.find({ type: 'Svg' })
    const source = String(stage?.props.source)
    expect(source).toContain(`viewBox="0 0 ${art} 16"`)
    expect(String(stage?.props.alt)).toMatch(/^Zone 1/)
    // No width prop: the markup is wider than the band and the desktop scales it down to fit.
    expect(stage?.props.width).toBeUndefined()
    expect(source).toContain(`width="${columns * DESKTOP_COLUMN_PX_CEILING}"`)
    await ui.unmount()
  })
}

test('the desktop grows the stage for a zone boss whatever maxRows says', async ($, on) => {
  const { shown } = harness(on)
  shown.view = boss()
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'desktop', ...band(95, 12) })
  const stage = await ui.find({ type: 'Svg' })
  expect(String(stage?.props.source)).toContain('viewBox="0 0 116 34"')
  expect(await ui.find({ key: 'compact-rows' })).toBeUndefined()
  const party = await ui.find({ key: 'row-party' })
  expect(party?.text).toContain('⚔')
  await ui.unmount()
})

test('Loot and World keep four rows, draw no stage and blit nothing', async ($, on) => {
  const { data, blits, clock } = harness(on)
  settings(data, RASTER)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...band(120, 20) })
  for (const tab of ['tab-loot', 'tab-world']) {
    await ui.press({ key: tab })
    expect(await rows(ui)).toHaveLength(4)
    expect(await ui.find({ key: 'stage' })).toBeUndefined()
    const before = blits.length
    await clock.advance(5_000)
    expect(blits.length).toBe(before)
  }
  await ui.unmount()
})

test('a round of hits blits the stage at the event rate', async ($, on) => {
  const { data, blits, clock, states } = harness(on)
  settings(data, RASTER)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...band(120, 20) })
  for (let i = 0; i < 20 && (states.get('view') as GameView).enemies.length === 0; i++) {
    await clock.advance(5_000)
  }
  // The next tick fights a round.
  await clock.advance(5_000)
  const before = blits.length
  await clock.advance(1_000)
  const round = blits.slice(before)
  expect(round.length).toBeGreaterThanOrEqual(10)
  for (const b of round) expect(b).toMatchObject({ requestId: 'band-test', key: 'stage' })
  await ui.unmount()
})

test('with motion still and nothing happening, nothing blits', async ($, on) => {
  const { data, blits, clock, shown } = harness(on)
  settings(data, { ...RASTER, motion: 'still' })
  shown.view = wave()
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...band(120, 20) })
  await clock.advance(5_000)
  expect(blits).toHaveLength(0)
  await ui.unmount()
})

test('a survey hides the stage and nothing blits', async ($, on) => {
  const { data, blits, clock } = harness(on)
  settings(data, RASTER)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...band(120, 20, true) })
  expect(await ui.find({ key: 'stage' })).toBeUndefined()
  await clock.advance(5_000)
  expect(blits).toHaveLength(0)
  await ui.unmount()
})

test('in boss mode the party line fits its width: the boss name gives way, not the heroes', async ($, on) => {
  const { data, shown } = harness(on)
  settings(data, { renderer: 'raster' })
  const view = worldBoss()
  view.boss = { bossId: BOSS.bossId, name: BOSS.name, glyph: BOSS.glyph, dealt: 0 }
  view.heroes = view.heroes.map((h) => ({ ...h, hp: 15, maxHp: 69 }))
  shown.view = view
  shown.world = bossWorld({ ...BOSS, maxHp: 52_000, hp: 42_604 }, null)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  for (const width of [122, 140, 160]) {
    const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...band(width, 30) })
    const line = (await ui.find({ key: 'row-party' }))?.text ?? ''
    expect([...line].length).toBeLessThanOrEqual(width)
    expect(line.match(/15\/69/g)).toHaveLength(3)
    expect(line).toContain('42,604/52,000')
    await ui.unmount()
  }
})

test('on the desktop the party line wraps whole segments: no hero cut, the boss keeps its name and bar', async ($, on) => {
  const { shown } = harness(on)
  const view = worldBoss()
  view.boss = { bossId: BOSS.bossId, name: BOSS.name, glyph: BOSS.glyph, dealt: 0 }
  view.heroes = view.heroes.map((h) => ({ ...h, hp: 15, maxHp: 69 }))
  shown.view = view
  shown.world = bossWorld({ ...BOSS, maxHp: 52_000, hp: 42_604 }, null)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  for (const width of [60, 95]) {
    const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'desktop', ...band(width, 12) })
    const party = await ui.find({ key: 'row-party' })
    expect(party?.props.flexWrap).toBe('wrap')
    const line = party?.text ?? ''
    expect(line.match(/15\/69/g)).toHaveLength(3)
    for (const hero of view.heroes) expect(line).toContain(hero.name.slice(0, 8))
    expect(line).toContain(`⚔ ${BOSS.name.slice(0, 11)}`)
    expect(line).toContain('42,604/52,000')
    await ui.unmount()
  }
})

test('on the desktop the stage sits in a column, so its frame takes the band width', async ($, on) => {
  // In a row Box the desktop draws an interactive Svg's frame at the default 300 × 150 points.
  harness(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'desktop', ...band(95, 12) })
  expect((await ui.find({ key: 'row-stage' }))?.props.flexDirection).toBe('column')
  await ui.unmount()
})

test('on the desktop the party line names are whole, not padded or cut', async ($, on) => {
  const { states } = harness(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const view = states.get('view') as GameView
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'desktop', ...band(95, 12) })
  const hero = view.heroes[0]
  if (!hero) throw new Error('no hero')
  const segment = (await ui.find({ key: 'seg-0' }))?.text ?? ''
  expect(segment).toContain(`${hero.name} L${hero.level}`)
  expect(segment).not.toContain('  ')
  expect((await ui.find({ key: 'hero-0' }))?.props.wrap).not.toBe('truncate')
  await ui.unmount()
})

test('on the desktop a boss stage is scaled down to fit the band, the rest stage is not', async ($, on) => {
  const { shown } = harness(on)
  shown.view = boss()
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'desktop', ...band(95, 12) })
  const stage = await ui.find({ type: 'Svg' })
  // 12 rows of 19 points, less the party line (two rows when it wraps) and the status row.
  const cap = (12 - DESKTOP_TEXT_ROWS) * DESKTOP_ROW_PX
  expect(stage?.props.height).toBe(Math.round(cap))
  expect(stage?.props.width).toBe(Math.floor((cap * 116) / 34))
  await ui.unmount()
  shown.view = wave()
  const rest = await $.ui.mount({ plugin: 'promptfall', surface: 'desktop', ...band(95, 12) })
  const small = await rest.find({ type: 'Svg' })
  expect(small?.props.height).toBeUndefined()
  expect(small?.props.width).toBeUndefined()
  await rest.unmount()
})

test('on a desktop band of three rows the boss stage keeps a positive size', async ($, on) => {
  const { shown } = harness(on)
  shown.view = boss()
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'desktop', ...band(95, 3) })
  const stage = await ui.find({ type: 'Svg' })
  expect(stage).toBeDefined()
  for (const v of [stage?.props.width, stage?.props.height]) {
    if (v !== undefined) expect(Number(v)).toBeGreaterThan(0)
  }
  await ui.unmount()
})

test('forcing a renderer before the probe answers keeps the probe going for this session', async ($, on) => {
  const { data } = harness(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  // /promptfall renderer raster applies from the next start; this session still has to decide.
  data.set('promptfall:settings', { ...SETTINGS_DEFAULT, renderer: 'raster' })
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...band(120, 20) })
  expect(await ui.find({ key: 'probe' })).toBeDefined()
  await ui.unmount()
})
