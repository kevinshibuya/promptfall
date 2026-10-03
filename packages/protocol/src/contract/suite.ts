import {
  content,
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
} from '@promptfall/sim'
import { describe, expect, it } from 'vitest'
import type { Auth, BatchAck, Delivery, ServerClient } from '../client'
import { type KeyValue, MemoryKeyValue } from '../kv'
import type { MarketResult } from '../market'
import { Mirror } from '../mirror'
import { compareSemver } from '../schemas'
import {
  BOARD_ROWS,
  BOSS_BASE_HP,
  BOSS_GRID_MS,
  BOSS_THRESHOLD_BP,
  BOSS_WINDOW_MS,
  CHAT_BUCKET_CAPACITY,
  CHAT_KEEP,
  CHAT_MAX_CHARS,
  CHAT_REFILL_MS,
  CHAT_SERVE,
  type ChatMessage,
  type ChatResult,
  PRESENCE_TTL_MS,
  type WorldSnapshot,
  WorldSnapshotSchema,
  weekStartOf,
} from '../world'

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
  /** `kv`: a store shared between two hosts (rule 40); a fresh one when absent. */
  options: { flags: Record<string, boolean>; kv?: KeyValue },
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

async function snapshot(client: ServerClient, auth: Auth, since = 0): Promise<WorldSnapshot> {
  const w = await client.world(auth, since)
  if ('reason' in w) throw new Error('unauthorized')
  return w
}

function posted(r: ChatResult): ChatMessage {
  if (!r.ok) throw new Error(`refused: ${r.reason}`)
  return r.message
}

async function boards(client: ServerClient, auth: Auth) {
  const b = await client.leaderboards(auth)
  if ('reason' in b) throw new Error('unauthorized')
  return b
}

const CLOCK_START = 1_700_000_000_000
/** The first grid point after the suite's clock start, which is 73 minutes past one (and its window). */
const NEXT_GRID = CLOCK_START + BOSS_GRID_MS - (CLOCK_START % BOSS_GRID_MS)
const bossIdAt = (t: number) => `wb${Math.floor(t / BOSS_GRID_MS).toString(36)}`
const ZONE1_BOSS = content.enemies[content.zones[0]?.boss ?? '']?.stats

/** A minted trader whose party is level 40 at full HP: about 240 a tick on the zone 1 world boss. */
function strongState(seed: number, patch: Partial<GameState> = {}): GameState {
  const s = traderState(seed, { gold: 50_000, ...patch })
  const leveled = {
    ...s,
    roster: s.roster.map((h) => (s.party.includes(h.id) ? { ...h, level: 40 } : h)),
  }
  return {
    ...leveled,
    roster: leveled.roster.map((h) =>
      s.party.includes(h.id) ? { ...h, hp: heroStats(leveled, h).hp } : h,
    ),
  }
}

const kindsOf = (d: Delivery) => d.events.map((e) => e.event.t)
const eventsOf = <K extends ServerEvent['t']>(d: Delivery, t: K) =>
  d.events.map((e) => e.event).filter((e): e is Extract<ServerEvent, { t: K }> => e.t === t)

type Trader = { auth: Auth; mirror: Mirror; accountId: string; refresh(): Promise<unknown> }

/** Commits `n` ticks from the mirror; answers the ack and what the batch dealt to the boss. */
async function commitTicks(
  client: ServerClient,
  t: Trader,
  n: number,
): Promise<{ ack: BatchAck; dealt: number }> {
  const events = Array.from({ length: n }, () => tick)
  const before = t.mirror.local.boss?.dealt ?? 0
  const dealt = (replay(t.mirror.local, events).state.boss?.dealt ?? before) - before
  const batch = t.mirror.batch(events)
  const ack = await client.submit(batch, t.auth)
  expect(ack).toMatchObject({ ok: true, hash: batch.resultHash })
  if (ack.ok) {
    t.mirror.commit(events)
    t.mirror.receive(ack.delivery)
  }
  return { ack, dealt }
}

/** Stamps every trader present just before the grid point, crosses it, polls the first: the spawn. */
async function spawn(client: ServerClient, clock: ContractClock, traders: Trader[]) {
  clock.advance(NEXT_GRID - 10_000 - (await clock.now()))
  for (const t of traders) await snapshot(client, t.auth)
  clock.advance(10_000)
  const first = traders[0]
  if (!first) throw new Error('no trader')
  const w = await snapshot(client, first.auth)
  for (const t of traders) await t.refresh()
  return w
}

async function infoOf(client: ServerClient, auth: Auth) {
  const info = await client.account(auth)
  if ('reason' in info) throw new Error('unauthorized')
  return info
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
    it('rule 25: presence counts heartbeats inside the TTL, one entry per account', async (ctx) => {
      const { client, clock, trader } = await market(ctx)
      const a = await trader('Ashgrove', traderState(60))
      const b = await trader('Brindle', traderState(61))
      expect(await snapshot(client, a.auth)).toMatchObject({
        online: 1,
        zones: [{ zone: 1, count: 1 }],
        here: [],
      })
      expect(await snapshot(client, b.auth)).toMatchObject({
        online: 2,
        zones: [{ zone: 1, count: 2 }],
        here: ['Ashgrove'],
      })
      // One ms before the TTL A still counts; at the TTL it does not (open at the far end).
      clock.advance(PRESENCE_TTL_MS - 1)
      expect(await snapshot(client, b.auth)).toMatchObject({ online: 2, here: ['Ashgrove'] })
      clock.advance(1)
      expect(await snapshot(client, b.auth)).toMatchObject({ online: 1, here: [] })
      await snapshot(client, a.auth)
      await snapshot(client, a.auth)
      expect(await snapshot(client, b.auth)).toMatchObject({ online: 2, here: ['Ashgrove'] })
    })

    it('rule 26: chat needs a link and an open channel', async (ctx) => {
      const open = await market(ctx)
      const u = await open.trader('Una', traderState(62), false)
      expect(await open.client.chat(u.auth, 'hello')).toEqual({ ok: false, reason: 'not_linked' })
      const closed = await market(ctx, { 'chat.enabled': false })
      const a = await closed.trader('Ann', traderState(63))
      expect(await closed.client.chat(a.auth, 'hello')).toEqual({
        ok: false,
        reason: 'chat_closed',
      })
      const w = await snapshot(closed.client, a.auth)
      expect(w.flags['chat.enabled']).toBe(false)
      expect(w.chat).toEqual([])
    })

    it('rule 27: length in UTF-16 units, trimming, control characters', async (ctx) => {
      const { client, trader } = await market(ctx)
      const a = await trader('Ann', traderState(64))
      const tooLong = { ok: false, reason: 'too_long' }
      expect(await client.chat(a.auth, 'a'.repeat(CHAT_MAX_CHARS + 1))).toEqual(tooLong)
      posted(await client.chat(a.auth, 'a'.repeat(CHAT_MAX_CHARS)))
      expect(await client.chat(a.auth, '😀'.repeat(CHAT_MAX_CHARS / 2 + 1))).toEqual(tooLong)
      posted(await client.chat(a.auth, '😀'.repeat(CHAT_MAX_CHARS / 2)))
      WorldSnapshotSchema.parse(await snapshot(client, a.auth))
      const empty = { ok: false, reason: 'empty' }
      expect(await client.chat(a.auth, '   ')).toEqual(empty)
      expect(await client.chat(a.auth, '\n\t')).toEqual(empty)
      expect(posted(await client.chat(a.auth, '  hi  ')).text).toBe('hi')
      const last = posted(await client.chat(a.auth, 'hi\u001b[31m'))
      expect(last.text).toBe('hi[31m')
      expect((await snapshot(client, a.auth)).chat.at(-1)).toEqual(last)
    })

    it('rule 28: a token bucket per account', async (ctx) => {
      const { client, clock, trader } = await market(ctx)
      const a = await trader('Ann', traderState(65))
      const limited = { ok: false, reason: 'rate_limited' }
      for (let i = 0; i < CHAT_BUCKET_CAPACITY; i++) posted(await client.chat(a.auth, `m${i}`))
      expect(await client.chat(a.auth, 'one more')).toEqual(limited)
      clock.advance(CHAT_REFILL_MS)
      posted(await client.chat(a.auth, 'refilled'))
      expect(await client.chat(a.auth, 'again')).toEqual(limited)
      clock.advance(CHAT_BUCKET_CAPACITY * CHAT_REFILL_MS)
      for (let i = 0; i < CHAT_BUCKET_CAPACITY; i++) posted(await client.chat(a.auth, `n${i}`))
      expect(await client.chat(a.auth, 'over')).toEqual(limited)
    })

    it('rule 29: the blocklist refuses words and masks names', async (ctx) => {
      const { client, trader } = await market(ctx)
      const a = await trader('Ann', traderState(66))
      posted(await client.chat(a.auth, 'hello'))
      const before = (await snapshot(client, a.auth)).chat
      expect(await client.chat(a.auth, 'what the heck')).toEqual({ ok: false, reason: 'blocked' })
      expect((await snapshot(client, a.auth)).chat).toEqual(before)
      const h = await trader('heck', traderState(67))
      expect(posted(await client.chat(h.auth, 'hi')).name).toBe('adventurer')
      await snapshot(client, h.auth)
      expect((await snapshot(client, a.auth)).here).toEqual(['adventurer'])
    })

    it('rule 30: history keeps the last 200 and serves the last 50 without a mark', async (ctx) => {
      const { client, clock, trader } = await market(ctx)
      const a = await trader('Ann', traderState(68))
      const ids: number[] = []
      const round = async () => {
        for (let i = 0; i < CHAT_BUCKET_CAPACITY; i++) {
          ids.push(posted(await client.chat(a.auth, `line ${ids.length + 1}`)).id)
        }
        clock.advance(CHAT_BUCKET_CAPACITY * CHAT_REFILL_MS)
      }
      while (ids.length < 60) await round()
      const cold = (await snapshot(client, a.auth, 0)).chat
      expect(cold.map((m) => m.id)).toEqual(ids.slice(-CHAT_SERVE))
      const mark = ids[54] ?? 0
      expect((await snapshot(client, a.auth, mark)).chat.map((m) => m.id)).toEqual(ids.slice(55))
      while (ids.length < 210) await round()
      expect((await snapshot(client, a.auth, 0)).chat.map((m) => m.id)).toEqual(
        ids.slice(-CHAT_SERVE),
      )
      const first = ids[0] ?? 0
      expect((await snapshot(client, a.auth, first)).chat.map((m) => m.id)).toEqual(
        ids.slice(-CHAT_KEEP),
      )
    })

    it('rule 31: the highest-zone board', async (ctx) => {
      const { client, clock, trader } = await market(ctx)
      const a = await trader('Ashgrove', traderState(69, { highestZone: 5 }))
      await a.inSync()
      const b = await trader('Brindle', traderState(70))
      const top = await boards(client, a.auth)
      expect(top.highestZone.slice(0, 2)).toEqual([
        { accountId: a.accountId, name: 'Ashgrove', value: 5 },
        { accountId: b.accountId, name: 'Brindle', value: 1 },
      ])
      expect(top.damage).toEqual([])
      expect(top.weekStart).toBe(weekStartOf(await clock.now()))
      for (let z = 2; z <= 26; z++) await trader(`z${z}`, traderState(100 + z, { highestZone: z }))
      const full = await boards(client, a.auth)
      expect(full.highestZone).toHaveLength(BOARD_ROWS)
      expect(full.highestZone[0]?.value).toBe(26)
      expect(full.highestZone.some((r) => r.accountId === b.accountId)).toBe(false)

      const closed = await market(ctx, { 'leaderboards.enabled': false })
      const c = await closed.trader('Cora', traderState(71))
      expect(await boards(closed.client, c.auth)).toMatchObject({ highestZone: [], damage: [] })

      const fresh = await market(ctx)
      const h = await fresh.trader('heck', traderState(72))
      expect((await boards(fresh.client, h.auth)).highestZone).toEqual([
        { accountId: h.accountId, name: 'adventurer', value: 1 },
      ])
      const boot = await fresh.client.bootstrap({ clientVersion: '0.1.0', deviceToken: null })
      const mirror = new Mirror(boot)
      const commit = async () => {
        const ack = await fresh.client.submit(mirror.batch([tick]), mirror.auth())
        expect(ack.ok).toBe(true)
        mirror.commit([tick])
      }
      await commit()
      const row = async () =>
        (await boards(fresh.client, mirror.auth())).highestZone.find(
          (r) => r.accountId === boot.account.accountId,
        )
      expect((await row())?.name).toBe('adventurer')
      const start = await fresh.client.linkStart(mirror.auth())
      if ('reason' in start) throw new Error('unauthorized')
      const linked = await fresh.client.linkPoll(mirror.auth(), start.code)
      if ('reason' in linked || linked.status !== 'linked') throw new Error('expected linked')
      await commit()
      expect((await row())?.name).toBe(linked.account.linked?.login)
    })

    it('rule 32: presence off counts nobody', async (ctx) => {
      const { client, trader } = await market(ctx, { 'presence.enabled': false })
      const a = await trader('Ann', traderState(73))
      const b = await trader('Bo', traderState(74))
      const w = await snapshot(client, a.auth)
      expect(w).toMatchObject({ online: 0, zones: [], here: [] })
      expect(w.flags['presence.enabled']).toBe(false)
      expect(await snapshot(client, b.auth)).toMatchObject({ online: 0, zones: [], here: [] })
    })
    it('rule 33: the boss spawns on the grid with HP for who is online, and engages them', async (ctx) => {
      const { client, clock, trader } = await market(ctx)
      const a = await trader('Ann', traderState(80))
      const b = await trader('Bo', traderState(81))
      expect((await snapshot(client, a.auth)).boss).toBeNull()
      expect((await snapshot(client, b.auth)).boss).toBeNull()
      clock.advance(NEXT_GRID - 10_000 - (await clock.now()))
      await snapshot(client, a.auth)
      await snapshot(client, b.auth)
      expect((await snapshot(client, a.auth)).boss).toBeNull()
      clock.advance(10_000)
      const w = await snapshot(client, a.auth)
      expect(w.boss).toEqual({
        bossId: bossIdAt(NEXT_GRID),
        name: expect.any(String),
        glyph: expect.any(String),
        maxHp: 2 * BOSS_BASE_HP,
        hp: 2 * BOSS_BASE_HP,
        spawnedAt: NEXT_GRID,
        endsAt: NEXT_GRID + BOSS_WINDOW_MS,
        yours: 0,
      })
      const engagedOf = async (auth: Auth) =>
        eventsOf((await infoOf(client, auth)).delivery, 'boss_engaged')
      const engaged = await engagedOf(a.auth)
      expect(engaged).toHaveLength(1)
      expect(engaged[0]?.stats).toEqual(ZONE1_BOSS)
      expect(ZONE1_BOSS).toEqual({ hp: 630, atk: 14, def: 4, spd: 5 })
      await snapshot(client, a.auth)
      expect(await engagedOf(a.auth)).toHaveLength(1)
      expect(await engagedOf(b.auth)).toHaveLength(1)
      const c = await trader('Cy', traderState(82))
      expect(await engagedOf(c.auth)).toHaveLength(0)
      const late = await snapshot(client, c.auth)
      expect(late.boss?.maxHp).toBe(2 * BOSS_BASE_HP)
      expect(await engagedOf(c.auth)).toHaveLength(1)
    })

    it('rule 34: a committed batch contributes its dealt delta', async (ctx) => {
      const { client, clock, trader } = await market(ctx)
      const a = await trader('Ann', strongState(83))
      const b = await trader('Bo', traderState(84))
      await spawn(client, clock, [a, b])
      expect(a.mirror.local.boss?.bossId).toBe(bossIdAt(NEXT_GRID))
      const { dealt } = await commitTicks(client, a, 20)
      expect(dealt).toBeGreaterThan(0)
      expect(dealt).toBe(a.mirror.local.boss?.dealt)
      const w = await snapshot(client, a.auth)
      expect(w.boss?.hp).toBe(2 * BOSS_BASE_HP - dealt)
      expect(w.boss?.yours).toBe(dealt)
      expect((await boards(client, a.auth)).damage).toEqual([
        { accountId: a.accountId, name: 'Ann', value: dealt },
      ])
    })

    it('rule 35: the killing commit rewards the contributors and disengages them', async (ctx) => {
      const { client, clock, trader } = await market(ctx)
      const a = await trader('Ann', strongState(85))
      const b = await trader('Bo', traderState(86))
      await spawn(client, clock, [a, b])
      const { dealt: small } = await commitTicks(client, b, 1)
      expect(small).toBeGreaterThan(0)
      let total = 0
      let killing: Delivery | null = null
      for (let i = 0; i < 5 && !killing; i++) {
        if (i > 0) clock.advance(120_000)
        const { ack, dealt } = await commitTicks(client, a, 60)
        total += dealt
        if (ack.ok && kindsOf(ack.delivery).includes('boss_disengaged')) killing = ack.delivery
      }
      if (!killing) throw new Error('the boss never died')
      expect(kindsOf(killing)).toEqual(['rewarded', 'rewarded', 'boss_disengaged'])
      for (const r of eventsOf(killing, 'rewarded')) {
        expect(r.goods?.kind).toBe('item')
        if (r.goods?.kind === 'item') expect(r.goods.item.id).toMatch(/^r/)
        expect(r.gold).toBeGreaterThan(0)
      }
      expect(a.mirror.local.boss).toBeNull()
      expect(kindsOf((await infoOf(client, b.auth)).delivery)).toEqual([
        'rewarded',
        'boss_disengaged',
      ])
      const dead = await snapshot(client, a.auth)
      expect(dead.boss).toMatchObject({ bossId: bossIdAt(NEXT_GRID), hp: 0, yours: total })
      expect(total).toBeGreaterThan(2 * BOSS_BASE_HP)
      const board = (await boards(client, a.auth)).damage
      // The mirror applied the rewards and the disengage: the next batch's hashes match.
      await commitTicks(client, a, 1)
      expect((await snapshot(client, a.auth)).boss?.yours).toBe(total)
      expect((await boards(client, a.auth)).damage).toEqual(board)
      clock.advance(BOSS_WINDOW_MS)
      expect((await snapshot(client, a.auth)).boss).toBeNull()
    })

    it('rule 36: past the threshold with no free slot, both rewards wait in returns', async (ctx) => {
      const { client, clock, trader } = await market(ctx)
      const a = await trader('Ann', strongState(87))
      const full = Array.from({ length: 30 }, (_, i) => commonItem(`ic${i}`))
      const c = await trader('Cy', strongState(88, { inventory: full }))
      const w = await spawn(client, clock, [a, c])
      const { dealt } = await commitTicks(client, c, 3)
      expect(dealt).toBeGreaterThanOrEqual(Math.floor((BOSS_BASE_HP * BOSS_THRESHOLD_BP) / 10000))
      for (let i = 0; i < 5; i++) {
        if (i > 0) clock.advance(120_000)
        const { ack } = await commitTicks(client, a, 60)
        if (ack.ok && kindsOf(ack.delivery).includes('boss_disengaged')) break
      }
      const info = await infoOf(client, c.auth)
      const rewards = eventsOf(info.delivery, 'rewarded')
      expect(rewards).toHaveLength(2)
      for (const r of rewards) {
        expect(r.goods).toBeNull()
        expect(r.gold).toBeGreaterThan(0)
      }
      expect(info.returns).toBe(2)
      c.mirror.receive(info.delivery)
      const events: PlayerEvent[] = [{ t: 'vendor', itemId: 'ic0' }]
      const batch = c.mirror.batch(events)
      const ack = await client.submit(batch, c.auth)
      if (!ack.ok) throw new Error(`refused: ${ack.reason}`)
      const returned = eventsOf(ack.delivery, 'returned')
      expect(returned).toHaveLength(1)
      expect(returned[0]?.listingId).toBe(w.boss?.bossId)
      expect((await infoOf(client, c.auth)).returns).toBe(1)
    })

    it('rule 37: an expired boss pays the threshold drop only', async (ctx) => {
      const { client, clock, trader } = await market(ctx)
      const a = await trader('Ann', strongState(89))
      const b = await trader('Bo', traderState(90))
      await spawn(client, clock, [a, b])
      await commitTicks(client, a, 3)
      await commitTicks(client, b, 1)
      clock.advance(BOSS_WINDOW_MS)
      expect((await snapshot(client, a.auth)).boss).toBeNull()
      expect(kindsOf((await infoOf(client, a.auth)).delivery)).toEqual([
        'rewarded',
        'boss_disengaged',
      ])
      expect(kindsOf((await infoOf(client, b.auth)).delivery)).toEqual(['boss_disengaged'])
    })

    it('rule 38: with the world boss off nothing spawns', async (ctx) => {
      const { client, clock, trader } = await market(ctx, { 'worldboss.enabled': false })
      const a = await trader('Ann', traderState(91))
      clock.advance(NEXT_GRID - 10_000 - (await clock.now()))
      await snapshot(client, a.auth)
      clock.advance(10_000)
      expect((await snapshot(client, a.auth)).boss).toBeNull()
      expect(kindsOf((await infoOf(client, a.auth)).delivery)).not.toContain('boss_engaged')
    })

    it('rule 39: the damage board is weekly', async (ctx) => {
      const { client, clock, trader } = await market(ctx)
      const a = await trader('Ann', strongState(92))
      const b = await trader('Bo', traderState(93))
      await spawn(client, clock, [a, b])
      await commitTicks(client, a, 5)
      const now = await clock.now()
      const before = await boards(client, a.auth)
      expect(before.weekStart).toBe(weekStartOf(now))
      expect(before.damage).toHaveLength(1)
      clock.advance(weekStartOf(now) + WEEK - now)
      const after = await boards(client, a.auth)
      expect(after.damage).toEqual([])
      expect(after.weekStart).toBe(weekStartOf(now) + WEEK)
      expect(await boards(client, a.auth)).toEqual(after)
    })

    it('rule 40: a restarted host resumes the live boss from the store', async (ctx) => {
      const clock = makeClock()
      const kv = new MemoryKeyValue()
      const first = await make(clock, { flags: {}, kv })
      if (!first.host) {
        ctx.skip()
        return
      }
      const m = await first.host.mint({ state: strongState(94), name: 'Ann', linked: true })
      const auth = { deviceToken: m.deviceToken }
      const boot = await first.client.bootstrap({
        clientVersion: '0.1.0',
        deviceToken: m.deviceToken,
      })
      const a: Trader = {
        auth,
        accountId: m.accountId,
        mirror: new Mirror(boot),
        async refresh() {
          a.mirror.receive((await infoOf(first.client, auth)).delivery)
        },
      }
      const other = await first.host.mint({ state: traderState(95), name: 'Bo', linked: true })
      const otherAuth = { deviceToken: other.deviceToken }
      const b: Trader = {
        auth: otherAuth,
        accountId: other.accountId,
        mirror: new Mirror(
          await first.client.bootstrap({ clientVersion: '0.1.0', deviceToken: other.deviceToken }),
        ),
        async refresh() {
          b.mirror.receive((await infoOf(first.client, otherAuth)).delivery)
        },
      }
      await spawn(first.client, clock, [a, b])
      await commitTicks(first.client, a, 5)
      const before = await snapshot(first.client, auth)
      expect(before.online).toBe(2)
      const second = await make(clock, { flags: {}, kv })
      const after = await snapshot(second.client, auth)
      expect(after.boss).toEqual(before.boss)
      expect(after.boss?.hp).toBeLessThan(2 * BOSS_BASE_HP)
      // Presence lives in the host's memory: the new host counts only who polled it.
      expect(after.online).toBe(1)
      expect((await snapshot(first.client, otherAuth)).online).toBe(2)
    })
  })
}
