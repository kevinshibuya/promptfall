import type { On, RenderElement } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { GameView, Prefs } from '../types'
import { createInitialState } from './vendor/sim.js'

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
      text: /^Promptfall · Promptfall: this machine's data is from an older version/,
    }),
  ).toBeDefined()
  await ui.unmount()
})
