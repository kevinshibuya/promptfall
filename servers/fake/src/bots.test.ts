import type { AccountRecord, Ledger } from '@promptfall/ledger'
import {
  BOSS_BASE_HP,
  type BoardRow,
  HttpClient,
  type Listing,
  MemoryKeyValue,
  weekStartOf,
} from '@promptfall/protocol'
import { RARITIES, type Rarity, SIM_VERSION } from '@promptfall/sim'
import { describe, expect, it } from 'vitest'
import { BOT_NAMES, BOT_TICK_MS, botName } from './bot-config'
import { rollBotState } from './bot-seed'
import { startBots } from './bots'
import { nodeFetch } from './node-fetch'
import { createFakeServer } from './server'
import { booted } from './test-support'

const rarePlus = (r: Rarity) => RARITIES.indexOf(r) >= RARITIES.indexOf('rare')
const COUNT = 12
const START = 1_700_000_000_000
const BOARDS = 'pf:boards'

/** The boards as the ledger stores them: rows a read may hide are still here. */
type StoredBoards = {
  zone: BoardRow[]
  week: { start: number; damage: Record<string, { name: string; value: number }> }
}

type Saved = { accountId: string; deviceToken: string }

/**
 * Points bot 0 at an unmarked account its start will replace, stale by name or by sim version,
 * and gives it and a player a row each on both boards. Answers both ids and the old token.
 */
async function seedReplaced(
  ledger: Ledger,
  kv: MemoryKeyValue,
  stale: 'name' | 'version',
): Promise<{ old: Saved; player: string }> {
  const state = rollBotState(1, 0)
  const old = await ledger.host.mint(
    stale === 'name'
      ? { state, name: 'Ashgrove', linked: true }
      : {
          state: { ...state, v: (SIM_VERSION - 1) as typeof SIM_VERSION },
          name: botName(0),
          linked: true,
        },
  )
  await kv.set('pf:bot:0', old)
  const player = (await ledger.bootstrap({ clientVersion: '0.1.0', deviceToken: null })).account
    .accountId
  const boards: StoredBoards = {
    zone: [
      { accountId: old.accountId, name: 'Ashgrove', value: 9 },
      { accountId: player, name: 'player', value: 3 },
    ],
    week: {
      start: weekStartOf(START),
      damage: {
        [old.accountId]: { name: 'Ashgrove', value: 900 },
        [player]: { name: 'player', value: 300 },
      },
    },
  }
  await kv.set(BOARDS, boards)
  return { old, player }
}

/** A fake listening on port 0 with a manual clock, and bots that act only when the test ticks them. */
async function run(
  seed: number,
  ticks: number,
  start = START,
  /** Runs before the bots start, over the same store, ledger and client. */
  prepare?: (ledger: Ledger, kv: MemoryKeyValue, client: HttpClient) => Promise<void>,
) {
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
  await prepare?.(server.ledger, kv, client)
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
    const viewer = await booted(client, { clientVersion: '0.1.0', deviceToken: null })
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
      const saved = (await kv.get(`pf:bot:${i}`)) as
        | { accountId: string; deviceToken: string }
        | undefined
      // A failed start leaves the bots after it unminted.
      if (!saved) continue
      const mine = await client.myOrders({ deviceToken: saved.deviceToken })
      if (!('reason' in mine)) orders += mine.orders.length
      records.push((await kv.get(`pf:acct:${saved.accountId}:record`)) as AccountRecord)
    }
    const stored = (await kv.get(BOARDS)) as StoredBoards
    return { all, world, boards, stored, orders, records, lines, calls, kv }
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
    // Presence per zone matches where each bot's committed state stands, plus the viewer in zone 1.
    const counts = new Map<number, number>([[1, 1]])
    for (const r of records) if (r) counts.set(r.state.zone, (counts.get(r.state.zone) ?? 0) + 1)
    const expected = [...counts].map(([zone, count]) => ({ zone, count }))
    expect([...world.zones].sort((a, b) => a.zone - b.zone)).toEqual(
      expected.sort((a, b) => a.zone - b.zone),
    )
    expect(calls).toEqual([])
  }, 120_000)

  it('after 120 ticks they chat, list both kinds, order, sell and fill', async () => {
    const { all, world, orders, records, lines, calls } = await run(1, 120)
    const speakers = new Set(world.chat.map((m) => m.name))
    expect(speakers.size).toBeGreaterThanOrEqual(2)
    for (const name of speakers) expect(BOT_NAMES.map((_, i) => botName(i))).toContain(name)
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
    // Only bots played and fought: neither board holds a row.
    expect(boards.damage).toEqual([])
    expect(boards.highestZone).toEqual([])
  }, 120_000)

  it('bots are minted with the mark and named as bots', async () => {
    const { records, world } = await run(1, COUNT)
    expect(records.map((r) => r.account.displayName)).toEqual(
      Array.from({ length: COUNT }, (_, i) => `[bot] ${BOT_NAMES[i % BOT_NAMES.length]}`),
    )
    for (const record of records) {
      expect(record.bot).toBe(true)
      // The mark is the record's alone: the account is what the wire carries.
      expect(record.account).not.toHaveProperty('bot')
    }
    // Still in presence like anyone else.
    expect(world.online).toBe(COUNT + 1)
  }, 120_000)

  it('a bot saved before the mark is minted again, marked and named as a bot', async () => {
    let unmarked = ''
    const { records } = await run(1, COUNT, undefined, async (ledger, kv) => {
      const saved = await ledger.host.mint({
        state: rollBotState(1, 0),
        name: 'Ashgrove',
        linked: true,
      })
      unmarked = saved.accountId
      await kv.set('pf:bot:0', saved)
    })
    expect(records[0]?.account.accountId).not.toBe(unmarked)
    expect(records[0]).toMatchObject({ bot: true, account: { displayName: '[bot] Ashgrove' } })
  }, 120_000)

  for (const stale of ['name', 'version'] as const) {
    it(`a replaced bot's account is deleted, and neither board keeps it (${stale})`, async () => {
      const seeded: Partial<Awaited<ReturnType<typeof seedReplaced>>> = {}
      const { boards, stored, records, kv } = await run(1, COUNT, undefined, async (ledger, kv) => {
        Object.assign(seeded, await seedReplaced(ledger, kv, stale))
        // Both boards hold it before the start, so its absence after is the delete's.
        const before = (await kv.get(BOARDS)) as StoredBoards
        expect(before.zone.map((r) => r.accountId)).toContain(seeded.old?.accountId)
        expect(Object.keys(before.week.damage)).toContain(seeded.old?.accountId)
      })
      const { old, player } = seeded
      if (!old || !player) throw new Error('not seeded')
      const fresh = records[0]
      expect(fresh?.account.accountId).not.toBe(old.accountId)
      expect(fresh).toMatchObject({ bot: true, account: { displayName: botName(0) } })
      // The old account's record and token are gone.
      expect(await kv.get(`pf:acct:${old.accountId}:record`)).toBeUndefined()
      expect(await kv.get(`pf:token:${old.deviceToken}`)).toBeUndefined()
      // Neither board keeps it, stored or served; the player's rows stand; the replacement holds none.
      const ids = (rows: { accountId: string }[]) => rows.map((r) => r.accountId)
      expect(ids(stored.zone)).toEqual([player])
      expect(Object.keys(stored.week.damage)).toEqual([player])
      expect(ids(boards.highestZone)).toEqual([player])
      expect(ids(boards.damage)).toEqual([player])
    }, 120_000)
  }

  it('a delete answered unauthorized is logged once and the bot is minted anyway', async () => {
    const seeded: { old?: Saved } = {}
    const { records, lines } = await run(1, COUNT, undefined, async (ledger, kv, client) => {
      seeded.old = (await seedReplaced(ledger, kv, 'name')).old
      client.deleteAccount = async () => ({ reason: 'unauthorized' })
    })
    expect(records[0]?.account.accountId).not.toBe(seeded.old?.accountId)
    expect(records[0]).toMatchObject({ bot: true, account: { displayName: botName(0) } })
    expect(lines.filter((l) => / delete /.test(l))).toEqual([
      `bot ${botName(0)} delete unauthorized`,
    ])
  }, 120_000)

  const failures = {
    throws: {
      answer: async (): Promise<never> => {
        throw new Error('connection reset')
      },
      line: 'bots failed to start: Error: connection reset',
    },
    'is refused': {
      answer: async () => ({ reason: 'banned' as const, message: 'banned' }),
      line: `bots failed to start: Error: bot ${botName(0)}: delete refused, banned`,
    },
  }
  for (const [how, { answer, line }] of Object.entries(failures)) {
    it(`a delete that ${how} stops the start and leaves the pointer as it was`, async () => {
      const seeded: { old?: Saved } = {}
      const { records, lines, kv } = await run(1, COUNT, undefined, async (ledger, kv, client) => {
        seeded.old = (await seedReplaced(ledger, kv, 'name')).old
        client.deleteAccount = answer
      })
      expect(await kv.get('pf:bot:0')).toEqual(seeded.old)
      expect(records.map((r) => r.account.accountId)).toEqual([seeded.old?.accountId])
      expect(lines).toContain(line)
    }, 120_000)
  }

  it('a saved token the store no longer knows is minted again without a delete', async () => {
    const deletes: string[] = []
    const { records } = await run(1, COUNT, undefined, async (_ledger, kv, client) => {
      await kv.set('pf:bot:0', { accountId: 'gone', deviceToken: 'tok-gone' })
      client.deleteAccount = async (auth) => {
        deletes.push(auth.deviceToken)
        return { reason: 'unauthorized' }
      }
    })
    expect(deletes).toEqual([])
    expect(records[0]).toMatchObject({ bot: true, account: { displayName: botName(0) } })
  }, 120_000)

  it('two runs with the same seed list the same ids at the same prices', async () => {
    const a = await run(5, 30)
    const b = await run(5, 30)
    const key = (ls: Listing[]) => ls.map((l) => `${l.id}:${l.price}`).sort()
    expect(key(a.all).length).toBeGreaterThan(0)
    expect(key(a.all)).toEqual(key(b.all))
  }, 120_000)
})

describe('a failed bot start', () => {
  it('leaves the ticks resolving and reports once', async () => {
    const errors: string[] = []
    const bots = startBots({
      client: {} as never,
      host: {
        mint: async () => {
          throw new Error('store is gone')
        },
        credit: async () => undefined,
      },
      kv: new MemoryKeyValue(),
      seed: 1,
      count: 2,
      speed: 1,
      schedule: () => ({ cancel: () => undefined }),
      onError: (line) => errors.push(line),
    })
    await bots.tick()
    await bots.tick()
    bots.stop()
    expect(errors).toEqual(['promptfall fake: bots failed to start: Error: store is gone'])
  })
})
