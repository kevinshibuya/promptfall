import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  AccountResponseSchema,
  BatchAckSchema,
  BoardsResponseSchema,
  BootstrapResponseSchema,
  BootstrapSchema,
  ChatResultSchema,
  ErrorBodySchema,
  type FetchLike,
  HealthSchema,
  HttpClient,
  JournalResponseSchema,
  type KeyValue,
  LinkPollResponseSchema,
  LinkStartResponseSchema,
  ListingPageResponseSchema,
  MarketResultSchema,
  MatchingOrdersResponseSchema,
  MemoryKeyValue,
  MIN_CLIENT_VERSION,
  MyOrdersResponseSchema,
  RestDaysResultSchema,
  WorldResponseSchema,
} from '@promptfall/protocol'
import { hashState, replay, SIM_VERSION } from '@promptfall/sim'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { VirtualClock } from './clock'
import { FileKeyValue } from './file-kv'
import { parseFlags, parsePlayerName } from './flags'
import { createFakeServer, type FakeServerOptions } from './server'
import { booted, nodeFetch } from './test-support'

let base = ''
let close: () => Promise<void> = async () => {}
const T0 = 1_700_000_000_000

beforeAll(async () => {
  const server = createFakeServer({
    kv: new MemoryKeyValue(),
    now: async () => T0,
    speed: 1,
    flags: {},
    seedSource: () => 5,
    tokenSource: () => crypto.randomUUID(),
    playerName: 'kevin',
    seed: 9,
    // One server for every test here, all from loopback: the cap has its own tests.
    mintsPerHour: 100,
  })
  const listening = await server.listen(0)
  base = `http://127.0.0.1:${listening.port}`
  close = listening.close
})

afterAll(() => close())

async function raw(
  method: string,
  path: string,
  options: { body?: string; token?: string } = {},
): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = {}
  if (options.body !== undefined) headers['content-type'] = 'application/json'
  if (options.token) headers.authorization = `Bearer ${options.token}`
  const r = await fetch(base + path, {
    method,
    headers,
    ...(options.body !== undefined ? { body: options.body } : {}),
  })
  return { status: r.status, body: JSON.parse(await r.text()) }
}

async function freshToken(): Promise<string> {
  const r = await raw('POST', '/v1/bootstrap', {
    body: JSON.stringify({ clientVersion: '0.1.0', deviceToken: null }),
  })
  return BootstrapSchema.parse(r.body).deviceToken
}

describe('HTTP fake', () => {
  it('answers health', async () => {
    const r = await raw('GET', '/v1/health')
    expect(r.status).toBe(200)
    expect(HealthSchema.parse(r.body)).toEqual({
      ok: true,
      simVersion: SIM_VERSION,
      seed: 9,
      speed: 1,
      now: T0,
    })
  })

  it('answers the protocol minimum client version, the launch version', async () => {
    const r = await raw('POST', '/v1/bootstrap', {
      body: JSON.stringify({ clientVersion: MIN_CLIENT_VERSION, deviceToken: null }),
    })
    expect(BootstrapSchema.parse(r.body).config.minClientVersion).toBe(MIN_CLIENT_VERSION)
    expect(MIN_CLIENT_VERSION).toBe('0.3.0')
  })

  it('refuses a batch from a pre-launch client with the version gate', async () => {
    const boot = await raw('POST', '/v1/bootstrap', {
      body: JSON.stringify({ clientVersion: '0.2.0', deviceToken: null }),
    })
    const b = BootstrapSchema.parse(boot.body)
    const events = [{ t: 'tick' as const }]
    const batch = {
      batchId: crypto.randomUUID(),
      accountId: b.account.accountId,
      seq: 0,
      clientVersion: '0.2.0',
      simVersion: SIM_VERSION,
      cursor: 0,
      baseHash: b.hash,
      resultHash: hashState(replay(b.state, events).state),
      events: events.map((e) => ({ ...e, at: 1 })),
    }
    const r = await raw('POST', '/v1/batches', {
      body: JSON.stringify(batch),
      token: b.deviceToken,
    })
    expect(BatchAckSchema.parse(r.body)).toEqual({
      ok: false,
      reason: 'version_gate',
      minClientVersion: MIN_CLIENT_VERSION,
    })
  })

  it('answers 400 on a bad body, a non-JSON body and a bad query', async () => {
    const a = await raw('POST', '/v1/bootstrap', { body: JSON.stringify({ clientVersion: 3 }) })
    expect(a.status).toBe(400)
    expect(ErrorBodySchema.parse(a.body)).toMatchObject({ error: 'schema' })
    const b = await raw('POST', '/v1/batches', { body: '{nope', token: 'x' })
    expect(b.status).toBe(400)
    const token = await freshToken()
    const c = await raw('GET', '/v1/listings?kind=item&sort=price&page=-1', { token })
    expect(c.status).toBe(400)
    const d = await raw('GET', '/v1/listings?kind=item&page=0', { token })
    expect(d.status).toBe(400)
  })

  it('an undecodable path segment is a 404 and the server stays up', async () => {
    const token = await freshToken()
    const r = await raw('DELETE', '/v1/listings/%E0%A4%A', { token })
    expect(r).toEqual({ status: 404, body: { error: 'route' } })
    expect((await raw('GET', '/v1/health')).status).toBe(200)
  })

  it('reads the world mark from the query: absent is 0, anything but digits is 400', async () => {
    const token = await freshToken()
    const absent = await raw('GET', '/v1/world', { token })
    expect(absent.status).toBe(200)
    expect(WorldResponseSchema.parse(absent.body)).toMatchObject({ boss: null })
    expect((await raw('GET', '/v1/world?since=12', { token })).status).toBe(200)
    const bad = await raw('GET', '/v1/world?since=abc', { token })
    expect(bad.status).toBe(400)
    expect(ErrorBodySchema.parse(bad.body)).toMatchObject({ error: 'schema' })
    expect((await raw('GET', '/v1/world?since=-1', { token })).status).toBe(400)
    expect((await raw('POST', '/v1/chat', { body: '{"text":3}', token })).status).toBe(400)
  })

  it('answers 404 on an unknown route or method', async () => {
    const a = await raw('GET', '/v1/nothing')
    expect(a).toEqual({ status: 404, body: { error: 'route' } })
    const b = await raw('PUT', '/v1/account')
    expect(b.status).toBe(404)
  })

  it('answers unauthorized at 200 on a bad token', async () => {
    const a = await raw('GET', '/v1/account', { token: 'forged' })
    expect(a).toEqual({ status: 200, body: { reason: 'unauthorized' } })
    const b = await raw('GET', '/v1/account')
    expect(b).toEqual({ status: 200, body: { reason: 'unauthorized' } })
    const c = await raw('POST', '/v1/listings/L1/buy', { token: 'forged' })
    expect(c).toEqual({ status: 200, body: { ok: false, reason: 'unauthorized' } })
    const d = await raw('GET', '/v1/journal', { token: 'forged' })
    expect(d).toEqual({ status: 200, body: { reason: 'unauthorized' } })
    const e = await raw('POST', '/v1/journal/rest-days', {
      body: '{"days":[1,2]}',
      token: 'forged',
    })
    expect(e).toEqual({ status: 200, body: { ok: false, reason: 'unauthorized' } })
  })

  it('GET /v1/journal reads the journal; POST /v1/journal/rest-days writes the rest days', async () => {
    const http = new HttpClient({ baseUrl: base, fetch: nodeFetch })
    const auth = { deviceToken: await freshToken() }
    const journal = await http.journal(auth)
    expect(journal).toMatchObject({ restDays: { current: [6, 7], next: null }, goalsMet: 0 })
    const written = await http.setRestDays(auth, [5, 4])
    // The fake's clock stands on a Tuesday: the set applies from the next Monday.
    expect(written).toMatchObject({
      ok: true,
      journal: { restDays: { current: [6, 7], next: { days: [4, 5], from: 19_681 } } },
    })
    expect(await http.setRestDays(auth, [9, 4])).toEqual({ ok: false, reason: 'rest_days_range' })
    // A body that is not a list of numbers is the schema's, not the ledger's.
    const bad = await raw('POST', '/v1/journal/rest-days', {
      body: '{"days":"sat"}',
      token: auth.deviceToken,
    })
    expect(bad.status).toBe(400)
  })

  it('every response body passes its schema', async () => {
    const http = new HttpClient({ baseUrl: base, fetch: nodeFetch })
    const boot = await raw('POST', '/v1/bootstrap', {
      body: JSON.stringify({ clientVersion: '0.1.0', deviceToken: null }),
    })
    const b = BootstrapSchema.parse(boot.body)
    const token = b.deviceToken
    const events = [{ t: 'tick' as const }]
    const batch = {
      batchId: crypto.randomUUID(),
      accountId: b.account.accountId,
      seq: 0,
      clientVersion: MIN_CLIENT_VERSION,
      simVersion: SIM_VERSION,
      cursor: 0,
      baseHash: b.hash,
      resultHash: hashState(replay(b.state, events).state),
      events: events.map((e) => ({ ...e, at: 1 })),
    }
    const checks: [unknown, { parse(v: unknown): unknown }][] = [
      [
        (await raw('POST', '/v1/batches', { body: JSON.stringify(batch), token })).body,
        BatchAckSchema,
      ],
      [(await raw('GET', '/v1/account', { token })).body, AccountResponseSchema],
      [(await raw('POST', '/v1/link/github', { token })).body, LinkStartResponseSchema],
      [
        (await raw('POST', '/v1/link/github/poll', { body: '{"code":"ZZZZZZZZ"}', token })).body,
        LinkPollResponseSchema,
      ],
      [
        (await raw('GET', '/v1/listings?kind=hero&sort=newest&page=0', { token })).body,
        ListingPageResponseSchema,
      ],
      [
        (
          await raw('POST', '/v1/listings', {
            body: '{"kind":"item","id":"i0","price":10}',
            token,
          })
        ).body,
        MarketResultSchema,
      ],
      [(await raw('DELETE', '/v1/listings/L1', { token })).body, MarketResultSchema],
      [(await raw('POST', '/v1/listings/L1/buy', { token })).body, MarketResultSchema],
      [(await raw('GET', '/v1/orders', { token })).body, MyOrdersResponseSchema],
      [
        (
          await raw('POST', '/v1/orders', {
            body: '{"base":"steel_longsword","minRarity":"rare","affixId":null,"maxPrice":30}',
            token,
          })
        ).body,
        MarketResultSchema,
      ],
      [(await raw('DELETE', '/v1/orders/O1', { token })).body, MarketResultSchema],
      [
        (await raw('GET', '/v1/orders/matching?itemId=i0', { token })).body,
        MatchingOrdersResponseSchema,
      ],
      [
        (await raw('POST', '/v1/orders/O1/fill', { body: '{"itemId":"i0"}', token })).body,
        MarketResultSchema,
      ],
      [(await raw('GET', '/v1/world?since=0', { token })).body, WorldResponseSchema],
      [(await raw('POST', '/v1/chat', { body: '{"text":"hi"}', token })).body, ChatResultSchema],
      [(await raw('GET', '/v1/leaderboards', { token })).body, BoardsResponseSchema],
      [(await raw('GET', '/v1/journal', { token })).body, JournalResponseSchema],
      [
        (await raw('POST', '/v1/journal/rest-days', { body: '{"days":[6,7]}', token })).body,
        RestDaysResultSchema,
      ],
    ]
    for (const [body, schema] of checks) expect(() => schema.parse(body)).not.toThrow()
    // The client agrees: it parses the same bodies.
    expect(await http.account({ deviceToken: token })).toMatchObject({ returns: 0 })
  })

  it('DELETE /v1/account deletes the caller, whose token is unauthorized from then on', async () => {
    const http = new HttpClient({ baseUrl: base, fetch: nodeFetch })
    const token = await freshToken()
    const other = await freshToken()
    expect(await raw('DELETE', '/v1/account', { token: 'forged' })).toEqual({
      status: 200,
      body: { reason: 'unauthorized' },
    })
    expect(await http.deleteAccount({ deviceToken: token })).toEqual({ deleted: true })
    expect(await http.account({ deviceToken: token })).toEqual({ reason: 'unauthorized' })
    expect(await raw('DELETE', '/v1/account', { token })).toEqual({
      status: 200,
      body: { reason: 'unauthorized' },
    })
    expect(await http.account({ deviceToken: other })).toMatchObject({ returns: 0 })
  })
})

describe('HTTP host binding', () => {
  it('binds loopback by default and the host it is given otherwise', async () => {
    const make = () =>
      createFakeServer({
        kv: new MemoryKeyValue(),
        now: async () => T0,
        speed: 1,
        flags: {},
        seedSource: () => 5,
        tokenSource: () => crypto.randomUUID(),
        playerName: 'kevin',
        seed: 9,
      })
    const loopback = await make().listen(0)
    const any = await make().listen(0, '0.0.0.0')
    try {
      expect(loopback.host).toBe('127.0.0.1')
      expect(any.host).toBe('0.0.0.0')
      const r = await fetch(`http://127.0.0.1:${any.port}/v1/health`)
      expect(r.status).toBe(200)
    } finally {
      await loopback.close()
      await any.close()
    }
  })
})

describe('HTTP host access log', () => {
  it('writes one access log line per request, without the token, a header or a body', async () => {
    const lines: string[] = []
    let n = 0
    const server = createFakeServer({
      kv: new MemoryKeyValue(),
      now: async () => T0,
      speed: 1,
      flags: {},
      seedSource: () => 5,
      tokenSource: () => `tok-7f3a9c-${n++}`,
      playerName: 'kevin',
      seed: 9,
      log: (line) => lines.push(line),
    })
    const listening = await server.listen(0)
    try {
      const at = `http://127.0.0.1:${listening.port}`
      const post = (path: string, body: unknown, token?: string) =>
        fetch(at + path, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(body),
        }).then((r) => r.json())
      const b = BootstrapSchema.parse(
        await post('/v1/bootstrap', { clientVersion: '0.1.0', deviceToken: null }),
      )
      // A known token travels in the bootstrap body.
      await post('/v1/bootstrap', { clientVersion: '0.1.0', deviceToken: b.deviceToken })
      const events = [{ t: 'tick' as const }]
      const batchId = crypto.randomUUID()
      BatchAckSchema.parse(
        await post(
          '/v1/batches',
          {
            batchId,
            accountId: b.account.accountId,
            seq: 0,
            clientVersion: '0.1.0',
            simVersion: SIM_VERSION,
            cursor: 0,
            baseHash: b.hash,
            resultHash: hashState(replay(b.state, events).state),
            events: events.map((e) => ({ ...e, at: 1 })),
          },
          b.deviceToken,
        ),
      )
      await fetch(`${at}/v1/nowhere?token=${b.deviceToken}`)

      expect(lines).toHaveLength(4)
      expect(lines[0]).toMatch(/^POST \/v1\/bootstrap 200 \d+ms$/)
      expect(lines[1]).toMatch(/^POST \/v1\/bootstrap 200 \d+ms$/)
      expect(lines[2]).toMatch(/^POST \/v1\/batches 200 \d+ms$/)
      expect(lines[3]).toMatch(/^GET \/v1\/nowhere 404 \d+ms$/)
      const all = lines.join('\n')
      for (const secret of [b.deviceToken, 'Bearer', 'authorization', batchId, b.hash])
        expect(all).not.toContain(secret)
    } finally {
      await listening.close()
    }
  })
})

describe('HTTP host GitHub link', () => {
  const github = (options: { clientId?: string; fetch?: FetchLike }) =>
    createFakeServer({
      kv: new MemoryKeyValue(),
      now: async () => T0,
      speed: 1,
      flags: {},
      seedSource: () => 5,
      tokenSource: () => crypto.randomUUID(),
      playerName: 'kevin',
      seed: 9,
      link: 'github',
      githubClientId: options.clientId,
      githubFetch: options.fetch ?? (async () => ({ status: 500, ok: false, text: '' })),
    })

  it('a github host without a client id refuses the link start', async () => {
    const listening = await github({}).listen(0)
    try {
      const client = new HttpClient({
        baseUrl: `http://127.0.0.1:${listening.port}`,
        fetch: nodeFetch,
      })
      const boot = await booted(client, { clientVersion: '0.3.0', deviceToken: null })
      expect(await client.linkStart({ deviceToken: boot.deviceToken })).toEqual({
        refusal: 'link_unavailable',
        message: 'This server cannot link GitHub accounts: it has no GitHub client id.',
      })
    } finally {
      await listening.close()
    }
  })

  it('a link poll does not hold the ledger while GitHub answers', async () => {
    let answerToken: () => void = () => undefined
    const tokenAsked = new Promise<void>((asked) => {
      answerToken = asked
    })
    let release: () => void = () => undefined
    const released = new Promise<void>((r) => {
      release = r
    })
    const json = (body: unknown) => ({ status: 200, ok: true, text: JSON.stringify(body) })
    const fetch: FetchLike = async (url) => {
      if (url.endsWith('/login/device/code')) {
        return json({
          device_code: 'dc',
          user_code: 'WDJB-MJHT',
          verification_uri: 'https://github.com/login/device',
          expires_in: 900,
          interval: 5,
        })
      }
      if (url.endsWith('/access_token')) {
        answerToken()
        await released
        return json({ access_token: 'gho_x' })
      }
      return json({ login: 'octocat' })
    }
    const listening = await github({ clientId: 'Iv1.client', fetch }).listen(0)
    try {
      const client = new HttpClient({
        baseUrl: `http://127.0.0.1:${listening.port}`,
        fetch: nodeFetch,
      })
      const a = await booted(client, { clientVersion: '0.3.0', deviceToken: null })
      const b = await booted(client, { clientVersion: '0.3.0', deviceToken: null })
      const start = await client.linkStart({ deviceToken: a.deviceToken })
      if ('reason' in start || 'refusal' in start) throw new Error('expected a start')
      const poll = client.linkPoll({ deviceToken: a.deviceToken }, start.code)
      await tokenAsked
      // GitHub is still answering a's poll: b's batch goes through meanwhile.
      const events = [{ t: 'tick' as const }]
      const ack = await client.submit(
        {
          batchId: crypto.randomUUID(),
          accountId: b.account.accountId,
          seq: 0,
          clientVersion: '0.3.0',
          simVersion: SIM_VERSION,
          cursor: 0,
          baseHash: b.hash,
          resultHash: hashState(replay(b.state, events).state),
          events: events.map((e) => ({ ...e, at: 1 })),
        },
        { deviceToken: b.deviceToken },
      )
      expect(ack.ok).toBe(true)
      release()
      const linked = await poll
      if ('reason' in linked || linked.status !== 'linked') throw new Error('expected linked')
      expect(linked.account.linked).toEqual({ provider: 'github', login: 'octocat' })
    } finally {
      release()
      await listening.close()
    }
  })
})

/** A host on `kv` with `extra` options, listening; `at` its base URL. */
async function hostOn(kv: KeyValue, extra: Partial<FakeServerOptions> = {}) {
  const server = createFakeServer({
    kv,
    now: async () => T0,
    speed: 1,
    flags: {},
    seedSource: () => 5,
    tokenSource: () => crypto.randomUUID(),
    playerName: 'kevin',
    seed: 9,
    ...extra,
  })
  const listening = await server.listen(0)
  const at = `http://127.0.0.1:${listening.port}`
  const call = async (
    method: string,
    path: string,
    options: { body?: unknown; token?: string; headers?: Record<string, string> } = {},
  ) => {
    const r = await fetch(at + path, {
      method,
      headers: {
        ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
        ...options.headers,
      },
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    })
    return { status: r.status, body: JSON.parse(await r.text()) as unknown }
  }
  return { at, call, close: listening.close }
}

const ADMIN = 'admin-5e1f0c-secret'

describe('HTTP host admin flags', () => {
  it('a host without an admin token has no admin routes', async () => {
    const h = await hostOn(new MemoryKeyValue())
    try {
      const r = await h.call('POST', '/v1/admin/flags', {
        body: { 'chat.enabled': false },
        token: ADMIN,
      })
      expect(r).toEqual({ status: 404, body: { error: 'route' } })
    } finally {
      await h.close()
    }
  })

  it('a wrong or missing admin token is unauthorized and sets nothing', async () => {
    const lines: string[] = []
    const h = await hostOn(new MemoryKeyValue(), {
      adminToken: ADMIN,
      adminLog: (line) => lines.push(line),
    })
    try {
      const body = { 'chat.enabled': false }
      const wrong = await h.call('POST', '/v1/admin/flags', { body, token: 'guess' })
      expect(wrong).toEqual({ status: 401, body: { error: 'unauthorized' } })
      const missing = await h.call('POST', '/v1/admin/flags', { body })
      expect(missing).toEqual({ status: 401, body: { error: 'unauthorized' } })
      // The player's bearer token is not the admin's.
      const boot = BootstrapSchema.parse(
        (
          await h.call('POST', '/v1/bootstrap', {
            body: { clientVersion: '0.3.0', deviceToken: null },
          })
        ).body,
      )
      expect(boot.config.flags['chat.enabled']).toBe(true)
      expect(lines).toHaveLength(2)
      for (const line of lines) expect(line).toMatch(/^admin \S+Z flags - unauthorized$/)
      expect(lines.join('\n')).not.toContain('guess')
    } finally {
      await h.close()
    }
  })

  it('a flag set over the admin route survives a restart', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'pf-admin-')), 'fake.json')
    const lines: string[] = []
    const options = { adminToken: ADMIN, adminLog: (line: string) => lines.push(line) }
    const first = await hostOn(new FileKeyValue(path), options)
    let token = ''
    try {
      const set = await first.call('POST', '/v1/admin/flags', {
        body: { 'chat.enabled': false, maintenance: true },
        token: ADMIN,
      })
      expect(set.status).toBe(200)
      expect(set.body).toMatchObject({ flags: { 'chat.enabled': false, maintenance: true } })
      // The next call sees it.
      const boot = BootstrapSchema.parse(
        (
          await first.call('POST', '/v1/bootstrap', {
            body: { clientVersion: '0.3.0', deviceToken: null },
          })
        ).body,
      )
      token = boot.deviceToken
      expect(boot.config.flags).toMatchObject({ 'chat.enabled': false, maintenance: true })
      const chat = await first.call('POST', '/v1/chat', { body: { text: 'hi' }, token })
      expect(chat.body).toEqual({ ok: false, reason: 'chat_closed' })
    } finally {
      await first.close()
    }
    // Restarted on the same file, with start flags that say otherwise.
    const second = await hostOn(new FileKeyValue(path), {
      ...options,
      flags: { 'chat.enabled': true, maintenance: false },
    })
    try {
      const info = AccountResponseSchema.parse(
        (await second.call('GET', '/v1/account', { token })).body,
      )
      if ('reason' in info) throw new Error('unauthorized')
      expect(info.config.flags).toMatchObject({ 'chat.enabled': false, maintenance: true })
      const chat = await second.call('POST', '/v1/chat', { body: { text: 'hi' }, token })
      expect(chat.body).toEqual({ ok: false, reason: 'chat_closed' })
      const on = await second.call('POST', '/v1/admin/flags', {
        body: { 'chat.enabled': true },
        token: ADMIN,
      })
      expect(on.body).toMatchObject({ flags: { 'chat.enabled': true, maintenance: true } })
    } finally {
      await second.close()
    }
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatch(
      /^admin \d{4}-\d\d-\d\dT[\d:.]+Z flags chat\.enabled=false,maintenance=true ok$/,
    )
    expect(lines[1]).toMatch(/^admin \S+Z flags chat\.enabled=true ok$/)
    expect(lines.join('\n')).not.toContain(ADMIN)
  })

  it('sandbox.enabled and unknown flags are refused, and nothing is set', async () => {
    const lines: string[] = []
    const h = await hostOn(new MemoryKeyValue(), {
      adminToken: ADMIN,
      adminLog: (line) => lines.push(line),
    })
    try {
      const sandbox = await h.call('POST', '/v1/admin/flags', {
        body: { 'sandbox.enabled': true, 'chat.enabled': false },
        token: ADMIN,
      })
      expect(sandbox.status).toBe(400)
      expect(JSON.stringify(sandbox.body)).toContain('sandbox.enabled')
      for (const body of [{ bogus: true }, { 'chat.enabled': 'no' }, {}, [], null]) {
        const r = await h.call('POST', '/v1/admin/flags', { body, token: ADMIN })
        expect(r.status).toBe(400)
      }
      const boot = BootstrapSchema.parse(
        (
          await h.call('POST', '/v1/bootstrap', {
            body: { clientVersion: '0.3.0', deviceToken: null },
          })
        ).body,
      )
      expect(boot.config.flags).toMatchObject({ 'sandbox.enabled': false, 'chat.enabled': true })
      expect(lines).toHaveLength(6)
      for (const line of lines) expect(line).toMatch(/^admin \S+Z flags - refused$/)
    } finally {
      await h.close()
    }
  })
})

describe('HTTP host admin ban', () => {
  it('a ban over the admin route refuses every call of that account, and logs one line', async () => {
    const lines: string[] = []
    const h = await hostOn(new MemoryKeyValue(), {
      adminToken: ADMIN,
      adminLog: (line) => lines.push(line),
      flags: { 'chat.enabled': true },
    })
    try {
      const http = new HttpClient({ baseUrl: h.at, fetch: nodeFetch })
      const boot = await booted(http, { clientVersion: '0.3.0', deviceToken: null })
      const other = await booted(http, { clientVersion: '0.3.0', deviceToken: null })
      const accountId = boot.account.accountId
      const auth = { deviceToken: boot.deviceToken }

      const unauthorized = await h.call('POST', '/v1/admin/ban', {
        body: { accountId, reason: 'spam' },
        token: boot.deviceToken,
      })
      expect(unauthorized).toEqual({ status: 401, body: { error: 'unauthorized' } })
      expect(await http.account(auth)).toMatchObject({ account: { accountId } })

      const ban = await h.call('POST', '/v1/admin/ban', {
        body: { accountId, reason: 'spam in chat' },
        token: ADMIN,
      })
      expect(ban).toEqual({
        status: 200,
        body: { accountId, banned: { reason: 'spam in chat', at: T0 } },
      })

      const message = 'Promptfall: this account is banned: spam in chat'
      const refused = { ok: false, reason: 'banned', message }
      expect(
        await http.bootstrap({ clientVersion: '0.3.0', deviceToken: boot.deviceToken }),
      ).toEqual({ refusal: 'banned', message })
      const events = [{ t: 'tick' as const }]
      const batch = {
        batchId: crypto.randomUUID(),
        accountId,
        seq: boot.seq,
        clientVersion: '0.3.0',
        simVersion: SIM_VERSION,
        cursor: boot.cursor,
        baseHash: hashState(boot.state),
        resultHash: hashState(replay(boot.state, events).state),
        events: events.map((e) => ({ ...e, at: T0 })),
      }
      expect(await http.submit(batch, auth)).toEqual(refused)
      expect(await http.browse(auth, { kind: 'item', sort: 'price', page: 0 })).toEqual({
        reason: 'banned',
        message,
      })
      expect(await http.buy(auth, 'any')).toEqual(refused)
      expect(await http.world(auth, 0)).toEqual({ reason: 'banned', message })
      expect(await http.chat(auth, 'hello')).toEqual(refused)
      // Another account plays on.
      expect(await http.chat({ deviceToken: other.deviceToken }, 'hello')).toMatchObject({
        ok: false,
        reason: 'not_linked',
      })

      expect(lines).toEqual([
        expect.stringMatching(/^admin \S+Z ban - unauthorized$/),
        expect.stringMatching(new RegExp(`^admin \\S+Z ban ${accountId} ok$`)),
      ])
      expect(lines.join('\n')).not.toContain(boot.deviceToken)
    } finally {
      await h.close()
    }
  })

  it('an unknown account is a 404 and a bad body a 400, each logged', async () => {
    const lines: string[] = []
    const h = await hostOn(new MemoryKeyValue(), {
      adminToken: ADMIN,
      adminLog: (line) => lines.push(line),
    })
    try {
      const unknown = await h.call('POST', '/v1/admin/ban', {
        body: { accountId: 'nobody', reason: 'spam' },
        token: ADMIN,
      })
      expect(unknown).toEqual({ status: 404, body: { error: 'account' } })
      for (const body of [
        {},
        { accountId: 'nobody' },
        { accountId: 'nobody', reason: '' },
        { accountId: 'nobody', reason: 'r'.repeat(121) },
        { accountId: 'nobody', reason: 'two\nlines' },
        { accountId: 'no body', reason: 'spam' },
      ]) {
        const r = await h.call('POST', '/v1/admin/ban', { body, token: ADMIN })
        expect(r.status).toBe(400)
      }
      expect(lines[0]).toMatch(/^admin \S+Z ban nobody unknown$/)
      expect(lines.slice(1)).toHaveLength(6)
      for (const line of lines.slice(1)) expect(line).toMatch(/^admin \S+Z ban - refused$/)
    } finally {
      await h.close()
    }
  })
})

describe('HTTP host admin unban', () => {
  it('unban over the admin route lifts the login and its account, and logs one line', async () => {
    const lines: string[] = []
    const h = await hostOn(new MemoryKeyValue(), {
      adminToken: ADMIN,
      adminLog: (line) => lines.push(line),
    })
    try {
      const http = new HttpClient({ baseUrl: h.at, fetch: nodeFetch })
      /** A fresh account's link, which the fake approves as `kevin`. */
      const link = async () => {
        const boot = await booted(http, { clientVersion: '0.3.0', deviceToken: null })
        const auth = { deviceToken: boot.deviceToken }
        const start = await http.linkStart(auth)
        if (!('code' in start)) throw new Error('expected a link start')
        return { boot, auth, polled: await http.linkPoll(auth, start.code) }
      }
      const banned = await link()
      expect(banned.polled).toMatchObject({ status: 'linked' })
      const accountId = banned.boot.account.accountId
      const ban = await h.call('POST', '/v1/admin/ban', {
        body: { accountId, reason: 'cheating' },
        token: ADMIN,
      })
      expect(ban.status).toBe(200)
      // The login is banned: a fresh account cannot link it, and is not banned for trying.
      const refused = await link()
      expect(refused.polled).toEqual({
        status: 'ended',
        reason: 'denied',
        message: 'Promptfall: this GitHub account is banned: cheating',
      })
      expect(await http.account(refused.auth)).toMatchObject({ account: { linked: null } })

      const body = { login: 'Kevin' }
      const wrong = await h.call('POST', '/v1/admin/unban', { body, token: 'guess' })
      expect(wrong).toEqual({ status: 401, body: { error: 'unauthorized' } })
      const missing = await h.call('POST', '/v1/admin/unban', { body })
      expect(missing).toEqual({ status: 401, body: { error: 'unauthorized' } })
      const unknown = await h.call('POST', '/v1/admin/unban', {
        body: { login: 'octocat' },
        token: ADMIN,
      })
      expect(unknown).toEqual({ status: 404, body: { error: 'login' } })
      expect((await http.account(banned.auth)) as object).toMatchObject({ reason: 'banned' })

      const unban = await h.call('POST', '/v1/admin/unban', { body, token: ADMIN })
      expect(unban).toEqual({ status: 200, body: { login: 'kevin', lifted: [accountId] } })
      expect(await http.account(banned.auth)).toMatchObject({ account: { accountId } })
      expect((await link()).polled).toMatchObject({ status: 'linked' })
      for (const body of [{}, { login: '' }, { login: 'two words' }, { login: 'k'.repeat(65) }]) {
        const r = await h.call('POST', '/v1/admin/unban', { body, token: ADMIN })
        expect(r.status).toBe(400)
      }

      expect(lines.slice(1)).toEqual([
        expect.stringMatching(/^admin \S+Z unban - unauthorized$/),
        expect.stringMatching(/^admin \S+Z unban - unauthorized$/),
        expect.stringMatching(/^admin \S+Z unban octocat unknown$/),
        expect.stringMatching(/^admin \S+Z unban kevin ok$/),
        ...Array.from({ length: 4 }, () => expect.stringMatching(/^admin \S+Z unban - refused$/)),
      ])
    } finally {
      await h.close()
    }
  })

  it('a host without an admin token has no unban route', async () => {
    const h = await hostOn(new MemoryKeyValue())
    try {
      const r = await h.call('POST', '/v1/admin/unban', { body: { login: 'kevin' }, token: ADMIN })
      expect(r).toEqual({ status: 404, body: { error: 'route' } })
    } finally {
      await h.close()
    }
  })
})

describe('HTTP host mint cap', () => {
  it('the sixth mint from one address in an hour is refused and a known token passes', async () => {
    let now = T0
    const h = await hostOn(new MemoryKeyValue(), { now: async () => now })
    const from = (address: string, deviceToken: string | null) =>
      h.call('POST', '/v1/bootstrap', {
        body: { clientVersion: '0.3.0', deviceToken },
        headers: { 'x-forwarded-for': address },
      })
    try {
      const tokens: string[] = []
      for (let i = 0; i < 5; i++) {
        const r = await from('203.0.113.7', null)
        tokens.push(BootstrapSchema.parse(r.body).deviceToken)
      }
      now += 30 * 60_000
      const sixth = await from('203.0.113.7', null)
      expect(sixth.status).toBe(200)
      const refused = BootstrapResponseSchema.parse(sixth.body)
      expect(refused).toMatchObject({ refusal: 'rate_limited', message: expect.any(String) })
      // A known token from the capped address always passes.
      const known = BootstrapSchema.parse((await from('203.0.113.7', tokens[0] ?? '')).body)
      expect(known.deviceToken).toBe(tokens[0])
      // Another address has its own count; the last hop of the header is the one Caddy wrote.
      BootstrapSchema.parse((await from('203.0.113.8', null)).body)
      expect(
        BootstrapResponseSchema.parse((await from('198.51.100.1, 203.0.113.7', null)).body),
      ).toMatchObject({ refusal: 'rate_limited' })
      // An hour after the first mint, the address mints again.
      now += 30 * 60_000
      BootstrapSchema.parse((await from('203.0.113.7', null)).body)
    } finally {
      await h.close()
    }
  })

  it('a bootstrap with an unknown token is refused as unknown and spends no mint', async () => {
    const h = await hostOn(new MemoryKeyValue())
    const from = (deviceToken: string | null) =>
      h.call('POST', '/v1/bootstrap', {
        body: { clientVersion: '0.3.0', deviceToken },
        headers: { 'x-forwarded-for': '203.0.113.9' },
      })
    try {
      for (let i = 0; i < 4; i++) BootstrapSchema.parse((await from(null)).body)
      for (let i = 0; i < 3; i++) {
        const r = await from('forged')
        expect(r.status).toBe(200)
        expect(BootstrapResponseSchema.parse(r.body)).toEqual({
          refusal: 'unknown',
          message: expect.any(String),
        })
      }
      // The three unknown answers spent nothing: the fifth mint passes, the sixth is capped.
      BootstrapSchema.parse((await from(null)).body)
      expect(BootstrapResponseSchema.parse((await from(null)).body)).toMatchObject({
        refusal: 'rate_limited',
      })
      // A capped address with an unknown token still hears unknown, not the cap.
      expect(BootstrapResponseSchema.parse((await from('forged')).body)).toMatchObject({
        refusal: 'unknown',
      })
    } finally {
      await h.close()
    }
  })

  it('without the forwarded header the connection address is capped', async () => {
    const h = await hostOn(new MemoryKeyValue())
    try {
      const mint = () =>
        h.call('POST', '/v1/bootstrap', { body: { clientVersion: '0.3.0', deviceToken: null } })
      for (let i = 0; i < 5; i++) BootstrapSchema.parse((await mint()).body)
      expect(BootstrapResponseSchema.parse((await mint()).body)).toMatchObject({
        refusal: 'rate_limited',
      })
    } finally {
      await h.close()
    }
  })
})

describe('FileKeyValue', () => {
  it('round-trips through the file with tmp-and-rename', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pf-kv-'))
    const path = join(dir, 'nested', 'fake.json')
    const a = new FileKeyValue(path)
    expect(a.persistedClock).toBeNull()
    a.attachClock(() => ({ virtualAt: 123, realAt: 456 }))
    await a.set('pf:counter', 3)
    await a.set('pf:acct:x:record', { deep: { list: [1, 2] } })
    await a.flush()
    const b = new FileKeyValue(path)
    expect(await b.get('pf:counter')).toBe(3)
    expect(await b.get('pf:acct:x:record')).toEqual({ deep: { list: [1, 2] } })
    expect(b.persistedClock).toEqual({ virtualAt: 123, realAt: 456 })
    expect(JSON.parse(readFileSync(path, 'utf8')).kv['pf:counter']).toBe(3)
  })

  it('writes nothing until flush', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pf-kv-'))
    const path = join(dir, 'fake.json')
    const a = new FileKeyValue(path)
    await a.set('k', 1)
    expect(new FileKeyValue(path).keys()).toEqual([])
  })
})

describe('VirtualClock', () => {
  it('runs speed virtual ms per real ms', () => {
    let real = 1000
    const clock = new VirtualClock({ speed: 10, persisted: null, realNow: () => real })
    expect(clock.nowSync()).toBe(1000)
    real += 50
    expect(clock.nowSync()).toBe(1500)
  })

  it('resumes monotonically after a restart with a different speed', () => {
    let real = 1_000_000
    const first = new VirtualClock({ speed: 10, persisted: null, realNow: () => real })
    real += 1000
    const snap = first.snapshot()
    expect(snap).toEqual({ virtualAt: 1_010_000, realAt: 1_001_000 })
    real += 500 // the process was down for half a second
    const second = new VirtualClock({ speed: 1, persisted: snap, realNow: () => real })
    const resumed = second.nowSync()
    expect(resumed).toBeGreaterThan(snap.virtualAt)
    expect(resumed).toBe(1_010_500)
    real += 100
    expect(second.nowSync()).toBe(1_010_600)
  })

  it('never goes backwards when the wall clock does', () => {
    let real = 5000
    const clock = new VirtualClock({ speed: 2, persisted: null, realNow: () => real })
    real += 100
    const a = clock.nowSync()
    real -= 1000
    expect(clock.nowSync()).toBe(a)
  })
})

describe('parseFlags', () => {
  it('reads name=value pairs over the ledger flags', () => {
    expect(parseFlags([])).toEqual({})
    expect(parseFlags(['chat.enabled=false'])).toEqual({ 'chat.enabled': false })
    expect(parseFlags(['maintenance=true', 'worldboss.enabled=false'])).toEqual({
      maintenance: true,
      'worldboss.enabled': false,
    })
    expect(parseFlags(['sandbox.enabled=true'])).toEqual({ 'sandbox.enabled': true })
  })

  it('throws on an unknown name or a value other than true and false', () => {
    expect(() => parseFlags(['bogus=true'])).toThrow(/chat\.enabled/)
    expect(() => parseFlags(['chat.enabled=maybe'])).toThrow()
    expect(() => parseFlags(['chat.enabled'])).toThrow()
  })
})

describe('parsePlayerName', () => {
  it('takes a name of 1 to 64 characters as it is', () => {
    expect(parsePlayerName('kevin')).toBe('kevin')
    expect(parsePlayerName('k'.repeat(64))).toBe('k'.repeat(64))
  })

  it('rejects an empty player name', () => {
    expect(() => parsePlayerName('')).toThrow(/--player-name wants 1 to 64 characters/)
  })

  it('rejects a player name over 64 characters', () => {
    expect(() => parsePlayerName('k'.repeat(65))).toThrow(
      /--player-name wants 1 to 64 characters; got 65/,
    )
  })
})
