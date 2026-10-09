import { expect } from 'claude-code/testing'
import type { WorldState } from '../types'
import { BAND, harness, PAST_GRID_BOSS, RUN, sandboxOn, stripText } from './inplay/harness'
import { decode } from './sprites/base64'
import { stageKey } from './stage/loop'
import { SANDBOX_PREFIX, StoreKeyValue } from './storage'
import { test } from './testing'
import { Ledger } from './vendor/ledger.js'
import { content, createInitialState } from './vendor/sim.js'

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
  const verbs = ['farm', 'sandbox gold 100', `sandbox boss ${zoneBoss}`, `sandbox item ${base}`]
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

test('in play, a boss under a tall prompt draws the Image stage the band’s full width (#21)', async ($, on) => {
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
  const stage = await ui.find({ key: stageKey({ columns: 144, rows: 5 }) })
  expect(stage?.props).toMatchObject({ columns: 144, rows: 5 })
  // The picture stays within the host's 2048 px a side: its PNG header's width and height.
  const source = stage?.props.source as { png: string } | undefined
  const png = decode(source?.png ?? '')
  const be = (at: number) =>
    ((png[at] ?? 0) << 24) |
    ((png[at + 1] ?? 0) << 16) |
    ((png[at + 2] ?? 0) << 8) |
    (png[at + 3] ?? 0)
  expect(be(16)).toBeLessThanOrEqual(2048)
  expect(be(20)).toBeLessThanOrEqual(2048)
  await ui.unmount()
})

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
