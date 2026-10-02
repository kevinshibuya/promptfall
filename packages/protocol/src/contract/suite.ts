import { createInitialState, type Event, hashState, replay, SIM_VERSION } from '@promptfall/sim'
import { describe, expect, it } from 'vitest'
import type { Bootstrap, ServerClient } from '../client'
import { type Batch, compareSemver, type TimedEvent } from '../schemas'

export type ContractClock = { now: () => Promise<number>; advance: (ms: number) => void }

function makeClock(start = 1_700_000_000_000): ContractClock {
  let t = start
  return {
    now: async () => t,
    advance: (ms: number) => {
      t += ms
    },
  }
}

const tick: Event = { t: 'tick' }

/** A client-side mirror: tracks state, seq and hash the way a real client would. */
class Mirror {
  state: Bootstrap['state']
  seq: number
  constructor(readonly boot: Bootstrap) {
    this.state = boot.state
    this.seq = boot.seq
  }

  batch(events: Event[], overrides: Partial<Batch> = {}): Batch {
    const timed: TimedEvent[] = events.map((e, i) => ({ ...e, at: 1000 + i }))
    const result = replay(this.state, events).state
    return {
      batchId: crypto.randomUUID(),
      accountId: this.boot.account.accountId,
      seq: this.seq,
      clientVersion: this.boot.config.minClientVersion,
      simVersion: SIM_VERSION,
      baseHash: hashState(this.state),
      resultHash: hashState(result),
      events: timed,
      ...overrides,
    }
  }

  /** Advances the mirror as if the batch committed. */
  commit(events: Event[]): void {
    this.state = replay(this.state, events).state
    this.seq += 1
  }

  auth() {
    return { deviceToken: this.boot.deviceToken }
  }
}

function lowerThan(version: string): string | null {
  return compareSemver(version, '0.0.0') > 0 ? '0.0.0' : null
}

export function runServerContract(
  name: string,
  make: (clock: ContractClock) => Promise<ServerClient>,
): void {
  const setup = async () => {
    const clock = makeClock()
    const client = await make(clock)
    const boot = await client.bootstrap({ clientVersion: '0.1.0', deviceToken: null })
    return { clock, client, boot, mirror: new Mirror(boot) }
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
    })

    it('rule 2: a known token returns the same account and its progress; an unknown one mints', async () => {
      const { client, boot, mirror } = await setup()
      const events = [tick, tick, { t: 'tool_call' } as Event]
      const ack = await client.submit(mirror.batch(events), mirror.auth())
      expect(ack.ok).toBe(true)
      mirror.commit(events)
      const again = await client.bootstrap({
        clientVersion: '0.1.0',
        deviceToken: boot.deviceToken,
      })
      expect(again.account).toEqual(boot.account)
      expect(again.seq).toBe(1)
      expect(again.hash).toBe(hashState(mirror.state))
      expect(again.state).toEqual(mirror.state)
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

    it('rule 8: a capped batch consumes nothing', async () => {
      const { client, mirror } = await setup()
      const over = Array.from({ length: 71 }, () => tick)
      expect(await client.submit(mirror.batch(over), mirror.auth())).toMatchObject({ ok: false })
      const full = Array.from({ length: 70 }, () => tick)
      expect(await client.submit(mirror.batch(full), mirror.auth())).toMatchObject({ ok: true })
    })

    it('rule 9: a matching batch commits', async () => {
      const { client, mirror } = await setup()
      const events: Event[] = [{ t: 'tool_call' }, tick, tick, { t: 'turn_end' }, { t: 'rest' }]
      const batch = mirror.batch(events)
      const ack = await client.submit(batch, mirror.auth())
      expect(ack).toEqual({ ok: true, duplicate: false, seq: 1, hash: batch.resultHash })
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
        state: mirror.state,
        hash: hashState(mirror.state),
        revokedItemIds: [],
      })
      const retry = await client.submit(batch, mirror.auth())
      expect(retry).toEqual({ ok: true, duplicate: true, seq: 1, hash: hashState(mirror.state) })
      const after = await client.bootstrap({
        clientVersion: '0.1.0',
        deviceToken: boot.deviceToken,
      })
      expect(after.seq).toBe(1)
    })
  })
}
