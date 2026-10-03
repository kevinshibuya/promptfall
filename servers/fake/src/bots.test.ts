import { type AccountRecord, Ledger } from '@promptfall/ledger'
import { type Listing, MemoryKeyValue } from '@promptfall/protocol'
import { RARITIES, type Rarity } from '@promptfall/sim'
import { describe, expect, it } from 'vitest'
import { rollBotState } from './bot-seed'
import { startBots } from './bots'

const rarePlus = (r: Rarity) => RARITIES.indexOf(r) >= RARITIES.indexOf('rare')

/** A seeded ledger, a manual clock, and bots that act only when the test ticks them. */
async function run(seed: number, ticks: number) {
  const kv = new MemoryKeyValue()
  let t = 1_700_000_000_000
  let n = 0
  const ledger = new Ledger({
    kv,
    now: async () => t,
    minClientVersion: '0.1.0',
    seedSource: () => 1,
    tokenSource: () => `tok-${n++}`,
    linkApprover: async () => null,
  })
  const bots = startBots({
    ledger,
    kv,
    seed,
    count: 12,
    speed: 1,
    schedule: () => ({ cancel: () => undefined }),
  })
  for (let i = 0; i < ticks; i++) {
    await bots.tick()
    t += 60_000
  }
  bots.stop()
  const viewer = await ledger.bootstrap({ clientVersion: '0.1.0', deviceToken: null })
  const auth = { deviceToken: viewer.deviceToken }
  const all: Listing[] = []
  for (const kind of ['item', 'hero'] as const) {
    for (let page = 0; ; page++) {
      const r = await ledger.browse(auth, { kind, sort: 'newest', page })
      if ('reason' in r) throw new Error('unauthorized')
      all.push(...r.listings)
      if ((page + 1) * 10 >= r.total) break
    }
  }
  const records = kv.keys().filter((k) => k.endsWith(':record'))
  const states = await Promise.all(records.map(async (k) => (await kv.get(k)) as AccountRecord))
  return { ledger, kv, all, states }
}

describe('bot population', () => {
  it('twelve seeded bots hold Rare+ goods to trade', () => {
    let items = 0
    let heroes = 0
    for (let i = 0; i < 12; i++) {
      const s = rollBotState(1, i)
      items += s.inventory.filter((it) => rarePlus(it.rarity) && it.equippedBy === null).length
      heroes += s.roster.filter(
        (h) =>
          rarePlus(h.rarity) &&
          !s.party.includes(h.id) &&
          !s.pendingParty?.includes(h.id) &&
          Object.values(h.equipment).every((e) => e === null),
      ).length
    }
    expect(items).toBeGreaterThanOrEqual(3)
    expect(heroes).toBeGreaterThanOrEqual(2)
  }, 60_000)
})

describe('bots', () => {
  it('after 60 ticks there are listings of both kinds, an order, and a sale between bots', async () => {
    const { all, states } = await run(1, 60)
    expect(all.some((l) => l.goods.kind === 'item')).toBe(true)
    expect(all.some((l) => l.goods.kind === 'hero')).toBe(true)
    const names = new Set(all.map((l) => l.sellerName))
    expect(names.size).toBeGreaterThan(1)
    const sold = states.some((r) =>
      r.state.lootLog.some((e) => e.k === 'trade' && e.what === 'sold'),
    )
    expect(sold).toBe(true)
  }, 120_000)

  it('places buy orders', async () => {
    const { ledger, kv } = await run(1, 60)
    let orders = 0
    for (let i = 0; i < 12; i++) {
      const saved = (await kv.get(`pf:bot:${i}`)) as { deviceToken: string }
      const mine = await ledger.myOrders({ deviceToken: saved.deviceToken })
      if (!('reason' in mine)) orders += mine.orders.length
    }
    expect(orders).toBeGreaterThan(0)
  }, 120_000)

  it('two runs with the same seed list the same ids at the same prices', async () => {
    const a = await run(5, 30)
    const b = await run(5, 30)
    const key = (ls: Listing[]) => ls.map((l) => `${l.id}:${l.price}`).sort()
    expect(key(a.all).length).toBeGreaterThan(0)
    expect(key(a.all)).toEqual(key(b.all))
  }, 120_000)
})
