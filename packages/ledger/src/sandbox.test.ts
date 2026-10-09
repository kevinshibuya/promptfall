import { BOSS_GRID_MS, BOSS_WINDOW_MS, MemoryKeyValue } from '@promptfall/protocol'
import { createInitialState, type GameState, type SandboxEvent } from '@promptfall/sim'
import { describe, expect, it } from 'vitest'
import { type AccountRecord, Books, TrackedKeyValue } from './books'
import { advanceBoss, BOSS_KEY, type BossRecord, loadBoss, settleBoss } from './boss'
import { Ledger, type LedgerFlag } from './ledger'
import type { WorldContext } from './world'

const GRID = 1_700_006_400_000 // a grid point, as in the world-boss tests
const ON = { 'sandbox.enabled': true } as const

function ledgerAt(start: number, flags: Partial<Record<LedgerFlag, boolean>> = {}) {
  let t = start
  let n = 0
  const kv = new MemoryKeyValue()
  const ledger = new Ledger({
    kv,
    now: async () => t,
    minClientVersion: '0.1.0',
    seedSource: () => 7,
    tokenSource: () => `tok-${n++}`,
    linkApprover: async () => ({ login: 'player' }),
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

async function record(kv: MemoryKeyValue, accountId: string): Promise<AccountRecord> {
  return (await kv.get(`pf:acct:${accountId}:record`)) as AccountRecord
}

const kinds = (r: AccountRecord) => r.log.map((e) => e.event.t)

describe('the sandbox flag', () => {
  it('defaults to off in the resolved flags', async () => {
    const { ledger } = ledgerAt(GRID)
    const boot = await ledger.bootstrap({ clientVersion: '0.1.0', deviceToken: null })
    expect(boot.config.flags['sandbox.enabled']).toBe(false)
    const on = ledgerAt(GRID, ON)
    const booted = await on.ledger.bootstrap({ clientVersion: '0.1.0', deviceToken: null })
    expect(booted.config.flags['sandbox.enabled']).toBe(true)
  })
})

describe('host.sandbox', () => {
  const zone2: SandboxEvent = { t: 'sandbox_zone', zone: 2 }

  it('with the flag off answers sandbox_off and leaves the record untouched', async () => {
    const { ledger, kv } = ledgerAt(GRID)
    const boot = await ledger.bootstrap({ clientVersion: '0.1.0', deviceToken: null })
    const before = await record(kv, boot.account.accountId)
    expect(await ledger.host.sandbox(boot.account.accountId, zone2)).toEqual({
      ok: false,
      reason: 'sandbox_off',
    })
    expect(await record(kv, boot.account.accountId)).toEqual(before)
  })

  it('sandbox off answers a refusal before anything else', async () => {
    const { ledger } = ledgerAt(GRID)
    const off = { ok: false, reason: 'sandbox_off' }
    // An unknown account and a non-sandbox event would throw with the flag on.
    expect(await ledger.host.sandbox('nobody', zone2)).toEqual(off)
    const notSandbox = { t: 'credited', gold: 1, reason: 'x' } as unknown as SandboxEvent
    const boot = await ledger.bootstrap({ clientVersion: '0.1.0', deviceToken: null })
    expect(await ledger.host.sandbox(boot.account.accountId, notSandbox)).toEqual(off)
    expect(await ledger.host.sandbox(boot.account.accountId, {} as SandboxEvent)).toEqual(off)
    expect(await ledger.host.spawnBoss()).toEqual(off)
    expect(await ledger.host.settleBoss()).toEqual(off)
  })

  it('with the flag on authors the event onto the log, and the next delivery carries it', async () => {
    const { ledger, kv } = ledgerAt(GRID, ON)
    const boot = await ledger.bootstrap({ clientVersion: '0.1.0', deviceToken: null })
    const id = boot.account.accountId
    expect(await ledger.host.sandbox(id, zone2)).toEqual({ ok: true })
    const r = await record(kv, id)
    expect(r.state.zone).toBe(2)
    expect(r.committedState).toEqual(boot.state)
    expect(r.cursor).toBe(1)
    expect(r.committedCursor).toBe(0)
    expect(r.log).toEqual([{ n: 1, event: zone2 }])
    const again = await ledger.bootstrap({ clientVersion: '0.1.0', deviceToken: boot.deviceToken })
    expect(again.delivery).toEqual({ cursor: 1, events: [{ n: 1, event: zone2 }] })
  })

  it('an event the sim finds unapplicable answers its reason and stores nothing', async () => {
    const { ledger, kv } = ledgerAt(GRID, ON)
    const start = createInitialState(3)
    const full: GameState = { ...start, rosterCap: start.roster.length }
    const m = await ledger.host.mint({ state: full, name: 'Ann', linked: false })
    const before = await record(kv, m.accountId)
    expect(
      await ledger.host.sandbox(m.accountId, { t: 'sandbox_recruit', rarity: 'epic' }),
    ).toEqual({ ok: false, reason: 'unapplicable', detail: 'roster_full' })
    expect(await record(kv, m.accountId)).toEqual(before)
  })

  it('throws on an unknown account', async () => {
    const { ledger, kv } = ledgerAt(GRID, ON)
    const keys = kv.keys().length
    await expect(ledger.host.sandbox('nobody', zone2)).rejects.toThrow()
    expect(kv.keys().length).toBe(keys)
  })

  it('throws on anything that is not one of the six kinds, before anything is stored', async () => {
    const { ledger, kv } = ledgerAt(GRID, ON)
    const boot = await ledger.bootstrap({ clientVersion: '0.1.0', deviceToken: null })
    const id = boot.account.accountId
    const before = await record(kv, id)
    const bad = [
      { t: 'credited', gold: 5, reason: 'x' },
      { t: 'sandbox_zone' },
      { t: 'sandbox_level', heroId: 'h1', level: 1.5 },
      { t: 'bogus' },
      null,
    ]
    for (const event of bad) {
      await expect(ledger.host.sandbox(id, event as unknown as SandboxEvent)).rejects.toThrow()
    }
    expect(await record(kv, id)).toEqual(before)
  })
})

describe('the world boss on demand', () => {
  /** An account online at the grid point: its poll a second before stamps its presence. */
  async function onlineAtGrid(flags: Partial<Record<LedgerFlag, boolean>> = ON) {
    const at = ledgerAt(GRID - 1_000, flags)
    const m = await at.ledger.host.mint({ state: createInitialState(5), name: 'Ann', linked: true })
    const auth = { deviceToken: m.deviceToken }
    await at.ledger.world(auth, 0)
    at.advance(1_000)
    return { ...at, accountId: m.accountId, auth }
  }

  it('spawns a boss now, engages the online, survives the grid, and settles paid and down', async () => {
    const { ledger, kv, advance, accountId, auth } = await onlineAtGrid()
    expect(await ledger.host.spawnBoss()).toEqual({ ok: true })
    const spawned = (await kv.get(BOSS_KEY)) as BossRecord
    expect(spawned).toMatchObject({ spawnedAt: GRID, endsAt: GRID + BOSS_WINDOW_MS, closed: false })
    expect(spawned.bossId).not.toMatch(/^wb/)
    expect(kinds(await record(kv, accountId))).toEqual(['boss_engaged'])

    // The grid's own advance, through a poll and a sweep inside its window, leaves it open.
    advance(1_000)
    const polled = await ledger.world(auth, 0)
    if ('reason' in polled) throw new Error('unauthorized')
    expect(polled.boss).toMatchObject({ bossId: spawned.bossId, hp: spawned.maxHp })
    await ledger.host.sweep()
    expect(await kv.get(BOSS_KEY)).toEqual(spawned)

    expect(await ledger.host.settleBoss()).toEqual({ ok: true })
    const r = await record(kv, accountId)
    expect(r.log.map((e) => e.event)).toEqual([
      expect.objectContaining({ t: 'boss_engaged', bossId: spawned.bossId }),
      expect.objectContaining({ t: 'rewarded', bossId: spawned.bossId }),
      { t: 'boss_disengaged', bossId: spawned.bossId },
    ])
    expect(r.state.boss).toBeNull()
    const down = await ledger.world(auth, 0)
    if ('reason' in down) throw new Error('unauthorized')
    expect(down.boss).toMatchObject({ bossId: spawned.bossId, hp: 0 })
  })

  it('spawnBoss answers boss_live while one is open; settleBoss answers no_boss with none', async () => {
    const { ledger, kv } = await onlineAtGrid()
    expect(await ledger.host.settleBoss()).toEqual({ ok: false, reason: 'no_boss' })
    await ledger.host.spawnBoss()
    const open = await kv.get(BOSS_KEY)
    expect(await ledger.host.spawnBoss()).toEqual({ ok: false, reason: 'boss_live' })
    expect(await kv.get(BOSS_KEY)).toEqual(open)
    await ledger.host.settleBoss()
    expect(await ledger.host.settleBoss()).toEqual({ ok: false, reason: 'no_boss' })
    // A settled boss no longer blocks the next one.
    expect(await ledger.host.spawnBoss()).toEqual({ ok: true })
  })

  it('a grid boss open at the point answers boss_live too', async () => {
    const { ledger, advance, auth } = await onlineAtGrid()
    advance(1_000)
    await ledger.world(auth, 0)
    expect(await ledger.host.spawnBoss()).toEqual({ ok: false, reason: 'boss_live' })
  })

  it('with the flag off both answer sandbox_off and change nothing', async () => {
    const { ledger, kv, accountId } = await onlineAtGrid({})
    const before = await record(kv, accountId)
    expect(await ledger.host.spawnBoss()).toEqual({ ok: false, reason: 'sandbox_off' })
    expect(await ledger.host.settleBoss()).toEqual({ ok: false, reason: 'sandbox_off' })
    expect(await kv.get(BOSS_KEY)).toBeUndefined()
    expect(await record(kv, accountId)).toEqual(before)
  })
})

describe('the grid beside the sandbox', () => {
  function context(now: number): WorldContext {
    return {
      books: new Books(new TrackedKeyValue(new MemoryKeyValue())),
      now,
      flags: {},
      presence: new Map(),
      ttl: 45_000,
      speed: 1,
      seedSource: () => 7,
      log: () => undefined,
    }
  }

  it('does not spawn a grid point again after its boss was killed inside the window', async () => {
    const ctx = context(GRID + 1_000)
    await advanceBoss(ctx)
    const grid = await loadBoss(ctx.books.kv)
    if (!grid) throw new Error('no grid boss')
    await settleBoss(ctx, { ...grid, hp: 0 }, { expired: false, inHand: null })
    // A sandbox boss spawned and settled since replaces the stored record.
    const sandbox: BossRecord = {
      ...grid,
      bossId: 'sb0',
      spawnedAt: ctx.now,
      endsAt: ctx.now + BOSS_WINDOW_MS,
      hp: 0,
      closed: true,
    }
    await ctx.books.kv.set(BOSS_KEY, sandbox)
    for (const at of [GRID + 2_000, GRID + BOSS_WINDOW_MS - 1]) {
      await advanceBoss({ ...ctx, now: at })
      expect(await loadBoss(ctx.books.kv)).toEqual(sandbox)
    }
  })

  it('the next grid point still spawns once the stored boss has ended', async () => {
    const ctx = context(GRID + 1_000)
    await ctx.books.kv.set(BOSS_KEY, {
      bossId: 'sb0',
      name: 'x',
      glyph: '☠',
      spawnedAt: GRID,
      endsAt: GRID + BOSS_WINDOW_MS,
      maxHp: 1,
      hp: 0,
      contributions: {},
      closed: true,
    } satisfies BossRecord)
    const next = GRID + BOSS_GRID_MS + 1_000
    await advanceBoss({ ...ctx, now: next })
    expect(await loadBoss(ctx.books.kv)).toMatchObject({
      bossId: `wb${(GRID / BOSS_GRID_MS + 1).toString(36)}`,
      closed: false,
    })
  })
})
