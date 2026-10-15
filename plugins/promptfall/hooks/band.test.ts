import type { On, RenderElement, SessionMessage, UiBlitArgs } from 'claude-code'
import { describe, expect, mock } from 'claude-code/testing'
import type { GameView, Prefs, Settings, WorldState } from '../types'
import { BAND, PAST_GRID_BOSS, harness as playing } from './inplay/harness'
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
import {
  CELL_H,
  CELL_W,
  DIM_RGB,
  DOWN_RGB,
  GAUGE_FULL_RGB,
  STRIP_ROWS,
  STRIP_SVG_MAX_CHARS,
  WARN_RGB,
} from './windows/tuning'
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

// Read-only groups. A test's cost is its engine boot, one per test, and what it registers before
// the boot (the harness, store seeds, env, clock) is fixed for the boot. Tests with the same setup
// that, once the session starts, only read (mount a band and read its strip text, blits, raster
// cells, pixels, which window is where) share one test: one boot, the checks in sequence, each
// `expect` named so a red group says which check failed. A test that dispatches an event, presses
// a key, advances the clock or writes state after the start keeps a test of its own, and so does
// one whose status is unclear. The kit has no `beforeAll`: the mounts live in the test body.
describe('the raster band, read only', () => {
  test('the strip under the stage, the same during a survey, the zero-width hotkeys', async ($, on) => {
    const { data, states } = harness(on)
    settings(data, RASTER)
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

    // The band draws the strip under the stage, and keeps it while Claude asks.
    const view = states.get('view') as GameView
    expect(view.heroes, 'strip: three heroes').toHaveLength(3)
    for (const surface of SURFACES) {
      for (const asking of [false, true]) {
        const at = `${asking ? 'survey' : 'strip'} on ${surface}`
        const ui = await $.ui.mount({ plugin: 'promptfall', surface, ...band(120, 20, asking) })
        expect(await ui.find({ key: 'engine-band' }), `${at}: not the engine's`).toBeUndefined()
        const text = await stripText(ui)
        for (const hero of view.heroes) {
          expect(text, `${at}: ${hero.shortName}`).toContain(hero.shortName)
        }
        expect(text, `${at}: the zone`).toContain('Zone 1')
        await ui.unmount()
      }
    }

    // On terminals the hotkeys sit in a zero-width Box: no row, no column.
    const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...band(120, 20) })
    const box = await ui.find({ key: 'hotkeys' })
    expect(box?.props.width, 'terminal hotkeys: zero width').toBe(0)
    expect(box?.props.overflow, 'terminal hotkeys: overflow hidden').toBe('hidden')
    expect(await ui.find({ key: 'row-hotkeys' }), 'terminal hotkeys: no row').toBeUndefined()
    await ui.unmount()
  })
})

test('the hotkeys switch tabs and collapse; f flips the tactics and the purse says so', async ($, on) => {
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
  expect(await stripText(ui)).toContain('f: Next zone')
  await ui.press({ key: 'hot-f' })
  await clock.advance(1)
  expect((states.get('view') as GameView).farm).toBe(true)
  await ui.unmount()
  const after = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...band(120, 20) })
  expect(await stripText(after)).toContain('f: Stay here')
  await after.unmount()
})

test('g shows and binds only while the party camps, and pressing it breaks camp', async ($, on) => {
  // Past the grid boss, which would engage the party and hold no camp.
  const { view, clock } = playing(on, {}, {}, PAST_GRID_BOSS)
  const message: SessionMessage = { role: 'user', text: 'the story so far', toolUses: [] }
  on('session.compact', () => ({ messages: [message] }))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'promptfall', surface, ...BAND })
    expect(await ui.find({ key: 'hot-g' }), `${surface}: no g out of camp`).toBeUndefined()
    await ui.unmount()
  }
  await $.session.compact({ trigger: 'manual', messages: [message] })
  await clock.advance(1)
  expect(view().camping).toBe(true)
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...BAND })
  expect(await ui.find({ key: 'hot-g' })).toBeDefined()
  await ui.press({ key: 'hot-g' })
  await clock.advance(1)
  expect(view().camping).toBe(false)
  await ui.unmount()
  const after = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...BAND })
  expect(await after.find({ key: 'hot-g' })).toBeUndefined()
  await after.unmount()
})

test('the sandbox purse shows the tactics; the message window is titled Sandbox', async ($, on) => {
  const { data, shown } = harness(on)
  settings(data, RASTER)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const strip = async (sandbox: boolean, farm: boolean, surface: 'terminal' | 'desktop') => {
    const base = wave()
    shown.view = { ...base, farm, account: { ...base.account, sandbox } }
    const ui = await $.ui.mount({ plugin: 'promptfall', surface, ...band(120, 20) })
    const text = await stripText(ui)
    await ui.unmount()
    return text
  }
  const next = await strip(true, false, 'terminal')
  expect(next).toContain('Sandbox')
  expect(next).toContain('f: Next zone')
  const stay = await strip(true, true, 'terminal')
  expect(stay).toContain('Sandbox')
  expect(stay).toContain('f: Stay here')
  expect(stay).not.toContain('Farm')
  // The mark sits in the message window's top border, the row over its command line.
  const lines = stay.split('\n')
  expect(lines.findIndex((l) => l.includes('Sandbox'))).toBe(
    lines.findIndex((l) => l.includes('Party')) - 1,
  )
  expect(await strip(true, false, 'desktop')).toContain('Sandbox')
  // The real save has no mark.
  expect(await strip(false, false, 'terminal')).toContain('f: Next zone')
  expect(await strip(false, true, 'terminal')).toContain('f: Stay here')
  expect(await strip(false, true, 'terminal')).not.toContain('Sandbox')
})

test('the collapsed line runs in colour: the label dim, HP by health, the gold in gold, Sandbox and camping', async ($, on) => {
  const { data, shown } = harness(on)
  settings(data, RASTER)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  // Collapse once: the prefs hold across mounts.
  const full = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...band(120, 20) })
  await full.press({ key: 'hot-c' })
  await full.unmount()
  // The first-run welcome would end the run, as every notice does.
  shown.notice = null
  const runs = async (view: GameView) => {
    shown.view = view
    const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...band(120, 20) })
    // The row's first child is the line: a Text of Text runs.
    const line = ((await ui.find({ key: 'row-collapsed' }))?.children ?? [])[0] as Node | undefined
    await ui.unmount()
    return ((line?.children ?? []) as Node[])
      .filter((c) => typeof c === 'object')
      .map((c) => ({
        text: (c.children ?? []).join(''),
        ...(c.props?.color === undefined ? {} : { color: c.props.color }),
        ...(c.props?.dimColor ? { dim: true } : {}),
      }))
  }
  const base = wave()
  const [a, b, c] = base.heroes
  if (!a || !b || !c) throw new Error('three heroes')
  const view: GameView = {
    ...base,
    gold: 1240,
    heroes: [
      { ...a, hp: a.maxHp },
      { ...b, hp: Math.floor((b.maxHp - 1) / 4) },
      { ...c, hp: 0, alive: false },
    ],
  }
  const plain = await runs(view)
  const said = plain.map((r) => r.text).join('')
  expect(said).toMatch(/^Promptfall · Z1 w2 · \w\d+ \w\d+ \w0 · 1,240g$/)
  expect(plain[0]).toEqual({ text: 'Promptfall', dim: true })
  for (const r of plain.filter((r) => r.text.trim() === '·')) expect(r.dim).toBe(true)
  const hp = plain.filter((r) => /^\w\d+$/.test(r.text))
  expect(hp).toHaveLength(3)
  expect(hp[0]?.color).toBeUndefined()
  expect(hp[1]?.color).toBe(`#${WARN_RGB.toString(16)}`)
  expect(hp[2]?.color).toBe(`#${DOWN_RGB.toString(16)}`)
  expect(plain.find((r) => r.text === '1,240g')?.color).toBe(`#${GAUGE_FULL_RGB.toString(16)}`)
  expect(said).not.toContain('Sandbox')
  expect(said).not.toContain('camping')
  // The sandbox and a camp add their words to the run.
  const marked = await runs({
    ...view,
    camping: true,
    account: { ...view.account, sandbox: true },
  })
  const words = marked.map((r) => r.text).join('')
  expect(words).toMatch(/^Promptfall · Sandbox · Z1 w2 · camping · /)
  expect(marked.find((r) => r.text === 'Sandbox')).toBeDefined()
  expect(marked.find((r) => r.text === 'camping')).toBeDefined()
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
      hunt: null,
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

test('the World tab reads the in-process world: one online on the command line, the records row, chat off', async ($, on) => {
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
    // At 120 columns presence on the command line shortens to its count; the alt keeps it whole.
    expect(text).toContain('1 online')
    if (surface === 'desktop') expect(text).toContain('1 online · zone 1: nobody else here')
    // The records row keeps its off notice, and chat says it needs a server under it.
    const records = text.indexOf('world boss and hunt are off')
    expect(records).toBeGreaterThan(-1)
    expect(text.indexOf('chat needs a server')).toBeGreaterThan(records)
    await ui.unmount()
  }
})

test('the World tab shows who is here on the command line, the records row over the last chat line, and dims a stale snapshot', async ($, on) => {
  const { clock, states, data, shown } = harness(on)
  settings(data, RASTER)
  shown.notice = null
  const net = remoteWorld(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.command.run({ ...RUN, command: 'promptfall', args: 'server http://test' })
  await clock.advance(1)
  // 160 columns: the message window has room for the names beside the tabs.
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...band(160, 20) })
  await ui.press({ key: 'hot-w' })
  const presence = async () => {
    const { text, fg } = cellsOf(await bandRaster(ui))
    const y = text.findIndex((t) => t.includes('13 online'))
    const x = text[y]?.indexOf('13 online') ?? -1
    return { text, colour: fg[y]?.[x] }
  }
  const first = await presence()
  const line = first.text.find((t) => t.includes('13 online')) ?? ''
  expect(line).toMatch(/▶World · 13 online · zone 1: Ashgrove, Brindle +c ▾/)
  const records = first.text.findIndex((t) => /highest zone 1 · kills \d+ · wipes \d+/.test(t))
  expect(records).toBeGreaterThan(-1)
  expect(first.text[records + 1]).toContain('Corvina: gg everyone')
  expect(first.colour).not.toBe(DIM_RGB)
  // Folded through the stale wait: the stage is on World too, and a band redrawn at every gauge
  // frame for 45 s outruns the hook budget under a loaded suite. Unfolded, it reads the snapshot.
  await ui.press({ key: 'hot-c' })
  net.down = true
  await clock.advance(WORLD_STALE_MS)
  expect((states.get('world') as WorldState).stale).toBe(true)
  await ui.press({ key: 'collapse' })
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
      hunt: null,
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

test("a short band shows the stage's bottom rows at full size; a boss zooms out to the floor, then compact", async ($, on) => {
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
  // A boss needs all 17: the whole scene zooms into the same 11 rows (#230), the band's height kept.
  shown.view = boss()
  const withBoss = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...band(120, 16) })
  expect(await height(withBoss)).toBe(16)
  expect((await bandRaster(withBoss))?.props.columns).toBe(120)
  expect(await stageRowsOf(withBoss)).toBe(11)
  await withBoss.unmount()
  // 13 rows leave the zoom's 8-row floor; 12 leave 7, under it: compact.
  const floor = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...band(120, 13) })
  expect(await stageRowsOf(floor)).toBe(8)
  await floor.unmount()
  const under = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...band(120, 12) })
  expect(await height(under)).toBe(6)
  await under.unmount()
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

test("the debug log has the engine's row grant at each layout", async ($, on) => {
  const { data, shown } = harness(on)
  const logged: { text: string; to: string }[] = []
  on('ui.log', (_$, e, next) => {
    logged.push({ text: e.text, to: e.to })
    return next(e)
  })
  settings(data, RASTER)
  shown.view = boss()
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...band(120, 15) })
  await ui.unmount()
  // The same layout drawn again logs nothing more; a new one logs its line.
  const again = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...band(120, 15) })
  await again.unmount()
  const short = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...band(120, 12) })
  await short.unmount()
  const lines = logged.filter((l) => l.text.startsWith('band layout'))
  expect(lines.every((l) => l.to === 'debug')).toBe(true)
  expect(lines.map((l) => l.text)).toEqual([
    'band layout: maxRows 15, bodyColumns 120: full, 10 stage rows',
    'band layout: maxRows 12, bodyColumns 120: compact, 4 stage rows',
  ])
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

// The agents view's log (#185) at 140 columns: the band at 135 before ←, nothing drawn while the
// REPL is away, the dialog's dock leaving it 72 after `/promptfall`, 135 when the dock closes. The
// engine reported every width; a terminal that grew meanwhile reports more. The loop's blits follow.
for (const renderer of ['raster', 'image'] as const) {
  test(
    `the band draws at the columns of each render after the agents view (${renderer})`,
    { timeoutMs: 45_000 },
    async ($, on) => {
      const { data, clock, blits } = harness(on)
      settings(data, { renderer })
      await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
      const before = await $.ui.mount({
        plugin: 'promptfall',
        surface: 'terminal',
        ...band(135, 34),
      })
      expect((await before.find({ key: 'band-135x22' }))?.props.columns).toBe(135)
      await before.unmount()
      const docked = await $.ui.mount({
        plugin: 'promptfall',
        surface: 'terminal',
        ...band(72, 34),
      })
      expect(await docked.find({ key: 'row-collapsed' })).toBeDefined()
      await docked.unmount()
      for (const columns of [135, 160]) {
        const ui = await $.ui.mount({
          plugin: 'promptfall',
          surface: 'terminal',
          ...band(columns, 34),
        })
        const key = `band-${columns}x22`
        expect((await ui.find({ key }))?.props.columns, `${columns} columns`).toBe(columns)
        const from = blits.length
        await clock.advance(1_000)
        const drawn = blits.slice(from)
        expect(drawn.length, `${columns} columns: the loop blits`).toBeGreaterThan(0)
        for (const b of drawn) expect(b).toMatchObject({ key, columns })
        await ui.unmount()
      }
    },
  )
}

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

describe('a zone boss on the desktop, read only', () => {
  // The rule is at the first group.
  test('the 17-row stage at 30 rows, a positive size at 3', async ($, on) => {
    const { shown } = harness(on)
    shown.view = boss()
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

    // The desktop draws the 17-row stage for a zone boss, never the compact one (ADR 0004).
    const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'desktop', ...band(95, 30) })
    const { stage, strip } = await svgs(ui)
    expect(String(stage?.props.source), 'boss at 30 rows: the 17-row stage').toContain(
      'viewBox="0 0 928 272"',
    )
    expect(await ui.find({ key: 'compact-stage' }), 'boss at 30 rows: not compact').toBeUndefined()
    expect(String(strip?.props.alt), 'boss at 30 rows: the strip says Boss').toContain('Boss')
    await ui.unmount()

    // On a desktop band of three rows the boss stage keeps a positive size.
    const three = await $.ui.mount({ plugin: 'promptfall', surface: 'desktop', ...band(95, 3) })
    const small = (await svgs(three)).stage
    expect(small, 'boss at 3 rows: a stage').toBeDefined()
    for (const v of [small?.props.width, small?.props.height]) {
      if (v !== undefined) expect(Number(v), 'boss at 3 rows: a positive size').toBeGreaterThan(0)
    }
    await three.unmount()
  })
})

/** Loot lines `Loot line 1` to `Loot line n`, one row each in the message window. */
const lootLines = (n: number, from = 1): GameView['loot'] =>
  Array.from({ length: n }, (_, i) => ({
    text: `Loot line ${from + i}`,
    rarity: 'common',
    kind: 'drop' as const,
    itemId: null,
    lead: null,
    name: `Loot line ${from + i}`,
    rest: '',
  }))

/** The message window's footer before the hint, and the loot lines its rows show. */
function paging(text: string) {
  return {
    footer: text.match(/ (\d+-\d+\/\d+) c ▾/)?.[1] ?? null,
    rows: [...text.matchAll(/Loot line (\d+)/g)].map((m) => Number(m[1])),
  }
}

test('j and k page the Loot tab two rows at a time, the footer says where; the page survives the next blit', async ($, on) => {
  const { data, shown, clock, blits } = harness(on)
  settings(data, RASTER)
  shown.view = { ...wave(), loot: lootLines(5) }
  shown.notice = null
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...band(120, 20) })
  await ui.press({ key: 'hot-l' })
  expect(paging(await stripText(ui))).toEqual({ footer: null, rows: [4, 5] })
  await ui.press({ key: 'hot-j' })
  expect(paging(await stripText(ui))).toEqual({ footer: '2-3/5', rows: [2, 3] })
  await ui.press({ key: 'hot-j' })
  expect(paging(await stripText(ui))).toEqual({ footer: '1-2/5', rows: [1, 2] })
  await ui.press({ key: 'hot-k' })
  expect(paging(await stripText(ui))).toEqual({ footer: '3-4/5', rows: [3, 4] })
  // The loop's next blit draws the same page, not the newest.
  const before = blits.length
  await clock.advance(6_000)
  const last = blits
    .slice(before)
    .flatMap((b) => ('cells' in b ? [b] : []))
    .at(-1)
  expect(last).toBeDefined()
  const cells = cellsOf({ props: { columns: last?.columns, cells: last?.cells }, children: [] })
  expect(paging(cells.text.slice(-STRIP_ROWS).join('\n'))).toEqual({
    footer: '3-4/5',
    rows: [3, 4],
  })
  await ui.unmount()
  // A new line, the oldest trimmed, leaves the window where it was.
  shown.view = { ...wave(), loot: lootLines(5, 2) }
  const later = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...band(120, 20) })
  expect(paging(await stripText(later))).toEqual({ footer: '2-3/5', rows: [3, 4] })
  await later.press({ key: 'hot-k' })
  expect(paging(await stripText(later))).toEqual({ footer: null, rows: [5, 6] })
  // At the newest the window follows the next line.
  shown.view = { ...wave(), loot: lootLines(5, 3) }
  await later.unmount()
  const next = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...band(120, 20) })
  expect(paging(await stripText(next))).toEqual({ footer: null, rows: [6, 7] })
  await next.unmount()
})

test('a tab switch, c and a zone change put the log back at the newest', async ($, on) => {
  const { data, shown, clock } = harness(on)
  settings(data, RASTER)
  shown.view = { ...wave(), loot: lootLines(5) }
  shown.notice = null
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const mount = () => $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...band(120, 20) })
  const ui = await mount()
  await ui.press({ key: 'hot-l' })
  const newest = { footer: null, rows: [4, 5] }
  const back = { footer: '2-3/5', rows: [2, 3] }
  await ui.press({ key: 'hot-j' })
  expect(paging(await stripText(ui)), 'paged').toEqual(back)
  await ui.press({ key: 'hot-w' })
  await ui.press({ key: 'hot-l' })
  expect(paging(await stripText(ui)), 'a tab switch').toEqual(newest)
  await ui.press({ key: 'hot-j' })
  await ui.press({ key: 'hot-c' })
  await ui.press({ key: 'collapse' })
  expect(paging(await stripText(ui)), 'c').toEqual(newest)
  await ui.press({ key: 'hot-j' })
  expect(paging(await stripText(ui)), 'paged again').toEqual(back)
  await ui.unmount()
  // Travel: the view's zone changes, and stays at the newest coming back.
  shown.view = { ...wave(), zone: 2, loot: lootLines(5) }
  const moved = await mount()
  expect(paging(await stripText(moved)), 'a zone change').toEqual(newest)
  // The reset is written just after the render that saw the change.
  await clock.advance(1)
  await moved.unmount()
  shown.view = { ...wave(), loot: lootLines(5) }
  const home = await mount()
  expect(paging(await stripText(home)), 'back in zone 1').toEqual(newest)
  await home.unmount()
})

test('on World a notice longer than the window pages: k on through it, j back to its first rows', async ($, on) => {
  const { data, shown } = harness(on)
  settings(data, RASTER)
  shown.notice =
    'Sound on; /promptfall sound off silences it. Welcome to Promptfall. /promptfall heroes to meet your party.'
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...band(120, 20) })
  await ui.press({ key: 'hot-w' })
  const first = await stripText(ui)
  expect(first, 'its first rows, the footer saying there is more').toMatch(/ 1-2\/4 c ▾/)
  expect(first).toContain('Sound on;')
  await ui.press({ key: 'hot-k' })
  const last = await stripText(ui)
  expect(last, 'k: its last rows, no footer').not.toMatch(/\/4 c ▾/)
  expect(last).toContain('party.')
  await ui.press({ key: 'hot-j' })
  expect(await stripText(ui), 'j: its first rows again').toMatch(/ 1-2\/4 c ▾/)
  await ui.unmount()
})

test('j pages the Party log back while it runs; a compact layout puts it at the newest and pages nothing; World without a notice never pages', async ($, on) => {
  const { data, clock } = harness(on)
  settings(data, { ...RASTER, motion: 'still' })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const footer = (text: string) => text.match(/ (\d+)-(\d+)\/(\d+) c ▾/)
  let ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...band(120, 20) })
  for (let i = 0; i < 40; i++) {
    await clock.advance(2_000)
    await ui.unmount()
    ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...band(120, 20) })
    if ((await stripText(ui)).includes(' hits ')) break
  }
  // Enough of the fight for a page back: the window ends two rows above the newest.
  for (let i = 0; i < 10; i++) await clock.advance(2_000)
  await ui.unmount()
  ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...band(120, 20) })
  expect(footer(await stripText(ui)), 'Party at the newest').toBeNull()
  await ui.press({ key: 'hot-j' })
  const at = footer(await stripText(ui))
  expect(at, 'Party paged back').not.toBeNull()
  expect(Number(at?.[3]) - Number(at?.[2])).toBe(2)
  await ui.unmount()
  // 110 columns lays out compact: j and k do nothing there, and the full band is back at the newest.
  const compact = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...band(110, 20) })
  expect(await height(compact), 'compact').toBe(6)
  expect(await compact.find({ key: 'hot-j' }), 'compact: j bound').toBeDefined()
  await compact.press({ key: 'hot-j' })
  await compact.press({ key: 'hot-k' })
  // The reset is written just after the render that laid out compact.
  await clock.advance(1)
  await compact.unmount()
  ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...band(120, 20) })
  expect(footer(await stripText(ui)), 'back from compact at the newest').toBeNull()
  await ui.press({ key: 'hot-w' })
  await ui.press({ key: 'hot-j' })
  expect(footer(await stripText(ui)), 'World without a notice never pages').toBeNull()
  await ui.unmount()
})

test('k pages from the window the loop last drew, not the one the band rendered before a new line', async ($, on) => {
  const { data, clock, blits } = harness(on)
  settings(data, { ...RASTER, motion: 'still' })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const footer = (text: string) => {
    const m = text.match(/ (\d+)-(\d+)\/(\d+) c ▾/)
    return m ? { end: Number(m[2]), total: Number(m[3]) } : null
  }
  const drawn = () => {
    const last = blits.flatMap((b) => ('cells' in b ? [b] : [])).at(-1)
    const cells = cellsOf({ props: { columns: last?.columns, cells: last?.cells }, children: [] })
    return footer(cells.text.slice(-STRIP_ROWS).join('\n'))
  }
  let ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...band(120, 20) })
  for (let i = 0; i < 40; i++) {
    await clock.advance(2_000)
    await ui.unmount()
    ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...band(120, 20) })
    if ((await stripText(ui)).includes(' hits ')) break
  }
  for (let i = 0; i < 10; i++) await clock.advance(2_000)
  await ui.unmount()
  ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...band(120, 20) })
  await ui.press({ key: 'hot-j' })
  const rendered = footer(await stripText(ui))
  expect(rendered, 'paged back one page').not.toBeNull()
  // The loop reveals the next line through a blit, the band's render left as it was.
  let shown = null
  for (let i = 0; i < 200; i++) {
    await clock.advance(100)
    shown = drawn()
    if (shown && shown.total !== rendered?.total) break
  }
  expect(shown, 'a blit drew a new line').not.toBeNull()
  expect(shown?.total, 'the render is older than the blit').not.toBe(rendered?.total)
  expect(footer(await stripText(ui)), 'the render has not moved').toEqual(rendered)
  // k moves the window the loop drew two rows newer, the new line still below it.
  await ui.press({ key: 'hot-k' })
  const after = footer(await stripText(ui))
  expect(after, 'k: two rows newer than the blit, not the newest').toEqual({
    end: (shown?.end ?? 0) + 2,
    total: shown?.total,
  })
  await ui.unmount()
})

test("Loot and World draw the 17-row stage over the strip at Party's 22 rows; the loop blits the band there", async ($, on) => {
  const { data, blits, clock } = harness(on)
  settings(data, RASTER)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...band(120, 30) })
  expect(await height(ui), 'party').toBe(22)
  for (const key of ['hot-l', 'hot-w']) {
    await ui.press({ key })
    expect(await height(ui), key).toBe(22)
    expect(await stageRowsOf(ui), key).toBe(17)
  }
  // Ticks keep changing the stage and the strip: the band blits whole, never a part of it.
  const before = blits.length
  await clock.advance(20_000)
  const later = blits.slice(before)
  expect(later.some((b) => b.key === bandKey({ columns: 120, rows: 22 }))).toBe(true)
  expect(later.some((b) => b.key === 'stage' || b.key === 'strip')).toBe(false)
  await ui.unmount()
})

test('in a short or narrow band Loot and World crop, zoom or go compact as Party does', async ($, on) => {
  const { data, shown } = harness(on)
  settings(data, RASTER)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const mount = (columns: number, maxRows: number) =>
    $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...band(columns, maxRows) })
  for (const tab of ['loot', 'world'] as const) {
    shown.view = wave()
    const pick = await mount(120, 30)
    await pick.press({ key: `hot-${tab[0]}` })
    await pick.unmount()
    // A wave in 16 rows: the sky cropped to the 11 rows above the strip.
    const cropped = await mount(120, 16)
    expect(await height(cropped), `${tab}: cropped`).toBe(16)
    expect(await stageRowsOf(cropped), `${tab}: cropped`).toBe(11)
    await cropped.unmount()
    // A boss keeps its 17 rows whole on every tab: in 15 it zooms into the 10 left, in 12 compact.
    shown.view = boss()
    const zoomed = await mount(120, 15)
    expect(await stageRowsOf(zoomed), `${tab}: zoomed`).toBe(10)
    await zoomed.unmount()
    const under = await mount(120, 12)
    expect(await height(under), `${tab}: compact under the floor`).toBe(6)
    await under.unmount()
    // Under 100 columns or 6 rows, the one-row band.
    for (const [columns, maxRows] of [
      [99, 20],
      [120, 5],
    ] as const) {
      const small = await mount(columns, maxRows)
      expect(await rows(small), `${tab}: ${columns} x ${maxRows}`).toHaveLength(1)
      await small.unmount()
    }
  }
})

test('the compact band shows the newest four loot rows on Loot, presence, records, chat and a blank row on World; j and k do nothing', async ($, on) => {
  const { data, shown } = harness(on)
  settings(data, RASTER)
  shown.view = { ...wave(), loot: lootLines(7) }
  shown.notice = null
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...band(110, 20) })
  const window = async () => cellsOf(await bandRaster(ui)).text.map((r) => r.slice(52))
  await ui.press({ key: 'hot-l' })
  expect(await height(ui), 'loot').toBe(6)
  expect(paging((await window()).join('\n')), 'loot').toEqual({ footer: null, rows: [4, 5, 6, 7] })
  for (const key of ['hot-j', 'hot-k', 'hot-j']) await ui.press({ key })
  expect(paging((await window()).join('\n')), 'loot after j and k').toEqual({
    footer: null,
    rows: [4, 5, 6, 7],
  })
  await ui.press({ key: 'hot-w' })
  expect(await height(ui), 'world').toBe(6)
  const world = await window()
  expect(world[1], 'presence').toContain('1 online · zone 1: nobody else here')
  expect(world[2], 'records').toContain('world boss and hunt are off')
  expect(world[3], 'chat').toContain('chat needs a server')
  expect(world[4]?.replace(/│/g, '').trim(), 'the blank row').toBe('')
  await ui.unmount()
})

test('on the desktop the World tab draws the stage Svg over the strip Svg as Party does, its hotkeys hidden', async ($, on) => {
  harness(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'desktop', ...band(120, 20) })
  const party = await svgs(ui)
  await ui.press({ key: 'hot-w' })
  const { stage, strip } = await svgs(ui)
  expect(stage?.type).toBe('Svg')
  expect(String(stage?.props.source)).toBe(String(party.stage?.props.source))
  expect(strip?.type).toBe('Svg')
  expect(String(strip?.props.alt)).toContain('World tab')
  // The strip sits under the stage: the line closes round its bottom, as Party's does.
  const line = (doc: unknown) => String(doc).match(/<path fill="#f0f0e8"[^>]*\/><\/svg>$/)?.[0]
  expect(line(strip?.props.source)).toBeDefined()
  expect(line(strip?.props.source)).toBe(line(party.strip?.props.source))
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

test('a survey leaves the band up at its layout and the stage keeps blitting', async ($, on) => {
  const { data, blits, clock, shown } = harness(on)
  settings(data, RASTER)
  shown.view = wave()
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  // A permission prompt or a question: the full band, as without one, and the loop draws it.
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...band(120, 20, true) })
  const raster = await bandRaster(ui)
  expect([raster?.props.columns, raster?.props.rows]).toEqual([120, 20])
  const key = bandKey({ columns: 120, rows: 20 })
  const before = blits.length
  await clock.advance(5_000)
  expect(blits.slice(before).filter((b) => b.key === key).length).toBeGreaterThan(0)
  await ui.unmount()
  // A prompt that leaves the band 5 rows: the one-line collapse, not nothing.
  const short = await $.ui.mount({
    plugin: 'promptfall',
    surface: 'terminal',
    ...band(120, 5, true),
  })
  expect(await rows(short)).toHaveLength(1)
  expect(await short.find({ text: /^Promptfall · Z1/ })).toBeDefined()
  await short.unmount()
  // Off still hides it.
  await $.command.run({ ...RUN, command: 'promptfall', args: 'off' })
  const off = await $.ui.mount({
    plugin: 'promptfall',
    surface: 'terminal',
    ...band(120, 20, true),
  })
  expect(await off.find({ key: 'band' })).toBeUndefined()
  expect(await off.find({ key: 'engine-band' })).toBeDefined()
  await off.unmount()
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

test('forcing a renderer before the probe answers keeps the probe going for this session', async ($, on) => {
  const { data } = harness(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  // /promptfall renderer raster applies from the next start; this session still has to decide.
  data.set('promptfall:settings', { ...SETTINGS_DEFAULT, renderer: 'raster' })
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...band(120, 20) })
  expect(await ui.find({ key: 'probe' })).toBeDefined()
  await ui.unmount()
})

// ---------------------------------------------------------------------------
// The first session, read only

describe('the first session, its renderer unknown, read only', () => {
  // The rule is at the first group. No settings and no shown view: the first-run welcome is up
  // and the renderer unprobed, and as no check here moves the clock, both stay so throughout.
  test('narrow layouts, the world boss rows, the pending probe, the desktop Svgs', async ($, on) => {
    const { states } = harness(on)
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

    // Narrow terminals get one row.
    {
      const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...band(80) })
      expect(await rows(ui), 'narrow terminal: one row').toHaveLength(1)
      // A notice (here the first-run welcome) shows on the one line too.
      expect(
        await ui.find({ text: /Sound on; \/promptfall sound off/ }),
        'narrow terminal: the welcome on its row, its opt-out first',
      ).toBeDefined()
      await ui.unmount()
    }

    // A narrow desktop draws the full stage and the strip, laid out in 116 columns and scaled.
    {
      const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'desktop', ...band(95, 20) })
      const { stage, strip } = await svgs(ui)
      expect(stage?.type, 'narrow desktop: the stage Svg').toBe('Svg')
      expect(strip?.type, 'narrow desktop: the strip Svg').toBe('Svg')
      expect(String(strip?.props.source), 'narrow desktop: the strip in 116 columns').toContain(
        `viewBox="0 0 ${116 * CELL_W} ${STRIP_ROWS * CELL_H}"`,
      )
      expect(String(strip?.props.source), 'narrow desktop: the strip scaled to 95').toContain(
        `width="${95 * DESKTOP_COLUMN_PX_CEILING}"`,
      )
      // Rung (a′) on the desktop (spike sheet): the hotkeys sit in a hidden absolute Box, no row.
      expect(await ui.find({ key: 'row-hotkeys' }), 'narrow desktop: no hotkey row').toBeUndefined()
      const keys = await ui.find({ key: 'hotkeys' })
      expect(
        [keys?.props.width, keys?.props.position],
        'narrow desktop: the hotkeys absolute, zero wide',
      ).toEqual([0, 'absolute'])
      await ui.unmount()
      // VS Code is untested: it keeps rung (c), a row of its own under the strip.
      const vscode = await $.ui.mount({ plugin: 'promptfall', surface: 'vscode', ...band(95, 20) })
      expect(await vscode.find({ key: 'row-hotkeys' }), 'vscode: a hotkey row').toBeDefined()
      await vscode.unmount()
    }

    // The world boss reads the snapshot, less what this party dealt since.
    {
      const plain = states.get('view') as GameView
      const view = (dealt: number): GameView => ({
        ...plain,
        boss: { bossId: 'wb1', name: BOSS.name, glyph: '☠', dealt },
      })
      const now = 1_000_000
      // The view's tally equals the committed one: the server's HP as it is.
      const even = bossWorld(BOSS, { bossId: 'wb1', dealt: 0 })
      expect(worldRows(view(0), even, now)[1]?.text, 'world boss: the HP as served').toBe(
        'World boss The Promptwyrm █████░░░ 62% · 11m left · you 0',
      )
      // 300 dealt locally past the committed 200: 5,900 shown.
      const ahead = bossWorld(BOSS, { bossId: 'wb1', dealt: 200 })
      expect(shownBoss(view(500), ahead)?.shownHp, 'world boss: less what was dealt since').toBe(
        5_900,
      )
      // A secondary has no committed reading: nothing is subtracted.
      expect(
        shownBoss(view(500), bossWorld(BOSS, null))?.shownHp,
        'world boss: a secondary subtracts nothing',
      ).toBe(6_200)
      // Down: the World row says so.
      const down = bossWorld({ ...BOSS, hp: 0 }, null)
      expect(worldRows(view(500), down, now)[1]?.text, 'world boss: down').toBe(
        'The Promptwyrm is down · you 500',
      )
    }

    // While the renderer is unknown the stage and strip rows are empty and the strip row probes.
    {
      const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...band(120, 20) })
      expect(await ui.find({ key: 'stage' }), 'unknown renderer: no stage').toBeUndefined()
      const row = await ui.find({ key: 'row-strip' })
      expect(
        row?.children.some((c) => (c as { props?: { key?: string } }).props?.key === 'probe'),
        'unknown renderer: the probe in the strip row',
      ).toBe(true)
      const probe = await ui.find({ key: 'probe' })
      expect(
        [probe?.type, probe?.props.columns, probe?.props.rows],
        'unknown renderer: the probe a 1 × 1 Image',
      ).toEqual(['Image', 1, 1])
      // 20 rows: the stage's 15 empty rows above the strip's 5, as the layout will draw them.
      expect(await height(ui), 'unknown renderer: the band at 20 rows').toBe(20)
      await ui.unmount()
    }

    // The desktop draws the stage Svg and the strip Svg, each with its alt.
    {
      const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'desktop', ...band(120, 20) })
      const { stage, strip } = await svgs(ui)
      // An image: SMIL runs in it and a new source swaps in without the frame's blank reload.
      expect(stage?.props.isInteractive, 'desktop Svgs: the stage as tuned').toBe(SVG_INTERACTIVE)
      expect(SVG_INTERACTIVE, 'desktop Svgs: the stage an image').toBe(false)
      expect(String(stage?.props.alt), 'desktop Svgs: the stage alt').toMatch(/^Zone 1/)
      expect(String(strip?.props.alt), 'desktop Svgs: the strip alt').toContain('Party:')
      await ui.unmount()
    }

    // The Svg band draws the shell behind the stage and the strip, and the line around both.
    {
      const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'desktop', ...band(120, 20) })
      const { stage, strip } = await svgs(ui)
      const s = String(stage?.props.source)
      const t = String(strip?.props.source)
      // Both on the windows' grid at the band's 120 columns, 8 by 16 a cell, drawn at its width.
      expect(s, 'Svg shell: the stage grid').toMatch(
        /^<svg [^>]*viewBox="0 0 960 272" width="1920" height="544"/,
      )
      expect(t, 'Svg shell: the strip grid').toMatch(
        /^<svg [^>]*viewBox="0 0 960 80" width="1920" height="160"/,
      )
      // The shell first, under everything; the 1.5x stage scaled onto the grid over it.
      expect(s, 'Svg shell: under the stage').toContain(
        '</defs><rect width="960" height="272" fill="#303028"/><g transform="translate(0 0) scale(5.3333)">',
      )
      expect(t, 'Svg shell: under the strip').toContain(
        '</defs><rect width="960" height="80" fill="#303028"/>',
      )
      // The stage Svg ends on the line's top and sides, the shell outside them over its outermost
      // pixels; the strip Svg on its sides and bottom, over the outer windows' own lines. Stacked,
      // the sides meet: 2 pixels wide, 2 in from each edge, the corners cut.
      expect(s, 'Svg shell: the line over the stage').toMatch(
        /<path fill="#303028" fill-rule="evenodd" d="M0 0H960V272H0ZM3 2H957V3H958V272H2V3H3Z"\/><path fill="#f0f0e8" d="M3 2H957V3H958V272H956V4H4V272H2V3H3Z"\/><\/svg>$/,
      )
      expect(t, 'Svg shell: the line under the strip').toMatch(
        /<path fill="#303028" fill-rule="evenodd" d="M0 0H960V80H0ZM2 0H958V69H957V70H3V69H2Z"\/><path fill="#f0f0e8" d="M2 0H4V68H956V0H958V69H957V70H3V69H2Z"\/><\/svg>$/,
      )
      // The SMIL stays in each: the actors' idle clock runs inside the scaled stage.
      expect(s, 'Svg shell: the SMIL in the scaled stage').toMatch(
        /scale\(5\.3333\)">.*repeatCount="indefinite".*<\/g><path fill="#303028"/,
      )
      expect(s.length, 'Svg shell: the stage under its cap').toBeLessThan(SVG_MAX_CHARS)
      expect(t.length, 'Svg shell: the strip within its cap').toBeLessThanOrEqual(
        STRIP_SVG_MAX_CHARS,
      )
      await ui.unmount()
    }

    // The desktop at 95, 60 and 130 columns draws the full stage 116, 116 and 130 columns wide at
    // 1.5 pixels a column.
    for (const [columns, art] of [
      [95, 116],
      [60, 116],
      [130, 130],
    ] as const) {
      const ui = await $.ui.mount({
        plugin: 'promptfall',
        surface: 'desktop',
        ...band(columns, 20),
      })
      const { stage } = await svgs(ui)
      const source = String(stage?.props.source)
      const at = `desktop at ${columns}`
      // On the windows' grid, 8 pixels a column; the 1.5x art scaled on at 16/3 an art pixel.
      expect(source, `${at}: the stage ${art} columns`).toContain(
        `viewBox="0 0 ${art * CELL_W} 272"`,
      )
      expect(source, `${at}: the art at 1.5x`).toContain(
        '<g transform="translate(0 0) scale(5.3333)">',
      )
      expect(String(stage?.props.alt), `${at}: the stage alt`).toMatch(/^Zone 1/)
      // No width prop: the markup is wider than the band and the desktop scales it down to fit.
      expect(stage?.props.width, `${at}: no width prop`).toBeUndefined()
      expect(source, `${at}: the markup's width`).toContain(
        `width="${columns * DESKTOP_COLUMN_PX_CEILING}"`,
      )
      await ui.unmount()
    }

    // On the desktop the stage sits in a column, so its frame takes the band width.
    {
      // In a row Box the desktop draws an interactive Svg's frame at the default 300 × 150 points.
      const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'desktop', ...band(95, 12) })
      expect(
        (await ui.find({ key: 'row-stage' }))?.props.flexDirection,
        'desktop stage row: a column',
      ).toBe('column')
      await ui.unmount()
    }
  })
})
