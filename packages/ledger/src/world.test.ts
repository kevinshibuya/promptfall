import {
  BOARD_ROWS,
  CHAT_BUCKET_CAPACITY,
  CHAT_REFILL_MS,
  MemoryKeyValue,
} from '@promptfall/protocol'
import { createInitialState, type Item } from '@promptfall/sim'
import { describe, expect, it } from 'vitest'
import { isBlocked } from './blocklist'
import { type AccountRecord, newRecord, publicName } from './books'
import { Ledger } from './ledger'
import { BOARDS_KEY, offerZone, refillChat, type StoredBoards } from './world'

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
      linkApprover: async () => ({ login: 'player' }),
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
