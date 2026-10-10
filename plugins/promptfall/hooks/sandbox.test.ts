import type { On, RenderElement } from 'claude-code'
import { expect, mock } from 'claude-code/testing'
import type { GameView } from '../types'
import { RETRYING_NOTICE } from './engine'
import { pick } from './sandbox'
import { resolveClient } from './server'
import { SETTINGS_DEFAULT } from './state'
import { test } from './testing'
import { paneText } from './ui/pane/testing'
import { MemoryKeyValue } from './vendor/protocol.js'
import { CLIENT_VERSION } from './version'

const RUN = {
  origin: { kind: 'composer' },
  presentation: { isFullscreen: false, columns: 120 },
} as const

const ON = { PROMPTFALL_SANDBOX: '1' }
const OFF_TEXT = 'Sandbox is off. Start Claude Code with PROMPTFALL_SANDBOX=1.'

/** `env`: the variables, or a function read at each `$.env.get`, so a test can flip one mid-run. */
function harness(
  on: On,
  env: Record<string, string> | ((name: string) => string | undefined),
  seed: Record<string, unknown> = {},
) {
  // The machine plays in-process unless the seed names a server.
  const data = new Map<string, unknown>(Object.entries({ 'promptfall:server': 'local', ...seed }))
  const states = new Map<string, unknown>()
  const registered: { name: string; argumentHint?: string }[] = []
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
  on('command.register', (_$, e) => {
    registered.push({ name: e.name, ...(e.argumentHint ? { argumentHint: e.argumentHint } : {}) })
    return { value: { command: e.name } }
  })
  if (typeof env === 'function') on('env.get', (_$, e) => ({ value: env(e.name) }))
  else mock.env(on, env)
  const clock = mock.clock(on, { now: 1_000_000 })
  const view = () => states.get('view') as GameView
  return { data, states, registered, clock, view }
}

test('sandbox gold adds the gold before the reply returns', async ($, on) => {
  const { view } = harness(on, ON)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const before = view().gold
  const r = await $.command.run({ ...RUN, command: 'promptfall', args: 'sandbox gold 5000' })
  expect(r.text).toBe('Sandbox: 5000 gold added')
  expect(view().gold).toBe(before + 5000)
})

test('with the variable absent, sandbox answers the off message and grants nothing', async ($, on) => {
  const { view, registered } = harness(on, {})
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const before = view().gold
  const r = await $.command.run({ ...RUN, command: 'promptfall', args: 'sandbox gold 5000' })
  expect(r.text).toBe(OFF_TEXT)
  expect(view().gold).toBe(before)
  const hint = registered.find((c) => c.name === 'promptfall')?.argumentHint ?? ''
  expect(hint).not.toContain('sandbox')
})

test('with the sandbox on, the argument hint names the sandbox verb', async ($, on) => {
  const { registered } = harness(on, ON)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  expect(registered.find((c) => c.name === 'promptfall')?.argumentHint).toContain('sandbox')
})

const REAL_SAVE = {
  'promptfall:server': 'local',
  'promptfall:deviceToken': 'real-token',
  'promptfall:pf:token:real-token': 'real-acct',
  'promptfall:pf:acct:real-acct:record': { account: { accountId: 'real-acct' }, gold: 123 },
  'promptfall:lease': { owner: 'real-session', until: 9_999_999_999_999 },
  'promptfall:settings': { sound: true, motion: 'still', renderer: 'auto', probed: null },
}

test('the sandbox save lives under its own prefix; the real save is never touched', async ($, on) => {
  const { data, states, clock } = harness(on, ON, REAL_SAVE)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  // Its own lease: a real session holding the real one does not make this a secondary.
  expect(states.get('mode')).toBe('primary')
  expect(states.get('settings')).toEqual(REAL_SAVE['promptfall:settings'])
  await $.command.run({ ...RUN, command: 'promptfall', args: 'sandbox gold 5000' })
  await clock.advance(30_000)
  for (const [key, value] of Object.entries(REAL_SAVE)) {
    expect(JSON.stringify(data.get(key))).toBe(JSON.stringify(value))
  }
  const added = [...data.keys()].filter((k) => !(k in REAL_SAVE))
  expect(added.every((k) => k.startsWith('promptfall-sandbox:'))).toBe(true)
  expect(added).toContain('promptfall-sandbox:deviceToken')
  expect(added).toContain('promptfall-sandbox:lease')
  expect(added.some((k) => k.startsWith('promptfall-sandbox:pf:acct:'))).toBe(true)
  // The settings are per machine: shared, under the real prefix.
  await $.command.run({ ...RUN, command: 'promptfall', args: 'sound off' })
  expect((data.get('promptfall:settings') as { sound: boolean }).sound).toBe(false)
  expect(data.has('promptfall-sandbox:settings')).toBe(false)
})

// Two bootstraps: twice the default budget's work.
test(
  'a second session start with the variable set reuses the sandbox account',
  { timeoutMs: 60_000 },
  async ($, on) => {
    const { view } = harness(on, ON)
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
    await $.command.run({ ...RUN, command: 'promptfall', args: 'sandbox gold 5000' })
    const first = view()
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
    expect(view().accountId).toBe(first.accountId)
    expect(view().gold).toBe(first.gold)
  },
)

test('a stored server URL is ignored while the sandbox is on, and server answers it is pinned', async ($, on) => {
  const { data, states, view } = harness(on, ON, { 'promptfall:server': 'http://127.0.0.1:1' })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  expect(view().account.server).toBe('in-process')
  expect(states.get('server') ?? null).toBeNull()
  // No fetch to the stored URL: the outage notice never shows.
  expect(states.get('notice')).not.toBe(RETRYING_NOTICE)
  const pinned =
    'The sandbox pins the server: Promptfall plays in-process while PROMPTFALL_SANDBOX=1'
  const run = (args: string) => $.command.run({ ...RUN, command: 'promptfall', args })
  expect((await run('server http://other')).text).toBe(pinned)
  expect((await run('server local')).text).toBe(pinned)
  expect(data.get('promptfall:server')).toBe('http://127.0.0.1:1')
})

test('sandbox reset leaves a fresh account; the lease and the settings stay', async ($, on) => {
  const settings = { sound: true, motion: 'full', renderer: 'auto' }
  const { data, view } = harness(on, ON, { 'promptfall:settings': settings })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const fresh = view()
  await $.command.run({ ...RUN, command: 'promptfall', args: 'sandbox gold 5000' })
  const old = view().accountId
  const oldToken = data.get('promptfall-sandbox:deviceToken')
  const lease = data.get('promptfall-sandbox:lease') as { owner: string }
  const r = await $.command.run({ ...RUN, command: 'promptfall', args: 'sandbox reset' })
  expect(r.text).toBe('Sandbox: the save starts over')
  expect(view().accountId).not.toBe(old)
  expect(view().gold).toBe(fresh.gold)
  expect(view().heroes.map((h) => h.level)).toEqual(fresh.heroes.map((h) => h.level))
  expect(data.get('promptfall-sandbox:deviceToken')).not.toBe(oldToken)
  expect([...data.keys()].some((k) => k.includes(old))).toBe(false)
  expect((data.get('promptfall-sandbox:lease') as { owner: string }).owner).toBe(lease.owner)
  expect(data.get('promptfall:settings')).toEqual(settings)
})

test('sandbox alone lists the nine verbs, one line each', async ($, on) => {
  harness(on, ON)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const r = await $.command.run({ ...RUN, command: 'promptfall', args: 'sandbox' })
  const lines = (r.text ?? '').split('\n').slice(1)
  const verbs = lines.map((l) => l.trim().split(/[\s:]/)[0])
  expect(verbs).toEqual([
    'boss',
    'worldboss',
    'item',
    'level',
    'gold',
    'zone',
    'recruit',
    'wipe',
    'reset',
  ])
  // Every verb is built: none is marked as pending.
  for (const line of lines) expect(line).not.toContain('not yet')
})

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

test('the Account window shows no link action in the sandbox', async ($, on) => {
  harness(on, ON)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-account' })
  expect(await paneText(ui)).toMatch(/Not linked/)
  expect(await ui.find({ key: 'row:link' })).toBeUndefined()
  expect(await ui.find({ key: 'row:reset' })).toBeDefined()
  await ui.unmount()
})

/** Bootstraps on the resolved in-process ledger, starts a link and answers its first poll. */
async function firstPoll(setting: string | null, sandbox: boolean) {
  const { client } = resolveClient(
    setting,
    {
      kv: new MemoryKeyValue(),
      now: async () => 1_000_000,
      fetch: async () => {
        throw new Error('no network')
      },
    },
    sandbox,
  )
  const boot = await client.bootstrap({ clientVersion: CLIENT_VERSION, deviceToken: null })
  if ('refusal' in boot) throw new Error(boot.refusal)
  const auth = { deviceToken: boot.deviceToken }
  const start = await client.linkStart(auth)
  if ('reason' in start) throw new Error(start.reason)
  if ('refusal' in start) throw new Error(start.refusal)
  return client.linkPoll(auth, start.code)
}

test('the sandbox ledger refuses a link; the real in-process one approves it', async () => {
  // The sandbox pins the in-process ledger even with a URL stored.
  expect(await firstPoll('http://stored', true)).toEqual({ status: 'pending' })
  expect(await firstPoll(null, false)).toMatchObject({ status: 'linked' })
})

test('the desktop attach reads the switch too, and the desktop purse shows the mark', async ($, on) => {
  let set = false
  const { data, view } = harness(on, (name) =>
    set && name === 'PROMPTFALL_SANDBOX' ? '1' : undefined,
  )
  data.set('promptfall:settings', { ...SETTINGS_DEFAULT, renderer: 'raster' })
  on('session.attach', (_$, e) => ({ clientId: e.clientId }))
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box } = $.ui.resolve(e)
    return h(Box, { key: 'engine-band' }) as RenderElement
  })
  await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
  set = true
  await $.session.attach({ surface: 'desktop', clientId: 'desktop:default' })
  expect(view().account.sandbox).toBe(true)
  expect(data.has('promptfall-sandbox:deviceToken')).toBe(true)
  const ui = await $.ui.mount({
    plugin: 'promptfall',
    surface: 'desktop',
    component: 'AbovePrompt',
    requestId: 'band-test',
    props: {
      hasSurvey: false,
      isWorking: false,
      maxRows: 20,
      bodyColumns: 120,
      scroll: { offset: 0, bodyRows: 20 },
      view: {},
    },
  })
  const strip = ((await ui.find({ key: 'row-strip' }))?.children ?? [])[0] as
    | { props: { alt?: unknown } }
    | undefined
  expect(String(strip?.props.alt)).toContain('Sandbox')
  await ui.unmount()
})

/** Bootstraps an account on the resolved in-process ledger: its host and the account's id. */
async function hostWithAccount(sandbox: boolean) {
  const { client, host } = resolveClient(
    null,
    {
      kv: new MemoryKeyValue(),
      now: async () => 1_000_000,
      fetch: async () => {
        throw new Error('no network')
      },
    },
    sandbox,
  )
  const boot = await client.bootstrap({ clientVersion: CLIENT_VERSION, deviceToken: null })
  if ('refusal' in boot) throw new Error(boot.refusal)
  const auth = { deviceToken: boot.deviceToken }
  const credits = async () => {
    const info = await client.account(auth)
    if ('reason' in info) throw new Error(info.reason)
    return info.delivery.events.filter((e) => e.event.t === 'credited').length
  }
  if (!host) throw new Error('no host')
  return { host, accountId: boot.account.accountId, credits }
}

test('the sandbox ledger runs with sandbox.enabled on; the real one refuses grants but credits', async () => {
  const sandbox = await hostWithAccount(true)
  expect(await sandbox.host.sandbox(sandbox.accountId, { t: 'sandbox_wipe' })).toEqual({ ok: true })
  const real = await hostWithAccount(false)
  expect(await real.host.sandbox(real.accountId, { t: 'sandbox_wipe' })).toEqual({
    ok: false,
    reason: 'sandbox_off',
  })
  // `sandbox gold` goes through credit, which the flag does not gate.
  await real.host.credit(real.accountId, 5000, 'sandbox')
  expect(await real.credits()).toBe(1)
})

test('heroes who share a name show their id in which one, and the id picks one', async () => {
  const roster = [
    { id: 'h3k', name: 'Aldric the Bold' },
    { id: 'h9q', name: 'Aldric the Bold' },
    { id: 'h2m', name: 'Aldwyn the Grey' },
  ]
  expect(pick('hero', 'Heroes', 'ald', roster)).toBe(
    'Which one: Aldric the Bold (h3k), Aldric the Bold (h9q), Aldwyn the Grey',
  )
  expect(pick('hero', 'Heroes', 'h9q', roster)).toEqual(roster[1])
})
