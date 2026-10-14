import type { On, RenderSurface, SessionUsage, UiBlitArgs } from 'claude-code'
import { expect, mock, type TestBody } from 'claude-code/testing'
import type { GameView, WorldState } from '../types'
import { DELETED_NOTICE, NOT_DELETED, OLD_VERSION_NOTICE, RETRYING_NOTICE } from './engine'
import { release } from './lease'
import { SANDBOX_PINS_SERVER } from './sandbox'
import { PUBLIC_SERVER } from './server'
import { bandKey } from './stage/loop'
import { CHEST_SHOW_MS, StageTimeline } from './stage/timeline'
import { EVENT_FRAME_MS, PROBE_ALT_DENY, PROBE_DELAY_MS } from './stage/tuning'
import { SANDBOX_PREFIX, StoreKeyValue } from './storage'
import { goalWords, STAMP_MS, SUMMARY_MS } from './summary'
import { test } from './testing'
import { worldRows } from './ui/band'
import { paneText } from './ui/pane/testing'
import { approveAs, Ledger } from './vendor/ledger.js'
import {
  BOSS_WINDOW_MS,
  type ChatMessage,
  DAY_MS,
  dayOf,
  MemoryKeyValue,
  type WorldSnapshot,
} from './vendor/protocol.js'
import {
  content,
  createInitialState,
  dailyGoal,
  type Effect,
  type Event,
  GAUGE_FULL,
  type GameState,
  hashState,
  step,
} from './vendor/sim.js'
import { CLIENT_VERSION } from './version'
import { toAccountView, toGameView } from './view'
import { PANE_ROWS } from './windows/tuning'
import { WORLD_POLL_FAST_MS, WORLD_POLL_MS, WORLD_STALE_MS, WorldPoller } from './world'

/**
 * Answers $.store from a map and records every write. The machine plays in-process unless the
 * seed names a server; a seed with `promptfall:server: undefined` is a fresh install.
 */
function store(on: On, seed: Record<string, unknown> = {}) {
  const data = new Map<string, unknown>(
    Object.entries({ 'promptfall:server': 'local', ...seed }).filter(([, v]) => v !== undefined),
  )
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

/** Records the state the plugin writes: the last value per key, and every write into `seen`. */
function states(on: On, seen: { key: string; value: unknown }[] = []) {
  const last = new Map<string, unknown>()
  on('state.set', async (_$, e, next) => {
    last.set(e.key, e.value)
    seen.push({ key: e.key, value: e.value })
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

/** A toast as the host received it: its text and the timeout it was raised with. */
type Raised = { text: string; timeoutMs: number | undefined }

function engineBottom(
  on: On,
  toasts: string[] = [],
  env: Record<string, string> = {},
  onToast: (toast: Raised) => void = () => undefined,
) {
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  // The sandbox switch reads the environment: unset unless a test turns the sandbox on.
  mock.env(on, env)
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    onToast({ text: e.text, timeoutMs: e.timeoutMs })
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
  // The tool calls spawned enemies: still on the field, or already killed. The account's seed is
  // random, and on about a fifth of seeds the party clears the field inside the 16 seconds.
  const view = last.get('view') as { enemies: unknown[]; kills: number } | null
  expect((view?.enemies.length ?? 0) + (view?.kills ?? 0)).toBeGreaterThan(0)
  const commit = writes.find(
    (w) => w.key.startsWith('promptfall:pf:acct:') && (w.value as { seq?: number }).seq === 1,
  )
  expect(commit).toBeDefined()
})

test('a first run welcomes the player and its notice says sound is on', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  store(on)
  const last = states(on)
  const toasts: string[] = []
  engineBottom(on, toasts)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  expect(toasts).toContain('Welcome to Promptfall. /promptfall heroes to meet your party')
  expect(last.get('notice')).toBe(
    'Sound on; /promptfall sound off silences it. Welcome to Promptfall. /promptfall heroes to meet your party.',
  )
})

test('a first run with sound off has no sound clause in its notice', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  // A reset keeps the settings: a player who chose off and reset is not told sound is on.
  store(on, { 'promptfall:settings': { sound: 'off', motion: 'full', renderer: 'auto' } })
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
  // The player typing here does; the promotion lands after the prompt has gone through.
  await $.prompt.submit({ text: 'hi', wait: false, origin: { kind: 'composer' } })
  await time.settle()
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

/**
 * The surfaces the session draws on, as the engine reports them. In the agents view's log (#185)
 * the process a conversation left draws on none.
 */
function session(on: On) {
  const drawn = { surfaces: ['terminal'] as RenderSurface[] }
  on('session.surfaces', () => ({ value: drawn.surfaces }))
  return drawn
}

/** The agents view's background processes, as the engine's environment marks them (2.1.296). */
const JOB_ENV = { CLAUDE_CODE_SESSION_KIND: 'bg', CLAUDE_BG_SOURCE: 'slash' }
const SPARE_ENV = { CLAUDE_CODE_SESSION_KIND: 'bg', CLAUDE_BG_SOURCE: 'spare' }
/** The spare as `ps` saw its launch, before the engine marks it. */
const SPARE_AT_LAUNCH_ENV = { CLAUDE_CODE_SESSION_KIND: 'bg' }
/** The marks a terminal that draws pictures leaves in the processes started from it. */
const GHOSTTY_ENV = { GHOSTTY_RESOURCES_DIR: '/Applications/cmux.app/Contents/Resources/ghostty' }
const KITTY_ENV = { KITTY_WINDOW_ID: '1' }

/** What the plugin sets in its own process's environment, by name. */
function envSets(on: On) {
  const sets = new Map<string, string | undefined>()
  on('env.set', (_$, e) => {
    sets.set(e.name, e.value)
    return { value: undefined }
  })
  return sets
}

const FORCES: [string, Record<string, string>, string][] = [
  ["the conversation's process from Ghostty or cmux", { ...JOB_ENV, ...GHOSTTY_ENV }, 'auto'],
  ['the spare from kitty, with image forced', { ...SPARE_ENV, ...KITTY_ENV }, 'image'],
]
for (const [who, env, renderer] of FORCES) {
  test(`a background worker forces pictures for the attach: ${who}`, async ($, on) => {
    mock.clock(on, { now: 1_000_000 })
    store(on, { 'promptfall:settings': { sound: 'off', motion: 'full', renderer } })
    engineBottom(on, [], env)
    const last = states(on)
    const sets = envSets(on)
    session(on)
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
    expect(sets.get('CLAUDE_CODE_FORCE_TERMINAL_IMAGES')).toBe('1')
    // No probe: before the attach it would hear "no pictures" and settle on half-blocks.
    expect(last.get('renderer')).toBe('image')
  })
}

const LEAVES: [string, Record<string, string>, string][] = [
  ['a direct session', GHOSTTY_ENV, 'auto'],
  [
    'a worker inside tmux',
    { ...JOB_ENV, ...GHOSTTY_ENV, TMUX: '/tmp/tmux-501/default,1,0' },
    'auto',
  ],
  ['a worker inside screen', { ...JOB_ENV, ...KITTY_ENV, STY: '1.pts-0' }, 'auto'],
  ['a worker from a terminal with no pictures', JOB_ENV, 'auto'],
  ['a worker with raster forced', { ...JOB_ENV, ...GHOSTTY_ENV }, 'raster'],
]
for (const [who, env, renderer] of LEAVES) {
  test(`the engine's picture check is left alone: ${who}`, async ($, on) => {
    mock.clock(on, { now: 1_000_000 })
    store(on, { 'promptfall:settings': { sound: 'off', motion: 'full', renderer } })
    engineBottom(on, [], env)
    const last = states(on)
    const sets = envSets(on)
    session(on)
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
    expect(sets.has('CLAUDE_CODE_FORCE_TERMINAL_IMAGES')).toBe(false)
    // The renderer is the setting's: the probe decides auto.
    expect(last.get('renderer') ?? 'unknown').toBe(renderer === 'auto' ? 'unknown' : renderer)
  })
}

/** The machine's save as another process of the plugin reaches it: the same store. */
function elsewhere(data: Map<string, unknown>): StoreKeyValue {
  return new StoreKeyValue({
    get: async (key) => data.get(key),
    set: async (key, value) => void data.set(key, value),
    delete: async (key) => void data.delete(key),
    keys: async () => [...data.keys()],
  })
}

const IN_PLAY = {
  component: 'AbovePrompt' as const,
  requestId: 'band-return',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 34,
    bodyColumns: 135,
    scroll: { offset: 0, bodyRows: 33 },
    view: {},
  },
}

test('the agents view sequence from the log keeps the lease and the band primary', async ($, on) => {
  const time = mock.clock(on, { now: 1_000_000 })
  const { data } = store(on)
  const last = states(on)
  engineBottom(on, [], JOB_ENV)
  // ← hands the conversation to a new process, this one. The process it left fires nothing: it
  // still holds the lease until its next check finds it draws nowhere.
  session(on)
  data.set(LEASE, { owner: 'left-behind', until: 1_020_000 })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  expect(last.get('mode')).toBe('secondary')
  // The process left behind lets the lease go; this one picks it up at its next quick try.
  await release(elsewhere(data), 'left-behind')
  await time.advance(2000)
  expect(last.get('mode')).toBe('primary')
  const mine = last.get('leaseOwner')
  expect((data.get(LEASE) as { owner: string }).owner).toBe(mine)
  // Enter attaches the terminal to this process: nothing fires, and the band plays here.
  await time.advance(30_000)
  expect(last.get('mode')).toBe('primary')
  expect((data.get(LEASE) as { owner: string }).owner).toBe(mine)
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...IN_PLAY })
  expect(await ui.find({ text: /^playing in another session/ })).toBeUndefined()
  await ui.unmount()
})

test('a session that lost the lease takes it back on its return', async ($, on) => {
  const time = mock.clock(on, { now: 1_000_000 })
  const { data } = store(on)
  const last = states(on)
  engineBottom(on, [], JOB_ENV)
  // An empty conversation: the new process is a new session, and nothing ties it to the old one.
  session(on)
  data.set(LEASE, { owner: 'left-behind', until: 1_020_000 })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  expect(last.get('mode')).toBe('secondary')
  // Still held: the quick tries leave it alone.
  await time.advance(4000)
  expect(last.get('mode')).toBe('secondary')
  expect((data.get(LEASE) as { owner: string }).owner).toBe('left-behind')
  await release(elsewhere(data), 'left-behind')
  await time.advance(2000)
  expect(last.get('mode')).toBe('primary')
  expect((data.get(LEASE) as { owner: string }).owner).toBe(last.get('leaseOwner'))
})

test('the spare session never takes a free lease; a prompt in it claims one', async ($, on) => {
  const time = mock.clock(on, { now: 1_000_000 })
  const { data } = store(on)
  const last = states(on)
  engineBottom(on, [], SPARE_ENV)
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  session(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  expect(last.get('mode')).toBe('secondary')
  expect(data.has(LEASE)).toBe(false)
  await time.advance(30_000)
  expect(last.get('mode')).toBe('secondary')
  expect(data.has(LEASE)).toBe(false)
  // A new task typed in the agents view runs here: its prompt claims, and it plays from then.
  await $.prompt.submit({ text: 'hi', wait: false, origin: { kind: 'composer' } })
  await time.settle()
  expect(last.get('mode')).toBe('primary')
  await time.advance(30_000)
  expect(last.get('mode')).toBe('primary')
  expect((data.get(LEASE) as { owner: string }).owner).toBe(last.get('leaseOwner'))
})

test('a spare not yet marked takes no free lease either', async ($, on) => {
  const time = mock.clock(on, { now: 1_000_000 })
  const { data } = store(on)
  const last = states(on)
  engineBottom(on, [], SPARE_AT_LAUNCH_ENV)
  session(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await time.advance(30_000)
  expect(last.get('mode')).toBe('secondary')
  expect(data.has(LEASE)).toBe(false)
})

test('a resumed conversation in a second terminal stays secondary until a prompt', async ($, on) => {
  const time = mock.clock(on, { now: 1_000_000 })
  const { data } = store(on)
  const last = states(on)
  engineBottom(on)
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  session(on)
  // The first terminal still plays and is drawn; this one resumed the same conversation, so it
  // keeps the same start time, and a lease that carried it would match.
  on('session.usage', () => ({ value: { startedAt: 900_000 } as SessionUsage }))
  data.set(LEASE, { owner: 'first-terminal', until: 9_999_999_999_999, startedAt: 900_000 })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  expect(last.get('mode')).toBe('secondary')
  await time.advance(10_000)
  expect(last.get('mode')).toBe('secondary')
  expect((data.get(LEASE) as { owner: string }).owner).toBe('first-terminal')
  await $.prompt.submit({ text: 'hi', wait: false, origin: { kind: 'composer' } })
  await time.settle()
  expect(last.get('mode')).toBe('primary')
})

test('a terminal that draws nowhere flushes, gives the lease up and stops renewing', async ($, on) => {
  const time = mock.clock(on, { now: 1_000_000 })
  const { data, writes } = store(on)
  const last = states(on)
  engineBottom(on)
  on('tool.call', () => ({ result: 'ok', text: 'ok' }))
  const drawn = session(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  for (let i = 0; i < 3; i++) await $.tool.call({ tool: 'Bash', command: 'ls' })
  // ← unmounts the REPL: from here this process draws on no surface, and no hook says so.
  drawn.surfaces = []
  await time.advance(2000)
  expect(writes.some((w) => seqOf(w) === 1)).toBe(true)
  expect(data.has(LEASE)).toBe(false)
  expect(last.get('mode')).toBe('secondary')
  // Free or not, the lease stays with the session the player went to.
  await time.advance(30_000)
  expect(data.has(LEASE)).toBe(false)
  expect(last.get('mode')).toBe('secondary')
})

test('a process that still renews after its conversation left flushes nothing once claimed', async ($, on) => {
  const time = mock.clock(on, { now: 1_000_000 })
  const { data, writes } = store(on)
  const last = states(on)
  engineBottom(on)
  on('tool.call', () => ({ result: 'ok', text: 'ok' }))
  const drawn = session(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  for (let i = 0; i < 3; i++) await $.tool.call({ tool: 'Bash', command: 'ls' })
  // The new process claimed (a prompt there) before this one's first check.
  drawn.surfaces = []
  data.set(LEASE, { owner: 'moved-on', until: 9_999_999_999_999 })
  await time.advance(10_000)
  expect(writes.some((w) => seqOf(w) === 1)).toBe(false)
  expect((data.get(LEASE) as { owner: string }).owner).toBe('moved-on')
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
    linkApprover: approveAs('remote-player'),
  })
  const net = {
    down: false,
    /** Answered to every bootstrap while set, as a host's refusal. */
    refusal: null as null | { refusal: 'rate_limited' | 'banned'; message: string },
    /** Runs before each bootstrap reaches the ledger: another session's work in the flight. */
    beforeBoot: (async () => undefined) as (token: string | null) => Promise<void>,
    /** Accounts a bootstrap through this mock minted. */
    mints: 0,
    calls: 0,
    requests: [] as { origin: string; method: string; path: string }[],
    ledger,
  }
  on('http.fetch', async (_$, e) => {
    net.calls += 1
    const origin = /^https?:\/\/[^/]+/.exec(e.url)?.[0] ?? ''
    const path = e.url.slice(origin.length).split('?')[0] ?? ''
    const method = e.init?.method ?? 'GET'
    if (net.down) throw new Error('connect ECONNREFUSED')
    net.requests.push({ origin, method, path })
    const header = e.init?.headers?.authorization ?? ''
    const auth = { deviceToken: header.replace(/^Bearer /, '') }
    const body = e.init?.body ? JSON.parse(e.init.body) : undefined
    let result: unknown
    if (method === 'POST' && path === '/v1/bootstrap') {
      await net.beforeBoot(body.deviceToken)
      result = net.refusal ?? (await ledger.bootstrap(body))
      if (body.deviceToken === null && !('refusal' in (result as object))) net.mints += 1
    } else if (method === 'POST' && path === '/v1/batches') result = await ledger.submit(body, auth)
    else if (method === 'GET' && path === '/v1/account') result = await ledger.account(auth)
    else if (method === 'DELETE' && path === '/v1/account')
      result = await ledger.deleteAccount(auth)
    // The world poll as the host serves it: a banned account is refused here too.
    else if (method === 'GET' && path === '/v1/world') result = await ledger.world(auth, 0)
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

test('a refused bootstrap shows its message and the session retries later', async ($, on) => {
  const time = mock.clock(on, { now: 1_000_000 })
  const { data } = store(on, { 'promptfall:server': URL_A })
  const last = states(on)
  engineBottom(on)
  const net = remote(on)
  const message = 'Too many new accounts from this address. Promptfall will try again later.'
  net.refusal = { refusal: 'rate_limited', message }
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  expect(last.get('notice')).toBe(message)
  expect(last.get('mode')).toBe('paused')
  expect(last.get('view') ?? null).toBeNull()
  expect(data.has(`promptfall:token:${URL_A}`)).toBe(false)
  const boots = () => net.requests.filter((r) => r.path === '/v1/bootstrap').length
  expect(boots()).toBe(1)
  // Not a hammering retry: a minute on, still the one call.
  await time.advance(60_000)
  expect(boots()).toBe(1)
  net.refusal = null
  await time.advance(5 * 60_000)
  expect(boots()).toBe(2)
  expect(last.get('notice')).toBeNull()
  expect(last.get('mode')).toBe('primary')
  expect((last.get('view') as GameView).account.server).toBe(URL_A)
  expect(typeof data.get(`promptfall:token:${URL_A}`)).toBe('string')
})

test('a banned account is refused on bootstrap and the plugin pauses with the reason', async ($, on) => {
  const time = mock.clock(on, { now: 1_000_000 })
  const { data } = store(on, { 'promptfall:server': URL_A })
  const last = states(on)
  engineBottom(on)
  on('tool.call', () => ({ result: 'ok', text: 'ok' }))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  const net = remote(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  expect(last.get('mode')).toBe('primary')
  const token = data.get(`promptfall:token:${URL_A}`) as string
  const info = await net.ledger.account({ deviceToken: token })
  if (!('account' in info)) throw new Error(info.reason)
  await net.ledger.host.ban(info.account.accountId, 'spam in chat')
  const message = 'Promptfall: this account is banned: spam in chat'

  // Mid-session: the next batch is refused, and play pauses with the reason.
  await $.turn.start({ text: 'go', turnId: 't1' })
  for (let i = 0; i < 3; i++) await $.tool.call({ tool: 'Bash', command: 'ls' })
  await time.advance(16_000)
  expect(last.get('mode')).toBe('paused')
  expect(last.get('notice')).toBe(message)
  const batches = () => net.requests.filter((r) => r.path === '/v1/batches').length
  const sent = batches()
  for (let i = 0; i < 3; i++) await $.tool.call({ tool: 'Bash', command: 'ls' })
  await time.advance(60_000)
  expect(batches()).toBe(sent)

  // A new session asks once, is refused, shows the reason and does not ask again.
  await $.session.end({ reason: 'prompt_input_exit', sessionId: 's1', resume: { id: 's1' } })
  const boots = () => net.requests.filter((r) => r.path === '/v1/bootstrap').length
  const before = boots()
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  expect(boots()).toBe(before + 1)
  expect(last.get('mode')).toBe('paused')
  expect(last.get('notice')).toBe(message)
  await time.advance(60 * 60_000)
  expect(boots()).toBe(before + 1)
  expect(last.get('notice')).toBe(message)
  // The token stays: the ban is the account's, and this machine keeps it.
  expect(data.get(`promptfall:token:${URL_A}`)).toBe(token)
})

test('deleting the account on a remote server starts a fresh one there, and only on its word', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  const { data } = store(on, { 'promptfall:server': URL_A })
  const last = states(on)
  engineBottom(on)
  const net = remote(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const token = data.get(`promptfall:token:${URL_A}`) as string
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-account' })

  // Unconfirmed: the server did not answer, so nothing on this machine is reset.
  await ui.press({ key: 'row:delete' })
  net.down = true
  await ui.press({ key: 'yes' })
  expect(await paneText(ui)).toContain(`Refused: ${NOT_DELETED}`)
  expect(data.get(`promptfall:token:${URL_A}`)).toBe(token)
  net.down = false
  expect(await net.ledger.knowsToken(token)).toBe(true)

  await ui.press({ key: 'row:delete' })
  await ui.press({ key: 'yes' })
  const deletes = net.requests.filter((r) => r.method === 'DELETE' && r.path === '/v1/account')
  expect(deletes.map((r) => r.origin)).toEqual([URL_A])
  expect(await net.ledger.knowsToken(token)).toBe(false)
  // A fresh account on the same server, and the message window says why.
  const fresh = data.get(`promptfall:token:${URL_A}`)
  expect(typeof fresh).toBe('string')
  expect(fresh).not.toBe(token)
  expect(await net.ledger.knowsToken(fresh as string)).toBe(true)
  expect(data.get('promptfall:server')).toBe(URL_A)
  expect((last.get('view') as GameView).account.server).toBe(URL_A)
  expect(last.get('mode')).toBe('primary')
  expect(last.get('notice')).toBe(DELETED_NOTICE)
  await ui.unmount()
})

test('a delete whose re-bootstrap is refused shows the refusal and says the delete happened', async ($, on) => {
  const time = mock.clock(on, { now: 1_000_000 })
  const { data } = store(on, { 'promptfall:server': URL_A })
  const seen: { key: string; value: unknown }[] = []
  const last = states(on, seen)
  engineBottom(on)
  const net = remote(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const token = data.get(`promptfall:token:${URL_A}`) as string
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-account' })
  await ui.press({ key: 'row:delete' })
  // The address has spent its mints this hour: the fresh account is refused.
  const message = 'Too many new accounts from this address. Promptfall will try again later.'
  net.refusal = { refusal: 'rate_limited', message }
  const boots = () => net.requests.filter((r) => r.path === '/v1/bootstrap').length
  const before = boots()
  await ui.press({ key: 'yes' })
  expect(await net.ledger.knowsToken(token)).toBe(false)
  expect(data.has(`promptfall:token:${URL_A}`)).toBe(false)
  const refused = `Promptfall: your account was deleted. ${message}`
  expect(last.get('mode')).toBe('paused')
  expect(last.get('notice')).toBe(refused)
  // Past the notice's 20 s and the retry's re-pause at 5 min, the message is the same.
  await time.advance(30_000)
  expect(last.get('notice')).toBe(refused)
  await time.advance(5 * 60_000)
  expect(boots()).toBe(before + 2)
  expect(last.get('mode')).toBe('paused')
  expect(last.get('notice')).toBe(refused)
  expect(seen.filter((w) => w.key === 'notice').map((w) => w.value)).not.toContain(DELETED_NOTICE)
  await ui.unmount()
})

test('a banned player deletes from the Account tab and a fresh account starts', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  const net = remote(on)
  const boot = await net.ledger.bootstrap({ clientVersion: CLIENT_VERSION, deviceToken: null })
  const token = boot.deviceToken
  await net.ledger.host.ban(boot.account.accountId, 'spam in chat')
  const { data } = store(on, { 'promptfall:server': URL_A, [`promptfall:token:${URL_A}`]: token })
  const last = states(on)
  engineBottom(on)
  // The bootstrap is refused: the engine never starts, and the ban's reason shows.
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  expect(last.get('mode')).toBe('paused')
  expect(last.get('notice')).toBe('Promptfall: this account is banned: spam in chat')
  expect(last.get('view') ?? null).toBeNull()
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...PANE })

  // The other tabs are refused as before; Account shows Delete under Reset.
  await ui.press({ key: 'tab-market' })
  expect(await paneText(ui)).toContain('Promptfall has not started in this session.')
  await ui.press({ key: 'tab-account' })
  expect(await ui.find({ key: 'row:reset' })).toBeTruthy()
  expect(await ui.find({ key: 'row:delete' })).toBeTruthy()

  // Unconfirmed: nothing on this machine is reset.
  await ui.press({ key: 'row:delete' })
  net.down = true
  await ui.press({ key: 'yes' })
  expect(await paneText(ui)).toContain(`Refused: ${NOT_DELETED}`)
  expect(data.get(`promptfall:token:${URL_A}`)).toBe(token)
  expect(last.get('notice')).toBe('Promptfall: this account is banned: spam in chat')
  net.down = false

  await ui.press({ key: 'row:delete' })
  await ui.press({ key: 'yes' })
  const deletes = net.requests.filter((r) => r.method === 'DELETE' && r.path === '/v1/account')
  expect(deletes.map((r) => r.origin)).toEqual([URL_A])
  expect(await net.ledger.knowsToken(token)).toBe(false)
  const fresh = data.get(`promptfall:token:${URL_A}`)
  expect(typeof fresh).toBe('string')
  expect(fresh).not.toBe(token)
  expect(await net.ledger.knowsToken(fresh as string)).toBe(true)
  expect(last.get('mode')).toBe('primary')
  expect((last.get('view') as GameView).account.server).toBe(URL_A)
  expect(last.get('notice')).toBe(DELETED_NOTICE)
  await ui.unmount()
})

test('a player banned mid-session deletes from the read-only Account tab', async ($, on) => {
  const time = mock.clock(on, { now: 1_000_000 })
  const { data } = store(on, { 'promptfall:server': URL_A })
  const last = states(on)
  engineBottom(on)
  on('tool.call', () => ({ result: 'ok', text: 'ok' }))
  const net = remote(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const token = data.get(`promptfall:token:${URL_A}`) as string
  const info = await net.ledger.account({ deviceToken: token })
  if (!('account' in info)) throw new Error(info.reason)
  await net.ledger.host.ban(info.account.accountId, 'spam in chat')
  await $.turn.start({ text: 'go', turnId: 't1' })
  for (let i = 0; i < 3; i++) await $.tool.call({ tool: 'Bash', command: 'ls' })
  await time.advance(16_000)
  expect(last.get('mode')).toBe('paused')
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-account' })
  expect(await ui.find({ key: 'row:link' })).toBeFalsy()
  await ui.press({ key: 'row:delete' })
  net.down = true
  await ui.press({ key: 'yes' })
  expect(await paneText(ui)).toContain(`Refused: ${NOT_DELETED}`)
  expect(data.get(`promptfall:token:${URL_A}`)).toBe(token)
  net.down = false
  await ui.press({ key: 'row:delete' })
  await ui.press({ key: 'yes' })
  expect(await net.ledger.knowsToken(token)).toBe(false)
  const fresh = data.get(`promptfall:token:${URL_A}`)
  expect(typeof fresh).toBe('string')
  expect(fresh).not.toBe(token)
  expect(last.get('mode')).toBe('primary')
  expect(last.get('notice')).toBe(DELETED_NOTICE)
  await ui.unmount()
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
  expect(data.get('promptfall:server')).toBe('local')
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
  await ui.press({ key: 'row:link' })
  expect(await paneText(ui)).toMatch(/Enter [0-9A-Z]{8} at/)
  expect((await ui.find({ type: 'Link' }))?.props.href).toMatch(/^https?:\/\//)
  await time.advance(5_000)
  expect((last.get('view') as GameView).account.linked).toBe('player')
  expect(await paneText(ui)).toMatch(/Linked as player/)
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
  expect(await paneText(ui)).toMatch(/Server in-process/)
  await ui.press({ key: 'row:reset' })
  // Reset asks first: a Yes/No (its question sits under the paused notice, the read-only rule).
  expect(await ui.find({ key: 'no' })).toBeDefined()
  await ui.press({ key: 'yes' })
  const view = last.get('view') as GameView
  expect(view).toBeTruthy()
  expect(view.accountId).not.toBe('acct-1')
  expect(last.get('mode')).toBe('primary')
  // A fresh account: the welcome replaces the old-version notice.
  expect(last.get('notice')).toMatch(
    /^Sound on; \/promptfall sound off silences it\. Welcome to Promptfall\./,
  )
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

test("a demoted primary's notice clears; the re-promoted engine's own notice shows", async ($, on) => {
  const time = mock.clock(on, { now: 1_000_000 })
  const { data } = store(on)
  const last = states(on)
  engineBottom(on)
  on('tool.call', () => ({ result: 'ok', text: 'ok' }))
  const net = remote(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.command.run({ ...RUN, command: 'promptfall', args: `server ${URL_A}` })
  for (let i = 0; i < 3; i++) await $.tool.call({ tool: 'Bash', command: 'ls' })
  net.down = true
  await time.advance(16_000)
  expect(last.get('notice')).toBe(RETRYING_NOTICE)
  // Another session takes the lease: the discarded engine's banner goes with it.
  data.set(LEASE, { owner: 'someone-else', until: 9_999_999_999_999 })
  await time.advance(10_000)
  expect(last.get('mode')).toBe('secondary')
  expect(last.get('notice')).toBeNull()
  // The lease comes back while the server is still down: the new engine raises its own.
  data.delete(LEASE)
  await time.advance(10_000)
  expect(last.get('mode')).toBe('primary')
  expect(last.get('notice')).toBe(RETRYING_NOTICE)
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
  const time = mock.clock(on, { now: 1_000_000 })
  const { data } = store(on, { [LEASE]: { owner: 'other', until: 9_999_999_999_999 } })
  const last = states(on)
  engineBottom(on)
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  remote(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  expect(last.get('mode')).toBe('secondary')
  data.set('promptfall:server', URL_A)
  await $.prompt.submit({ text: 'hi', wait: false, origin: { kind: 'composer' } })
  await time.settle()
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

test('an unknown token resets the primary and mints, and leaves a secondary waiting', async ($, on) => {
  const time = mock.clock(on, { now: 1_000_000 })
  const key = `promptfall:token:${URL_A}`
  const { data } = store(on, {
    'promptfall:server': URL_A,
    [key]: 'stale',
    [LEASE]: { owner: 'other', until: 1_025_000 },
  })
  const last = states(on)
  engineBottom(on)
  const net = remote(on)
  const boots = () => net.requests.filter((r) => r.path === '/v1/bootstrap').length
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  // The secondary is refused `unknown` once and waits: it mints nothing and writes no token.
  await time.advance(20_000)
  expect(last.get('mode')).toBe('secondary')
  expect(boots()).toBe(1)
  expect(net.mints).toBe(0)
  expect(data.get(key)).toBe('stale')
  // The other session's lease runs out: this one is primary, clears the stale token and mints.
  await time.advance(10_000)
  expect(last.get('mode')).toBe('primary')
  expect(net.mints).toBe(1)
  const fresh = data.get(key)
  expect(typeof fresh).toBe('string')
  expect(fresh).not.toBe('stale')
  expect(await net.ledger.knowsToken(fresh as string)).toBe(true)
  expect((last.get('view') as GameView).account.server).toBe(URL_A)
})

test('an unknown refusal landing after another session minted restarts with its token and mints nothing', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  const key = `promptfall:token:${URL_A}`
  const { data } = store(on, { 'promptfall:server': URL_A, [key]: 'stale' })
  const last = states(on)
  engineBottom(on)
  const net = remote(on)
  let healed: string | null = null
  net.beforeBoot = async (token) => {
    if (token !== 'stale' || healed !== null) return
    // Another session took the lease, was refused the same stale token, and minted.
    const boot = await net.ledger.bootstrap({ clientVersion: '0.1.0', deviceToken: null })
    healed = boot.deviceToken
    data.set(key, healed)
  }
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  expect(healed).not.toBeNull()
  expect(data.get(key)).toBe(healed)
  expect(net.mints).toBe(0)
  expect(net.requests.filter((r) => r.path === '/v1/bootstrap')).toHaveLength(2)
  expect(last.get('mode')).toBe('primary')
  const info = await net.ledger.account({ deviceToken: healed ?? '' })
  if (!('account' in info)) throw new Error(info.reason)
  expect((last.get('view') as GameView).accountId).toBe(info.account.accountId)
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

test('a fresh install resolves to the public server and local is an explicit setting', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  const { data } = store(on, { 'promptfall:server': undefined })
  const last = states(on)
  engineBottom(on)
  const net = remote(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  expect(data.has('promptfall:server')).toBe(false)
  expect(last.get('server')).toBe(PUBLIC_SERVER)
  expect((last.get('view') as GameView).account.server).toBe(PUBLIC_SERVER)
  expect(net.requests.map((r) => r.origin)).toContain(PUBLIC_SERVER)
  expect(typeof data.get(`promptfall:token:${PUBLIC_SERVER}`)).toBe('string')
  const report = async () =>
    ((await $.command.run({ ...RUN, command: 'promptfall', args: 'server' })) as { text: string })
      .text
  expect(await report()).toBe(`Promptfall plays on the public server, ${PUBLIC_SERVER}`)

  await $.command.run({ ...RUN, command: 'promptfall', args: 'server local' })
  expect(data.get('promptfall:server')).toBe('local')
  expect(last.get('server')).toBeNull()
  expect((last.get('view') as GameView).account.server).toBe('in-process')
  expect(await report()).toBe('Promptfall plays in-process (server local)')

  await $.command.run({ ...RUN, command: 'promptfall', args: `server ${URL_A}` })
  expect(data.get('promptfall:server')).toBe(URL_A)
  expect((last.get('view') as GameView).account.server).toBe(URL_A)
  expect(await report()).toBe(`Promptfall plays on ${URL_A}`)
})

test('a stored local setting plays in-process and survives a reset', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  const { data } = store(on, { 'promptfall:server': 'local' })
  const last = states(on)
  engineBottom(on)
  const net = remote(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  expect((last.get('view') as GameView).account.server).toBe('in-process')
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-account' })
  await ui.press({ key: 'row:reset' })
  await ui.press({ key: 'yes' })
  await ui.unmount()
  expect(data.get('promptfall:server')).toBe('local')
  expect((last.get('view') as GameView).account.server).toBe('in-process')
  expect(net.calls).toBe(0)
})

test('the sandbox plays in-process on a fresh install and never calls the public server', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  store(on, { 'promptfall:server': undefined })
  const last = states(on)
  engineBottom(on, [], { PROMPTFALL_SANDBOX: '1' })
  const net = remote(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  expect(last.get('server')).toBeNull()
  expect((last.get('view') as GameView).account.server).toBe('in-process')
  const r = await $.command.run({ ...RUN, command: 'promptfall', args: 'server' })
  expect(r).toMatchObject({ text: SANDBOX_PINS_SERVER })
  expect(net.calls).toBe(0)
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
  await ui.press({ key: 'row:link' })
  expect(await paneText(ui)).toMatch(/Enter [0-9A-Z]{8} at/)
  await $.command.run({ ...RUN, command: 'promptfall', args: `server ${URL_A}` })
  expect((last.get('dialog') as { link: unknown }).link).toBeNull()
  await ui.unmount()
})

test('a resize mid link flow keeps the device code, the poll and the open dialog', async ($, on) => {
  const time = mock.clock(on, { now: 1_000_000 })
  store(on)
  const last = states(on)
  engineBottom(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  // The dialog docked at 140 columns, as `/promptfall account` opens it in the log.
  const dock = { ...PANE.props, bodyColumns: 62, placement: 'dock' as const }
  const band = (bodyColumns: number) => ({ ...IN_PLAY, props: { ...IN_PLAY.props, bodyColumns } })
  let ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...PANE, props: dock })
  await ui.press({ key: 'tab-account' })
  await ui.press({ key: 'row:link' })
  // The Reset row's Yes/No: a command window open over the list, the cursor on its row.
  await ui.press({ key: 'row:reset' })
  const open = last.get('dialog') as { link: { code: string } | null; menu: unknown }
  expect(open.link?.code).toMatch(/^[0-9A-Z]{8}$/)
  expect(open.menu).toMatchObject({ kind: 'confirm', action: 'reset' })
  // The log's resize: the pane and the band drawn again at each width, and no session event.
  for (const [pane, columns] of [
    [{ ...PANE.props, bodyColumns: 56 }, 60],
    [dock, 72],
    [{ ...PANE.props, bodyColumns: 96 }, 100],
    [dock, 72],
  ] as const) {
    await ui.unmount()
    const above = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...band(columns) })
    await above.unmount()
    ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...PANE, props: pane })
    // The Yes/No holds the window's state rows: it shows over the code, on the open tab.
    expect(await paneText(ui)).toMatch(/▶Account[\s\S]*Reset this machine's data\?/)
  }
  expect(last.get('dialog')).toEqual(open)
  expect(last.get('dialogTab')).toBe('account')
  await ui.press({ key: 'no' })
  expect(await paneText(ui)).toMatch(new RegExp(`Enter ${open.link?.code} at`))
  // The poll carried on through it: the in-process ledger approves at its first, 5 s in.
  await time.advance(5_000)
  expect((last.get('view') as GameView).account.linked).toBe('player')
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
  await ui.press({ key: 'row:link' })
  expect(await paneText(ui)).not.toMatch(/Enter [0-9A-Z]{8} at/)
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
  // The read-only line is the message window's first line (decoded Raster cells on a terminal).
  expect(await paneText(ui)).toMatch(/Promptfall: server unreachable/)
  expect(await paneText(ui)).not.toMatch(/not playing in this session/)
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
    hunt: null,
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
    linkApprover: approveAs('remote-player'),
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

test('the boss appearing toasts once for 8 s and going down once for 4 s', async ($, on) => {
  const time = mock.clock(on, { now: 1_000_000 })
  store(on)
  states(on)
  const raised: Raised[] = []
  engineBottom(on, [], {}, (toast) => raised.push(toast))
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
  const world = raised.filter((t) => t.text.startsWith('World boss '))
  expect(world).toEqual([
    { text: 'World boss The Promptwyrm has appeared', timeoutMs: 8000 },
    { text: 'World boss The Promptwyrm is down', timeoutMs: 4000 },
  ])
})

test("a reward's loot log line names the item", () => {
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
    linkApprover: approveAs('remote-player'),
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
  const transitions: unknown[] = []
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
    transition: (t) => transitions.push(t),
  })
  await poller.start()
  expect(transitions).toEqual([])
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
  const { time, last, data } = probing(on, {
    deny: `${PROBE_ALT_DENY} (env: terminal=Apple_Terminal, not asked yet, no answer)`,
  })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...PARTY_BAND })
  await time.advance(PROBE_DELAY_MS)
  expect(last.get('renderer')).toBe('raster')
  expect(data.get('promptfall:settings')).toMatchObject({ renderer: 'auto', probed: 'raster' })
  await ui.unmount()
})

test('any other deny leaves the renderer unknown, and a later render probes again', async ($, on) => {
  const { time, last, blits, data } = probing(on, {
    deny: 'no Image of its own is mounted under key "probe" in band-probe',
  })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...PARTY_BAND })
  await time.advance(PROBE_DELAY_MS)
  expect(last.get('renderer') ?? 'unknown').toBe('unknown')
  // Nothing settled, nothing recorded.
  expect(
    (data.get('promptfall:settings') as { probed?: unknown } | undefined)?.probed ?? null,
  ).toBe(null)
  await ui.unmount()
  const again = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...PARTY_BAND })
  await time.advance(PROBE_DELAY_MS)
  expect(blits.filter((b) => b.key === 'probe')).toHaveLength(2)
  await again.unmount()
})

test('a pane drawn while the renderer is unknown probes too, and a taken blit settles on image', async ($, on) => {
  // A docked pane collapses the band, which then never probes (UI PR 3).
  const { time, last, blits, data } = probing(on, {})
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...PANE })
  const probe = await ui.find({ key: 'probe' })
  expect([probe?.type, probe?.props.columns, probe?.props.rows]).toEqual(['Image', 1, 1])
  await time.advance(PROBE_DELAY_MS)
  expect(blits.filter((b) => b.key === 'probe').map((b) => b.requestId)).toEqual(['promptfall'])
  expect(last.get('renderer')).toBe('image')
  expect(data.get('promptfall:settings')).toMatchObject({ renderer: 'auto', probed: 'image' })
  await ui.unmount()
})

test('a forced renderer sends no probe', async ($, on) => {
  const { time, last, blits } = probing(
    on,
    {},
    {
      'promptfall:settings': { sound: 'off', motion: 'full', renderer: 'raster' },
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
      'promptfall:settings': { sound: 'off', motion: 'still', renderer: 'raster' },
    },
  )
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...PARTY_BAND })
  for (let i = 0; i < 20 && (last.get('view') as GameView).enemies.length === 0; i++) {
    await time.advance(5_000)
  }
  // Gauges start empty: the first ticks with an enemy carry no action. With motion still only
  // effects wake the loop, so a blit right after a tick means that tick's effects woke it.
  let next = time.now() + 5_000
  let woke = false
  for (let i = 0; i < 12 && !woke; i++, next += 5_000) {
    await time.advance(next + EVENT_FRAME_MS - time.now())
    const tick = next
    // The Raster band (#61): the stage loop blits the one band picture, 120 × 20.
    const key = bandKey({ columns: 120, rows: 20 })
    woke = blits.some((b) => b.key === key && b.at >= tick && b.at <= tick + EVENT_FRAME_MS)
  }
  expect(woke).toBe(true)
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
        enemies: [
          { id: 'e-test', def: 'goblin_scout', kind: 'wave', hp: 1, maxHp: 60, enraged: false },
        ],
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

const SOUND_ON = { 'promptfall:settings': { sound: 'quiet', motion: 'full', renderer: 'auto' } }
const settingsAt = (sound: unknown) => ({
  'promptfall:settings': { sound, motion: 'full', renderer: 'auto' },
})

/** How long a real clip takes to play: a play answered before SKIPPED_PLAY_MS was skipped. */
const CLIP_MS = 400

/**
 * How the test's engine answers a play: after the clip (`late`), at once as a terminal with no
 * player does (`at once`), or with a rejection naming the cause (`reject`).
 */
type PlayAnswer = 'late' | 'at once' | 'reject'

/** Answers `audio.play` as `answer` says, the clock being `time`'s. */
async function answerPlay(time: { sleep: (ms: number) => Promise<void> }, answer: PlayAnswer) {
  if (answer === 'reject') throw new Error('no audio player on linux; not played')
  if (answer === 'late') await time.sleep(CLIP_MS)
  return { value: undefined }
}

function sounding(on: On, seed: Record<string, unknown>, answer: PlayAnswer = 'late') {
  const time = mock.clock(on, { now: 1_000_000 })
  const { data } = store(on, seed)
  const last = states(on)
  const raised: Raised[] = []
  /** Toasts and cues in the order the host received them. */
  const order: string[] = []
  engineBottom(on, [], {}, (toast) => {
    raised.push(toast)
    order.push(`toast ${toast.text}`)
  })
  const plays: { asset: string; gain: number | undefined }[] = []
  on('audio.play', (_$, e) => {
    plays.push({ asset: e.clip.asset ?? '', gain: e.gain })
    order.push(`cue ${e.clip.asset ?? ''}`)
    return answerPlay(time, answer)
  })
  return { time, data, last, plays, raised, order }
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
    expect(plays).toEqual([{ asset, gain: 0.25 }])
  })
}

for (const [sound, gains] of [
  ['quiet', [0.25]],
  ['normal', [0.5]],
  ['loud', [1]],
  ['off', []],
] as const) {
  test(`a rare drop at ${sound} plays the drop cue at ${gains[0] ?? 'no'} gain`, async ($, on) => {
    const { time, plays } = sounding(on, { ...record(dropping('rare')), ...settingsAt(sound) })
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
    await time.advance(5_000)
    expect(plays).toEqual(gains.map((gain) => ({ asset: 'cues/drop.wav', gain })))
  })
}

const SOUND_NEWS = 'Sound is now on by default. /promptfall sound off silences it.'

for (const stored of [true, false]) {
  test(`a stored sound ${stored} reads as quiet and toasts the news once`, async ($, on) => {
    const { time, plays, raised, data } = sounding(on, {
      ...record(dropping('rare')),
      ...settingsAt(stored),
    })
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
    await time.advance(5_000)
    expect(plays).toEqual([{ asset: 'cues/drop.wav', gain: 0.25 }])
    expect(raised.filter((t) => t.text === SOUND_NEWS)).toEqual([
      { text: SOUND_NEWS, timeoutMs: 8000 },
    ])
    expect((data.get('promptfall:settings') as { sound: unknown }).sound).toBe('quiet')
    // The next session reads a step, not a boolean: no second toast.
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
    await time.advance(5_000)
    expect(raised.filter((t) => t.text === SOUND_NEWS)).toHaveLength(1)
  })
}

test('a fresh machine is quiet with no news toast', async ($, on) => {
  const { time, plays, raised, data } = sounding(on, record(dropping('rare')))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await time.advance(5_000)
  expect(plays).toEqual([{ asset: 'cues/drop.wav', gain: 0.25 }])
  expect(raised.filter((t) => t.text === SOUND_NEWS)).toEqual([])
  expect(data.has('promptfall:settings')).toBe(false)
})

test('a secondary reading a stored boolean raises no news toast', async ($, on) => {
  const { time, raised, last } = sounding(on, {
    ...record(dropping('rare')),
    ...settingsAt(true),
    'promptfall:lease': { owner: 'someone-else', until: 9_999_999_999_999 },
  })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  expect(last.get('mode')).toBe('secondary')
  await time.advance(5_000)
  expect(raised.filter((t) => t.text === SOUND_NEWS)).toEqual([])
})

test('the news a secondary rewrote waits for the next primary, which toasts it once', async ($, on) => {
  const { time, raised, last, data } = sounding(on, {
    ...record(dropping('rare')),
    ...settingsAt(true),
    'promptfall:lease': { owner: 'someone-else', until: 9_999_999_999_999 },
  })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  expect(last.get('mode')).toBe('secondary')
  expect((data.get('promptfall:settings') as { sound: unknown }).sound).toBe('quiet')
  // The other session closes and its lease goes: a fresh session starts primary on a step.
  data.delete('promptfall:lease')
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await time.advance(5_000)
  expect(last.get('mode')).toBe('primary')
  expect(raised.filter((t) => t.text === SOUND_NEWS)).toEqual([
    { text: SOUND_NEWS, timeoutMs: 8000 },
  ])
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await time.advance(5_000)
  expect(raised.filter((t) => t.text === SOUND_NEWS)).toHaveLength(1)
})

/**
 * A state whose next tick kills two 1 hp Goblin Scouts, each dropping a rare item, and levels
 * the party's lead: one burst with two rare drops and one level-up.
 */
function twoRareDropsAndALevel(): GameState {
  for (let seed = 1; seed < 50_000; seed++) {
    const s0 = createInitialState(seed)
    const lead = s0.party[0]
    const s: GameState = {
      ...s0,
      roster: s0.roster.map((h) =>
        h.id === lead ? { ...h, xp: content.xpToNext(h.level) - 1 } : h,
      ),
      encounter: {
        enemies: [
          { id: 'e-a', def: 'goblin_scout', kind: 'wave', hp: 1, maxHp: 60, enraged: false },
          { id: 'e-b', def: 'goblin_scout', kind: 'wave', hp: 1, maxHp: 60, enraged: false },
        ],
        queue: [],
        waveSize: 3,
        spawnedInWave: 3,
      },
      battle: { gauges: s0.party.map((id) => ({ id, g: GAUGE_FULL })), queue: [], busy: 0 },
    }
    const effects = step(s, { t: 'tick' }).effects
    const drops = effects.flatMap((e) => (e.k === 'drop' ? [e.item.rarity] : []))
    if (
      drops.filter((r) => r === 'rare').length === 2 &&
      !drops.some((r) => r === 'epic' || r === 'legendary') &&
      effects.filter((e) => e.k === 'level_up').length === 1
    ) {
      return s
    }
  }
  throw new Error('no burst with two rare drops and a level-up')
}

test('a level-up toasts its hero by name for 4 s at the kill; two rare drops are two toasts, each at its reveal', async ($, on) => {
  const state = twoRareDropsAndALevel()
  const { time, last, raised, plays, blits } = staging(on, { ...record(state), ...STAGED })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...PARTY_BAND })
  const shows = revealsOf(state, time.now(), time.now() + 5_000)
  await time.advance(5_000)
  const kill = time.now()
  const lead = (last.get('view') as GameView).roster.find((h) => h.id === state.party[0])
  // The roster's name carries the epithet: "Aldric the Steadfast", never "Aldric".
  expect(lead?.name.split(' ').length).toBeGreaterThan(1)
  expect(raised.filter((t) => t.text.includes(' reached level '))).toEqual([
    { text: `${lead?.name} reached level ${lead?.level ?? 0}`, timeoutMs: 4000, at: kill },
  ])
  expect(plays.filter((p) => p.asset === 'cues/level_up.wav').map((p) => p.at)).toEqual([kill])
  await time.advance(Math.max(...shows.map((s) => s.at)) - time.now() + 2 * EVENT_FRAME_MS)
  const drops = raised.filter((t) => t.text.startsWith('Rare drop: '))
  expect(drops).toHaveLength(2)
  for (const show of shows) {
    const toast = drops.find((t) => t.text === `Rare drop: ${show.name}`)
    expect(toast?.timeoutMs).toBe(4000)
    expect(toast?.at ?? 0).toBeGreaterThanOrEqual(show.at)
    expect(toast?.at ?? 0).toBeLessThanOrEqual(firstFrameFrom(blits, show.at))
  }
  // One drop cue per drain that raised a drop toast: once when both land together.
  const drains = new Set(drops.map((t) => t.at))
  expect(plays.filter((p) => p.asset === 'cues/drop.wav').map((p) => p.at)).toEqual([...drains])
  expect(raised.some((t) => /^\d+ rare drops/.test(t.text))).toBe(false)
  await ui.unmount()
})

test('a legendary drop toasts for 8 s and plays the legendary cue once', async ($, on) => {
  const { time, plays, raised } = sounding(on, { ...record(dropping('legendary')), ...SOUND_ON })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await time.advance(5_000)
  const legendary = raised.filter((t) => t.text.startsWith('Legendary drop: '))
  expect(legendary.map((t) => t.timeoutMs)).toEqual([8000])
  expect(plays.map((p) => p.asset)).toEqual(['cues/legendary.wav'])
})

// ---------------------------------------------------------------------------
// Held toasts: a drop's toast and cue land at its reveal's show time

/** The band forced to Raster with sound on, so the band picture mounts the frame loop at once. */
const STAGED = { 'promptfall:settings': { sound: 'quiet', motion: 'full', renderer: 'raster' } }

/** `sounding` with the band's blits taken and every toast and cue stamped with its time. */
function staging(on: On, seed: Record<string, unknown>, env: Record<string, string> = {}) {
  const time = mock.clock(on, { now: 1_000_000 })
  const { data } = store(on, seed)
  const last = states(on)
  const raised: (Raised & { at: number })[] = []
  engineBottom(on, [], env, (toast) => raised.push({ ...toast, at: time.now() }))
  const plays: { asset: string; at: number }[] = []
  on('audio.play', (_$, e) => {
    plays.push({ asset: e.clip.asset ?? '', at: time.now() })
    return answerPlay(time, 'late')
  })
  const blits: number[] = []
  on('ui.blit', () => {
    blits.push(time.now())
    return { value: {} }
  })
  on('ui.invalidate', (_$, e, next) => next(e))
  on('session.attach', (_$, e) => ({ clientId: e.clientId }))
  return { time, data, last, raised, plays, blits }
}

const viewOf = (state: GameState) =>
  toGameView(state, 'acct-1', false, toAccountView(null, null, 'in-process', 0))

/**
 * The show time of each item the next tick of `state` drops, from a timeline driven the way the
 * registration drives the session's: drawn at `drawnAt`, the tick's effects at `tickAt`.
 */
function revealsOf(
  state: GameState,
  drawnAt: number,
  tickAt: number,
): { name: string; at: number }[] {
  const timeline = new StageTimeline()
  timeline.observe(viewOf(state), drawnAt)
  const { state: next, effects } = step(state, { t: 'tick' })
  timeline.admit(viewOf(next), tickAt)
  timeline.onEffects(effects, tickAt, 5_000, tickAt)
  return effects.flatMap((e: Effect) => {
    const at = e.k === 'drop' ? timeline.showAt(e.item.id) : null
    if (e.k !== 'drop' || at === null) return []
    const name = viewOf(next).inventory.find((i) => i.id === e.item.id)?.name ?? ''
    return [{ name, at }]
  })
}

/** The first frame blitted at or after `at`; infinity when none was. */
const firstFrameFrom = (blits: number[], at: number) =>
  blits.find((b) => b >= at) ?? Number.POSITIVE_INFINITY

/**
 * One kill dropping an item of `rarity`, with the band drawn by a frame loop: the toast and its cue
 * are raised on the first frame at or after the reveal's show time, and not before.
 */
async function heldToTheReveal(
  $: Parameters<TestBody>[0],
  on: On,
  rarity: 'legendary' | 'rare',
  motion: 'full' | 'still' = 'full',
) {
  const state = dropping(rarity)
  const { time, raised, plays, blits } = staging(on, {
    ...record(state),
    'promptfall:settings': { ...STAGED['promptfall:settings'], motion },
  })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...PARTY_BAND })
  const [show] = revealsOf(state, time.now(), time.now() + 5_000)
  if (!show) throw new Error('the tick drops no item with a chest')
  await time.advance(5_000)
  const kill = time.now()
  const word = rarity === 'legendary' ? 'Legendary drop: ' : 'Rare drop: '
  const drops = () => raised.filter((t) => t.text.startsWith(word))
  // At the kill the monster is still standing: no toast, no cue.
  expect(drops()).toEqual([])
  expect(plays).toEqual([])
  expect(show.at).toBeGreaterThan(kill + 1000)
  await time.advance(show.at - time.now() + 3 * EVENT_FRAME_MS)
  const frame = firstFrameFrom(blits, show.at)
  const before = blits.filter((b) => b < show.at).at(-1) ?? 0
  expect(before).toBeGreaterThan(kill)
  expect(drops()).toHaveLength(1)
  const at = drops()[0]?.at ?? 0
  // The last frame before the show time raised nothing; the first frame at or after it did.
  expect(at).toBeGreaterThan(before)
  expect(at).toBeGreaterThanOrEqual(show.at)
  expect(at).toBeLessThanOrEqual(frame)
  expect(frame - show.at).toBeLessThanOrEqual(EVENT_FRAME_MS)
  // Its lifetime starts there, with its row's tier.
  expect(drops()[0]?.timeoutMs).toBe(rarity === 'legendary' ? 8000 : 4000)
  const cue = rarity === 'legendary' ? 'cues/legendary.wav' : 'cues/drop.wav'
  expect(plays).toEqual([{ asset: cue, at }])
  await ui.unmount()
}

test("a legendary drop's toast and cue land at the reveal's show time, not at the kill", async ($, on) => {
  await heldToTheReveal($, on, 'legendary')
})

test("a rare drop's toast and cue land at its reveal's show time too", async ($, on) => {
  await heldToTheReveal($, on, 'rare')
})

test('with motion still, a held toast lands at the same show time', async ($, on) => {
  await heldToTheReveal($, on, 'legendary', 'still')
})

/**
 * A state whose next tick spawns a Goblin Scout and kills it before any view holds it, dropping a
 * rare item: the stage never stood the monster up, so its chest falls on the empty ground. The
 * Scout is its wave's one enemy, so the kill clears the wave.
 */
function spawnedAndKilled(): GameState {
  for (let seed = 1; seed < 5_000; seed++) {
    const s0 = createInitialState(seed)
    const s: GameState = {
      ...s0,
      roster: s0.roster.map((h) => ({ ...h, level: 60 })),
      encounter: {
        enemies: [],
        queue: [{ def: 'goblin_scout', kind: 'wave' }],
        waveSize: 1,
        spawnedInWave: 0,
      },
      battle: { gauges: s0.party.map((id) => ({ id, g: GAUGE_FULL })), queue: [], busy: 0 },
    }
    const { state, effects } = step(s, { t: 'tick' })
    const drop = effects.find((e) => e.k === 'drop')
    if (
      drop?.k === 'drop' &&
      drop.item.rarity === 'rare' &&
      !state.encounter?.enemies.length &&
      !effects.some((e) => e.k === 'level_up')
    ) {
      return s
    }
  }
  throw new Error('no tick that spawns and kills a monster with a rare drop')
}

test('a drop whose monster the stage never drew falls on the ground, its toast at the reveal', async ($, on) => {
  const state = spawnedAndKilled()
  const { time, raised, plays, blits } = staging(on, { ...record(state), ...STAGED })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...PARTY_BAND })
  const [show] = revealsOf(state, time.now(), time.now() + 5_000)
  if (!show) throw new Error('the tick drops no item with a chest')
  await time.advance(5_000)
  const kill = time.now()
  // The chest falls on the front slot's ground as the tick arrives.
  expect(show.at).toBe(kill + CHEST_SHOW_MS)
  const drops = () => raised.filter((t) => t.text.startsWith('Rare drop: '))
  expect(drops()).toEqual([])
  expect(plays).toEqual([])
  await time.advance(show.at - time.now() + 3 * EVENT_FRAME_MS)
  const frame = firstFrameFrom(blits, show.at)
  expect(drops()).toHaveLength(1)
  const at = drops()[0]?.at ?? 0
  expect(at).toBeGreaterThanOrEqual(show.at)
  expect(at).toBeLessThanOrEqual(frame)
  expect(plays).toEqual([{ asset: 'cues/drop.wav', at }])
  await ui.unmount()
})

test('a drop toast held when the band goes off is raised on the next tick', async ($, on) => {
  const state = dropping('legendary')
  const { time, raised, plays } = staging(on, { ...record(state), ...STAGED })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...PARTY_BAND })
  const [show] = revealsOf(state, time.now(), time.now() + 5_000)
  await time.advance(5_000)
  const kill = time.now()
  expect(raised).toEqual([])
  await $.command.run({ ...RUN, command: 'promptfall', args: 'off' })
  // Past the show time with the band off: no frame draws, so nothing raises it yet.
  await time.advance((show?.at ?? kill) - kill + 500)
  expect(raised).toEqual([])
  await time.advance(kill + 5_000 - time.now())
  expect(raised.map((t) => [t.text.split(':')[0], t.at])).toEqual([
    ['Legendary drop', kill + 5_000],
  ])
  expect(plays).toEqual([{ asset: 'cues/legendary.wav', at: kill + 5_000 }])
  await ui.unmount()
})

test('a drop toast on the desktop lands at its reveal with no frame loop', async ($, on) => {
  const state = dropping('legendary')
  const { time, raised, plays, blits } = staging(on, { ...record(state), ...STAGED })
  await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
  await $.session.attach({ surface: 'desktop', clientId: 'desktop:default' })
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'desktop', ...PARTY_BAND })
  const [show] = revealsOf(state, time.now(), time.now() + 5_000)
  if (!show) throw new Error('the tick drops no item with a chest')
  await time.advance(5_000)
  expect(raised).toEqual([])
  await time.advance(show.at - time.now() - 1)
  expect(raised).toEqual([])
  await time.advance(1)
  // At the wake for the show time: not at the kill, and not a tick later.
  expect(raised.map((t) => [t.text.split(':')[0], t.at])).toEqual([['Legendary drop', show.at]])
  expect(plays).toEqual([{ asset: 'cues/legendary.wav', at: show.at }])
  await time.advance(5_000)
  expect(raised).toHaveLength(1)
  // SMIL plays the motion: the loop drew and blitted nothing.
  expect(blits).toEqual([])
  await ui.unmount()
})

/**
 * A state whose next tick kills zone 1's boss at 1 HP and advances the party to zone 2, the boss
 * dropping an item a toast names.
 */
function bossDropping(): GameState {
  for (let seed = 1; seed < 20_000; seed++) {
    const s0 = createInitialState(seed)
    const s: GameState = {
      ...s0,
      wave: 11,
      encounter: {
        enemies: [
          {
            id: 'e-boss',
            def: 'bandit_captain',
            kind: 'zone_boss',
            hp: 1,
            maxHp: 630,
            enraged: false,
          },
        ],
        queue: [],
        waveSize: 0,
        spawnedInWave: 0,
      },
      battle: { gauges: s0.party.map((id) => ({ id, g: GAUGE_FULL })), queue: [], busy: 0 },
    }
    const effects = step(s, { t: 'tick' }).effects
    const drop = effects.find((e) => e.k === 'drop')
    if (
      drop?.k === 'drop' &&
      ['rare', 'epic', 'legendary'].includes(drop.item.rarity) &&
      effects.some((e) => e.k === 'zone_cleared' && e.advancedTo === 2)
    ) {
      return s
    }
  }
  throw new Error('no zone boss kill with a drop a toast names')
}

/**
 * The boss's drop reveal and the zone arrival's show time for the next tick of `state`, from a
 * timeline driven the way the registration drives the session's.
 */
function backdropOf(state: GameState, drawnAt: number, tickAt: number) {
  const timeline = new StageTimeline()
  timeline.observe(viewOf(state), drawnAt)
  const { state: next, effects } = step(state, { t: 'tick' })
  timeline.admit(viewOf(next), tickAt)
  timeline.onEffects(effects, tickAt, 5_000, tickAt)
  const drop = effects.find((e) => e.k === 'drop')
  const reveal = drop?.k === 'drop' ? timeline.showAt(drop.item.id) : null
  const backdrop = timeline.zoneShowAt(state.zone)
  if (reveal === null || backdrop === null) throw new Error('the kill has no reveal or no backdrop')
  return { reveal, backdrop }
}

const ARRIVAL = 'The party reached zone 2, Whisperwood'
const isDropToast = (t: Raised) => /^(Rare|Epic|Legendary) drop: /.test(t.text)

test("the zone arrival toast lands when the backdrop changes, after the boss's drop toast", async ($, on) => {
  const state = bossDropping()
  const { time, raised, plays, blits } = staging(on, { ...record(state), ...STAGED })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...PARTY_BAND })
  const { reveal, backdrop } = backdropOf(state, time.now(), time.now() + 5_000)
  await time.advance(5_000)
  const kill = time.now()
  const arrivals = () => raised.filter((t) => t.text === ARRIVAL)
  // At the kill the stage still shows zone 1: no arrival, no drop.
  expect(arrivals()).toEqual([])
  expect(raised.filter(isDropToast)).toEqual([])
  expect(reveal).toBeLessThan(backdrop)
  await time.advance(backdrop - time.now() + 3 * EVENT_FRAME_MS)
  const frame = firstFrameFrom(blits, backdrop)
  const before = blits.filter((b) => b < backdrop).at(-1) ?? 0
  expect(before).toBeGreaterThan(kill)
  expect(arrivals()).toHaveLength(1)
  const at = arrivals()[0]?.at ?? 0
  // The last frame before the boss's row leaves raised none; the first frame at or after it did.
  expect(at).toBeGreaterThan(before)
  expect(at).toBeGreaterThanOrEqual(backdrop)
  expect(at).toBeLessThanOrEqual(frame)
  // Frames keep a fixed beat, and one with nothing new to show blits nothing: the drain is at most
  // a beat late.
  expect(at - backdrop).toBeLessThan(EVENT_FRAME_MS)
  expect(arrivals()[0]?.timeoutMs).toBe(4000)
  // The boss's drop toast landed first, at its own reveal.
  const drops = raised.filter(isDropToast)
  expect(drops).toHaveLength(1)
  expect(drops[0]?.at ?? 0).toBeGreaterThanOrEqual(reveal)
  expect(drops[0]?.at ?? 0).toBeLessThan(at)
  expect(raised.indexOf(drops[0] as (typeof raised)[number])).toBeLessThan(
    raised.indexOf(arrivals()[0] as (typeof raised)[number]),
  )
  // The arrival's cue plays with it, at the backdrop's show time, after the drop's.
  expect(plays.filter((p) => p.at >= at)).toEqual([{ asset: 'cues/zone_cleared.wav', at }])
  await ui.unmount()
})

test('the zone arrival toast on the desktop lands at the wake for its show time', async ($, on) => {
  const state = bossDropping()
  const { time, raised, plays } = staging(on, { ...record(state), ...STAGED })
  await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
  await $.session.attach({ surface: 'desktop', clientId: 'desktop:default' })
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'desktop', ...PARTY_BAND })
  const { reveal, backdrop } = backdropOf(state, time.now(), time.now() + 5_000)
  await time.advance(5_000)
  const pictured = async () => String((await ui.find({ type: 'Svg' }))?.props.alt ?? '')
  await time.advance(backdrop - time.now() - 1)
  expect(raised.filter((t) => t.text === ARRIVAL)).toEqual([])
  expect(raised.filter(isDropToast).map((t) => t.at)).toEqual([reveal])
  expect(await pictured()).toMatch(/^Zone 1,/)
  await time.advance(1)
  expect(raised.filter((t) => t.text === ARRIVAL).map((t) => t.at)).toEqual([backdrop])
  expect(plays.filter((p) => p.at === backdrop)).toEqual([
    { asset: 'cues/zone_cleared.wav', at: backdrop },
  ])
  // The wake redraws: the backdrop changes with the toast, not at the next publish.
  expect(await pictured()).toMatch(/^Zone 2,/)
  await ui.unmount()
})

test("an empty-stage drop's toast lands at its reveal", async ($, on) => {
  const { time, raised, plays, blits } = staging(on, STAGED, { PROMPTFALL_SANDBOX: '1' })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...PARTY_BAND })
  // A fresh sandbox before its first tick: no enemy on the stage, so the chest falls on the ground.
  const sent = time.now()
  const reply = await $.command.run({
    ...RUN,
    command: 'promptfall',
    args: 'sandbox item silk_robe legendary',
  })
  // The reply comes back at once; the words wait for the reveal.
  expect(reply.text).toBe('Sandbox: Silk Robe (legendary) dropped')
  const show = sent + CHEST_SHOW_MS
  const drops = () => raised.filter((t) => t.text === 'Legendary drop: Silk Robe')
  expect(drops()).toEqual([])
  expect(plays).toEqual([])
  await time.advance(show - time.now() + 3 * EVENT_FRAME_MS)
  const frame = firstFrameFrom(blits, show)
  const before = blits.filter((b) => b < show).at(-1) ?? 0
  expect(drops()).toHaveLength(1)
  const at = drops()[0]?.at ?? 0
  expect(at).toBeGreaterThan(before)
  expect(at).toBeGreaterThanOrEqual(show)
  expect(at).toBeLessThanOrEqual(frame)
  expect(plays).toEqual([{ asset: 'cues/legendary.wav', at }])
  await ui.unmount()
})

/** `record(state)` with `events` waiting in the ledger's log: the boot delivers them as one burst. */
function delivering(state: GameState, events: Event[]): Record<string, unknown> {
  const seed = record(state)
  const key = 'promptfall:pf:acct:acct-1:record'
  const rec = seed[key] as Record<string, unknown>
  seed[key] = {
    ...rec,
    cursor: events.length,
    log: events.map((event, i) => ({ n: i + 1, event })),
  }
  return seed
}

function sale(listingId: string, base: string, net: number): Event {
  return { t: 'sold', listingId, kind: 'item', base, rarity: 'rare', price: net, net }
}

test('a delivery of three sales raises one folded toast with the sum of their gold', async ($, on) => {
  const state = createInitialState(1)
  const events = [
    sale('L1', 'oak_staff', 120),
    sale('L2', 'rune_staff', 200),
    sale('L3', 'ember_rod', 90),
  ]
  const { time, raised } = sounding(on, { ...delivering(state, events), ...SOUND_ON })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await time.advance(100)
  expect(raised.filter((t) => t.text.includes(' sold for '))).toEqual([
    { text: '3 items sold for 410 gold', timeoutMs: 4000 },
  ])
})

test('three level-ups in one burst raise one toast and play the level-up cue once', async ($, on) => {
  const state = createInitialState(1)
  const events: Event[] = state.party.map((heroId) => ({ t: 'sandbox_level', heroId, level: 2 }))
  expect(events).toHaveLength(3)
  const { time, raised, plays } = sounding(on, { ...delivering(state, events), ...SOUND_ON })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await time.advance(100)
  expect(raised.filter((t) => t.text.includes(' reached level '))).toHaveLength(1)
  expect(plays.filter((p) => p.asset === 'cues/level_up.wav')).toHaveLength(1)
})

test('a burst with a sale, a level-up and a legendary drop toasts legendary, level-up, sale', async ($, on) => {
  const state = createInitialState(1)
  const lead = state.party[0] ?? ''
  const events: Event[] = [
    sale('L1', 'rune_staff', 200),
    { t: 'sandbox_level', heroId: lead, level: 2 },
    { t: 'sandbox_item', base: 'oak_staff', rarity: 'legendary' },
  ]
  const { time, last, raised } = sounding(on, { ...delivering(state, events), ...SOUND_ON })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await time.advance(100)
  const name = (last.get('view') as GameView).roster.find((h) => h.id === lead)?.name
  expect(raised).toEqual([
    { text: 'Legendary drop: Oak Staff', timeoutMs: 8000 },
    { text: `${name} reached level 2`, timeoutMs: 4000 },
    { text: 'Rune Staff sold for 200 gold', timeoutMs: 4000 },
  ])
})

test('a common drop plays nothing; sound off plays nothing', async ($, on) => {
  const { time, plays } = sounding(on, { ...record(dropping('common')), ...SOUND_ON })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await time.advance(5_000)
  expect(plays).toEqual([])
})

test('sound off plays nothing on an epic drop', async ($, on) => {
  const { time, plays } = sounding(on, { ...record(dropping('epic')), ...settingsAt('off') })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await time.advance(5_000)
  expect(plays).toEqual([])
})

test('sound turned on in another session reaches the primary without a restart', async ($, on) => {
  const { time, plays, data } = sounding(on, { ...record(dropping('epic')), ...settingsAt('off') })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  // Another session's /promptfall sound loud writes the machine's store, not this session's atom.
  data.set('promptfall:settings', { sound: 'loud', motion: 'full', renderer: 'auto' })
  await time.advance(5_000)
  expect(plays).toEqual([{ asset: 'cues/drop.wav', gain: 1 }])
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

// ---------------------------------------------------------------------------
// The sandbox's world boss verbs: one world poll runs inside the command

/** Past the sandbox grid's first window, so no grid boss is open when a test starts. */
const PAST_GRID_BOSS = BOSS_WINDOW_MS + 1_000_000
const APPEARED = 'World boss The Promptwyrm has appeared'
const DOWN = 'World boss The Promptwyrm is down'

function sandboxSounding(
  on: On,
  seed: Record<string, unknown> = {},
  answer: PlayAnswer = 'late',
  env: Record<string, string> = { PROMPTFALL_SANDBOX: '1' },
) {
  const time = mock.clock(on, { now: PAST_GRID_BOSS })
  const { data } = store(on, { ...SOUND_ON, ...seed })
  const last = states(on)
  const toasts: string[] = []
  const raised: Raised[] = []
  /** Toasts and cues in the order the host received them. */
  const order: string[] = []
  engineBottom(on, toasts, env, (toast) => {
    raised.push(toast)
    order.push(`toast ${toast.text}`)
  })
  const plays: string[] = []
  on('audio.play', (_$, e) => {
    plays.push(e.clip.asset ?? '')
    order.push(`cue ${e.clip.asset ?? ''}`)
    return answerPlay(time, answer)
  })
  on('session.attach', (_$, e) => ({ clientId: e.clientId }))
  return { time, data, last, toasts, plays, raised, order }
}

test('sandbox worldboss has toasted and cued when it returns; worldboss end has toasted down', async ($, on) => {
  const { toasts, plays, raised } = sandboxSounding(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const run = async (args: string) =>
    (await $.command.run({ ...RUN, command: 'promptfall', args: `sandbox ${args}` })).text
  // The clock never moves in this test: no timer poll runs, only the verbs' own.
  expect(await run('worldboss')).toBe(`Sandbox: world boss The Promptwyrm has appeared`)
  expect(raised.filter((t) => t.text === APPEARED)).toEqual([{ text: APPEARED, timeoutMs: 8000 }])
  expect(plays).toEqual(['cues/boss.wav'])
  expect(await run('worldboss end')).toBe('Sandbox: The Promptwyrm is down, rewards delivered')
  expect(raised.filter((t) => t.text === DOWN)).toEqual([{ text: DOWN, timeoutMs: 4000 }])
  expect(toasts.filter((t) => t === APPEARED)).toHaveLength(1)
  expect(plays).toEqual(['cues/boss.wav'])
  // The reward carries only the boss id, after boss mode ended: the session kept the name.
  const shares = raised.filter((t) => t.text.startsWith('Your share of '))
  expect(shares.map((t) => t.timeoutMs)).toEqual([8000])
  expect(shares[0]?.text).toMatch(/^Your share of The Promptwyrm: \d+ gold/)
})

test('a read-only sandbox session raises no world boss toast and no cue; its band still shows the boss', async ($, on) => {
  const { time, data, last, toasts, plays } = sandboxSounding(on, {
    [`${SANDBOX_PREFIX}lease`]: { owner: 'someone-else', until: 9_999_999_999_999 },
  })
  // The primary elsewhere: a ledger over the same sandbox save, its account the one this session reads.
  const ledger = new Ledger({
    kv: new StoreKeyValue(
      {
        get: async (key) => data.get(key),
        set: async (key, value) => {
          data.set(key, JSON.parse(JSON.stringify(value)))
        },
        delete: async (key) => {
          data.delete(key)
        },
        keys: async () => [...data.keys()],
      },
      SANDBOX_PREFIX,
    ),
    now: async () => PAST_GRID_BOSS,
    minClientVersion: '0.0.0',
    seedSource: () => 1,
    tokenSource: () => crypto.randomUUID(),
    linkApprover: approveAs(null),
    flags: { 'sandbox.enabled': true, 'worldboss.enabled': true },
  })
  const boot = await ledger.bootstrap({ clientVersion: CLIENT_VERSION, deviceToken: null })
  data.set(`${SANDBOX_PREFIX}deviceToken`, boot.deviceToken)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  expect(last.get('mode')).toBe('secondary')
  expect(await ledger.host.spawnBoss()).toEqual({ ok: true })
  await time.advance(WORLD_POLL_MS)
  expect(worldRows(last.get('view') as GameView, worldOf(last))[1]?.text).toMatch(
    /^World boss The Promptwyrm /,
  )
  expect(await ledger.host.settleBoss()).toEqual({ ok: true })
  await time.advance(WORLD_POLL_FAST_MS)
  expect(toasts.filter((t) => t.startsWith('World boss '))).toEqual([])
  expect(plays).toEqual([])
})

// ---------------------------------------------------------------------------
// Silent here: a play the system skipped marks the session, never the store

const SILENT_ROW = /Sound:? +quiet, silent here/
const NO_PLAYER =
  'This system has no audio player. Claude Code plays sound on macOS; the setting is kept.'

/** The pane 100 columns wide at its full height, so the detail window shows its last lines. */
const FULL_PANE = { ...PANE, props: { ...PANE.props, scroll: { offset: 0, bodyRows: PANE_ROWS } } }

/** The Account tab's text in FULL_PANE. */
async function accountText($: Parameters<TestBody>[0]): Promise<string> {
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...FULL_PANE })
  await ui.press({ key: 'tab-account' })
  const text = await paneText(ui)
  await ui.unmount()
  return text
}

/** The detail window's lines, right of the list's border, joined so a wrapped sentence reads whole. */
const detailText = (text: string) =>
  text
    .split('\n')
    .flatMap((row) => {
      const right = row.split('││')[1]
      return right === undefined ? [] : [right.replace(/│$/, '').trim()]
    })
    .filter(Boolean)
    .join(' ')

/** A world boss cue, then a level-up cue, each raised by a sandbox verb, each clip let finish. */
async function twoCues(
  $: Parameters<TestBody>[0],
  time: { advance: (ms: number) => Promise<void> },
  last: Map<string, unknown>,
) {
  const run = (args: string) =>
    $.command.run({ ...RUN, command: 'promptfall', args: `sandbox ${args}` })
  await run('worldboss')
  await time.advance(CLIP_MS + 100)
  const lead = (last.get('view') as GameView).roster[0]
  await run(`level ${lead?.name ?? ''} ${(lead?.level ?? 1) + 1}`)
  await time.advance(CLIP_MS + 100)
}

for (const answer of ['at once', 'reject'] as const) {
  test(`a terminal play answered ${answer} marks the session: no next cue, the row and the detail say so`, async ($, on) => {
    const { time, data, last, plays } = sandboxSounding(on, {}, answer)
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
    const stored = JSON.stringify(data.get('promptfall:settings'))
    await twoCues($, time, last)
    expect(plays).toEqual(['cues/boss.wav'])
    const text = await accountText($)
    expect(text).toMatch(SILENT_ROW)
    expect(detailText(text)).toContain(NO_PLAYER)
    // The mark is the session's: the stored step is untouched.
    expect(JSON.stringify(data.get('promptfall:settings'))).toBe(stored)
    // A new session starts unmarked and tries again.
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
    expect(await accountText($)).not.toMatch(/silent here/)
    const lead = (last.get('view') as GameView).roster[0]
    await $.command.run({
      ...RUN,
      command: 'promptfall',
      args: `sandbox level ${lead?.name ?? ''} ${(lead?.level ?? 1) + 1}`,
    })
    await time.settle()
    expect(plays).toEqual(['cues/boss.wav', 'cues/level_up.wav'])
  })
}

test('a terminal play answered after its clip sets no mark: the next cue plays', async ($, on) => {
  const { time, last, plays } = sandboxSounding(on, {}, 'late')
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await twoCues($, time, last)
  expect(plays).toEqual(['cues/boss.wav', 'cues/level_up.wav'])
  const text = await accountText($)
  expect(text).toMatch(/Sound:? +quiet/)
  expect(text).not.toMatch(/silent here/)
})

test('a terminal session keeps its surface over a hot reload: a play answered at once still marks it', async ($, on) => {
  const { time, last, plays } = sandboxSounding(on, {}, 'at once')
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  // The reload: register runs again and session.start fires with surface null.
  await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
  await twoCues($, time, last)
  expect(plays).toEqual(['cues/boss.wav'])
  expect(await accountText($)).toMatch(SILENT_ROW)
})

test('a sandbox recruit plays the recruit cue', async ($, on) => {
  const { time, plays } = sandboxSounding(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.command.run({ ...RUN, command: 'promptfall', args: 'sandbox recruit epic' })
  await time.settle()
  expect(plays).toEqual(['cues/recruit.wav'])
})

test('a sandbox retreat plays the retreat cue once, after its long toast; a wipe plays none', async ($, on) => {
  const { time, plays, raised, order } = sandboxSounding(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const run = async (args: string) =>
    (await $.command.run({ ...RUN, command: 'promptfall', args: `sandbox ${args}` })).text
  await run('zone 3')
  await time.settle()
  const before = plays.length
  expect(await run('wipe')).toMatch(/^Sandbox: the party fell, back to wave 1 of zone 3/)
  await time.settle()
  expect(raised.filter((t) => t.text.startsWith('The party fell')).map((t) => t.timeoutMs)).toEqual(
    [4000],
  )
  expect(plays.slice(before)).toEqual([])
  await run('wipe')
  await time.settle()
  expect(await run('wipe')).toMatch(/^Sandbox: the party retreats to zone 2/)
  await time.settle()
  const retreat = raised.filter((t) => t.text.startsWith('The party retreats'))
  expect(retreat).toEqual([{ text: retreat[0]?.text, timeoutMs: 8000 }])
  expect(plays.slice(before)).toEqual(['cues/retreat.wav'])
  const toastAt = order.indexOf(`toast ${retreat[0]?.text}`)
  expect(toastAt).toBeGreaterThanOrEqual(0)
  expect(order.indexOf('cue cues/retreat.wav')).toBeGreaterThan(toastAt)
})

test('the desktop never marks the session, whatever its plays answer', async ($, on) => {
  const { time, last, plays } = sandboxSounding(on, {}, 'at once')
  await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
  await $.session.attach({ surface: 'desktop', clientId: 'desktop:default' })
  await twoCues($, time, last)
  expect(plays).toEqual(['cues/boss.wav', 'cues/level_up.wav'])
})

const SNAPSHOT = 'promptfall:deviceToken:snapshot'
const STAMP = 'promptfall:deviceToken:stamp'
const MINUTE = 60_000

/**
 * acct-1 back after a while: 412 kills, 3 zone bosses, 1 Legendary and 2 Epics dropped, 1,200
 * gold earned and zone 5 reached since a snapshot whose roster stood 2 levels lower. `stampAge`:
 * how long ago the stamp says the account was last seen playing; `of`: whose records they are.
 */
function returning(on: On, stampAge: number, of = 'acct-1', seed: Record<string, unknown> = {}) {
  const s0 = createInitialState(7)
  const state: GameState = {
    ...s0,
    highestZone: 5,
    stats: { ...s0.stats, kills: 412 },
    tallies: {
      ...s0.tallies,
      zoneBosses: 3,
      drops: { ...s0.tallies.drops, epic: 2, legendary: 1 },
      goldEarned: 1200,
    },
  }
  const levels = s0.roster.reduce((sum, h) => sum + h.level, 0)
  const snapshot = {
    account: of,
    kills: 0,
    zoneBosses: 0,
    levels: levels - 2,
    drops: { rare: 0, epic: 0, legendary: 0 },
    goldEarned: 0,
    highestZone: 4,
  }
  const now = 1_000_000_000
  const time = mock.clock(on, { now })
  const { data, writes } = store(on, {
    ...account(state),
    [SNAPSHOT]: snapshot,
    [STAMP]: { account: of, at: now - stampAge },
    ...seed,
  })
  const last = states(on)
  const raised: Raised[] = []
  engineBottom(on, [], {}, (t) => raised.push(t))
  const line = `Since your last session: 412 kills, 3 bosses, 2 levels, 1 Legendary, 2 Epics, 1,200 gold, zone 5 reached. Today's goal: ${goalWords(dailyGoal(dayOf(now), 'acct-1', 1))}.`
  return { time, data, writes, last, raised, snapshot, now, line }
}

test("a primary start eleven minutes after acct-1's stamp toasts the summary and retakes the snapshot", async ($, on) => {
  const { time, data, last, raised, line, now } = returning(on, 11 * MINUTE)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  expect(line).toMatch(/Today's goal: (kill|beat|see) /)
  expect(raised.filter((t) => t.text.startsWith('Since'))).toEqual([
    { text: line, timeoutMs: 8000 },
  ])
  // It holds the message window for 20 seconds, as the welcome does.
  expect(last.get('notice')).toBe(line)
  expect(raised.some((t) => t.text.startsWith('Welcome'))).toBe(false)
  const view = last.get('view') as GameView
  expect(data.get(SNAPSHOT)).toEqual({
    account: 'acct-1',
    kills: 412,
    zoneBosses: 3,
    levels: view.roster.reduce((sum, h) => sum + h.level, 0),
    drops: { rare: 0, epic: 2, legendary: 1 },
    goldEarned: 1200,
    highestZone: 5,
  })
  expect(data.get(STAMP)).toEqual({ account: 'acct-1', at: now })
  await time.advance(SUMMARY_MS)
  expect(last.get('notice') ?? null).toBeNull()
})

test('a stamp nine minutes old toasts nothing and keeps the snapshot', async ($, on) => {
  const { data, last, raised, snapshot } = returning(on, 9 * MINUTE)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  expect(raised.filter((t) => t.text.startsWith('Since'))).toEqual([])
  expect(last.get('notice') ?? null).toBeNull()
  expect(data.get(SNAPSHOT)).toEqual(snapshot)
})

test('a gap of a day or more names the weekday of the stamp', async ($, on) => {
  const { raised, now } = returning(on, 2 * DAY_MS)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const weekday = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][
    new Date(now - 2 * DAY_MS).getDay()
  ]
  expect(raised.filter((t) => t.text.startsWith(`Since ${weekday}: 412 kills,`))).toHaveLength(1)
})

test("another account's records raise nothing, and this account's snapshot replaces them", async ($, on) => {
  const { data, raised } = returning(on, 11 * MINUTE, 'acct-2')
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  expect(raised.filter((t) => t.text.startsWith('Since'))).toEqual([])
  expect((data.get(SNAPSHOT) as { account: string }).account).toBe('acct-1')
  expect((data.get(STAMP) as { account: string }).account).toBe('acct-1')
})

test('a first launch toasts the welcome, no summary, and takes the first snapshot', async ($, on) => {
  const now = 1_000_000_000
  mock.clock(on, { now })
  const { data } = store(on)
  states(on)
  const raised: Raised[] = []
  engineBottom(on, [], {}, (t) => raised.push(t))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  expect(raised.map((t) => t.text)).toContain(WELCOME)
  expect(raised.filter((t) => t.text.startsWith('Since'))).toEqual([])
  const account = (data.get(SNAPSHOT) as { account: string; kills: number }).account
  expect(account).toBeTruthy()
  expect(data.get(STAMP)).toEqual({ account, at: now })
})

test('a secondary writes neither record', async ($, on) => {
  const { writes, raised } = returning(on, 11 * MINUTE, 'acct-1', {
    [LEASE]: { owner: 'someone-else', until: 9_999_999_999_999 },
  })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  expect(raised.filter((t) => t.text.startsWith('Since'))).toEqual([])
  expect(writes.filter((w) => w.key === SNAPSHOT || w.key === STAMP)).toEqual([])
})

test('the stamp is refreshed every five minutes while primary and at a handover', async ($, on) => {
  const { time, data, last, now } = returning(on, 9 * MINUTE)
  on('tool.call', () => ({ result: 'ok', text: 'ok' }))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  expect(data.get(STAMP)).toEqual({ account: 'acct-1', at: now })
  await time.advance(STAMP_MS)
  expect(data.get(STAMP)).toEqual({ account: 'acct-1', at: now + STAMP_MS })
  // Another session takes the lease: this one stamps as it stops being primary.
  await time.advance(MINUTE - 5_000)
  data.set(LEASE, { owner: 'someone-else', until: 9_999_999_999_999 })
  await time.advance(10_000)
  expect(last.get('mode')).toBe('secondary')
  const stamped = (data.get(STAMP) as { at: number }).at
  expect(stamped).toBeGreaterThan(now + STAMP_MS)
  // A secondary leaves it alone from then on.
  await time.advance(STAMP_MS)
  expect((data.get(STAMP) as { at: number }).at).toBe(stamped)
})

test("the session's end stamps; a reset wipes both records", async ($, on) => {
  const { time, data, now } = returning(on, 9 * MINUTE)
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await time.advance(MINUTE)
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
  expect(data.get(STAMP)).toEqual({ account: 'acct-1', at: now + MINUTE })
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-account' })
  await ui.press({ key: 'row:reset' })
  await ui.press({ key: 'yes' })
  // The fresh account's first launch takes its own: nothing of acct-1's is left.
  expect((data.get(SNAPSHOT) as { account: string }).account).not.toBe('acct-1')
  expect((data.get(STAMP) as { account: string }).account).not.toBe('acct-1')
  await ui.unmount()
})
