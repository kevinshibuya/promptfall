import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { type Cadence, loadCadence, REFERENCE_CADENCE, turnSource } from './cadence'
import { runScenario } from './scenario'

/** The realised shape of a cadence over this many live hours. */
function realise(cadence: Cadence, seed: number, hours: number) {
  const next = turnSource({ kind: 'distribution', name: 'test', cadence }, seed)
  const calls: number[] = []
  const lengths: number[] = []
  let inTurn = 0
  let elapsed = 0
  while (elapsed < hours * 3600) {
    const turn = next()
    calls.push(turn.calls.length)
    lengths.push(turn.lengthSec)
    inTurn += turn.lengthSec
    elapsed += turn.lengthSec + turn.idleSec
  }
  const at = (xs: number[], q: number) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length * q)]
  return {
    turnsPerHour: calls.length / hours,
    inTurnShare: inTurn / elapsed,
    calls: { p50: at(calls, 0.5), p75: at(calls, 0.75), p90: at(calls, 0.9) },
    lengths: { p50: at(lengths, 0.5), p75: at(lengths, 0.75), p90: at(lengths, 0.9) },
  }
}

describe('the reference cadence', () => {
  it('draws turns in the grill’s shape, about 60% of live time inside them', () => {
    const r = realise(REFERENCE_CADENCE, 7, 2000)
    expect(r.calls.p50).toBe(2)
    expect(r.calls.p75).toBeGreaterThanOrEqual(10)
    expect(r.calls.p90).toBeGreaterThanOrEqual(25)
    expect(r.calls.p90).toBeLessThanOrEqual(31)
    expect(r.lengths.p50).toBeGreaterThanOrEqual(150)
    expect(r.lengths.p50).toBeLessThanOrEqual(190)
    expect(r.lengths.p75).toBeGreaterThanOrEqual(600)
    expect(r.lengths.p75).toBeLessThanOrEqual(740)
    expect(r.lengths.p90).toBeGreaterThanOrEqual(2000)
    expect(r.lengths.p90).toBeLessThanOrEqual(2400)
    expect(r.inTurnShare).toBeGreaterThanOrEqual(0.57)
    expect(r.inTurnShare).toBeLessThanOrEqual(0.63)
  })

  it('is what a scenario plays by default, and the report prints what it realised', () => {
    const r = runScenario({ seed: 7, hours: 20 })
    expect(r.cadence.name).toBe('reference')
    expect(r.cadence.promptsPerHour).toBeGreaterThanOrEqual(2.5)
    expect(r.cadence.promptsPerHour).toBeLessThanOrEqual(5)
    expect(r.cadence.inTurnShare).toBeGreaterThanOrEqual(0.45)
    expect(r.cadence.inTurnShare).toBeLessThanOrEqual(0.75)
    // A quarter of turns reach 10 tool calls: far fewer turn bosses than prompts.
    expect(r.turnBosses).toBeLessThan(r.cadence.prompts)
  })

  it('is reproducible by seed and differs across seeds', () => {
    expect(realise(REFERENCE_CADENCE, 3, 50)).toEqual(realise(REFERENCE_CADENCE, 3, 50))
    expect(realise(REFERENCE_CADENCE, 3, 50)).not.toEqual(realise(REFERENCE_CADENCE, 4, 50))
  })
})

describe('a cadence file', () => {
  const busy: Cadence = {
    toolCallsPerTurn: [
      [0, 10],
      [10000, 20],
    ],
    turnLengthSec: [
      [0, 60],
      [10000, 120],
    ],
    idleGapSec: [
      [0, 10],
      [10000, 20],
    ],
  }
  const write = (body: unknown): string => {
    const path = join(mkdtempSync(join(tmpdir(), 'cadence-')), 'cadence.json')
    writeFileSync(path, JSON.stringify(body))
    return path
  }

  it('loads another player and a run with it reproduces by seed', () => {
    const cadence = loadCadence(write(busy))
    expect(cadence.name).toMatch(/cadence\.json$/)
    const a = runScenario({ seed: 11, hours: 1, cadence })
    const b = runScenario({ seed: 11, hours: 1, cadence })
    expect(a).toEqual(b)
    // Every turn has 10 or more calls: every turn ends in a turn boss.
    expect(a.turnBosses).toBeGreaterThan(20)
    expect(a.cadence.inTurnShare).toBeGreaterThan(0.8)
  })

  it('refuses a table that is not a quantile table', () => {
    expect(() => loadCadence(write({ ...busy, idleGapSec: [[0, 5]] }))).toThrow(/idleGapSec/)
    expect(() =>
      loadCadence(
        write({
          ...busy,
          turnLengthSec: [
            [0, 60],
            [5000, 30],
            [10000, 90],
          ],
        }),
      ),
    ).toThrow(/turnLengthSec/)
    expect(() => loadCadence(write({ toolCallsPerTurn: busy.toolCallsPerTurn }))).toThrow(
      /turnLengthSec/,
    )
  })
})

describe('the fixed cadence', () => {
  it('keeps the old shape: a call every few seconds, every turn ends in a turn boss', () => {
    const next = turnSource(
      { kind: 'fixed', activeShareBp: 6000, toolCallEverySec: 8, turnLengthSec: 90 },
      7,
    )
    expect(next()).toEqual({
      lengthSec: 90,
      calls: [8, 16, 24, 32, 40, 48, 56, 64, 72, 80, 88],
      idleSec: 60,
    })
  })
})
