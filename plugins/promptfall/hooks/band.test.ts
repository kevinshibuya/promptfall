import type { On, RenderElement, UiBlitArgs } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { GameView, Prefs, Settings, WorldState } from '../types'
import { decode } from './sprites/base64'
import { boss, turnBoss, wave } from './stage/fixtures'
import {
  DESKTOP_COLUMN_PX,
  DESKTOP_COLUMN_PX_CEILING,
  DESKTOP_ROW_PX,
  DISSOLVE_MS,
  DROP_MS,
  SVG_INTERACTIVE,
} from './stage/tuning'
import { SETTINGS_DEFAULT } from './state'
import { shownBoss, worldRows } from './ui/band'
import { Ledger } from './vendor/ledger.js'
import { MemoryKeyValue, type WorldSnapshot } from './vendor/protocol.js'
import { createInitialState } from './vendor/sim.js'
import { CELL_H, CELL_W, DIM_RGB, STRIP_ROWS } from './windows/tuning'
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
  const shown: {
    view: GameView | null
    world: WorldState | null
    /** Set (null included) to replace the game's notice: the first-run welcome takes a strip row. */
    notice?: string | null
  } = { view: null, world: null }
  on('state.get', async (_$, e, next) => {
    if (e.key === 'view' && shown.view) return { value: { value: shown.view, version: 1 } }
    if (e.key === 'world' && shown.world) return { value: { value: shown.world, version: 1 } }
    if (e.key === 'notice' && shown.notice !== undefined) {
      // The real version passes through, so the engine's own updates still land.
      const real = await next(e)
      return 'value' in real && real.value
        ? { value: { ...real.value, value: shown.notice } }
        : real
    }
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

type Node = { type?: string; props: Record<string, unknown>; children: unknown[] }
type Finder = {
  find: (q: { key?: string; type?: string }) => Promise<Node | undefined>
}

/** The band's own rows: its root's children. */
async function rows(ui: Finder) {
  const root = await ui.find({ key: 'band' })
  return (root?.children ?? []).filter((c) => typeof c === 'object')
}

/** A Raster's cells as rows of text and their foreground colours. */
function cellsOf(node: Node | undefined): { text: string[]; fg: number[][] } {
  if (!node) return { text: [], fg: [] }
  const columns = Number(node.props.columns)
  const bytes = decode(String(node.props.cells))
  const words = new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4)
  const rowsN = words.length / 3 / columns
  const text: string[] = []
  const fg: number[][] = []
  for (let y = 0; y < rowsN; y++) {
    let line = ''
    const colours: number[] = []
    for (let x = 0; x < columns; x++) {
      const w = (y * columns + x) * 3
      line += String.fromCodePoint(words[w] ?? 32)
      colours.push(words[w + 1] ?? 0)
    }
    text.push(line)
    fg.push(colours)
  }
  return { text, fg }
}

/** What the strip says: its Raster's text, else its pictures' alts. */
async function stripText(ui: Finder): Promise<string> {
  const strip = await ui.find({ key: 'strip' })
  if (strip?.type === 'Raster') return cellsOf(strip).text.join('\n')
  // The desktop's Svgs keep no key: the strip's is the strip row's first child.
  const first = ((await ui.find({ key: 'row-strip' }))?.children ?? [])[0] as Node | undefined
  if (first?.type === 'Svg') return String(first.props.alt)
  const windows = await ui.find({ key: 'strip-windows' })
  return ((windows?.children ?? []) as Node[]).map((c) => String(c.props?.alt ?? '')).join('\n')
}

/** The desktop's two Svgs, which keep no key: the stage's first in the band, the strip's in its row. */
async function svgs(ui: Finder): Promise<{ stage: Node | undefined; strip: Node | undefined }> {
  const stageRow = await ui.find({ key: 'row-stage' })
  const stripRow = await ui.find({ key: 'row-strip' })
  return {
    stage: (stageRow?.children ?? [])[0] as Node | undefined,
    strip: (stripRow?.children ?? [])[0] as Node | undefined,
  }
}

/** The band's height in terminal rows: the stage's rows and the strip's, or 6 for compact. */
async function height(ui: Finder) {
  if (await ui.find({ key: 'compact-stage' })) return 6
  const count = async (key: string) => {
    const n = await ui.find({ key })
    if (!n) return 0
    if (n.props.rows !== undefined) return Number(n.props.rows)
    return n.children.filter((c) => typeof c === 'object').length
  }
  const stage = (await count('stage')) || (await count('stage-empty'))
  const strip = (await count('strip')) || (await count('strip-empty'))
  return stage + strip + ((await ui.find({ key: 'row-hotkeys' })) ? 1 : 0)
}

const RASTER = { renderer: 'raster' } as const

test('the band draws the strip under the stage, and passes during a survey', async ($, on) => {
  const { data, states } = harness(on)
  settings(data, RASTER)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const view = states.get('view') as GameView
  expect(view.heroes).toHaveLength(3)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'promptfall', surface, ...band(120, 20) })
    const text = await stripText(ui)
    for (const hero of view.heroes) expect(text).toContain(hero.shortName)
    expect(text).toContain('Zone 1')
    await ui.unmount()

    const survey = await $.ui.mount({ plugin: 'promptfall', surface, ...band(120, 20, true) })
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

test('a narrow desktop draws the full stage and the strip, laid out in 116 columns and scaled', async ($, on) => {
  harness(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'desktop', ...band(95, 20) })
  const { stage, strip } = await svgs(ui)
  expect(stage?.type).toBe('Svg')
  expect(strip?.type).toBe('Svg')
  expect(String(strip?.props.source)).toContain(
    `viewBox="0 0 ${116 * CELL_W} ${STRIP_ROWS * CELL_H}"`,
  )
  expect(String(strip?.props.source)).toContain(`width="${95 * DESKTOP_COLUMN_PX_CEILING}"`)
  // Rung (a′) on the desktop (spike sheet): the hotkeys sit in a hidden absolute Box, no row.
  expect(await ui.find({ key: 'row-hotkeys' })).toBeUndefined()
  const keys = await ui.find({ key: 'hotkeys' })
  expect([keys?.props.width, keys?.props.position]).toEqual([0, 'absolute'])
  await ui.unmount()
  // VS Code is untested: it keeps rung (c), a row of its own under the strip.
  const vscode = await $.ui.mount({ plugin: 'promptfall', surface: 'vscode', ...band(95, 20) })
  expect(await vscode.find({ key: 'row-hotkeys' })).toBeDefined()
  await vscode.unmount()
})

test('the hotkeys switch tabs and collapse; f toggles farm and the purse says so', async ($, on) => {
  const { data, states, clock } = harness(on)
  settings(data, RASTER)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'promptfall', surface, ...band(120, 20) })
    await ui.press({ key: 'hot-l' })
    expect((states.get('prefs') as Prefs).bandTab).toBe('loot')
    await ui.press({ key: 'hot-w' })
    expect((states.get('prefs') as Prefs).bandTab).toBe('world')
    await ui.press({ key: 'hot-p' })
    expect((states.get('prefs') as Prefs).bandTab).toBe('party')
    await ui.press({ key: 'hot-c' })
    expect((states.get('prefs') as Prefs).collapsed).toBe(true)
    expect(await rows(ui)).toHaveLength(1)
    await ui.press({ key: 'collapse' })
    expect((states.get('prefs') as Prefs).collapsed).toBe(false)
    await ui.unmount()
  }
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...band(120, 20) })
  expect(await stripText(ui)).toContain('Push on')
  await ui.press({ key: 'hot-f' })
  await clock.advance(1)
  expect((states.get('view') as GameView).farm).toBe(true)
  await ui.unmount()
  const after = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...band(120, 20) })
  expect(await stripText(after)).toContain('Farm here')
  await after.unmount()
})

test('on terminals the hotkeys sit in a zero-width Box: no row, no column', async ($, on) => {
  const { data } = harness(on)
  settings(data, RASTER)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...band(120, 20) })
  const box = await ui.find({ key: 'hotkeys' })
  expect(box?.props.width).toBe(0)
  expect(box?.props.overflow).toBe('hidden')
  expect(await ui.find({ key: 'row-hotkeys' })).toBeUndefined()
  await ui.unmount()
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

test('the World tab reads the in-process world: one online, the records under it', async ($, on) => {
  const { data, states, shown } = harness(on)
  settings(data, RASTER)
  // The first-run welcome would take the third row, as every notice does.
  shown.notice = null
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  expect((states.get('world') as WorldState).snapshot?.online).toBe(1)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'promptfall', surface, ...band(120, 20) })
    await ui.press({ key: 'hot-w' })
    const text = await stripText(ui)
    expect(text).toContain('1 online · zone 1: nobody else here')
    // Chat needs a server: the records take the row.
    expect(text).toMatch(/highest zone 1 · kills \d+ · wipes \d+/)
    await ui.unmount()
  }
})

test('the World tab shows who is here and the last chat line, and dims a stale snapshot', async ($, on) => {
  const { clock, states, data, shown } = harness(on)
  settings(data, RASTER)
  shown.notice = null
  const net = remoteWorld(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.command.run({ ...RUN, command: 'promptfall', args: 'server http://test' })
  await clock.advance(1)
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...band(140, 20) })
  await ui.press({ key: 'hot-w' })
  const presence = async () => {
    const { text, fg } = cellsOf(await ui.find({ key: 'strip' }))
    const y = text.findIndex((t) => t.includes('13 online'))
    const x = text[y]?.indexOf('13 online') ?? -1
    return { text, colour: fg[y]?.[x] }
  }
  const first = await presence()
  expect(first.text.join('\n')).toContain('13 online · zone 1: Ashgrove, Brindle')
  expect(first.text.join('\n')).toContain('Corvina: gg everyone')
  expect(first.colour).not.toBe(DIM_RGB)
  net.down = true
  await clock.advance(WORLD_STALE_MS)
  expect((states.get('world') as WorldState).stale).toBe(true)
  expect((await presence()).colour).toBe(DIM_RGB)
  await ui.unmount()
})

test('the snapshot flags win over the bootstrap config: chat closed while the config said open', async ($, on) => {
  const { clock, states, data, shown } = harness(on)
  settings(data, RASTER)
  const net = remoteWorld(on)
  const open = net.world
  net.world = () => ({ ...open(), flags: { 'chat.enabled': false, 'presence.enabled': true } })
  shown.notice = null
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.command.run({ ...RUN, command: 'promptfall', args: 'server http://test' })
  await clock.advance(1)
  expect((states.get('view') as GameView).account.chatOpen).toBe(true)
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...band(140, 20) })
  await ui.press({ key: 'hot-w' })
  const text = await stripText(ui)
  // Chat closed: the records take its row, not the last message.
  expect(text).not.toContain('Corvina')
  expect(text).toMatch(/highest zone/)
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

test('the world boss reads the snapshot, less what this party dealt since', async ($, on) => {
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
  expect(worldRows(view(0), even, now)[1]?.text).toBe(
    'World boss The Promptwyrm █████░░░ 62% · 11m left · you 0',
  )
  // 300 dealt locally past the committed 200: 5,900 shown.
  const ahead = bossWorld(BOSS, { bossId: 'wb1', dealt: 200 })
  expect(shownBoss(view(500), ahead)?.shownHp).toBe(5_900)
  // A secondary has no committed reading: nothing is subtracted.
  expect(shownBoss(view(500), bossWorld(BOSS, null))?.shownHp).toBe(6_200)
  // Down: the World row says so.
  const down = bossWorld({ ...BOSS, hp: 0 }, null)
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

test('in boss mode the enemy window shows the world boss with its bar and time left', async ($, on) => {
  const { clock, states, data } = harness(on)
  settings(data, RASTER)
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
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...band(150, 30) })
  await ui.press({ key: 'hot-p' })
  const text = await stripText(ui)
  expect(text).toMatch(/World boss · \d+[mh]/)
  expect(text).toContain(boss.name.slice(0, 7))
  expect(text).toMatch(/\d+%/)
  await ui.unmount()
})

// ---------------------------------------------------------------------------
// The stage and the strip

test('the full layout: a 120 × 8 stage Raster and a 120 × 5 strip Raster, 13 rows', async ($, on) => {
  const { data, shown } = harness(on)
  settings(data, RASTER)
  shown.view = wave()
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...band(120, 20) })
  const stage = await ui.find({ key: 'stage' })
  expect(stage?.type).toBe('Raster')
  expect([stage?.props.columns, stage?.props.rows]).toEqual([120, 8])
  const strip = await ui.find({ key: 'strip' })
  expect([strip?.type, strip?.props.columns, strip?.props.rows]).toEqual(['Raster', 120, 5])
  expect(await height(ui)).toBe(13)
  await ui.unmount()
})

for (const [name, view, rowsOf] of [
  ['a zone boss grows the stage to 17 rows, the band to 22', boss, 17],
  ['a turn boss grows the stage to 12 rows, the band to 17', turnBoss, 12],
] as const) {
  test(name, async ($, on) => {
    const { data, shown } = harness(on)
    settings(data, RASTER)
    shown.view = view()
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
    const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...band(120, 30) })
    const stage = await ui.find({ key: 'stage' })
    expect([stage?.props.columns, stage?.props.rows]).toEqual([120, rowsOf])
    expect(await height(ui)).toBe(rowsOf + STRIP_ROWS)
    await ui.unmount()
  })
}

test('too short for the boss: compact (6 rows), then full again once the boss is gone', async ($, on) => {
  const { data, shown, clock } = harness(on)
  settings(data, RASTER)
  shown.view = boss()
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...band(120, 14) })
  expect(await height(ui)).toBe(6)
  const stage = await ui.find({ key: 'stage' })
  expect([stage?.props.columns, stage?.props.rows]).toEqual([52, 4])
  const strip = await ui.find({ key: 'strip' })
  expect([strip?.props.columns, strip?.props.rows]).toEqual([120 - 52, 6])
  shown.view = wave()
  await clock.advance(DISSOLVE_MS + DROP_MS + 1)
  await ui.unmount()
  const after = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...band(120, 14) })
  expect(await height(after)).toBe(13)
  await after.unmount()
})

test('110 columns is compact with the front enemy in the party window; 99 or 5 rows is one row', async ($, on) => {
  const { data, shown } = harness(on)
  settings(data, RASTER)
  shown.view = wave()
  shown.notice = null
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...band(110, 20) })
  expect(await height(ui)).toBe(6)
  const text = await stripText(ui)
  expect(text).toContain('Goblin Scout')
  expect(text).toContain('Party')
  await ui.unmount()
  for (const [columns, maxRows] of [
    [99, 20],
    [120, 5],
  ] as const) {
    const small = await $.ui.mount({
      plugin: 'promptfall',
      surface: 'terminal',
      ...band(columns, maxRows),
    })
    expect(await rows(small)).toHaveLength(1)
    expect(await small.find({ key: 'stage' })).toBeUndefined()
    await small.unmount()
  }
})

test('the image renderer draws the stage Image and one Image per window, each with an alt', async ($, on) => {
  const { data } = harness(on)
  settings(data, { renderer: 'image' })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...band(120, 20) })
  const stage = await ui.find({ key: 'stage-120x8' })
  expect(stage?.type).toBe('Image')
  expect([stage?.props.columns, stage?.props.rows]).toEqual([120, 8])
  expect(String(stage?.props.alt)).toMatch(/^Zone 1/)
  const windows = ((await ui.find({ key: 'strip-windows' }))?.children ?? []) as Node[]
  expect(windows.map((w) => [w.type, w.props.columns, w.props.rows])).toEqual([
    ['Image', 25, 5],
    ['Image', 40, 5],
    ['Image', 42, 5],
    ['Image', 13, 5],
  ])
  for (const w of windows) expect(String(w.props.alt).length).toBeGreaterThan(0)
  await ui.unmount()
})

test('a boss growing the image stage mounts a new Image, and the loop blits to it', async ($, on) => {
  // Ghostty kept a grown keyed Image at its first placement's height: each size is its own key.
  const { data, shown, clock, blits } = harness(on)
  settings(data, { renderer: 'image' })
  shown.view = wave()
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...band(120, 30) })
  expect(await ui.find({ key: 'stage-120x8' })).toBeDefined()
  shown.view = boss()
  await clock.advance(1_000)
  await ui.unmount()
  const grown = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...band(120, 30) })
  expect(await grown.find({ key: 'stage-120x8' })).toBeUndefined()
  expect((await grown.find({ key: 'stage-120x17' }))?.props.rows).toBe(17)
  const before = blits.length
  await clock.advance(1_000)
  const stageBlits = blits.slice(before).filter((b) => b.key.startsWith('stage'))
  expect(stageBlits.length).toBeGreaterThan(0)
  for (const b of stageBlits) expect(b).toMatchObject({ key: 'stage-120x17', rows: 17 })
  await grown.unmount()
})

test('while the renderer is unknown the stage and strip rows are empty and the strip row probes', async ($, on) => {
  harness(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...band(120, 20) })
  expect(await ui.find({ key: 'stage' })).toBeUndefined()
  const row = await ui.find({ key: 'row-strip' })
  expect(
    row?.children.some((c) => (c as { props?: { key?: string } }).props?.key === 'probe'),
  ).toBe(true)
  const probe = await ui.find({ key: 'probe' })
  expect([probe?.type, probe?.props.columns, probe?.props.rows]).toEqual(['Image', 1, 1])
  expect(await height(ui)).toBe(13)
  await ui.unmount()
})

test('the probe arms on the World tab too: Loot and World need the renderer', async ($, on) => {
  const { data } = harness(on)
  data.set('promptfall:prefs', { bandTab: 'world', collapsed: false })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...band(120, 20) })
  await ui.press({ key: 'hot-w' })
  expect(await ui.find({ key: 'probe' })).toBeDefined()
  await ui.unmount()
})

test('the desktop draws the stage Svg and the strip Svg, each with its alt', async ($, on) => {
  harness(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'desktop', ...band(120, 20) })
  const { stage, strip } = await svgs(ui)
  // An image: SMIL runs in it and a new source swaps in without the frame's blank reload.
  expect(stage?.props.isInteractive).toBe(SVG_INTERACTIVE)
  expect(SVG_INTERACTIVE).toBe(false)
  expect(String(stage?.props.alt)).toMatch(/^Zone 1/)
  expect(String(strip?.props.alt)).toContain('Party:')
  await ui.unmount()
})

for (const [columns, art] of [
  [95, 116],
  [60, 116],
  [130, 130],
] as const) {
  test(`the desktop at ${columns} columns draws the full stage ${art} pixels wide`, async ($, on) => {
    harness(on)
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
    const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'desktop', ...band(columns, 20) })
    const { stage } = await svgs(ui)
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
  const { stage, strip } = await svgs(ui)
  expect(String(stage?.props.source)).toContain('viewBox="0 0 116 34"')
  expect(await ui.find({ key: 'compact-stage' })).toBeUndefined()
  expect(String(strip?.props.alt)).toContain('Boss')
  await ui.unmount()
})

test('Loot and World are the strip alone: 5 rows, no stage; the loop blits the strip there', async ($, on) => {
  const { data, blits, clock } = harness(on)
  settings(data, RASTER)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...band(120, 20) })
  for (const key of ['hot-l', 'hot-w']) {
    await ui.press({ key })
    expect(await ui.find({ key: 'stage' })).toBeUndefined()
    expect(await height(ui)).toBe(5)
  }
  // Ticks keep changing the party window: the strip blits, the stage never does.
  const before = blits.length
  await clock.advance(20_000)
  const later = blits.slice(before)
  expect(later.some((b) => b.key === 'strip')).toBe(true)
  expect(later.some((b) => b.key === 'stage')).toBe(false)
  await ui.unmount()
})

test('on the desktop the World tab draws the strip Svg alone, its hotkeys hidden', async ($, on) => {
  harness(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'desktop', ...band(120, 20) })
  await ui.press({ key: 'hot-w' })
  expect(await ui.find({ key: 'row-stage' })).toBeUndefined()
  const { strip } = await svgs(ui)
  expect(strip?.type).toBe('Svg')
  expect(String(strip?.props.alt)).toContain('World tab')
  expect(await ui.find({ key: 'row-hotkeys' })).toBeUndefined()
  expect(await ui.find({ key: 'hotkeys' })).toBeDefined()
  await ui.unmount()
})

test('an action blits the stage at the event rate', async ($, on) => {
  const { data, blits, clock, states } = harness(on)
  settings(data, RASTER)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...band(120, 20) })
  for (let i = 0; i < 20 && (states.get('view') as GameView).enemies.length === 0; i++) {
    await clock.advance(5_000)
  }
  // Gauges start empty, so the first action comes a few ticks in: find a busy second.
  let busiest = 0
  for (let i = 0; i < 60 && busiest < 10; i++) {
    const before = blits.length
    await clock.advance(1_000)
    const second = blits.slice(before).filter((b) => b.key === 'stage')
    for (const b of second) expect(b).toMatchObject({ requestId: 'band-test', key: 'stage' })
    busiest = Math.max(busiest, second.length)
  }
  expect(busiest).toBeGreaterThanOrEqual(10)
  await ui.unmount()
})

test('a tick through the engine reaches the strip: the log prints the fight', async ($, on) => {
  const { data, clock } = harness(on)
  settings(data, RASTER)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  let printed = false
  for (let i = 0; i < 40 && !printed; i++) {
    await clock.advance(2_000)
    const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...band(120, 20) })
    printed = / hits /.test(await stripText(ui))
    await ui.unmount()
  }
  expect(printed).toBe(true)
})

test('with motion still and nothing moving on the stage, the stage never blits', async ($, on) => {
  const { data, blits, clock, shown } = harness(on)
  settings(data, { ...RASTER, motion: 'still' })
  shown.view = wave()
  // The first-run welcome clearing itself would be a change: hold the notice still.
  shown.notice = null
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...band(120, 20) })
  await clock.advance(5_000)
  // The session's own fight still feeds the log under the shown view: the strip may blit a new line.
  expect(blits.filter((b) => b.key === 'stage')).toHaveLength(0)
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

test('on the desktop the stage sits in a column, so its frame takes the band width', async ($, on) => {
  // In a row Box the desktop draws an interactive Svg's frame at the default 300 × 150 points.
  harness(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'desktop', ...band(95, 12) })
  expect((await ui.find({ key: 'row-stage' }))?.props.flexDirection).toBe('column')
  await ui.unmount()
})

test('on the desktop a boss stage is scaled down to the rows the strip leaves, the rest stage is not', async ($, on) => {
  const { shown } = harness(on)
  shown.view = boss()
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'desktop', ...band(95, 12) })
  const { stage } = await svgs(ui)
  // 12 rows of 19 points, less the strip at the band's width (no hotkey row on the desktop).
  const stripPx = (95 * DESKTOP_COLUMN_PX * STRIP_ROWS * CELL_H) / (116 * CELL_W)
  const cap = (12 - Math.ceil(stripPx / DESKTOP_ROW_PX)) * DESKTOP_ROW_PX
  expect(stage?.props.height).toBe(Math.round(cap))
  expect(stage?.props.width).toBe(Math.floor((cap * 116) / 34))
  await ui.unmount()
  shown.view = wave()
  const rest = await $.ui.mount({ plugin: 'promptfall', surface: 'desktop', ...band(95, 20) })
  const small = (await svgs(rest)).stage
  expect(small?.props.height).toBeUndefined()
  expect(small?.props.width).toBeUndefined()
  await rest.unmount()
})

test('on a desktop band of three rows the boss stage keeps a positive size', async ($, on) => {
  const { shown } = harness(on)
  shown.view = boss()
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'desktop', ...band(95, 3) })
  const { stage } = await svgs(ui)
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
