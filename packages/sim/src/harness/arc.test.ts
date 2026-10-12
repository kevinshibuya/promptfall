import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SIM_VERSION } from '../types'
import { outOfBand, probe } from './probe'
import { runScenario, type ScenarioReport } from './scenario'

// The arc of spec #130 at the reference cadence: nine seeds, 200 live hours each. Every sim bump
// runs it, so the numbers in the content tables are the ones this evidence describes. The hour
// targets are read on the median of the nine seeds, with a completion floor, because #138's seed
// table showed one seed's first clear of zone 12 spans 40 hours to never at a single setting.
// The medians and floors gate from sim version 11 (#143), which tunes the final curve once; each
// bump before it moves the curve again, so below 11 the file only reports them.
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9]
const HOURS = 200

const runs = new Map<number, ScenarioReport>()
beforeAll(() => {
  for (const seed of SEEDS) runs.set(seed, runScenario({ seed, hours: HOURS }))
}, 600_000)

function arc(seed: number): ScenarioReport {
  const r = runs.get(seed)
  if (!r) throw new Error(`seed ${seed} not run`)
  return r
}

function cleared(r: ScenarioReport, zone: number): number | null {
  return r.zones.find((z) => z.zone === zone)?.firstClearedHour ?? null
}

// A milestone never reached inside the run is +∞: it pushes a median up and never down.
function reached(r: ScenarioReport, level: number): number {
  return r.levels.find((l) => l.level === level)?.hour ?? Number.POSITIVE_INFINITY
}

function zone12(r: ScenarioReport): number {
  return cleared(r, 12) ?? Number.POSITIVE_INFINITY
}

function perLevel(r: ScenarioReport): number {
  const at30 = reached(r, 30)
  return at30 === Number.POSITIVE_INFINITY ? at30 : (at30 - reached(r, 10)) / 20
}

function cap(r: ScenarioReport): number {
  return r.legendary?.capHour ?? Number.POSITIVE_INFINITY
}

// The fifth of nine, no averaging.
function median(of: (r: ScenarioReport) => number): number {
  const sorted = SEEDS.map((seed) => of(arc(seed))).sort((a, b) => a - b)
  const middle = sorted[(sorted.length - 1) / 2]
  if (middle === undefined) throw new Error('no seeds')
  return middle
}

function within(of: (r: ScenarioReport) => number): number {
  return SEEDS.filter((seed) => of(arc(seed)) <= HOURS).length
}

describe.each(SEEDS)('the arc, seed %i, at the reference cadence', (seed) => {
  it('first clears zone 1 inside the first hour', () => {
    const hour = cleared(arc(seed), 1)
    expect(hour).not.toBeNull()
    expect(hour).toBeLessThan(1)
  })

  it('first clears each zone it clears later than the one before it', () => {
    const r = arc(seed)
    let before = cleared(r, 1) ?? Number.POSITIVE_INFINITY
    for (let zone = 2; zone <= 12; zone++) {
      const hour = cleared(r, zone)
      if (hour === null) continue
      expect(hour, `zone ${zone}`).toBeGreaterThan(before)
      before = hour
    }
  })
})

function hours(h: number, digits = 2): string {
  return h === Number.POSITIVE_INFINITY ? 'never' : h.toFixed(digits)
}

afterAll(() => {
  if (runs.size < SEEDS.length) return
  const rows = SEEDS.map((seed) => {
    const r = arc(seed)
    return `| ${seed} | ${hours(cleared(r, 1) ?? Number.POSITIVE_INFINITY)} | ${hours(zone12(r))} | ${hours(perLevel(r), 3)} | ${hours(cap(r))} |`
  })
  console.log(
    [
      `the arc at sim version ${SIM_VERSION}, ${SEEDS.length} seeds, ${HOURS} live hours`,
      '| seed | zone 1 clear (h) | zone 12 clear (h) | hours per level 10→30 | cap (h) |',
      '|---|---|---|---|---|',
      ...rows,
      `medians: zone 12 ${hours(median(zone12))}, hours per level ${hours(median(perLevel), 4)}, cap ${hours(median(cap))}`,
      `inside the run: zone 12 on ${within(zone12)}/${SEEDS.length}, cap on ${within(cap)}/${SEEDS.length}`,
    ].join('\n'),
  )
})

describe.runIf(SIM_VERSION >= 11)('the arc, median of nine seeds, at the reference cadence', () => {
  it('first clears zone 12 between 80 and 120 live hours', () => {
    const hour = median(zone12)
    expect(hour).toBeGreaterThanOrEqual(80)
    expect(hour).toBeLessThanOrEqual(120)
  })

  it('levels up every one to two live hours through levels 10 to 30', () => {
    const hours = median(perLevel)
    expect(hours).toBeGreaterThanOrEqual(1)
    expect(hours).toBeLessThanOrEqual(2)
  })

  it('takes the granted Legendary to 50 between 150 and 200 live hours', () => {
    const hour = median(cap)
    expect(hour).toBeGreaterThanOrEqual(150)
    expect(hour).toBeLessThanOrEqual(200)
  })

  it('first clears zone 12 on at least seven of the nine seeds', () => {
    expect(within(zone12)).toBeGreaterThanOrEqual(7)
  })

  it('takes the granted Legendary to 50 on at least seven of the nine seeds', () => {
    expect(within(cap)).toBeGreaterThanOrEqual(7)
  })
})

describe('the feel probe', () => {
  it('holds 6 to 10 wave hits and 3 to 4 boss hits on the reference Knight at every zone', () => {
    expect(outOfBand(probe(1))).toEqual([])
  })
})
