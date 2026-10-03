import type { On } from 'claude-code'
import { expect, mock, type TestBody, test } from 'claude-code/testing'
import type { GameView } from '../types'
import { Ledger } from './vendor/ledger.js'
import { MemoryKeyValue } from './vendor/protocol.js'
import { createInitialState, type GameState, hashState, type Item } from './vendor/sim.js'

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

// ---------------------------------------------------------------------------
// The market, against a ledger behind a mocked $.http.fetch at http://test.

const TEST_URL = 'http://test'

type Sent = { method: string; path: string; query: Record<string, string>; body: unknown }

function rareItem(id: string, base = 'steel_longsword'): Item {
  return { id, base, rarity: 'rare', affixes: [], equippedBy: null, tradeableAt: null }
}

function parseQuery(raw: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of raw.split('&')) {
    if (!part) continue
    const [k, v = ''] = part.split('=')
    if (k) out[decodeURIComponent(k)] = decodeURIComponent(v)
  }
  return out
}

/**
 * A remote ledger at http://test holding a player account (linked unless told
 * otherwise) and a bot with listings; the store points the session at it.
 */
async function marketHarness(
  on: On,
  options: { linked?: boolean; flags?: Record<string, boolean>; listings?: number } = {},
) {
  let now = 1_000_000
  let n = 0
  const ledger = new Ledger({
    kv: new MemoryKeyValue(),
    now: async () => now,
    minClientVersion: '0.1.0',
    seedSource: () => 5,
    tokenSource: () => `tok-${n++}`,
    flags: options.flags ?? {},
    linkApprover: async () => ({ login: 'player' }),
  })
  const player = await ledger.host.mint({
    state: { ...createInitialState(61), gold: 5000, inventory: [rareItem('iR')] },
    name: 'player',
    linked: options.linked ?? true,
  })
  const bot = await ledger.host.mint({
    state: {
      ...createInitialState(62),
      gold: 50_000,
      inventory: Array.from({ length: options.listings ?? 3 }, (_, i) => rareItem(`iB${i}`)),
    },
    name: 'Brindle',
    linked: true,
  })
  const botAuth = { deviceToken: bot.deviceToken }
  if (options.flags?.['market.enabled'] !== false) {
    for (let i = 0; i < (options.listings ?? 3); i++) {
      now += 1
      await ledger.list(botAuth, { kind: 'item', id: `iB${i}`, price: 100 + i })
    }
    await ledger.placeOrder(botAuth, {
      base: 'steel_longsword',
      minRarity: 'rare',
      affixId: null,
      maxPrice: 300,
    })
  }
  const sent: Sent[] = []
  on('http.fetch', async (_$, e) => {
    const rest = e.url.slice(TEST_URL.length)
    const [path = '', rawQuery = ''] = rest.split('?')
    const method = e.init?.method ?? 'GET'
    const query = parseQuery(rawQuery)
    const body = e.init?.body ? JSON.parse(e.init.body) : undefined
    sent.push({ method, path, query, body })
    const auth = { deviceToken: (e.init?.headers?.authorization ?? '').replace(/^Bearer /, '') }
    const id = path.split('/')[3] ?? ''
    const route = `${method} ${path.replace(/^(\/v1\/(?:listings|orders))\/(?!matching)[^/]+/, '$1/:id')}`
    let result: unknown
    switch (route) {
      case 'POST /v1/bootstrap':
        result = await ledger.bootstrap(body)
        break
      case 'POST /v1/batches':
        result = await ledger.submit(body, auth)
        break
      case 'GET /v1/account':
        result = await ledger.account(auth)
        break
      case 'GET /v1/listings': {
        const q: Record<string, unknown> = { ...query, page: Number(query.page) }
        result = await ledger.browse(auth, q as never)
        break
      }
      case 'POST /v1/listings':
        result = await ledger.list(auth, body)
        break
      case 'DELETE /v1/listings/:id':
        result = await ledger.cancelListing(auth, id)
        break
      case 'POST /v1/listings/:id/buy':
        result = await ledger.buy(auth, id)
        break
      case 'GET /v1/orders':
        result = await ledger.myOrders(auth)
        break
      case 'POST /v1/orders':
        result = await ledger.placeOrder(auth, body)
        break
      case 'DELETE /v1/orders/:id':
        result = await ledger.cancelOrder(auth, id)
        break
      case 'GET /v1/orders/matching':
        result = await ledger.matchingOrders(auth, query.itemId ?? '')
        break
      case 'POST /v1/orders/:id/fill':
        result = await ledger.fillOrder(auth, id, body.itemId)
        break
      default:
        return { value: { status: 404, ok: false, headers: {}, text: '{"error":"route"}' } }
    }
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify(result) } }
  })
  return { ledger, player, bot, sent }
}

async function startOnTest(
  $: Parameters<TestBody>[0],
  on: On,
  player: { deviceToken: string },
  seed: Record<string, unknown> = {},
) {
  const data = new Map<string, unknown>([
    ['promptfall:server', TEST_URL],
    [`promptfall:token:${TEST_URL}`, player.deviceToken],
    ...Object.entries(seed),
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
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...PANE })
  return { ui, states }
}

test('the Market tab renders the listings', async ($, on) => {
  const { player } = await marketHarness(on)
  const { ui } = await startOnTest($, on, player)
  await ui.press({ key: 'tab-market' })
  expect(await ui.find({ text: /Steel Longsword \(rare\)/ })).toBeDefined()
  expect(await ui.find({ text: /Brindle · 100g/ })).toBeDefined()
  expect(await ui.find({ text: /page 1\/1 · 3 listings/ })).toBeDefined()
  await ui.unmount()
})

test('a filter change goes back to page 0 and refetches', async ($, on) => {
  const { player, sent } = await marketHarness(on, { listings: 12 })
  const { ui } = await startOnTest($, on, player)
  await ui.press({ key: 'tab-market' })
  await ui.press({ key: 'market-next' })
  const browses = () => sent.filter((r) => r.path === '/v1/listings' && r.method === 'GET')
  expect(browses().at(-1)?.query.page).toBe('1')
  await ui.select({ key: 'market-rarity', value: 'epic' })
  expect(browses().at(-1)?.query).toMatchObject({ page: '0', minRarity: 'epic' })
  expect(await ui.find({ text: /No listings match/ })).toBeDefined()
  await ui.unmount()
})

test('buy asks first, then buys once and the item arrives', async ($, on) => {
  const { player, sent } = await marketHarness(on)
  const { ui, states } = await startOnTest($, on, player)
  await ui.press({ key: 'tab-market' })
  const listing = (await ui.findAll({ type: 'Button' })).find((b: { key?: string }) =>
    /^buy-L/.test(b.key ?? ''),
  )
  if (!listing?.key) throw new Error('no buy button')
  await ui.press({ key: listing.key })
  expect(await ui.find({ text: /Buy Steel Longsword for 10[0-2]g\?/ })).toBeDefined()
  await ui.press({ key: 'buy-confirm' })
  const buys = sent.filter((r) => r.method === 'POST' && /\/buy$/.test(r.path))
  expect(buys).toHaveLength(1)
  const view = states.get('view') as GameView
  expect(view.inventory.some((i) => i.id.startsWith('t'))).toBe(true)
  expect(view.gold).toBeLessThan(5000)
  await ui.unmount()
})

test('the sell flow lists matching orders first, then the price form with fee and net', async ($, on) => {
  const { player } = await marketHarness(on)
  const { ui } = await startOnTest($, on, player)
  await ui.press({ key: 'sell-iR' })
  expect(await ui.find({ key: 'accept-O3' })).toBeDefined()
  expect((await ui.find({ key: 'accept-O3' }))?.text ?? '').toMatch(/accept 300g, you get 285g/)
  const texts = (await ui.findAll({ type: 'Text' })).map((t: { text?: string }) => t.text ?? '')
  const matching = texts.findIndex((t: string) => t === 'Matching orders')
  const listFor = texts.findIndex((t: string) => t === 'List for')
  expect(matching).toBeGreaterThanOrEqual(0)
  expect(listFor).toBeGreaterThan(matching)
  await ui.input({ key: 'sell-price', text: '1000', kind: 'change' })
  expect(await ui.find({ text: /fee 20g · you get 950g/ })).toBeDefined()
  await ui.unmount()
})

test("a bought item's sell flow says when it becomes tradeable", async ($, on) => {
  const { player } = await marketHarness(on)
  const { ui, states } = await startOnTest($, on, player)
  await ui.press({ key: 'tab-market' })
  const listing = (await ui.findAll({ type: 'Button' })).find((b: { key?: string }) =>
    /^buy-L/.test(b.key ?? ''),
  )
  await ui.press({ key: listing?.key ?? '' })
  await ui.press({ key: 'buy-confirm' })
  const bought = (states.get('view') as GameView).inventory.find((i) => i.id.startsWith('t'))
  await ui.press({ key: 'tab-inventory' })
  await ui.press({ key: `sell-${bought?.id}` })
  expect(await ui.find({ text: /^Tradeable in (1d|23h)$/ })).toBeDefined()
  expect(await ui.find({ key: 'sell-price' })).toBeUndefined()
  await ui.unmount()
})

test('the order form places a NewOrder', async ($, on) => {
  const { player, sent } = await marketHarness(on)
  const { ui } = await startOnTest($, on, player)
  await ui.press({ key: 'tab-orders' })
  await ui.press({ key: 'order-new' })
  await ui.select({ key: 'order-base', value: 'iron_sword' })
  await ui.select({ key: 'order-rarity', value: 'epic' })
  await ui.select({ key: 'order-affix', value: 'brutal' })
  await ui.input({ key: 'order-price', text: '200' })
  const posted = sent.filter((r) => r.method === 'POST' && r.path === '/v1/orders')
  expect(posted.map((r) => r.body)).toEqual([
    { base: 'iron_sword', minRarity: 'epic', affixId: 'brutal', maxPrice: 200 },
  ])
  expect(await ui.find({ text: /Iron Sword epic\+ with Brutal/ })).toBeDefined()
  await ui.unmount()
})

test('the gates show for an unlinked player and a closed market', async ($, on) => {
  const a = await marketHarness(on, { linked: false })
  const { ui } = await startOnTest($, on, a.player)
  await ui.press({ key: 'tab-market' })
  expect(
    await ui.find({ text: 'Link your GitHub account: press a for the Account tab' }),
  ).toBeDefined()
  expect(
    (await ui.findAll({ type: 'Button' })).some((b: { key?: string }) =>
      /^buy-L/.test(b.key ?? ''),
    ),
  ).toBe(false)
  await ui.unmount()
})

test('a closed market says so', async ($, on) => {
  const a = await marketHarness(on, { flags: { 'market.enabled': false } })
  const { ui } = await startOnTest($, on, a.player)
  await ui.press({ key: 'tab-market' })
  expect(await ui.find({ text: 'The market is closed.' })).toBeDefined()
  await ui.press({ key: 'tab-inventory' })
  await ui.press({ key: 'sell-iR' })
  expect(await ui.find({ text: 'The market is closed.' })).toBeDefined()
  await ui.unmount()
})

test('a server switch drops a pending buy confirmation and the market page', async ($, on) => {
  const { player, sent } = await marketHarness(on)
  const { ui, states } = await startOnTest($, on, player)
  await ui.press({ key: 'tab-market' })
  const listing = (await ui.findAll({ type: 'Button' })).find((b: { key?: string }) =>
    /^buy-L/.test(b.key ?? ''),
  )
  await ui.press({ key: listing?.key ?? '' })
  expect(await ui.find({ text: /^Buy Steel Longsword/ })).toBeDefined()
  await $.command.run({
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 120 },
    command: 'promptfall',
    args: 'server local',
  })
  const market = states.get('market') as { confirm: string | null; page: unknown }
  expect(market.confirm).toBeNull()
  expect(market.page).toBeNull()
  expect(await ui.find({ key: 'buy-confirm' })).toBeUndefined()
  expect(sent.filter((r) => /\/buy$/.test(r.path))).toHaveLength(0)
  await ui.unmount()
})

test('a session that is not playing still browses the market', async ($, on) => {
  const { player } = await marketHarness(on)
  const { ui, states } = await startOnTest($, on, player, {
    'promptfall:lease': { owner: 'other', until: 9_999_999_999_999 },
  })
  expect(states.get('mode')).toBe('secondary')
  await ui.press({ key: 'tab-market' })
  expect(await ui.find({ text: /Steel Longsword \(rare\)/ })).toBeDefined()
  expect(
    (await ui.findAll({ type: 'Button' })).some((b: { key?: string }) =>
      /^buy-L/.test(b.key ?? ''),
    ),
  ).toBe(false)
  await ui.unmount()
})
