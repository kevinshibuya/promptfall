import type { On, RenderElement, UiBlitArgs } from 'claude-code'
import { expect, mock } from 'claude-code/testing'
import type { GameView, Prefs, Settings, WorldState } from '../types'
import { decode } from './sprites/base64'
import { boss, turnBoss, wave } from './stage/fixtures'
import { bandKey } from './stage/loop'
import {
  DESKTOP_COLUMN_PX_CEILING,
  PROBE_DELAY_MS,
  SVG_INTERACTIVE,
  SVG_MAX_CHARS,
} from './stage/tuning'
import { SETTINGS_DEFAULT } from './state'
import { test } from './testing'
import { shownBoss, worldRows } from './ui/band'
import { approveAs, Ledger } from './vendor/ledger.js'
import { MemoryKeyValue, type WorldSnapshot } from './vendor/protocol.js'
import { createInitialState } from './vendor/sim.js'
import { CELL_H, CELL_W, DIM_RGB, STRIP_ROWS, STRIP_SVG_MAX_CHARS } from './windows/tuning'
import { WORLD_STALE_MS } from './world'

const SURFACES = ['terminal', 'desktop'] as const

function harness(on: On) {
  // The machine plays in-process: a fresh install would play on the public server.
  const data = new Map<string, unknown>([['promptfall:server', 'local']])
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
  // The sandbox switch reads the environment: unset here.
  mock.env(on, {})
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

/** The Party tab's band Raster (#61): the band row's one Raster, the stage and strip inside it. */
async function bandRaster(ui: Finder): Promise<Node | undefined> {
  const row = await ui.find({ key: 'row-band' })
  return ((row?.children ?? []) as Node[]).find((c) => c.type === 'Raster')
}

/** What the strip says: its Raster's text, the band Raster's strip rows, else its pictures' alts. */
async function stripText(ui: Finder): Promise<string> {
  const band = await bandRaster(ui)
  if (band) return cellsOf(band).text.slice(-STRIP_ROWS).join('\n')
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
  // The band as one picture (#59, #61): the band row's one Image or Raster.
  const row = await ui.find({ key: 'row-band' })
  const band = ((row?.children ?? []) as Node[]).find(
    (c) => c.type === 'Image' || c.type === 'Raster',
  )
  if (band) return Number(band.props.rows)
  const count = async (key: string) => {
    const n = await ui.find({ key })
    if (!n) return 0
    if (n.props.rows !== undefined) return Number(n.props.rows)
    return n.children.filter((c) => typeof c === 'object').length
  }
  // The Images keep keys of their own: the stage's by its size, each window's by its own.
  const first = async (key: string) => {
    const n = ((await ui.find({ key }))?.children ?? [])[0] as Node | undefined
    return Number(n?.props.rows ?? 0)
  }
  const stage = (await count('stage')) || (await count('stage-empty')) || (await first('row-stage'))
  const strip =
    (await count('strip')) || (await count('strip-empty')) || (await first('strip-windows'))
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

test('the sandbox purse says Sandbox where the tactics sit; farming puts Farm on its title', async ($, on) => {
  const { data, shown } = harness(on)
  settings(data, RASTER)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const purse = async (sandbox: boolean, farm: boolean, surface: 'terminal' | 'desktop') => {
    const base = wave()
    shown.view = { ...base, farm, account: { ...base.account, sandbox } }
    const ui = await $.ui.mount({ plugin: 'promptfall', surface, ...band(120, 20) })
    const text = await stripText(ui)
    await ui.unmount()
    return text
  }
  const still = await purse(true, false, 'terminal')
  expect(still).toContain('Sandbox')
  expect(still).not.toContain('Push on')
  expect(still).not.toContain('Farm')
  const farming = await purse(true, true, 'terminal')
  expect(farming).toContain('Sandbox')
  expect(farming).toContain('Farm')
  expect(farming).not.toContain('Farm here')
  expect(await purse(true, false, 'desktop')).toContain('Sandbox')
  // The real save keeps its tactics line.
  expect(await purse(false, false, 'terminal')).toContain('Push on')
  expect(await purse(false, true, 'terminal')).toContain('Farm here')
  expect(await purse(false, true, 'terminal')).not.toContain('Sandbox')
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
    linkApprover: approveAs('remote-player'),
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
    const { text, fg } = cellsOf(await bandRaster(ui))
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
    linkApprover: approveAs('remote-player'),
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

/** The rows the band Raster's stage takes: down to the strip's top row, where the line meets it. */
async function stageRowsOf(ui: Finder): Promise<number> {
  return cellsOf(await bandRaster(ui)).text.findIndex((row) => row.startsWith('├'))
}

test('the full layout: one 120 × 22 band Raster, the 17-row stage above the 5-row strip', async ($, on) => {
  const { data, shown } = harness(on)
  settings(data, RASTER)
  shown.view = wave()
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...band(120, 30) })
  const raster = await bandRaster(ui)
  expect([raster?.props.columns, raster?.props.rows]).toEqual([120, 22])
  expect(await ui.find({ key: 'stage' })).toBeUndefined()
  expect(await ui.find({ key: 'strip' })).toBeUndefined()
  expect(await stageRowsOf(ui)).toBe(17)
  expect(await height(ui)).toBe(22)
  await ui.unmount()
})

for (const [name, view, rowsOf] of [
  ['a zone boss keeps the 17-row stage, the band at 22', boss, 17],
  ['a turn boss keeps the 17-row stage, the band at 22 (ADR 0010)', turnBoss, 17],
] as const) {
  test(name, async ($, on) => {
    const { data, shown } = harness(on)
    settings(data, RASTER)
    shown.view = view()
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
    const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...band(120, 30) })
    expect((await bandRaster(ui))?.props.columns).toBe(120)
    expect(await stageRowsOf(ui)).toBe(rowsOf)
    expect(await height(ui)).toBe(rowsOf + STRIP_ROWS)
    await ui.unmount()
  })
}

test("a short band shows the stage's bottom rows at full size; under the tallest actor, compact", async ($, on) => {
  const { data, shown } = harness(on)
  settings(data, RASTER)
  shown.view = wave()
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  // 16 rows: 11 for the stage above the 5-row strip, the sky cropped (ADR 0010).
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...band(120, 16) })
  expect(await height(ui)).toBe(16)
  expect((await bandRaster(ui))?.props.columns).toBe(120)
  expect(await stageRowsOf(ui)).toBe(11)
  await ui.unmount()
  // A boss needs all 17: the Raster cannot scale, so the same band is compact.
  shown.view = boss()
  const withBoss = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...band(120, 16) })
  expect(await height(withBoss)).toBe(6)
  await withBoss.unmount()
  shown.view = wave()
  // 12 rows: 7 left, under the actors' 8: compact.
  const short = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...band(120, 12) })
  expect(await height(short)).toBe(6)
  // Compact is the band Raster too: the 52-column stage beside the window, inside one line.
  const compact = await bandRaster(short)
  expect([compact?.props.columns, compact?.props.rows]).toEqual([120, 6])
  expect(await short.find({ key: 'stage' })).toBeUndefined()
  expect(await short.find({ key: 'strip' })).toBeUndefined()
  const top = cellsOf(compact).text[0] ?? ''
  expect([top[0], top[52], top[119]]).toEqual(['╭', '┬', '╮'])
  await short.unmount()
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

// The whole band's picture, composed and encoded at full size: more than the default budget.
test(
  'the image renderer draws the full band as one Image keyed by its cells, and no window Images',
  { timeoutMs: 15_000 },
  async ($, on) => {
    const { data } = harness(on)
    settings(data, { renderer: 'image' })
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
    const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...band(120, 30) })
    // The 17-row stage over the 5-row strip: 22 rows, one picture.
    const picture = await ui.find({ key: 'band-120x22' })
    expect(picture?.type).toBe('Image')
    expect([picture?.props.columns, picture?.props.rows]).toEqual([120, 22])
    expect(String(picture?.props.alt)).toMatch(/^Zone 1/)
    expect(await ui.find({ key: 'stage-120x17' })).toBeUndefined()
    expect(await ui.find({ key: 'strip-windows' })).toBeUndefined()
    // Beside it only the zero-width hotkey box.
    const [row, ...others] = await rows(ui)
    expect(others).toHaveLength(0)
    expect(((row as Node).children as Node[]).map((c) => c.props.key ?? c.type)).toEqual([
      'band-120x22',
      'hotkeys',
    ])
    await ui.unmount()
  },
)

// The whole band's picture, composed and encoded at full size: more than the default budget.
test(
  'a short band keys the image band by the rows left, and the loop blits to it',
  { timeoutMs: 15_000 },
  async ($, on) => {
    // Ghostty kept a keyed Image at its first placement's height: each size is its own key. A boss
    // no longer grows the stage (ADR 0010); the band's rows change its size instead. With a boss
    // the 15 rows left are under its 17, so the Image zooms the whole scene out into them.
    const { data, shown, clock, blits } = harness(on)
    settings(data, { renderer: 'image' })
    shown.view = boss()
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
    const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...band(120, 30) })
    expect((await ui.find({ key: 'band-120x22' }))?.props.rows).toBe(22)
    await clock.advance(1_000)
    await ui.unmount()
    // 20 rows: the zoomed-out stage in the 15 above the strip.
    const short = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...band(120, 20) })
    expect(await short.find({ key: 'band-120x22' })).toBeUndefined()
    expect((await short.find({ key: 'band-120x20' }))?.props).toMatchObject({
      columns: 120,
      rows: 20,
    })
    const before = blits.length
    await clock.advance(1_000)
    const later = blits.slice(before)
    expect(later.length).toBeGreaterThan(0)
    for (const b of later) expect(b).toMatchObject({ key: 'band-120x20', columns: 120, rows: 20 })
    await short.unmount()
  },
)

// The whole band's picture, composed and encoded at full size: more than the default budget.
test(
  'above 255 columns the image band is 255 wide and centred',
  { timeoutMs: 15_000 },
  async ($, on) => {
    const { data, clock, blits } = harness(on)
    settings(data, { renderer: 'image' })
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
    const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...band(300, 30) })
    expect((await ui.find({ key: 'band-255x22' }))?.props).toMatchObject({ columns: 255, rows: 22 })
    expect((await ui.find({ key: 'row-band' }))?.props.justifyContent).toBe('center')
    await clock.advance(1_000)
    for (const b of blits) expect(b).toMatchObject({ key: 'band-255x22', columns: 255, rows: 22 })
    await ui.unmount()
  },
)

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
  // 20 rows: the stage's 15 empty rows above the strip's 5, as the layout will draw them.
  expect(await height(ui)).toBe(20)
  await ui.unmount()
})

test('lays out with the remembered renderer while the probe is pending', async ($, on) => {
  const { data, clock } = harness(on)
  settings(data, { probed: 'image' })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  // 11 rows: an Image zooms the stage into the 6 over the strip, where half-blocks go compact.
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...band(120, 11) })
  expect(await ui.find({ key: 'probe' })).toBeDefined()
  expect(await ui.find({ key: 'compact-stage' })).toBeUndefined()
  expect(await height(ui)).toBe(11)
  // The harness takes the blit: the probe lands on image and the band keeps its height.
  await clock.advance(PROBE_DELAY_MS)
  expect(await ui.find({ key: 'probe' })).toBeUndefined()
  expect(await height(ui)).toBe(11)
  await ui.unmount()
})

test('with no remembered renderer the band lays out by the half-blocks, and the landing verdict is recorded', async ($, on) => {
  const { data, clock } = harness(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...band(120, 11) })
  expect(await ui.find({ key: 'probe' })).toBeDefined()
  expect(await height(ui)).toBe(6)
  // The first session's band changes height once, when the probe lands.
  await clock.advance(PROBE_DELAY_MS)
  expect(await height(ui)).toBe(11)
  // The verdict has a field of its own: the player's choice stays auto, so the next session probes.
  expect(data.get('promptfall:settings')).toMatchObject({ renderer: 'auto', probed: 'image' })
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

test('the Svg band draws the shell behind the stage and the strip, and the line around both', async ($, on) => {
  harness(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'desktop', ...band(120, 20) })
  const { stage, strip } = await svgs(ui)
  const s = String(stage?.props.source)
  const t = String(strip?.props.source)
  // Both on the windows' grid at the band's 120 columns, 8 by 16 a cell, drawn at its width.
  expect(s).toMatch(/^<svg [^>]*viewBox="0 0 960 272" width="1920" height="544"/)
  expect(t).toMatch(/^<svg [^>]*viewBox="0 0 960 80" width="1920" height="160"/)
  // The shell first, under everything; the 1.5x stage scaled onto the grid over it.
  expect(s).toContain(
    '</defs><rect width="960" height="272" fill="#303028"/><g transform="translate(0 0) scale(5.3333)">',
  )
  expect(t).toContain('</defs><rect width="960" height="80" fill="#303028"/>')
  // The stage Svg ends on the line's top and sides, the shell outside them over its outermost
  // pixels; the strip Svg on its sides and bottom, over the outer windows' own lines. Stacked,
  // the sides meet: 2 pixels wide, 2 in from each edge, the corners cut.
  expect(s).toMatch(
    /<path fill="#303028" fill-rule="evenodd" d="M0 0H960V272H0ZM3 2H957V3H958V272H2V3H3Z"\/><path fill="#f0f0e8" d="M3 2H957V3H958V272H956V4H4V272H2V3H3Z"\/><\/svg>$/,
  )
  expect(t).toMatch(
    /<path fill="#303028" fill-rule="evenodd" d="M0 0H960V80H0ZM2 0H958V69H957V70H3V69H2Z"\/><path fill="#f0f0e8" d="M2 0H4V68H956V0H958V69H957V70H3V69H2Z"\/><\/svg>$/,
  )
  // The SMIL stays in each: the actors' idle clock runs inside the scaled stage.
  expect(s).toMatch(/scale\(5\.3333\)">.*repeatCount="indefinite".*<\/g><path fill="#303028"/)
  expect(s.length).toBeLessThan(SVG_MAX_CHARS)
  expect(t.length).toBeLessThanOrEqual(STRIP_SVG_MAX_CHARS)
  await ui.unmount()
})

for (const [columns, art] of [
  [95, 116],
  [60, 116],
  [130, 130],
] as const) {
  test(`the desktop at ${columns} columns draws the full stage ${art} columns wide at 1.5 pixels a column`, async ($, on) => {
    harness(on)
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
    const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'desktop', ...band(columns, 20) })
    const { stage } = await svgs(ui)
    const source = String(stage?.props.source)
    // On the windows' grid, 8 pixels a column; the 1.5x art scaled on at 16/3 an art pixel.
    expect(source).toContain(`viewBox="0 0 ${art * CELL_W} 272"`)
    expect(source).toContain('<g transform="translate(0 0) scale(5.3333)">')
    expect(String(stage?.props.alt)).toMatch(/^Zone 1/)
    // No width prop: the markup is wider than the band and the desktop scales it down to fit.
    expect(stage?.props.width).toBeUndefined()
    expect(source).toContain(`width="${columns * DESKTOP_COLUMN_PX_CEILING}"`)
    await ui.unmount()
  })
}

test('the desktop draws the 17-row stage for a zone boss, never the compact one (ADR 0004)', async ($, on) => {
  const { shown } = harness(on)
  shown.view = boss()
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'desktop', ...band(95, 30) })
  const { stage, strip } = await svgs(ui)
  expect(String(stage?.props.source)).toContain('viewBox="0 0 928 272"')
  expect(await ui.find({ key: 'compact-stage' })).toBeUndefined()
  expect(String(strip?.props.alt)).toContain('Boss')
  await ui.unmount()
})

test('Loot and World are the strip alone on the shell: 5 rows, no stage; the loop blits the band there', async ($, on) => {
  const { data, blits, clock } = harness(on)
  settings(data, RASTER)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...band(120, 20) })
  for (const key of ['hot-l', 'hot-w']) {
    await ui.press({ key })
    expect(await ui.find({ key: 'stage' })).toBeUndefined()
    expect(await height(ui)).toBe(5)
  }
  // Ticks keep changing the party window: the band, the strip alone, blits; the stage never does.
  const before = blits.length
  await clock.advance(20_000)
  const later = blits.slice(before)
  expect(later.some((b) => b.key === bandKey({ columns: 120, rows: 5 }))).toBe(true)
  expect(later.some((b) => b.key === 'stage' || b.key === 'strip')).toBe(false)
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
  // The strip is the whole playfield: the shell under it, the line all round, 2 pixels in from
  // each side and over the windows' top and bottom lines.
  const t = String(strip?.props.source)
  expect(t).toMatch(/^<svg [^>]*viewBox="0 0 960 80" width="1920" height="160"/)
  expect(t).toContain('</defs><rect width="960" height="80" fill="#303028"/>')
  expect(t).toMatch(
    /<path fill="#303028" fill-rule="evenodd" d="M0 0H960V80H0ZM3 10H957V11H958V69H957V70H3V69H2V11H3Z"\/><path fill="#f0f0e8" fill-rule="evenodd" d="M3 10H957V11H958V69H957V70H3V69H2V11H3ZM4 12V68H956V12Z"\/><\/svg>$/,
  )
  expect(await ui.find({ key: 'row-hotkeys' })).toBeUndefined()
  expect(await ui.find({ key: 'hotkeys' })).toBeDefined()
  await ui.unmount()
})

test('an action blits the band at the event rate', async ($, on) => {
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
    // The Raster band (#61): the stage loop blits the one band picture, 120 × 20.
    const key = bandKey({ columns: 120, rows: 20 })
    const second = blits.slice(before).filter((b) => b.key === key)
    for (const b of second) expect(b).toMatchObject({ requestId: 'band-test', key, rows: 20 })
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
  // Nine idle beats, up to the engine's first tick at the 5 s idle cadence: that tick brings the
  // session's own monster on, which enters the stage's timeline with a spawn under the shown view.
  await clock.advance(4_999)
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

test('on a short desktop band the whole stage scales down to the rows the strip leaves, centred on the shell; a tall one shows it whole', async ($, on) => {
  const { shown } = harness(on)
  shown.view = wave()
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'desktop', ...band(95, 12) })
  const { stage, strip } = await svgs(ui)
  // 12 rows of 19 points less the strip's 4 at the band's width: 152 points for a stage that
  // would take 222.8, so it draws at 0.68 of its size. The Svg keeps the band's width: 760
  // points, its markup 1520 wide and 304 tall, so 152 drawn; the 928 × 185.6 grid around it.
  for (const v of [stage?.props.width, stage?.props.height]) expect(v).toBeUndefined()
  const source = String(stage?.props.source)
  expect(source).toContain('viewBox="0 0 928 185.6" width="1520" height="304"')
  // The 174 × 51 art at 3.6392 a pixel is 633.2 wide: 147.39 of shell each side, inside the line.
  expect(source).toContain('<g transform="translate(147.39 0) scale(3.6392)">')
  expect(source).toMatch(/d="M3 2H925V3H926V185.6H924V4H4V185.6H2V3H3Z"\/><\/svg>$/)
  // The strip keeps the band's width and its rows.
  expect(String(strip?.props.source)).toMatch(/viewBox="0 0 928 80" width="1520"/)
  await ui.unmount()
  const tall = await $.ui.mount({ plugin: 'promptfall', surface: 'desktop', ...band(95, 20) })
  const whole = String((await svgs(tall)).stage?.props.source)
  expect(whole).toContain('viewBox="0 0 928 272"')
  expect(whole).toContain('<g transform="translate(0 0) scale(5.3333)">')
  await tall.unmount()
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
