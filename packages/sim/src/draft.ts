import type { Effect, Event, GameState, StepResult } from './types'

// Draft helpers: handlers clone the state once, then mutate the clone.

export function clone<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => clone(v)) as T
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value)) out[key] = clone((value as Record<string, unknown>)[key])
    return out as T
  }
  return value
}

export function reject(state: GameState, event: Event, reason: string): StepResult {
  return { state, effects: [{ k: 'rejected', event, reason }] }
}

/** Runs `mutate` on a deep copy of the state. */
export function draft(
  state: GameState,
  mutate: (s: GameState, effects: Effect[]) => void,
): StepResult {
  const s = clone(state)
  const effects: Effect[] = []
  mutate(s, effects)
  return { state: s, effects }
}
