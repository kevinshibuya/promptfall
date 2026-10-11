import { BOSS_GRID_MS, type Bootstrap, MemoryKeyValue } from '@promptfall/protocol'
import {
  createInitialState,
  type GameState,
  type Hero,
  hashState,
  type Item,
  replay,
  SIM_VERSION,
} from '@promptfall/sim'
import { describe, expect, it } from 'vitest'
import { type AccountRecord, LOG_CAP } from './books'
import { EXPIRY_MS } from './goods'
import { approveAs, Ledger, type LedgerOptions, type LinkApprover } from './ledger'

class CountingKeyValue extends MemoryKeyValue {
  flushes = 0
  writes = 0
  /** Gets of an account record. */
  accountReads = 0
  async get(key: string): Promise<unknown> {
    if (key.startsWith('pf:acct:')) this.accountReads += 1
    return super.get(key)
  }
  async set(key: string, value: unknown): Promise<void> {
    this.writes += 1
    await super.set(key, value)
  }
  async delete(key: string): Promise<void> {
    this.writes += 1
    await super.delete(key)
  }
  async flush(): Promise<void> {
    this.flushes += 1
  }
}

function makeLedger(overrides: Partial<LedgerOptions> = {}) {
  let t = 1_700_000_000_000
  let n = 0
  const kv = overrides.kv ?? new CountingKeyValue()
  const ledger = new Ledger({
    kv,
    now: async () => t,
    minClientVersion: '0.1.0',
    seedSource: () => 7,
    tokenSource: () => `token-${n++}`,
    linkApprover: approveAs('player'),
    ...overrides,
  })
  return {
    ledger,
    kv,
    advance: (ms: number) => {
      t += ms
    },
  }
}

const rareItem = (id: string): Item => ({
  id,
  base: 'steel_longsword',
  rarity: 'rare',
  affixes: [],
  equippedBy: null,
  tradeableAt: null,
})

async function record(kv: MemoryKeyValue, accountId: string): Promise<AccountRecord> {
  return (await kv.get(`pf:acct:${accountId}:record`)) as AccountRecord
}

describe('Ledger host', () => {
  it('mint creates an account with the given state and name', async () => {
    const { ledger, kv } = makeLedger()
    const state = { ...createInitialState(42), gold: 50_000 }
    const { accountId, deviceToken } = await ledger.host.mint({ state, name: 'Grim', linked: true })
    const boot = await ledger.bootstrap({ clientVersion: '0.1.0', deviceToken })
    if ('refusal' in boot) throw new Error(boot.refusal)
    expect(boot.account.accountId).toBe(accountId)
    expect(boot.account.displayName).toBe('Grim')
    expect(boot.account.linked).toEqual({ provider: 'github', login: 'Grim' })
    expect(boot.account.seed).toBe(42)
    expect(boot.state).toEqual(state)
    expect(boot.hash).toBe(hashState(state))
    const unlinked = await ledger.host.mint({ state, name: 'Pip', linked: false })
    const r = await record(kv as MemoryKeyValue, unlinked.accountId)
    expect(r.account.linked).toBeNull()
  })

  it('credit authors a credited event onto the effective state and the log', async () => {
    const { ledger, kv } = makeLedger()
    const boot = await ledger.bootstrap({ clientVersion: '0.1.0', deviceToken: null })
    await ledger.host.credit(boot.account.accountId, 300, 'stipend')
    const r = await record(kv as MemoryKeyValue, boot.account.accountId)
    expect(r.state.gold).toBe(boot.state.gold + 300)
    expect(r.committedState).toEqual(boot.state)
    expect(r.cursor).toBe(1)
    expect(r.committedCursor).toBe(0)
    expect(r.log).toEqual([{ n: 1, event: { t: 'credited', gold: 300, reason: 'stipend' } }])
  })

  it('credit on an unknown account throws and writes nothing', async () => {
    const { ledger, kv } = makeLedger()
    const before = (kv as MemoryKeyValue).keys().length
    await expect(ledger.host.credit('nobody', 1, 'x')).rejects.toThrow()
    expect((kv as MemoryKeyValue).keys().length).toBe(before)
  })

  it('settle folds the log into the committed state', async () => {
    const { ledger, kv } = makeLedger()
    const boot = await ledger.bootstrap({ clientVersion: '0.1.0', deviceToken: null })
    await ledger.host.credit(boot.account.accountId, 5, 'a')
    await ledger.host.credit(boot.account.accountId, 6, 'b')
    await ledger.host.settle(boot.account.accountId)
    const r = await record(kv as MemoryKeyValue, boot.account.accountId)
    expect(r.log).toEqual([])
    expect(r.committedCursor).toBe(2)
    expect(r.committedState).toEqual(r.state)
    expect(r.committedHash).toBe(hashState(r.state))
    const again = await ledger.bootstrap({ clientVersion: '0.1.0', deviceToken: boot.deviceToken })
    if ('refusal' in again) throw new Error(again.refusal)
    expect(again.cursor).toBe(2)
    expect(again.state.gold).toBe(boot.state.gold + 11)
    expect(again.delivery).toEqual({ cursor: 2, events: [] })
  })
})

describe('Ledger flags', () => {
  it('flags set through the host hold at once and load over the start flags after a restart', async () => {
    const kv = new MemoryKeyValue()
    const start = { 'chat.enabled': true, 'market.enabled': false, maintenance: true }
    const first = makeLedger({ kv, flags: start }).ledger
    const set = await first.host.setFlags({ 'chat.enabled': false, maintenance: false })
    expect(set).toMatchObject({
      'chat.enabled': false,
      'market.enabled': false,
      maintenance: false,
    })
    const boot = await first.bootstrap({ clientVersion: '0.1.0', deviceToken: null })
    expect(await first.chat({ deviceToken: boot.deviceToken }, 'hi')).toEqual({
      ok: false,
      reason: 'chat_closed',
    })
    await first.host.setFlags({ 'worldboss.enabled': false })

    const second = makeLedger({ kv, flags: start }).ledger
    const again = await second.bootstrap({ clientVersion: '0.1.0', deviceToken: null })
    expect(again.config.flags).toMatchObject({
      'chat.enabled': false,
      'market.enabled': false,
      'worldboss.enabled': false,
      maintenance: false,
      'sandbox.enabled': false,
    })
  })

  it('a stored sandbox flag is not loaded', async () => {
    const kv = new MemoryKeyValue()
    await kv.set('pf:flags', { 'sandbox.enabled': true, 'chat.enabled': false })
    const { ledger } = makeLedger({ kv })
    const boot = await ledger.bootstrap({ clientVersion: '0.1.0', deviceToken: null })
    expect(boot.config.flags).toMatchObject({ 'sandbox.enabled': false, 'chat.enabled': false })
  })

  it('knowsToken answers for a minted token and not for any other, writing nothing', async () => {
    const { ledger, kv } = makeLedger()
    const boot = await ledger.bootstrap({ clientVersion: '0.1.0', deviceToken: null })
    const writes = (kv as CountingKeyValue).writes
    expect(await ledger.knowsToken(boot.deviceToken)).toBe(true)
    expect(await ledger.knowsToken('forged')).toBe(false)
    expect((kv as CountingKeyValue).writes).toBe(writes)
  })
  it('only a null token mints: an empty token is unknown and writes nothing', async () => {
    const { ledger, kv } = makeLedger()
    const writes = (kv as CountingKeyValue).writes
    expect(await ledger.bootstrap({ clientVersion: '0.1.0', deviceToken: '' })).toMatchObject({
      refusal: 'unknown',
    })
    expect((kv as CountingKeyValue).writes).toBe(writes)
  })
})

describe('Ledger bans', () => {
  it('a banned account is refused on every call', async () => {
    const { ledger, kv } = makeLedger({ flags: { 'chat.enabled': true } })
    const state = { ...createInitialState(5), gold: 1000, inventory: [rareItem('it-1')] }
    const m = await ledger.host.mint({ state, name: 'Grim', linked: true })
    const auth = { deviceToken: m.deviceToken }
    const boot = await ledger.bootstrap({ clientVersion: '0.1.0', deviceToken: m.deviceToken })
    if ('refusal' in boot) throw new Error(boot.refusal)
    const listed = await ledger.list(auth, { kind: 'item', id: 'it-1', price: 100 })
    expect(listed.ok).toBe(true)

    const done = await ledger.host.ban(m.accountId, 'spam in chat')
    expect(done).toEqual({ reason: 'spam in chat', at: 1_700_000_000_000 })
    // Record-only: the account on the wire never carries it.
    expect((await record(kv as MemoryKeyValue, m.accountId)).banned).toEqual(done)

    const message = 'Promptfall: this account is banned: spam in chat'
    const banned = { reason: 'banned', message }
    const refused = { ok: false, reason: 'banned', message }
    expect(await ledger.bootstrap({ clientVersion: '0.1.0', deviceToken: m.deviceToken })).toEqual({
      refusal: 'banned',
      message,
    })
    expect(await ledger.submit(batchFor(boot, boot.state, 0), auth)).toEqual(refused)
    expect(await ledger.account(auth)).toEqual(banned)
    expect(await ledger.linkStart(auth)).toEqual(banned)
    expect(await ledger.linkPoll(auth, 'ABCDEFGH')).toEqual(banned)
    expect(await ledger.browse(auth, { kind: 'item', sort: 'price', page: 0 })).toEqual(banned)
    expect(await ledger.myOrders(auth)).toEqual(banned)
    expect(await ledger.matchingOrders(auth, 'it-1')).toEqual(banned)
    expect(await ledger.list(auth, { kind: 'item', id: 'it-1', price: 100 })).toEqual(refused)
    expect(await ledger.cancelListing(auth, 'any')).toEqual(refused)
    expect(await ledger.buy(auth, 'any')).toEqual(refused)
    const order = {
      base: 'steel_longsword',
      minRarity: 'rare' as const,
      affixId: null,
      maxPrice: 1,
    }
    expect(await ledger.placeOrder(auth, order)).toEqual(refused)
    expect(await ledger.cancelOrder(auth, 'any')).toEqual(refused)
    expect(await ledger.fillOrder(auth, 'any', 'it-1')).toEqual(refused)
    expect(await ledger.world(auth, 0)).toEqual(banned)
    expect(await ledger.chat(auth, 'hello')).toEqual(refused)
    expect(await ledger.leaderboards(auth)).toEqual(banned)
    // Still known: the mint cap lets the token past, and the bootstrap refuses it.
    expect(await ledger.knowsToken(m.deviceToken)).toBe(true)
  })

  /** A fresh account's link through to the approver's answer: the poll and the account after it. */
  async function freshLink(ledger: Ledger) {
    const boot = await ledger.bootstrap({ clientVersion: '0.1.0', deviceToken: null })
    const auth = { deviceToken: boot.deviceToken }
    const start = await ledger.linkStart(auth)
    if (!('code' in start)) throw new Error('expected a link start')
    const polled = await ledger.linkPoll(auth, start.code)
    return { polled, after: await ledger.account(auth) }
  }

  it('a ban records the linked login and link approval refuses it', async () => {
    const approved = { login: 'GRIM' }
    const { ledger, kv } = makeLedger({
      linkApprover: {
        ...approveAs(null),
        poll: async () => ({ status: 'approved', login: approved.login }),
      },
    })
    const m = await ledger.host.mint({ state: createInitialState(5), name: 'Grim', linked: true })
    await ledger.host.ban(m.accountId, 'cheating')
    expect(await (kv as MemoryKeyValue).get('pf:ban:grim')).toEqual({
      reason: 'cheating',
      at: 1_700_000_000_000,
      accountIds: [m.accountId],
    })

    // Any case of the login: the link ends denied with the ban's message, nothing more.
    for (const login of ['GRIM', 'grim', 'gRiM']) {
      approved.login = login
      const { polled, after } = await freshLink(ledger)
      expect(polled).toEqual({
        status: 'ended',
        reason: 'denied',
        message: 'Promptfall: this GitHub account is banned: cheating',
      })
      expect(after).toMatchObject({ account: { linked: null, displayName: null } })
    }

    // A login never banned links as today.
    approved.login = 'octocat'
    const { polled } = await freshLink(ledger)
    expect(polled).toMatchObject({
      status: 'linked',
      account: { linked: { provider: 'github', login: 'octocat' } },
    })
  })

  it('unban lifts a login ban with the account gone, and the ban of the account still there', async () => {
    for (const order of [
      [0, 1],
      [1, 0],
    ]) {
      const { ledger, kv } = makeLedger({ linkApprover: approveAs('grim') })
      expect(await ledger.host.unban('grim')).toBeNull()
      // Linking never made a login unique: two accounts carry it.
      const pair = [
        await ledger.host.mint({ state: createInitialState(5), name: 'Grim', linked: true }),
        await ledger.host.mint({ state: createInitialState(6), name: 'grim', linked: true }),
      ]
      const [gone, kept] = order.map((i) => pair[i])
      if (!gone || !kept) throw new Error('two accounts')
      await ledger.host.ban(gone.accountId, 'cheating')
      await ledger.host.ban(kept.accountId, 'alt account')
      expect(await (kv as MemoryKeyValue).get('pf:ban:grim')).toEqual({
        reason: 'cheating',
        at: 1_700_000_000_000,
        accountIds: [gone.accountId, kept.accountId],
      })
      expect(await ledger.deleteAccount({ deviceToken: gone.deviceToken })).toEqual({
        deleted: true,
      })

      expect(await ledger.host.unban('GriM')).toEqual({
        login: 'grim',
        lifted: [kept.accountId],
      })

      expect(await (kv as MemoryKeyValue).get('pf:ban:grim')).toBeUndefined()
      expect(await ledger.account({ deviceToken: kept.deviceToken })).toMatchObject({
        account: { accountId: kept.accountId },
      })
      expect((await record(kv as MemoryKeyValue, kept.accountId)).banned).toBeUndefined()
      expect((await freshLink(ledger)).polled).toMatchObject({ status: 'linked' })
      expect(await ledger.host.unban('grim')).toBeNull()
    }
  })

  it('a ban on an account that never linked records no login', async () => {
    const { ledger, kv } = makeLedger()
    const m = await ledger.host.mint({ state: createInitialState(5), name: 'Grim', linked: false })
    await ledger.host.ban(m.accountId, 'cheating')
    expect((kv as MemoryKeyValue).keys().filter((k) => k.startsWith('pf:ban:'))).toEqual([])
    expect(await ledger.account({ deviceToken: m.deviceToken })).toMatchObject({
      reason: 'banned',
    })
  })

  it('a ban names an account the ledger holds; another account plays on', async () => {
    const { ledger } = makeLedger()
    expect(await ledger.host.ban('nobody', 'x')).toBeNull()
    const other = await ledger.bootstrap({ clientVersion: '0.1.0', deviceToken: null })
    const m = await ledger.host.mint({ state: createInitialState(5), name: 'Grim', linked: true })
    await ledger.host.ban(m.accountId, 'cheating')
    const again = await ledger.bootstrap({ clientVersion: '0.1.0', deviceToken: other.deviceToken })
    if ('refusal' in again) throw new Error(again.refusal)
    expect(again).toMatchObject({ deviceToken: other.deviceToken })
    expect(await ledger.account({ deviceToken: other.deviceToken })).toMatchObject({
      account: { accountId: other.account.accountId },
    })
  })
})

describe('Ledger account delete', () => {
  it('delete cancels listings and orders, clears the boards and kills the token', async () => {
    const { ledger, kv } = makeLedger()
    const store = kv as MemoryKeyValue
    const order = { base: 'steel_longsword', minRarity: 'rare' as const, affixId: null }
    const leaver = await ledger.host.mint({
      state: {
        ...createInitialState(5),
        gold: 10_000,
        highestZone: 9,
        inventory: [rareItem('l-1')],
      },
      name: 'Leaver',
      linked: true,
    })
    const other = await ledger.host.mint({
      state: {
        ...createInitialState(6),
        gold: 10_000,
        highestZone: 4,
        inventory: [rareItem('o-1'), rareItem('o-2')],
      },
      name: 'Stayer',
      linked: true,
    })
    const mine = { deviceToken: leaver.deviceToken }
    const theirs = { deviceToken: other.deviceToken }
    expect((await ledger.list(mine, { kind: 'item', id: 'l-1', price: 100 })).ok).toBe(true)
    expect((await ledger.placeOrder(mine, { ...order, maxPrice: 500 })).ok).toBe(true)
    expect((await ledger.list(theirs, { kind: 'item', id: 'o-1', price: 200 })).ok).toBe(true)
    expect((await ledger.placeOrder(theirs, { ...order, maxPrice: 300 })).ok).toBe(true)
    // A row on this week's damage board, as a boss commit would leave it.
    const boards = (await store.get('pf:boards')) as { week: { damage: object } }
    boards.week.damage = {
      [leaver.accountId]: { name: 'Leaver', value: 900 },
      [other.accountId]: { name: 'Stayer', value: 100 },
    }
    await store.set('pf:boards', boards)
    await ledger.world(mine, 0)
    expect(await ledger.world(theirs, 0)).toMatchObject({ online: 2, here: ['Leaver'] })
    expect(await ledger.matchingOrders(theirs, 'o-2')).toMatchObject([
      { buyerId: leaver.accountId },
    ])
    const before = await record(store, other.accountId)

    expect(await ledger.deleteAccount(mine)).toEqual({ deleted: true })

    // The token is dead: every call is unauthorized, and a bootstrap with it is unknown.
    expect(await ledger.account(mine)).toEqual({ reason: 'unauthorized' })
    expect(
      await ledger.bootstrap({ clientVersion: '0.1.0', deviceToken: leaver.deviceToken }),
    ).toMatchObject({ refusal: 'unknown' })
    expect(await ledger.deleteAccount(mine)).toEqual({ reason: 'unauthorized' })
    expect(await ledger.knowsToken(leaver.deviceToken)).toBe(false)
    expect(await store.get(`pf:acct:${leaver.accountId}:record`)).toBeUndefined()
    expect(await store.get(`pf:token:${leaver.deviceToken}`)).toBeUndefined()
    // Its listing and order are gone from the market; the counterpart's stay.
    const page = await ledger.browse(theirs, { kind: 'item', sort: 'price', page: 0 })
    expect(page).toMatchObject({ total: 1, listings: [{ sellerId: other.accountId }] })
    expect(await ledger.matchingOrders(theirs, 'o-2')).toEqual([])
    expect(await ledger.myOrders(theirs)).toMatchObject({
      listings: [{ sellerId: other.accountId }],
      orders: [{ buyerId: other.accountId }],
    })
    // Off both boards and out of presence.
    expect(await ledger.leaderboards(theirs)).toMatchObject({
      highestZone: [{ accountId: other.accountId }],
      damage: [{ accountId: other.accountId }],
    })
    const stored = (await store.get('pf:boards')) as { zone: unknown[]; week: { damage: object } }
    expect(stored.zone).toHaveLength(1)
    expect(Object.keys(stored.week.damage)).toEqual([other.accountId])
    expect(await ledger.world(theirs, 0)).toMatchObject({ online: 1, here: [] })
    // Nothing settled on the counterpart: no item back, no refund, no event.
    expect(await record(store, other.accountId)).toEqual(before)
  })

  it('a banned account may delete itself and leave', async () => {
    const { ledger, kv } = makeLedger()
    const store = kv as MemoryKeyValue
    const m = await ledger.host.mint({
      state: { ...createInitialState(5), gold: 1000, inventory: [rareItem('b-1')] },
      name: 'Grim',
      linked: true,
    })
    const auth = { deviceToken: m.deviceToken }
    expect((await ledger.list(auth, { kind: 'item', id: 'b-1', price: 100 })).ok).toBe(true)
    await ledger.host.ban(m.accountId, 'cheating')
    expect(await ledger.account(auth)).toEqual({
      reason: 'banned',
      message: 'Promptfall: this account is banned: cheating',
    })

    expect(await ledger.deleteAccount(auth)).toEqual({ deleted: true })

    expect(await ledger.account(auth)).toEqual({ reason: 'unauthorized' })
    expect(await ledger.knowsToken(m.deviceToken)).toBe(false)
    expect(await store.get(`pf:acct:${m.accountId}:record`)).toBeUndefined()
    expect(await store.get(`pf:token:${m.deviceToken}`)).toBeUndefined()
    const other = await ledger.bootstrap({ clientVersion: '0.1.0', deviceToken: null })
    expect(
      await ledger.browse(
        { deviceToken: other.deviceToken },
        { kind: 'item', sort: 'price', page: 0 },
      ),
    ).toMatchObject({ total: 0 })
    expect(await ledger.leaderboards({ deviceToken: other.deviceToken })).toMatchObject({
      highestZone: [],
    })
  })
})

describe('Ledger host guards', () => {
  it('credit refuses what the wire would refuse, and writes nothing', async () => {
    const { ledger, kv } = makeLedger()
    const boot = await ledger.bootstrap({ clientVersion: '0.1.0', deviceToken: null })
    const id = boot.account.accountId
    await expect(ledger.host.credit(id, -1, 'x')).rejects.toThrow()
    await expect(ledger.host.credit(id, 1.5, 'x')).rejects.toThrow()
    await expect(ledger.host.credit(id, 1, 'r'.repeat(65))).rejects.toThrow()
    const r = await record(kv as MemoryKeyValue, id)
    expect(r.cursor).toBe(0)
    expect(r.log).toEqual([])
  })

  it('mint refuses an empty name or one over 64 characters, and takes 64', async () => {
    const { ledger } = makeLedger()
    const state = createInitialState(1)
    const bounds = /mint: name wants 1 to 64 characters/
    await expect(ledger.host.mint({ state, name: '', linked: true })).rejects.toThrow(bounds)
    await expect(ledger.host.mint({ state, name: 'n'.repeat(65), linked: true })).rejects.toThrow(
      bounds,
    )
    await expect(
      ledger.host.mint({ state, name: 'n'.repeat(64), linked: true }),
    ).resolves.toMatchObject({ accountId: expect.any(String) })
  })
})

describe('Ledger log', () => {
  it(`keeps at most ${LOG_CAP} entries, folding the oldest into the committed point`, async () => {
    const { ledger, kv } = makeLedger()
    const boot = await ledger.bootstrap({ clientVersion: '0.1.0', deviceToken: null })
    for (let i = 0; i < LOG_CAP + 3; i++) await ledger.host.credit(boot.account.accountId, 1, 'x')
    const r = await record(kv as MemoryKeyValue, boot.account.accountId)
    expect(r.log).toHaveLength(LOG_CAP)
    expect(r.log[0]?.n).toBe(4)
    expect(r.committedCursor).toBe(3)
    expect(r.committedState.gold).toBe(boot.state.gold + 3)
    expect(r.state.gold).toBe(boot.state.gold + LOG_CAP + 3)
  })

  it('a batch whose cursor fell behind the folded log adopts the state', async () => {
    const { ledger } = makeLedger()
    const boot = await ledger.bootstrap({ clientVersion: '0.1.0', deviceToken: null })
    for (let i = 0; i < LOG_CAP + 1; i++) await ledger.host.credit(boot.account.accountId, 1, 'x')
    const ack = await ledger.submit(batchFor(boot, boot.state, 0), {
      deviceToken: boot.deviceToken,
    })
    expect(ack).toMatchObject({ ok: false, reason: 'cursor_mismatch', cursor: LOG_CAP + 1 })
  })
})

function batchFor(boot: Bootstrap, base: GameState, cursor: number) {
  const events = [{ t: 'tick' as const }]
  return {
    batchId: crypto.randomUUID(),
    accountId: boot.account.accountId,
    seq: boot.seq,
    clientVersion: '0.1.0',
    simVersion: SIM_VERSION,
    cursor,
    baseHash: hashState(base),
    resultHash: hashState(replay(base, events).state),
    events: events.map((e) => ({ ...e, at: 1 })),
  }
}

describe('Ledger returns', () => {
  it('delivers each kind where a slot is free, skipping a full kind without blocking the next', async () => {
    const { ledger, kv } = makeLedger()
    const mem = kv as MemoryKeyValue
    const start = createInitialState(9)
    const full: GameState = {
      ...start,
      inventoryCap: 1,
      inventory: [rareItem('i0')],
    }
    const { accountId, deviceToken } = await ledger.host.mint({
      state: full,
      name: 'A',
      linked: true,
    })
    const spare: Hero = { ...(start.roster[3] as Hero), id: 'hspare', level: 6, xp: 3, hp: 5 }
    const r = await record(mem, accountId)
    r.returns = [
      { listingId: 'L1', goods: { kind: 'item', item: rareItem('i9') } },
      { listingId: 'L2', goods: { kind: 'hero', hero: spare } },
    ]
    await mem.set(`pf:acct:${accountId}:record`, r)
    await mem.set('pf:returns', [accountId])

    await ledger.host.sweep()
    const a = await record(mem, accountId)
    expect(a.returns.map((x) => x.listingId)).toEqual(['L1'])
    expect(a.state.roster.find((h) => h.id === 'hspare')).toEqual(spare)
    expect(a.log.map((e) => e.event.t)).toEqual(['returned'])
    expect(await mem.get('pf:returns')).toEqual([accountId])

    // A batch that frees the slot gets the item back in its own ack.
    const info = await ledger.account({ deviceToken })
    if ('reason' in info) throw new Error('unauthorized')
    expect(info.returns).toBe(1)
    const boot = await ledger.bootstrap({ clientVersion: '0.1.0', deviceToken })
    if ('refusal' in boot) throw new Error(boot.refusal)
    const local = replay(
      boot.state,
      boot.delivery.events.map((e) => e.event),
    ).state
    const events = [{ t: 'vendor' as const, itemId: 'i0' }]
    const ack = await ledger.submit(
      {
        batchId: crypto.randomUUID(),
        accountId,
        seq: 0,
        clientVersion: '0.1.0',
        simVersion: SIM_VERSION,
        cursor: 1,
        baseHash: hashState(boot.state),
        resultHash: hashState(replay(local, events).state),
        events: events.map((e) => ({ ...e, at: 1 })),
      },
      { deviceToken },
    )
    expect(ack).toMatchObject({ ok: true })
    if (!ack.ok) throw new Error('expected ok')
    expect(ack.delivery.events.map((e) => e.event)).toEqual([
      { t: 'returned', listingId: 'L1', goods: { kind: 'item', item: rareItem('i9') } },
    ])
    const b = await record(mem, accountId)
    expect(b.returns).toEqual([])
    expect(b.state.inventory.map((i) => i.id)).toEqual(['i9'])
    expect(await mem.get('pf:returns')).toEqual([])
  })
})

describe('Ledger with a v1 record', () => {
  it('bootstrap answers the old state as it is, cursor 0 and an empty delivery', async () => {
    const { ledger, kv } = makeLedger()
    const mem = kv as MemoryKeyValue
    const old = { ...createInitialState(3), v: 1 } as unknown as GameState
    const v1 = {
      account: { accountId: 'old', seed: 3, createdAt: 1, displayName: null, linked: null },
      state: old,
      seq: 4,
      refillAt: { tick: 0, tool_call: 0, rest: 0, turn_end: 0 },
      buckets: { tick: 70, tool_call: 140, rest: 30, turn_end: 30 },
      committed: [],
    }
    await mem.set('pf:acct:old:record', v1)
    await mem.set('pf:token:oldtoken', 'old')
    const boot = await ledger.bootstrap({ clientVersion: '0.1.0', deviceToken: 'oldtoken' })
    if ('refusal' in boot) throw new Error(boot.refusal)
    expect(boot.state).toEqual(old)
    expect(boot.seq).toBe(4)
    expect(boot.hash).toBe(hashState(old))
    expect(boot.cursor).toBe(0)
    expect(boot.delivery).toEqual({ cursor: 0, events: [] })
    expect(await mem.get('pf:acct:old:record')).toEqual(v1)
    const ack = await ledger.submit(batchFor(boot, old, 0), { deviceToken: 'oldtoken' })
    expect(ack).toEqual({ ok: false, reason: 'sim_version', simVersion: SIM_VERSION })
  })
})

describe('Ledger flush', () => {
  it('flushes once per mutating operation and never for a read', async () => {
    const { ledger, kv } = makeLedger()
    const counting = kv as CountingKeyValue
    const boot = await ledger.bootstrap({ clientVersion: '0.1.0', deviceToken: null })
    expect(counting.flushes).toBe(1)
    await ledger.bootstrap({ clientVersion: '0.1.0', deviceToken: boot.deviceToken })
    await ledger.account({ deviceToken: boot.deviceToken })
    expect(counting.flushes).toBe(1)
    await ledger.submit(batchFor(boot, boot.state, 0), { deviceToken: boot.deviceToken })
    expect(counting.flushes).toBe(2)
    await ledger.host.credit(boot.account.accountId, 1, 'x')
    expect(counting.flushes).toBe(3)
    const start = await ledger.linkStart({ deviceToken: boot.deviceToken })
    expect(counting.flushes).toBe(4)
    if ('reason' in start || 'refusal' in start) throw new Error('expected a start')
    await ledger.linkPoll({ deviceToken: boot.deviceToken }, start.code)
    expect(counting.flushes).toBe(5)
  })

  it('a failed flush is retried by the next operation', async () => {
    class FlakyKeyValue extends MemoryKeyValue {
      flushes = 0
      async flush(): Promise<void> {
        this.flushes += 1
        if (this.flushes === 1) throw new Error('disk full')
      }
    }
    const kv = new FlakyKeyValue()
    const { ledger } = makeLedger({ kv })
    await expect(ledger.bootstrap({ clientVersion: '0.1.0', deviceToken: null })).rejects.toThrow(
      'disk full',
    )
    expect(kv.flushes).toBe(1)
    await ledger.account({ deviceToken: 'nobody' })
    expect(kv.flushes).toBe(2)
  })

  it('serialises concurrent operations through one mutex', async () => {
    const { ledger, kv } = makeLedger()
    const boot = await ledger.bootstrap({ clientVersion: '0.1.0', deviceToken: null })
    await Promise.all(
      Array.from({ length: 20 }, () => ledger.host.credit(boot.account.accountId, 1, 'x')),
    )
    const r = await record(kv as MemoryKeyValue, boot.account.accountId)
    expect(r.cursor).toBe(20)
    expect(r.state.gold).toBe(boot.state.gold + 20)
  })
})

describe('Ledger reads without writes', () => {
  it('a read with expiry off leaves an expired listing in place', async () => {
    const { ledger, kv, advance } = makeLedger()
    const counting = kv as CountingKeyValue
    const seller = await ledger.host.mint({
      state: { ...createInitialState(5), gold: 10_000, inventory: [rareItem('iA')] },
      name: 'Ann',
      linked: true,
    })
    const buyer = await ledger.host.mint({
      state: { ...createInitialState(6), gold: 10_000, inventory: [rareItem('iB')] },
      name: 'Bob',
      linked: true,
    })
    const ann = { deviceToken: seller.deviceToken }
    const bob = { deviceToken: buyer.deviceToken }
    expect(await ledger.list(ann, { kind: 'item', id: 'iA', price: 100 })).toMatchObject({
      ok: true,
    })
    expect(
      await ledger.placeOrder(ann, {
        base: 'steel_longsword',
        minRarity: 'rare',
        affixId: null,
        maxPrice: 50,
      }),
    ).toMatchObject({ ok: true })
    advance(EXPIRY_MS)
    const writes = counting.writes
    const flushes = counting.flushes

    const page = await ledger.browse(
      bob,
      { kind: 'item', sort: 'newest', page: 0 },
      { expire: false },
    )
    expect(page).toMatchObject({ total: 1, listings: [{ sellerId: seller.accountId }] })
    expect(await ledger.myOrders(ann, { expire: false })).toMatchObject({
      listings: [{ sellerId: seller.accountId }],
      orders: [{ buyerId: seller.accountId }],
    })
    expect(await ledger.matchingOrders(bob, 'iB', { expire: false })).toHaveLength(1)
    expect(counting.writes).toBe(writes)
    expect(counting.flushes).toBe(flushes)
    const r = await record(counting, seller.accountId)
    expect(r.state.inventory.map((i) => i.id)).toEqual([])

    // The default read is the primary's: it expires what is due.
    expect(await ledger.browse(bob, { kind: 'item', sort: 'newest', page: 0 })).toMatchObject({
      total: 0,
    })
    expect(counting.writes).toBeGreaterThan(writes)
    const back = await record(counting, seller.accountId)
    expect(back.state.inventory.map((i) => i.id)).toEqual(['iA'])
  })

  it('a world poll with advance off spawns no boss and writes nothing', async () => {
    let t = 1_700_006_400_000 // a grid point
    expect(t % BOSS_GRID_MS).toBe(0)
    const { ledger, kv } = makeLedger({ now: async () => t })
    const counting = kv as CountingKeyValue
    const boot = await ledger.bootstrap({ clientVersion: '0.1.0', deviceToken: null })
    const auth = { deviceToken: boot.deviceToken }
    const writes = counting.writes
    const flushes = counting.flushes

    expect(await ledger.world(auth, 0, { advance: false })).toMatchObject({ boss: null })
    expect(counting.writes).toBe(writes)
    expect(counting.flushes).toBe(flushes)

    // The default poll is the primary's: it spawns the grid's boss and engages the caller.
    t += 1
    expect(await ledger.world(auth, 0)).toMatchObject({ boss: { hp: expect.any(Number) } })
    expect(counting.writes).toBeGreaterThan(writes)
  })

  it('a world poll with advance off does not engage the caller in a live boss', async () => {
    const t = 1_700_006_400_000
    const { ledger, kv } = makeLedger({ now: async () => t })
    const counting = kv as CountingKeyValue
    const first = await ledger.bootstrap({ clientVersion: '0.1.0', deviceToken: null })
    await ledger.world({ deviceToken: first.deviceToken }, 0)
    const boot = await ledger.bootstrap({ clientVersion: '0.1.0', deviceToken: null })
    const writes = counting.writes

    await ledger.world({ deviceToken: boot.deviceToken }, 0, { advance: false })
    expect(counting.writes).toBe(writes)
    const r = await record(counting, boot.account.accountId)
    expect(r.state.boss).toBeNull()
  })
})

describe('Ledger link', () => {
  /** An approver shaped like GitHub's: its own code and URL, answers queued per poll. */
  function scripted(answers: Awaited<ReturnType<LinkApprover['poll']>>[]) {
    const polled: string[] = []
    const approver: LinkApprover = {
      start: async () => ({
        code: 'WDJB-MJHT',
        url: 'https://github.com/login/device',
        intervalMs: 7000,
        deviceCode: 'device-1',
      }),
      poll: async (deviceCode) => {
        polled.push(deviceCode)
        return answers.shift() ?? { status: 'pending' }
      },
    }
    return { approver, polled }
  }

  async function unlinked(ledger: Ledger) {
    const boot = await ledger.bootstrap({ clientVersion: '0.1.0', deviceToken: null })
    return { deviceToken: boot.deviceToken }
  }

  it("answers the approver's code, URL and interval, and polls it with the device code it kept", async () => {
    const { approver, polled } = scripted([
      { status: 'pending' },
      { status: 'approved', login: 'octocat' },
    ])
    const { ledger } = makeLedger({ linkApprover: approver })
    const auth = await unlinked(ledger)
    const start = await ledger.linkStart(auth)
    expect(start).toEqual({
      code: 'WDJB-MJHT',
      url: 'https://github.com/login/device',
      intervalMs: 7000,
    })
    expect(await ledger.linkPoll(auth, 'WDJB-MJHT')).toEqual({ status: 'pending' })
    const linked = await ledger.linkPoll(auth, 'WDJB-MJHT')
    if ('reason' in linked || linked.status !== 'linked') throw new Error('expected linked')
    expect(linked.account.linked).toEqual({ provider: 'github', login: 'octocat' })
    expect(linked.account.displayName).toBe('octocat')
    expect(polled).toEqual(['device-1', 'device-1'])
  })

  it('an ended link answers its reason and message once, and leaves the account unlinked', async () => {
    const message = 'You declined the link on GitHub.'
    const { approver, polled } = scripted([{ status: 'ended', reason: 'denied', message }])
    const { ledger } = makeLedger({ linkApprover: approver })
    const auth = await unlinked(ledger)
    await ledger.linkStart(auth)
    expect(await ledger.linkPoll(auth, 'WDJB-MJHT')).toEqual({
      status: 'ended',
      reason: 'denied',
      message,
    })
    expect(await ledger.linkPoll(auth, 'WDJB-MJHT')).toEqual({ status: 'pending' })
    expect(polled).toHaveLength(1)
    const info = await ledger.account(auth)
    if ('reason' in info) throw new Error('expected an account')
    expect(info.account.linked).toBeNull()
  })

  const linkRows = (kv: unknown) =>
    (kv as MemoryKeyValue).keys().filter((k) => k.startsWith('pf:link:'))

  it('an ended link leaves no row and no open code on the record', async () => {
    const message = 'You declined the link on GitHub.'
    const { approver } = scripted([{ status: 'ended', reason: 'denied', message }])
    const { ledger, kv } = makeLedger({ linkApprover: approver })
    const auth = await unlinked(ledger)
    await ledger.linkStart(auth)
    await ledger.linkPoll(auth, 'WDJB-MJHT')
    expect(linkRows(kv)).toEqual([])
    const id = (await ledger.account(auth)) as { account: { accountId: string } }
    expect((await record(kv as MemoryKeyValue, id.account.accountId)).linkCode).toBeUndefined()
  })

  it("a second start replaces the first one's row: one open link per account", async () => {
    const codes = ['AAAA-0001', 'BBBB-0002']
    const polled: string[] = []
    const approver: LinkApprover = {
      start: async () => {
        const code = codes.shift() ?? 'none'
        return { code, url: 'https://github.com/login/device', intervalMs: 7000, deviceCode: code }
      },
      poll: async (deviceCode) => {
        polled.push(deviceCode)
        return { status: 'pending' }
      },
    }
    const { ledger, kv } = makeLedger({ linkApprover: approver })
    const auth = await unlinked(ledger)
    await ledger.linkStart(auth)
    await ledger.linkStart(auth)
    expect(linkRows(kv)).toEqual(['pf:link:BBBB-0002'])
    expect(await ledger.linkPoll(auth, 'AAAA-0001')).toEqual({ status: 'pending' })
    expect(polled).toEqual([])
  })

  it('a delete takes the open link with the account', async () => {
    const { approver } = scripted([])
    const { ledger, kv } = makeLedger({ linkApprover: approver })
    const auth = await unlinked(ledger)
    await ledger.linkStart(auth)
    expect(linkRows(kv)).toHaveLength(1)
    expect(await ledger.deleteAccount(auth)).toEqual({ deleted: true })
    expect(linkRows(kv)).toEqual([])
  })

  it('a start whose account is deleted during the round trip writes no row', async () => {
    let release = () => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const approver: LinkApprover = {
      start: async () => {
        await held
        return {
          code: 'WDJB-MJHT',
          url: 'https://github.com/login/device',
          intervalMs: 7000,
          deviceCode: 'd',
        }
      },
      poll: async () => ({ status: 'pending' }),
    }
    const { ledger, kv } = makeLedger({ linkApprover: approver })
    const auth = await unlinked(ledger)
    const starting = ledger.linkStart(auth)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(await ledger.deleteAccount(auth)).toEqual({ deleted: true })
    release()
    expect(await starting).toEqual({ reason: 'unauthorized' })
    expect(linkRows(kv)).toEqual([])
  })

  it("a refused start answers the approver's refusal and keeps no link", async () => {
    const refusal = { refusal: 'link_unavailable' as const, message: 'Linking is off here.' }
    const { ledger } = makeLedger({
      linkApprover: { start: async () => refusal, poll: async () => ({ status: 'pending' }) },
    })
    const auth = await unlinked(ledger)
    expect(await ledger.linkStart(auth)).toEqual(refusal)
  })

  it('the ledger answers other calls while the approver is still answering a poll', async () => {
    let release: (answer: { status: 'approved'; login: string }) => void = () => undefined
    const answer = new Promise<{ status: 'approved'; login: string }>((r) => {
      release = r
    })
    const { ledger } = makeLedger({
      linkApprover: {
        start: async (code) => ({ code, url: 'u', intervalMs: 5000, deviceCode: code }),
        poll: () => answer,
      },
    })
    const auth = await unlinked(ledger)
    const other = await unlinked(ledger)
    const start = await ledger.linkStart(auth)
    if ('reason' in start || 'refusal' in start) throw new Error('expected a start')
    const poll = ledger.linkPoll(auth, start.code)
    const info = await ledger.account(other)
    expect('account' in info).toBe(true)
    release({ status: 'approved', login: 'octocat' })
    const linked = await poll
    expect('status' in linked && linked.status).toBe('linked')
  })
})

describe('Ledger link sweep', () => {
  const MINUTE = 60_000
  const linkRows = (kv: unknown) =>
    (kv as MemoryKeyValue).keys().filter((k) => k.startsWith('pf:link:'))
  const indexed = async (kv: unknown) =>
    (((await (kv as MemoryKeyValue).get('pf:links')) ?? []) as { code: string }[]).map(
      (e) => `pf:link:${e.code}`,
    )

  async function starter(ledger: Ledger) {
    const boot = await ledger.bootstrap({ clientVersion: '0.1.0', deviceToken: null })
    const auth = { deviceToken: boot.deviceToken }
    const start = await ledger.linkStart(auth)
    if ('reason' in start || 'refusal' in start) throw new Error('expected a start')
    return { auth, code: start.code, accountId: boot.account.accountId }
  }

  it('the sweep removes a link row older than its lifetime and keeps a younger one', async () => {
    const { ledger, kv, advance } = makeLedger({ linkApprover: approveAs(null) })
    const a = await starter(ledger)
    advance(14 * MINUTE)
    await ledger.host.sweep()
    expect(linkRows(kv)).toEqual([`pf:link:${a.code}`])
    expect((await record(kv as MemoryKeyValue, a.accountId)).linkCode).toBe(a.code)

    advance(2 * MINUTE)
    await ledger.host.sweep()
    expect(linkRows(kv)).toEqual([])
    expect(await indexed(kv)).toEqual([])
    expect((await record(kv as MemoryKeyValue, a.accountId)).linkCode).toBeUndefined()
    expect(await ledger.linkPoll(a.auth, a.code)).toEqual({ status: 'pending' })
  })

  it('scales the lifetime by the speed: at 60 it is 900 virtual minutes', async () => {
    const { ledger, kv, advance } = makeLedger({ linkApprover: approveAs(null), speed: 60 })
    const a = await starter(ledger)
    advance(840 * MINUTE)
    await ledger.host.sweep()
    expect(linkRows(kv)).toEqual([`pf:link:${a.code}`])
    advance(120 * MINUTE)
    await ledger.host.sweep()
    expect(linkRows(kv)).toEqual([])
    expect((await record(kv as MemoryKeyValue, a.accountId)).linkCode).toBeUndefined()
  })

  it('link cleanup reads no account while no link has expired', async () => {
    const quiet = makeLedger({ linkApprover: approveAs(null) })
    const open = makeLedger({ linkApprover: approveAs(null) })
    await quiet.ledger.bootstrap({ clientVersion: '0.1.0', deviceToken: null })
    await starter(open.ledger)
    for (const w of [quiet, open]) w.advance(14 * MINUTE)
    const reads = async (w: typeof quiet) => {
      const counting = w.kv as CountingKeyValue
      const before = counting.accountReads
      await w.ledger.host.sweep()
      return counting.accountReads - before
    }
    expect(await reads(open)).toBe(await reads(quiet))
  })

  it('a start, a second start, a final poll and a delete keep the index on the rows', async () => {
    const { ledger, kv, advance } = makeLedger()
    // Starts twice and never polls.
    const a = await starter(ledger)
    const again = await ledger.linkStart(a.auth)
    if ('reason' in again || 'refusal' in again) throw new Error('expected a start')
    expect(await indexed(kv)).toEqual(linkRows(kv))
    // Polls to the final answer.
    const b = await starter(ledger)
    expect(await ledger.linkPoll(b.auth, b.code)).toMatchObject({ status: 'linked' })
    // Deletes the account with its link open.
    const c = await starter(ledger)
    expect(await ledger.deleteAccount(c.auth)).toEqual({ deleted: true })

    expect(linkRows(kv)).toEqual([`pf:link:${again.code}`])
    expect(await indexed(kv)).toEqual(linkRows(kv))

    advance(16 * MINUTE)
    await ledger.host.sweep()
    expect(linkRows(kv)).toEqual([])
    expect(await indexed(kv)).toEqual([])
    expect((await record(kv as MemoryKeyValue, a.accountId)).linkCode).toBeUndefined()
  })
})
