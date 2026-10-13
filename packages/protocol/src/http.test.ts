import { createInitialState, hashState, SIM_VERSION } from '@promptfall/sim'
import { describe, expect, it } from 'vitest'
import type { Account, Bootstrap, Delivery, ServerConfig } from './client'
import { type FetchLike, HttpClient } from './http'
import type { Journal } from './journal'
import type { Listing, Order } from './market'
import type { Batch } from './schemas'
import type { Boards, WorldSnapshot } from './world'

type Sent = { url: string; method: string; headers: Record<string, string>; body?: string }

/** A FetchLike that records requests and answers one canned body per call. */
function canned(body: unknown, status = 200): { fetch: FetchLike; sent: Sent[] } {
  const sent: Sent[] = []
  const fetch: FetchLike = async (url, init) => {
    sent.push({ url, ...init })
    return { status, ok: status >= 200 && status < 300, text: JSON.stringify(body) }
  }
  return { fetch, sent }
}

const BASE = 'http://127.0.0.1:7777/'
const auth = { deviceToken: 'tok-1' }
const state = createInitialState(7)
const delivery: Delivery = {
  cursor: 2,
  events: [{ n: 2, event: { t: 'credited', gold: 5, reason: 'x' } }],
}
const config: ServerConfig = {
  minClientVersion: '0.1.0',
  simVersion: SIM_VERSION,
  flags: { 'market.enabled': true },
  serverNow: 1_700_000_000_000,
  speed: 1,
}
const account: Account = {
  accountId: 'a1',
  seed: 7,
  createdAt: 1,
  displayName: null,
  linked: null,
}
const boot: Bootstrap = {
  deviceToken: 'tok-1',
  account,
  config,
  state,
  seq: 0,
  hash: hashState(state),
  cursor: 0,
  delivery,
}
const listing: Listing = {
  id: 'L1',
  sellerId: 'a2',
  sellerName: 'bot',
  goods: {
    kind: 'item',
    item: {
      id: 'i3',
      base: 'steel_longsword',
      rarity: 'rare',
      tier: 2,
      affixes: [],
      equippedBy: null,
      tradeableAt: null,
    },
  },
  price: 100,
  createdAt: 1,
  expiresAt: 2,
}
const order: Order = {
  id: 'O1',
  buyerId: 'a2',
  base: 'steel_longsword',
  minRarity: 'rare',
  affixId: null,
  maxPrice: 300,
  createdAt: 1,
  expiresAt: 2,
}
const ok = { ok: true, delivery }
const snapshot: WorldSnapshot = {
  serverNow: 1_700_000_000_000,
  speed: 1,
  online: 2,
  zones: [{ zone: 1, count: 2 }],
  here: ['Brindle'],
  boss: null,
  chat: [{ id: 12, name: 'Brindle', text: 'hello', at: 1_699_999_999_000 }],
  flags: { 'chat.enabled': true },
}

function client(body: unknown, status = 200) {
  const c = canned(body, status)
  return { http: new HttpClient({ baseUrl: BASE, fetch: c.fetch }), sent: c.sent }
}

function only(sent: Sent[]): Sent {
  expect(sent).toHaveLength(1)
  const first = sent[0]
  if (!first) throw new Error('no request')
  return first
}

const JSON_AUTH = { 'content-type': 'application/json', authorization: 'Bearer tok-1' }

describe('HttpClient', () => {
  it('bootstrap posts the client version and token, no auth header', async () => {
    const { http, sent } = client(boot)
    expect(await http.bootstrap({ clientVersion: '0.1.0', deviceToken: null })).toEqual(boot)
    const req = only(sent)
    expect(req.method).toBe('POST')
    expect(req.url).toBe('http://127.0.0.1:7777/v1/bootstrap')
    expect(req.headers).toEqual({ 'content-type': 'application/json' })
    expect(JSON.parse(req.body ?? '')).toEqual({ clientVersion: '0.1.0', deviceToken: null })
  })

  it('submit posts the batch with auth', async () => {
    const ack = { ok: true, seq: 1, hash: hashState(state), duplicate: false, delivery }
    const { http, sent } = client(ack)
    const batch: Batch = {
      batchId: 'b'.repeat(20),
      accountId: 'a1',
      seq: 0,
      clientVersion: '0.1.0',
      simVersion: SIM_VERSION,
      cursor: 0,
      baseHash: hashState(state),
      resultHash: hashState(state),
      events: [{ t: 'tick', at: 1 }],
    }
    expect(await http.submit(batch, auth)).toEqual(ack)
    const req = only(sent)
    expect([req.method, req.url]).toEqual(['POST', 'http://127.0.0.1:7777/v1/batches'])
    expect(req.headers).toEqual(JSON_AUTH)
    expect(JSON.parse(req.body ?? '')).toEqual(batch)
  })

  it('account gets with auth and no body', async () => {
    const info = { account, returns: 0, config, delivery }
    const { http, sent } = client(info)
    expect(await http.account(auth)).toEqual(info)
    const req = only(sent)
    expect([req.method, req.url]).toEqual(['GET', 'http://127.0.0.1:7777/v1/account'])
    expect(req.headers).toEqual({ authorization: 'Bearer tok-1' })
    expect(req.body).toBeUndefined()
  })

  it('passes unauthorized through as a value', async () => {
    const { http } = client({ reason: 'unauthorized' })
    expect(await http.account(auth)).toEqual({ reason: 'unauthorized' })
  })

  it('linkStart and linkPoll', async () => {
    const start = { code: 'ABCD1234', url: 'https://github.com/login/device', intervalMs: 5000 }
    const a = client(start)
    expect(await a.http.linkStart(auth)).toEqual(start)
    const ra = only(a.sent)
    expect([ra.method, ra.url, ra.body]).toEqual([
      'POST',
      'http://127.0.0.1:7777/v1/link/github',
      undefined,
    ])
    expect(ra.headers).toEqual({ authorization: 'Bearer tok-1' })
    const b = client({ status: 'linked', account })
    expect(await b.http.linkPoll(auth, 'ABCD1234')).toEqual({ status: 'linked', account })
    const rb = only(b.sent)
    expect([rb.method, rb.url]).toEqual(['POST', 'http://127.0.0.1:7777/v1/link/github/poll'])
    expect(JSON.parse(rb.body ?? '')).toEqual({ code: 'ABCD1234' })
  })

  it('browse builds the query by hand and omits undefined values', async () => {
    const page = { listings: [listing], page: 0, total: 1 }
    const { http, sent } = client(page)
    expect(
      await http.browse(auth, { kind: 'item', base: 'steel longsword&x', sort: 'price', page: 2 }),
    ).toEqual(page)
    const req = only(sent)
    expect(req.method).toBe('GET')
    expect(req.url).toBe(
      'http://127.0.0.1:7777/v1/listings?kind=item&base=steel%20longsword%26x&sort=price&page=2',
    )
    expect(req.headers).toEqual({ authorization: 'Bearer tok-1' })
  })

  it('browse sends cls and minRarity when given', async () => {
    const { http, sent } = client({ listings: [], page: 0, total: 0 })
    await http.browse(auth, {
      kind: 'hero',
      cls: 'knight',
      minRarity: 'rare',
      sort: 'newest',
      page: 0,
    })
    expect(only(sent).url).toBe(
      'http://127.0.0.1:7777/v1/listings?kind=hero&cls=knight&minRarity=rare&sort=newest&page=0',
    )
  })

  it('list posts kind, id and price', async () => {
    const { http, sent } = client(ok)
    expect(await http.list(auth, { kind: 'item', id: 'i3', price: 100 })).toEqual(ok)
    const req = only(sent)
    expect([req.method, req.url]).toEqual(['POST', 'http://127.0.0.1:7777/v1/listings'])
    expect(req.headers).toEqual(JSON_AUTH)
    expect(JSON.parse(req.body ?? '')).toEqual({ kind: 'item', id: 'i3', price: 100 })
  })

  it('cancelListing deletes the listing', async () => {
    const { http, sent } = client({ ok: false, reason: 'gone' })
    expect(await http.cancelListing(auth, 'L1')).toEqual({ ok: false, reason: 'gone' })
    const req = only(sent)
    expect([req.method, req.url, req.body]).toEqual([
      'DELETE',
      'http://127.0.0.1:7777/v1/listings/L1',
      undefined,
    ])
    expect(req.headers).toEqual({ authorization: 'Bearer tok-1' })
  })

  it('buy posts to the listing', async () => {
    const { http, sent } = client(ok)
    expect(await http.buy(auth, 'L 1')).toEqual(ok)
    const req = only(sent)
    expect([req.method, req.url]).toEqual(['POST', 'http://127.0.0.1:7777/v1/listings/L%201/buy'])
  })

  it('myOrders gets the orders', async () => {
    const mine = { listings: [listing], orders: [order], returns: 1 }
    const { http, sent } = client(mine)
    expect(await http.myOrders(auth)).toEqual(mine)
    const req = only(sent)
    expect([req.method, req.url]).toEqual(['GET', 'http://127.0.0.1:7777/v1/orders'])
  })

  it('placeOrder posts the new order', async () => {
    const { http, sent } = client(ok)
    const input = {
      base: 'steel_longsword',
      minRarity: 'rare',
      affixId: null,
      maxPrice: 300,
    } as const
    expect(await http.placeOrder(auth, input)).toEqual(ok)
    const req = only(sent)
    expect([req.method, req.url]).toEqual(['POST', 'http://127.0.0.1:7777/v1/orders'])
    expect(req.headers).toEqual(JSON_AUTH)
    expect(JSON.parse(req.body ?? '')).toEqual(input)
  })

  it('cancelOrder deletes the order', async () => {
    const { http, sent } = client(ok)
    expect(await http.cancelOrder(auth, 'O1')).toEqual(ok)
    const req = only(sent)
    expect([req.method, req.url]).toEqual(['DELETE', 'http://127.0.0.1:7777/v1/orders/O1'])
  })

  it('matchingOrders gets with the item id in the query', async () => {
    const { http, sent } = client([order])
    expect(await http.matchingOrders(auth, 'i3')).toEqual([order])
    const req = only(sent)
    expect([req.method, req.url]).toEqual([
      'GET',
      'http://127.0.0.1:7777/v1/orders/matching?itemId=i3',
    ])
  })

  it('fillOrder posts the item id', async () => {
    const { http, sent } = client(ok)
    expect(await http.fillOrder(auth, 'O1', 'i3')).toEqual(ok)
    const req = only(sent)
    expect([req.method, req.url]).toEqual(['POST', 'http://127.0.0.1:7777/v1/orders/O1/fill'])
    expect(JSON.parse(req.body ?? '')).toEqual({ itemId: 'i3' })
  })

  it('world gets the snapshot with since in the query and auth', async () => {
    const { http, sent } = client(snapshot)
    expect(await http.world(auth, 12)).toEqual(snapshot)
    const req = only(sent)
    expect([req.method, req.url, req.body]).toEqual([
      'GET',
      'http://127.0.0.1:7777/v1/world?since=12',
      undefined,
    ])
    expect(req.headers).toEqual({ authorization: 'Bearer tok-1' })
  })

  it('world passes unauthorized through as a value', async () => {
    const { http } = client({ reason: 'unauthorized' })
    expect(await http.world(auth, 0)).toEqual({ reason: 'unauthorized' })
  })

  it('a snapshot missing flags or speed is ServerError', async () => {
    const { flags: _flags, ...noFlags } = snapshot
    await expect(client(noFlags).http.world(auth, 0)).rejects.toMatchObject({
      name: 'ServerError',
    })
    const { speed: _speed, ...noSpeed } = snapshot
    await expect(client(noSpeed).http.world(auth, 0)).rejects.toMatchObject({
      name: 'ServerError',
    })
  })

  it('chat posts the text with auth', async () => {
    const posted = { ok: true, message: { id: 4, name: 'Ash', text: 'hi', at: 9 } }
    const { http, sent } = client(posted)
    expect(await http.chat(auth, 'hi')).toEqual(posted)
    const req = only(sent)
    expect([req.method, req.url]).toEqual(['POST', 'http://127.0.0.1:7777/v1/chat'])
    expect(req.headers).toEqual(JSON_AUTH)
    expect(JSON.parse(req.body ?? '')).toEqual({ text: 'hi' })
  })

  it('a chat refusal passes through as a value', async () => {
    const { http } = client({ ok: false, reason: 'rate_limited' })
    expect(await http.chat(auth, 'hi')).toEqual({ ok: false, reason: 'rate_limited' })
  })

  it('a bootstrap refusal passes through as a value; an unknown refusal is ServerError', async () => {
    const limited = { refusal: 'rate_limited', message: 'Too many new accounts from here.' }
    const input = { clientVersion: '0.1.0', deviceToken: null }
    expect(await client(limited).http.bootstrap(input)).toEqual(limited)
    const banned = { refusal: 'banned', message: 'Banned: spam.' }
    expect(await client(banned).http.bootstrap(input)).toEqual(banned)
    await expect(
      client({ refusal: 'link_unavailable', message: 'x' }).http.bootstrap(input),
    ).rejects.toMatchObject({ name: 'ServerError' })
  })

  it('a link refusal and an ended link pass through as values', async () => {
    const refused = { refusal: 'link_unavailable', message: 'No client id.' }
    expect(await client(refused).http.linkStart(auth)).toEqual(refused)
    const ended = { status: 'ended', reason: 'expired', message: 'The code expired.' }
    expect(await client(ended).http.linkPoll(auth, 'WDJB-MJHT')).toEqual(ended)
  })

  it('leaderboards gets the boards with auth and no body', async () => {
    const boards: Boards = {
      highestZone: [{ accountId: 'a1', name: 'Ash', value: 5 }],
      damage: [],
      weekStart: 1_699_833_600_000,
    }
    const { http, sent } = client(boards)
    expect(await http.leaderboards(auth)).toEqual(boards)
    const req = only(sent)
    expect([req.method, req.url, req.body]).toEqual([
      'GET',
      'http://127.0.0.1:7777/v1/leaderboards',
      undefined,
    ])
    expect(req.headers).toEqual({ authorization: 'Bearer tok-1' })
  })

  const journal: Journal = {
    achievements: [{ id: 'kills', steps: [{ step: 1, at: 1_700_000_000_000 }] }],
    day: {
      index: 19_675,
      goal: { kind: 'kills', target: 150 },
      progress: 12,
      met: false,
      resetsAt: 19_676 * 86_400_000,
    },
    goalsMet: 3,
    streak: { length: 2, lastMet: 19_674 },
    restDays: { current: [6, 7], next: { days: [1, 2], from: 19_681 } },
  }

  it('journal gets the journal with auth and no body', async () => {
    const { http, sent } = client(journal)
    expect(await http.journal(auth)).toEqual(journal)
    const req = only(sent)
    expect([req.method, req.url, req.body]).toEqual([
      'GET',
      'http://127.0.0.1:7777/v1/journal',
      undefined,
    ])
    expect(req.headers).toEqual({ authorization: 'Bearer tok-1' })
  })

  it('setRestDays posts the days with auth; a refusal passes through as a value', async () => {
    const { http, sent } = client({ ok: true, journal })
    expect(await http.setRestDays(auth, [1, 2])).toEqual({ ok: true, journal })
    const req = only(sent)
    expect([req.method, req.url, req.body]).toEqual([
      'POST',
      'http://127.0.0.1:7777/v1/journal/rest-days',
      '{"days":[1,2]}',
    ])
    const refused = client({ ok: false, reason: 'rest_days_same' })
    expect(await refused.http.setRestDays(auth, [3, 3])).toEqual({
      ok: false,
      reason: 'rest_days_same',
    })
  })

  it('a thrown fetch is ServerUnreachable', async () => {
    const http = new HttpClient({
      baseUrl: BASE,
      fetch: async () => {
        throw new TypeError('connect ECONNREFUSED')
      },
    })
    await expect(http.account(auth)).rejects.toMatchObject({ name: 'ServerUnreachable' })
  })

  it('a 500 is ServerError', async () => {
    const { http } = client({ error: 'internal' }, 500)
    await expect(http.account(auth)).rejects.toMatchObject({ name: 'ServerError', status: 500 })
  })

  it('a 400 is ServerError carrying its status', async () => {
    const { http } = client({ error: 'schema', issues: [] }, 400)
    await expect(http.account(auth)).rejects.toMatchObject({ name: 'ServerError', status: 400 })
  })

  it('a 200 body failing its schema is ServerError', async () => {
    const { http } = client({ account: 'nope' })
    await expect(http.account(auth)).rejects.toMatchObject({ name: 'ServerError' })
  })

  it('a 200 body that is not JSON is ServerError', async () => {
    const http = new HttpClient({
      baseUrl: BASE,
      fetch: async () => ({ status: 200, ok: true, text: '<html>' }),
    })
    await expect(http.account(auth)).rejects.toMatchObject({ name: 'ServerError' })
  })
})
