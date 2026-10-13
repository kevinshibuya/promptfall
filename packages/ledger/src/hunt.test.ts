import { HUNT_THRESHOLD_BP, MemoryKeyValue, WEEK_MS } from '@promptfall/protocol'
import * as sim from '@promptfall/sim'
import { createInitialState, type GameState, huntAt, type Item } from '@promptfall/sim'
import { describe, expect, it } from 'vitest'
import { type AccountRecord, Books, newRecord, TrackedKeyValue } from './books'
import { advanceHunt, countHunt, HUNT_KEY, type HuntRecord, loadHunt, toHuntView } from './hunt'
import { approveAs, Ledger } from './ledger'
import { type WorldContext, WorldMemo } from './world'

const MONDAY = Date.UTC(2023, 10, 13) // Monday 13 November 2023, 00:00 UTC
const WEEK = Math.floor(MONDAY / WEEK_MS)
/** The zone 1 caster and brute. */
const CASTER = 'hedge_sprite'
const BRUTE = 'goblin_scout'

function context(now = MONDAY + 3_600_000, flags: Record<string, boolean> = {}) {
  const mem = new MemoryKeyValue()
  const ctx: WorldContext = {
    books: new Books(new TrackedKeyValue(mem), {
      chain: sim.MIGRATIONS,
      now: async () => now,
      log: () => undefined,
    }),
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

async function account(
  ctx: WorldContext,
  id: string,
  state: GameState = createInitialState(1),
  bot = false,
): Promise<AccountRecord> {
  const record = newRecord(
    { accountId: id, seed: 1, createdAt: 0, displayName: id, linked: null },
    state,
    0,
  )
  if (bot) record.bot = true
  await ctx.books.save(record)
  return record
}

async function load(ctx: WorldContext, id: string): Promise<AccountRecord> {
  const record = await ctx.books.load(id)
  if (!record) throw new Error(`no ${id}`)
  return record
}

function huntRecord(patch: Partial<HuntRecord> = {}): HuntRecord {
  return {
    huntId: 'hx',
    row: 'casters',
    name: 'casters',
    kind: 'caster',
    target: 20_000,
    weekStart: MONDAY,
    endsAt: MONDAY + WEEK_MS,
    count: 0,
    contributions: {},
    closed: false,
    ...patch,
  }
}

/** The state with `n` more kills of `def`, and `bosses` more zone bosses. */
function killed(s: GameState, def: string, n: number, bosses = 0): GameState {
  const row = s.tallies.enemies[def] ?? { seen: 0, defeated: 0 }
  return {
    ...s,
    tallies: {
      ...s.tallies,
      enemies: { ...s.tallies.enemies, [def]: { seen: row.seen + n, defeated: row.defeated + n } },
      zoneBosses: s.tallies.zoneBosses + bosses,
    },
  }
}

/** Commits `after` onto the record as play would: the hunt counts the difference from `before`. */
async function commit(ctx: WorldContext, record: AccountRecord, after: GameState) {
  const before = record.state
  record.state = after
  await countHunt(ctx, record, before)
}

const stored = async (ctx: WorldContext) => {
  const hunt = await loadHunt(ctx.books.kv)
  if (!hunt) throw new Error('no hunt')
  return hunt
}

const rewards = (r: AccountRecord) => r.log.map((e) => e.event).filter((e) => e.t === 'rewarded')

describe('the week', () => {
  it("opens this week's record from the table at the first advance, and keeps it", async () => {
    const { ctx } = context()
    await advanceHunt(ctx)
    const row = huntAt(WEEK)
    const hunt = await stored(ctx)
    expect(hunt).toMatchObject({
      row: row.id,
      name: row.name,
      kind: row.kind,
      target: row.target,
      weekStart: MONDAY,
      endsAt: MONDAY + WEEK_MS,
      count: 0,
      contributions: {},
      closed: false,
    })
    await ctx.books.kv.set(HUNT_KEY, { ...hunt, count: 5 })
    await advanceHunt(ctx)
    expect((await stored(ctx)).count).toBe(5)
  })

  it('shows name, target, count, the end and the caller’s part; null with the flag off', async () => {
    const { ctx } = context()
    const hunt = huntRecord({ count: 12_400, contributions: { a: 120 } })
    expect(toHuntView(ctx, hunt, 'a')).toEqual({
      name: 'casters',
      target: 20_000,
      count: 12_400,
      endsAt: MONDAY + WEEK_MS,
      yours: 120,
    })
    expect(toHuntView(ctx, hunt, 'b')?.yours).toBe(0)
    expect(toHuntView(context(undefined, { 'hunt.enabled': false }).ctx, hunt, 'a')).toBeNull()
    expect(toHuntView(ctx, null, 'a')).toBeNull()
  })
})

describe('the count', () => {
  it("adds a commit's kills of the hunt's archetype to the count and the contribution", async () => {
    const { ctx } = context()
    await ctx.books.kv.set(HUNT_KEY, huntRecord({ count: 30, contributions: { other: 30 } }))
    const a = await account(ctx, 'a')
    await commit(ctx, a, killed(killed(a.state, CASTER, 10), BRUTE, 4))
    expect(await stored(ctx)).toMatchObject({ count: 40, contributions: { other: 30, a: 10 } })
    await commit(ctx, a, killed(a.state, CASTER, 3))
    expect(await stored(ctx)).toMatchObject({ count: 43, contributions: { other: 30, a: 13 } })
  })

  it("adds a commit's zone bosses to a zone bosses hunt, and counts past the target", async () => {
    const { ctx } = context()
    await ctx.books.kv.set(
      HUNT_KEY,
      huntRecord({ row: 'zone_bosses', name: 'zone bosses', kind: 'zone_boss', target: 2 }),
    )
    const a = await account(ctx, 'a')
    await commit(ctx, a, killed(a.state, CASTER, 10, 3))
    expect(await stored(ctx)).toMatchObject({ count: 3, contributions: { a: 3 } })
  })

  it("adds nothing for a bot's commit, with the flag off, or past the week's end", async () => {
    const { ctx } = context()
    await ctx.books.kv.set(HUNT_KEY, huntRecord())
    const bot = await account(ctx, 'bot', createInitialState(1), true)
    await commit(ctx, bot, killed(bot.state, CASTER, 10))
    expect(await stored(ctx)).toMatchObject({ count: 0, contributions: {} })

    const off = context(undefined, { 'hunt.enabled': false })
    await off.ctx.books.kv.set(HUNT_KEY, huntRecord())
    const a = await account(off.ctx, 'a')
    await commit(off.ctx, a, killed(a.state, CASTER, 10))
    expect(await stored(off.ctx)).toMatchObject({ count: 0, contributions: {} })

    const late = context(MONDAY + WEEK_MS + 1)
    await late.ctx.books.kv.set(HUNT_KEY, huntRecord())
    const b = await account(late.ctx, 'b')
    await commit(late.ctx, b, killed(b.state, CASTER, 10))
    expect(await stored(late.ctx)).toMatchObject({ count: 0, contributions: {} })
  })

  it('opens nothing with the flag off', async () => {
    const { ctx } = context(undefined, { 'hunt.enabled': false })
    await advanceHunt(ctx)
    expect(await loadHunt(ctx.books.kv)).toBeNull()
  })
})

describe('the close', () => {
  const threshold = (20_000 * HUNT_THRESHOLD_BP) / 10_000

  it('pays each contributor at or above the threshold one reward with the hunt source, met or not, then opens the next week', async () => {
    const { ctx } = context(MONDAY + WEEK_MS + 1_000)
    await ctx.books.kv.set(
      HUNT_KEY,
      huntRecord({
        count: 2 * threshold + 1,
        contributions: { at: threshold, above: threshold + 1, below: threshold - 1 },
      }),
    )
    await account(ctx, 'at', { ...createInitialState(1), zone: 3, highestZone: 3 })
    await account(ctx, 'above')
    await account(ctx, 'below')
    await advanceHunt(ctx)
    for (const id of ['at', 'above']) {
      const paid = rewards(await load(ctx, id))
      expect(paid).toEqual([
        expect.objectContaining({ t: 'rewarded', bossId: 'hx', source: 'hunt' }),
      ])
    }
    expect(rewards(await load(ctx, 'below'))).toEqual([])
    const next = huntAt(WEEK + 1)
    expect(await stored(ctx)).toMatchObject({
      row: next.id,
      weekStart: MONDAY + WEEK_MS,
      endsAt: MONDAY + 2 * WEEK_MS,
      count: 0,
      contributions: {},
      closed: false,
    })
    // The next advance pays nobody again.
    await advanceHunt(ctx)
    expect(rewards(await load(ctx, 'above'))).toHaveLength(1)
  })

  it('a reward with no free slot waits in returns', async () => {
    const { ctx } = context(MONDAY + WEEK_MS)
    await ctx.books.kv.set(HUNT_KEY, huntRecord({ contributions: { a: threshold } }))
    const base = createInitialState(1)
    const filler = (i: number): Item => ({
      id: `f${i}`,
      base: 'iron_sword',
      rarity: 'common',
      tier: 1,
      affixes: [],
      equippedBy: null,
      tradeableAt: null,
    })
    const full = {
      ...base,
      inventory: Array.from({ length: base.inventoryCap }, (_, i) => filler(i)),
    }
    await account(ctx, 'a', full)
    await advanceHunt(ctx)
    const a = await load(ctx, 'a')
    expect(rewards(a)).toEqual([
      expect.objectContaining({ t: 'rewarded', goods: null, source: 'hunt' }),
    ])
    expect(a.returns).toEqual([
      { listingId: 'hx', goods: expect.objectContaining({ kind: 'item' }) },
    ])
  })

  it('pays nothing before the week ends', async () => {
    const { ctx } = context(MONDAY + WEEK_MS - 1)
    await ctx.books.kv.set(HUNT_KEY, huntRecord({ contributions: { a: threshold } }))
    await account(ctx, 'a')
    await advanceHunt(ctx)
    expect(rewards(await load(ctx, 'a'))).toEqual([])
    expect((await stored(ctx)).huntId).toBe('hx')
  })
})

describe('through the ledger', () => {
  function ledger(kv: MemoryKeyValue, clock: { t: number }, flags = {}) {
    let n = 0
    return new Ledger({
      kv,
      now: async () => clock.t,
      minClientVersion: '0.1.0',
      seedSource: () => 100 + n++,
      tokenSource: () => crypto.randomUUID(),
      flags,
      linkApprover: approveAs('player'),
    })
  }

  it('a read that asks for no advance opens nothing; the record survives a restart', async () => {
    const kv = new MemoryKeyValue()
    const clock = { t: MONDAY + 3_600_000 }
    const first = ledger(kv, clock)
    const m = await first.host.mint({ state: createInitialState(3), name: 'a', linked: false })
    const auth = { deviceToken: m.deviceToken }
    const quiet = await first.world(auth, 0, { advance: false, persist: false })
    expect('reason' in quiet ? null : quiet.hunt).toBeNull()
    expect(await kv.get(HUNT_KEY)).toBeUndefined()
    const polled = await first.world(auth, 0)
    expect('reason' in polled ? null : polled.hunt).toMatchObject({ count: 0, yours: 0 })
    const opened = (await kv.get(HUNT_KEY)) as HuntRecord
    await kv.set(HUNT_KEY, { ...opened, count: 9 })
    const again = ledger(kv, clock)
    const after = await again.world(auth, 0, { advance: false, persist: false })
    expect('reason' in after ? null : after.hunt).toMatchObject({ count: 9 })
  })

  it('the flag off hides the hunt from the snapshot and names itself in the flags', async () => {
    const kv = new MemoryKeyValue()
    const clock = { t: MONDAY + 3_600_000 }
    const off = ledger(kv, clock, { 'hunt.enabled': false })
    const m = await off.host.mint({ state: createInitialState(3), name: 'a', linked: false })
    const w = await off.world({ deviceToken: m.deviceToken }, 0)
    if ('reason' in w) throw new Error('unauthorized')
    expect(w.hunt).toBeNull()
    expect(w.flags['hunt.enabled']).toBe(false)
    expect(await kv.get(HUNT_KEY)).toBeUndefined()
  })
})
