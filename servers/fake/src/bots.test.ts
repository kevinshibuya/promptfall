import type { AccountRecord } from '@promptfall/ledger'
import { BOSS_BASE_HP, HttpClient, type Listing, MemoryKeyValue } from '@promptfall/protocol'
import { RARITIES, type Rarity } from '@promptfall/sim'
import { describe, expect, it } from 'vitest'
import { BOT_NAMES, BOT_TICK_MS } from './bot-config'
import { rollBotState } from './bot-seed'
import { startBots } from './bots'
import { nodeFetch } from './node-fetch'
import { createFakeServer } from './server'

const rarePlus = (r: Rarity) => RARITIES.indexOf(r) >= RARITIES.indexOf('rare')
const COUNT = 12

/** A fake listening on port 0 with a manual clock, and bots that act only when the test ticks them. */
async function run(seed: number, ticks: number, start = 1_700_000_000_000) {
  const kv = new MemoryKeyValue()
  let t = start
  let n = 0
  const server = createFakeServer({
    kv,
    now: async () => t,
    speed: 1,
    flags: {},
    seedSource: () => 1,
    tokenSource: () => `tok-${n++}`,
    playerName: 'player',
    seed,
  })
  const listening = await server.listen(0)
  const client = new HttpClient({ baseUrl: `http://127.0.0.1:${listening.port}`, fetch: nodeFetch })
  const calls: string[] = []
  const host = {
    mint: server.ledger.host.mint,
    credit: server.ledger.host.credit,
    settle: async (accountId: string) => {
      calls.push(`settle ${accountId}`)
    },
  }
  const lines: string[] = []
  const bots = startBots({
    client,
    host,
    kv,
    seed,
    count: COUNT,
    speed: 1,
    schedule: () => ({ cancel: () => undefined }),
    log: (line) => lines.push(line),
  })
  try {
    for (let i = 0; i < ticks; i++) {
      await bots.tick()
      t += Math.floor(BOT_TICK_MS / COUNT)
    }
    bots.stop()
    const viewer = await client.bootstrap({ clientVersion: '0.1.0', deviceToken: null })
    const auth = { deviceToken: viewer.deviceToken }
    const world = await client.world(auth, 0)
    if ('reason' in world) throw new Error('unauthorized')
    const boards = await client.leaderboards(auth)
    if ('reason' in boards) throw new Error('unauthorized')
    const all: Listing[] = []
    for (const kind of ['item', 'hero'] as const) {
      for (let page = 0; ; page++) {
        const r = await client.browse(auth, { kind, sort: 'newest', page })
        if ('reason' in r) throw new Error('unauthorized')
        all.push(...r.listings)
        if ((page + 1) * 10 >= r.total) break
      }
    }
    let orders = 0
    const records: AccountRecord[] = []
    for (let i = 0; i < COUNT; i++) {
      const saved = (await kv.get(`pf:bot:${i}`)) as { accountId: string; deviceToken: string }
      const mine = await client.myOrders({ deviceToken: saved.deviceToken })
      if (!('reason' in mine)) orders += mine.orders.length
      records.push((await kv.get(`pf:acct:${saved.accountId}:record`)) as AccountRecord)
    }
    return { all, world, boards, orders, records, lines, calls }
  } finally {
    await listening.close()
  }
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

describe('bots over HTTP', () => {
  it('after three rounds every bot has committed batches and shows as online', async () => {
    const { records, world, calls } = await run(1, 3 * COUNT)
    for (let i = 0; i < COUNT; i++) {
      const record = records[i]
      expect(record?.seq).toBeGreaterThanOrEqual(3)
      expect(record?.state.tick).toBeGreaterThan(rollBotState(1, i).tick)
    }
    expect(world.online).toBe(COUNT + 1)
    expect(world.zones.length).toBeGreaterThanOrEqual(2)
    expect(calls).toEqual([])
  }, 120_000)

  it('after 120 ticks they chat, list both kinds, order, sell and fill', async () => {
    const { all, world, orders, records, lines, calls } = await run(1, 120)
    const speakers = new Set(world.chat.map((m) => m.name))
    expect(speakers.size).toBeGreaterThanOrEqual(2)
    for (const name of speakers) expect(BOT_NAMES).toContain(name)
    // Hero listings sell fast (bots buy at the asking price), so the kinds listed are read
    // from the open listings and from what was sold or returned.
    const trades = records.flatMap((r) => r.state.lootLog.filter((e) => e.k === 'trade'))
    const listed = new Set([
      ...all.map((l) => l.goods.kind),
      ...trades.filter((e) => e.what !== 'bought').map((e) => e.kind),
    ])
    expect([...listed].sort()).toEqual(['hero', 'item'])
    expect(all.length).toBeGreaterThan(0)
    expect(orders).toBeGreaterThan(0)
    expect(trades.some((e) => e.what === 'sold')).toBe(true)
    expect(lines.some((l) => / fill ok$/.test(l))).toBe(true)
    expect(calls).toEqual([])
  }, 120_000)

  it('bots engaged at a grid point fight the boss through their batches', async () => {
    const grid = 1_700_006_400_000
    // One round to stamp everyone present, then two more across the grid point.
    const { world, boards } = await run(1, 3 * COUNT, grid - BOT_TICK_MS - 1)
    const boss = world.boss
    if (!boss) throw new Error('no boss')
    expect(boss.spawnedAt).toBe(grid)
    expect(boss.maxHp).toBe(COUNT * BOSS_BASE_HP)
    expect(boss.hp).toBeLessThan(boss.maxHp)
    const bots = boards.damage.filter((r) => (BOT_NAMES as readonly string[]).includes(r.name))
    expect(bots.length).toBeGreaterThan(0)
  }, 120_000)

  it('two runs with the same seed list the same ids at the same prices', async () => {
    const a = await run(5, 30)
    const b = await run(5, 30)
    const key = (ls: Listing[]) => ls.map((l) => `${l.id}:${l.price}`).sort()
    expect(key(a.all).length).toBeGreaterThan(0)
    expect(key(a.all)).toEqual(key(b.all))
  }, 120_000)
})
