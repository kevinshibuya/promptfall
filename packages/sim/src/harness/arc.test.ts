import { describe, expect, it } from 'vitest'
import { outOfBand, probe } from './probe'
import { runScenario, type ScenarioReport } from './scenario'

// The arc of spec #130 at the reference cadence: three seeds, 200 live hours each. Every sim bump
// runs it, so the numbers in the content tables are the ones this evidence describes.
const SEEDS = [7, 8, 9]
const HOURS = 200

const runs = new Map<number, ScenarioReport>()
function arc(seed: number): ScenarioReport {
  let r = runs.get(seed)
  if (!r) {
    r = runScenario({ seed, hours: HOURS })
    runs.set(seed, r)
  }
  return r
}

function cleared(r: ScenarioReport, zone: number): number | null {
  return r.zones.find((z) => z.zone === zone)?.firstClearedHour ?? null
}

function reached(r: ScenarioReport, level: number): number {
  const at = r.levels.find((l) => l.level === level)
  if (!at) throw new Error(`level ${level} never reached`)
  return at.hour
}

describe.each(SEEDS)('the arc, seed %i, at the reference cadence', (seed) => {
  it('first clears zone 1 inside the first hour', { timeout: 60_000 }, () => {
    const hour = cleared(arc(seed), 1)
    expect(hour).not.toBeNull()
    expect(hour).toBeLessThan(1)
  })

  it('first clears each zone later than the one before it', { timeout: 60_000 }, () => {
    const r = arc(seed)
    for (let zone = 2; zone <= 12; zone++) {
      const before = cleared(r, zone - 1)
      const hour = cleared(r, zone)
      expect(hour, `zone ${zone}`).not.toBeNull()
      expect(hour, `zone ${zone}`).toBeGreaterThan(before ?? Number.POSITIVE_INFINITY)
    }
  })

  it('first clears zone 12 between 80 and 120 live hours', { timeout: 60_000 }, () => {
    const hour = cleared(arc(seed), 12)
    expect(hour).not.toBeNull()
    expect(hour).toBeGreaterThanOrEqual(80)
    expect(hour).toBeLessThanOrEqual(120)
  })

  it('levels up every one to two live hours through levels 10 to 30', { timeout: 60_000 }, () => {
    const r = arc(seed)
    const perLevel = (reached(r, 30) - reached(r, 10)) / 20
    expect(perLevel).toBeGreaterThanOrEqual(1)
    expect(perLevel).toBeLessThanOrEqual(2)
  })

  it('takes the granted Legendary to 50 between 150 and 200 live hours', {
    timeout: 60_000,
  }, () => {
    const cap = arc(seed).legendary?.capHour ?? null
    expect(cap).not.toBeNull()
    expect(cap).toBeGreaterThanOrEqual(150)
    expect(cap).toBeLessThanOrEqual(200)
  })
})

describe('the feel probe', () => {
  it('holds 6 to 10 wave hits and 3 to 4 boss hits on the reference Knight at every zone', () => {
    expect(outOfBand(probe(1))).toEqual([])
  })
})
