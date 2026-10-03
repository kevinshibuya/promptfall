import {
  type GameState,
  hashState,
  type PlayerEvent,
  replay,
  type ServerEvent,
  SIM_VERSION,
  step,
} from '@promptfall/sim'
import type { Bootstrap, Delivery } from './client'
import type { Batch, TimedEvent } from './schemas'

// Not exported from the package root: the vendor bundle never carries it, so `crypto.randomUUID()` stays.

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
