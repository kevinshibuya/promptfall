import type { GameState } from './types'

export function nextU32(s: number): { s: number; u: number } {
  s = (s + 0x6d2b79f5) >>> 0
  let t = s
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return { s, u: (t ^ (t >>> 14)) >>> 0 }
}

/** A value in [0, n), n >= 1. Modulo bias is accepted: determinism is the point. */
export function roll(state: GameState, n: number): { state: GameState; value: number } {
  const { s, u } = nextU32(state.rng)
  const bound = Math.max(1, Math.floor(n))
  return { state: { ...state, rng: s }, value: u % bound }
}

export function rollBp(state: GameState): { state: GameState; value: number } {
  return roll(state, 10000)
}

/** Keys are visited in UTF-16 code unit order so every engine agrees. */
export function sortedKeys<K extends string>(record: Record<K, unknown>): K[] {
  return (Object.keys(record) as K[]).sort(compareCodeUnits)
}

export function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

export function pickWeighted<K extends string>(
  state: GameState,
  weights: Record<K, number>,
): { state: GameState; value: K } {
  const keys = sortedKeys(weights)
  let total = 0
  for (const k of keys) total += Math.max(0, weights[k])
  if (total <= 0 || keys.length === 0) {
    throw new Error('pickWeighted: no positive weight')
  }
  const r = roll(state, total)
  let acc = 0
  for (const k of keys) {
    acc += Math.max(0, weights[k])
    if (r.value < acc) return { state: r.state, value: k }
  }
  // unreachable: r.value < total
  return { state: r.state, value: keys[keys.length - 1] as K }
}
