import type { On, RenderElement } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { GameView, Prefs, WorldState } from '../types'
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
  return { data, states, clock }
}

function band(bodyColumns = 120, maxRows = 8, hasSurvey = false) {
  return {
    component: 'AbovePrompt' as const,
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

async function rows(ui: {
  find: (q: { key: string }) => Promise<{ children: unknown[] } | undefined>
}) {
  const root = await ui.find({ key: 'band' })
  return (root?.children ?? []).filter((c) => typeof c === 'object')
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
    expect(await rows(ui)).toHaveLength(4)
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
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'promptfall', surface, ...band(80) })
    expect(await rows(ui)).toHaveLength(1)
    // A notice (here the first-run welcome) shows on the one line too.
    expect(await ui.find({ text: /Welcome to Promptfall/ })).toBeDefined()
    await ui.unmount()
  }
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
    expect(await rows(ui)).toHaveLength(4)
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

test('the World tab reads the in-process world: one online, chat closed', async ($, on) => {
  const { states } = harness(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  expect((states.get('world') as WorldState).snapshot?.online).toBe(1)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'promptfall', surface, ...band() })
    await ui.press({ key: 'tab-world' })
    expect(await ui.find({ text: /^1 online · zone 1: nobody else here$/ })).toBeDefined()
    expect(await ui.find({ text: /^highest zone 1 · kills \d+ · wipes \d+/ })).toBeDefined()
    expect(await ui.find({ text: 'chat is closed' })).toBeDefined()
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
