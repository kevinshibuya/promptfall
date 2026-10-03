import { type Bootstrap, MemoryKeyValue } from '@promptfall/protocol'
import {
  createInitialState,
  type GameState,
  type Hero,
  hashState,
  type Item,
  replay,
} from '@promptfall/sim'
import { describe, expect, it } from 'vitest'
import { type AccountRecord, LOG_CAP } from './books'
import { Ledger, type LedgerOptions } from './ledger'

class CountingKeyValue extends MemoryKeyValue {
  flushes = 0
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
    linkApprover: async () => ({ login: 'player' }),
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
    expect(again.cursor).toBe(2)
    expect(again.state.gold).toBe(boot.state.gold + 11)
    expect(again.delivery).toEqual({ cursor: 2, events: [] })
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
    simVersion: 2,
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
        simVersion: 2,
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
    expect(boot.state).toEqual(old)
    expect(boot.seq).toBe(4)
    expect(boot.hash).toBe(hashState(old))
    expect(boot.cursor).toBe(0)
    expect(boot.delivery).toEqual({ cursor: 0, events: [] })
    expect(await mem.get('pf:acct:old:record')).toEqual(v1)
    const ack = await ledger.submit(batchFor(boot, old, 0), { deviceToken: 'oldtoken' })
    expect(ack).toEqual({ ok: false, reason: 'sim_version', simVersion: 2 })
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
    if ('reason' in start) throw new Error('unauthorized')
    await ledger.linkPoll({ deviceToken: boot.deviceToken }, start.code)
    expect(counting.flushes).toBe(5)
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
