import { type MarketResult, MemoryKeyValue } from '@promptfall/protocol'
import { createInitialState, type GameState, type Hero, type Item } from '@promptfall/sim'
import { describe, expect, it } from 'vitest'
import type { AccountRecord } from './books'
import { COOLDOWN_MS, EXPIRY_MS, listingFee, saleFee, saleNet, transfer } from './goods'
import { Ledger } from './ledger'

const T0 = 1_700_000_000_000

function rare(id: string, base = 'steel_longsword'): Item {
  return { id, base, rarity: 'rare', affixes: [], equippedBy: null, tradeableAt: null }
}

function world(kv = new MemoryKeyValue(), start = T0) {
  let t = start
  let n = 0
  const make = () =>
    new Ledger({
      kv,
      now: async () => t,
      minClientVersion: '0.1.0',
      seedSource: () => 11,
      tokenSource: () => `tok-${n++}-${Math.floor(t)}`,
      linkApprover: async () => ({ login: 'x' }),
    })
  return {
    kv,
    ledger: make(),
    reload: make,
    advance: (ms: number) => {
      t += ms
    },
    now: () => t,
  }
}

async function mint(ledger: Ledger, name: string, patch: Partial<GameState> = {}) {
  const state = { ...createInitialState(name.length + 3), gold: 10_000, ...patch }
  const m = await ledger.host.mint({ state, name, linked: true })
  return { ...m, auth: { deviceToken: m.deviceToken } }
}

async function record(kv: MemoryKeyValue, accountId: string): Promise<AccountRecord> {
  return (await kv.get(`pf:acct:${accountId}:record`)) as AccountRecord
}

function listingId(r: MarketResult): string {
  if (!r.ok) throw new Error(`refused: ${r.reason}`)
  const e = r.delivery.events.at(-1)?.event
  if (e?.t !== 'listed') throw new Error('no listed event')
  return e.listingId
}

describe('fees', () => {
  it.each([
    [1, 1],
    [49, 1],
    [50, 1],
    [51, 1],
    [100, 2],
    [1_000_000, 20_000],
  ])('listing at %i costs %i', (price, fee) => {
    expect(listingFee(price)).toBe(fee)
  })

  it.each([
    [19, 0],
    [20, 1],
    [100, 5],
  ])('a sale at %i pays a fee of %i', (price, fee) => {
    expect(saleFee(price)).toBe(fee)
    expect(saleNet(price)).toBe(price - fee)
  })
})

describe('cooldown', () => {
  it('goods are tradeable at exactly tradeableAt', async () => {
    const w = world()
    const a = await mint(w.ledger, 'Ann', { inventory: [{ ...rare('iA'), tradeableAt: T0 + 10 }] })
    w.advance(9)
    expect(await w.ledger.list(a.auth, { kind: 'item', id: 'iA', price: 100 })).toEqual({
      ok: false,
      reason: 'in_cooldown',
    })
    w.advance(1)
    expect(await w.ledger.list(a.auth, { kind: 'item', id: 'iA', price: 100 })).toMatchObject({
      ok: true,
    })
  })
})

describe('expiry', () => {
  it('a listing at exactly expiresAt cannot be bought, without a sweep', async () => {
    const w = world()
    const a = await mint(w.ledger, 'Ann', { inventory: [rare('iA')] })
    const b = await mint(w.ledger, 'Bob')
    const id = listingId(await w.ledger.list(a.auth, { kind: 'item', id: 'iA', price: 100 }))
    w.advance(EXPIRY_MS)
    expect(await w.ledger.buy(b.auth, id)).toEqual({ ok: false, reason: 'gone' })
    const seller = await record(w.kv, a.accountId)
    expect(seller.state.inventory.map((i) => i.id)).toEqual(['iA'])
    expect(seller.state.gold).toBe(10_000 - 2)
  })

  it('a listing a millisecond before expiry still sells', async () => {
    const w = world()
    const a = await mint(w.ledger, 'Ann', { inventory: [rare('iA')] })
    const b = await mint(w.ledger, 'Bob')
    const id = listingId(await w.ledger.list(a.auth, { kind: 'item', id: 'iA', price: 100 }))
    w.advance(EXPIRY_MS - 1)
    expect(await w.ledger.buy(b.auth, id)).toMatchObject({ ok: true })
  })
})

describe('expiry and authentication', () => {
  it('an unauthenticated call expires nothing', async () => {
    const w = world()
    const a = await mint(w.ledger, 'Ann', { inventory: [rare('iA')] })
    listingId(await w.ledger.list(a.auth, { kind: 'item', id: 'iA', price: 100 }))
    w.advance(EXPIRY_MS)
    expect(await w.ledger.buy({ deviceToken: 'forged' }, 'L0')).toEqual({
      ok: false,
      reason: 'unauthorized',
    })
    expect(((await w.kv.get('pf:listings')) as string[]).length).toBe(1)
  })

  it("the seller's own call expires their listing and sees the goods back", async () => {
    const w = world()
    const a = await mint(w.ledger, 'Ann', { inventory: [rare('iA')] })
    listingId(await w.ledger.list(a.auth, { kind: 'item', id: 'iA', price: 100 }))
    w.advance(EXPIRY_MS)
    const mine = await w.ledger.myOrders(a.auth)
    expect(mine).toMatchObject({ listings: [], returns: 0 })
    const r = await record(w.kv, a.accountId)
    expect(r.state.inventory.map((i) => i.id)).toEqual(['iA'])
  })
})

describe('returns', () => {
  it('waiting returns survive a ledger reload and arrive per kind when a slot frees', async () => {
    const w = world()
    const spare: Hero = {
      ...(createInitialState(9).roster[3] as Hero),
      id: 'hspare',
      rarity: 'epic',
      level: 7,
      xp: 12,
      hp: 20,
    }
    const start = createInitialState(9)
    const a = await mint(w.ledger, 'Ann', {
      inventory: [rare('iA'), rare('iB')],
      roster: [...start.roster, spare],
    })
    const item = listingId(await w.ledger.list(a.auth, { kind: 'item', id: 'iA', price: 100 }))
    const hero = listingId(await w.ledger.list(a.auth, { kind: 'hero', id: 'hspare', price: 500 }))
    // Fill both kinds behind the ledger's back, as drops and recruits would.
    const r = await record(w.kv, a.accountId)
    r.state = { ...r.state, inventoryCap: 1, rosterCap: r.state.roster.length }
    await w.kv.set(`pf:acct:${a.accountId}:record`, r)
    expect(await w.ledger.cancelListing(a.auth, item)).toMatchObject({ ok: true })
    expect(await w.ledger.cancelListing(a.auth, hero)).toMatchObject({ ok: true })
    expect((await record(w.kv, a.accountId)).returns).toHaveLength(2)

    const again = w.reload()
    const r2 = await record(w.kv, a.accountId)
    r2.state = { ...r2.state, rosterCap: r2.state.roster.length + 1 }
    await w.kv.set(`pf:acct:${a.accountId}:record`, r2)
    await again.host.sweep()
    const r3 = await record(w.kv, a.accountId)
    expect(r3.returns.map((x) => x.listingId)).toEqual([item])
    // The hero comes back exactly as listed: transfers reset a hero, returns never do.
    expect(r3.state.roster.find((h) => h.id === 'hspare')).toEqual(spare)
    const info = await again.account(a.auth)
    expect(info).toMatchObject({ returns: 1 })
  })
})

describe('transfer', () => {
  it('re-ids, cools down and resets a hero; keeps a t id', async () => {
    const receiver = createInitialState(4)
    const hero: Hero = { ...(receiver.roster[0] as Hero), id: 'h9', level: 7, xp: 30, hp: 3 }
    let n = 0
    const nextId = async () => `t${n++}`
    const moved = await transfer({ kind: 'hero', hero }, 1000, nextId, receiver)
    if (moved.kind !== 'hero') throw new Error('hero')
    expect(moved.hero).toMatchObject({ id: 't0', level: 1, xp: 0, tradeableAt: 1000 + COOLDOWN_MS })
    expect(moved.hero.hp).toBe((receiver.roster[0] as Hero).hp)
    const again = await transfer(moved, 2000, nextId, receiver)
    if (again.kind !== 'hero') throw new Error('hero')
    expect(again.hero.id).toBe('t0')
    const item = await transfer({ kind: 'item', item: rare('i5') }, 5, nextId, receiver)
    expect(item).toEqual({ kind: 'item', item: { ...rare('t1'), tradeableAt: 5 + COOLDOWN_MS } })
  })
})

describe('a market closed after trading opened', () => {
  it('refuses list, buy, placeOrder and fillOrder; cancels still work', async () => {
    const kv = new MemoryKeyValue()
    const w = world(kv)
    const a = await mint(w.ledger, 'Ann', { inventory: [rare('iA'), rare('iB')] })
    const b = await mint(w.ledger, 'Bob', { inventory: [rare('iS')] })
    const listing = listingId(await w.ledger.list(a.auth, { kind: 'item', id: 'iA', price: 100 }))
    const placed = await w.ledger.placeOrder(a.auth, {
      base: 'steel_longsword',
      minRarity: 'rare',
      affixId: null,
      maxPrice: 300,
    })
    if (!placed.ok) throw new Error('refused')
    const orderEvent = placed.delivery.events.at(-1)?.event
    if (orderEvent?.t !== 'order_placed') throw new Error('no order')
    const closed = new Ledger({
      kv,
      now: async () => w.now(),
      minClientVersion: '0.1.0',
      seedSource: () => 1,
      tokenSource: () => 'x',
      flags: { 'market.enabled': false },
      linkApprover: async () => null,
    })
    const no = { ok: false, reason: 'market_closed' }
    expect(await closed.list(a.auth, { kind: 'item', id: 'iB', price: 100 })).toEqual(no)
    expect(await closed.buy(b.auth, listing)).toEqual(no)
    expect(
      await closed.placeOrder(b.auth, {
        base: 'steel_longsword',
        minRarity: 'rare',
        affixId: null,
        maxPrice: 1,
      }),
    ).toEqual(no)
    expect(await closed.fillOrder(b.auth, orderEvent.orderId, 'iS')).toEqual(no)
    expect(await closed.cancelListing(a.auth, listing)).toMatchObject({ ok: true })
    expect(await closed.cancelOrder(a.auth, orderEvent.orderId)).toMatchObject({ ok: true })
    const r = await record(kv, a.accountId)
    expect(r.state.gold).toBe(10_000 - 2)
    expect(r.state.inventory.map((i) => i.id).sort()).toEqual(['iA', 'iB'])
  })
})
