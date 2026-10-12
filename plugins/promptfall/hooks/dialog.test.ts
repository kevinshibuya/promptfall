import type { On } from 'claude-code'
import { expect, type Mounted, mock, type TestBody } from 'claude-code/testing'
import type { GameView } from '../types'
import { test } from './testing'
import { paneText } from './ui/pane/testing'
import { approveAs, Ledger, type LinkApprover } from './vendor/ledger.js'
import { MemoryKeyValue } from './vendor/protocol.js'
import { createInitialState, type GameState, hashState, type Item } from './vendor/sim.js'

const SURFACES = ['terminal', 'desktop'] as const

/** A store already holding an account whose state the test chose. */
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
  // The sandbox switch reads the environment: unset here.
  mock.env(on, {})
  on('ui.toast', () => ({ value: undefined }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  mock.clock(on, { now: 1_000_000 })
  return { states, data }
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

type Ui = Pick<Mounted<'terminal', 'Pane'>, 'findAll' | 'press'>

/** Presses the pane stop that carries `hotkey` (a command window item, Yes, No). */
async function hot(ui: Ui, hotkey: string) {
  const b = (await ui.findAll({ type: 'Button' })).find((x) => x.props.hotkey === hotkey)
  if (!b?.key) throw new Error(`no stop on ${hotkey}`)
  await ui.press({ key: b.key })
}

for (const surface of SURFACES) {
  test(`Inventory draws the windows, and row, Vendor, Yes vendors the item on ${surface}`, async ($, on) => {
    const { states } = harness(on, seeded())
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
    const ui = await $.ui.mount({ plugin: 'promptfall', surface, ...PANE })
    expect(await paneText(ui)).toMatch(/Iron Sword/)
    // The windows replace the old rows: no Text row and no visible Button names the item.
    expect(await ui.find({ type: 'Text', text: /Iron Sword/ })).toBeUndefined()
    await ui.press({ key: 'row:iseed' })
    expect(await paneText(ui)).toMatch(/What will you do with Iron Sword\?/)
    await hot(ui, 'v')
    expect(await paneText(ui)).toMatch(/Sell Iron Sword to the shop for 2G\?/)
    await ui.press({ key: 'yes' })
    const view = states.get('view') as GameView
    expect(view.inventory).toHaveLength(0)
    expect(view.gold).toBe(2)
    expect(await paneText(ui)).not.toMatch(/Iron Sword/)
    await ui.unmount()
  })

  test(`back closes an open command window on ${surface}`, async ($, on) => {
    const { states } = harness(on, seeded())
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
    const ui = await $.ui.mount({ plugin: 'promptfall', surface, ...PANE })
    await ui.press({ key: 'row:iseed' })
    expect((states.get('dialog') as { menu: unknown }).menu).not.toBeNull()
    await ui.press({ key: 'back' })
    expect((states.get('dialog') as { menu: unknown }).menu).toBeNull()
    expect(await paneText(ui)).not.toMatch(/What will you do/)
    await ui.unmount()
  })

  test(`recruiting without gold puts the refusal in the message window on ${surface}`, async ($, on) => {
    harness(on, seeded())
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
    const ui = await $.ui.mount({ plugin: 'promptfall', surface, ...PANE })
    await ui.press({ key: 'tab-heroes' })
    await ui.press({ key: 'row:recruit' })
    expect(await paneText(ui)).toMatch(/Refused: not_enough_gold/)
    await ui.unmount()
  })

  test(`three Party picks set the party on ${surface}`, async ($, on) => {
    const { states } = harness(on, seeded())
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
    const ui = await $.ui.mount({ plugin: 'promptfall', surface, ...PANE })
    await ui.press({ key: 'tab-heroes' })
    const before = states.get('view') as GameView
    const archer = before.roster.find((h) => h.cls === 'archer')
    const [knight, mage] = before.roster
    if (!archer || !knight || !mage) throw new Error('roster')
    for (const h of [knight, archer, mage]) {
      await ui.press({ key: `row:${h.id}` })
      await hot(ui, 'p')
    }
    const after = states.get('view') as GameView
    expect(after.heroes.map((h) => h.id)).toEqual([knight.id, archer.id, mage.id])
    expect(after.roster.find((h) => h.id === archer.id)?.inParty).toBe(true)
    await ui.unmount()
  })

  test(`Unequip from the command window frees a worn item on ${surface}`, async ($, on) => {
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
    await ui.press({ key: 'row:iseed' })
    // Worn: no Vendor in the command window.
    expect((await ui.findAll({ type: 'Button' })).some((b) => b.props.hotkey === 'v')).toBe(false)
    await hot(ui, 'u')
    expect((states.get('view') as GameView).inventory[0]?.equippedBy).toBeNull()
    await ui.press({ key: 'row:iseed' })
    expect((await ui.findAll({ type: 'Button' })).some((b) => b.props.hotkey === 'v')).toBe(true)
    await ui.unmount()
  })

  test(`deleting the account resets this machine and bootstraps a fresh one on ${surface}`, async ($, on) => {
    const { states, data } = harness(on, seeded())
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
    const ui = await $.ui.mount({ plugin: 'promptfall', surface, ...PANE })
    await ui.press({ key: 'tab-account' })
    await ui.press({ key: 'row:delete' })
    expect(await paneText(ui)).toMatch(/Delete your account on this server\?/)
    // No deletes nothing.
    await ui.press({ key: 'no' })
    expect(data.has('promptfall:pf:acct:acct-1:record')).toBe(true)
    await ui.press({ key: 'row:delete' })
    await ui.press({ key: 'yes' })
    const view = states.get('view') as GameView
    expect(view.accountId).not.toBe('acct-1')
    expect(view.inventory).toHaveLength(0)
    expect(states.get('mode')).toBe('primary')
    // The ledger dropped the account and its token; the machine's reset dropped the rest.
    expect(data.has('promptfall:pf:acct:acct-1:record')).toBe(false)
    expect(data.has('promptfall:pf:token:token-1')).toBe(false)
    expect(data.get('promptfall:deviceToken')).not.toBe('token-1')
    // The same server, and the message window says what happened.
    expect(data.get('promptfall:server')).toBe('local')
    expect(states.get('notice')).toMatch(/account on this server is deleted/)
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
  options: {
    linked?: boolean
    flags?: Record<string, boolean>
    listings?: number
    /** The bot also lists a fourth hero, out of its party. */
    heroListing?: boolean
    /** The listed items carry two affixes, so a listing's detail is long. */
    affixed?: boolean
    /** The bot's inventory has no free slot once its items are listed. */
    botFull?: boolean
    /** Who approves a link; default the first poll as `player`. */
    approver?: LinkApprover
  } = {},
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
    linkApprover: options.approver ?? approveAs('player'),
  })
  const player = await ledger.host.mint({
    state: { ...createInitialState(61), gold: 5000, inventory: [rareItem('iR')] },
    name: 'player',
    linked: options.linked ?? true,
  })
  const botState = createInitialState(62)
  const spare = botState.roster[0]
  const bot = await ledger.host.mint({
    state: {
      ...botState,
      gold: 50_000,
      inventory: Array.from({ length: options.listings ?? 3 }, (_, i) => ({
        ...rareItem(`iB${i}`),
        ...(options.affixed
          ? {
              affixes: [
                { id: 'brutal', value: 5 },
                { id: 'keen', value: 1 },
              ],
            }
          : {}),
      })),
      roster:
        options.heroListing && spare
          ? [...botState.roster, { ...spare, id: 'hB', rarity: 'rare' as const }]
          : botState.roster,
      ...(options.botFull ? { inventoryCap: 0 } : {}),
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
    if (options.heroListing) {
      now += 1
      await ledger.list(botAuth, { kind: 'hero', id: 'hB', price: 500 })
    }
    await ledger.placeOrder(botAuth, {
      base: 'steel_longsword',
      minRarity: 'rare',
      affixId: null,
      maxPrice: 300,
    })
  }
  const sent: Sent[] = []
  /** `worldFlags` overrides the snapshot's flags; `chatDown` and `batchesDown` throw on those routes. */
  const net = {
    worldFlags: null as Record<string, boolean> | null,
    chatDown: false,
    batchesDown: false,
  }
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
        if (net.batchesDown) throw new Error('connect ECONNREFUSED')
        result = await ledger.submit(body, auth)
        break
      case 'GET /v1/world': {
        const w = await ledger.world(auth, Number(query.since ?? 0))
        result = net.worldFlags && !('reason' in w) ? { ...w, flags: net.worldFlags } : w
        break
      }
      case 'POST /v1/chat':
        if (net.chatDown) throw new Error('connect ECONNREFUSED')
        result = await ledger.chat(auth, body.text)
        break
      case 'GET /v1/leaderboards':
        result = await ledger.leaderboards(auth)
        break
      case 'GET /v1/account':
        result = await ledger.account(auth)
        break
      case 'POST /v1/link/github':
        result = await ledger.linkStart(auth)
        break
      case 'POST /v1/link/github/poll':
        result = await ledger.linkPoll(auth, body.code)
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
  return { ledger, player, bot, sent, net }
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
  // The sandbox switch reads the environment: unset here.
  mock.env(on, {})
  const toasts: string[] = []
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  const clock = mock.clock(on, { now: 1_000_000 })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...PANE })
  return { ui, states, clock, toasts }
}

test('the sell window lists matching orders with nets, then Set a price; a typed price shows the fee', async ($, on) => {
  const { player } = await marketHarness(on)
  const { ui, states } = await startOnTest($, on, player)
  await ui.press({ key: 'row:iR' })
  await hot(ui, 's')
  const text = await paneText(ui)
  expect(text).toMatch(/Buy orders/)
  expect(text).toMatch(/300G, you get 285G/)
  expect(text.indexOf('Buy orders')).toBeLessThan(text.indexOf('Set a price'))
  // The orders load after the window opens: the ▶ stays on Set a price, the row it was on.
  expect(text).toMatch(/▶Set a price/)
  const sell = (states.get('dialog') as { sell: { at: number; matching: unknown[] } }).sell
  expect(sell.at).toBe(sell.matching.length)
  await ui.input({ key: 'price', text: '1000', kind: 'change' })
  expect(await paneText(ui)).toMatch(/Fee 20G · you get 950G/)
  // An order accepted from the window fills it.
  const accept = (states.get('dialog') as { sell: { matching: { id: string }[] } }).sell.matching
  expect(accept.length).toBeGreaterThan(0)
  await ui.unmount()
})

test('an order whose buyer has no free slot says the buyer is full', async ($, on) => {
  const { player } = await marketHarness(on, { botFull: true })
  const { ui } = await startOnTest($, on, player)
  await ui.press({ key: 'row:iR' })
  await hot(ui, 's')
  expect(await paneText(ui)).toMatch(/300G, you get 285G/)
  await ui.press({ key: 'menu:0' })
  const text = await paneText(ui)
  expect(text).toMatch(/The buyer's inventory is full/)
  expect(text).not.toMatch(/No free slot/)
  await ui.unmount()
})

test("a bought item's sell window says when it becomes tradeable, with no price Input", async ($, on) => {
  const { player } = await marketHarness(on)
  const { ui, states } = await startOnTest($, on, player)
  await buyFirst(ui)
  const bought = (states.get('view') as GameView).inventory.find((i) => i.id.startsWith('t'))
  await ui.press({ key: 'tab-inventory' })
  await ui.press({ key: `row:${bought?.id}` })
  await hot(ui, 's')
  expect(await paneText(ui)).toMatch(/Tradeable in (1d|23h)/)
  expect(await ui.find({ key: 'price' })).toBeUndefined()
  await ui.unmount()
})

test('a closed market says so in the sell window', async ($, on) => {
  const a = await marketHarness(on, { flags: { 'market.enabled': false } })
  const { ui } = await startOnTest($, on, a.player)
  await ui.press({ key: 'row:iR' })
  await hot(ui, 's')
  expect(await paneText(ui)).toMatch(/The market is closed\./)
  await ui.unmount()
})

test('a server switch closes the sell window and the command window', async ($, on) => {
  const { player } = await marketHarness(on)
  const { ui, states } = await startOnTest($, on, player)
  await ui.press({ key: 'row:iR' })
  await hot(ui, 's')
  expect((states.get('dialog') as { sell: unknown }).sell).not.toBeNull()
  await $.command.run({
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 120 },
    command: 'promptfall',
    args: 'server local',
  })
  const d = states.get('dialog') as { sell: unknown; menu: unknown }
  expect([d.sell, d.menu]).toEqual([null, null])
  expect(await paneText(ui)).not.toMatch(/Buy orders/)
  await ui.unmount()
})

// ---------------------------------------------------------------------------
// Market

/** The listing row stops the Market pane mounts. */
async function listingRows(ui: Ui): Promise<string[]> {
  return (await ui.findAll({ type: 'Button' }))
    .map((b) => b.key ?? '')
    .filter((k) => /^row:L/.test(k))
}

/** Opens the Market and says Yes to the first listing. */
async function buyFirst(ui: Ui) {
  await ui.press({ key: 'tab-market' })
  const [row] = await listingRows(ui)
  if (!row) throw new Error('no listing row')
  await ui.press({ key: row })
  await ui.press({ key: 'yes' })
}

for (const surface of SURFACES) {
  test(`the Market tab loads page 0 and draws its windows, with no text rows, on ${surface}`, async ($, on) => {
    const { player, sent } = await marketHarness(on)
    const { ui } = await startOnTest($, on, player)
    await ui.unmount()
    const pane = await $.ui.mount({ plugin: 'promptfall', surface, ...PANE })
    await pane.press({ key: 'tab-market' })
    const browses = sent.filter((r) => r.path === '/v1/listings' && r.method === 'GET')
    expect(browses.at(-1)?.query.page).toBe('0')
    const text = await paneText(pane)
    expect(text).toMatch(/Market: items, cheapest/)
    expect(text).toMatch(/Steel Longsword/)
    expect(text).toMatch(/Brindle/)
    expect(text).toMatch(/100G/)
    expect(await pane.find({ type: 'Text', text: /Steel Longsword/ })).toBeUndefined()
    expect(await listingRows(pane)).toHaveLength(3)
    await pane.unmount()
  })
}

test('Filters, then the kind item, flips the kind and refetches page 0', async ($, on) => {
  const { player, sent } = await marketHarness(on, { listings: 12 })
  const { ui } = await startOnTest($, on, player)
  await ui.press({ key: 'tab-market' })
  await ui.press({ key: 'row:next' })
  const browses = () => sent.filter((r) => r.path === '/v1/listings' && r.method === 'GET')
  expect(browses().at(-1)?.query.page).toBe('1')
  await ui.press({ key: 'row:filters' })
  expect(await paneText(ui)).toMatch(/Change the search\./)
  await ui.press({ key: 'menu:0' })
  expect(browses().at(-1)?.query).toMatchObject({ page: '0', kind: 'hero' })
  // The filter window stays open, its ▶ on Kind.
  expect(await paneText(ui)).toMatch(/Kind: heroes/)
  expect(await paneText(ui)).toMatch(/No listings match\./)
  await ui.unmount()
})

test('a listing row asks first, then Yes buys once and the item arrives', async ($, on) => {
  const { player, sent } = await marketHarness(on)
  const { ui, states } = await startOnTest($, on, player)
  await ui.press({ key: 'tab-market' })
  const [row] = await listingRows(ui)
  await ui.press({ key: row ?? '' })
  expect(await paneText(ui)).toMatch(/Buy Steel Longsword for 10[0-2]G\?/)
  await ui.press({ key: 'yes' })
  const buys = sent.filter((r) => r.method === 'POST' && /\/buy$/.test(r.path))
  expect(buys).toHaveLength(1)
  const view = states.get('view') as GameView
  expect(view.inventory.some((i) => i.id.startsWith('t'))).toBe(true)
  expect(view.gold).toBeLessThan(5000)
  await ui.unmount()
})

test('the gate shows for an unlinked player and a listing row asks nothing', async ($, on) => {
  const a = await marketHarness(on, { linked: false })
  const { ui } = await startOnTest($, on, a.player)
  await ui.press({ key: 'tab-market' })
  expect(await paneText(ui)).toMatch(/Link your GitHub account: press a for the Account tab/)
  const [row] = await listingRows(ui)
  await ui.press({ key: row ?? '' })
  expect(await ui.find({ key: 'yes' })).toBeUndefined()
  await ui.unmount()
})

test('a server switch drops a pending buy Yes/No and the market page', async ($, on) => {
  const { player, sent } = await marketHarness(on)
  const { ui, states } = await startOnTest($, on, player)
  await ui.press({ key: 'tab-market' })
  const [row] = await listingRows(ui)
  await ui.press({ key: row ?? '' })
  expect(await ui.find({ key: 'yes' })).toBeDefined()
  await $.command.run({ ...RUN, command: 'promptfall', args: 'server local' })
  expect((states.get('dialog') as { menu: unknown }).menu).toBeNull()
  expect((states.get('market') as { page: unknown }).page).toBeNull()
  expect(await ui.find({ key: 'yes' })).toBeUndefined()
  expect(sent.filter((r) => /\/buy$/.test(r.path))).toHaveLength(0)
  await ui.unmount()
})

test('a session that is not playing still browses the market, and its rows buy nothing', async ($, on) => {
  const { player } = await marketHarness(on)
  const { ui, states } = await startOnTest($, on, player, {
    'promptfall:lease': { owner: 'other', until: 9_999_999_999_999 },
  })
  expect(states.get('mode')).toBe('secondary')
  await ui.press({ key: 'tab-market' })
  expect(await paneText(ui)).toMatch(/Steel Longsword/)
  const [row] = await listingRows(ui)
  await ui.press({ key: row ?? '' })
  expect(await ui.find({ key: 'yes' })).toBeUndefined()
  await ui.unmount()
})

// ---------------------------------------------------------------------------
// Orders

test('New buy order, its picks and a typed price place a NewOrder', async ($, on) => {
  const { player, sent } = await marketHarness(on)
  const { ui } = await startOnTest($, on, player)
  await ui.press({ key: 'tab-orders' })
  await ui.press({ key: 'row:new' })
  expect(await paneText(ui)).toMatch(/Pick what to buy, then a price\./)
  // Base: the bases sorted by id, Iron Sword the 15th.
  await ui.press({ key: 'menu:0' })
  expect(await paneText(ui)).toMatch(/Which base\?/)
  await ui.press({ key: 'menu:14' })
  // Rarity: rare, epic, legendary.
  await ui.press({ key: 'menu:1' })
  await ui.press({ key: 'menu:1' })
  // Affix: any, then the affixes sorted by id, Brutal first.
  await ui.press({ key: 'menu:2' })
  await ui.press({ key: 'menu:1' })
  expect(await paneText(ui)).toMatch(/Base: Iron Sword/)
  await ui.input({ key: 'order-price', text: '200', kind: 'change' })
  expect(await paneText(ui)).toMatch(/Buy order: Iron Sword epic\+, with Brutal, up to 200G\./)
  await ui.input({ key: 'order-price', text: '200' })
  const posted = sent.filter((r) => r.method === 'POST' && r.path === '/v1/orders')
  expect(posted.map((r) => r.body)).toEqual([
    { base: 'iron_sword', minRarity: 'epic', affixId: 'brutal', maxPrice: 200 },
  ])
  expect(await paneText(ui)).toMatch(/Iron Sword epic\+/)
  expect(await ui.find({ key: 'order-price' })).toBeUndefined()
  await ui.unmount()
})

test('a listing row, then Yes, cancels the listing', async ($, on) => {
  const { ledger, player, sent } = await marketHarness(on)
  const listed = await ledger.list(
    { deviceToken: player.deviceToken },
    { kind: 'item', id: 'iR', price: 900 },
  )
  const { ui } = await startOnTest($, on, player)
  await ui.press({ key: 'tab-orders' })
  expect(await paneText(ui)).toMatch(/My listings/)
  const row = (await ui.findAll({ type: 'Button' })).find((b) => /^row:l-/.test(b.key ?? ''))
  expect(row).toBeDefined()
  await ui.press({ key: row?.key ?? '' })
  expect(await paneText(ui)).toMatch(/Cancel the listing of Steel Longsword\? The fee is kept\./)
  await ui.press({ key: 'yes' })
  expect(
    sent.filter((r) => r.method === 'DELETE' && r.path.startsWith('/v1/listings/')),
  ).toHaveLength(1)
  expect(listed).toBeDefined()
  await ui.unmount()
})

// ---------------------------------------------------------------------------
// Chat and Leaderboards

const RUN = {
  origin: { kind: 'composer' },
  presentation: { isFullscreen: false, columns: 120 },
} as const

const chatPosts = (sent: Sent[]) => sent.filter((r) => r.method === 'POST' && r.path === '/v1/chat')

for (const surface of SURFACES) {
  test(`the Chat tab shows the newest message and the compose field, not focused, on ${surface}`, async ($, on) => {
    const { ledger, player, bot } = await marketHarness(on)
    await ledger.chat({ deviceToken: bot.deviceToken }, 'first line')
    await ledger.chat({ deviceToken: bot.deviceToken }, 'second line')
    const { ui } = await startOnTest($, on, player)
    await ui.unmount()
    const pane = await $.ui.mount({ plugin: 'promptfall', surface, ...PANE })
    await pane.press({ key: 'tab-chat' })
    const text = await paneText(pane)
    expect(text).toMatch(/Brindle: first line/)
    expect(text).toMatch(/Brindle: second line/)
    const compose = await pane.find({ key: 'compose' })
    expect(compose?.type).toBe('Input')
    expect(compose?.props.autoFocus).toBeUndefined()
    expect(await pane.find({ key: 'row:newest' })).toBeDefined()
    await pane.unmount()
  })
}

test('Enter posts the line, it shows before the next poll, and the field empties', async ($, on) => {
  const { player, sent } = await marketHarness(on)
  const { ui } = await startOnTest($, on, player)
  await ui.press({ key: 'tab-chat' })
  await ui.input({ key: 'compose', text: 'hello', kind: 'change' })
  await ui.input({ key: 'compose', text: 'hello' })
  expect(chatPosts(sent).map((r) => r.body)).toEqual([{ text: 'hello' }])
  expect(await paneText(ui)).toMatch(/player: hello/)
  expect((await ui.find({ key: 'compose' }))?.props.value).toBe('')
  await ui.unmount()
})

test('a refusal flashes for 5 s; a thrown post flashes Server unreachable and sets no notice', async ($, on) => {
  const { player, net, sent } = await marketHarness(on)
  const { ui, states, clock } = await startOnTest($, on, player)
  await ui.press({ key: 'tab-chat' })
  await ui.input({ key: 'compose', text: 'a'.repeat(201) })
  expect(await paneText(ui)).toMatch(/Too long: 200 characters at most/)
  await clock.advance(5_000)
  expect(await paneText(ui)).not.toMatch(/Too long/)
  // Past the wire limit (2000): refused here as too long, not sent and read as an outage.
  const posts = chatPosts(sent).length
  await ui.input({ key: 'compose', text: 'b'.repeat(2001) })
  expect(await paneText(ui)).toMatch(/Too long: 200 characters at most/)
  expect(chatPosts(sent)).toHaveLength(posts)
  await clock.advance(5_000)
  net.chatDown = true
  await ui.input({ key: 'compose', text: 'anyone there?' })
  expect(await paneText(ui)).toMatch(/Server unreachable/)
  expect(states.get('notice') ?? null).toBeNull()
  await ui.unmount()
})

test('in an outage Enter flashes Server unreachable and posts nothing', async ($, on) => {
  const { player, sent, net } = await marketHarness(on)
  const { ui, clock } = await startOnTest($, on, player)
  net.batchesDown = true
  await clock.advance(16_000)
  await ui.press({ key: 'tab-chat' })
  await ui.input({ key: 'compose', text: 'hello' })
  expect(await paneText(ui)).toMatch(/Server unreachable/)
  expect(chatPosts(sent)).toHaveLength(0)
  await ui.unmount()
})

test("the snapshot's closed chat wins over the bootstrap config", async ($, on) => {
  const a = await marketHarness(on)
  a.net.worldFlags = { 'chat.enabled': false }
  const { ui, states, clock } = await startOnTest($, on, a.player)
  await clock.advance(15_000)
  expect((states.get('view') as GameView).account.chatOpen).toBe(true)
  await ui.press({ key: 'tab-chat' })
  expect(await paneText(ui)).toMatch(/Chat is closed\./)
  expect(await ui.find({ key: 'compose' })).toBeUndefined()
  await ui.unmount()
})

test('an unlinked player reads the link gate in the Chat tab', async ($, on) => {
  const a = await marketHarness(on, { linked: false })
  const { ui } = await startOnTest($, on, a.player)
  await ui.press({ key: 'tab-chat' })
  expect(await paneText(ui)).toMatch(/Link your GitHub account: press a for the Account tab/)
  expect(await ui.find({ key: 'compose' })).toBeUndefined()
  await ui.unmount()
})

test('a secondary session posts too', async ($, on) => {
  const { player, sent } = await marketHarness(on)
  const { ui, states } = await startOnTest($, on, player, {
    'promptfall:lease': { owner: 'other', until: 9_999_999_999_999 },
  })
  expect(states.get('mode')).toBe('secondary')
  await ui.press({ key: 'tab-chat' })
  await ui.input({ key: 'compose', text: 'from the other tab' })
  expect(chatPosts(sent)).toHaveLength(1)
  expect(await paneText(ui)).toMatch(/from the other tab/)
  await ui.unmount()
})

test('in-process the Chat tab says chat needs a server', async ($, on) => {
  harness(on, seeded())
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-chat' })
  expect(await paneText(ui)).toMatch(/Chat needs a server: \/promptfall server <url>/)
  expect(await ui.find({ key: 'compose' })).toBeUndefined()
  await ui.unmount()
})

test('a padded paste goes out cleaned, and a server refusal flashes in its words', async ($, on) => {
  const { player, sent } = await marketHarness(on)
  const { ui } = await startOnTest($, on, player)
  await ui.press({ key: 'tab-chat' })
  await ui.input({ key: 'compose', text: `${' '.repeat(2100)}hi` })
  expect(chatPosts(sent).map((r) => r.body)).toEqual([{ text: 'hi' }])
  expect(await paneText(ui)).not.toMatch(/Server unreachable/)
  await ui.input({ key: 'compose', text: 'what the heck' })
  expect(await paneText(ui)).toMatch(/That word is not allowed here/)
  await ui.unmount()
})

test('the Leaderboards tab fetches on open and shows both boards and who is online', async ($, on) => {
  const { player, sent } = await marketHarness(on)
  const { ui } = await startOnTest($, on, player)
  await ui.press({ key: 'tab-leaderboards' })
  expect(sent.some((r) => r.method === 'GET' && r.path === '/v1/leaderboards')).toBe(true)
  const text = await paneText(ui)
  expect(text).toMatch(/Online by zone: z1 1/)
  expect(text).toMatch(/Highest zone/)
  expect(text).toMatch(/\d\. Brindle +zone 1/)
  expect(text).toMatch(/\d\. player +zone 1/)
  expect(text).toMatch(/No boss damage yet this week\./)
  expect(
    (await ui.findAll({ type: 'Button' })).filter((b) => /^row:z-/.test(b.key ?? '')),
  ).toHaveLength(2)
  await ui.unmount()
})

test('closed leaderboards say so in place', async ($, on) => {
  const a = await marketHarness(on, { flags: { 'leaderboards.enabled': false } })
  const { ui } = await startOnTest($, on, a.player)
  await ui.press({ key: 'tab-leaderboards' })
  expect(await paneText(ui)).toMatch(/Leaderboards are closed\./)
  await ui.unmount()
})

test('/promptfall chat and /promptfall leaderboards open on those tabs', async ($, on) => {
  const { player, sent } = await marketHarness(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  const { ui, states } = await startOnTest($, on, player)
  await $.command.run({ ...RUN, command: 'promptfall', args: 'chat' })
  expect(states.get('dialogTab')).toBe('chat')
  await $.command.run({ ...RUN, command: 'promptfall', args: 'leaderboards' })
  expect(states.get('dialogTab')).toBe('leaderboards')
  expect(sent.some((r) => r.method === 'GET' && r.path === '/v1/leaderboards')).toBe(true)
  await ui.unmount()
})

// ---------------------------------------------------------------------------
// Account and Odds

for (const surface of SURFACES) {
  test(`the Account rows show the settings and a press changes them on ${surface}`, async ($, on) => {
    const { states, data } = harness(on, seeded())
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
    const ui = await $.ui.mount({ plugin: 'promptfall', surface, ...PANE })
    await ui.press({ key: 'tab-account' })
    const before = await paneText(ui)
    expect(before).toMatch(/Sound:? +quiet/)
    expect(before).toMatch(/Motion:? +full/)
    expect(before).toMatch(/Renderer:? +auto \(/)
    await ui.press({ key: 'row:sound' })
    await ui.press({ key: 'row:motion' })
    await ui.press({ key: 'row:renderer' })
    const next = { sound: 'normal', motion: 'still', renderer: 'image', probed: null }
    expect(data.get('promptfall:settings')).toEqual(next)
    expect(states.get('settings')).toEqual(next)
    const after = await paneText(ui)
    expect(after).toMatch(/Sound:? +normal/)
    expect(after).toMatch(/Motion:? +still/)
    expect(after).toMatch(/Renderer:? +image \(from next start\)/)
    await ui.unmount()
  })
}

test('an Account press merges into the stored settings, not an older copy in this session', async ($, on) => {
  const { data } = harness(on, seeded())
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  // Another session turned sound loud after this one loaded its settings.
  data.set('promptfall:settings', { sound: 'loud', motion: 'full', renderer: 'auto' })
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'desktop', ...PANE })
  await ui.press({ key: 'tab-account' })
  await ui.press({ key: 'row:motion' })
  expect(data.get('promptfall:settings')).toEqual({
    sound: 'loud',
    motion: 'still',
    renderer: 'auto',
    probed: null,
  })
  await ui.unmount()
})

test('the Band row collapses the band', async ($, on) => {
  const { states } = harness(on, seeded())
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-account' })
  await ui.press({ key: 'row:band' })
  expect((states.get('prefs') as { collapsed: boolean }).collapsed).toBe(true)
  expect(await paneText(ui)).toMatch(/Band +collapsed/)
  await ui.unmount()
})

/** An approver shaped like GitHub's: its own code, URL and interval, then the polls' answers. */
function githubLike(
  answers: Awaited<ReturnType<LinkApprover['poll']>>[],
  start: Awaited<ReturnType<LinkApprover['start']>> = {
    code: 'WDJB-MJHT',
    url: 'https://github.com/login/device/select_account',
    intervalMs: 9000,
    deviceCode: 'device-1',
  },
): LinkApprover {
  return {
    start: async () => start,
    poll: async () => answers.shift() ?? { status: 'pending' },
  }
}

test('the link pane shows the code and the URL the server gives, polls at its interval, and unlocks trading', async ($, on) => {
  const approver = githubLike([{ status: 'pending' }, { status: 'approved', login: 'octocat' }])
  const a = await marketHarness(on, { linked: false, approver })
  const { ui, clock } = await startOnTest($, on, a.player)
  const polls = () => a.sent.filter((x) => x.path === '/v1/link/github/poll').length
  await ui.press({ key: 'tab-account' })
  await ui.press({ key: 'row:link' })
  expect(await paneText(ui)).toMatch(/Enter WDJB-MJHT at/)
  const link = await ui.find({ type: 'Link' })
  expect(link?.props.href).toBe('https://github.com/login/device/select_account')
  await clock.advance(8999)
  expect(polls()).toBe(0)
  await clock.advance(1)
  expect(polls()).toBe(1)
  expect(a.sent.find((x) => x.path === '/v1/link/github/poll')?.body).toEqual({ code: 'WDJB-MJHT' })
  await clock.advance(9000)
  expect(polls()).toBe(2)
  expect(await paneText(ui)).toMatch(/Linked as octocat/)
  await ui.press({ key: 'tab-market' })
  expect(await paneText(ui)).not.toMatch(/Link your GitHub account/)
  await ui.unmount()
})

test('a refused link start and an ended link say why in a toast and leave the account unlinked', async ($, on) => {
  const answers: Awaited<ReturnType<LinkApprover['poll']>>[] = [
    { status: 'ended', reason: 'denied', message: 'The link was declined on GitHub.' },
  ]
  let refuse = true
  const approver: LinkApprover = {
    start: async () =>
      refuse
        ? { refusal: 'link_unavailable', message: 'This server cannot link GitHub accounts.' }
        : {
            code: 'WDJB-MJHT',
            url: 'https://github.com/login/device',
            intervalMs: 5000,
            deviceCode: 'd',
          },
    poll: async () => answers.shift() ?? { status: 'pending' },
  }
  const a = await marketHarness(on, { linked: false, approver })
  const { ui, clock, toasts } = await startOnTest($, on, a.player)
  await ui.press({ key: 'tab-account' })
  await ui.press({ key: 'row:link' })
  expect(toasts).toContain('This server cannot link GitHub accounts.')
  expect(await paneText(ui)).toMatch(/Not linked\./)
  refuse = false
  await ui.press({ key: 'row:link' })
  expect(await paneText(ui)).toMatch(/Enter WDJB-MJHT at/)
  await clock.advance(5000)
  expect(toasts).toContain('The link was declined on GitHub.')
  const text = await paneText(ui)
  expect(text).toMatch(/Not linked\./)
  expect(text).not.toMatch(/WDJB-MJHT/)
  await ui.unmount()
})

test('the Odds tab draws the table, and the inventory row buys the expansion', async ($, on) => {
  const { states } = harness(on, { ...seeded(), gold: 2000 })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-odds' })
  const text = await paneText(ui)
  expect(text).toMatch(/Rarity +Zone +Boss +Tavern/)
  expect(text).toMatch(/Inventory \+10 slots/)
  const cap = (states.get('view') as GameView).inventoryCap
  await ui.press({ key: 'row:expand-inventory' })
  expect((states.get('view') as GameView).inventoryCap).toBe(cap + 10)
  await ui.unmount()
})

test('without gold the expansion is refused in the message window', async ($, on) => {
  harness(on, seeded())
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-odds' })
  await ui.press({ key: 'row:expand-inventory' })
  expect(await paneText(ui)).toMatch(/Refused: /)
  await ui.unmount()
})

// ---------------------------------------------------------------------------
// Review fixes

test('on a tall terminal the sell price field leaves the picture its 24 rows', async ($, on) => {
  const { player } = await marketHarness(on)
  const { ui } = await startOnTest($, on, player)
  await ui.unmount()
  const tall = { ...PANE, props: { ...PANE.props, scroll: { offset: 0, bodyRows: 30 } } }
  const pane = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...tall })
  await pane.press({ key: 'row:iR' })
  await hot(pane, 's')
  expect(await pane.find({ key: 'price' })).toBeDefined()
  expect((await pane.find({ type: 'Raster' }))?.props.rows).toBe(24)
  await pane.unmount()
})

test('/promptfall market opens on the list, closing a sell flow left open', async ($, on) => {
  const { player } = await marketHarness(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  const { ui, states } = await startOnTest($, on, player)
  await ui.press({ key: 'row:iR' })
  await hot(ui, 's')
  expect((states.get('dialog') as { sell: unknown }).sell).not.toBeNull()
  await $.command.run({ ...RUN, command: 'promptfall', args: 'market' })
  const d = states.get('dialog') as { sell: unknown; menu: unknown }
  expect([d.sell, d.menu]).toEqual([null, null])
  await ui.unmount()
})

test('at 13 rows the sell window lists presets rather than lose the pane to its field', async ($, on) => {
  const { player } = await marketHarness(on)
  const { ui } = await startOnTest($, on, player)
  await ui.unmount()
  // 100 columns is wide: 13 rows hold the windows, 12 (the field's row taken) would not.
  const short = { ...PANE, props: { ...PANE.props, scroll: { offset: 0, bodyRows: 13 } } }
  const pane = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...short })
  await pane.press({ key: 'row:iR' })
  await hot(pane, 's')
  const text = await paneText(pane)
  expect(text).not.toMatch(/needs more room/)
  expect(text).toMatch(/Sell Steel Longsword/)
  // Presets in place of Set a price, and the message says so.
  expect(text).not.toMatch(/Set a price/)
  expect(text).toMatch(/Pick an order or a price\./)
  expect(await pane.find({ key: 'price' })).toBeUndefined()
  expect((await pane.find({ type: 'Raster' }))?.props.rows).toBe(13)
  await pane.unmount()
})
