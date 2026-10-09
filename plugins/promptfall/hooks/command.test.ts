import type { On } from 'claude-code'
import { expect, mock, type TestBody, test } from 'claude-code/testing'
import type { GameView, WorldState } from '../types'
import { decode } from './sprites/base64'
import { bandKey, stageKey } from './stage/loop'
import { SANDBOX_PREFIX, StoreKeyValue } from './storage'
import { unzlibSync } from './vendor/fflate.js'
import { Ledger } from './vendor/ledger.js'
import { BOSS_WINDOW_MS } from './vendor/protocol.js'
import { content } from './vendor/sim.js'
import { BORDER_RGB, CELL_H, CELL_W, FIELD_RGB, STRIP_ROWS } from './windows/tuning'

const RUN = {
  origin: { kind: 'composer' },
  presentation: { isFullscreen: false, columns: 120 },
} as const

function harness(
  on: On,
  seed: Record<string, unknown> = {},
  env: Record<string, string> = {},
  now = 1_000_000,
) {
  const data = new Map<string, unknown>(Object.entries(seed))
  const states = new Map<string, unknown>()
  const opened: { id: string; title?: string }[] = []
  const toasts: string[] = []
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
  // The sandbox switch reads the environment: unset unless a test turns the sandbox on.
  mock.env(on, env)
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.open', (_$, e) => {
    opened.push({ id: e.id, ...(e.title ? { title: e.title } : {}) })
    return { value: { isPlaced: true } }
  })
  const clock = mock.clock(on, { now })
  const view = () => states.get('view') as GameView
  return { data, states, opened, toasts, clock, view }
}

test('/promptfall off hides the band but the game keeps playing', async ($, on) => {
  const { states, clock } = harness(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  expect(states.get('mode')).toBe('primary')
  const off = await $.command.run({ ...RUN, command: 'promptfall', args: 'off' })
  expect(off.text).toBe('Promptfall band is off for this session')
  expect(states.get('mode')).toBe('off')
  const before = JSON.stringify(states.get('view'))
  await clock.advance(30_000)
  expect(JSON.stringify(states.get('view'))).not.toBe(before)
  expect(states.get('mode')).toBe('off')
  const back = await $.command.run({ ...RUN, command: 'promptfall', args: 'on' })
  expect(back.text).toBe('Promptfall band is on')
  expect(states.get('mode')).toBe('primary')
})

test('off in a secondary session hides the band without taking the lease; on takes it', async ($, on) => {
  const { states } = harness(on, {
    'promptfall:lease': { owner: 'someone-else', until: 9_999_999_999_999 },
  })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  expect(states.get('mode')).toBe('secondary')
  await $.command.run({ ...RUN, command: 'promptfall', args: 'off' })
  expect(states.get('mode')).toBe('off')
  await $.command.run({ ...RUN, command: 'promptfall', args: 'on' })
  expect(states.get('mode')).toBe('primary')
})

test('/promptfall heroes opens the pane on the heroes tab', async ($, on) => {
  const { states, opened } = harness(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const r = await $.command.run({ ...RUN, command: 'promptfall', args: 'heroes' })
  expect(r.text).toBe('Promptfall opened')
  expect(opened).toEqual([{ id: 'promptfall', title: 'Promptfall' }])
  expect(states.get('dialogTab')).toBe('heroes')
})

test('/promptfall farm toggles the farm flag', async ($, on) => {
  const { states } = harness(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const r = await $.command.run({ ...RUN, command: 'promptfall', args: 'farm' })
  expect(r.text).toBe('Promptfall farm is on')
  expect((states.get('view') as { farm: boolean }).farm).toBe(true)
})

test('/promptfall in a secondary session takes the lease', async ($, on) => {
  const { states } = harness(on, {
    'promptfall:lease': { owner: 'someone-else', until: 9_999_999_999_999 },
  })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  expect(states.get('mode')).toBe('secondary')
  await $.command.run({ ...RUN, command: 'promptfall', args: 'heroes' })
  expect(states.get('mode')).toBe('primary')
})

test('the settings commands write the store and the atom, and answer', async ($, on) => {
  const { data, states } = harness(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const run = (args: string) => $.command.run({ ...RUN, command: 'promptfall', args })
  expect((await run('sound on')).text).toBe('Sound on')
  expect((await run('motion still')).text).toBe('Motion: still')
  expect((await run('renderer raster')).text).toBe(
    'Renderer: raster (applies at the next session start)',
  )
  const stored = { sound: true, motion: 'still', renderer: 'raster' }
  expect(data.get('promptfall:settings')).toEqual(stored)
  expect(states.get('settings')).toEqual(stored)
  expect((await run('sound off')).text).toBe('Sound off')
  expect((data.get('promptfall:settings') as { sound: boolean }).sound).toBe(false)
})

test('a bad setting value answers its usage and writes nothing', async ($, on) => {
  const { data } = harness(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const run = (args: string) => $.command.run({ ...RUN, command: 'promptfall', args })
  expect((await run('sound loud')).text).toBe('usage: /promptfall sound on|off')
  expect((await run('motion')).text).toBe('usage: /promptfall motion full|still')
  expect((await run('renderer svg')).text).toBe('usage: /promptfall renderer auto|image|raster')
  expect(data.has('promptfall:settings')).toBe(false)
})

test('a settings command claims the lease, so this session is the one that plays', async ($, on) => {
  const { states } = harness(on, {
    'promptfall:lease': { owner: 'someone-else', until: 9_999_999_999_999 },
  })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  expect(states.get('mode')).toBe('secondary')
  await $.command.run({ ...RUN, command: 'promptfall', args: 'sound on' })
  expect(states.get('mode')).toBe('primary')
})

// ---------------------------------------------------------------------------
// The sandbox verbs, with the sandbox on. Each reads the view right after the command returns.

const SANDBOX_ON = { PROMPTFALL_SANDBOX: '1' }
/** The sandbox runs the world boss grid: past the first grid window, so no grid boss engages the party. */
const PAST_GRID_BOSS = BOSS_WINDOW_MS + 1_000_000

async function sandboxOn(on: On, $: Parameters<TestBody>[0], seed: Record<string, unknown> = {}) {
  const h = harness(on, seed, SANDBOX_ON, PAST_GRID_BOSS)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const run = async (args: string) =>
    (await $.command.run({ ...RUN, command: 'promptfall', args: `sandbox ${args}` })).text
  return { ...h, run }
}

test('sandbox boss treant moves the party to its zone and the next tick spawns it', async ($, on) => {
  const { run, view, clock } = await sandboxOn(on, $)
  expect(view().zone).toBe(1)
  expect(await run('boss treant')).toBe('Sandbox: Elder Treant is next')
  expect(view().zone).toBe(2)
  expect(view().enemies).toEqual([])
  // One tick at the idle cadence: no turn is running.
  await clock.advance(5_000)
  expect(view().enemies.map((e) => e.name)).toEqual(['Elder Treant'])
  // A turn boss too: back to zone 1, the fight in progress ended.
  expect(await run('boss boar')).toBe('Sandbox: Wild Boar is next')
  expect(view().zone).toBe(1)
  expect(view().enemies).toEqual([])
  await clock.advance(5_000)
  expect(view().enemies.map((e) => e.name)).toEqual(['Wild Boar'])
})

test('sandbox boss with several matches asks which one; with none, lists them; neither changes anything', async ($, on) => {
  const { run, view } = await sandboxOn(on, $)
  expect(view().boss).toBeNull()
  const before = JSON.stringify(view())
  const which = await run('boss the')
  expect(which).toMatch(/^Which one: /)
  expect(which).toContain('The Sighing Hag')
  expect(which).toContain('The Barrow King')
  const none = (await run('boss nothing')) ?? ''
  expect(none.split('\n')[0]).toBe("No boss named 'nothing'")
  for (const name of ['Bandit Captain', 'Wild Boar', 'Elder Treant', 'The Unwritten One']) {
    expect(none).toContain(name)
  }
  expect(await run('item oak legendary')).toBe('Which one: Oak Staff, Oak Bow')
  expect(JSON.stringify(view())).toBe(before)
})

test('sandbox item drops the item through the drop path, with its toast', async ($, on) => {
  const { run, view, toasts } = await sandboxOn(on, $)
  expect(await run('item oak_staff legendary')).toBe('Sandbox: Oak Staff (legendary) dropped')
  expect(view().inventory.map((i) => [i.base, i.rarity])).toContainEqual(['oak_staff', 'legendary'])
  expect(view().lastDrop?.text).toContain('Oak Staff')
  expect(toasts).toContain('Legendary drop: Oak Staff')
  // No rarity: common, and the display name's words match too.
  expect(await run('item copper')).toBe('Sandbox: Copper Ring (common) dropped')
  expect(await run('item copper mythic')).toMatch(/^No rarity named 'mythic'\n.*legendary/s)
})

test(
  'sandbox item with a full inventory vendors it and the gold grows by its value',
  { timeoutMs: 30_000 },
  async ($, on) => {
    const { run, view, toasts } = await sandboxOn(on, $)
    // Bounded: a verb that stopped dropping must fail the test, not hang it.
    for (let i = 0; i < 40 && view().inventory.length < view().inventoryCap; i++)
      await run('item copper')
    const gold = view().gold
    const ids = view().inventory.map((i) => i.id)
    toasts.length = 0
    expect(await run('item oak_staff legendary')).toBe(
      'Sandbox: Oak Staff vendored, inventory full',
    )
    const value =
      content.rarity.legendary.vendorGoldPerZone * (content.itemBases.oak_staff?.minZone ?? 1)
    expect(view().gold).toBe(gold + value)
    expect(view().inventory.map((i) => i.id)).toEqual(ids)
    expect(toasts).toEqual([`Inventory full: Oak Staff vendored for ${value} gold`])
  },
)

test('sandbox level raises a hero level by level, refuses its own level and stops at the cap', async ($, on) => {
  const { run, view, toasts } = await sandboxOn(on, $)
  const aldric = () => view().roster.find((h) => h.name.startsWith('Aldric'))
  // The reply names the hero with its epithet, as the roster does.
  const name = aldric()?.name
  expect(await run('level ald 5')).toBe(`Sandbox: ${name} is level 5`)
  expect(aldric()?.level).toBe(5)
  toasts.length = 0
  expect(await run('level ald 5')).toBe(`Sandbox: ${name} is already level 5`)
  expect(toasts.filter((t) => t.includes(' reached level '))).toEqual([])
  expect(await run('level ald 7')).toBe(`Sandbox: ${name} is level 7`)
  expect(aldric()?.level).toBe(7)
  // One burst levels it twice: one toast, at the highest level.
  expect(toasts.filter((t) => t.includes(' reached level '))).toEqual([`${name} reached level 7`])
  expect(await run('level ald 99')).toBe(`Sandbox: ${name} is level 20, the common cap`)
  expect(aldric()?.level).toBe(20)
  expect(await run('level ald 30')).toBe(`Sandbox: ${name} is level 20, the common cap`)
  expect(await run('level nobody 3')).toMatch(/^No hero named 'nobody'\n.*Aldric/s)
})

test('sandbox zone moves the party to that zone at wave 1; outside the content answers the range', async ($, on) => {
  const { run, view } = await sandboxOn(on, $)
  expect(await run('zone 4')).toBe('Sandbox: zone 4, Old Barrow Hills')
  expect(view().zone).toBe(4)
  expect(view().wave).toBe(1)
  expect(view().zoneName).toBe('Old Barrow Hills')
  expect(await run('zone 13')).toBe(`Sandbox: zones run 1 to ${content.zones.length}`)
  expect(view().zone).toBe(4)
})

test('sandbox recruit adds a hero of that rarity through the recruit path', async ($, on) => {
  const { run, view, toasts } = await sandboxOn(on, $)
  const before = view().roster.map((h) => h.id)
  const reply = (await run('recruit epic')) ?? ''
  const added = view().roster.filter((h) => !before.includes(h.id))
  expect(added.map((h) => h.rarity)).toEqual(['epic'])
  expect(reply).toBe(`Sandbox: ${added[0]?.name} (epic) recruited`)
  expect(toasts).toContain(`Epic recruit: ${added[0]?.name}`)
})

test(
  'sandbox recruit with a full roster says so and the roster is unchanged',
  { timeoutMs: 30_000 },
  async ($, on) => {
    const { run, view } = await sandboxOn(on, $)
    for (let i = 0; i < 30 && view().roster.length < view().rosterCap; i++) await run('recruit')
    const ids = view().roster.map((h) => h.id)
    expect(await run('recruit epic')).toBe('Sandbox: roster full, nobody recruited')
    expect(view().roster.map((h) => h.id)).toEqual(ids)
  },
)

test('sandbox wipe makes the party fall and retreat one zone', async ($, on) => {
  const { run, view, toasts } = await sandboxOn(on, $)
  await run('zone 3')
  const wipes = view().wipes
  expect(await run('wipe')).toBe('Sandbox: the party fell, retreating to zone 2')
  expect(view().zone).toBe(2)
  expect(view().wipes).toBe(wipes + 1)
  expect(toasts).toContain('The party fell, retreating to zone 2')
})

test('sandbox wipe in boss mode says so and changes nothing', async ($, on) => {
  const { run, view, data } = await sandboxOn(on, $)
  await run('zone 3')
  expect(view().boss).toBeNull()
  // A second ledger over the same save engages the account: its presence comes from a world poll.
  const store = {
    get: async (key: string) => data.get(key),
    set: async (key: string, value: unknown) => {
      data.set(key, JSON.parse(JSON.stringify(value)))
    },
    delete: async (key: string) => {
      data.delete(key)
    },
    keys: async () => [...data.keys()],
  }
  const ledger = new Ledger({
    kv: new StoreKeyValue(store, SANDBOX_PREFIX),
    now: async () => PAST_GRID_BOSS,
    minClientVersion: '0.0.0',
    seedSource: () => 1,
    tokenSource: () => crypto.randomUUID(),
    linkApprover: async () => null,
    flags: { 'sandbox.enabled': true, 'worldboss.enabled': true },
  })
  const deviceToken = data.get(`${SANDBOX_PREFIX}deviceToken`) as string
  await ledger.world({ deviceToken }, 0)
  expect(await ledger.host.spawnBoss()).toEqual({ ok: true })
  await run('gold 1')
  expect(view().boss).not.toBeNull()
  const before = { zone: view().zone, wipes: view().wipes }
  expect(await run('wipe')).toBe('Sandbox: the party is fighting a world boss, nothing changed')
  expect(await run('zone 5')).toBe('Sandbox: the party is fighting a world boss, nothing changed')
  expect({ zone: view().zone, wipes: view().wipes }).toEqual(before)
})

type Found = { type?: string; props: Record<string, unknown>; children?: unknown[] }
type Finder = { find: (q: { key: string }) => Promise<Found | undefined> }

/** A Raster's cells, row by row: each cell's character and colours. */
function rasterCells(node: Found): { ch: string; fg: number; bg: number }[][] {
  const columns = Number(node.props.columns)
  const bytes = decode(String(node.props.cells))
  const words = new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4)
  const rows: { ch: string; fg: number; bg: number }[][] = []
  for (let y = 0; y < words.length / 3 / columns; y++) {
    const row: { ch: string; fg: number; bg: number }[] = []
    for (let x = 0; x < columns; x++) {
      const w = (y * columns + x) * 3
      row.push({
        ch: String.fromCodePoint(words[w] ?? 32),
        fg: words[w + 1] ?? 0,
        bg: words[w + 2] ?? 0,
      })
    }
    rows.push(row)
  }
  return rows
}

/** The band Raster on the Party tab (#61), the band row's one Raster. */
async function bandRaster(ui: Finder): Promise<Found | undefined> {
  const row = await ui.find({ key: 'row-band' })
  return ((row?.children ?? []) as Found[]).find((c) => c.type === 'Raster')
}

/** What the band's strip says: its Raster's cells as text, or the band Raster's strip rows. */
async function stripText(ui: Finder): Promise<string> {
  const band = await bandRaster(ui)
  const strip = band ?? (await ui.find({ key: 'strip' }))
  if (!strip) return ''
  const lines = rasterCells(strip).map((row) => row.map((c) => c.ch).join(''))
  return (band ? lines.slice(-STRIP_ROWS) : lines).join('\n')
}

const BAND = {
  component: 'AbovePrompt',
  requestId: 'band-test',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 30,
    bodyColumns: 150,
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

test('sandbox worldboss engages the party in boss mode; worldboss end pays it and the boss is down', async ($, on) => {
  const { run, view, states, toasts } = await sandboxOn(on, $, {
    'promptfall:settings': { sound: false, motion: 'full', renderer: 'raster' },
  })
  expect(await run('worldboss')).toBe('Sandbox: world boss The Promptwyrm has appeared')
  // One undying enemy: the world boss, whose name travels with the engagement.
  expect(view().enemies.map((e) => [e.kind, e.name])).toEqual([['world_boss', 'The Promptwyrm']])
  expect(view().boss).toMatchObject({ name: 'The Promptwyrm', dealt: 0 })
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...BAND })
  await ui.press({ key: 'hot-p' })
  const strip = await stripText(ui)
  expect(strip).toMatch(/World boss · \d+[mh]/)
  expect(strip).toContain('The Promptwyrm'.slice(0, 7))
  await ui.unmount()

  toasts.length = 0
  expect(await run('worldboss end')).toBe('Sandbox: The Promptwyrm is down, rewards delivered')
  expect(view().boss).toBeNull()
  expect(view().enemies.every((e) => e.kind !== 'world_boss')).toBe(true)
  // The reward came with nothing dealt: the settle pays every engaged party.
  expect(toasts.filter((t) => t.startsWith('Your share of The Promptwyrm: '))).toHaveLength(1)
  const world = states.get('world') as WorldState
  expect(world.snapshot?.boss).toMatchObject({ name: 'The Promptwyrm', hp: 0 })
})

test('sandbox worldboss twice answers that one is live; worldboss end with none answers so', async ($, on) => {
  const { run, view, states } = await sandboxOn(on, $)
  // The game as the player sees it; the first run's welcome flag clears at the verb's sync.
  const game = () => JSON.stringify({ ...view(), firstRun: false })
  const before = game()
  expect(await run('worldboss end')).toBe('Sandbox: no world boss is live')
  expect(game()).toBe(before)
  expect(await run('worldboss')).toBe('Sandbox: world boss The Promptwyrm has appeared')
  const bossId = view().boss?.bossId
  expect(await run('worldboss')).toBe('Sandbox: a world boss is already live')
  expect(view().boss?.bossId).toBe(bossId)
  expect((states.get('world') as WorldState).snapshot?.boss?.bossId).toBe(bossId)
  expect(await run('worldboss later')).toBe('Usage: /promptfall sandbox worldboss [end]')
})

/** A PNG the stage's writer made (8-bit RGBA, filter 0): its size and its pixels as 0xRRGGBB. */
function pixels(source: { png: string } | undefined): {
  width: number
  height: number
  at: (x: number, y: number) => number
} {
  const png = decode(source?.png ?? '')
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength)
  const width = view.getUint32(16)
  const height = view.getUint32(20)
  const idat: Uint8Array[] = []
  for (let at = 8; at < png.length; ) {
    const length = view.getUint32(at)
    if (String.fromCharCode(...png.subarray(at + 4, at + 8)) === 'IDAT')
      idat.push(png.subarray(at + 8, at + 8 + length))
    at += 12 + length
  }
  const zipped = new Uint8Array(idat.reduce((n, c) => n + c.length, 0))
  let o = 0
  for (const c of idat) {
    zipped.set(c, o)
    o += c.length
  }
  const raw = unzlibSync(zipped)
  const at = (x: number, y: number) => {
    const i = y * (width * 4 + 1) + 1 + x * 4
    return ((raw[i] ?? 0) << 16) | ((raw[i + 1] ?? 0) << 8) | (raw[i + 2] ?? 0)
  }
  return { width, height, at }
}

// The whole band's picture, composed and encoded at full size: more than the default budget.
test(
  "in play, a boss under a tall prompt draws the band as one picture the band's full width (#21)",
  { timeoutMs: 15_000 },
  async ($, on) => {
    const { run, view, clock } = await sandboxOn(on, $, {
      'promptfall:settings': { sound: false, motion: 'full', renderer: 'image' },
    })
    expect(await run('boss treant')).toBe('Sandbox: Elder Treant is next')
    for (let i = 0; i < 40 && !view().enemies.some((e) => e.name === 'Elder Treant'); i++)
      await clock.advance(500)
    expect(view().enemies.map((e) => e.name)).toContain('Elder Treant')
    // A tall prompt leaves the band 10 rows: 5 for the stage over the 5-row strip.
    const short = { ...BAND, props: { ...BAND.props, maxRows: 10, bodyColumns: 144 } }
    const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...short })
    const band = await ui.find({ key: 'band-144x10' })
    expect(band?.type).toBe('Image')
    expect(band?.props).toMatchObject({ columns: 144, rows: 10 })
    expect(await ui.find({ key: stageKey({ columns: 144, rows: 5 }) })).toBeUndefined()
    // The picture stays within the host's 2048 px a side, 8 by 16 pixels a cell.
    const picture = pixels(band?.props.source as { png: string } | undefined)
    expect([picture.width, picture.height]).toEqual([144 * CELL_W, 10 * CELL_H])
    // The zoomed-out stage spans the playfield: inside the line, no shell across the stage's rows.
    for (const y of [20, 40, 60]) {
      for (let x = 4; x < picture.width - 4; x++) expect(picture.at(x, y)).not.toBe(FIELD_RGB)
    }
    await ui.unmount()
  },
)

// The whole band's picture, composed and encoded at full size: more than the default budget.
test(
  'in play, one band element at 165 columns: the strip is inside the picture, not beside it',
  { timeoutMs: 15_000 },
  async ($, on) => {
    await sandboxOn(on, $, {
      'promptfall:settings': { sound: false, motion: 'full', renderer: 'image' },
    })
    const wide = { ...BAND, props: { ...BAND.props, maxRows: 30, bodyColumns: 165 } }
    const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...wide })
    const root = await ui.find({ key: 'band' })
    const rows = (root?.children ?? []) as { props: Record<string, unknown>; children: unknown[] }[]
    expect(rows).toHaveLength(1)
    const children = (rows[0]?.children ?? []) as {
      type?: string
      props: Record<string, unknown>
    }[]
    // One picture at the band's width; beside it only the zero-width hotkey box.
    const pictures = children.filter((c) => c.type === 'Image')
    expect(pictures).toHaveLength(1)
    expect(pictures[0]?.props).toMatchObject({ columns: 165, rows: 22 })
    expect(children.filter((c) => c.type !== 'Image').map((c) => c.props.key)).toEqual(['hotkeys'])
    expect(await ui.find({ key: 'strip-windows' })).toBeUndefined()
    await ui.unmount()
  },
)

test(
  'in play, the Raster band is one element with the shell around the playfield',
  { timeoutMs: 15_000 },
  async ($, on) => {
    await sandboxOn(on, $, {
      'promptfall:settings': { sound: false, motion: 'full', renderer: 'raster' },
    })
    const wide = { ...BAND, props: { ...BAND.props, maxRows: 30, bodyColumns: 165 } }
    const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...wide })
    const row = await ui.find({ key: 'row-band' })
    const children = (row?.children ?? []) as Found[]
    // One Raster at the band's box; beside it only the zero-width hotkey box.
    expect(children.map((c) => [c.type, c.props.key])).toEqual([
      ['Raster', bandKey({ columns: 165, rows: 22 })],
      ['Box', 'hotkeys'],
    ])
    expect(children[0]?.props).toMatchObject({ columns: 165, rows: 22 })
    for (const key of ['stage', 'strip', 'row-stage', 'row-strip'])
      expect(await ui.find({ key })).toBeUndefined()
    const g = rasterCells(children[0] as Found)
    const shell = { ch: ' ', fg: FIELD_RGB, bg: FIELD_RGB }
    const line = (ch: string) => ({ ch, fg: BORDER_RGB, bg: FIELD_RGB })
    // Two cells of shell on the left, three on the right, the line in the inner one.
    for (const y of [0, 8, 21])
      expect([g[y]?.[0], g[y]?.[163], g[y]?.[164]]).toEqual([shell, shell, shell])
    expect([g[0]?.[1], g[0]?.[80], g[0]?.[162]]).toEqual([line('╭'), line('─'), line('╮')])
    expect([g[8]?.[1], g[19]?.[162]]).toEqual([line('│'), line('│')])
    expect([g[21]?.[1], g[21]?.[162]]).toEqual([line('╰'), line('╯')])
    // Inside the line: the stage's half-block cells above the strip's windows.
    expect(g[8]?.slice(2, 162).every((c) => c.ch === '▀' || c.ch === '▄' || /\d/.test(c.ch))).toBe(
      true,
    )
    expect(g[17]?.[2]?.ch).toBe('╭')
    await ui.unmount()

    // A tall prompt crops the Raster to the stage's bottom rows: the line goes around them.
    const short = { ...BAND, props: { ...BAND.props, maxRows: 16, bodyColumns: 160 } }
    const cropped = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...short })
    const raster = await bandRaster(cropped)
    expect([raster?.props.columns, raster?.props.rows]).toEqual([160, 16])
    const c = rasterCells(raster as Found)
    expect(c[0]?.map((x) => x.ch).join('')).toBe(`╭${'─'.repeat(158)}╮`)
    expect([c[5]?.[0]?.ch, c[11]?.[0]?.ch, c[11]?.[159]?.ch, c[15]?.[0]?.ch]).toEqual([
      '│',
      '├',
      '┤',
      '╰',
    ])
    await cropped.unmount()
  },
)

test('in play, the strip’s hero HP trails the state until the hit lands, never leads it (#20)', async ($, on) => {
  const { view, clock } = await sandboxOn(on, $, {
    'promptfall:settings': { sound: false, motion: 'full', renderer: 'raster' },
  })
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...BAND })
  await ui.press({ key: 'hot-p' })
  const shown = async () => {
    const line = (await stripText(ui)).split('\n').find((l) => /H\s+\d+.*H\s+\d+/.test(l)) ?? ''
    return [...line.matchAll(/H\s+(\d+)/g)].map((m) => Number(m[1]))
  }
  let trailed = 0
  for (let step = 0; step < 600; step++) {
    await clock.advance(50)
    const state = view().heroes.map((h) => h.hp)
    const strip = await shown()
    if (strip.length !== state.length) continue
    // Never below the state: the strip only holds back HP a hit has not yet taken on the stage.
    for (const [i, hp] of strip.entries()) expect(hp).toBeGreaterThanOrEqual(state[i] ?? 0)
    if (strip.some((hp, i) => hp > (state[i] ?? 0))) trailed++
  }
  // Over 30 s of play some hit was ticked before it landed, and the strip waited for it.
  expect(trailed).toBeGreaterThan(0)
  await ui.unmount()
})
