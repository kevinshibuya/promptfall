import { type Bootstrap, BUDGETS, MemoryKeyValue } from '@promptfall/protocol'
import { Mirror } from '@promptfall/protocol/mirror'
import {
  createInitialState,
  type GameState,
  type Goods,
  hashState,
  type Item,
  type MigrationChain,
  replay,
  type ServerEvent,
  SIM_VERSION,
} from '@promptfall/sim'
import { describe, expect, it } from 'vitest'
import type { AccountRecord } from './books'
import { approveAs, Ledger, type LedgerOptions } from './ledger'

const BEHIND = SIM_VERSION - 1
const START = 1_700_000_000_000
const ZONE1 = { hp: 630, atk: 14, def: 4, spd: 5 }

function makeLedger(kv: MemoryKeyValue, overrides: Partial<LedgerOptions> = {}) {
  let t = START
  let n = 0
  const lines: string[] = []
  const ledger = new Ledger({
    kv,
    now: async () => t,
    minClientVersion: '0.1.0',
    seedSource: () => 7,
    tokenSource: () => `token-${n++}-${crypto.randomUUID()}`,
    linkApprover: approveAs('player'),
    log: (line) => lines.push(line),
    ...overrides,
  })
  return {
    ledger,
    lines,
    advance: (ms: number) => {
      t += ms
    },
  }
}

const rareItem = (id: string): Item => ({
  id,
  base: 'steel_longsword',
  rarity: 'rare',
  tier: 2,
  affixes: [],
  equippedBy: null,
  tradeableAt: null,
})

const recordKey = (accountId: string) => `pf:acct:${accountId}:record`

async function stored(kv: MemoryKeyValue, accountId: string): Promise<AccountRecord> {
  return (await kv.get(recordKey(accountId))) as AccountRecord
}

/** Rewrites a stored record as one written at `v`, its log and returns as given. */
async function rewind(
  kv: MemoryKeyValue,
  accountId: string,
  v: number,
  log: ServerEvent[] = [],
  patch: Partial<AccountRecord> = {},
): Promise<AccountRecord> {
  const record = await stored(kv, accountId)
  const committedState = { ...record.committedState, v } as unknown as GameState
  const rewound: AccountRecord = {
    ...record,
    committedState,
    committedHash: hashState(committedState),
    log: log.map((event, i) => ({ n: record.cursor + i + 1, event })),
    cursor: record.cursor + log.length,
    state: replay(committedState, log).state,
    ...patch,
  }
  await kv.set(recordKey(accountId), rewound)
  return rewound
}

/** A stub step for the version behind: one gold more, and every steel longsword becomes iron. */
function stubChain(goodsSeen: string[] = []): MigrationChain {
  return {
    [BEHIND]: {
      state: (s) => ({ ...s, gold: (s.gold as number) + 1 }),
      goods: (g: Goods): Goods => {
        if (g.kind !== 'item') return g
        goodsSeen.push(g.item.id)
        return g.item.base === 'steel_longsword'
          ? { ...g, item: { ...g.item, base: 'iron_sword' } }
          : g
      },
    },
  }
}

function booted(boot: Bootstrap | { refusal: string }): Bootstrap {
  if ('refusal' in boot) throw new Error(boot.refusal)
  return boot
}

const pending: ServerEvent[] = [
  { t: 'bought', listingId: 'l-old', goods: { kind: 'item', item: rareItem('b-1') }, price: 100 },
  { t: 'boss_engaged', bossId: 'wbx', name: 'Old Wyrm', glyph: 'W', stats: ZONE1 },
]

describe('a record behind the sim version', () => {
  it('migrates on load: committed snapshot migrated, log replayed, hash recomputed, saved, one line', async () => {
    const kv = new MemoryKeyValue()
    const { ledger, lines } = makeLedger(kv, { migrations: stubChain() })
    const m = await ledger.host.mint({
      state: { ...createInitialState(3), gold: 500 },
      name: 'Ann',
      linked: false,
    })
    const before = await rewind(kv, m.accountId, BEHIND, pending)

    const boot = booted(
      await ledger.bootstrap({ clientVersion: '0.1.0', deviceToken: m.deviceToken }),
    )
    expect(boot.state.v).toBe(SIM_VERSION)
    // The step ran on the committed snapshot only: one gold more, then the log on top.
    expect(boot.state.gold).toBe(before.committedState.gold + 1)
    expect(boot.cursor).toBe(before.committedCursor)
    expect(boot.hash).toBe(hashState(boot.state))
    // The purchase's goods passed the goods rule.
    const bought = boot.delivery.events[0]?.event
    expect(bought?.t === 'bought' && bought.goods.kind === 'item' && bought.goods.item.base).toBe(
      'iron_sword',
    )

    const after = await stored(kv, m.accountId)
    expect(after.committedState.v).toBe(SIM_VERSION)
    expect(after.state.v).toBe(SIM_VERSION)
    expect(after.state).toEqual(
      replay(
        after.committedState,
        after.log.map((e) => e.event),
      ).state,
    )
    expect(after.state.boss?.bossId).toBe('wbx')
    expect(after.state.inventory.map((i) => i.base)).toContain('iron_sword')
    expect(after.committedHash).toBe(hashState(after.committedState))

    // The client replays the delivery over the bootstrap and lands on the server's effective state.
    const mirror = new Mirror(boot)
    expect(hashState(mirror.local)).toBe(hashState(after.state))
    const ack = await ledger.submit(mirror.batch([{ t: 'tick' }]), { deviceToken: m.deviceToken })
    expect(ack).toMatchObject({ ok: true, duplicate: false })

    // Loaded again, the record is current: still one line.
    await ledger.bootstrap({ clientVersion: '0.1.0', deviceToken: m.deviceToken })
    expect(lines.filter((l) => l.includes(m.accountId))).toEqual([
      `migrated account ${m.accountId} from v${BEHIND} to v${SIM_VERSION}`,
    ])
  })

  it('initialises a missing budget bucket with a full balance and the ledger clock', async () => {
    const kv = new MemoryKeyValue()
    const { ledger, advance } = makeLedger(kv, { migrations: stubChain() })
    const m = await ledger.host.mint({ state: createInitialState(4), name: 'Bo', linked: false })
    const record = await stored(kv, m.accountId)
    const { turn_end: _b, ...buckets } = record.buckets
    const { turn_end: _r, ...refillAt } = record.refillAt
    await rewind(kv, m.accountId, BEHIND, [], {
      buckets: buckets as AccountRecord['buckets'],
      refillAt: refillAt as AccountRecord['refillAt'],
    })
    advance(60_000)
    await ledger.bootstrap({ clientVersion: '0.1.0', deviceToken: m.deviceToken })
    const after = await stored(kv, m.accountId)
    expect(after.buckets.turn_end).toBe(BUDGETS.turn_end.capacity)
    expect(after.refillAt.turn_end).toBe(START + 60_000)
    // A bucket the record held is left as it was.
    expect(after.refillAt.tick).toBe(record.refillAt.tick)
  })

  it('normalises the market book and the returns once through the goods rule', async () => {
    const kv = new MemoryKeyValue()
    // Written at the current version: the seller lists a longsword, so the book holds goods.
    const first = makeLedger(kv)
    const seller = await first.ledger.host.mint({
      state: { ...createInitialState(5), gold: 1000, inventory: [rareItem('listed-1')] },
      name: 'Cy',
      linked: true,
    })
    const listed = await first.ledger.list(
      { deviceToken: seller.deviceToken },
      { kind: 'item', id: 'listed-1', price: 50 },
    )
    expect(listed.ok).toBe(true)
    // The store as the version behind left it: the book's mark and the seller with a waiting return.
    await kv.set('pf:market:v', BEHIND)
    await rewind(kv, seller.accountId, BEHIND, [], {
      returns: [{ listingId: 'gone', goods: { kind: 'item', item: rareItem('waiting-1') } }],
    })
    await kv.set('pf:returns', [seller.accountId])

    const seen: string[] = []
    const second = makeLedger(kv, { migrations: stubChain(seen) })
    const buyer = await second.ledger.host.mint({
      state: { ...createInitialState(6), gold: 1000 },
      name: 'Di',
      linked: true,
    })
    const auth = { deviceToken: buyer.deviceToken }
    for (let i = 0; i < 2; i++) {
      const page = await second.ledger.browse(auth, { kind: 'item', sort: 'newest', page: 0 })
      if ('reason' in page) throw new Error(page.reason)
      const goods = page.listings[0]?.goods
      expect(goods?.kind === 'item' && goods.item.base).toBe('iron_sword')
    }
    expect(second.lines).toContain(`migrated the market book from v${BEHIND} to v${SIM_VERSION}`)

    // The waiting return reaches its owner as the goods rule left it.
    await second.ledger.host.sweep()
    const info = await second.ledger.account({ deviceToken: seller.deviceToken })
    if ('reason' in info) throw new Error(info.reason)
    const returned = info.delivery.events.map((e) => e.event).find((e) => e.t === 'returned')
    expect(
      returned?.t === 'returned' && returned.goods.kind === 'item' && returned.goods.item,
    ).toMatchObject({
      id: 'waiting-1',
      base: 'iron_sword',
    })

    // A later start over the same store finds the book current and runs nothing again.
    const third = makeLedger(kv, { migrations: stubChain(seen) })
    await third.ledger.browse(auth, { kind: 'item', sort: 'newest', page: 0 })
    expect(seen.filter((id) => id === 'listed-1')).toEqual(['listed-1'])
    expect(seen.filter((id) => id === 'waiting-1')).toEqual(['waiting-1'])
  })
})

describe('the 7→8 step on the ledger', () => {
  it('adds the tier to a listed item and a waiting return and keeps every roll', async () => {
    const kv = new MemoryKeyValue()
    const blade = (id: string): Item => ({
      ...rareItem(id),
      base: 'mithril_blade',
      tier: 3,
      affixes: [{ id: 'brutal', value: 3 }],
    })
    const untiered = ({ tier: _, ...rest }: Item) => rest
    const first = makeLedger(kv)
    const seller = await first.ledger.host.mint({
      state: { ...createInitialState(5), gold: 1000, inventory: [blade('listed-1')] },
      name: 'Cy',
      linked: true,
    })
    const listed = await first.ledger.list(
      { deviceToken: seller.deviceToken },
      { kind: 'item', id: 'listed-1', price: 50 },
    )
    expect(listed.ok).toBe(true)
    // The store as v7 left it: the book's mark, its listing and a return with items of no tier.
    await kv.set('pf:market:v', 7)
    for (const key of kv.keys().filter((k) => k.startsWith('pf:listing:'))) {
      const listing = (await kv.get(key)) as { goods: Goods }
      if (listing.goods.kind === 'item') {
        await kv.set(key, {
          ...listing,
          goods: { kind: 'item', item: untiered(listing.goods.item) },
        })
      }
    }
    await rewind(kv, seller.accountId, 7, [], {
      returns: [
        { listingId: 'gone', goods: { kind: 'item', item: untiered(blade('waiting-1')) as Item } },
      ],
    })
    await kv.set('pf:returns', [seller.accountId])

    const second = makeLedger(kv)
    const buyer = await second.ledger.host.mint({
      state: { ...createInitialState(6), gold: 1000 },
      name: 'Di',
      linked: true,
    })
    const page = await second.ledger.browse(
      { deviceToken: buyer.deviceToken },
      { kind: 'item', sort: 'newest', page: 0 },
    )
    if ('reason' in page) throw new Error(page.reason)
    const goods = page.listings[0]?.goods
    expect(goods?.kind === 'item' && goods.item).toEqual({ ...blade('listed-1'), equippedBy: null })

    await second.ledger.host.sweep()
    const info = await second.ledger.account({ deviceToken: seller.deviceToken })
    if ('reason' in info) throw new Error(info.reason)
    const returned = info.delivery.events.map((e) => e.event).find((e) => e.t === 'returned')
    expect(returned?.t === 'returned' && returned.goods).toEqual({
      kind: 'item',
      item: blade('waiting-1'),
    })
  })
})

describe('a record the ledger cannot migrate', () => {
  for (const [what, v, reason] of [
    ['ahead', SIM_VERSION + 1, `v${SIM_VERSION + 1} is ahead of v${SIM_VERSION}`],
    ['with a gap', BEHIND, `gap in the chain, no step from v${BEHIND}`],
  ] as const) {
    it(`a record ${what} is answered unchanged, logged once and kept`, async () => {
      const kv = new MemoryKeyValue()
      // An empty chain: no step from the version behind.
      const { ledger, lines } = makeLedger(kv, { migrations: {} })
      const m = await ledger.host.mint({ state: createInitialState(8), name: 'Ed', linked: false })
      const before = await rewind(kv, m.accountId, v, [], {
        state: { ...(await stored(kv, m.accountId)).state, v } as unknown as GameState,
      })
      for (let i = 0; i < 2; i++) {
        const boot = booted(
          await ledger.bootstrap({ clientVersion: '0.1.0', deviceToken: m.deviceToken }),
        )
        expect(boot.state).toEqual(before.state)
        expect(boot.delivery).toEqual({ cursor: 0, events: [] })
      }
      expect(await stored(kv, m.accountId)).toEqual(before)
      expect(lines.filter((l) => l.includes(m.accountId))).toEqual([
        `not migrated account ${m.accountId} from v${v}: ${reason}`,
      ])
    })
  }
})
