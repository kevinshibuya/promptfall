import { readFileSync } from 'node:fs'
import { nextU32 } from '../rng'

/**
 * A distribution as its quantile table: [quantile in basis points, value] points from 0 to 10000,
 * the value linear between them and floored. [5000, 2] says half the draws fall below 2.
 */
export type Quantiles = [bp: number, value: number][]

/** A player's cadence: how many tool calls a turn makes, how long it runs, how long the gap after. */
export type Cadence = {
  toolCallsPerTurn: Quantiles
  turnLengthSec: Quantiles
  idleGapSec: Quantiles
}

/**
 * The reference cadence, from the grill's analysis of Kevin's transcripts: tool calls per turn
 * median 2 (a band of its own: a count is discrete), a quarter of turns at 10 or more, p90 28; turn length median 170 s, p75 670 s, p90
 * 2,200 s. The idle gap is chosen so about 60% of live time is inside turns. Prompts per live
 * hour follow from these; they are not an input.
 */
export const REFERENCE_CADENCE: Cadence = {
  toolCallsPerTurn: [
    [0, 0],
    [2500, 1],
    [4000, 2],
    [5500, 3],
    [7500, 10],
    [9000, 28],
    [10000, 60],
  ],
  turnLengthSec: [
    [0, 10],
    [2500, 60],
    [5000, 170],
    [7500, 670],
    [9000, 2200],
    [10000, 3600],
  ],
  idleGapSec: [
    [0, 5],
    [2500, 30],
    [5000, 120],
    [7500, 400],
    [9000, 1150],
    [10000, 3400],
  ],
}

/** Today's single turn shape: a call every few seconds, the idle gap set by the active share. */
export type FixedCadence = {
  kind: 'fixed'
  activeShareBp: number
  toolCallEverySec: number
  turnLengthSec: number
}
export type DistributionCadence = { kind: 'distribution'; name: string; cadence: Cadence }
export type CadenceSpec = FixedCadence | DistributionCadence

export const REFERENCE: DistributionCadence = {
  kind: 'distribution',
  name: 'reference',
  cadence: REFERENCE_CADENCE,
}

/** One turn: its length, the second into it of each tool call, and the idle gap after it. */
export type Turn = { lengthSec: number; calls: number[]; idleSec: number }

/** The value of a quantile table at a quantile in basis points, 0 to 9999. */
export function sample(q: Quantiles, bp: number): number {
  for (let i = 1; i < q.length; i++) {
    const [hiBp, hi] = q[i] ?? [0, 0]
    const [loBp, lo] = q[i - 1] ?? [0, 0]
    if (bp < hiBp || i === q.length - 1) {
      return Math.floor(lo + ((hi - lo) * (bp - loBp)) / (hiBp - loBp))
    }
  }
  return 0
}

/**
 * The turns a player plays, one per call, drawn from a generator of the scenario's own seed: a
 * run is reproducible. One draw sets both a turn's tool calls and its length, so a turn with many
 * calls is a long one; a second draw sets the idle gap. Calls are spread evenly through the turn.
 */
export function turnSource(spec: CadenceSpec, seed: number): () => Turn {
  if (spec.kind === 'fixed') {
    const lengthSec = spec.turnLengthSec
    const calls: number[] = []
    for (let t = spec.toolCallEverySec; t < lengthSec; t += spec.toolCallEverySec) calls.push(t)
    const idleSec = Math.floor((lengthSec * (10000 - spec.activeShareBp)) / spec.activeShareBp)
    return () => ({ lengthSec, calls: [...calls], idleSec })
  }
  // Its own stream, apart from the game state's, which starts at the same seed.
  let rng = (seed ^ 0xca5e7a11) >>> 0
  const drawBp = (): number => {
    const r = nextU32(rng)
    rng = r.s
    return r.u % 10000
  }
  const { cadence } = spec
  return () => {
    const turnBp = drawBp()
    const n = sample(cadence.toolCallsPerTurn, turnBp)
    const lengthSec = Math.max(1, sample(cadence.turnLengthSec, turnBp))
    const calls: number[] = []
    for (let i = 0; i < n; i++) calls.push(Math.floor(((i + 1) * lengthSec) / (n + 1)))
    return { lengthSec, calls, idleSec: sample(cadence.idleGapSec, drawBp()) }
  }
}

const TABLES = ['toolCallsPerTurn', 'turnLengthSec', 'idleGapSec'] as const

function checkQuantiles(name: string, value: unknown): Quantiles {
  const bad = (why: string) => new Error(`${name}: ${why}`)
  if (!Array.isArray(value) || value.length < 2) throw bad('needs two or more [bp, value] points')
  const q: Quantiles = []
  for (const point of value) {
    if (
      !Array.isArray(point) ||
      point.length !== 2 ||
      !point.every((x) => typeof x === 'number' && Number.isFinite(x) && x >= 0)
    ) {
      throw bad(`${JSON.stringify(point)} is not a [bp, value] pair of numbers at or above 0`)
    }
    const prev = q[q.length - 1]
    if (prev && (point[0] <= prev[0] || point[1] < prev[1])) {
      throw bad('quantiles must rise and values must not fall')
    }
    q.push([point[0], point[1]])
  }
  if (q[0]?.[0] !== 0 || q[q.length - 1]?.[0] !== 10000) throw bad('must run from 0 to 10000 bp')
  return q
}

/** A cadence from a JSON file in the shape of `Cadence`. Throws naming the table that is wrong. */
export function loadCadence(path: string): DistributionCadence {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
  const cadence = Object.fromEntries(
    TABLES.map((name) => [name, checkQuantiles(name, raw?.[name])]),
  ) as Cadence
  return { kind: 'distribution', name: path, cadence }
}
