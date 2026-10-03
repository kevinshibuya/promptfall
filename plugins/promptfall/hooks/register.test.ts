import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { GameView } from '../types'
import { OLD_VERSION_NOTICE, RETRYING_NOTICE } from './engine'
import { Ledger } from './vendor/ledger.js'
import { MemoryKeyValue } from './vendor/protocol.js'
import { createInitialState, type GameState, hashState } from './vendor/sim.js'

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
