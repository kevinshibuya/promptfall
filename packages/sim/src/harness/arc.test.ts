import { fork } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SIM_VERSION } from '../types'
import { outOfBand, probe, referenceParty } from './probe'
import { referenceRow } from './reference'
import { runScenario, type ScenarioOptions, type ScenarioReport } from './scenario'

// The arc of spec #130 at the reference cadence: nine seeds, 200 live hours each. Every sim bump
// runs it, so the numbers in the content tables are the ones this evidence describes. The hour
// targets are read on the median of the nine seeds, because #138's seed table showed one seed's
// first clear of zone 12 spans 40 hours to never at a single setting. The medians are a report,
// printed with the seed table and judged by a person on the PR (Kevin, 2026-10-12); the
// completion floors and the per-seed checks gate at every version.
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9]
const HOURS = 200

// The seeds run in child processes, at most four at once: the machine that gates has 8 GB.
const PROCESSES = 4
const TSX = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href
const SEED_SCRIPT = fileURLToPath(new URL('./arc-seed.ts', import.meta.url))

function runSeed(seed: number): Promise<ScenarioReport> {
  const options: ScenarioOptions = { seed, hours: HOURS }
  return new Promise((resolve, reject) => {
    const child = fork(SEED_SCRIPT, [], { execArgv: ['--import', TSX], serialization: 'advanced' })
    child.once('message', (report) => resolve(report as ScenarioReport))
    child.once('error', reject)
    child.once('exit', (code) => reject(new Error(`seed ${seed}: exited with ${code}`)))
    child.send(options)
  })
}

const runs = new Map<number, ScenarioReport>()
beforeAll(async () => {
  const queue = [...SEEDS]
  const lane = async () => {
    for (let seed = queue.shift(); seed !== undefined; seed = queue.shift()) {
      runs.set(seed, await runSeed(seed))
    }
  }
  await Promise.all(Array.from({ length: PROCESSES }, lane))
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

describe('the arc, nine seeds, at the reference cadence', () => {
  it('first clears zone 12 on at least seven of the nine seeds', () => {
    expect(within(zone12)).toBeGreaterThanOrEqual(7)
  })

  it('takes the granted Legendary to 50 on at least seven of the nine seeds', () => {
    expect(within(cap)).toBeGreaterThanOrEqual(7)
  })
})

describe('tier 2, at the reference cadence', () => {
  // A capped party (the Knight Legendary at 50, Epics at 45) in tier-5 gear at mid rolls.
  it("clears zone 13, tier 2's first zone", () => {
    const row = { ...referenceRow(13), rollBp: 5000 }
    const r = runScenario({
      seed: 1,
      hours: 24,
      legendaryAtHour: null,
      start: referenceParty(row, 1),
    })
    expect(r.zones.find((z) => z.zone === 13)?.firstClearedHour ?? null).not.toBeNull()
  }, 120_000)
})

describe('the feel probe', () => {
  it('holds 6 to 10 wave hits and 3 to 4 boss hits on the reference Knight at every zone', () => {
    expect(outOfBand(probe(1))).toEqual([])
  })
})
