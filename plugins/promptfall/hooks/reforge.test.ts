// The reforge pick on the real pane against the in-process ledger: a roll keeps the pick open.
import type { On } from 'claude-code'
import { expect, type Mounted, mock } from 'claude-code/testing'
import type { DialogState, GameView } from '../types'
import { test } from './testing'
import { paneText } from './ui/pane/testing'
import { createInitialState, type GameState, hashState } from './vendor/sim.js'

const SURFACES = ['terminal', 'desktop'] as const

/** A store already holding an account whose state the test chose (dialog.test.ts's harness). */
function harness(on: On, state: GameState) {
  const data = new Map<string, unknown>([
    ['promptfall:server', 'local'],
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
  mock.env(on, {})
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

/** A tier-1 Rare longsword whose Vicious (3 to 7) rolled 3, and gold for one reforge at 60G. */
function rare(): GameState {
  return {
    ...createInitialState(99),
    gold: 100,
    inventory: [
      {
        id: 'irare',
        base: 'steel_longsword',
        rarity: 'rare',
        tier: 1,
        affixes: [{ id: 'vicious', value: 3 }],
        equippedBy: null,
        tradeableAt: null,
      },
    ],
  }
}

type Ui = Pick<Mounted<'terminal', 'Pane'>, 'findAll' | 'press'>

async function hot(ui: Ui, hotkey: string) {
  const b = (await ui.findAll({ type: 'Button' })).find((x) => x.props.hotkey === hotkey)
  if (!b?.key) throw new Error(`no stop on ${hotkey}`)
  await ui.press({ key: b.key })
}

const menuOf = (states: Map<string, unknown>) => (states.get('dialog') as DialogState).menu

for (const surface of SURFACES) {
  test(`a reforge leaves the menu open with the new value in place, and back closes it on ${surface}`, async ($, on) => {
    const { states } = harness(on, rare())
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
    const ui = await $.ui.mount({ plugin: 'promptfall', surface, ...PANE })
    await ui.press({ key: 'row:irare' })
    await hot(ui, 'f')
    expect(await paneText(ui)).toMatch(/Vicious \+3 atk · 3-7/)

    await ui.press({ key: 'menu:0' })
    const view = states.get('view') as GameView
    expect(view.gold).toBe(40)
    const rolled = view.inventory[0]?.affixes[0] ?? ''
    expect(rolled).not.toBe('Vicious +3 atk')
    expect(menuOf(states)).toMatchObject({ kind: 'reforge', itemId: 'irare' })
    const text = await paneText(ui)
    expect(text).toContain(`${rolled} · 3-7`)
    // The price stays on the pick's header.
    expect(text).toMatch(/Reforge 60G/)

    // 40G buys no second roll: the refusal shows and the pick stays.
    await ui.press({ key: 'menu:0' })
    expect(await paneText(ui)).toMatch(/Refused: not_enough_gold/)
    expect((states.get('view') as GameView).gold).toBe(40)
    expect(menuOf(states)).toMatchObject({ kind: 'reforge', itemId: 'irare' })

    await ui.press({ key: 'back' })
    expect(menuOf(states)).toBeNull()
    expect(await paneText(ui)).not.toMatch(/Reforge which affix\?/)
    await ui.unmount()
  })
}
