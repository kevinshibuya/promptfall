import type { EnemyDef } from './content/types'
import type { GameState, StepResult } from './types'

/** Stub until the loot rules land: no drops. */
export function rollDrops(state: GameState, _def: EnemyDef): StepResult {
  return { state, effects: [] }
}
