import type { On, ToolCallResult } from 'claude-code'
import { type Engine, expect, mock, type Plugin } from 'claude-code/testing'
import { test } from './testing'
import { approveAs, Ledger } from './vendor/ledger.js'
import { MemoryKeyValue } from './vendor/protocol.js'

const URL = 'http://reactive'
const T0 = 1_000_000

/** A player event as a batch the server accepted carried it. */
type Sent = { t: string; at: number; hint?: string; on?: boolean }

/** A clock in memory that moves when the test moves it, recording each `every` period's interval. */
function clock(on: On) {
  let t = T0
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
    now: () => t,
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

/**
 * A session on the vendored ledger behind a mocked `$.http.fetch`, recording every player event a
 * batch it accepted carried, and each `$.clock.every` period the plugin asked for. `seed` is
 * stored before the session starts.
 */
function playing(on: On, seed: Record<string, unknown> = {}) {
  const time = clock(on)
  const data = new Map<string, unknown>(Object.entries({ 'promptfall:server': URL, ...seed }))
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
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  mock.env(on, {})
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  // biome-ignore lint/correctness/useYield: the bottom answers a step that streams no chunks
  on('turn.step', async function* (_$, e) {
    return {
      turnId: e.turnId,
      index: e.index,
      answer: '',
      toolUses: [],
      stopReason: null,
      usage: null,
    }
  })
  on('turn.abort', () => ({ value: undefined }))
  on('turn.complete', () => ({ text: '' }))
  // No settings hook beneath: the person is asked. As live, the chain beneath the request reaches
  // the prompt (`shown`) and settles once the person answered (`answered`).
  const prompt: { shown: () => void; answered: Promise<void> } = {
    shown: () => {},
    answered: Promise.resolve(),
  }
  on('classic.PermissionRequest', async () => {
    prompt.shown()
    await prompt.answered
    return {}
  })
  on('classic.PermissionDenied', () => ({}))
  on('classic.PostToolUseFailure', () => ({}))
  on('classic.PostCompact', () => ({}))
  on('ui.toast', () => ({ value: undefined }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  const ledger = new Ledger({
    kv: new MemoryKeyValue(),
    now: async () => time.now(),
    minClientVersion: '0.1.0',
    seedSource: () => 777,
    tokenSource: () => crypto.randomUUID(),
    linkApprover: approveAs('remote-player'),
  })
  const sent: Sent[] = []
  on('http.fetch', async (_$, e) => {
    const path = (e.url.split('?')[0] ?? '').replace(/^https?:\/\/[^/]+/, '')
    const auth = { deviceToken: (e.init?.headers?.authorization ?? '').replace(/^Bearer /, '') }
    const body = e.init?.body ? JSON.parse(e.init.body) : undefined
    let result: unknown
    if (path === '/v1/bootstrap') result = await ledger.bootstrap(body)
    else if (path === '/v1/batches') {
      const ack = await ledger.submit(body, auth)
      if (ack.ok) sent.push(...(body.events as Sent[]))
      result = ack
    } else if (path === '/v1/world') result = await ledger.world(auth, 0)
    else if (path === '/v1/account') result = await ledger.account(auth)
    else return { value: { status: 404, ok: false, headers: {}, text: '{"error":"route"}' } }
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify(result) } }
  })
  return { time, periods: time.periods, sent, prompt }
}

/** What the session sent of the reactive kinds, a guard named by its side. */
const reactive = (sent: Sent[]) =>
  sent
    .filter((e) => ['turn_start', 'turn_end', 'tool_mishap', 'camp', 'guard'].includes(e.t))
    .map((e) => (e.t === 'guard' ? `guard ${e.on ? 'on' : 'off'}` : e.t))

const hints = (sent: Sent[]) => sent.filter((e) => e.t === 'tool_call').map((e) => e.hint)

async function start($: Engine): Promise<void> {
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
}

/** Ends the session, which flushes what it buffered. */
async function quit($: Engine): Promise<void> {
  await $.session.end({ reason: 'prompt_input_exit', sessionId: 's1', resume: { id: 's1' } })
}

/** One model request of a turn, its stream read to the end. */
async function step(
  $: Engine,
  turnId: string,
  index: number,
  agentId?: string,
  model = 'claude',
): Promise<void> {
  const stream = $.turn.step({ turnId, index, model, messageCount: 1, agentId })
  for await (const _ of stream) {
    // Nothing streams: the bottom answers with no chunks.
  }
}

/** Another plugin that cancels the running turn at a step whose model is `abort`. */
const ABORTER: Plugin = {
  name: 'aborter',
  register(on) {
    on('turn.step', async function* ($, e, next) {
      if (e.model === 'abort') await $.turn.abort({ turnId: e.turnId })
      return yield* next(e)
    })
  },
}

const answered = (): ToolCallResult => ({ result: 'ok', text: 'ok' })

test('each tool call spawns the kind its tool names in the table', async ($, on) => {
  const { sent } = playing(on)
  on('tool.call', answered)
  await start($)
  await $.tool.call({ tool: 'Read', file_path: '/repo/a.ts' })
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await $.tool.call({ tool: 'Edit', file_path: '/repo/a.ts', old_string: 'a', new_string: 'b' })
  await $.tool.call({ tool: 'mcp__gh__issue', title: 'x' } as never)
  await $.tool.call({ tool: 'NoSuchTool' } as never)
  await quit($)
  expect(hints(sent)).toEqual(['swift', 'caster', 'brute', 'tank', 'tank'])
})

test('a subagent tool call spawns the tank whatever its tool', async ($, on) => {
  const { sent } = playing(on)
  let seen: string | undefined
  on('tool.call', (_$, e) => {
    seen = e.agentId
    return answered()
  })
  await start($)
  await $.tool.call({ tool: 'Read', file_path: '/repo/a.ts', agentId: 'sub-1' } as never)
  await quit($)
  expect(seen).toBe('sub-1')
  expect(hints(sent)).toEqual(['tank'])
})

test('a failed tool call is a mishap, at most one per 5 seconds', async ($, on) => {
  const { sent, time } = playing(on)
  await start($)
  const failure = { tool_name: 'Bash', tool_input: {}, error: 'exit 1' }
  await $.classic.PostToolUseFailure({ ...failure, tool_use_id: 'c1' })
  await time.advance(1_000)
  await $.classic.PostToolUseFailure({ ...failure, tool_use_id: 'c2' })
  await time.advance(5_000)
  await $.classic.PostToolUseFailure({ ...failure, tool_use_id: 'c3' })
  await quit($)
  expect(reactive(sent)).toEqual(['tool_mishap', 'tool_mishap'])
})

test('an interrupt by the person is no mishap', async ($, on) => {
  const { sent } = playing(on)
  await start($)
  await $.classic.PostToolUseFailure({
    tool_name: 'Bash',
    tool_input: {},
    tool_use_id: 'c1',
    error: 'interrupted',
    is_interrupt: true,
  })
  await quit($)
  expect(reactive(sent)).toEqual([])
})

test('a compaction makes camp, manual and auto both, at most one a minute', async ($, on) => {
  const { sent, time } = playing(on)
  await start($)
  await $.classic.PostCompact({ trigger: 'manual', compact_summary: 's' })
  await time.advance(30_000)
  await $.classic.PostCompact({ trigger: 'auto', compact_summary: 's' })
  await time.advance(30_000)
  await $.classic.PostCompact({ trigger: 'auto', compact_summary: 's' })
  await quit($)
  expect(reactive(sent)).toEqual(['camp', 'camp'])
})

/** A tool call the person is asked about: the request fires inside the call, beneath the plugin. */
function prompting(on: On, $: Engine, answer: 'allow' | 'deny') {
  on('tool.call', async (_$, e) => {
    await $.classic.PermissionRequest({ tool_name: e.tool, tool_input: {} })
    if (answer === 'allow') return answered()
    await $.classic.PermissionDenied({
      tool_name: e.tool,
      tool_input: {},
      tool_use_id: e.tool_use_id,
      reason: 'The user said no',
    })
    await $.classic.PostToolUseFailure({
      tool_name: e.tool,
      tool_input: {},
      tool_use_id: e.tool_use_id,
      error: 'denied',
    })
    return { result: 'denied', text: 'The user said no', isError: true } as ToolCallResult
  })
}

test('a permission prompt stands guard until the call resolves', async ($, on) => {
  const { sent } = playing(on)
  prompting(on, $, 'allow')
  await start($)
  await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
  await quit($)
  expect(reactive(sent)).toEqual(['guard on', 'guard off'])
  // The spawn first, then the guard while the person is asked.
  expect(sent.filter((e) => e.t !== 'tick').map((e) => e.t)).toEqual([
    'tool_call',
    'guard',
    'guard',
  ])
})

test('a denied call lowers the guard once and is no mishap', async ($, on) => {
  const { sent } = playing(on)
  prompting(on, $, 'deny')
  await start($)
  await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
  await quit($)
  expect(reactive(sent)).toEqual(['guard on', 'guard off'])
})

test('a person who says no lowers the guard as the call resolves, before the request settles', async ($, on) => {
  const { sent, prompt } = playing(on)
  // Live, a no raises neither the permission-denied hook nor the failure hook: the call resolves
  // as an error, and the request's chain settles after it.
  let answer: () => void = () => {}
  prompt.answered = new Promise((resolve) => {
    answer = resolve
  })
  const shown = new Promise<void>((resolve) => {
    prompt.shown = resolve
  })
  let asked: Promise<unknown> = Promise.resolve()
  on('tool.call', async (_$, e) => {
    asked = $.classic.PermissionRequest({ tool_name: e.tool, tool_input: {} })
    await shown
    return { result: 'no', text: 'The user said no', isError: true } as ToolCallResult
  })
  await start($)
  await $.tool.call({ tool: 'Bash', command: 'touch /tmp/x' })
  answer()
  await asked
  await quit($)
  expect(reactive(sent)).toEqual(['guard on', 'guard off'])
})

test('a second request while the guard is up sends nothing', async ($, on) => {
  const { sent } = playing(on)
  on('tool.call', async (_$, e) => {
    await $.classic.PermissionRequest({ tool_name: e.tool, tool_input: {} })
    await $.classic.PermissionRequest({ tool_name: e.tool, tool_input: {} })
    return answered()
  })
  await start($)
  await $.tool.call({ tool: 'Bash', command: 'make' })
  await quit($)
  expect(reactive(sent)).toEqual(['guard on', 'guard off'])
})

test('guard pairs keep to one per 2 seconds; an auto-allowed call stands no guard', async ($, on) => {
  const { sent, time } = playing(on)
  let ask = true
  on('tool.call', async (_$, e) => {
    if (ask) await $.classic.PermissionRequest({ tool_name: e.tool, tool_input: {} })
    return answered()
  })
  await start($)
  await $.tool.call({ tool: 'Bash', command: 'make' })
  await time.advance(500)
  await $.tool.call({ tool: 'Bash', command: 'make' })
  await time.advance(2_000)
  await $.tool.call({ tool: 'Bash', command: 'make' })
  ask = false
  await $.tool.call({ tool: 'Read', file_path: '/repo/a.ts' })
  await quit($)
  expect(reactive(sent)).toEqual(['guard on', 'guard off', 'guard on', 'guard off'])
})

test('a turn hastes the party: its start and its main-loop steps, not a subagent step', async ($, on) => {
  const { sent, time } = playing(on)
  await start($)
  await $.turn.start({ text: 'go', turnId: 't1' })
  await time.advance(61_000)
  await step($, 't1', 1, 'sub-1')
  await step($, 't1', 1)
  await quit($)
  expect(reactive(sent)).toEqual(['turn_start', 'turn_start'])
})

test('a turn of 200 steps refreshes haste at most once a minute', async ($, on) => {
  const { sent, time } = playing(on)
  await start($)
  await $.turn.start({ text: 'go', turnId: 't1' })
  // A step every 3 seconds for 10 minutes: the start, then one refresh per minute after it.
  for (let i = 0; i < 200; i++) {
    await step($, 't1', i)
    await time.advance(3_000)
  }
  await quit($)
  expect(reactive(sent).filter((t) => t === 'turn_start')).toHaveLength(10)
})

test('a subagent step leaves the turn cadence alone', async ($, on) => {
  const { periods } = playing(on)
  await start($)
  await $.turn.start({ text: 'go', turnId: 't1' })
  const atStart = periods.length
  await step($, 't1', 0, 'sub-1')
  expect(periods.slice(atStart)).toEqual([])
})

test(
  'an aborted main turn ends it: turn_end and the idle cadence',
  { plugins: [ABORTER] },
  async ($, on) => {
    const { sent, periods } = playing(on)
    await start($)
    await $.turn.start({ text: 'go', turnId: 't1' })
    const atStart = periods.length
    await step($, 't1', 0, undefined, 'abort')
    await quit($)
    expect(periods.slice(atStart)).toEqual([5000])
    expect(reactive(sent)).toEqual(['turn_start', 'turn_end'])
  },
)

test(
  'a secondary session records none of the reactive events',
  { plugins: [ABORTER] },
  async ($, on) => {
    const { sent, time } = playing(on, {
      'promptfall:lease': { owner: 'someone-else', until: 9_999_999_999_999 },
    })
    prompting(on, $, 'allow')
    await start($)
    await $.turn.start({ text: 'go', turnId: 't1' })
    await step($, 't1', 0)
    await $.tool.call({ tool: 'Bash', command: 'make' })
    await $.classic.PostToolUseFailure({
      tool_name: 'Bash',
      tool_input: {},
      tool_use_id: 'c1',
      error: 'exit 1',
    })
    await $.classic.PostCompact({ trigger: 'auto', compact_summary: 's' })
    await step($, 't1', 1, undefined, 'abort')
    await time.advance(20_000)
    await quit($)
    expect(reactive(sent)).toEqual([])
  },
)
