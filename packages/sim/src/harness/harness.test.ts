import { describe, expect, it } from 'vitest'
import { runScenario } from './scenario'

const day = {
  seed: 7,
  activeShareBp: 6000,
  toolCallEverySec: 8,
  turnLengthSec: 90,
  restEveryTurns: 1,
}

// A 40 hour run takes over 10 s: past vitest's 5 s default on a loaded machine.
describe('balance targets', { timeout: 60_000 }, () => {
  it('an 8 hour day clears zone 1 and stalls at zone 2 or 3', () => {
    const r = runScenario({ ...day, hours: 8 })
    expect(r.highestZone).toBeGreaterThanOrEqual(2)
    expect(r.highestZone).toBeLessThanOrEqual(3)
    expect(r.roundsPerKillZone1).toBeGreaterThanOrEqual(2)
    expect(r.roundsPerKillZone1).toBeLessThanOrEqual(6)
    // Grill 1.5: a hero acts about once every 2 combat ticks.
    expect(r.heroActsPerCombatTick).toBeGreaterThanOrEqual(0.4)
    expect(r.heroActsPerCombatTick).toBeLessThanOrEqual(0.6)
    expect(r.ticks).toBeGreaterThan(0)
    expect(r.toolCalls).toBeGreaterThan(0)
  })

  it('40 hours reach zone 4 to 7', () => {
    const r = runScenario({ ...day, hours: 40 })
    expect(r.highestZone).toBeGreaterThanOrEqual(4)
    expect(r.highestZone).toBeLessThanOrEqual(7)
  })
})
