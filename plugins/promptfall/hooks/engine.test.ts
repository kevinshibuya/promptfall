import type { PluginState } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import {
  GameEngine,
  OLD_VERSION_NOTICE,
  RETRYING_NOTICE,
  UNREACHABLE_NOTICE,
  UPDATE_NOTICE,
} from './engine'
import { approveAs, Ledger } from './vendor/ledger.js'
import {
  type Auth,
  type Batch,
  type BatchAck,
  type Bootstrap,
  type ListingQuery,
  type MarketResult,
  MemoryKeyValue,
  type NewOrder,
  type ServerClient,
} from './vendor/protocol.js'
import { createInitialState, type GameState, hashState, SIM_VERSION } from './vendor/sim.js'

type Patch = Partial<PluginState['promptfall']>
type Timer = { ms: number; fn: () => void; done: boolean }

/** A ServerClient over a Ledger that records batches and can hold, corrupt, fail or fake answers. */
class Recorder implements ServerClient {
  batches: Batch[] = []
  acks: BatchAck[] = []
  bootstraps = 0
  accounts = 0
  corruptNextSeq = false
  corruptNextCursor = false
  failSubmits = 0
  refuseNextSubmit: number | null = null
  failBootstraps = 0
  fakeNextAck: BatchAck | null = null
  /** Every submit answers `cursor_behind` with nothing new: the loop that waits for a resync. */
  alwaysBehind = false
  /** Called with each submit's count as it goes out. */
  onSubmit: (count: number) => void = () => undefined
  hold: Promise<void> | null = null
  holdBootstrap: Promise<void> | null = null
  constructor(readonly inner: Ledger) {}

  async bootstrap(input: {
    clientVersion: string
    deviceToken: string | null
  }): Promise<Bootstrap> {
    this.bootstraps += 1
    if (this.holdBootstrap) await this.holdBootstrap
    if (this.failBootstraps > 0) {
      this.failBootstraps -= 1
      throw new Error('unreachable')
    }
    return this.inner.bootstrap(input)
  }

  async submit(batch: Batch, auth: Auth): Promise<BatchAck> {
    let sent = this.corruptNextSeq ? { ...batch, seq: batch.seq + 5 } : batch
    if (this.corruptNextCursor) sent = { ...sent, cursor: sent.cursor + 5 }
    this.corruptNextSeq = false
    this.corruptNextCursor = false
    this.batches.push(sent)
    this.onSubmit(this.batches.length)
    if (this.hold) await this.hold
    if (this.failSubmits > 0) {
      this.failSubmits -= 1
      throw new Error('unreachable')
    }
    if (this.refuseNextSubmit !== null) {
      const error = Object.assign(new Error(`status ${this.refuseNextSubmit}`), {
        name: 'ServerError',
        status: this.refuseNextSubmit,
      })
      this.refuseNextSubmit = null
      throw error
    }
    if (this.alwaysBehind) {
      const ack: BatchAck = {
        ok: false,
        reason: 'cursor_behind',
        delivery: { cursor: batch.cursor, events: [] },
      }
      this.acks.push(ack)
      return ack
    }
    if (this.fakeNextAck) {
      const fake = this.fakeNextAck
      this.fakeNextAck = null
      this.acks.push(fake)
      return fake
    }
    const ack = await this.inner.submit(sent, auth)
    this.acks.push(ack)
    return ack
  }

  account(auth: Auth) {
    this.accounts += 1
    return this.inner.account(auth)
  }
  linkStart(auth: Auth) {
    return this.inner.linkStart(auth)
  }
  linkPoll(auth: Auth, code: string) {
    return this.inner.linkPoll(auth, code)
  }
  browse(auth: Auth, query: ListingQuery) {
    return this.inner.browse(auth, query)
  }
  list(auth: Auth, input: { kind: 'item' | 'hero'; id: string; price: number }) {
    return this.inner.list(auth, input)
  }
  cancelListing(auth: Auth, id: string) {
    return this.inner.cancelListing(auth, id)
  }
  buy(auth: Auth, id: string) {
    return this.inner.buy(auth, id)
  }
  myOrders(auth: Auth) {
    return this.inner.myOrders(auth)
  }
  placeOrder(auth: Auth, input: NewOrder) {
    return this.inner.placeOrder(auth, input)
  }
  cancelOrder(auth: Auth, id: string) {
    return this.inner.cancelOrder(auth, id)
  }
  matchingOrders(auth: Auth, itemId: string) {
    return this.inner.matchingOrders(auth, itemId)
  }
  fillOrder(auth: Auth, orderId: string, itemId: string) {
    return this.inner.fillOrder(auth, orderId, itemId)
  }
  world(auth: Auth, since: number) {
    return this.inner.world(auth, since)
  }
  chat(auth: Auth, text: string) {
    return this.inner.chat(auth, text)
  }
  leaderboards(auth: Auth) {
    return this.inner.leaderboards(auth)
  }
}

/** `flags`: the ledger's, e.g. the sandbox switch for item grants. */
function setup(kv = new MemoryKeyValue(), flags?: Record<string, boolean>) {
  let t = 1_000_000
  const now = async () => t
  const timers: Timer[] = []
  const ledger = new Ledger({
    kv,
    now,
    minClientVersion: '0.1.0',
    seedSource: () => 4242,
    tokenSource: () => crypto.randomUUID(),
    linkApprover: approveAs('player'),
    ...(flags ? { flags } : {}),
  })
  const client = new Recorder(ledger)
  const patches: Patch[] = []
  const effects: string[] = []
  const calls: { count: number; view: boolean }[] = []
  const toasts: { text: string; timeoutMs: number | undefined }[] = []
  const engine = new GameEngine({
    client,
    kv,
    now,
    newBatchId: () => crypto.randomUUID(),
    publish: async (patch) => {
      patches.push(patch)
    },
    onEffects: (list, _at, view) => {
      for (const e of list) effects.push(e.k)
      calls.push({ count: list.length, view: view !== null })
    },
    toast: (text, timeoutMs) => {
      toasts.push({ text, timeoutMs })
    },
    after: (ms, fn) => {
      timers.push({ ms, fn, done: false })
    },
    random: () => 0,
  })
  /** Runs the timers not run yet whose delay is at most `ms`, then waits for the engine. */
  const fire = async (ms = Number.POSITIVE_INFINITY) => {
    for (const timer of timers.filter((x) => !x.done && x.ms <= ms)) {
      timer.done = true
      timer.fn()
    }
    await engine.idle()
    await engine.settled()
  }
  const notices = () => patches.filter((p) => 'notice' in p).map((p) => p.notice)
  return {
    kv,
    ledger,
    client,
    engine,
    patches,
    effects,
    calls,
    toasts,
    timers,
    fire,
    notices,
    advance: (ms: number) => {
      t += ms
    },
    at: () => t,
  }
}

const gold = (s: GameState | null) => s?.gold ?? -1

test('start saves the device token and a second engine finds the same account', async () => {
  const a = setup()
  await a.engine.start()
  const token = await a.kv.get('deviceToken')
  expect(typeof token).toBe('string')
  expect(a.patches.some((p) => p.view?.firstRun === true)).toBe(true)
  const b = setup(a.kv)
  await b.engine.start()
  expect(b.engine.accountId()).toBe(a.engine.accountId())
  expect(b.patches.some((p) => p.view?.firstRun === false)).toBe(true)
})

test('twelve events flush as one batch from the initial hash at cursor 0', async () => {
  const { engine, client, at } = setup()
  await engine.start()
  for (let i = 0; i < 5; i++) engine.apply({ t: 'tool_call' }, at())
  for (let i = 0; i < 7; i++) engine.apply({ t: 'tick' }, at())
  await engine.flush()
  expect(client.batches).toHaveLength(1)
  expect(client.batches[0]?.events).toHaveLength(12)
  expect(client.batches[0]?.cursor).toBe(0)
  expect(client.batches[0]?.baseHash).toBe(hashState(createInitialState(4242)))
  expect(client.acks[0]).toMatchObject({ ok: true, seq: 1, duplicate: false })
})

test('a flush timer firing during a trade is skipped; the trade delivery lands after the ack', async () => {
  const { engine, client, ledger, at } = setup()
  await engine.start()
  const accountId = engine.accountId() ?? ''
  engine.apply({ t: 'tick' }, at())
  let release: () => void = () => undefined
  client.hold = new Promise<void>((resolve) => {
    release = resolve
  })
  const trade = engine.trade(async (c, auth): Promise<MarketResult> => {
    await ledger.host.credit(accountId, 250, 'test')
    const info = await c.account(auth)
    if ('reason' in info) return { ok: false, reason: 'unauthorized' }
    return { ok: true, delivery: info.delivery }
  })
  await engine.flushIfIdle()
  expect(client.batches).toHaveLength(1)
  release()
  client.hold = null
  const r = await trade
  expect(r.ok).toBe(true)
  expect(client.acks.map((a) => a.ok)).toEqual([true])
  expect(gold(engine.state())).toBe(250)
  engine.apply({ t: 'tick' }, at())
  await engine.flush()
  expect(client.batches[1]?.cursor).toBe(1)
  expect(client.acks[1]).toMatchObject({ ok: true })
})

test('a delivery repeated across responses applies once', async () => {
  const { engine, ledger, client, effects } = setup()
  await engine.start()
  await ledger.host.credit(engine.accountId() ?? '', 40, 'gift')
  await engine.sync()
  await engine.sync()
  expect(client.accounts).toBe(2)
  expect(gold(engine.state())).toBe(40)
  expect(effects.filter((k) => k === 'gold')).toHaveLength(1)
})

test('cursor_behind keeps the batch, applies the delivery and resubmits with the new cursor', async () => {
  const { engine, ledger, client, kv, at } = setup()
  await engine.start()
  engine.apply({ t: 'tick' }, at())
  engine.apply({ t: 'tool_call' }, at())
  await ledger.host.credit(engine.accountId() ?? '', 99, 'behind')
  await engine.flush()
  expect(client.acks.map((a) => (a.ok ? 'ok' : a.reason))).toEqual(['cursor_behind', 'ok'])
  expect(client.batches[1]?.batchId).toBe(client.batches[0]?.batchId)
  expect(client.batches[1]?.events).toEqual(client.batches[0]?.events)
  expect(client.batches[0]?.cursor).toBe(0)
  expect(client.batches[1]?.cursor).toBe(1)
  expect(gold(engine.state())).toBe(99)
  const boot = await ledger.bootstrap({
    clientVersion: '0.1.0',
    deviceToken: String(await kv.get('deviceToken')),
  })
  expect(boot.seq).toBe(1)
  expect(boot.cursor).toBe(1)
  expect(boot.state).toEqual(engine.state())
})

test('a seq mismatch adopts the server and the next flush succeeds', async () => {
  const { engine, client, at } = setup()
  await engine.start()
  engine.apply({ t: 'tick' }, at())
  client.corruptNextSeq = true
  await engine.flush()
  expect(client.acks[0]).toMatchObject({ ok: false, reason: 'seq_mismatch', seq: 0 })
  engine.apply({ t: 'tool_call' }, at())
  await engine.flush()
  expect(client.acks[1]).toMatchObject({ ok: true, seq: 1 })
})

test('a cursor_mismatch adopts the state and cursor', async () => {
  const { engine, client, at, notices } = setup()
  await engine.start()
  engine.apply({ t: 'tick' }, at())
  client.corruptNextCursor = true
  await engine.flush()
  expect(client.acks[0]).toMatchObject({ ok: false, reason: 'cursor_mismatch', cursor: 0 })
  expect(notices()).toContain('Promptfall resynced')
  expect(engine.state()).toEqual(createInitialState(4242))
  engine.apply({ t: 'tick' }, at())
  await engine.flush()
  expect(client.acks[1]).toMatchObject({ ok: true, seq: 1 })
})

/** A store whose account `old` holds a state at sim version `v`, its token saved as the device's. */
async function savedAt(v: number): Promise<MemoryKeyValue> {
  const kv = new MemoryKeyValue()
  await kv.set('pf:acct:old:record', {
    account: { accountId: 'old', seed: 3, createdAt: 1, displayName: null, linked: null },
    state: { ...createInitialState(3), v },
    seq: 2,
    refillAt: { tick: 0, tool_call: 0, rest: 0, turn_end: 0 },
    buckets: { tick: 70, tool_call: 140, rest: 30, turn_end: 30 },
    committed: [],
  })
  await kv.set('pf:token:t-old', 'old')
  await kv.set('deviceToken', 't-old')
  return kv
}

test('an older save raises the reset notice, pauses and publishes no view', async () => {
  const { engine, patches, client, at, notices } = setup(await savedAt(1))
  await engine.start()
  expect(engine.isPaused()).toBe(true)
  expect(patches).toContainEqual({ view: null, mode: 'paused', notice: OLD_VERSION_NOTICE })
  expect(notices()).not.toContain(UPDATE_NOTICE)
  expect(patches.some((p) => p.view)).toBe(false)
  engine.apply({ t: 'tick' }, at())
  await engine.flush()
  expect(client.batches).toHaveLength(0)
})

test('a newer server raises the update notice, never the reset notice', async () => {
  const { engine, patches, client, at, notices } = setup(await savedAt(SIM_VERSION + 1))
  await engine.start()
  expect(engine.isPaused()).toBe(true)
  expect(patches).toContainEqual({ view: null, mode: 'paused', notice: UPDATE_NOTICE })
  expect(notices()).not.toContain(OLD_VERSION_NOTICE)
  expect(patches.some((p) => p.view)).toBe(false)
  engine.apply({ t: 'tick' }, at())
  await engine.flush()
  expect(client.batches).toHaveLength(0)
})

test('a save at the client sim version raises no version notice', async () => {
  const { engine, notices } = setup(await savedAt(SIM_VERSION))
  await engine.start()
  expect(engine.isPaused()).toBe(false)
  expect(notices()).not.toContain(UPDATE_NOTICE)
  expect(notices()).not.toContain(OLD_VERSION_NOTICE)
})

test('a thrown submit keeps the batch and retries it verbatim on the backoff', async () => {
  const { engine, client, at, advance, timers, fire, notices } = setup()
  await engine.start()
  engine.apply({ t: 'tick' }, at())
  client.failSubmits = 2
  await engine.flush()
  expect(notices().at(-1)).toBe(RETRYING_NOTICE)
  expect(engine.isPaused()).toBe(false)
  expect(timers.map((x) => x.ms)).toContain(1000)
  // The 15-second timer stays out of the way during the outage.
  await engine.flushIfIdle()
  expect(client.batches).toHaveLength(1)
  // Ticking and buffering go on before 120 s.
  advance(60_000)
  engine.apply({ t: 'tick' }, at())
  expect(engine.accepting()).toBe(true)
  await fire(1000)
  expect(client.batches).toHaveLength(2)
  expect(timers.map((x) => x.ms)).toContain(2000)
  advance(61_000)
  await fire(2000)
  // Answered on the third attempt: the same batch every time, then the buffer at once.
  expect(client.batches).toHaveLength(4)
  expect(new Set(client.batches.slice(0, 3).map((b) => b.batchId)).size).toBe(1)
  expect(client.batches[2]?.events).toHaveLength(1)
  expect(client.acks[0]).toMatchObject({ ok: true })
  expect(notices().at(-1)).toBeNull()
  expect(client.batches[3]?.events).toHaveLength(1)
  expect(client.acks[1]).toMatchObject({ ok: true, seq: 2 })
})

test('past 120 s of outage apply refuses and the notice says unreachable', async () => {
  const { engine, client, at, advance, fire, notices } = setup()
  await engine.start()
  engine.apply({ t: 'tick' }, at())
  client.failSubmits = 100
  await engine.flush()
  advance(120_000)
  await fire(120_000)
  expect(notices()).toContain(UNREACHABLE_NOTICE)
  expect(engine.accepting()).toBe(false)
  const before = engine.state()
  engine.apply({ t: 'tick' }, at())
  expect(engine.state()).toBe(before)
  await expect(engine.sync()).rejects.toThrow('unreachable')
  await expect(
    engine.trade(async () => ({ ok: false, reason: 'gone' }) as MarketResult),
  ).rejects.toThrow('unreachable')
  client.failSubmits = 0
  await fire()
  expect(engine.accepting()).toBe(true)
  expect(notices().at(-1)).toBeNull()
})

test('the backoff doubles up to 30 s and jitter stretches it', async () => {
  const kv = new MemoryKeyValue()
  const s = setup(kv)
  await s.engine.start()
  s.engine.apply({ t: 'tick' }, s.at())
  s.client.failSubmits = 100
  await s.engine.flush()
  for (let i = 0; i < 6; i++) await s.fire(60_000)
  const delays = s.timers.map((x) => x.ms).filter((ms) => ms !== 120_000)
  expect(delays).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000])
})

test('a duplicate ack with a foreign hash resyncs', async () => {
  const { engine, client, at } = setup()
  await engine.start()
  engine.apply({ t: 'tick' }, at())
  client.fakeNextAck = {
    ok: true,
    seq: 1,
    hash: '0000000000000000',
    duplicate: true,
    delivery: { cursor: 0, events: [] },
  }
  await engine.flush()
  expect(client.bootstraps).toBe(2)
  expect(engine.state()).toEqual(createInitialState(4242))
  engine.apply({ t: 'tick' }, at())
  await engine.flush()
  expect(client.acks.at(-1)).toMatchObject({ ok: true, seq: 1 })
})

test('a thrown bootstrap retries start on the backoff and recovers', async () => {
  const { engine, client, fire, notices, patches } = setup()
  client.failBootstraps = 1
  await engine.start()
  expect(notices().at(-1)).toBe(RETRYING_NOTICE)
  expect(engine.state()).toBeNull()
  await fire(1000)
  expect(client.bootstraps).toBe(2)
  expect(engine.state()).toEqual(createInitialState(4242))
  expect(notices().at(-1)).toBeNull()
  expect(patches.some((p) => p.view)).toBe(true)
})

test('sync flushes, calls account and applies its delivery', async () => {
  const { engine, client, ledger, at } = setup()
  await engine.start()
  engine.apply({ t: 'tick' }, at())
  await ledger.host.credit(engine.accountId() ?? '', 15, 'gift')
  await engine.sync()
  expect(client.acks.map((a) => (a.ok ? 'ok' : a.reason))).toEqual(['cursor_behind', 'ok'])
  expect(client.accounts).toBe(1)
  expect(gold(engine.state())).toBe(15)
})

test('a notice timer clears only its own notice', async () => {
  const { engine, timers, notices } = setup()
  await engine.start()
  engine.notice('a', 10_000)
  engine.notice('b', 10_000)
  timers[0]?.fn()
  await engine.settled()
  expect(notices().at(-1)).toBe('b')
  timers[1]?.fn()
  await engine.settled()
  expect(notices().at(-1)).toBeNull()
})

test('a fractional timestamp is stored as whole milliseconds', async () => {
  const { engine, client } = setup()
  await engine.start()
  engine.apply({ t: 'tick' }, 1000.5)
  await engine.flush()
  expect(engine.isPaused()).toBe(false)
  expect(client.acks[0]).toMatchObject({ ok: true })
  expect(client.batches[0]?.events[0]?.at).toBe(1000)
})

test('a trade with a non-empty buffer flushes first: the batch arrives before the market call', async () => {
  const { engine, client, at } = setup()
  await engine.start()
  engine.apply({ t: 'tick' }, at())
  engine.apply({ t: 'tool_call' }, at())
  let batchesAtCall = -1
  const r = await engine.trade(async (c, auth) => {
    batchesAtCall = client.batches.length
    return c.list(auth, { kind: 'item', id: 'inope', price: 10 })
  })
  expect(batchesAtCall).toBe(1)
  expect(client.acks[0]).toMatchObject({ ok: true })
  expect(r).toEqual({ ok: false, reason: 'not_linked' })
})

test('a flush that pauses the engine stops the trade', async () => {
  const { engine, client, at } = setup()
  await engine.start()
  engine.apply({ t: 'tick' }, at())
  client.fakeNextAck = { ok: false, reason: 'unauthorized' }
  let called = false
  await expect(
    engine.trade(async () => {
      called = true
      return { ok: false, reason: 'gone' } as MarketResult
    }),
  ).rejects.toThrow('paused')
  expect(called).toBe(false)
  expect(engine.isPaused()).toBe(true)
})

test('a paused primary refuses a trade as paused', async () => {
  const { engine } = setup()
  await engine.start()
  engine.setPaused(UPDATE_NOTICE)
  let called = false
  const trade = engine.trade(async () => {
    called = true
    return { ok: false, reason: 'gone' } as MarketResult
  })
  await expect(trade).rejects.toThrow('paused')
  await expect(trade).rejects.not.toThrow('not_primary')
  expect(called).toBe(false)
})

test("a stopped engine's in-flight bootstrap writes nothing", async () => {
  const { engine, client, kv } = setup()
  let release: () => void = () => undefined
  client.holdBootstrap = new Promise<void>((resolve) => {
    release = resolve
  })
  const started = engine.start()
  for (let i = 0; i < 20 && client.bootstraps === 0; i++) await Promise.resolve()
  expect(client.bootstraps).toBe(1)
  engine.stop()
  release()
  await started
  expect(await kv.get('deviceToken')).toBeUndefined()
  expect(engine.state()).toBeNull()
})

test('a server event that invalidates a buffered event re-steps it as rejected', async () => {
  const { engine, client, effects, at } = setup()
  await engine.start()
  engine.apply({ t: 'set_party', heroIds: ['h0', 'h1', 'h3'] }, at())
  expect(effects.filter((k) => k === 'rejected')).toHaveLength(0)
  client.fakeNextAck = {
    ok: false,
    reason: 'cursor_behind',
    delivery: {
      cursor: 1,
      events: [{ n: 1, event: { t: 'listed', listingId: 'L1', kind: 'hero', id: 'h3', fee: 0 } }],
    },
  }
  await engine.flush()
  expect(effects.filter((k) => k === 'rejected')).toHaveLength(1)
  // The resubmit at cursor 1 meets a ledger still at cursor 0: the fake delivery's doing.
  expect(client.acks.at(-1)).toMatchObject({ ok: false, reason: 'cursor_mismatch' })
})

test('a submit the server refuses with a 4xx is an outage, retried on the backoff', async () => {
  const { engine, client, at, notices, timers, fire } = setup()
  await engine.start()
  engine.apply({ t: 'tick' }, at())
  client.refuseNextSubmit = 400
  await engine.flush()
  await engine.settled()
  expect(engine.isPaused()).toBe(false)
  expect(engine.isUnreachable()).toBe(true)
  expect(notices().at(-1)).toBe(RETRYING_NOTICE)
  expect(notices()).not.toContain(UPDATE_NOTICE)
  expect(timers.map((x) => x.ms)).toContain(1000)
  await fire(1000)
  expect(client.batches).toHaveLength(2)
  expect(client.acks[0]).toMatchObject({ ok: true })
  expect(engine.isUnreachable()).toBe(false)
  expect(notices().at(-1)).toBeNull()
})

test('a version-gate ack and a sim-version ack pause with the update notice', async () => {
  for (const ack of [
    { ok: false, reason: 'version_gate', minClientVersion: '9.0.0' },
    { ok: false, reason: 'sim_version', simVersion: SIM_VERSION + 1 },
  ] as const) {
    const { engine, client, at, notices, timers } = setup()
    await engine.start()
    engine.apply({ t: 'tick' }, at())
    client.fakeNextAck = ack
    await engine.flush()
    await engine.settled()
    expect(engine.isPaused()).toBe(true)
    expect(engine.isUnreachable()).toBe(false)
    expect(notices().at(-1)).toBe(UPDATE_NOTICE)
    expect(timers).toHaveLength(0)
  }
})

test('the first success after an outage flushes the buffer, before the next scheduled flush', async () => {
  const { engine, client, at, advance, fire } = setup()
  await engine.start()
  engine.apply({ t: 'tick' }, at())
  client.failSubmits = 1
  await engine.flush()
  expect(engine.isUnreachable()).toBe(true)
  // Buffered during the outage.
  advance(5_000)
  engine.apply({ t: 'tick' }, at())
  engine.apply({ t: 'tool_call' }, at())
  await fire(1000)
  // The retried batch, then the buffer at once: no 15-second wait.
  expect(client.batches).toHaveLength(3)
  expect(client.batches[1]?.batchId).toBe(client.batches[0]?.batchId)
  expect(client.batches[1]?.events).toHaveLength(1)
  expect(client.batches[2]?.events.map((e) => e.t)).toEqual(['tick', 'tool_call'])
  expect(client.acks).toMatchObject([
    { ok: true, seq: 1 },
    { ok: true, seq: 2 },
  ])
  expect(engine.unsentCount()).toBe(0)
})

test('a success outside an outage leaves the buffer to the next scheduled flush', async () => {
  const { engine, client, at } = setup()
  await engine.start()
  engine.apply({ t: 'tick' }, at())
  let release: () => void = () => undefined
  client.hold = new Promise<void>((resolve) => {
    release = resolve
  })
  const flushed = engine.flush()
  for (let i = 0; i < 20 && client.batches.length === 0; i++) await Promise.resolve()
  // Buffered while the batch is in flight.
  engine.apply({ t: 'tick' }, at())
  release()
  client.hold = null
  await flushed
  expect(client.batches).toHaveLength(1)
  expect(engine.unsentCount()).toBe(1)
})

test('a 5xx on submit stays an outage', async () => {
  const { engine, client, at, notices } = setup()
  await engine.start()
  engine.apply({ t: 'tick' }, at())
  client.refuseNextSubmit = 503
  await engine.flush()
  expect(engine.isPaused()).toBe(false)
  expect(engine.isUnreachable()).toBe(true)
  expect(notices().at(-1)).toBe(RETRYING_NOTICE)
})

test('committedBoss follows the committed state, not the local one', async () => {
  const { engine, ledger, kv, advance, at } = setup()
  await engine.start()
  const auth = { deviceToken: String(await kv.get('deviceToken')) }
  advance(10_800_000 - at() - 1_000)
  await ledger.world(auth, 0)
  advance(2_000)
  await ledger.world(auth, 0)
  expect(engine.committedBoss()).toBeNull()
  engine.apply({ t: 'tick' }, at())
  await engine.flush()
  const committed = engine.committedBoss()
  expect(committed?.bossId).toMatch(/^wb/)
  for (let i = 0; i < 3; i++) engine.apply({ t: 'tick' }, at())
  expect(engine.state()?.boss?.dealt).toBeGreaterThan(committed?.dealt ?? 0)
  expect(engine.committedBoss()).toEqual(committed)
})

test('the effects dep fires on every applied tick, an effect-less one too, with the view', async () => {
  const a = setup()
  await a.engine.start()
  a.calls.length = 0
  // The first tick of a fight is pure filling: gauges start empty, nobody acts.
  a.engine.apply({ t: 'tick' }, a.at())
  expect(a.calls).toHaveLength(1)
  expect(a.calls[0]).toEqual({ count: 0, view: true })
})

// ---------------------------------------------------------------------------
// A discarded engine: its notice clears, its flush goes quiet

test('a discarded engine clears its notice', async () => {
  const { engine, client, at, fire, notices, patches } = setup()
  await engine.start()
  engine.apply({ t: 'tick' }, at())
  client.failSubmits = 100
  await engine.flush()
  expect(notices().at(-1)).toBe(RETRYING_NOTICE)
  engine.stop()
  await engine.settled()
  expect(notices().at(-1)).toBeNull()
  // Its retries and its notice timers publish nothing more, and it takes no event.
  expect(engine.accepting()).toBe(false)
  const before = patches.length
  await fire()
  expect(patches).toHaveLength(before)
})

test("a stopped engine's flush submits and toasts nothing", async () => {
  const { engine, client, ledger, effects, toasts, at } = setup()
  await engine.start()
  engine.apply({ t: 'tick' }, at())
  // The server holds gold the engine has not seen: the submit answers cursor_behind with it.
  await ledger.host.credit(engine.accountId() ?? '', 99, 'behind')
  let release: () => void = () => undefined
  client.hold = new Promise<void>((resolve) => {
    release = resolve
  })
  const flushed = engine.flush()
  for (let i = 0; i < 20 && client.batches.length === 0; i++) await Promise.resolve()
  expect(client.batches).toHaveLength(1)
  engine.stop()
  release()
  await flushed
  expect(client.acks.map((a) => (a.ok ? 'ok' : a.reason))).toEqual(['cursor_behind'])
  expect(client.batches).toHaveLength(1)
  expect(effects).not.toContain('gold')
  expect(toasts).toEqual([])
})

test('a stopped engine caught in a cursor-behind loop stops looping', async () => {
  const { engine, client, at } = setup()
  await engine.start()
  engine.apply({ t: 'tick' }, at())
  client.alwaysBehind = true
  client.onSubmit = (count) => {
    if (count === 2) engine.stop()
  }
  await engine.flush()
  // Without the stop, five stuck answers end in a resync: a second bootstrap.
  expect(client.batches).toHaveLength(2)
  expect(client.bootstraps).toBe(1)
})

test('a bootstrap hands on only the events past the cursor the last primary showed', async () => {
  const a = setup()
  await a.engine.start()
  const account = a.engine.accountId() ?? ''
  await a.ledger.host.credit(account, 40, 'gift')
  // The primary receives the gift unflushed and toasts it.
  await a.engine.sync()
  await a.engine.settled()
  expect(a.effects).toContain('gold')
  expect(await a.kv.get('deviceToken:shown')).toEqual({ account, cursor: 1 })
  // A sale fills before anyone has received it; then another session takes over.
  await a.ledger.host.credit(account, 30, 'sale')
  const promoted = setup(a.kv)
  await promoted.engine.start()
  expect(gold(promoted.engine.state())).toBe(70)
  expect(promoted.effects.filter((k) => k === 'gold')).toHaveLength(1)
  expect(promoted.patches.some((p) => p.view)).toBe(true)
})

test('a start with nothing shown hands the whole delivery on', async () => {
  const a = setup()
  await a.engine.start()
  await a.ledger.host.credit(a.engine.accountId() ?? '', 40, 'gift')
  await a.kv.delete('deviceToken:shown')
  const first = setup(a.kv)
  await first.engine.start()
  expect(first.effects).toContain('gold')
})

test('a shown cursor of another account is ignored', async () => {
  const a = setup()
  await a.engine.start()
  await a.ledger.host.credit(a.engine.accountId() ?? '', 40, 'gift')
  await a.kv.set('deviceToken:shown', { account: 'other', cursor: 99 })
  const next = setup(a.kv)
  await next.engine.start()
  expect(next.effects).toContain('gold')
})

test('a stopped engine records nothing as shown', async () => {
  const { engine, client, ledger, kv, at } = setup()
  await engine.start()
  await engine.settled()
  const before = await kv.get('deviceToken:shown')
  engine.apply({ t: 'tick' }, at())
  // The server holds gold the engine has not seen: the submit answers cursor_behind with it.
  await ledger.host.credit(engine.accountId() ?? '', 99, 'behind')
  let release: () => void = () => undefined
  client.hold = new Promise<void>((resolve) => {
    release = resolve
  })
  const flushed = engine.flush()
  for (let i = 0; i < 20 && client.batches.length === 0; i++) await Promise.resolve()
  engine.stop()
  release()
  await flushed
  await engine.settled()
  expect(await kv.get('deviceToken:shown')).toEqual(before)
})

// ---------------------------------------------------------------------------
// The revoked toast: a hash-mismatch ack names what it took, from the state held before adopting it

/** An engine on a sandbox ledger that holds an Oak Staff, a Rune Staff and an Iron Sword, granted and synced. */
async function holding() {
  const s = setup(new MemoryKeyValue(), { 'sandbox.enabled': true })
  await s.engine.start()
  const accountId = s.engine.accountId() ?? ''
  for (const base of ['oak_staff', 'rune_staff', 'iron_sword']) {
    expect(
      await s.ledger.host.sandbox(accountId, { t: 'sandbox_item', base, rarity: 'rare' }),
    ).toEqual({
      ok: true,
    })
  }
  await s.engine.sync()
  const ids = (s.engine.state()?.inventory ?? []).map((i) => i.id)
  expect(ids).toHaveLength(3)
  return { ...s, ids }
}

/** The next submit answers a hash mismatch that revokes `ids` and hands back the initial state. */
function revoking(client: Recorder, ids: string[]): void {
  const state = createInitialState(4242)
  client.fakeNextAck = {
    ok: false,
    reason: 'hash_mismatch',
    seq: 1,
    state,
    hash: hashState(state),
    cursor: 3,
    revokedItemIds: ids,
  }
}

test('a hash-mismatch ack that revokes one committed item toasts it by name for 8 s', async () => {
  const { engine, client, toasts, ids, at } = await holding()
  engine.apply({ t: 'tick' }, at())
  await engine.flush()
  expect(client.acks.at(-1)).toMatchObject({ ok: true })
  engine.apply({ t: 'tick' }, at())
  revoking(client, [ids[0] ?? ''])
  await engine.flush()
  expect(toasts).toEqual([{ text: 'The server revoked Oak Staff', timeoutMs: 8000 }])
  expect(engine.state()?.inventory).toEqual([])
})

test('a hash-mismatch ack that revokes three items folds them into one toast', async () => {
  const { engine, client, toasts, ids, at } = await holding()
  engine.apply({ t: 'tick' }, at())
  revoking(client, ids)
  await engine.flush()
  expect(toasts).toEqual([{ text: 'The server revoked 3 items', timeoutMs: 8000 }])
})

test('a revoked id in neither state toasts the unnamed form', async () => {
  const { engine, client, toasts, at } = await holding()
  engine.apply({ t: 'tick' }, at())
  revoking(client, ['no-such-item'])
  await engine.flush()
  expect(toasts).toEqual([{ text: 'The server revoked an item', timeoutMs: 8000 }])
})

test('an item only in the local, unflushed state is still named when revoked', async () => {
  const { engine, client, toasts, ids, at } = await holding()
  // Granted and synced, never flushed: the committed state has no Rune Staff yet.
  engine.apply({ t: 'tick' }, at())
  revoking(client, [ids[1] ?? ''])
  await engine.flush()
  expect(toasts).toEqual([{ text: 'The server revoked Rune Staff', timeoutMs: 8000 }])
})

test('a hash-mismatch ack that revokes nothing raises no toast', async () => {
  const { engine, client, toasts, at } = await holding()
  engine.apply({ t: 'tick' }, at())
  revoking(client, [])
  await engine.flush()
  expect(toasts).toEqual([])
})
