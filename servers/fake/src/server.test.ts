import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  AccountResponseSchema,
  BatchAckSchema,
  BoardsResponseSchema,
  BootstrapSchema,
  ChatResultSchema,
  ErrorBodySchema,
  HealthSchema,
  HttpClient,
  LinkPollResponseSchema,
  LinkStartResponseSchema,
  ListingPageResponseSchema,
  MarketResultSchema,
  MatchingOrdersResponseSchema,
  MemoryKeyValue,
  MyOrdersResponseSchema,
  WorldResponseSchema,
} from '@promptfall/protocol'
import { hashState, replay, SIM_VERSION } from '@promptfall/sim'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { VirtualClock } from './clock'
import { FileKeyValue } from './file-kv'
import { parseFlags } from './flags'
import { createFakeServer } from './server'
import { nodeFetch } from './test-support'

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
      clientVersion: '0.1.0',
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
    ]
    for (const [body, schema] of checks) expect(() => schema.parse(body)).not.toThrow()
    // The client agrees: it parses the same bodies.
    expect(await http.account({ deviceToken: token })).toMatchObject({ returns: 0 })
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
