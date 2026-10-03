import {
  createInitialState,
  type GameState,
  type Hero,
  hashState,
  heroStats,
  type Item,
  type PlayerEvent,
  replay,
  type ServerEvent,
  SIM_VERSION,
  step,
} from '@promptfall/sim'
import { describe, expect, it } from 'vitest'
import type { Auth, Bootstrap, Delivery, ServerClient } from '../client'
import type { MarketResult } from '../market'
import { type Batch, compareSemver, type TimedEvent } from '../schemas'

export type ContractClock = { now: () => Promise<number>; advance: (ms: number) => void }

/** Host privileges a contract run may use; structurally `Ledger.host`. Host rules skip without it. */
export type ContractHost = {
  mint(input: {
    state: GameState
    name: string
    linked: boolean
  }): Promise<{ accountId: string; deviceToken: string }>
  credit(accountId: string, gold: number, reason: string): Promise<void>
  settle(accountId: string): Promise<void>
  sweep(): Promise<void>
}

export type ContractMake = (
  clock: ContractClock,
  options: { flags: Record<string, boolean> },
) => Promise<{ client: ServerClient; host?: ContractHost }>

function makeClock(start = 1_700_000_000_000): ContractClock {
  let t = start
  return {
    now: async () => t,
    advance: (ms: number) => {
      t += ms
    },
  }
}

const tick: PlayerEvent = { t: 'tick' }
const EMPTY: Delivery = { cursor: 0, events: [] }

/** A client-side mirror of the engine: committed state, pending server events, cursor, seq. */
export class Mirror {
  committed: GameState
  pending: ServerEvent[] = []
  local: GameState
  cursor: number
  seq: number

  constructor(readonly boot: Bootstrap) {
    this.committed = boot.state
    this.local = boot.state
    this.cursor = boot.cursor
    this.seq = boot.seq
    this.receive(boot.delivery)
  }

  batch(events: PlayerEvent[], overrides: Partial<Batch> = {}): Batch {
    const timed: TimedEvent[] = events.map((e, i) => ({ ...e, at: 1000 + i }))
    return {
      batchId: crypto.randomUUID(),
      accountId: this.boot.account.accountId,
      seq: this.seq,
      clientVersion: this.boot.config.minClientVersion,
      simVersion: SIM_VERSION,
      cursor: this.cursor,
      baseHash: hashState(this.committed),
      resultHash: hashState(replay(this.local, events).state),
      events: timed,
      ...overrides,
    }
  }

  /** Advances the mirror as if the batch committed. */
  commit(events: PlayerEvent[]): void {
    this.committed = replay(this.local, events).state
    this.pending = []
    this.local = this.committed
    this.seq += 1
  }

  /** Applies each delivered event once. */
  receive(delivery: Delivery): void {
    for (const { n, event } of delivery.events) {
      if (n <= this.cursor) continue
      this.pending.push(event)
      this.local = step(this.local, event).state
      this.cursor = n
    }
    this.cursor = Math.max(this.cursor, delivery.cursor)
  }

  /** Adopts the state of a state-carrying refusal. */
  adopt(ack: { state: GameState; cursor: number; seq: number }): void {
    this.committed = ack.state
    this.local = ack.state
    this.pending = []
    this.cursor = ack.cursor
    this.seq = ack.seq
  }

  auth() {
    return { deviceToken: this.boot.deviceToken }
  }
}

const DAY = 86_400_000
const WEEK = 604_800_000

function rareItem(id: string, base = 'steel_longsword', patch: Partial<Item> = {}): Item {
  return { id, base, rarity: 'rare', affixes: [], equippedBy: null, tradeableAt: null, ...patch }
}

function commonItem(id: string): Item {
  return {
    id,
    base: 'iron_sword',
    rarity: 'common',
    affixes: [],
    equippedBy: null,
    tradeableAt: null,
  }
}

/** A minted trader: linked, 10,000 gold, the given inventory, and spare heroes out of the party. */
function traderState(seed: number, patch: Partial<GameState> = {}, spares: Hero[] = []): GameState {
  const s = createInitialState(seed)
  return { ...s, gold: 10_000, roster: [...s.roster, ...spares], ...patch }
}

function spareHero(seed: number, id: string, patch: Partial<Hero> = {}): Hero {
  const archer = createInitialState(seed).roster[3]
  if (!archer) throw new Error('no archer')
  return { ...archer, id, rarity: 'epic', level: 7, xp: 40, hp: 30, ...patch }
}

function ok(r: MarketResult): Delivery {
  if (!r.ok) throw new Error(`refused: ${r.reason}`)
  return r.delivery
}

function lastListing(d: Delivery): string {
  const e = d.events.at(-1)?.event
  if (e?.t !== 'listed') throw new Error('no listed event')
  return e.listingId
}

function lastOrder(d: Delivery): string {
  const e = d.events.at(-1)?.event
  if (e?.t !== 'order_placed') throw new Error('no order_placed event')
  return e.orderId
}

function lowerThan(version: string): string | null {
  return compareSemver(version, '0.0.0') > 0 ? '0.0.0' : null
}

export function runServerContract(name: string, make: ContractMake): void {
  const setup = async (flags: Record<string, boolean> = {}) => {
    const clock = makeClock()
    const { client, host } = await make(clock, { flags })
    const boot = await client.bootstrap({ clientVersion: '0.1.0', deviceToken: null })
    return { clock, client, host, boot, mirror: new Mirror(boot) }
  }

  /** A market scenario: the server, its host and a clock; skipped without a host. */
  const market = async (ctx: { skip: () => void }, flags: Record<string, boolean> = {}) => {
    const clock = makeClock()
    const { client, host } = await make(clock, { flags })
    if (!host) {
      ctx.skip()
      throw new Error('skipped')
    }
    const trader = async (name: string, state: GameState, linked = true) => {
      const m = await host.mint({ state, name, linked })
      const boot = await client.bootstrap({ clientVersion: '0.1.0', deviceToken: m.deviceToken })
      const auth: Auth = { deviceToken: m.deviceToken }
      const mirror = new Mirror(boot)
      return {
        auth,
        mirror,
        accountId: m.accountId,
        /** Applies what account() delivers. */
        async refresh() {
          const info = await client.account(auth)
          if ('reason' in info) throw new Error('unauthorized')
          mirror.receive(info.delivery)
          return info
        },
        /** A one-tick batch from the mirror commits: the mirror and the server agree. */
        async inSync() {
          const batch = mirror.batch([tick])
          const ack = await client.submit(batch, auth)
          expect(ack).toMatchObject({ ok: true, hash: batch.resultHash })
          if (ack.ok) {
            mirror.commit([tick])
            mirror.receive(ack.delivery)
          }
        },
      }
    }
    return { clock, client, host, trader }
  }

  describe(`server contract: ${name}`, () => {
    it('rule 0: rejects a batch that fails the schema', async () => {
      const { client, mirror } = await setup()
      await expect(
        client.submit({ ...mirror.batch([tick]), events: [] }, mirror.auth()),
      ).rejects.toThrow()
      const tooMany = mirror.batch(Array.from({ length: 2001 }, () => tick))
      await expect(client.submit(tooMany, mirror.auth())).rejects.toThrow()
      await expect(
        client.submit({ ...mirror.batch([tick]), baseHash: 'abc' }, mirror.auth()),
      ).rejects.toThrow()
      await expect(
        client.submit({ ...mirror.batch([tick]), batchId: 'short' }, mirror.auth()),
      ).rejects.toThrow()
    })

    it('rule 1: a null token mints an account at seq 0', async () => {
      const { boot } = await setup()
      expect(boot.deviceToken).toBeTruthy()
      expect(boot.account.accountId).toBeTruthy()
      expect(boot.seq).toBe(0)
      expect(boot.state).toEqual(createInitialState(boot.account.seed))
      expect(boot.hash).toBe(hashState(boot.state))
      expect(boot.config.simVersion).toBe(SIM_VERSION)
      expect(boot.account.linked).toBeNull()
      expect(boot.cursor).toBe(0)
      expect(boot.delivery).toEqual(EMPTY)
    })

    it('rule 2: a known token returns the same account and its progress; an unknown one mints', async () => {
      const { client, boot, mirror } = await setup()
      const events = [tick, tick, { t: 'tool_call' } as PlayerEvent]
      const ack = await client.submit(mirror.batch(events), mirror.auth())
      expect(ack.ok).toBe(true)
      mirror.commit(events)
      const again = await client.bootstrap({
        clientVersion: '0.1.0',
        deviceToken: boot.deviceToken,
      })
      expect(again.account).toEqual(boot.account)
      expect(again.seq).toBe(1)
      expect(again.hash).toBe(hashState(mirror.committed))
      expect(again.state).toEqual(mirror.committed)
      expect(again.cursor).toBe(0)
      expect(again.delivery).toEqual(EMPTY)
      const stranger = await client.bootstrap({
        clientVersion: '0.1.0',
        deviceToken: 'nobody-knows-me',
      })
      expect(stranger.account.accountId).not.toBe(boot.account.accountId)
      expect(stranger.seq).toBe(0)
    })

    it('rule 3: an unknown token is unauthorized', async () => {
      const { client, mirror } = await setup()
      const ack = await client.submit(mirror.batch([tick]), { deviceToken: 'forged-token' })
      expect(ack).toEqual({ ok: false, reason: 'unauthorized' })
    })

    it('rule 3: another account token naming this account is unauthorized', async () => {
      const { client, mirror } = await setup()
      const other = await client.bootstrap({ clientVersion: '0.1.0', deviceToken: null })
      const ack = await client.submit(mirror.batch([tick]), { deviceToken: other.deviceToken })
      expect(ack).toEqual({ ok: false, reason: 'unauthorized' })
    })

    it('rule 4: an old client is version gated and a foreign sim version is refused', async () => {
      const { client, boot, mirror } = await setup()
      const lower = lowerThan(boot.config.minClientVersion)
      if (lower) {
        const ack = await client.submit(
          mirror.batch([tick], { clientVersion: lower }),
          mirror.auth(),
        )
        expect(ack).toEqual({
          ok: false,
          reason: 'version_gate',
          minClientVersion: boot.config.minClientVersion,
        })
      }
      const sim = await client.submit(
        mirror.batch([tick], { simVersion: SIM_VERSION + 1 }),
        mirror.auth(),
      )
      expect(sim).toEqual({ ok: false, reason: 'sim_version', simVersion: SIM_VERSION })
    })

    it('rule 5: a committed batchId is a duplicate and changes nothing', async () => {
      const { client, boot, mirror } = await setup()
      const batch = mirror.batch([tick, tick])
      const first = await client.submit(batch, mirror.auth())
      expect(first).toMatchObject({ ok: true, duplicate: false, seq: 1 })
      const second = await client.submit(batch, mirror.auth())
      expect(second).toEqual({
        ok: true,
        duplicate: true,
        seq: 1,
        hash: (first as { hash: string }).hash,
        delivery: EMPTY,
      })
      const after = await client.bootstrap({
        clientVersion: '0.1.0',
        deviceToken: boot.deviceToken,
      })
      expect(after.seq).toBe(1)
    })

    it('rule 6: a wrong seq gets the authoritative state', async () => {
      const { client, boot, mirror } = await setup()
      const ack = await client.submit(mirror.batch([tick], { seq: 5 }), mirror.auth())
      expect(ack).toEqual({
        ok: false,
        reason: 'seq_mismatch',
        seq: 0,
        state: boot.state,
        hash: boot.hash,
        cursor: 0,
      })
    })

    it('rule 7: a wrong baseHash gets the authoritative state without committing', async () => {
      const { client, boot, mirror } = await setup()
      const ack = await client.submit(
        mirror.batch([tick], { baseHash: 'ffffffffffffffff' }),
        mirror.auth(),
      )
      expect(ack).toEqual({
        ok: false,
        reason: 'hash_mismatch',
        seq: 0,
        state: boot.state,
        hash: boot.hash,
        cursor: 0,
        revokedItemIds: [],
      })
      const after = await client.bootstrap({
        clientVersion: '0.1.0',
        deviceToken: boot.deviceToken,
      })
      expect(after.seq).toBe(0)
    })

    it('rule 8: 80 ticks after 10 s exceed the tick bucket', async () => {
      const { client, clock, boot, mirror } = await setup()
      clock.advance(10_000)
      const ack = await client.submit(
        mirror.batch(Array.from({ length: 80 }, () => tick)),
        mirror.auth(),
      )
      expect(ack).toEqual({
        ok: false,
        reason: 'rate_capped',
        seq: 0,
        state: boot.state,
        hash: boot.hash,
        cursor: 0,
        kind: 'tick',
      })
    })

    it('rule 8: a dry bucket caps tiny batches within the same second', async () => {
      const { client, mirror } = await setup()
      const drain = Array.from({ length: 64 }, () => tick)
      expect(await client.submit(mirror.batch(drain), mirror.auth())).toMatchObject({ ok: true })
      mirror.commit(drain)
      for (let i = 0; i < 3; i++) {
        const two = [tick, tick]
        expect(await client.submit(mirror.batch(two), mirror.auth())).toMatchObject({ ok: true })
        mirror.commit(two)
      }
      const capped = await client.submit(mirror.batch([tick, tick]), mirror.auth())
      expect(capped).toMatchObject({ ok: false, reason: 'rate_capped', kind: 'tick', seq: 4 })
    })

    it('rule 8: after 10 minutes away, 71 ticks are capped and 70 pass', async () => {
      const { client, clock, mirror } = await setup()
      const drain = Array.from({ length: 70 }, () => tick)
      expect(await client.submit(mirror.batch(drain), mirror.auth())).toMatchObject({ ok: true })
      mirror.commit(drain)
      clock.advance(10 * 60_000)
      const over = Array.from({ length: 71 }, () => tick)
      expect(await client.submit(mirror.batch(over), mirror.auth())).toMatchObject({
        ok: false,
        reason: 'rate_capped',
      })
      const exact = Array.from({ length: 70 }, () => tick)
      expect(await client.submit(mirror.batch(exact), mirror.auth())).toMatchObject({
        ok: true,
        seq: 2,
      })
    })

    it('rule 8: a steady 7 to 8 ticks per 15 s for an hour never caps', async () => {
      const { client, clock, mirror } = await setup()
      for (let i = 0; i < 240; i++) {
        clock.advance(15_000)
        const events = Array.from({ length: i % 2 === 0 ? 8 : 7 }, () => tick)
        const ack = await client.submit(mirror.batch(events), mirror.auth())
        expect({ batch: i, ok: ack.ok }).toEqual({ batch: i, ok: true })
        mirror.commit(events)
      }
    }, 60_000)

    it('rule 8: a capped batch consumes nothing', async () => {
      const { client, mirror } = await setup()
      const over = Array.from({ length: 71 }, () => tick)
      expect(await client.submit(mirror.batch(over), mirror.auth())).toMatchObject({ ok: false })
      const full = Array.from({ length: 70 }, () => tick)
      expect(await client.submit(mirror.batch(full), mirror.auth())).toMatchObject({ ok: true })
    })

    it('rule 9: a matching batch commits', async () => {
      const { client, mirror } = await setup()
      const events: PlayerEvent[] = [
        { t: 'tool_call' },
        tick,
        tick,
        { t: 'turn_end' },
        { t: 'rest' },
      ]
      const batch = mirror.batch(events)
      const ack = await client.submit(batch, mirror.auth())
      expect(ack).toEqual({
        ok: true,
        duplicate: false,
        seq: 1,
        hash: batch.resultHash,
        delivery: EMPTY,
      })
    })

    it('rule 9: a mismatching result still commits the server result and advances seq', async () => {
      const { client, boot, mirror } = await setup()
      const events = [tick, tick, tick]
      const batch = mirror.batch(events, { resultHash: '0000000000000000' })
      const ack = await client.submit(batch, mirror.auth())
      mirror.commit(events)
      expect(ack).toEqual({
        ok: false,
        reason: 'hash_mismatch',
        seq: 1,
        state: mirror.committed,
        hash: hashState(mirror.committed),
        cursor: 0,
        revokedItemIds: [],
      })
      const retry = await client.submit(batch, mirror.auth())
      expect(retry).toEqual({
        ok: true,
        duplicate: true,
        seq: 1,
        hash: hashState(mirror.committed),
        delivery: EMPTY,
      })
      const after = await client.bootstrap({
        clientVersion: '0.1.0',
        deviceToken: boot.deviceToken,
      })
      expect(after.seq).toBe(1)
    })
    it('rule 10: a cursor ahead is cursor_mismatch; one behind is cursor_behind, then commits', async (ctx) => {
      const { client, host, boot, mirror } = await setup()
      if (!host) return ctx.skip()
      const ahead = await client.submit(mirror.batch([tick], { cursor: 3 }), mirror.auth())
      expect(ahead).toEqual({
        ok: false,
        reason: 'cursor_mismatch',
        seq: 0,
        state: boot.state,
        hash: boot.hash,
        cursor: 0,
      })
      await host.credit(boot.account.accountId, 120, 'test')
      const events = [tick, tick]
      const stale = mirror.batch(events)
      const behind = await client.submit(stale, mirror.auth())
      expect(behind).toEqual({
        ok: false,
        reason: 'cursor_behind',
        delivery: {
          cursor: 1,
          events: [{ n: 1, event: { t: 'credited', gold: 120, reason: 'test' } }],
        },
      })
      const after = await client.bootstrap({
        clientVersion: '0.1.0',
        deviceToken: boot.deviceToken,
      })
      expect(after.seq).toBe(0)
      // Neither the cursor_mismatch nor the cursor_behind committed or moved the committed point.
      expect(after.state).toEqual(boot.state)
      expect(after.cursor).toBe(0)
      if (behind.ok || behind.reason !== 'cursor_behind') throw new Error('expected cursor_behind')
      mirror.receive(behind.delivery)
      const credited: ServerEvent = { t: 'credited', gold: 120, reason: 'test' }
      const resultHash = hashState(replay(boot.state, [credited, ...events]).state)
      const again = mirror.batch(events)
      expect(again.resultHash).toBe(resultHash)
      const ack = await client.submit(
        { ...stale, cursor: 1, resultHash: again.resultHash },
        mirror.auth(),
      )
      expect(ack).toEqual({
        ok: true,
        duplicate: false,
        seq: 1,
        hash: resultHash,
        delivery: { cursor: 1, events: [] },
      })
    })

    it('rule 11: a credit arrives in account() and bootstrap, which writes nothing', async (ctx) => {
      const { client, host, boot, mirror } = await setup()
      if (!host) return ctx.skip()
      await host.credit(boot.account.accountId, 75, 'gift')
      const delivery = {
        cursor: 1,
        events: [{ n: 1, event: { t: 'credited', gold: 75, reason: 'gift' } }],
      }
      const info = await client.account(mirror.auth())
      if ('reason' in info) throw new Error('unauthorized')
      expect(info.delivery).toEqual(delivery)
      expect(info.returns).toBe(0)
      for (let i = 0; i < 2; i++) {
        const again = await client.bootstrap({
          clientVersion: '0.1.0',
          deviceToken: boot.deviceToken,
        })
        expect(again.state).toEqual(boot.state)
        expect(again.hash).toBe(boot.hash)
        expect(again.cursor).toBe(0)
        expect(again.seq).toBe(0)
        expect(again.delivery).toEqual(delivery)
      }
      mirror.receive(info.delivery)
      expect(mirror.local.gold).toBe(boot.state.gold + 75)
      const events = [tick, { t: 'tool_call' } as PlayerEvent]
      const batch = mirror.batch(events)
      expect(batch.cursor).toBe(1)
      const ack = await client.submit(batch, mirror.auth())
      expect(ack).toMatchObject({ ok: true, hash: batch.resultHash })
      mirror.commit(events)
      const later = await client.account(mirror.auth())
      if ('reason' in later) throw new Error('unauthorized')
      expect(later.delivery).toEqual({ cursor: 1, events: [] })
      const boot2 = await client.bootstrap({
        clientVersion: '0.1.0',
        deviceToken: boot.deviceToken,
      })
      expect(boot2.state).toEqual(mirror.committed)
      expect(boot2.cursor).toBe(1)
    })

    it('rule 12: duplicates carry the current delivery; a repeated delivery applies once', async (ctx) => {
      const { client, host, boot, mirror } = await setup()
      if (!host) return ctx.skip()
      const events = [tick]
      const batch = mirror.batch(events)
      expect(await client.submit(batch, mirror.auth())).toMatchObject({ ok: true })
      mirror.commit(events)
      await host.credit(boot.account.accountId, 10, 'a')
      await host.credit(boot.account.accountId, 20, 'b')
      const dup = await client.submit(batch, mirror.auth())
      const delivery = {
        cursor: 2,
        events: [
          { n: 1, event: { t: 'credited', gold: 10, reason: 'a' } },
          { n: 2, event: { t: 'credited', gold: 20, reason: 'b' } },
        ],
      }
      expect(dup).toEqual({ ok: true, duplicate: true, seq: 1, hash: batch.resultHash, delivery })
      const info = await client.account(mirror.auth())
      if ('reason' in info) throw new Error('unauthorized')
      expect(info.delivery).toEqual(delivery)
      if (!dup.ok) throw new Error('expected ok')
      mirror.receive(dup.delivery)
      mirror.receive(info.delivery)
      expect(mirror.local.gold).toBe(mirror.committed.gold + 30)
      const next = mirror.batch([tick])
      const ack = await client.submit(next, mirror.auth())
      expect(ack).toMatchObject({ ok: true, duplicate: false, seq: 2, hash: next.resultHash })
    })

    it('rule 13: the link flow approves the caller only', async () => {
      const { client, mirror } = await setup()
      const start = await client.linkStart(mirror.auth())
      if ('reason' in start) throw new Error('unauthorized')
      expect(start.code).toMatch(/^[0-9A-Z]{8}$/)
      expect(start.url).toBe('https://github.com/login/device')
      expect(start.intervalMs).toBe(5000)
      const other = await client.bootstrap({ clientVersion: '0.1.0', deviceToken: null })
      expect(await client.linkPoll({ deviceToken: other.deviceToken }, start.code)).toEqual({
        status: 'pending',
      })
      expect(await client.linkPoll(mirror.auth(), 'NOSUCH00')).toEqual({ status: 'pending' })
      const polled = await client.linkPoll(mirror.auth(), start.code)
      if ('reason' in polled || polled.status !== 'linked') throw new Error('expected linked')
      expect(polled.account.linked?.provider).toBe('github')
      expect(polled.account.linked?.login).toBeTruthy()
      const info = await client.account(mirror.auth())
      if ('reason' in info) throw new Error('unauthorized')
      expect(info.account.linked).toEqual(polled.account.linked)
      expect(info.account.displayName).toBe(polled.account.linked?.login)
    })
    it('rule 14: what cannot be listed', async (ctx) => {
      const { client, trader } = await market(ctx)
      const s = traderState(31, {}, [])
      const knight = s.roster[0]
      if (!knight) throw new Error('no knight')
      const a = await trader('Ann', {
        ...s,
        inventory: [
          commonItem('iC'),
          rareItem('iE', 'steel_longsword', { equippedBy: knight.id }),
          rareItem('iR'),
        ],
        roster: s.roster.map((h) =>
          h.id === knight.id ? { ...h, equipment: { ...h.equipment, weapon: 'iE' } } : h,
        ),
      })
      const list = (kind: 'item' | 'hero', id: string, price: number) =>
        client.list(a.auth, { kind, id, price })
      expect(await list('item', 'iC', 100)).toEqual({ ok: false, reason: 'not_tradeable_rarity' })
      expect(await list('item', 'iE', 100)).toEqual({ ok: false, reason: 'equipped' })
      expect(await list('hero', s.party[1], 100)).toMatchObject({ ok: false })
      expect(await list('item', 'iR', 0)).toEqual({ ok: false, reason: 'bad_price' })
      expect(await list('item', 'iR', 1_000_001)).toEqual({ ok: false, reason: 'bad_price' })
      expect(await list('item', 'inope', 100)).toEqual({ ok: false, reason: 'unknown_goods' })
      expect(await list('hero', 'hnope', 100)).toEqual({ ok: false, reason: 'unknown_goods' })
      await a.inSync()
    })

    it('rule 14: a hero in the party cannot be listed', async (ctx) => {
      const { client, trader } = await market(ctx)
      const s = traderState(32)
      const rareKnight = { ...(s.roster[0] as Hero), rarity: 'rare' as const }
      const a = await trader('Ann', { ...s, roster: [rareKnight, ...s.roster.slice(1)] })
      expect(await client.list(a.auth, { kind: 'hero', id: rareKnight.id, price: 100 })).toEqual({
        ok: false,
        reason: 'in_party',
      })
    })

    it('rule 15: listing removes the goods, charges the fee, and browse shows it', async (ctx) => {
      const { client, trader } = await market(ctx)
      const a = await trader('Ann', traderState(33, { inventory: [rareItem('iR')] }))
      const d = ok(await client.list(a.auth, { kind: 'item', id: 'iR', price: 4999 }))
      a.mirror.receive(d)
      expect(a.mirror.local.inventory).toEqual([])
      expect(a.mirror.local.gold).toBe(10_000 - 99)
      const page = await client.browse(a.auth, { kind: 'item', sort: 'newest', page: 0 })
      if ('reason' in page) throw new Error('unauthorized')
      expect(page.total).toBe(1)
      expect(page.listings[0]).toMatchObject({
        id: lastListing(d),
        sellerName: 'Ann',
        price: 4999,
        goods: { kind: 'item', item: rareItem('iR') },
      })
      await a.inSync()
    })

    it('rule 16: a purchase moves the goods with a t id and a cooldown, and pays the seller', async (ctx) => {
      const { client, clock, trader } = await market(ctx)
      const a = await trader('Ann', traderState(34, { inventory: [rareItem('iR')] }))
      const b = await trader('Bob', traderState(35))
      const id = lastListing(ok(await client.list(a.auth, { kind: 'item', id: 'iR', price: 1000 })))
      const now = await clock.now()
      const bought = ok(await client.buy(b.auth, id))
      b.mirror.receive(bought)
      const item = b.mirror.local.inventory.at(-1)
      expect(item?.id.startsWith('t')).toBe(true)
      expect(item?.tradeableAt).toBe(now + DAY)
      expect(b.mirror.local.gold).toBe(10_000 - 1000)
      await a.refresh()
      expect(a.mirror.local.gold).toBe(10_000 - 20 + 950)
      await a.inSync()
      await b.inSync()
      expect(await client.buy(b.auth, id)).toEqual({ ok: false, reason: 'gone' })
    })

    it('rule 17: self trade, not enough gold, no space', async (ctx) => {
      const { client, trader } = await market(ctx)
      const a = await trader('Ann', traderState(36, { inventory: [rareItem('iR')] }))
      const poor = await trader('Pip', traderState(37, { gold: 10 }))
      const full = await trader(
        'Ful',
        traderState(38, { inventory: [rareItem('iF')], inventoryCap: 1 }),
      )
      const id = lastListing(ok(await client.list(a.auth, { kind: 'item', id: 'iR', price: 500 })))
      expect(await client.buy(a.auth, id)).toEqual({ ok: false, reason: 'self_trade' })
      expect(await client.buy(poor.auth, id)).toEqual({ ok: false, reason: 'not_enough_gold' })
      expect(await client.buy(full.auth, id)).toEqual({ ok: false, reason: 'no_space' })
      const page = await client.browse(a.auth, { kind: 'item', sort: 'price', page: 0 })
      expect(page).toMatchObject({ total: 1 })
    })

    it('rule 18: cancel returns the goods, or queues them, and a freed slot delivers', async (ctx) => {
      const { client, trader } = await market(ctx)
      const a = await trader(
        'Ann',
        traderState(39, {
          inventory: [rareItem('iA'), rareItem('iB'), commonItem('iC')],
          inventoryCap: 3,
        }),
      )
      const b = await trader('Bob', traderState(40, { inventory: [rareItem('iX')] }))
      const first = lastListing(
        ok(await client.list(a.auth, { kind: 'item', id: 'iB', price: 300 })),
      )
      const back = ok(await client.cancelListing(a.auth, first))
      a.mirror.receive(back)
      expect(a.mirror.local.inventory.map((i) => i.id)).toContain('iB')

      const listed = ok(await client.list(a.auth, { kind: 'item', id: 'iA', price: 300 }))
      a.mirror.receive(listed)
      const other = lastListing(
        ok(await client.list(b.auth, { kind: 'item', id: 'iX', price: 100 })),
      )
      a.mirror.receive(ok(await client.buy(a.auth, other)))
      expect(a.mirror.local.inventory).toHaveLength(3)
      a.mirror.receive(ok(await client.cancelListing(a.auth, lastListing(listed))))
      const info = await a.refresh()
      expect(info.returns).toBe(1)
      const events: PlayerEvent[] = [{ t: 'vendor', itemId: 'iC' }]
      const batch = a.mirror.batch(events)
      const ack = await client.submit(batch, a.auth)
      if (!ack.ok) throw new Error(`refused: ${ack.reason}`)
      a.mirror.commit(events)
      expect(ack.delivery.events.map((e) => e.event.t)).toEqual(['returned'])
      a.mirror.receive(ack.delivery)
      expect(a.mirror.local.inventory.map((i) => i.id)).toContain('iA')
      expect((await a.refresh()).returns).toBe(0)
      await a.inSync()
    })

    it('rule 18: a cancel after a sale is gone', async (ctx) => {
      const { client, trader } = await market(ctx)
      const a = await trader('Ann', traderState(41, { inventory: [rareItem('iA')] }))
      const b = await trader('Bob', traderState(42))
      const id = lastListing(ok(await client.list(a.auth, { kind: 'item', id: 'iA', price: 100 })))
      ok(await client.buy(b.auth, id))
      expect(await client.cancelListing(a.auth, id)).toEqual({ ok: false, reason: 'gone' })
    })

    it('rule 19: listings and orders expire at exactly 7 days, with no sweep', async (ctx) => {
      const { client, clock, trader } = await market(ctx)
      const a = await trader('Ann', traderState(43, { inventory: [rareItem('iA')] }))
      a.mirror.receive(ok(await client.list(a.auth, { kind: 'item', id: 'iA', price: 100 })))
      a.mirror.receive(
        ok(
          await client.placeOrder(a.auth, {
            base: 'steel_longsword',
            minRarity: 'rare',
            affixId: null,
            maxPrice: 700,
          }),
        ),
      )
      expect(a.mirror.local.gold).toBe(10_000 - 2 - 700)
      clock.advance(WEEK)
      const page = await client.browse(a.auth, { kind: 'item', sort: 'newest', page: 0 })
      expect(page).toMatchObject({ total: 0, listings: [] })
      await a.refresh()
      expect(a.mirror.local.inventory.map((i) => i.id)).toEqual(['iA'])
      expect(a.mirror.local.gold).toBe(10_000 - 2)
      const mine = await client.myOrders(a.auth)
      expect(mine).toMatchObject({ listings: [], orders: [], returns: 0 })
      await a.inSync()
    })

    it('rule 20: a bought item cannot be relisted before 24 hours, and can at exactly tradeableAt', async (ctx) => {
      const { client, clock, trader } = await market(ctx)
      const a = await trader('Ann', traderState(44, { inventory: [rareItem('iA')] }))
      const b = await trader('Bob', traderState(45))
      const id = lastListing(ok(await client.list(a.auth, { kind: 'item', id: 'iA', price: 100 })))
      b.mirror.receive(ok(await client.buy(b.auth, id)))
      const item = b.mirror.local.inventory.at(-1)
      if (!item) throw new Error('no item')
      expect(await client.list(b.auth, { kind: 'item', id: item.id, price: 100 })).toEqual({
        ok: false,
        reason: 'in_cooldown',
      })
      clock.advance(DAY - 1)
      expect(await client.list(b.auth, { kind: 'item', id: item.id, price: 100 })).toMatchObject({
        ok: false,
        reason: 'in_cooldown',
      })
      clock.advance(1)
      const relisted = await client.list(b.auth, { kind: 'item', id: item.id, price: 100 })
      expect(relisted).toMatchObject({ ok: true })
    })

    it('rule 21: a sold hero arrives at level 1; one with gear cannot be listed; a cancelled one keeps its level', async (ctx) => {
      const { client, trader } = await market(ctx)
      const vet = spareHero(46, 'hvet')
      const kept = spareHero(46, 'hkept', { level: 7 })
      const geared = spareHero(46, 'hgear', {
        equipment: { weapon: 'iW', armour: null, accessory: null },
      })
      const a = await trader(
        'Ann',
        traderState(
          46,
          { inventory: [rareItem('iW', 'steel_longsword', { equippedBy: 'hgear' })] },
          [vet, kept, geared],
        ),
      )
      const b = await trader('Bob', traderState(47))
      expect(await client.list(a.auth, { kind: 'hero', id: 'hgear', price: 100 })).toEqual({
        ok: false,
        reason: 'equipped',
      })
      const id = lastListing(
        ok(await client.list(a.auth, { kind: 'hero', id: 'hvet', price: 2000 })),
      )
      b.mirror.receive(ok(await client.buy(b.auth, id)))
      const arrived = b.mirror.local.roster.at(-1)
      if (!arrived) throw new Error('no hero')
      expect(arrived.id.startsWith('t')).toBe(true)
      expect(arrived).toMatchObject({ level: 1, xp: 0, rarity: 'epic', traits: vet.traits })
      expect(arrived.equipment).toEqual({ weapon: null, armour: null, accessory: null })
      expect(arrived.hp).toBe(heroStats(b.mirror.local, arrived).hp)
      const back = lastListing(
        ok(await client.list(a.auth, { kind: 'hero', id: 'hkept', price: 2000 })),
      )
      await a.refresh()
      a.mirror.receive(ok(await client.cancelListing(a.auth, back)))
      expect(a.mirror.local.roster.find((h) => h.id === 'hkept')).toEqual(kept)
      await a.inSync()
      await b.inSync()
    })

    it('rule 22: an order escrows its max price and a cancel refunds it', async (ctx) => {
      const { client, trader } = await market(ctx)
      const a = await trader('Ann', traderState(48))
      const order = {
        base: 'steel_longsword',
        minRarity: 'rare' as const,
        affixId: null,
        maxPrice: 900,
      }
      const placed = ok(await client.placeOrder(a.auth, order))
      a.mirror.receive(placed)
      expect(a.mirror.local.gold).toBe(10_000 - 900)
      a.mirror.receive(ok(await client.cancelOrder(a.auth, lastOrder(placed))))
      expect(a.mirror.local.gold).toBe(10_000)
      expect(await client.placeOrder(a.auth, { ...order, minRarity: 'common' })).toEqual({
        ok: false,
        reason: 'not_tradeable_rarity',
      })
      await a.inSync()
    })

    it('rule 23: matching orders and fills', async (ctx) => {
      const { client, trader } = await market(ctx)
      const buyer = await trader('Bea', traderState(49))
      const seller = await trader(
        'Sam',
        traderState(50, {
          inventory: [
            rareItem('iS'),
            rareItem('iO', 'iron_sword'),
            rareItem('iB', 'steel_longsword', { affixes: [{ id: 'brutal', value: 3 }] }),
          ],
        }),
      )
      const plain = {
        base: 'steel_longsword',
        minRarity: 'rare' as const,
        affixId: null,
        maxPrice: 300,
      }
      const best = lastOrder(ok(await client.placeOrder(buyer.auth, plain)))
      buyer.mirror.receive(
        await (async () => {
          const info = await client.account(buyer.auth)
          if ('reason' in info) throw new Error('unauthorized')
          return info.delivery
        })(),
      )
      ok(await client.placeOrder(buyer.auth, { ...plain, minRarity: 'epic', maxPrice: 900 }))
      const brutal = lastOrder(
        ok(await client.placeOrder(buyer.auth, { ...plain, affixId: 'brutal', maxPrice: 500 })),
      )
      ok(await client.placeOrder(seller.auth, { ...plain, maxPrice: 1000 }))
      const forPlain = await client.matchingOrders(seller.auth, 'iS')
      if ('reason' in forPlain) throw new Error('unauthorized')
      expect(forPlain.map((o) => o.id)).toEqual([best])
      const forBrutal = await client.matchingOrders(seller.auth, 'iB')
      if ('reason' in forBrutal) throw new Error('unauthorized')
      expect(forBrutal.map((o) => o.id)).toEqual([brutal, best])
      expect(await client.fillOrder(seller.auth, best, 'iO')).toEqual({
        ok: false,
        reason: 'no_match',
      })
      seller.mirror.receive(ok(await client.fillOrder(seller.auth, best, 'iS')))
      expect(seller.mirror.local.inventory.map((i) => i.id)).not.toContain('iS')
      expect(seller.mirror.local.gold).toBe(10_000 - 1000 + 285)
      await buyer.refresh()
      expect(buyer.mirror.local.inventory.at(-1)?.base).toBe('steel_longsword')
      const mine = await client.myOrders(buyer.auth)
      if ('reason' in mine) throw new Error('unauthorized')
      expect(mine.orders.map((o) => o.id)).not.toContain(best)
      await buyer.inSync()
      await seller.inSync()
    })

    it('rule 23: a fill into a full inventory is no_space and the order stays open', async (ctx) => {
      const { client, trader } = await market(ctx)
      const buyer = await trader(
        'Bea',
        traderState(51, { inventory: [commonItem('iF')], inventoryCap: 1 }),
      )
      const seller = await trader('Sam', traderState(52, { inventory: [rareItem('iS')] }))
      const id = lastOrder(
        ok(
          await client.placeOrder(buyer.auth, {
            base: 'steel_longsword',
            minRarity: 'rare',
            affixId: null,
            maxPrice: 300,
          }),
        ),
      )
      expect(await client.fillOrder(seller.auth, id, 'iS')).toEqual({
        ok: false,
        reason: 'no_space',
      })
      const mine = await client.myOrders(buyer.auth)
      if ('reason' in mine) throw new Error('unauthorized')
      expect(mine.orders.map((o) => o.id)).toEqual([id])
    })

    it('rule 24: a closed market refuses trades but not cancels or browsing', async (ctx) => {
      const { client, trader } = await market(ctx, { 'market.enabled': false })
      const a = await trader('Ann', traderState(53, { inventory: [rareItem('iA')] }))
      const order = {
        base: 'steel_longsword',
        minRarity: 'rare' as const,
        affixId: null,
        maxPrice: 300,
      }
      const closed = { ok: false, reason: 'market_closed' }
      expect(await client.list(a.auth, { kind: 'item', id: 'iA', price: 100 })).toEqual(closed)
      expect(await client.buy(a.auth, 'L0')).toEqual({ ok: false, reason: 'gone' })
      expect(await client.placeOrder(a.auth, order)).toEqual(closed)
      expect(await client.fillOrder(a.auth, 'O0', 'iA')).toEqual({ ok: false, reason: 'gone' })
      expect(await client.cancelListing(a.auth, 'L0')).toEqual({ ok: false, reason: 'gone' })
      expect(await client.cancelOrder(a.auth, 'O0')).toEqual({ ok: false, reason: 'gone' })
      expect(await client.browse(a.auth, { kind: 'item', sort: 'price', page: 0 })).toEqual({
        listings: [],
        page: 0,
        total: 0,
      })
      const info = await client.account(a.auth)
      if ('reason' in info) throw new Error('unauthorized')
      expect(info.config.flags['market.enabled']).toBe(false)
    })

    it('rule 24: an unlinked account cannot trade', async (ctx) => {
      const { client, trader } = await market(ctx)
      const a = await trader('Ann', traderState(54, { inventory: [rareItem('iA')] }))
      const u = await trader('Una', traderState(55, { inventory: [rareItem('iU')] }), false)
      const listing = lastListing(
        ok(await client.list(a.auth, { kind: 'item', id: 'iA', price: 100 })),
      )
      const order = lastOrder(
        ok(
          await client.placeOrder(a.auth, {
            base: 'steel_longsword',
            minRarity: 'rare',
            affixId: null,
            maxPrice: 300,
          }),
        ),
      )
      const no = { ok: false, reason: 'not_linked' }
      expect(await client.list(u.auth, { kind: 'item', id: 'iU', price: 100 })).toEqual(no)
      expect(await client.buy(u.auth, listing)).toEqual(no)
      expect(
        await client.placeOrder(u.auth, {
          base: 'steel_longsword',
          minRarity: 'rare',
          affixId: null,
          maxPrice: 300,
        }),
      ).toEqual(no)
      expect(await client.fillOrder(u.auth, order, 'iU')).toEqual(no)
    })
  })
}
