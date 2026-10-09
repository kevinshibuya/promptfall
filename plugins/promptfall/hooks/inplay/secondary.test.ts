import { expect } from 'claude-code/testing'
import { SANDBOX_PREFIX } from '../storage'
import { test } from '../testing'
import { EXPIRY_MS, Ledger } from '../vendor/ledger.js'
import { BOSS_GRID_MS, type KeyValue } from '../vendor/protocol.js'
import { createInitialState } from '../vendor/sim.js'
import { WORLD_POLL_MS } from '../world'
import { harness, SANDBOX_ON } from './harness'

/** A grid point plus a second: inside the window, the sandbox ledger's next poll would spawn a boss. */
const NOW = 100 * BOSS_GRID_MS + 1_000

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

/** The sandbox save's ledger entries, each value as text: what the store holds for the ledger. */
function ledgerEntries(data: Map<string, unknown>): Map<string, string> {
  const prefix = `${SANDBOX_PREFIX}pf:`
  return new Map(
    [...data.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, value]) => [key, JSON.stringify(value)]),
  )
}

/** The ledger keys written or deleted since `before`. */
function written(before: Map<string, string>, data: Map<string, unknown>): string[] {
  const after = ledgerEntries(data)
  const keys = new Set([...before.keys(), ...after.keys()])
  return [...keys].filter((key) => before.get(key) !== after.get(key)).sort()
}

test('a secondary reads the store without expiring listings or advancing the boss', async ($, on) => {
  const { data, states, clock } = harness(on, {}, SANDBOX_ON, NOW)
  // The sandbox save as another session left it: this session's account, and a seller's
  // listing a week and a second old, past its expiry.
  const kv: KeyValue = {
    get: async (key) => data.get(SANDBOX_PREFIX + key),
    set: async (key, value) => {
      data.set(SANDBOX_PREFIX + key, JSON.parse(JSON.stringify(value)))
    },
    delete: async (key) => {
      data.delete(SANDBOX_PREFIX + key)
    },
  }
  let n = 0
  const seeder = new Ledger({
    kv,
    now: async () => NOW - EXPIRY_MS - 1_000,
    minClientVersion: '0.1.0',
    seedSource: () => 5,
    tokenSource: () => `seed-${n++}`,
    linkApprover: async () => null,
    flags: { 'worldboss.enabled': false },
  })
  const sword = {
    id: 'iSword',
    base: 'steel_longsword',
    rarity: 'rare' as const,
    affixes: [],
    equippedBy: null,
    tradeableAt: null,
  }
  const seller = await seeder.host.mint({
    state: { ...createInitialState(3), gold: 10_000, inventory: [sword] },
    name: 'Ann',
    linked: true,
  })
  const listed = await seeder.list(
    { deviceToken: seller.deviceToken },
    { kind: 'item', id: 'iSword', price: 100 },
  )
  expect(listed.ok).toBe(true)
  const player = await seeder.host.mint({
    state: createInitialState(4),
    name: 'Pip',
    linked: false,
  })
  await kv.set('deviceToken', player.deviceToken)
  await kv.set('lease', { owner: 'other-tab', until: 9_999_999_999_999 })
  const before = ledgerEntries(data)

  // Starting as secondary polls the world once.
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  expect(states.get('mode')).toBe('secondary')
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-market' })
  await ui.press({ key: 'tab-orders' })
  await clock.advance(WORLD_POLL_MS)
  await clock.settle()
  expect(states.get('mode')).toBe('secondary')

  // The listing is still open and the seller's sword still on it; no boss was spawned.
  expect(written(before, data)).toEqual([])
  expect(data.get(`${SANDBOX_PREFIX}pf:listings`)).toEqual(['L0'])
  await ui.unmount()
})
