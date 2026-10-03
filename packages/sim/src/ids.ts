import type { GameState } from './types'

export function nextId(
  state: GameState,
  prefix: 'h' | 'i' | 'e',
): { state: GameState; id: string } {
  return {
    state: { ...state, counter: state.counter + 1 },
    id: prefix + state.counter.toString(36),
  }
}
