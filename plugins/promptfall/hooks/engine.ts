import type { PluginState } from 'claude-code'
import type { BatchAck, KeyValue, ServerClient, TimedEvent } from './vendor/protocol.js'
import {
  type Effect,
  type Event,
  type GameState,
  hashState,
  SIM_VERSION,
  step,
} from './vendor/sim.js'
import { CLIENT_VERSION } from './version'
import { toGameView } from './view'

export type EnginePublish = (patch: Partial<PluginState['promptfall']>) => Promise<void>

export type EngineDeps = {
  client: ServerClient
  /** For the device token, key `deviceToken`. */
  kv: KeyValue
  now: () => Promise<number>
  newBatchId: () => string
  /** Writes atoms; a closure over the session's `$`. */
  publish: EnginePublish
  onEffects: (effects: Effect[]) => void
  /** Shows a toast. Optional: tests leave it out. */
  toast?: (text: string) => void
  /** Runs `fn` once after `ms`, for notices that clear themselves. Optional. */
  after?: (ms: number, fn: () => void) => void
}

/** What the command and the dialog hold of a running game. */
export type GameHandle = {
  apply: (event: Event, at: number) => void
  canApply: () => boolean
  setOff: (off: boolean) => Promise<void>
  settled: () => Promise<void>
}

type Buffer = { events: TimedEvent[]; baseHash: string }

const UPDATE_NOTICE = 'Update Promptfall: /plugin update promptfall'
const MISMATCH_NOTICE = 'Promptfall: account mismatch, delete the plugin store to reset'

/**
 * Runs the sim locally, buffers what it fed in, and reconciles with the server
 * in batches. Publishing is queued so the atoms see patches in order.
 */
export class GameEngine {
  private local: GameState | null = null
  private seq = 0
  private token: string | null = null
  private account: string | null = null
  private buffer: Buffer | null = null
  private inFlight = false
  private paused: string | null = null
  private firstRun = false
  private queue: Promise<void> = Promise.resolve()

  constructor(private readonly deps: EngineDeps) {}

  /** Loads the token, bootstraps, saves the token, sets local state, publishes the view. */
  async start(): Promise<void> {
    const stored = await this.deps.kv.get('deviceToken')
    const token = typeof stored === 'string' ? stored : null
    const boot = await this.deps.client.bootstrap({
      clientVersion: CLIENT_VERSION,
      deviceToken: token,
    })
    this.firstRun = boot.deviceToken !== token
    this.token = boot.deviceToken
    if (boot.deviceToken !== token) await this.deps.kv.set('deviceToken', boot.deviceToken)
    this.account = boot.account.accountId
    this.local = boot.state
    this.seq = boot.seq
    this.buffer = null
    this.paused = null
    await this.publish({ view: this.view() })
    // Only the minted account's first view says firstRun; every later view says no.
    this.firstRun = false
  }

  /** Steps locally, buffers the event, publishes the view and hands the effects on. */
  apply(event: Event, at: number): void {
    const local = this.local
    if (!local || this.paused !== null) return
    if (!this.buffer) this.buffer = { events: [], baseHash: hashState(local) }
    const r = step(local, event)
    this.local = r.state
    this.buffer.events.push({ ...event, at } as TimedEvent)
    void this.publish({ view: this.view() })
    if (r.effects.length > 0) this.deps.onEffects(r.effects)
  }

  /** Single flight: one batch from the buffer, submitted, its ack handled. */
  async flush(): Promise<void> {
    if (this.inFlight || !this.buffer || !this.local || !this.account || !this.token) return
    if (this.paused !== null) return
    this.inFlight = true
    const sent = this.buffer
    this.buffer = null
    try {
      const ack = await this.deps.client.submit(
        {
          batchId: this.deps.newBatchId(),
          accountId: this.account,
          seq: this.seq,
          clientVersion: CLIENT_VERSION,
          simVersion: SIM_VERSION,
          baseHash: sent.baseHash,
          resultHash: hashState(this.local),
          events: sent.events,
        },
        { deviceToken: this.token },
      )
      await this.handle(ack)
    } catch (error) {
      this.setPaused(error instanceof Error ? error.name : 'Error')
    } finally {
      this.inFlight = false
    }
  }

  /** Resolves once every publish queued so far has landed. */
  settled(): Promise<void> {
    return this.queue
  }

  state(): GameState | null {
    return this.local
  }

  accountId(): string | null {
    return this.account
  }

  isPaused(): boolean {
    return this.paused !== null
  }

  setPaused(reason: string | null): void {
    this.paused = reason
    void this.publish(
      reason === null ? { mode: 'primary', notice: null } : { mode: 'paused', notice: reason },
    )
  }

  private async handle(ack: BatchAck): Promise<void> {
    if (ack.ok) {
      this.seq = ack.seq
      return
    }
    switch (ack.reason) {
      case 'seq_mismatch':
        this.adopt(ack.state, ack.seq)
        this.notice('Promptfall resynced', 10_000)
        return
      case 'rate_capped':
        this.adopt(ack.state, ack.seq)
        this.notice('Promptfall: progress capped, resynced', 10_000)
        return
      case 'hash_mismatch':
        this.adopt(ack.state, ack.seq)
        if (ack.revokedItemIds.length > 0) this.deps.toast?.('An item was revoked')
        return
      case 'version_gate':
      case 'sim_version':
        this.setPaused(UPDATE_NOTICE)
        return
      case 'unauthorized':
        this.setPaused(MISMATCH_NOTICE)
        return
    }
  }

  /**
   * The server wins. Events applied during the flight were stepped on the old
   * state, so they go too: at most one flush interval of progress.
   */
  private adopt(state: GameState, seq: number): void {
    this.local = state
    this.seq = seq
    this.buffer = null
    void this.publish({ view: this.view() })
  }

  private notice(text: string, ms: number): void {
    void this.publish({ notice: text })
    this.deps.after?.(ms, () => {
      if (this.paused === null) void this.publish({ notice: null })
    })
  }

  private view() {
    return this.local && this.account ? toGameView(this.local, this.account, this.firstRun) : null
  }

  private publish(patch: Partial<PluginState['promptfall']>): Promise<void> {
    this.queue = this.queue.then(() => this.deps.publish(patch)).catch(() => undefined)
    return this.queue
  }
}
