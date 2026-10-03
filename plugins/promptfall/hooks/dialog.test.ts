import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { GameView } from '../types'
import { createInitialState, type GameState, hashState } from './vendor/sim.js'

const SURFACES = ['terminal', 'desktop'] as const

/** A store already holding an account whose state the test chose. */
function harness(on: On, state: GameState) {
  const data = new Map<string, unknown>([
    ['promptfall:deviceToken', 'token-1'],
    ['promptfall:pf:token:token-1', 'acct-1'],
    [
      'promptfall:pf:acct:acct-1:record',
      {
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
    ],
  ])
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
  mock.clock(on, { now: 1_000_000 })
  return { states }
}

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

function seeded(): GameState {
  const s = createInitialState(99)
  return {
    ...s,
    inventory: [
      {
        id: 'iseed',
        base: 'iron_sword',
        rarity: 'common',
        affixes: [],
        equippedBy: null,
        tradeableAt: null,
      },
    ],
  }
}

for (const surface of SURFACES) {
  test(`the inventory lists and vendors an item on ${surface}`, async ($, on) => {
    const { states } = harness(on, seeded())
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
    const ui = await $.ui.mount({ plugin: 'promptfall', surface, ...PANE })
    expect(await ui.find({ text: /Iron Sword/ })).toBeDefined()
    await ui.press({ key: 'vendor-iseed' })
    const view = states.get('view') as GameView
    expect(view.inventory).toHaveLength(0)
    expect(view.gold).toBe(2)
    expect(await ui.find({ text: /Iron Sword/ })).toBeUndefined()
    await ui.unmount()
  })

  test(`recruiting without gold shows the refusal on ${surface}`, async ($, on) => {
    harness(on, seeded())
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
    const ui = await $.ui.mount({ plugin: 'promptfall', surface, ...PANE })
    await ui.press({ key: 'tab-heroes' })
    await ui.press({ key: 'recruit' })
    expect(await ui.find({ text: /not_enough_gold/ })).toBeDefined()
    await ui.unmount()
  })

  test(`picking three heroes sets the party on ${surface}`, async ($, on) => {
    const { states } = harness(on, seeded())
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
    const ui = await $.ui.mount({ plugin: 'promptfall', surface, ...PANE })
    await ui.press({ key: 'tab-heroes' })
    const before = states.get('view') as GameView
    const archer = before.roster.find((h) => h.cls === 'archer')
    const [knight, mage] = before.roster
    if (!archer || !knight || !mage) throw new Error('roster')
    await ui.press({ key: `party-${knight.id}` })
    await ui.press({ key: `party-${archer.id}` })
    await ui.press({ key: `party-${mage.id}` })
    const after = states.get('view') as GameView
    expect(after.heroes.map((h) => h.id)).toEqual([knight.id, archer.id, mage.id])
    expect(after.roster.find((h) => h.id === archer.id)?.inParty).toBe(true)
    await ui.unmount()
  })

  test(`unequip frees a worn item so it can be sold on ${surface}`, async ($, on) => {
    const s0 = createInitialState(99)
    const knight = s0.roster[0]
    if (!knight) throw new Error('knight')
    const state: GameState = {
      ...s0,
      roster: s0.roster.map((h) =>
        h.id === knight.id ? { ...h, equipment: { ...h.equipment, weapon: 'iseed' } } : h,
      ),
      inventory: [
        {
          id: 'iseed',
          base: 'iron_sword',
          rarity: 'common',
          affixes: [],
          equippedBy: knight.id,
          tradeableAt: null,
        },
      ],
    }
    const { states } = harness(on, state)
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
    const ui = await $.ui.mount({ plugin: 'promptfall', surface, ...PANE })
    expect(await ui.find({ key: 'vendor-iseed' })).toBeUndefined()
    expect(await ui.find({ key: 'unequip-iseed' })).toBeDefined()
    await ui.press({ key: 'unequip-iseed' })
    const view = states.get('view') as GameView
    expect(view.inventory[0]?.equippedBy).toBeNull()
    expect(await ui.find({ key: 'vendor-iseed' })).toBeDefined()
    await ui.unmount()
  })
}
