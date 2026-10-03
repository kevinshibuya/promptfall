import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const RUN = {
  origin: { kind: 'composer' },
  presentation: { isFullscreen: false, columns: 120 },
} as const

function harness(on: On, seed: Record<string, unknown> = {}) {
  const data = new Map<string, unknown>(Object.entries(seed))
  const states = new Map<string, unknown>()
  const opened: { id: string; title?: string }[] = []
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
  on('ui.open', (_$, e) => {
    opened.push({ id: e.id, ...(e.title ? { title: e.title } : {}) })
    return { value: { isPlaced: true } }
  })
  const clock = mock.clock(on, { now: 1_000_000 })
  return { states, opened, clock }
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
