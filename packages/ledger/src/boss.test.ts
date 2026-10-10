import {
  BOSS_BASE_HP,
  BOSS_GRID_MS,
  BOSS_WINDOW_MS,
  MemoryKeyValue,
  type ServerConfig,
} from '@promptfall/protocol'
import * as sim from '@promptfall/sim'
import {
  createInitialState,
  type GameState,
  hashState,
  replay,
  SIM_VERSION,
  step,
} from '@promptfall/sim'
import { describe, expect, it, vi } from 'vitest'
import { type AccountRecord, Books, newRecord, TrackedKeyValue } from './books'
import {
  advanceBoss,
  BOSS_KEY,
  type BossRecord,
  contribute,
  engage,
  loadBoss,
  settleBoss,
  toBossView,
} from './boss'
import { WORLD_BOSSES } from './boss-config'
import { approveAs, Ledger } from './ledger'
import { type WorldContext, WorldMemo } from './world'

vi.mock('@promptfall/sim', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@promptfall/sim')>()
  return { ...actual, rollRewardItem: vi.fn(actual.rollRewardItem) }
})

const GRID = 1_700_006_400_000 // a grid point: 1_700_006_400_000 % BOSS_GRID_MS === 0
const ZONE1 = { hp: 630, atk: 14, def: 4, spd: 5 }

function context(now = GRID, flags: Record<string, boolean> = {}) {
  const mem = new MemoryKeyValue()
  const ctx: WorldContext = {
    books: new Books(new TrackedKeyValue(mem)),
    now,
    flags,
    presence: new Map(),
    memo: new WorldMemo(),
    ttl: 45_000,
    speed: 1,
    seedSource: () => 7,
    log: () => undefined,
  }
  return { ctx, mem }
}

async function account(ctx: WorldContext, id: string, state: GameState = createInitialState(1)) {
  const record = newRecord(
    { accountId: id, seed: 1, createdAt: 0, displayName: id, linked: null },
    state,
    0,
  )
  await ctx.books.save(record)
  return record
}

const online = (ctx: WorldContext, ...ids: string[]) => {
  for (const id of ids) ctx.presence.set(id, { zone: 1, name: id, at: ctx.now })
}

async function load(ctx: WorldContext, id: string): Promise<AccountRecord> {
  const record = await ctx.books.load(id)
  if (!record) throw new Error(`no ${id}`)
  return record
}

const kinds = (r: AccountRecord) => r.log.map((e) => e.event.t)

function bossRecord(patch: Partial<BossRecord> = {}): BossRecord {
  return {
    bossId: 'wbx',
    name: 'Old',
    glyph: '☠',
    spawnedAt: GRID - BOSS_GRID_MS,
    endsAt: GRID - BOSS_GRID_MS + BOSS_WINDOW_MS,
    maxHp: BOSS_BASE_HP,
    hp: BOSS_BASE_HP,
    contributions: {},
    closed: false,
    ...patch,
  }
}

function engagedState(bossId = 'wbx', dealt = 0): GameState {
  const s = step(createInitialState(1), {
    t: 'boss_engaged',
    bossId,
    name: 'Old',
    glyph: '☠',
    stats: ZONE1,
  }).state
  return s.boss ? { ...s, boss: { ...s.boss, dealt } } : s
}

describe('the schedule', () => {
  it('names the boss by its grid index and sizes it by who is online, at least one', async () => {
    const { ctx, mem } = context(GRID + 5_000)
    await advanceBoss(ctx)
    const index = GRID / BOSS_GRID_MS
    const boss = (await mem.get(BOSS_KEY)) as BossRecord
    expect(boss.bossId).toBe(`wb${index.toString(36)}`)
    expect(boss.name).toBe(WORLD_BOSSES[index % WORLD_BOSSES.length]?.name)
    expect(boss).toMatchObject({
      maxHp: BOSS_BASE_HP,
      hp: BOSS_BASE_HP,
      spawnedAt: GRID,
      endsAt: GRID + BOSS_WINDOW_MS,
      closed: false,
    })
  })

  it('spawns nothing outside the window', async () => {
    const { ctx, mem } = context(GRID + BOSS_WINDOW_MS)
    await advanceBoss(ctx)
    expect(await mem.get(BOSS_KEY)).toBeUndefined()
  })
})

describe('contribution', () => {
  it('floors the HP at 0 and counts the whole delta', async () => {
    const { ctx } = context(GRID + 1_000)
    const boss = bossRecord({ endsAt: GRID + BOSS_WINDOW_MS, hp: 100, contributions: { a: 0 } })
    await ctx.books.kv.set(BOSS_KEY, boss)
    const record = await account(ctx, 'a', engagedState('wbx', 350))
    await contribute(ctx, record, 0)
    const after = await loadBoss(ctx.books.kv)
    expect(after?.hp).toBe(0)
    expect(after?.contributions.a).toBe(350)
    expect(after?.closed).toBe(true)
  })
})

describe('settleBoss', () => {
  it('gives the top 3 a bonus roll, ties by account id, and the fourth only its threshold roll', async () => {
    const { ctx } = context()
    const ids = ['d', 'c', 'b', 'a']
    for (const id of ids) await account(ctx, id, engagedState())
    await account(ctx, 'low', engagedState())
    const boss = bossRecord({ contributions: { a: 300, b: 300, c: 300, d: 300, low: 5 } })
    await settleBoss(ctx, boss, { expired: false, inHand: null })
    const rewards = async (id: string) =>
      kinds(await load(ctx, id)).filter((k) => k === 'rewarded').length
    expect(await rewards('a')).toBe(2)
    expect(await rewards('b')).toBe(2)
    expect(await rewards('c')).toBe(2)
    expect(await rewards('d')).toBe(1)
    // Under the threshold and outside the top 3: nothing, but still disengaged.
    expect(kinds(await load(ctx, 'low'))).toEqual(['boss_disengaged'])
    expect(boss.closed).toBe(true)
  })

  it('a top-3 contributor under the threshold gets its one bonus roll', async () => {
    const { ctx } = context()
    await account(ctx, 'a', engagedState())
    await settleBoss(ctx, bossRecord({ contributions: { a: 5 } }), {
      expired: false,
      inHand: null,
    })
    expect(kinds(await load(ctx, 'a'))).toEqual(['rewarded', 'boss_disengaged'])
  })

  it('skips a record from an older sim version without throwing', async () => {
    const { ctx } = context()
    const old = { ...createInitialState(1), v: 2 } as unknown as GameState
    await account(ctx, 'old', old)
    await account(ctx, 'a', engagedState())
    const boss = bossRecord({ contributions: { old: 500, a: 500 } })
    await settleBoss(ctx, boss, { expired: false, inHand: null })
    expect((await load(ctx, 'old')).log).toEqual([])
    expect(kinds(await load(ctx, 'a'))).toEqual(['rewarded', 'rewarded', 'boss_disengaged'])
    expect(boss.closed).toBe(true)
  })

  it("rolls with the contributor's zone and party classes", async () => {
    const { ctx } = context()
    const base = engagedState()
    await account(ctx, 'a', { ...base, zone: 3, highestZone: 3 })
    const roll = vi.mocked(sim.rollRewardItem)
    roll.mockClear()
    await settleBoss(ctx, bossRecord({ contributions: { a: 500 } }), {
      expired: true,
      inHand: null,
    })
    const classes = base.party.map((id) => base.roster.find((h) => h.id === id)?.cls)
    expect(roll).toHaveBeenCalledWith(7, 3, classes)
    const event = (await load(ctx, 'a')).log[0]?.event
    expect(event?.t === 'rewarded' && event.goods?.kind === 'item' && event.goods.item.id).toMatch(
      /^r/,
    )
  })

  it('a null roll pays its gold and queues nothing', async () => {
    const { ctx } = context()
    await account(ctx, 'a', engagedState())
    vi.mocked(sim.rollRewardItem).mockReturnValueOnce(null)
    await settleBoss(ctx, bossRecord({ contributions: { a: 500 } }), {
      expired: true,
      inHand: null,
    })
    const record = await load(ctx, 'a')
    const event = record.log[0]?.event
    expect(event).toMatchObject({ t: 'rewarded', goods: null })
    expect(event?.t === 'rewarded' && event.gold).toBeGreaterThan(0)
    expect(record.returns).toEqual([])
  })
})

describe('the lifecycle', () => {
  it('1: a passed window is settled before the next grid point spawns, then the online are engaged', async () => {
    const { ctx } = context(GRID + 1_000)
    await ctx.books.kv.set(BOSS_KEY, bossRecord({ contributions: { a: 500, b: 0 } }))
    await account(ctx, 'a', engagedState())
    await account(ctx, 'b', engagedState())
    online(ctx, 'a')
    await advanceBoss(ctx)
    const newId = `wb${(GRID / BOSS_GRID_MS).toString(36)}`
    expect((await load(ctx, 'a')).log.map((e) => e.event)).toEqual([
      expect.objectContaining({ t: 'rewarded', bossId: 'wbx' }),
      { t: 'boss_disengaged', bossId: 'wbx' },
      expect.objectContaining({ t: 'boss_engaged', bossId: newId }),
    ])
    expect(kinds(await load(ctx, 'b'))).toEqual(['boss_disengaged'])
    const boss = await loadBoss(ctx.books.kv)
    expect(boss).toMatchObject({ bossId: newId, closed: false, contributions: { a: 0 } })
  })

  it('2: engage over a stale engagement disengages first; over this one does nothing', async () => {
    const { ctx } = context()
    const stale = await account(ctx, 'a', engagedState('wbold'))
    const boss = bossRecord({ bossId: 'wbnew' })
    engage(stale, boss)
    expect(kinds(stale)).toEqual(['boss_disengaged', 'boss_engaged'])
    expect(stale.state.boss?.bossId).toBe('wbnew')
    engage(stale, boss)
    expect(kinds(stale)).toEqual(['boss_disengaged', 'boss_engaged'])
    expect(boss.contributions).toEqual({ a: 0 })
  })

  it('3: a contributor already out of boss mode does not stop the settlement', async () => {
    const { ctx } = context()
    await account(ctx, 'out', createInitialState(1))
    await account(ctx, 'a', engagedState())
    const boss = bossRecord({ contributions: { out: 500, a: 500 } })
    await settleBoss(ctx, boss, { expired: true, inHand: null })
    expect(kinds(await load(ctx, 'out'))).toEqual(['rewarded'])
    expect(kinds(await load(ctx, 'a'))).toEqual(['rewarded', 'boss_disengaged'])
    expect(boss.closed).toBe(true)
  })

  it('4: the flag turned off settles an open boss as expired and spawns nothing', async () => {
    const { ctx } = context(GRID + 1_000, { 'worldboss.enabled': false })
    const open = bossRecord({
      bossId: 'wbnow',
      spawnedAt: GRID,
      endsAt: GRID + BOSS_WINDOW_MS,
      contributions: { a: 500, b: 5 },
    })
    await ctx.books.kv.set(BOSS_KEY, open)
    await account(ctx, 'a', engagedState('wbnow'))
    await account(ctx, 'b', engagedState('wbnow'))
    online(ctx, 'a', 'b')
    await advanceBoss(ctx)
    expect(kinds(await load(ctx, 'a'))).toEqual(['rewarded', 'boss_disengaged'])
    expect(kinds(await load(ctx, 'b'))).toEqual(['boss_disengaged'])
    expect(await loadBoss(ctx.books.kv)).toMatchObject({ bossId: 'wbnow', closed: true })
  })
})

describe('the ledger', () => {
  function ledgerAt(start: number, flags: Record<string, boolean> = {}) {
    let t = start
    let n = 0
    const kv = new MemoryKeyValue()
    const ledger = new Ledger({
      kv,
      now: async () => t,
      minClientVersion: '0.1.0',
      seedSource: () => 7,
      tokenSource: () => `tok-${n++}`,
      linkApprover: approveAs('player'),
      flags,
    })
    return {
      ledger,
      kv,
      advance: (ms: number) => {
        t += ms
      },
    }
  }

  const strong = (s: GameState): GameState => ({
    ...s,
    roster: s.roster.map((h) => (s.party.includes(h.id) ? { ...h, level: 40, hp: 9999 } : h)),
  })

  function batchOf(
    boot: { account: { accountId: string }; config: ServerConfig },
    state: GameState,
    seq: number,
    cursor: number,
    base: GameState,
    n: number,
  ) {
    const events = Array.from({ length: n }, () => ({ t: 'tick' as const }))
    return {
      events,
      batch: {
        batchId: crypto.randomUUID(),
        accountId: boot.account.accountId,
        seq,
        clientVersion: '0.1.0',
        simVersion: SIM_VERSION,
        cursor,
        baseHash: hashState(base),
        resultHash: hashState(replay(state, events).state),
        events: events.map((e, i) => ({ ...e, at: i + 1 })),
      },
    }
  }

  it('5: a submit right after a grid point spawns nothing; the next world poll does', async () => {
    const { ledger, kv, advance } = ledgerAt(GRID - 1_000)
    const boot = await ledger.bootstrap({ clientVersion: '0.1.0', deviceToken: null })
    const auth = { deviceToken: boot.deviceToken }
    await ledger.world(auth, 0)
    advance(2_000)
    const { batch } = batchOf(boot, boot.state, 0, 0, boot.state, 1)
    expect(await ledger.submit(batch, auth)).toMatchObject({ ok: true })
    expect(await kv.get(BOSS_KEY)).toBeUndefined()
    const w = await ledger.world(auth, 0)
    if ('reason' in w) throw new Error('unauthorized')
    expect(w.boss?.spawnedAt).toBe(GRID)
  })

  it('6: the killing submit authors the rewards and the disengage into its ack and the stored record', async () => {
    const { ledger, kv, advance } = ledgerAt(GRID - 1_000)
    const m = await ledger.host.mint({
      state: strong({ ...createInitialState(5), gold: 1000 }),
      name: 'Ann',
      linked: true,
    })
    const auth = { deviceToken: m.deviceToken }
    await ledger.world(auth, 0)
    advance(2_000)
    await ledger.world(auth, 0)
    const boot = await ledger.bootstrap({ clientVersion: '0.1.0', deviceToken: m.deviceToken })
    const local = replay(
      boot.state,
      boot.delivery.events.map((e) => e.event),
    ).state
    expect(local.boss).not.toBeNull()
    const { batch } = batchOf(boot, local, boot.seq, boot.delivery.cursor, boot.state, 60)
    const ack = await ledger.submit(batch, auth)
    if (!ack.ok) throw new Error(`refused: ${ack.reason}`)
    const delivered = ack.delivery.events.map((e) => e.event.t)
    expect(delivered).toEqual(['rewarded', 'rewarded', 'boss_disengaged'])
    const stored = (await kv.get(`pf:acct:${m.accountId}:record`)) as AccountRecord
    expect(stored.log.map((e) => e.event.t)).toEqual(delivered)
    expect(stored.state.boss).toBeNull()
    expect(((await kv.get(BOSS_KEY)) as BossRecord).closed).toBe(true)
    expect(stored.state.inventory.some((i) => i.id.startsWith('r'))).toBe(true)
  })
})

describe('flags and edges', () => {
  it('with presence off, a poll engages the caller and the boss is sized for one', async () => {
    let t = GRID - 1_000
    let n = 0
    const kv = new MemoryKeyValue()
    const ledger = new Ledger({
      kv,
      now: async () => t,
      minClientVersion: '0.1.0',
      seedSource: () => 7,
      tokenSource: () => `tok-${n++}`,
      linkApprover: approveAs('player'),
      flags: { 'presence.enabled': false },
    })
    const m = await ledger.host.mint({ state: createInitialState(5), name: 'Ann', linked: true })
    const auth = { deviceToken: m.deviceToken }
    t += 2_000
    const w = await ledger.world(auth, 0)
    if ('reason' in w) throw new Error('unauthorized')
    expect(w.online).toBe(0)
    expect(w.boss).toMatchObject({ maxHp: BOSS_BASE_HP, hp: BOSS_BASE_HP })
    const record = (await kv.get(`pf:acct:${m.accountId}:record`)) as AccountRecord
    expect(record.log.map((e) => e.event.t)).toEqual(['boss_engaged'])
  })

  it('with the flag off, a committed batch contributes nothing, and the snapshot hides the boss', async () => {
    const { ctx } = context(GRID + 1_000, { 'worldboss.enabled': false })
    const boss = bossRecord({
      bossId: 'wbx',
      spawnedAt: GRID,
      endsAt: GRID + BOSS_WINDOW_MS,
      contributions: { a: 0 },
    })
    await ctx.books.kv.set(BOSS_KEY, boss)
    const record = await account(ctx, 'a', engagedState('wbx', 300))
    await contribute(ctx, record, 0)
    expect(await loadBoss(ctx.books.kv)).toEqual(boss)
    expect(toBossView(ctx, boss, 'a')).toBeNull()
  })

  it('a batch committed after the window, before any settle, counts for nothing', async () => {
    const { ctx } = context(GRID + BOSS_WINDOW_MS + 5)
    const boss = bossRecord({
      bossId: 'wbx',
      spawnedAt: GRID,
      endsAt: GRID + BOSS_WINDOW_MS,
      contributions: { a: 0 },
    })
    await ctx.books.kv.set(BOSS_KEY, boss)
    const record = await account(ctx, 'a', engagedState('wbx', 300))
    await contribute(ctx, record, 0)
    expect(await loadBoss(ctx.books.kv)).toEqual(boss)
  })

  it('the sweep settles an expired boss as the poll would', async () => {
    let t = GRID - 1_000
    let n = 0
    const kv = new MemoryKeyValue()
    const ledger = new Ledger({
      kv,
      now: async () => t,
      minClientVersion: '0.1.0',
      seedSource: () => 7,
      tokenSource: () => `tok-${n++}`,
      linkApprover: approveAs('player'),
    })
    const m = await ledger.host.mint({ state: createInitialState(5), name: 'Ann', linked: true })
    await ledger.world({ deviceToken: m.deviceToken }, 0)
    t += 2_000
    await ledger.world({ deviceToken: m.deviceToken }, 0)
    t += BOSS_WINDOW_MS
    await ledger.host.sweep()
    expect(((await kv.get(BOSS_KEY)) as BossRecord).closed).toBe(true)
    const record = (await kv.get(`pf:acct:${m.accountId}:record`)) as AccountRecord
    expect(record.log.map((e) => e.event.t)).toEqual(['boss_engaged', 'boss_disengaged'])
  })
})
