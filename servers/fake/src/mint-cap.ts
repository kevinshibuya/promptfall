/** Mints one client address may make in an hour of the server's clock. */
export const MINTS_PER_HOUR = 5

const HOUR = 3_600_000

/**
 * A sliding hour of mints per client address, held in memory: a restart forgets it, which costs
 * at most one more hour's worth from each address.
 */
export class MintCap {
  private readonly mints = new Map<string, number[]>()
  private swept = 0

  constructor(private readonly limit: number) {}

  /** Counts a mint from `address` at `now` and answers true, or answers false when it is over the cap. */
  take(address: string, now: number): boolean {
    this.sweep(now)
    const recent = (this.mints.get(address) ?? []).filter((at) => at > now - HOUR)
    if (recent.length >= this.limit) {
      this.mints.set(address, recent)
      return false
    }
    recent.push(now)
    this.mints.set(address, recent)
    return true
  }

  /** At most once an hour, drops the addresses with no mint in the last hour. */
  private sweep(now: number): void {
    if (now - this.swept < HOUR) return
    this.swept = now
    for (const [address, stamps] of this.mints) {
      if (stamps.every((at) => at <= now - HOUR)) this.mints.delete(address)
    }
  }
}
