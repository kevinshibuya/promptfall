import type { On } from 'claude-code'
import { expect, mock, type TestBody, test } from 'claude-code/testing'
import type { GameView } from '../types'
import { SANDBOX_PREFIX, StoreKeyValue } from './storage'
import { Ledger } from './vendor/ledger.js'
import { BOSS_WINDOW_MS } from './vendor/protocol.js'
import { content } from './vendor/sim.js'

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

async function sandboxOn(on: On, $: Parameters<TestBody>[0]) {
  const h = harness(on, {}, SANDBOX_ON, PAST_GRID_BOSS)
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
  expect(toasts.some((t) => t.includes('Oak Staff (legendary)'))).toBe(true)
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
  expect(toasts.filter((t) => t.startsWith('Level '))).toEqual([])
  expect(await run('level ald 7')).toBe(`Sandbox: ${name} is level 7`)
  expect(aldric()?.level).toBe(7)
  expect(toasts.filter((t) => t.startsWith('Level '))).toEqual(['Level 6', 'Level 7'])
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
  expect(toasts).toContain(`${added[0]?.name} joined (epic)`)
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
  expect(toasts).toContain('Party wiped, retreating to zone 2')
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
  expect(await run('wipe')).toBe('Sandbox: not in boss mode')
  expect(await run('zone 5')).toBe('Sandbox: not in boss mode')
  expect({ zone: view().zone, wipes: view().wipes }).toEqual(before)
})
