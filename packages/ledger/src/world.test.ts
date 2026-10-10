import {
  BOARD_ROWS,
  BOSS_BASE_HP,
  BOSS_GRID_MS,
  BOSS_WINDOW_MS,
  CHAT_BUCKET_CAPACITY,
  CHAT_REFILL_MS,
  MemoryKeyValue,
  type WorldSnapshot,
} from '@promptfall/protocol'
import { createInitialState, type Item } from '@promptfall/sim'
import { describe, expect, it } from 'vitest'
import { isBlocked } from './blocklist'
import { type AccountRecord, newRecord, publicName } from './books'
import { BOSS_KEY, type BossRecord } from './boss'
import { approveAs, Ledger, type LedgerFlag } from './ledger'
import { BOARDS_KEY, CHAT_KEY, offerZone, refillChat, type StoredBoards } from './world'

function recordNamed(displayName: string | null): AccountRecord {
  return newRecord(
    { accountId: 'a1', seed: 1, createdAt: 0, displayName, linked: null },
    createInitialState(1),
    0,
  )
}

describe('isBlocked', () => {
  it('refuses a listed word whole, in any case, and passes a longer word holding it', () => {
    expect(isBlocked('Heck!')).toBe(true)
    expect(isBlocked('what the HECK')).toBe(true)
    expect(isBlocked('heckle')).toBe(false)
    expect(isBlocked('hello there')).toBe(false)
  })
})

describe('publicName', () => {
  it('strips control characters', () => {
    expect(publicName(recordNamed('Ash\u001bgrove'))).toBe('Ashgrove')
  })

  it('reads adventurer without a name, with a name empty after stripping, or a blocked one', () => {
    expect(publicName(recordNamed(null))).toBe('adventurer')
    expect(publicName(recordNamed('\u0000\u0007\u009b'))).toBe('adventurer')
    expect(publicName(recordNamed('heck'))).toBe('adventurer')
  })
})

describe('refillChat', () => {
  it('refills whole periods only and carries the remainder', () => {
    const start = { tokens: 0, refillAt: 1000 }
    expect(refillChat(start, 1000 + CHAT_REFILL_MS - 1)).toEqual(start)
    expect(refillChat(start, 1000 + CHAT_REFILL_MS + 5)).toEqual({
      tokens: 1,
      refillAt: 1000 + CHAT_REFILL_MS,
    })
    const full = refillChat(start, 1000 + 100 * CHAT_REFILL_MS)
    expect(full.tokens).toBe(CHAT_BUCKET_CAPACITY)
    expect(full.refillAt).toBe(1000 + 100 * CHAT_REFILL_MS)
  })

  it('stores no credit while full: an idle account gets the capacity in a burst, no more', () => {
    const idle = refillChat({ tokens: CHAT_BUCKET_CAPACITY - 1, refillAt: 0 }, 95_000)
    expect(idle).toEqual({ tokens: CHAT_BUCKET_CAPACITY, refillAt: 95_000 })
    const spent = { tokens: 0, refillAt: idle.refillAt }
    expect(refillChat(spent, 95_000 + CHAT_REFILL_MS - 1).tokens).toBe(0)
    expect(refillChat(spent, 95_000 + CHAT_REFILL_MS).tokens).toBe(1)
  })

  it('treats a missing bucket as full', () => {
    expect(refillChat(undefined, 5)).toEqual({ tokens: CHAT_BUCKET_CAPACITY, refillAt: 5 })
  })
})

describe('offerZone', () => {
  const boards = async (kv: MemoryKeyValue) => ((await kv.get(BOARDS_KEY)) as StoredBoards).zone

  it('keeps the top rows only', async () => {
    const kv = new MemoryKeyValue()
    for (let i = 0; i < BOARD_ROWS + 5; i++) {
      await offerZone(kv, 0, { accountId: `a${i}`, name: `n${i}`, value: i + 1 })
    }
    const rows = await boards(kv)
    expect(rows).toHaveLength(BOARD_ROWS)
    expect(rows[0]?.value).toBe(BOARD_ROWS + 5)
    expect(rows.at(-1)?.value).toBe(6)
    await offerZone(kv, 0, { accountId: 'low', name: 'low', value: 3 })
    expect((await boards(kv)).some((r) => r.accountId === 'low')).toBe(false)
  })

  it('replaces a lower row of the same account and keeps the higher value', async () => {
    const kv = new MemoryKeyValue()
    await offerZone(kv, 0, { accountId: 'a', name: 'Ash', value: 2 })
    await offerZone(kv, 0, { accountId: 'b', name: 'Bri', value: 3 })
    await offerZone(kv, 0, { accountId: 'a', name: 'Ash', value: 4 })
    expect(await boards(kv)).toEqual([
      { accountId: 'a', name: 'Ash', value: 4 },
      { accountId: 'b', name: 'Bri', value: 3 },
    ])
    await offerZone(kv, 0, { accountId: 'a', name: 'Ash', value: 1 })
    expect((await boards(kv))[0]).toEqual({ accountId: 'a', name: 'Ash', value: 4 })
  })

  it('refreshes the name of a row at the same value', async () => {
    const kv = new MemoryKeyValue()
    await offerZone(kv, 0, { accountId: 'a', name: 'adventurer', value: 1 })
    await offerZone(kv, 0, { accountId: 'a', name: 'player', value: 1 })
    expect(await boards(kv)).toEqual([{ accountId: 'a', name: 'player', value: 1 }])
  })
})

describe('names on the market', () => {
  it('a blocked display name reads adventurer in a listing', async () => {
    let n = 0
    const ledger = new Ledger({
      kv: new MemoryKeyValue(),
      now: async () => 1_700_000_000_000,
      minClientVersion: '0.1.0',
      seedSource: () => 7,
      tokenSource: () => `token-${n++}`,
      linkApprover: approveAs('player'),
    })
    const item: Item = {
      id: 'i1',
      base: 'steel_longsword',
      rarity: 'rare',
      affixes: [],
      equippedBy: null,
      tradeableAt: null,
    }
    const state = { ...createInitialState(7), gold: 1000, inventory: [item] }
    const { deviceToken } = await ledger.host.mint({ state, name: 'heck', linked: true })
    const auth = { deviceToken }
    expect(await ledger.list(auth, { kind: 'item', id: 'i1', price: 100 })).toMatchObject({
      ok: true,
    })
    const page = await ledger.browse(auth, { kind: 'item', sort: 'newest', page: 0 })
    if ('reason' in page) throw new Error('unauthorized')
    expect(page.listings[0]?.sellerName).toBe('adventurer')
  })
})

describe('presence on a fast clock', () => {
  it('scales the default TTL by the speed: heartbeats arrive at real cadence', async () => {
    let t = 1_700_000_000_000
    let n = 0
    const ledger = new Ledger({
      kv: new MemoryKeyValue(),
      now: async () => t,
      speed: 10,
      minClientVersion: '0.1.0',
      seedSource: () => 7,
      tokenSource: () => `token-${n++}`,
      linkApprover: approveAs('player'),
    })
    const state = createInitialState(7)
    const a = await ledger.host.mint({ state, name: 'Ann', linked: true })
    const b = await ledger.host.mint({ state, name: 'Bo', linked: true })
    await ledger.world({ deviceToken: a.deviceToken }, 0)
    // One slow poll at speed 10 is 150 virtual seconds: still online.
    t += 150_000
    const w = await ledger.world({ deviceToken: b.deviceToken }, 0)
    if ('reason' in w) throw new Error('unauthorized')
    expect(w.online).toBe(2)
    // And no further: 45 real seconds at speed 10 is 450 virtual seconds since A's heartbeat.
    t += 300_000
    const later = await ledger.world({ deviceToken: b.deviceToken }, 0)
    if ('reason' in later) throw new Error('unauthorized')
    expect(later.online).toBe(1)
  })
})

describe('the highest-zone board over an old --data', () => {
  it('drops the rows of accounts behind the sim version, on read and on the next offer', async () => {
    const kv = new MemoryKeyValue()
    let n = 0
    const ledger = new Ledger({
      kv,
      now: async () => 1_700_000_000_000,
      minClientVersion: '0.1.0',
      seedSource: () => 7,
      tokenSource: () => `token-${n++}`,
      linkApprover: approveAs('player'),
    })
    // A phase 2 bot left behind by a re-mint: an old record holding a high row.
    const old = recordNamed('Ashgrove')
    await kv.set('pf:acct:a1:record', { ...old, state: { ...old.state, v: 2 } })
    await kv.set(BOARDS_KEY, {
      zone: [{ accountId: 'a1', name: 'Ashgrove', value: 9 }],
      week: { start: 0, damage: {} },
    })
    const m = await ledger.host.mint({
      state: createInitialState(7),
      name: 'Ashgrove',
      linked: true,
    })
    const b = await ledger.leaderboards({ deviceToken: m.deviceToken })
    if ('reason' in b) throw new Error('unauthorized')
    expect(b.highestZone).toEqual([{ accountId: m.accountId, name: 'Ashgrove', value: 1 }])
    expect(((await kv.get(BOARDS_KEY)) as StoredBoards).zone.map((r) => r.accountId)).toEqual([
      m.accountId,
    ])
  })
})

/** A store that counts its reads per key: a read of the boss or the chat is a build of that part. */
class CountingKeyValue extends MemoryKeyValue {
  readonly reads = new Map<string, number>()

  override async get(key: string): Promise<unknown> {
    this.reads.set(key, (this.reads.get(key) ?? 0) + 1)
    return super.get(key)
  }

  sharedReads(): number {
    return (this.reads.get(BOSS_KEY) ?? 0) + (this.reads.get(CHAT_KEY) ?? 0)
  }
}

describe('the world memo', () => {
  const GRID = 1_700_006_400_000 // a grid point: GRID % BOSS_GRID_MS === 0

  async function setup(start: number, flags: Partial<Record<LedgerFlag, boolean>> = {}) {
    let t = start
    let n = 0
    const kv = new CountingKeyValue()
    const ledger = new Ledger({
      kv,
      now: async () => t,
      minClientVersion: '0.1.0',
      seedSource: () => 7,
      tokenSource: () => `token-${n++}`,
      linkApprover: approveAs('player'),
      flags,
    })
    const state = createInitialState(7)
    const a = await ledger.host.mint({ state, name: 'Ann', linked: true })
    const b = await ledger.host.mint({ state, name: 'Bo', linked: true })
    const poll = async (who: { deviceToken: string }, since = 0): Promise<WorldSnapshot> => {
      const w = await ledger.world({ deviceToken: who.deviceToken }, since)
      if ('reason' in w) throw new Error('unauthorized')
      return w
    }
    return {
      kv,
      ledger,
      a,
      b,
      poll,
      advance: (ms: number) => {
        t += ms
      },
    }
  }

  it('two polls in one second share the shared parts and each still sees its own here and contribution', async () => {
    const start = GRID + BOSS_GRID_MS / 2
    const { kv, ledger, a, b, poll, advance } = await setup(start)
    // A boss off the grid, live through the test, that both already hit.
    await kv.set(BOSS_KEY, {
      bossId: 'sb1',
      name: 'Test Boss',
      glyph: 'B',
      spawnedAt: start,
      endsAt: start + BOSS_WINDOW_MS,
      maxHp: 1000,
      hp: 986,
      contributions: { [a.accountId]: 5, [b.accountId]: 9 },
      closed: false,
    } satisfies BossRecord)
    expect(await ledger.chat({ deviceToken: a.deviceToken }, 'hello')).toMatchObject({ ok: true })
    await poll(a)
    await poll(b)
    advance(1000)
    const first = await poll(a)
    const built = kv.sharedReads()
    expect(built).toBeGreaterThan(0)
    const second = await poll(b)
    expect(kv.sharedReads()).toBe(built)
    expect(first).toMatchObject({ online: 2, zones: [{ zone: 1, count: 2 }], here: ['Bo'] })
    expect(second).toMatchObject({ online: 2, zones: [{ zone: 1, count: 2 }], here: ['Ann'] })
    expect(first.boss?.yours).toBe(5)
    expect(second.boss?.yours).toBe(9)
    expect(first.chat.map((m) => m.text)).toEqual(['hello'])
    expect(second.chat.map((m) => m.text)).toEqual(['hello'])
  })

  it('a poll in the next second builds the shared parts again', async () => {
    const { kv, a, b, poll, advance } = await setup(GRID + BOSS_GRID_MS / 2)
    await poll(a)
    await poll(b)
    // The last ms of the second still reads the memo; the next ms is another second.
    advance(999)
    const built = kv.sharedReads()
    await poll(a)
    expect(kv.sharedReads()).toBe(built)
    advance(1)
    await poll(b)
    expect(kv.sharedReads()).toBeGreaterThan(built)
  })

  it('a boss spawning on the grid is seen within a second', async () => {
    const { a, b, poll, advance } = await setup(GRID - 1000)
    expect((await poll(a)).boss).toBeNull()
    expect((await poll(b)).boss).toBeNull()
    advance(999)
    expect((await poll(a)).boss).toBeNull()
    advance(1)
    const first = await poll(b)
    expect(first.boss).toMatchObject({ spawnedAt: GRID, maxHp: 2 * BOSS_BASE_HP, yours: 0 })
    expect((await poll(a)).boss).toEqual(first.boss)
  })

  it('a chat or a settle through the ledger is seen by the next poll in the same second', async () => {
    const { ledger, a, b, poll } = await setup(GRID + BOSS_GRID_MS / 2, { 'sandbox.enabled': true })
    await poll(a)
    await poll(b)
    expect(await ledger.host.spawnBoss()).toEqual({ ok: true })
    expect((await poll(a)).boss?.hp).toBeGreaterThan(0)
    expect(await ledger.chat({ deviceToken: b.deviceToken }, 'hi')).toMatchObject({ ok: true })
    expect((await poll(a)).chat.map((m) => m.text)).toEqual(['hi'])
    expect(await ledger.host.settleBoss()).toEqual({ ok: true })
    expect((await poll(a)).boss?.hp).toBe(0)
  })
})
