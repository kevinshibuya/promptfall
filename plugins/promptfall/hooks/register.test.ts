import type { On, UiBlitArgs } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { GameView, WorldState } from '../types'
import { OLD_VERSION_NOTICE, RETRYING_NOTICE } from './engine'
import { CUE_GAIN, EVENT_FRAME_MS, PROBE_ALT_DENY, PROBE_DELAY_MS } from './stage/tuning'
import { effectToast } from './toasts'
import { Ledger } from './vendor/ledger.js'
import { type ChatMessage, MemoryKeyValue, type WorldSnapshot } from './vendor/protocol.js'
import { createInitialState, GAUGE_FULL, type GameState, hashState, step } from './vendor/sim.js'
import { toAccountView, toGameView } from './view'
import { WORLD_POLL_MS, WORLD_STALE_MS, WorldPoller } from './world'

/** Answers $.store from a map and records every write. */
function store(on: On, seed: Record<string, unknown> = {}) {
  const data = new Map<string, unknown>(Object.entries(seed))
  const writes: { key: string; value: unknown }[] = []
  on('store.get', (_$, e) => ({ value: data.get(e.key) }))
  on('store.set', (_$, e) => {
    const value = JSON.parse(JSON.stringify(e.value))
    writes.push({ key: e.key, value })
    data.set(e.key, value)
    return { value: undefined }
  })
  on('store.delete', (_$, e) => {
    data.delete(e.key)
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...data.keys()] }))
  return { data, writes }
}

/** Records the state the plugin writes. */
function states(on: On) {
  const last = new Map<string, unknown>()
  on('state.set', async (_$, e, next) => {
    last.set(e.key, e.value)
    return next(e)
  })
  return last
}

/** A clock in memory that records each `every` period's interval. */
function clock(on: On) {
  let t = 1_000_000
  const waits: { due: number; resolve: () => void }[] = []
  const periods: number[] = []
  const wait = (ms: number, signal?: AbortSignal) =>
    new Promise<{ value: undefined }>((resolve) => {
      const entry = { due: t + ms, resolve: () => resolve({ value: undefined }) }
      waits.push(entry)
      signal?.addEventListener('abort', () => {
        const i = waits.indexOf(entry)
        if (i >= 0) waits.splice(i, 1)
      })
    })
  on('clock.now', () => ({ value: t }))
  on('clock.every', (_$, e, next) => {
    periods.push(e.ms)
    return wait(e.ms, next.signal)
  })
  on('clock.after', (_$, e, next) => wait(e.ms, next.signal))
  on('clock.sleep', (_$, e, next) => wait(e.ms, next.signal))
  return {
    periods,
    async advance(ms: number) {
      const end = t + ms
      for (;;) {
        waits.sort((a, b) => a.due - b.due)
        const next = waits[0]
        if (!next || next.due > end) break
        waits.shift()
        t = next.due
        next.resolve()
        for (let i = 0; i < 50; i++) await Promise.resolve()
      }
      t = end
    },
  }
}

function engineBottom(on: On, toasts: string[] = []) {
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
}

test('an interactive terminal session plays and commits a batch', async ($, on) => {
  const time = mock.clock(on, { now: 1_000_000 })
  const { writes } = store(on)
  const last = states(on)
  engineBottom(on)
  on('tool.call', () => ({ result: 'ok', text: 'ok' }))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'go', turnId: 't1' })
  for (let i = 0; i < 5; i++) await $.tool.call({ tool: 'Bash', command: 'ls' })
  await time.advance(16_000)
  const view = last.get('view') as { enemies: unknown[] } | null
  expect(view?.enemies.length).toBeGreaterThan(0)
  const commit = writes.find(
    (w) => w.key.startsWith('promptfall:pf:acct:') && (w.value as { seq?: number }).seq === 1,
  )
  expect(commit).toBeDefined()
})

test('a first run welcomes the player', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  store(on)
  const last = states(on)
  const toasts: string[] = []
  engineBottom(on, toasts)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  expect(toasts).toContain('Welcome to Promptfall. /promptfall heroes to meet your party')
  expect(last.get('notice')).toBe('Welcome to Promptfall. /promptfall heroes to meet your party')
})

test('a non-interactive session starts no timer', async ($, on) => {
  const time = clock(on)
  store(on)
  states(on)
  engineBottom(on)
  await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
  await time.advance(20_000)
  expect(time.periods).toHaveLength(0)
})

test('a subagent turn.complete leaves the turn cadence', async ($, on) => {
  const time = clock(on)
  store(on)
  states(on)
  engineBottom(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const atStart = time.periods.length
  await $.turn.start({ text: 'go', turnId: 't1' })
  expect(time.periods.slice(atStart)).toEqual([2000])
  const done = {
    answer: '',
    durationMs: 1,
    isAborted: false,
    turnId: 't1',
    reason: 'answer',
  } as const
  await $.turn.complete({ ...done, agentId: 'sub-1' })
  const afterSubagent = time.periods.length
  expect(time.periods.slice(atStart)).not.toContain(5000)
  await $.turn.complete(done)
  expect(time.periods.slice(afterSubagent)).toContain(5000)
})

const WELCOME = 'Welcome to Promptfall. /promptfall heroes to meet your party'
const LEASE = 'promptfall:lease'
const seqOf = (w: { key: string; value: unknown }) =>
  w.key.startsWith('promptfall:pf:acct:') ? (w.value as { seq?: number }).seq : undefined

test('a demoted primary stops flushing, and the welcome shows once', async ($, on) => {
  const time = mock.clock(on, { now: 1_000_000 })
  const { data, writes } = store(on)
  const last = states(on)
  const toasts: string[] = []
  engineBottom(on, toasts)
  on('tool.call', () => ({ result: 'ok', text: 'ok' }))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  for (let i = 0; i < 3; i++) await $.tool.call({ tool: 'Bash', command: 'ls' })
  // Another session takes over while this one's renewal is due.
  data.set(LEASE, { owner: 'someone-else', until: 9_999_999_999_999 })
  await time.advance(10_000)
  expect(last.get('mode')).toBe('secondary')
  await time.advance(6_000)
  expect(writes.some((w) => seqOf(w) === 1)).toBe(false)
  // The other session leaves; this one takes the lease back.
  data.delete(LEASE)
  await time.advance(10_000)
  expect(last.get('mode')).toBe('primary')
  expect(toasts.filter((t) => t === WELCOME)).toHaveLength(1)
})

test('quitting flushes the last batch and releases the lease', async ($, on) => {
  clock(on)
  const { data, writes } = store(on)
  states(on)
  engineBottom(on)
  on('tool.call', () => ({ result: 'ok', text: 'ok' }))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  for (let i = 0; i < 3; i++) await $.tool.call({ tool: 'Bash', command: 'ls' })
  expect(data.has(LEASE)).toBe(true)
  await $.session.end({ reason: 'prompt_input_exit', sessionId: 's1', resume: { id: 's1' } })
  expect(writes.some((w) => seqOf(w) === 1)).toBe(true)
  expect(data.has(LEASE)).toBe(false)
})

test('a /clear flushes but keeps playing and keeps the lease', async ($, on) => {
  clock(on)
  const { data, writes } = store(on)
  states(on)
  engineBottom(on)
  on('tool.call', () => ({ result: 'ok', text: 'ok' }))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  for (let i = 0; i < 3; i++) await $.tool.call({ tool: 'Bash', command: 'ls' })
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
  expect(writes.some((w) => seqOf(w) === 1)).toBe(true)
  expect(data.has(LEASE)).toBe(true)
})

/** A store holding an account whose state the test chose. */
function account(state: GameState): Record<string, unknown> {
  const t = 1_000_000
  return {
    'promptfall:deviceToken': 'token-1',
    'promptfall:pf:token:token-1': 'acct-1',
    'promptfall:pf:acct:acct-1:record': {
      account: {
        accountId: 'acct-1',
        seed: state.seed,
        createdAt: 0,
        displayName: null,
        linked: null,
      },
      state,
      seq: 0,
      refillAt: { tick: t, tool_call: t, rest: t, turn_end: t },
      buckets: { tick: 70, tool_call: 140, rest: 30, turn_end: 30 },
      batches: [],
      cursor: 0,
      committedCursor: 0,
      committedState: state,
      committedHash: hashState(state),
      log: [],
      returns: [],
    },
  }
}

test('a hot reload restarts the game in a session that had one, Desktop included', async ($, on) => {
  const time = clock(on)
  store(on)
  const last = states(on)
  engineBottom(on)
  on('session.attach', (_$, e) => ({ clientId: e.clientId }))
  await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
  expect(time.periods).toHaveLength(0)
  await $.session.attach({ surface: 'desktop', clientId: 'desktop:default' })
  expect(last.get('view')).toBeTruthy()
  const before = time.periods.length
  // The reload: register runs again and session.start fires with surface null.
  await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
  expect(time.periods.length).toBeGreaterThan(before)
})

test('a prompt from the Remote Control bridge is a rest', async ($, on) => {
  const s0 = createInitialState(7)
  const state: GameState = {
    ...s0,
    roster: s0.roster.map((h, i) => (i === 0 ? { ...h, hp: 10 } : h)),
  }
  mock.clock(on, { now: 1_000_000 })
  store(on, account(state))
  const last = states(on)
  engineBottom(on)
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const hp = () => (last.get('view') as { heroes: { hp: number }[] }).heroes[0]?.hp
  expect(hp()).toBe(10)
  await $.prompt.submit({ text: 'hi', wait: false, origin: { kind: 'bridge' } })
  expect(hp()).toBeGreaterThan(10)
})

test('the session the player uses takes the lease back; Claude working elsewhere does not', async ($, on) => {
  const time = mock.clock(on, { now: 1_000_000 })
  const { data } = store(on)
  const last = states(on)
  engineBottom(on)
  on('tool.call', () => ({ result: 'ok', text: 'ok' }))
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const mine = last.get('leaseOwner')
  // This session stalled and an idle one in another tab took the lease.
  data.set(LEASE, { owner: 'idle-tab', until: 9_999_999_999_999 })
  await time.advance(10_000)
  expect(last.get('mode')).toBe('secondary')
  // Claude's own tool calls do not claim it.
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  expect(last.get('mode')).toBe('secondary')
  // The player typing here does.
  await $.prompt.submit({ text: 'hi', wait: false, origin: { kind: 'composer' } })
  expect(last.get('mode')).toBe('primary')
  expect((data.get(LEASE) as { owner: string }).owner).toBe(mine)
})

test('a primary that lost the lease between renewals does not flush', async ($, on) => {
  const time = mock.clock(on, { now: 1_000_000 })
  const { data, writes } = store(on)
  const last = states(on)
  engineBottom(on)
  on('tool.call', () => ({ result: 'ok', text: 'ok' }))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  for (let i = 0; i < 3; i++) await $.tool.call({ tool: 'Bash', command: 'ls' })
  await time.advance(11_000)
  // Another session claims the lease after this one's renewal at 10 s, before its flush at 15 s.
  data.set(LEASE, { owner: 'other-tab', until: 9_999_999_999_999 })
  await time.advance(5_000)
  expect(writes.some((w) => seqOf(w) === 1)).toBe(false)
  expect(last.get('mode')).toBe('secondary')
})

const RUN = {
  origin: { kind: 'composer' },
  presentation: { isFullscreen: false, columns: 120 },
} as const

const PANE = {
  component: 'Pane' as const,
  requestId: 'promptfall',
  props: {
    title: 'Promptfall',
    isFocused: true,
    bodyColumns: 100,
    placement: 'inline' as const,
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
}

const URL_A = 'http://127.0.0.1:1'

/** A remote server: the vendored ledger behind a mocked `$.http.fetch`, which throws while `down`. */
function remote(on: On) {
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
    calls: 0,
    requests: [] as { method: string; path: string }[],
    ledger,
  }
  on('http.fetch', async (_$, e) => {
    net.calls += 1
    const path = e.url.replace(/^https?:\/\/[^/]+/, '').split('?')[0] ?? ''
    const method = e.init?.method ?? 'GET'
    if (net.down) throw new Error('connect ECONNREFUSED')
    net.requests.push({ method, path })
    const header = e.init?.headers?.authorization ?? ''
    const auth = { deviceToken: header.replace(/^Bearer /, '') }
    const body = e.init?.body ? JSON.parse(e.init.body) : undefined
    let result: unknown
    if (method === 'POST' && path === '/v1/bootstrap') result = await ledger.bootstrap(body)
    else if (method === 'POST' && path === '/v1/batches') result = await ledger.submit(body, auth)
    else if (method === 'GET' && path === '/v1/account') result = await ledger.account(auth)
    else return { value: { status: 404, ok: false, headers: {}, text: '{"error":"route"}' } }
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify(result) } }
  })
  return net
}

test('/promptfall server plays on the URL; a throwing fetch shows the notice and the band keeps ticking', async ($, on) => {
  const time = mock.clock(on, { now: 1_000_000 })
  const { data } = store(on)
  const last = states(on)
  engineBottom(on)
  on('tool.call', () => ({ result: 'ok', text: 'ok' }))
  const net = remote(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const r = await $.command.run({ ...RUN, command: 'promptfall', args: `server ${URL_A}` })
  expect(r).toMatchObject({ text: `Promptfall now plays on ${URL_A}` })
  expect(data.get('promptfall:server')).toBe(URL_A)
  expect(typeof data.get(`promptfall:token:${URL_A}`)).toBe('string')
  expect(last.get('server')).toBe(URL_A)
  const view = last.get('view') as GameView
  expect(view.account.server).toBe(URL_A)
  expect(view.gold).toBe(0)
  expect(net.calls).toBeGreaterThan(0)
  await $.turn.start({ text: 'go', turnId: 't1' })
  for (let i = 0; i < 5; i++) await $.tool.call({ tool: 'Bash', command: 'ls' })
  net.down = true
  await time.advance(16_000)
  expect(last.get('notice')).toBe(RETRYING_NOTICE)
  expect(last.get('mode')).toBe('primary')
  const before = JSON.stringify(last.get('view'))
  await time.advance(10_000)
  expect(JSON.stringify(last.get('view'))).not.toBe(before)
})

test('a session whose store points at an unreachable server rides the outage and recovers', async ($, on) => {
  const time = mock.clock(on, { now: 1_000_000 })
  store(on, { 'promptfall:server': URL_A })
  const last = states(on)
  engineBottom(on)
  const net = remote(on)
  net.down = true
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  expect(last.get('notice')).toBe(RETRYING_NOTICE)
  expect(last.get('view') ?? null).toBeNull()
  net.down = false
  await time.advance(2_000)
  expect(last.get('notice')).toBeNull()
  expect((last.get('view') as GameView).account.server).toBe(URL_A)
})

test('/promptfall server local during an outage drops the unsent events and says how many', async ($, on) => {
  const time = mock.clock(on, { now: 1_000_000 })
  const { data } = store(on)
  const last = states(on)
  engineBottom(on)
  on('tool.call', () => ({ result: 'ok', text: 'ok' }))
  const net = remote(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.command.run({ ...RUN, command: 'promptfall', args: `server ${URL_A}` })
  await $.turn.start({ text: 'go', turnId: 't1' })
  for (let i = 0; i < 3; i++) await $.tool.call({ tool: 'Bash', command: 'ls' })
  net.down = true
  await time.advance(16_000)
  expect(last.get('notice')).toBe(RETRYING_NOTICE)
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  const r = await $.command.run({ ...RUN, command: 'promptfall', args: 'server local' })
  const m =
    /^Promptfall now plays on in-process; (\d+) unsent events on http:\/\/127\.0\.0\.1:1 were dropped$/.exec(
      (r as { text: string }).text,
    )
  // Three tool calls sat in the failed batch and one more in the buffer; ticks depend on cadence.
  expect(Number(m?.[1])).toBeGreaterThanOrEqual(4)
  expect(data.has('promptfall:server')).toBe(false)
  expect(last.get('server')).toBeNull()
  expect(last.get('notice')).not.toBe(RETRYING_NOTICE)
  expect((last.get('view') as GameView).account.server).toBe('in-process')
  const calls = net.calls
  await time.advance(60_000)
  expect(net.calls).toBe(calls)
})

test('the link flow against the in-process ledger shows Linked as player', async ($, on) => {
  const time = mock.clock(on, { now: 1_000_000 })
  store(on)
  const last = states(on)
  engineBottom(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-account' })
  await ui.press({ key: 'link-github' })
  expect(await ui.find({ text: /Enter [0-9A-Z]{8} at/ })).toBeDefined()
  await time.advance(5_000)
  expect((last.get('view') as GameView).account.linked).toBe('player')
  expect(await ui.find({ text: /Linked as player/ })).toBeDefined()
  await ui.unmount()
})

test('the reset on a v1 store starts a fresh account and keeps the lease', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  const old = { ...createInitialState(5), v: 1 }
  const { data } = store(on, {
    'promptfall:deviceToken': 'token-1',
    'promptfall:pf:token:token-1': 'acct-1',
    'promptfall:pf:acct:acct-1:record': {
      account: { accountId: 'acct-1', seed: 5, createdAt: 0, displayName: null, linked: null },
      state: old,
      seq: 3,
      refillAt: { tick: 0, tool_call: 0, rest: 0, turn_end: 0 },
      buckets: { tick: 70, tool_call: 140, rest: 30, turn_end: 30 },
      committed: [],
    },
  })
  const last = states(on)
  engineBottom(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  expect(last.get('mode')).toBe('paused')
  expect(last.get('notice')).toBe(OLD_VERSION_NOTICE)
  expect(last.get('view') ?? null).toBeNull()
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-account' })
  expect(await ui.find({ text: /Server: in-process/ })).toBeDefined()
  await ui.press({ key: 'reset' })
  const view = last.get('view') as GameView
  expect(view).toBeTruthy()
  expect(view.accountId).not.toBe('acct-1')
  expect(last.get('mode')).toBe('primary')
  // A fresh account: the welcome replaces the old-version notice.
  expect(last.get('notice')).toBe('Welcome to Promptfall. /promptfall heroes to meet your party')
  expect(data.has('promptfall:pf:acct:acct-1:record')).toBe(false)
  expect(data.has('promptfall:lease')).toBe(true)
  await ui.unmount()
})

const batches = (net: { requests: { path: string }[] }) =>
  net.requests.filter((r) => r.path === '/v1/batches').length

test('a primary demoted during an outage never submits the batch it held', async ($, on) => {
  const time = mock.clock(on, { now: 1_000_000 })
  const { data } = store(on)
  const last = states(on)
  engineBottom(on)
  on('tool.call', () => ({ result: 'ok', text: 'ok' }))
  const net = remote(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.command.run({ ...RUN, command: 'promptfall', args: `server ${URL_A}` })
  await $.turn.start({ text: 'go', turnId: 't1' })
  for (let i = 0; i < 3; i++) await $.tool.call({ tool: 'Bash', command: 'ls' })
  net.down = true
  await time.advance(16_000)
  expect(last.get('notice')).toBe(RETRYING_NOTICE)
  const before = batches(net)
  data.set(LEASE, { owner: 'someone-else', until: 9_999_999_999_999 })
  await time.advance(10_000)
  expect(last.get('mode')).toBe('secondary')
  net.down = false
  await time.advance(60_000)
  expect(batches(net)).toBe(before)
  expect(last.get('mode')).toBe('secondary')
})

test('a server that never answers is an outage after 15 s', async ($, on) => {
  const time = mock.clock(on, { now: 1_000_000 })
  store(on, { 'promptfall:server': URL_A })
  const last = states(on)
  engineBottom(on)
  on('http.fetch', () => new Promise(() => {}))
  // The session's start waits on the bootstrap, so the clock moves while it is in flight.
  const started = $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await time.advance(14_000)
  expect(last.get('notice')).not.toBe(RETRYING_NOTICE)
  await time.advance(2_000)
  await started
  expect(last.get('notice')).toBe(RETRYING_NOTICE)
  const r = await $.command.run({ ...RUN, command: 'promptfall', args: 'server local' })
  expect((r as { text: string }).text).toMatch(/^Promptfall now plays on in-process/)
})

test("the player's claim follows a server switch made in another session", async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  const { data } = store(on, { [LEASE]: { owner: 'other', until: 9_999_999_999_999 } })
  const last = states(on)
  engineBottom(on)
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  remote(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  expect(last.get('mode')).toBe('secondary')
  data.set('promptfall:server', URL_A)
  await $.prompt.submit({ text: 'hi', wait: false, origin: { kind: 'composer' } })
  expect(last.get('mode')).toBe('primary')
  expect(last.get('server')).toBe(URL_A)
  expect((last.get('view') as GameView).account.server).toBe(URL_A)
  expect(data.has(`promptfall:token:${URL_A}`)).toBe(true)
})

test('a secondary stops bootstrapping with a token the server does not know', async ($, on) => {
  const time = mock.clock(on, { now: 1_000_000 })
  const { data } = store(on, {
    'promptfall:server': URL_A,
    [`promptfall:token:${URL_A}`]: 'stale',
    [LEASE]: { owner: 'other', until: 9_999_999_999_999 },
  })
  const last = states(on)
  engineBottom(on)
  const net = remote(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await time.advance(30_000)
  const boots = () => net.requests.filter((r) => r.path === '/v1/bootstrap').length
  expect(boots()).toBe(1)
  const fresh = await net.ledger.bootstrap({ clientVersion: '0.1.0', deviceToken: null })
  data.set(`promptfall:token:${URL_A}`, fresh.deviceToken)
  await time.advance(10_000)
  expect(boots()).toBe(2)
  expect(last.get('view')).toBeTruthy()
})

test('a trailing slash on the server URL is dropped', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  const { data } = store(on)
  states(on)
  engineBottom(on)
  remote(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const r = await $.command.run({ ...RUN, command: 'promptfall', args: `server ${URL_A}/` })
  expect(r).toMatchObject({ text: `Promptfall now plays on ${URL_A}` })
  expect(data.get('promptfall:server')).toBe(URL_A)
  expect(data.has(`promptfall:token:${URL_A}`)).toBe(true)
})

test('a server switch clears a pending link code', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  store(on)
  const last = states(on)
  engineBottom(on)
  remote(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-account' })
  await ui.press({ key: 'link-github' })
  expect(await ui.find({ text: /Enter [0-9A-Z]{8} at/ })).toBeDefined()
  await $.command.run({ ...RUN, command: 'promptfall', args: `server ${URL_A}` })
  expect((last.get('dialog') as { link: unknown }).link).toBeNull()
  await ui.unmount()
})

test('pressing Link GitHub during an outage does nothing', async ($, on) => {
  const time = mock.clock(on, { now: 1_000_000 })
  store(on)
  const last = states(on)
  engineBottom(on)
  on('tool.call', () => ({ result: 'ok', text: 'ok' }))
  const net = remote(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.command.run({ ...RUN, command: 'promptfall', args: `server ${URL_A}` })
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  net.down = true
  await time.advance(16_000)
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-account' })
  await ui.press({ key: 'link-github' })
  expect(await ui.find({ text: /Enter [0-9A-Z]{8} at/ })).toBeUndefined()
  expect(last.get('notice')).toBe(RETRYING_NOTICE)
  await ui.unmount()
})

test("past 120 s the dialog's read-only line is the outage notice", async ($, on) => {
  const time = mock.clock(on, { now: 1_000_000 })
  store(on)
  engineBottom(on)
  states(on)
  on('tool.call', () => ({ result: 'ok', text: 'ok' }))
  const net = remote(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.command.run({ ...RUN, command: 'promptfall', args: `server ${URL_A}` })
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  net.down = true
  await time.advance(16_000)
  await time.advance(120_000)
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...PANE })
  expect(await ui.find({ text: /Promptfall: server unreachable/ })).toBeDefined()
  expect(await ui.find({ text: /not playing in this session/ })).toBeUndefined()
  await ui.unmount()
})

// ---------------------------------------------------------------------------
// The world poll

const URL_W = 'http://test'
const URL_X = 'http://other'

function snap(patch: Partial<WorldSnapshot> = {}): WorldSnapshot {
  return {
    serverNow: 2_000_000,
    speed: 10,
    online: 3,
    zones: [{ zone: 1, count: 3 }],
    here: ['Ashgrove'],
    boss: null,
    chat: [],
    flags: { 'chat.enabled': true, 'presence.enabled': true, 'market.enabled': true },
    ...patch,
  }
}

const say = (id: number, text = `line ${id}`): ChatMessage => ({
  id,
  name: 'Brindle',
  text,
  at: id,
})

const LIVE_BOSS = {
  bossId: 'wb1',
  name: 'The Promptwyrm',
  glyph: '☠',
  maxHp: 4000,
  hp: 2500,
  spawnedAt: 1,
  endsAt: 9_999_999_999,
  yours: 0,
}

/**
 * A remote server whose account routes are the vendored ledger and whose world
 * poll answers `net.world(since, url)`. `holdWorld` keeps the next poll open
 * until `release()`; `worldDown` throws on it.
 */
function worldNet(on: On) {
  const ledger = new Ledger({
    kv: new MemoryKeyValue(),
    now: async () => 1_000_000,
    minClientVersion: '0.1.0',
    seedSource: () => 777,
    tokenSource: () => crypto.randomUUID(),
    linkApprover: async () => ({ login: 'remote-player' }),
  })
  const net = {
    ledger,
    worldDown: false,
    holdWorld: false,
    release: (() => undefined) as () => void,
    polls: [] as string[],
    world: (_since: number, _url: string): WorldSnapshot => snap(),
  }
  on('http.fetch', async (_$, e) => {
    const [full, query = ''] = e.url.split('?')
    const path = (full ?? '').replace(/^https?:\/\/[^/]+/, '')
    const method = e.init?.method ?? 'GET'
    const header = e.init?.headers?.authorization ?? ''
    const auth = { deviceToken: header.replace(/^Bearer /, '') }
    const body = e.init?.body ? JSON.parse(e.init.body) : undefined
    const ok = (result: unknown) => ({
      value: { status: 200, ok: true, headers: {}, text: JSON.stringify(result) },
    })
    if (method === 'GET' && path === '/v1/world') {
      net.polls.push(e.url)
      if (net.worldDown) throw new Error('connect ECONNREFUSED')
      if (net.holdWorld) {
        net.holdWorld = false
        await new Promise<void>((resolve) => {
          net.release = resolve
        })
      }
      const since = Number(/since=(\d+)/.exec(query)?.[1] ?? 0)
      return ok(net.world(since, e.url))
    }
    if (method === 'POST' && path === '/v1/bootstrap') return ok(await ledger.bootstrap(body))
    if (method === 'POST' && path === '/v1/batches') return ok(await ledger.submit(body, auth))
    if (method === 'GET' && path === '/v1/account') return ok(await ledger.account(auth))
    return { value: { status: 404, ok: false, headers: {}, text: '{"error":"route"}' } }
  })
  return net
}

const worldOf = (last: Map<string, unknown>) => last.get('world') as WorldState

test('the world poll goes out on start and every 15 s, with the chat mark', async ($, on) => {
  const time = mock.clock(on, { now: 1_000_000 })
  store(on)
  const last = states(on)
  engineBottom(on)
  const net = worldNet(on)
  net.world = (since) => snap({ chat: since === 0 ? [say(1), say(2), say(3)] : [] })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.command.run({ ...RUN, command: 'promptfall', args: `server ${URL_W}` })
  await time.advance(1)
  expect(net.polls[0]).toBe(`${URL_W}/v1/world?since=0`)
  const world = worldOf(last)
  expect(world.snapshot?.online).toBe(3)
  expect(world.messages.map((m) => m.id)).toEqual([1, 2, 3])
  expect(world.chatMark).toBe(3)
  expect(world.clock?.speed).toBe(10)
  const before = net.polls.length
  await time.advance(WORLD_POLL_MS)
  expect(net.polls.length).toBe(before + 1)
  expect(net.polls.at(-1)).toBe(`${URL_W}/v1/world?since=3`)
  await time.advance(WORLD_POLL_MS)
  expect(net.polls.length).toBe(before + 2)
})

test('a live boss polls every 5 s; a dead or gone one goes back to 15 s', async ($, on) => {
  const time = mock.clock(on, { now: 1_000_000 })
  store(on)
  const last = states(on)
  engineBottom(on)
  const net = worldNet(on)
  let boss: WorldSnapshot['boss'] = LIVE_BOSS
  net.world = () => snap({ boss })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.command.run({ ...RUN, command: 'promptfall', args: `server ${URL_W}` })
  await time.advance(1)
  expect(worldOf(last).snapshot?.boss?.hp).toBe(2500)
  let n = net.polls.length
  await time.advance(15_000)
  expect(net.polls.length - n).toBe(3)
  boss = { ...LIVE_BOSS, hp: 0 }
  await time.advance(5_000)
  n = net.polls.length
  await time.advance(15_000)
  expect(net.polls.length - n).toBe(1)
  boss = LIVE_BOSS
  await time.advance(15_000)
  boss = null
  await time.advance(5_000)
  n = net.polls.length
  await time.advance(15_000)
  expect(net.polls.length - n).toBe(1)
})

test('at most one world poll is in flight', async ($, on) => {
  const time = mock.clock(on, { now: 1_000_000 })
  store(on)
  states(on)
  engineBottom(on)
  const net = worldNet(on)
  net.world = () => snap({ boss: LIVE_BOSS })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.command.run({ ...RUN, command: 'promptfall', args: `server ${URL_W}` })
  await time.advance(1)
  net.holdWorld = true
  const n = net.polls.length
  await time.advance(5_000)
  expect(net.polls.length).toBe(n + 1)
  await time.advance(9_000)
  expect(net.polls.length).toBe(n + 1)
  net.release()
  await time.advance(5_000)
  expect(net.polls.length).toBe(n + 2)
})

test('a message already held is not added twice', async ($, on) => {
  const time = mock.clock(on, { now: 1_000_000 })
  store(on)
  const last = states(on)
  engineBottom(on)
  const net = worldNet(on)
  net.world = (since) => snap({ chat: since === 0 ? [say(1), say(2)] : [say(2), say(3)] })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.command.run({ ...RUN, command: 'promptfall', args: `server ${URL_W}` })
  await time.advance(WORLD_POLL_MS)
  expect(worldOf(last).messages.map((m) => m.id)).toEqual([1, 2, 3])
})

test('a throwing world poll sets no notice; 45 s without a success is stale until the next', async ($, on) => {
  const time = mock.clock(on, { now: 1_000_000 })
  store(on)
  const last = states(on)
  engineBottom(on)
  const net = worldNet(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.command.run({ ...RUN, command: 'promptfall', args: `server ${URL_W}` })
  await time.advance(1)
  expect(worldOf(last).stale).toBe(false)
  net.worldDown = true
  const view = JSON.stringify(last.get('view'))
  await time.advance(WORLD_STALE_MS - 1_000)
  expect(last.get('notice') ?? null).toBeNull()
  expect(last.get('mode')).toBe('primary')
  expect(JSON.stringify(last.get('view'))).not.toBe(view)
  expect(worldOf(last).stale).toBe(false)
  await time.advance(1_000)
  expect(worldOf(last).stale).toBe(true)
  net.worldDown = false
  await time.advance(WORLD_POLL_MS)
  expect(worldOf(last).stale).toBe(false)
  expect(last.get('notice') ?? null).toBeNull()
})

test('a secondary polls too, and a switch made elsewhere resets the world and polls the new server', async ($, on) => {
  const time = mock.clock(on, { now: 1_000_000 })
  const net = worldNet(on)
  const a = await net.ledger.bootstrap({ clientVersion: '0.1.0', deviceToken: null })
  const x = await net.ledger.bootstrap({ clientVersion: '0.1.0', deviceToken: null })
  const { data } = store(on, {
    'promptfall:server': URL_W,
    [`promptfall:token:${URL_W}`]: a.deviceToken,
    [`promptfall:token:${URL_X}`]: x.deviceToken,
    [LEASE]: { owner: 'other', until: 9_999_999_999_999 },
  })
  const last = states(on)
  engineBottom(on)
  net.world = (_since, url) =>
    url.startsWith(URL_X) ? snap({ online: 7 }) : snap({ chat: [say(1)] })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await time.advance(1)
  expect(last.get('mode')).toBe('secondary')
  expect(net.polls[0]).toBe(`${URL_W}/v1/world?since=0`)
  expect(worldOf(last).messages.map((m) => m.id)).toEqual([1])
  data.set('promptfall:server', URL_X)
  await time.advance(10_000)
  expect(net.polls.some((u) => u.startsWith(`${URL_X}/v1/world?since=0`))).toBe(true)
  expect(worldOf(last).snapshot?.online).toBe(7)
  expect(worldOf(last).messages).toEqual([])
})

test('/promptfall server local resets the world to the in-process snapshot, chat closed', async ($, on) => {
  const time = mock.clock(on, { now: 1_000_000 })
  store(on)
  const last = states(on)
  engineBottom(on)
  const net = worldNet(on)
  net.world = () => snap({ chat: [say(1)] })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.command.run({ ...RUN, command: 'promptfall', args: `server ${URL_W}` })
  await time.advance(1)
  expect(worldOf(last).messages).toHaveLength(1)
  await $.command.run({ ...RUN, command: 'promptfall', args: 'server local' })
  await time.advance(1)
  const world = worldOf(last)
  expect(world.messages).toEqual([])
  expect(world.snapshot?.flags['chat.enabled']).toBe(false)
  expect(world.snapshot?.online).toBe(1)
})

// ---------------------------------------------------------------------------
// The world boss

test('the boss appearing and going down toast once each', async ($, on) => {
  const time = mock.clock(on, { now: 1_000_000 })
  store(on)
  states(on)
  const toasts: string[] = []
  engineBottom(on, toasts)
  const net = worldNet(on)
  let boss: WorldSnapshot['boss'] = null
  net.world = () => snap({ boss })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.command.run({ ...RUN, command: 'promptfall', args: `server ${URL_W}` })
  await time.advance(1)
  boss = LIVE_BOSS
  await time.advance(15_000)
  await time.advance(5_000)
  boss = { ...LIVE_BOSS, hp: 0 }
  await time.advance(5_000)
  await time.advance(15_000)
  expect(toasts.filter((t) => t === 'World boss The Promptwyrm has appeared')).toHaveLength(1)
  expect(toasts.filter((t) => t === 'The Promptwyrm is down')).toHaveLength(1)
})

test('a reward toasts the item or the gold, and the loot log names it', () => {
  const item = {
    id: 'r0',
    base: 'steel_longsword',
    rarity: 'rare' as const,
    affixes: [],
    equippedBy: null,
    tradeableAt: null,
  }
  expect(
    effectToast({ k: 'rewarded', bossId: 'wb1', goods: { kind: 'item', item }, gold: 45 }),
  ).toBe('Boss reward: Steel Longsword (rare)')
  expect(effectToast({ k: 'rewarded', bossId: 'wb1', goods: null, gold: 45 })).toBe(
    'Boss reward: 45 gold',
  )
  const state = {
    ...createInitialState(1),
    lootLog: [{ k: 'reward' as const, base: 'steel_longsword', rarity: 'rare' as const, gold: 45 }],
  }
  const view = toGameView(state, 'a1', false, toAccountView(null, null, 'in-process', 0))
  expect(view.loot.at(-1)?.text).toBe('boss reward Steel Longsword (+45g)')
})

test('a boss seen in the snapshot reaches the primary through its next flush, with no account call', async ($, on) => {
  const time = mock.clock(on, { now: 1_000_000 })
  store(on)
  const last = states(on)
  engineBottom(on)
  let now = 10_800_000 - 1_000
  const ledger = new Ledger({
    kv: new MemoryKeyValue(),
    now: async () => now,
    minClientVersion: '0.1.0',
    seedSource: () => 777,
    tokenSource: () => crypto.randomUUID(),
    linkApprover: async () => ({ login: 'remote-player' }),
  })
  const requests: string[] = []
  const behind: string[][] = []
  on('http.fetch', async (_$, e) => {
    const path = (e.url.split('?')[0] ?? '').replace(/^https?:\/\/[^/]+/, '')
    const method = e.init?.method ?? 'GET'
    requests.push(`${method} ${path}`)
    const auth = { deviceToken: (e.init?.headers?.authorization ?? '').replace(/^Bearer /, '') }
    const body = e.init?.body ? JSON.parse(e.init.body) : undefined
    let result: unknown
    if (path === '/v1/world') result = await ledger.world(auth, 0)
    else if (path === '/v1/bootstrap') result = await ledger.bootstrap(body)
    else if (path === '/v1/batches') {
      const ack = await ledger.submit(body, auth)
      if (!ack.ok && ack.reason === 'cursor_behind') {
        behind.push(ack.delivery.events.map((x) => x.event.t))
      }
      result = ack
    } else if (path === '/v1/account') result = await ledger.account(auth)
    else return { value: { status: 404, ok: false, headers: {}, text: '{"error":"route"}' } }
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify(result) } }
  })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.command.run({ ...RUN, command: 'promptfall', args: `server ${URL_W}` })
  await time.advance(1)
  now = 10_800_000 + 1_000
  await time.advance(30_000)
  const boss = (last.get('world') as WorldState).snapshot?.boss
  expect(boss).toBeTruthy()
  expect((last.get('view') as GameView).boss?.bossId).toBe(boss?.bossId)
  expect(behind.some((kinds) => kinds.includes('boss_engaged'))).toBe(true)
  expect(requests).not.toContain('GET /v1/account')
})

test('a reload during a live boss keeps the held snapshot, so the boss is not announced again', async () => {
  const toasts: string[] = []
  const held: WorldState = {
    snapshot: snap({ boss: LIVE_BOSS }),
    fetchedAt: 1,
    stale: false,
    messages: [],
    chatMark: 0,
    clock: null,
    committedDealt: null,
  }
  const poller = new WorldPoller({
    now: async () => 2,
    every: () => ({ cancel: () => undefined }),
    after: () => ({ cancel: () => undefined }),
    publish: async () => undefined,
    load: async () => held,
    fetch: async () => snap({ boss: LIVE_BOSS }),
    toast: (text) => toasts.push(text),
  })
  await poller.start()
  expect(toasts).toEqual([])
})

// ---------------------------------------------------------------------------
// The stage's renderer probe and the loop's wake

const PARTY_BAND = {
  component: 'AbovePrompt' as const,
  requestId: 'band-probe',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 20,
    bodyColumns: 120,
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
}

/** A terminal session whose blits answer `answer`; records each blit. */
function probing(on: On, answer: { deny?: string }, seed: Record<string, unknown> = {}) {
  const time = mock.clock(on, { now: 1_000_000 })
  const { data } = store(on, seed)
  const last = states(on)
  engineBottom(on)
  const blits: (UiBlitArgs & { at: number })[] = []
  on('ui.blit', (_$, e) => {
    blits.push({ ...e, at: time.now() })
    return { value: answer }
  })
  on('ui.invalidate', (_$, e, next) => next(e))
  return { time, data, last, blits }
}

test('the probe settles on image when the blit is taken', async ($, on) => {
  const { time, last, blits } = probing(on, {})
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...PARTY_BAND })
  const mounted = await ui.find({ key: 'probe' })
  expect(mounted).toBeDefined()
  await time.advance(PROBE_DELAY_MS)
  expect(last.get('renderer')).toBe('image')
  const probe = blits.find((b) => b.key === 'probe')
  expect(probe).toBeDefined()
  expect(probe && 'source' in probe ? probe.source : null).not.toEqual(mounted?.props.source)
  await ui.unmount()
})

test("the probe settles on raster on the alt's deny, and stays unknown on any other", async ($, on) => {
  const { time, last } = probing(on, {
    deny: `${PROBE_ALT_DENY} (env: terminal=Apple_Terminal, not asked yet, no answer)`,
  })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...PARTY_BAND })
  await time.advance(PROBE_DELAY_MS)
  expect(last.get('renderer')).toBe('raster')
  await ui.unmount()
})

test('any other deny leaves the renderer unknown, and a later render probes again', async ($, on) => {
  const { time, last, blits } = probing(on, {
    deny: 'no Image of its own is mounted under key "probe" in band-probe',
  })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...PARTY_BAND })
  await time.advance(PROBE_DELAY_MS)
  expect(last.get('renderer') ?? 'unknown').toBe('unknown')
  await ui.unmount()
  const again = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...PARTY_BAND })
  await time.advance(PROBE_DELAY_MS)
  expect(blits.filter((b) => b.key === 'probe')).toHaveLength(2)
  await again.unmount()
})

test('a forced renderer sends no probe', async ($, on) => {
  const { time, last, blits } = probing(
    on,
    {},
    {
      'promptfall:settings': { sound: false, motion: 'full', renderer: 'raster' },
    },
  )
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  expect(last.get('renderer')).toBe('raster')
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...PARTY_BAND })
  await time.advance(PROBE_DELAY_MS)
  expect(blits.filter((b) => b.key === 'probe')).toHaveLength(0)
  await ui.unmount()
})

test('a collapsed band arms no probe', async ($, on) => {
  const { time, blits } = probing(on, {})
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const narrow = { ...PARTY_BAND, props: { ...PARTY_BAND.props, bodyColumns: 80 } }
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...narrow })
  await time.advance(PROBE_DELAY_MS * 2)
  expect(blits).toHaveLength(0)
  await ui.unmount()
})

test('effects with a hit wake the stage loop', async ($, on) => {
  const { time, last, blits } = probing(
    on,
    {},
    {
      'promptfall:settings': { sound: false, motion: 'still', renderer: 'raster' },
    },
  )
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...PARTY_BAND })
  for (let i = 0; i < 20 && (last.get('view') as GameView).enemies.length === 0; i++) {
    await time.advance(5_000)
  }
  const tick = time.now() + 5_000
  await time.advance(5_000 + EVENT_FRAME_MS)
  expect(
    blits.some((b) => b.key === 'stage' && b.at >= tick && b.at <= tick + EVENT_FRAME_MS),
  ).toBe(true)
  await ui.unmount()
})

// ---------------------------------------------------------------------------
// Sound cues

/** The in-process ledger's record for an account whose state the test chose. */
function record(state: GameState): Record<string, unknown> {
  return {
    'promptfall:deviceToken': 'token-1',
    'promptfall:pf:token:token-1': 'acct-1',
    'promptfall:pf:acct:acct-1:record': {
      account: {
        accountId: 'acct-1',
        seed: state.seed,
        createdAt: 0,
        displayName: null,
        linked: null,
      },
      state,
      seq: 0,
      refillAt: { tick: 1_000_000, tool_call: 1_000_000, rest: 1_000_000, turn_end: 1_000_000 },
      buckets: { tick: 70, tool_call: 140, rest: 30, turn_end: 30 },
      batches: [],
      cursor: 0,
      committedCursor: 0,
      committedState: state,
      committedHash: hashState(state),
      log: [],
      returns: [],
    },
  }
}

/** A state whose next tick kills a 1 hp Goblin Scout and drops an item of `rarity`, with no level up. */
function dropping(rarity: string): GameState {
  for (let seed = 1; seed < 20_000; seed++) {
    const s0 = createInitialState(seed)
    const s: GameState = {
      ...s0,
      encounter: {
        enemies: [{ id: 'e-test', def: 'goblin_scout', kind: 'wave', hp: 1, maxHp: 60 }],
        queue: [],
        waveSize: 3,
        spawnedInWave: 3,
      },
      // Full party gauges: the party acts in the tick's first step and kills the 1 HP enemy.
      battle: { gauges: s0.party.map((id) => ({ id, g: GAUGE_FULL })), queue: [], busy: 0 },
    }
    const effects = step(s, { t: 'tick' }).effects
    const drop = effects.find((e) => e.k === 'drop')
    if (
      drop?.k === 'drop' &&
      drop.item.rarity === rarity &&
      !effects.some((e) => e.k === 'level_up')
    ) {
      return s
    }
  }
  throw new Error(`no ${rarity} drop`)
}

const SOUND_ON = { 'promptfall:settings': { sound: true, motion: 'full', renderer: 'auto' } }

function sounding(on: On, seed: Record<string, unknown>) {
  const time = mock.clock(on, { now: 1_000_000 })
  const { data } = store(on, seed)
  const last = states(on)
  engineBottom(on)
  const plays: { asset: string; gain: number | undefined }[] = []
  on('audio.play', (_$, e) => {
    plays.push({ asset: e.clip.asset ?? '', gain: e.gain })
    return { value: undefined }
  })
  return { time, data, last, plays }
}

for (const [rarity, asset] of [
  ['epic', 'cues/drop.wav'],
  ['rare', 'cues/drop.wav'],
  ['legendary', 'cues/legendary.wav'],
] as const) {
  test(`a ${rarity} drop on a primary with sound on plays ${asset}`, async ($, on) => {
    const { time, plays } = sounding(on, { ...record(dropping(rarity)), ...SOUND_ON })
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
    await time.advance(5_000)
    expect(plays).toEqual([{ asset, gain: CUE_GAIN }])
  })
}

test('a common drop plays nothing; sound off plays nothing', async ($, on) => {
  const { time, plays } = sounding(on, { ...record(dropping('common')), ...SOUND_ON })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await time.advance(5_000)
  expect(plays).toEqual([])
})

test('sound off plays nothing on an epic drop', async ($, on) => {
  const { time, plays } = sounding(on, record(dropping('epic')))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await time.advance(5_000)
  expect(plays).toEqual([])
})

test('sound turned on in another session reaches the primary without a restart', async ($, on) => {
  const { time, plays, data } = sounding(on, record(dropping('epic')))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  // Another session's /promptfall sound on writes the machine's store, not this session's atom.
  data.set('promptfall:settings', { sound: true, motion: 'full', renderer: 'auto' })
  await time.advance(5_000)
  expect(plays).toEqual([{ asset: 'cues/drop.wav', gain: CUE_GAIN }])
})

test('a secondary plays nothing', async ($, on) => {
  const { time, plays, last } = sounding(on, {
    ...record(dropping('epic')),
    ...SOUND_ON,
    'promptfall:lease': { owner: 'someone-else', until: 9_999_999_999_999 },
  })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  expect(last.get('mode')).toBe('secondary')
  await time.advance(5_000)
  expect(plays).toEqual([])
})

test('/promptfall off hides the band, not the cues', async ($, on) => {
  const { time, plays } = sounding(on, { ...record(dropping('epic')), ...SOUND_ON })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.command.run({ ...RUN, command: 'promptfall', args: 'off' })
  await time.advance(5_000)
  expect(plays.map((p) => p.asset)).toEqual(['cues/drop.wav'])
})

test('a world boss already up when the session starts plays no cue', async ($, on) => {
  const { time, plays } = sounding(on, SOUND_ON)
  const net = worldNet(on)
  net.world = () => snap({ boss: LIVE_BOSS })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.command.run({ ...RUN, command: 'promptfall', args: `server ${URL_W}` })
  await time.advance(1)
  await time.advance(15_000)
  expect(plays.filter((p) => p.asset === 'cues/boss.wav')).toEqual([])
})

test('the world boss appearing plays the boss cue; going down plays none', async ($, on) => {
  const { time, plays } = sounding(on, SOUND_ON)
  const net = worldNet(on)
  let boss: WorldSnapshot['boss'] = null
  net.world = () => snap({ boss })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.command.run({ ...RUN, command: 'promptfall', args: `server ${URL_W}` })
  await time.advance(1)
  boss = LIVE_BOSS
  await time.advance(15_000)
  await time.advance(5_000)
  boss = { ...LIVE_BOSS, hp: 0 }
  await time.advance(5_000)
  await time.advance(15_000)
  expect(plays.filter((p) => p.asset === 'cues/boss.wav')).toHaveLength(1)
  expect(plays.filter((p) => p.asset !== 'cues/boss.wav')).toEqual([])
})
