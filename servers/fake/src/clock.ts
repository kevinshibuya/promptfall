export type ClockSnapshot = { virtualAt: number; realAt: number }

/**
 * A server clock running `speed` virtual ms per real ms. Restarted from a
 * snapshot it resumes at `virtualAt + (realNow − realAt) × speed`, so virtual
 * time never goes backwards and a changed speed rebases from there.
 */
export class VirtualClock {
  readonly speed: number
  private readonly baseVirtual: number
  private readonly baseReal: number
  private readonly realNow: () => number
  private last = 0

  constructor(options: {
    speed: number
    persisted: ClockSnapshot | null
    realNow?: () => number
  }) {
    this.speed = options.speed
    this.realNow = options.realNow ?? Date.now
    this.baseReal = this.realNow()
    this.baseVirtual = options.persisted
      ? options.persisted.virtualAt +
        Math.max(0, this.baseReal - options.persisted.realAt) * options.speed
      : this.baseReal
  }

  /** Integer virtual ms, never smaller than a value already handed out. */
  nowSync(): number {
    const elapsed = Math.max(0, this.realNow() - this.baseReal)
    const t = Math.floor(this.baseVirtual + elapsed * this.speed)
    this.last = Math.max(this.last, t)
    return this.last
  }

  async now(): Promise<number> {
    return this.nowSync()
  }

  snapshot(): ClockSnapshot {
    return { virtualAt: this.nowSync(), realAt: this.realNow() }
  }
}
