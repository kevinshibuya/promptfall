import type { On } from 'claude-code'
import { expect, mock, type TestBody, test } from 'claude-code/testing'
import type { GameView } from '../types'
import { decode } from './sprites/base64'
import { spriteFor } from './sprites/index'
import { artFrame } from './stage/compose'
import { encodeRaster } from './stage/raster'
import { DESKTOP_LIST_SPRITE_COLUMNS } from './stage/tuning'
import { CHAT_READ_ONLY, chatBody } from './ui/chat'
import { ordersBody } from './ui/orders'
import { listSpriteColumns } from './ui/sprites'
import type { Els } from './ui/trade'
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
  options: {
    linked?: boolean
    flags?: Record<string, boolean>
    listings?: number
    /** The bot also lists a fourth hero, out of its party. */
    heroListing?: boolean
    /** The listed items carry two affixes, so a listing's detail is long. */
    affixed?: boolean
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
    linkApprover: async () => ({ login: 'player' }),
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
  on('ui.toast', () => ({ value: undefined }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  const clock = mock.clock(on, { now: 1_000_000 })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...PANE })
  return { ui, states, clock }
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

// ---------------------------------------------------------------------------
// Chat and Leaderboards

const RUN = {
  origin: { kind: 'composer' },
  presentation: { isFullscreen: false, columns: 120 },
} as const

const chatPosts = (sent: Sent[]) => sent.filter((r) => r.method === 'POST' && r.path === '/v1/chat')

test('the Chat tab lists the messages newest at the bottom, with the compose box on both surfaces', async ($, on) => {
  const { ledger, player, bot } = await marketHarness(on)
  await ledger.chat({ deviceToken: bot.deviceToken }, 'first line')
  await ledger.chat({ deviceToken: bot.deviceToken }, 'second line')
  const { ui } = await startOnTest($, on, player)
  await ui.unmount()
  for (const surface of SURFACES) {
    const pane = await $.ui.mount({ plugin: 'promptfall', surface, ...PANE })
    await pane.press({ key: 'tab-chat' })
    const texts = (await pane.findAll({ type: 'Text' })).map((t) => t.text)
    const first = texts.indexOf('first line')
    expect(first).toBeGreaterThanOrEqual(0)
    expect(texts.indexOf('second line')).toBeGreaterThan(first)
    expect(await pane.find({ text: 'Brindle:' })).toBeDefined()
    expect(await pane.find({ key: 'chat-compose' })).toBeDefined()
    await pane.unmount()
  }
})

test('Enter posts the line, it shows before the next poll, and the box empties', async ($, on) => {
  const { player, sent } = await marketHarness(on)
  const { ui } = await startOnTest($, on, player)
  await ui.press({ key: 'tab-chat' })
  await ui.input({ key: 'chat-compose', text: 'hello', kind: 'change' })
  await ui.input({ key: 'chat-compose', text: 'hello' })
  expect(chatPosts(sent).map((r) => r.body)).toEqual([{ text: 'hello' }])
  expect(await ui.find({ type: 'Text', text: 'hello' })).toBeDefined()
  expect((await ui.find({ key: 'chat-compose' }))?.props.value).toBe('')
  await ui.unmount()
})

test('a refusal flashes for 5 s; a thrown post flashes Server unreachable and sets no notice', async ($, on) => {
  const { player, net, sent } = await marketHarness(on)
  const { ui, states, clock } = await startOnTest($, on, player)
  await ui.press({ key: 'tab-chat' })
  await ui.input({ key: 'chat-compose', text: 'a'.repeat(201) })
  expect(await ui.find({ text: 'Too long: 200 characters at most' })).toBeDefined()
  await clock.advance(5_000)
  expect(await ui.find({ text: 'Too long: 200 characters at most' })).toBeUndefined()
  // Past the wire limit (2000): refused here as too long, not sent and read as an outage.
  const posts = chatPosts(sent).length
  await ui.input({ key: 'chat-compose', text: 'b'.repeat(2001) })
  expect(await ui.find({ text: 'Too long: 200 characters at most' })).toBeDefined()
  expect(chatPosts(sent)).toHaveLength(posts)
  await clock.advance(5_000)
  net.chatDown = true
  await ui.input({ key: 'chat-compose', text: 'anyone there?' })
  expect(await ui.find({ text: 'Server unreachable' })).toBeDefined()
  expect(states.get('notice') ?? null).toBeNull()
  await ui.unmount()
})

test('in an outage Enter flashes Server unreachable and posts nothing', async ($, on) => {
  const { player, sent, net } = await marketHarness(on)
  const { ui, clock } = await startOnTest($, on, player)
  net.batchesDown = true
  await clock.advance(16_000)
  await ui.press({ key: 'tab-chat' })
  await ui.input({ key: 'chat-compose', text: 'hello' })
  expect(await ui.find({ text: 'Server unreachable' })).toBeDefined()
  expect(chatPosts(sent)).toHaveLength(0)
  await ui.unmount()
})

test("the snapshot's closed chat wins over the bootstrap config; unlinked reads the link gate", async ($, on) => {
  const a = await marketHarness(on)
  a.net.worldFlags = { 'chat.enabled': false }
  const { ui, states, clock } = await startOnTest($, on, a.player)
  await clock.advance(15_000)
  expect((states.get('view') as GameView).account.chatOpen).toBe(true)
  await ui.press({ key: 'tab-chat' })
  expect(await ui.find({ text: 'Chat is closed.' })).toBeDefined()
  expect(await ui.find({ key: 'chat-compose' })).toBeUndefined()
  await ui.unmount()
})

test('an unlinked player reads the link gate in the Chat tab', async ($, on) => {
  const a = await marketHarness(on, { linked: false })
  const { ui } = await startOnTest($, on, a.player)
  await ui.press({ key: 'tab-chat' })
  expect(
    await ui.find({ text: 'Link your GitHub account: press a for the Account tab' }),
  ).toBeDefined()
  expect(await ui.find({ key: 'chat-compose' })).toBeUndefined()
  await ui.unmount()
})

test('without an Input the Chat tab reads that posting needs a terminal or the desktop app', () => {
  const els = { Box: 'Box', Text: 'Text', Button: 'Button', Input: undefined } as unknown as Els
  const world = {
    snapshot: null,
    fetchedAt: null,
    stale: false,
    messages: [{ id: 1, name: 'Brindle', text: 'hi', at: 1 }],
    chatMark: 1,
    clock: null,
    committedDealt: null,
  }
  const view = {
    account: {
      linked: 'player',
      server: 'http://test',
      marketOpen: true,
      chatOpen: true,
      presenceOpen: true,
      leaderboardsOpen: true,
      bossOpen: true,
      returns: 0,
    },
  } as GameView
  const body = JSON.stringify(
    chatBody(
      els,
      view,
      world,
      { draft: '', busy: false, error: null },
      {
        setDraft: async () => undefined,
        post: async () => undefined,
      },
    ),
  )
  expect(body).toContain(CHAT_READ_ONLY)
  expect(body).not.toContain('chat-compose')
})

test('a secondary session posts too', async ($, on) => {
  const { player, sent } = await marketHarness(on)
  const { ui, states } = await startOnTest($, on, player, {
    'promptfall:lease': { owner: 'other', until: 9_999_999_999_999 },
  })
  expect(states.get('mode')).toBe('secondary')
  await ui.press({ key: 'tab-chat' })
  await ui.input({ key: 'chat-compose', text: 'from the other tab' })
  expect(chatPosts(sent)).toHaveLength(1)
  expect(await ui.find({ type: 'Text', text: 'from the other tab' })).toBeDefined()
  await ui.unmount()
})

test('the Leaderboards tab fetches on open, shows the zone counts and both boards, mine highlighted', async ($, on) => {
  const { player, sent } = await marketHarness(on)
  const { ui } = await startOnTest($, on, player)
  await ui.press({ key: 'tab-leaderboards' })
  expect(sent.some((r) => r.method === 'GET' && r.path === '/v1/leaderboards')).toBe(true)
  expect(await ui.find({ text: 'Online by zone: z1 1' })).toBeDefined()
  expect(await ui.find({ text: 'Highest zone' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^\d\. Brindle {2}zone 1$/ })).toBeDefined()
  const mine = await ui.find({ type: 'Text', text: /^\d\. player {2}zone 1$/ })
  expect(mine?.props.color).toBe('cyan')
  expect(await ui.find({ text: 'no boss damage yet this week' })).toBeDefined()
  await ui.unmount()
})

test('closed leaderboards say so', async ($, on) => {
  const a = await marketHarness(on, { flags: { 'leaderboards.enabled': false } })
  const { ui } = await startOnTest($, on, a.player)
  await ui.press({ key: 'tab-leaderboards' })
  expect(await ui.find({ text: 'Leaderboards are closed.' })).toBeDefined()
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

test('in-process the Chat tab says chat needs a server', async ($, on) => {
  harness(on, seeded())
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-chat' })
  expect(await ui.find({ text: 'Chat needs a server: /promptfall server <url>' })).toBeDefined()
  expect(await ui.find({ key: 'chat-compose' })).toBeUndefined()
  await ui.unmount()
})

test('a padded paste goes out cleaned, and a server refusal flashes in its words', async ($, on) => {
  const { player, sent } = await marketHarness(on)
  const { ui } = await startOnTest($, on, player)
  await ui.press({ key: 'tab-chat' })
  await ui.input({ key: 'chat-compose', text: `${' '.repeat(2100)}hi` })
  expect(chatPosts(sent).map((r) => r.body)).toEqual([{ text: 'hi' }])
  expect(await ui.find({ text: 'Server unreachable' })).toBeUndefined()
  await ui.input({ key: 'chat-compose', text: 'what the heck' })
  expect(await ui.find({ text: 'That word is not allowed here' })).toBeDefined()
  await ui.unmount()
})

for (const surface of SURFACES) {
  test(`the Account tab shows the settings and a press changes them on ${surface}`, async ($, on) => {
    const { states, data } = harness(on, seeded())
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
    const ui = await $.ui.mount({ plugin: 'promptfall', surface, ...PANE })
    await ui.press({ key: 'tab-account' })
    expect(await ui.find({ text: 'Sound: off' })).toBeDefined()
    expect(await ui.find({ text: 'Motion: full' })).toBeDefined()
    expect(await ui.find({ text: /^Renderer: auto \(/ })).toBeDefined()
    await ui.press({ key: 'setting-sound' })
    await ui.press({ key: 'setting-motion' })
    await ui.press({ key: 'setting-renderer' })
    const next = { sound: true, motion: 'still', renderer: 'image' }
    expect(data.get('promptfall:settings')).toEqual(next)
    expect(states.get('settings')).toEqual(next)
    expect(await ui.find({ text: 'Sound: on' })).toBeDefined()
    expect(await ui.find({ text: 'Motion: still' })).toBeDefined()
    expect(await ui.find({ text: 'Renderer: image (from next start)' })).toBeDefined()
    await ui.unmount()
  })
}

// ---------------------------------------------------------------------------
// List sprites

const RENDERER = (renderer: string) => ({ sound: false, motion: 'full', renderer })

/** The 8 × 2 Raster an item row draws on a half-block terminal. */
const smallCells = (base: string) => {
  const small = spriteFor('item', base).small
  if (!small) throw new Error('no small art')
  return encodeRaster(artFrame(small), [])
}

test('an inventory row on a half-block terminal leads with the 8 × 2 item sprite', async ($, on) => {
  const { data } = harness(on, seeded())
  data.set('promptfall:settings', RENDERER('raster'))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...PANE })
  const sprite = await ui.find({ key: 'sprite-iseed' })
  expect(sprite?.type).toBe('Raster')
  expect([sprite?.props.columns, sprite?.props.rows]).toEqual([8, 2])
  expect([...decode(String(sprite?.props.cells))]).toEqual([...decode(smallCells('iron_sword'))])
  await ui.unmount()
})

test('an inventory row draws an Image of 2 × 1 where pictures draw, an Svg on the desktop', async ($, on) => {
  const { data } = harness(on, seeded())
  data.set('promptfall:settings', RENDERER('image'))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...PANE })
  const image = await ui.find({ type: 'Image' })
  expect([image?.props.columns, image?.props.rows]).toEqual([2, 1])
  expect(image?.props.alt).toBe('Iron Sword')
  await ui.unmount()
  const desk = await $.ui.mount({ plugin: 'promptfall', surface: 'desktop', ...PANE })
  const svg = await desk.find({ type: 'Svg' })
  expect(svg?.props.alt).toBe('Iron Sword')
  expect(String(svg?.props.source)).toMatch(/^<svg/)
  await desk.unmount()
})

test('a heroes row keeps its glyph on half-blocks and leads with an Svg on the desktop', async ($, on) => {
  const { data, states } = harness(on, seeded())
  data.set('promptfall:settings', RENDERER('raster'))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const hero = (states.get('view') as GameView).roster[0]
  if (!hero) throw new Error('no hero')
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-heroes' })
  expect(await ui.find({ key: `sprite-${hero.id}` })).toBeUndefined()
  expect(
    await ui.find({ text: new RegExp(`^\\${hero.glyph} ${hero.name.split(' ')[0]}`) }),
  ).toBeDefined()
  await ui.unmount()
  const desk = await $.ui.mount({ plugin: 'promptfall', surface: 'desktop', ...PANE })
  expect((await desk.findAll({ type: 'Svg' })).some((s) => s.props.alt === hero.name)).toBe(true)
  await desk.unmount()
})

test('a row drops its glyph where a sprite draws and keeps it where none does', async ($, on) => {
  const { data, states } = harness(on, seeded())
  data.set('promptfall:settings', RENDERER('image'))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const hero = (states.get('view') as GameView).roster[0]
  if (!hero) throw new Error('no hero')
  const glyphed = new RegExp(`^\\${hero.glyph} ${hero.name.split(' ')[0]}`)
  const bare = new RegExp(`^${hero.name.split(' ')[0]}`)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'promptfall', surface, ...PANE })
    expect(await ui.find({ text: /^Iron Sword \(/ })).toBeDefined()
    expect(await ui.find({ text: /^\/ Iron Sword/ })).toBeUndefined()
    await ui.press({ key: 'tab-heroes' })
    expect(await ui.find({ text: bare })).toBeDefined()
    expect(await ui.find({ text: glyphed })).toBeUndefined()
    await ui.press({ key: 'tab-inventory' })
    await ui.unmount()
  }
})

test('half-blocks: the item row drops its glyph, the hero row keeps it', async ($, on) => {
  const { data } = harness(on, seeded())
  data.set('promptfall:settings', RENDERER('raster'))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...PANE })
  expect(await ui.find({ text: /^Iron Sword \(/ })).toBeDefined()
  expect(await ui.find({ text: /^\/ Iron Sword/ })).toBeUndefined()
  await ui.unmount()
})

test('before the probe answers a terminal row keeps its glyph', async ($, on) => {
  const { data } = harness(on, seeded())
  data.set('promptfall:settings', RENDERER('auto'))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...PANE })
  expect(await ui.find({ text: /^\/ Iron Sword \(/ })).toBeDefined()
  await ui.unmount()
})

test('market listings lead with the item or the hero class sprite', async ($, on) => {
  const { player } = await marketHarness(on, { heroListing: true })
  const { ui } = await startOnTest($, on, player, { 'promptfall:settings': RENDERER('raster') })
  await ui.press({ key: 'tab-market' })
  // Items: the 8 × 2 half-block sprite.
  expect(await ui.findAll({ type: 'Raster' })).toHaveLength(3)
  // Heroes: nothing on half-blocks.
  await ui.press({ key: 'market-kind' })
  expect(await ui.find({ text: /\(rare\)/ })).toBeDefined()
  expect(await ui.findAll({ type: 'Raster' })).toHaveLength(0)
  await ui.unmount()
  const desk = await $.ui.mount({ plugin: 'promptfall', surface: 'desktop', ...PANE })
  const heroes = await desk.findAll({ type: 'Svg' })
  expect(heroes).toHaveLength(1)
  await desk.press({ key: 'market-kind' })
  const items = await desk.findAll({ type: 'Svg' })
  expect(items.map((s) => s.props.alt)).toEqual([
    'Steel Longsword',
    'Steel Longsword',
    'Steel Longsword',
  ])
  await desk.unmount()
})

const NARROW = { ...PANE, props: { ...PANE.props, bodyColumns: 40, placement: 'dock' as const } }

type Node = { type?: string; props: Record<string, unknown>; children: unknown[]; text?: string }

/** A node's text: its own, or its string children's, recursively. */
function textOf(node: Node): string {
  if (typeof node.text === 'string') return node.text
  return (node.children ?? [])
    .map((c) => (typeof c === 'string' ? c : typeof c === 'object' && c ? textOf(c as Node) : ''))
    .join('')
}

/** Every horizontal, non-wrapping Box under `node` with the cells its Texts and gaps take. */
function rowCells(node: Node): number[] {
  const kids = (node.children ?? []).filter((c): c is Node => typeof c === 'object' && c !== null)
  const own =
    node.type === 'Box' && node.props.flexDirection === 'row' && node.props.flexWrap !== 'wrap'
      ? (() => {
          const texts = kids.filter((k) => k.type === 'Text')
          const gap = Number(node.props.gap ?? 0)
          const len = texts.reduce((n, t) => n + [...textOf(t)].length, 0)
          return texts.length > 0 ? [len + gap * Math.max(0, texts.length - 1)] : []
        })()
      : []
  return [...own, ...kids.flatMap(rowCells)]
}

function narrowState(): GameState {
  const s = seeded()
  return {
    ...s,
    inventory: [
      {
        id: 'ilong',
        base: 'iron_sword',
        rarity: 'rare',
        affixes: [
          { id: 'brutal', value: 5 },
          { id: 'keen', value: 1 },
        ],
        equippedBy: null,
        tradeableAt: null,
      },
    ],
  }
}

test('the list sprite takes 2, 8 or the desktop columns in a row, 0 where none draws', () => {
  const sword = spriteFor('item', 'iron_sword')
  expect(listSpriteColumns('image', 'terminal', sword)).toBe(2)
  expect(listSpriteColumns('raster', 'terminal', sword)).toBe(8)
  expect(listSpriteColumns('unknown', 'terminal', sword)).toBe(0)
  expect(listSpriteColumns('raster', 'desktop', sword)).toBe(DESKTOP_LIST_SPRITE_COLUMNS)
})

for (const [surface, renderer, sprite] of [['terminal', 'raster', 8]] as const) {
  test(`inventory and hero rows fit a 40-column pane on ${surface}`, async ($, on) => {
    const { data, states } = harness(on, narrowState())
    data.set('promptfall:settings', RENDERER(renderer))
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
    const ui = await $.ui.mount({ plugin: 'promptfall', surface, ...NARROW })
    const width = 40 - (sprite + 1)
    const row = (await ui.find({ key: 'item-ilong' })) as Node | undefined
    expect(row).toBeDefined()
    for (const cells of rowCells(row as Node)) expect(cells).toBeLessThanOrEqual(width)
    // The affixes did not fit beside the name: they sit under it, indented.
    const below = (await ui.findAll({ type: 'Box' })).filter(
      (b) => b.props.paddingLeft === 2 && /Brutal/i.test(b.text ?? ''),
    )
    expect(below.length).toBeGreaterThan(0)
    expect((await ui.find({ key: 'item-actions-ilong' }))?.props.flexWrap).toBe('wrap')
    await ui.press({ key: 'tab-heroes' })
    const hero = (states.get('view') as GameView).roster[0]
    if (!hero) throw new Error('no hero')
    const heroCols = listSpriteColumns(renderer, surface, spriteFor('hero', hero.cls))
    const heroRow = (await ui.find({ key: `hero-${hero.id}` })) as Node | undefined
    expect(heroRow).toBeDefined()
    for (const cells of rowCells(heroRow as Node)) {
      expect(cells).toBeLessThanOrEqual(40 - (heroCols > 0 ? heroCols + 1 : 0))
    }
    expect((await ui.find({ key: `hero-actions-${hero.id}` }))?.props.flexWrap).toBe('wrap')
    await ui.unmount()
  })
}

test('market listing rows fit a 30-column pane', async ($, on) => {
  const { player } = await marketHarness(on, { affixed: true })
  const { ui } = await startOnTest($, on, player, { 'promptfall:settings': RENDERER('raster') })
  await ui.unmount()
  const thin = { ...NARROW, props: { ...NARROW.props, bodyColumns: 30 } }
  const term = await $.ui.mount({ plugin: 'promptfall', surface: 'terminal', ...thin })
  await term.press({ key: 'tab-market' })
  const rows = (await term.findAll({ type: 'Box' })).filter((b) =>
    String(b.props.key ?? '').startsWith('listing-'),
  )
  expect(rows.length).toBeGreaterThan(0)
  for (const r of rows) {
    for (const cells of rowCells(r as Node)) expect(cells).toBeLessThanOrEqual(30 - (8 + 1))
  }
  await term.unmount()
})

test('on the desktop list rows wrap their text instead of cutting it', async ($, on) => {
  const { data, states } = harness(on, narrowState())
  data.set('promptfall:settings', RENDERER('raster'))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'promptfall', surface: 'desktop', ...NARROW })
  const item = await ui.find({ key: 'item-name-ilong' })
  expect(item?.props.flexWrap).toBe('wrap')
  expect(item?.text ?? '').toContain('Iron Sword (rare, weapon)')
  expect(item?.text ?? '').not.toContain('…')
  await ui.press({ key: 'tab-heroes' })
  const hero = (states.get('view') as GameView).roster[0]
  if (!hero) throw new Error('no hero')
  const name = await ui.find({ key: `hero-name-${hero.id}` })
  expect(name?.props.flexWrap).toBe('wrap')
  expect(name?.text ?? '').toContain(hero.name)
  expect(name?.text ?? '').not.toContain('…')
  await ui.unmount()
})

test('orders and chat rows wrap on the desktop and truncate on a terminal', () => {
  const els = { Box: 'Box', Text: 'Text', Button: 'Button', Input: undefined } as unknown as Els
  const view = { account: { linked: 'player', chatOpen: true, marketOpen: true } } as GameView
  const orders = {
    busy: false,
    error: null,
    form: null,
    mine: {
      returns: 0,
      listings: [{ id: 'L1', name: 'Steel Longsword', rarity: 'rare', price: 120, expiresAt: 9 }],
      orders: [
        {
          id: 'O1',
          name: 'Steel Longsword',
          minRarity: 'rare',
          affix: null,
          maxPrice: 1,
          expiresAt: 9,
        },
      ],
    },
  } as unknown as Parameters<typeof ordersBody>[4]
  const actions = {} as Parameters<typeof ordersBody>[7]
  const rows = (fit: 'wrap' | 'truncate') =>
    JSON.stringify(
      ordersBody(els, (() => null) as never, view, null, orders, true, () => 60_000, actions, fit),
    )
  expect(rows('wrap')).not.toContain('"truncate"')
  expect(rows('wrap')).toContain('"flexWrap":"wrap"')
  expect(rows('truncate')).toContain('"truncate"')
  const world = {
    snapshot: null,
    fetchedAt: null,
    stale: false,
    messages: [{ id: 1, name: 'Brindle', text: 'a long line about the boss', at: 1 }],
    chatMark: 1,
    clock: null,
    committedDealt: null,
  }
  const chat = (fit: 'wrap' | 'truncate') =>
    JSON.stringify(
      chatBody(
        els,
        view,
        world,
        { draft: '', busy: false, error: null },
        { setDraft: async () => undefined, post: async () => undefined },
        fit,
      ),
    )
  expect(chat('wrap')).not.toContain('"truncate"')
  expect(chat('truncate')).toContain('"truncate"')
})
