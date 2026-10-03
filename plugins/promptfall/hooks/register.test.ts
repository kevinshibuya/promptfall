import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
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
