import {
  createInitialState,
  type GameState,
  hashState,
  type PlayerEvent,
  replay,
  type ServerEvent,
  SIM_VERSION,
  step,
} from '@promptfall/sim'
import { describe, expect, it } from 'vitest'
import type { Bootstrap, Delivery, ServerClient } from '../client'
import { type Batch, compareSemver, type TimedEvent } from '../schemas'

export type ContractClock = { now: () => Promise<number>; advance: (ms: number) => void }

/** Host privileges a contract run may use; structurally `Ledger.host`. Host rules skip without it. */
export type ContractHost = {
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
  })
}
