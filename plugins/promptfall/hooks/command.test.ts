import { describe, expect, type TestBody } from 'claude-code/testing'
import type { WorldState } from '../types'
import { BAND, harness, PAST_GRID_BOSS, RUN, sandboxOn, stripText } from './inplay/harness'
import { decode } from './sprites/base64'
import { bandKey, stageKey } from './stage/loop'
import {
  BACKLOG_ROUNDS,
  CHEST_FALL_MS,
  CHEST_OPEN_MS,
  CHEST_SIT_MS,
  DISSOLVE_MS,
  REVEAL_FADE_MS,
  REVEAL_HOLD_MS,
  REVEAL_RISE_MS,
} from './stage/tuning'
import { SANDBOX_PREFIX, StoreKeyValue } from './storage'
import { test } from './testing'
import { unzlibSync } from './vendor/fflate.js'
import { approveAs, Ledger } from './vendor/ledger.js'
import { content, createInitialState, TICK_MS } from './vendor/sim.js'
import { BORDER_RGB, CELL_H, CELL_W, FIELD_RGB, STRIP_ROWS } from './windows/tuning'

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

test('/promptfall autovendor on|off sets the setting and answers; a bad word answers the usage', async ($, on) => {
  const { states } = harness(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const autoVendor = () => (states.get('view') as { autoVendor: boolean }).autoVendor
  expect(autoVendor()).toBe(false)
  const r = await $.command.run({ ...RUN, command: 'promptfall', args: 'autovendor on' })
  expect(r.text).toBe('Promptfall auto-vendor is on')
  expect(autoVendor()).toBe(true)
  const off = await $.command.run({ ...RUN, command: 'promptfall', args: 'AutoVendor off' })
  expect(off.text).toBe('Promptfall auto-vendor is off')
  expect(autoVendor()).toBe(false)
  for (const args of ['autovendor', 'autovendor maybe']) {
    const bad = await $.command.run({ ...RUN, command: 'promptfall', args })
    expect(bad.text).toBe('Usage: /promptfall autovendor on or /promptfall autovendor off')
  }
  expect(autoVendor()).toBe(false)
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

/** A save from an older sim version under `prefix`: the session takes the lease and its engine pauses. */
function oldSave(prefix: string): Record<string, unknown> {
  return {
    [`${prefix}deviceToken`]: 'token-1',
    [`${prefix}pf:token:token-1`]: 'acct-1',
    [`${prefix}pf:acct:acct-1:record`]: {
      account: { accountId: 'acct-1', seed: 5, createdAt: 0, displayName: null, linked: null },
      state: { ...createInitialState(5), v: 1 },
      seq: 3,
      refillAt: { tick: 0, tool_call: 0, rest: 0, turn_end: 0 },
      buckets: { tick: 70, tool_call: 140, rest: 30, turn_end: 30 },
      committed: [],
    },
  }
}

test('a paused primary answers farm and the sandbox verbs as paused, not as another session', async ($, on) => {
  const { states } = harness(on, oldSave(SANDBOX_PREFIX), { PROMPTFALL_SANDBOX: '1' })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  expect(states.get('mode')).toBe('paused')
  const zoneBoss = content.zones[0]?.boss ?? ''
  const base = Object.values(content.itemBases)[0]?.id ?? ''
  const verbs = [
    'farm',
    'autovendor on',
    'sandbox gold 100',
    `sandbox boss ${zoneBoss}`,
    `sandbox item ${base}`,
  ]
  verbs.push('sandbox level Aria 5', 'sandbox zone 2', 'sandbox recruit', 'sandbox wipe')
  verbs.push('sandbox worldboss')
  for (const args of verbs) {
    const r = await $.command.run({ ...RUN, command: 'promptfall', args })
    expect({ args, text: r.text }).toEqual({ args, text: 'Promptfall is paused' })
  }
  expect(states.get('mode')).toBe('paused')
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
  const stored = { sound: true, motion: 'still', renderer: 'raster', probed: null }
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
  expect(await run('zone 36')).toBe('Sandbox: tier 3, zone 12, The Unwritten Reach')
  expect(view().zone).toBe(36)
  expect(view().zoneName).toBe('The Unwritten Reach')
  expect(await run('zone 37')).toBe('Sandbox: zones run 1 to 36')
  expect(view().zone).toBe(36)
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

test('sandbox wipe restarts the zone twice, and the third retreats one zone', async ($, on) => {
  const { run, view, toasts } = await sandboxOn(on, $)
  await run('zone 3')
  const wipes = view().wipes
  for (let i = 1; i <= 2; i++) {
    expect(await run('wipe')).toBe('Sandbox: the party fell, back to wave 1 of zone 3')
    expect(view().zone).toBe(3)
    expect(view().wave).toBe(1)
    expect(view().wipes).toBe(wipes + i)
  }
  expect(toasts).toContain('The party fell, back to wave 1 of zone 3, Marsh of Sighs')
  expect(await run('wipe')).toBe('Sandbox: the party retreats to zone 2')
  expect(view().zone).toBe(2)
  expect(view().wipes).toBe(wipes + 3)
  expect(toasts).toContain('The party retreats to zone 2, Whisperwood')
})

test('sandbox wipe past tier 1 names the tier and its zone', async ($, on) => {
  const { run, view } = await sandboxOn(on, $)
  await run('zone 14')
  expect(await run('wipe')).toBe('Sandbox: the party fell, back to wave 1 of tier 2, zone 2')
  await run('wipe')
  expect(await run('wipe')).toBe('Sandbox: the party retreats to tier 2, zone 1')
  expect(view().zone).toBe(13)
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
    linkApprover: approveAs(null),
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

type Mounting = Parameters<TestBody>[0]

/** The Image band at 165 columns: one element, the strip inside the picture, not beside it. */
async function imageAt165($: Mounting) {
  const wide = { ...BAND, props: { ...BAND.props, maxRows: 30, bodyColumns: 165 } }
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...wide })
  const root = await ui.find({ key: 'band' })
  const rows = (root?.children ?? []) as { props: Record<string, unknown>; children: unknown[] }[]
  expect(rows, '165 image: the band is one row').toHaveLength(1)
  const children = (rows[0]?.children ?? []) as {
    type?: string
    props: Record<string, unknown>
  }[]
  // One picture at the band's width; beside it only the zero-width hotkey box.
  const pictures = children.filter((c) => c.type === 'Image')
  expect(pictures, '165 image: one picture').toHaveLength(1)
  expect(pictures[0]?.props, '165 image: the picture is 165 by 22').toMatchObject({
    columns: 165,
    rows: 22,
  })
  expect(
    children.filter((c) => c.type !== 'Image').map((c) => c.props.key),
    '165 image: only the hotkeys beside the picture',
  ).toEqual(['hotkeys'])
  expect(await ui.find({ key: 'strip-windows' }), '165 image: no strip windows').toBeUndefined()
  await ui.unmount()
}

/** The Raster band at 165 columns with the shell around the playfield, then cropped at 160 by 16. */
async function rasterAt165($: Mounting) {
  const wide = { ...BAND, props: { ...BAND.props, maxRows: 30, bodyColumns: 165 } }
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...wide })
  const row = await ui.find({ key: 'row-band' })
  const children = (row?.children ?? []) as Found[]
  // One Raster at the band's box; beside it only the zero-width hotkey box.
  expect(
    children.map((c) => [c.type, c.props.key]),
    '165 raster: one Raster and the hotkeys',
  ).toEqual([
    ['Raster', bandKey({ columns: 165, rows: 22 })],
    ['Box', 'hotkeys'],
  ])
  expect(children[0]?.props, '165 raster: the Raster is 165 by 22').toMatchObject({
    columns: 165,
    rows: 22,
  })
  for (const key of ['stage', 'strip', 'row-stage', 'row-strip'])
    expect(await ui.find({ key }), `165 raster: no ${key}`).toBeUndefined()
  const g = rasterCells(children[0] as Found)
  const shell = { ch: ' ', fg: FIELD_RGB, bg: FIELD_RGB }
  const line = (ch: string) => ({ ch, fg: BORDER_RGB, bg: FIELD_RGB })
  // Two cells of shell on the left, three on the right, the line in the inner one.
  for (const y of [0, 8, 21])
    expect(
      [g[y]?.[0], g[y]?.[163], g[y]?.[164]],
      `165 raster: the shell at the edges of row ${y}`,
    ).toEqual([shell, shell, shell])
  expect([g[0]?.[1], g[0]?.[80], g[0]?.[162]], '165 raster: the line along the top').toEqual([
    line('╭'),
    line('─'),
    line('╮'),
  ])
  expect([g[8]?.[1], g[19]?.[162]], '165 raster: the line down the sides').toEqual([
    line('│'),
    line('│'),
  ])
  expect([g[21]?.[1], g[21]?.[162]], '165 raster: the line along the bottom').toEqual([
    line('╰'),
    line('╯'),
  ])
  // Inside the line: the stage's half-block cells above the strip's windows.
  expect(
    g[8]?.slice(2, 162).every((c) => c.ch === '▀' || c.ch === '▄' || /\d/.test(c.ch)),
    '165 raster: half-block stage cells inside the line',
  ).toBe(true)
  expect(g[17]?.[2]?.ch, "165 raster: the strip's window below the stage").toBe('╭')
  await ui.unmount()

  // A tall prompt crops the Raster to the stage's bottom rows: the line goes around them.
  const short = { ...BAND, props: { ...BAND.props, maxRows: 16, bodyColumns: 160 } }
  const cropped = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...short })
  const raster = await bandRaster(cropped)
  expect([raster?.props.columns, raster?.props.rows], '160x16 raster: its size').toEqual([160, 16])
  const c = rasterCells(raster as Found)
  expect(c[0]?.map((x) => x.ch).join(''), '160x16 raster: the line along the top').toBe(
    `╭${'─'.repeat(158)}╮`,
  )
  expect(
    [c[5]?.[0]?.ch, c[11]?.[0]?.ch, c[11]?.[159]?.ch, c[15]?.[0]?.ch],
    '160x16 raster: the line around the cropped rows',
  ).toEqual(['│', '├', '┤', '╰'])
  await cropped.unmount()
}

/** Compact at 110 columns: one element on the shell, the line around the stage. */
async function compactAt110($: Mounting, renderer: 'image' | 'raster') {
  const narrow = { ...BAND, props: { ...BAND.props, maxRows: 30, bodyColumns: 110 } }
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...narrow })
  const band = await ui.find({ key: 'band' })
  expect(
    ((band?.children ?? []) as Found[]).map((c) => c.props.key),
    `110 ${renderer}: the band is one row`,
  ).toEqual(['row-band'])
  const row = await ui.find({ key: 'row-band' })
  const children = (row?.children ?? []) as Found[]
  // One element at the band's width and compact's 6 rows; beside it only the hotkeys.
  expect(
    children.map((c) => [c.type, c.props.key]),
    `110 ${renderer}: one element and the hotkeys`,
  ).toEqual([
    [renderer === 'image' ? 'Image' : 'Raster', bandKey({ columns: 110, rows: 6 })],
    ['Box', 'hotkeys'],
  ])
  expect(children[0]?.props, `110 ${renderer}: the element is 110 by 6`).toMatchObject({
    columns: 110,
    rows: 6,
  })
  for (const key of ['row-compact', 'compact-stage', 'stage', 'strip', 'strip-windows'])
    expect(await ui.find({ key }), `110 ${renderer}: no ${key}`).toBeUndefined()
  if (renderer === 'image') {
    const picture = pixels(children[0]?.props.source as { png: string } | undefined)
    expect([picture.width, picture.height], '110 image: the picture in pixels').toEqual([
      110 * CELL_W,
      6 * CELL_H,
    ])
    // The line around the stage, over the window's own at the top, bottom and right: its
    // left side 2 pixels in, its top and bottom over the window's lines, 10 pixels in.
    expect(
      [picture.at(0, 48), picture.at(2, 48), picture.at(3, 48)],
      "110 image: the line's left side",
    ).toEqual([FIELD_RGB, BORDER_RGB, BORDER_RGB])
    expect(
      [picture.at(200, 5), picture.at(200, 10), picture.at(200, 85)],
      "110 image: the line's top and bottom",
    ).toEqual([FIELD_RGB, BORDER_RGB, BORDER_RGB])
    expect(picture.at(110 * CELL_W - 3, 48), "110 image: the line's right side").toBe(BORDER_RGB)
    // The window's title tab breaks the line: drawn over it, not under it.
    const title = Array.from({ length: 80 }, (_, i) => picture.at(52 * CELL_W + 16 + i, 10))
    expect(
      title.some((px) => px !== BORDER_RGB),
      '110 image: the title tab over the line',
    ).toBe(true)
  } else {
    const g = rasterCells(children[0] as Found)
    const text = (y: number) => g[y]?.map((c) => c.ch).join('') ?? ''
    // The line over the stage's outer column, the window's title and command line kept, its
    // left side meeting the line.
    expect(text(0), '110 raster: the top line and the title').toMatch(/^╭─{51}┬.*Z\d+ · .*╮$/)
    expect(text(5), '110 raster: the bottom line and the command line').toMatch(
      /^╰─{51}┴.*Party.*╯$/,
    )
    for (const y of [1, 2, 3, 4])
      expect([g[y]?.[0]?.ch, g[y]?.[52]?.ch], `110 raster: the sides on row ${y}`).toEqual([
        '│',
        '│',
      ])
    expect(
      g[2]?.slice(1, 52).every((c) => c.ch === '▀' || c.ch === '▄' || c.ch === ' '),
      '110 raster: half-block stage cells inside the line',
    ).toBe(true)
  }
  await ui.unmount()
}

// One engine boot per group. Tests whose setup before the first call on the engine is the same
// (the harness, store seeds, env and clock) and that, after the session starts, only mount the
// band and read it share one test: the checks in sequence, each assertion naming its check, so a
// red group says which check failed. A test that presses a key, advances the clock, runs a
// command or writes state after the session starts keeps its own test and its own boot. Each
// group composes and encodes several full-size pictures, so it keeps the wrapper's 30 s budget.
describe('in play, the Image band read at 165 and 110 columns, one boot', () => {
  test('one element, the strip inside the picture; compact one element on the shell', async ($, on) => {
    await sandboxOn(on, $, {
      'promptfall:settings': { sound: false, motion: 'full', renderer: 'image' },
    })
    await imageAt165($)
    await compactAt110($, 'image')
  })
})

describe('in play, the Raster band read at 165, 160 by 16 and 110 columns, one boot', () => {
  test('one element with the shell around the playfield, cropped and compact', async ($, on) => {
    await sandboxOn(on, $, {
      'promptfall:settings': { sound: false, motion: 'full', renderer: 'raster' },
    })
    await rasterAt165($)
    await compactAt110($, 'raster')
  })
})

// The whole band's picture, composed and encoded at full size: more than the default budget.
for (const renderer of ['image', 'raster'] as const) {
  test(
    `in play, switching tabs keeps the band one element on the shell (${renderer})`,
    { timeoutMs: 15_000 },
    async ($, on) => {
      await sandboxOn(on, $, {
        'promptfall:settings': { sound: false, motion: 'full', renderer },
      })
      const wide = { ...BAND, props: { ...BAND.props, maxRows: 30, bodyColumns: 165 } }
      const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...wide })
      const type = renderer === 'image' ? 'Image' : 'Raster'
      for (const [key, rows] of [
        ['hot-p', 22],
        ['hot-l', STRIP_ROWS],
        ['hot-w', STRIP_ROWS],
        ['hot-p', 22],
      ] as const) {
        await ui.press({ key })
        const band = await ui.find({ key: 'band' })
        expect(((band?.children ?? []) as Found[]).map((c) => c.props.key)).toEqual(['row-band'])
        const row = await ui.find({ key: 'row-band' })
        const children = (row?.children ?? []) as Found[]
        // One element at the band's width, the Party tab's; beside it only the hotkeys.
        expect(children.map((c) => [c.type, c.props.key])).toEqual([
          [type, bandKey({ columns: 165, rows })],
          ['Box', 'hotkeys'],
        ])
        expect(children[0]?.props).toMatchObject({ columns: 165, rows })
        for (const k of ['strip', 'strip-windows', 'row-strip'])
          expect(await ui.find({ key: k })).toBeUndefined()
        if (renderer === 'image') {
          const picture = pixels(children[0]?.props.source as { png: string } | undefined)
          expect([picture.width, picture.height]).toEqual([165 * CELL_W, rows * CELL_H])
          // The shell at the band's edges, the line just outside the playfield's 160 columns,
          // which sit 2 columns in: the same width and centre on every tab.
          const y = rows * CELL_H - 30
          expect([picture.at(0, y), picture.at(14, y), picture.at(15, y)]).toEqual([
            FIELD_RGB,
            BORDER_RGB,
            BORDER_RGB,
          ])
          expect([picture.at(162 * CELL_W, y), picture.at(164 * CELL_W + 7, y)]).toEqual([
            BORDER_RGB,
            FIELD_RGB,
          ])
        } else {
          const g = rasterCells(children[0] as Found)
          const at = (x: number, y: number) => g[y]?.[x]?.ch
          // The line in the shell beside the playfield, its corners at the band's top and bottom.
          expect([at(0, 0), at(1, 0), at(162, 0), at(164, rows - 1)]).toEqual([' ', '╭', '╮', ' '])
          expect([at(1, rows - 1), at(162, rows - 1), at(1, 2)]).toEqual(['╰', '╯', '│'])
        }
      }
      await ui.unmount()
    },
  )
}

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
  // A heal lands once the stage lets its tick go (spec, the staged state): the actions it still
  // holds, at most BACKLOG_ROUNDS ticks of them, then the tick's departed rows fading and their
  // chests played, the slowest a Legendary's. Each hero's state HP over that long: a heal still to
  // land holds the strip at one of them.
  const settleMs =
    BACKLOG_ROUNDS * TICK_MS +
    DISSOLVE_MS +
    CHEST_FALL_MS +
    CHEST_SIT_MS +
    CHEST_OPEN_MS +
    REVEAL_RISE_MS +
    REVEAL_HOLD_MS.legendary +
    REVEAL_FADE_MS
  const recent: number[][] = []
  for (let step = 0; step < 600; step++) {
    await clock.advance(50)
    const state = view().heroes.map((h) => h.hp)
    recent.push(state)
    if (recent.length > Math.ceil(settleMs / 50)) recent.shift()
    const strip = await shown()
    if (strip.length !== state.length) continue
    // Never below what the state was: the strip only holds back a hit or a heal not yet landed.
    for (const [i, hp] of strip.entries())
      expect(hp).toBeGreaterThanOrEqual(Math.min(...recent.map((s) => s[i] ?? 0)))
    if (strip.some((hp, i) => hp > (state[i] ?? 0))) trailed++
  }
  // Over 30 s of play some hit was ticked before it landed, and the strip waited for it.
  expect(trailed).toBeGreaterThan(0)
  await ui.unmount()
})
