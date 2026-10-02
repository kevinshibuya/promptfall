import { resolveRound } from './combat'
import {
  clone,
  onRest,
  onToolCall,
  onTurnEnd,
  refillFromQueue,
  spawnOnEmptyTick,
} from './progression'
import type { Effect, Event, EventKind, GameState, StepResult } from './types'

export type Handler<K extends EventKind> = (
  state: GameState,
  event: Extract<Event, { t: K }>,
) => StepResult

export type Handlers = { [K in EventKind]: Handler<K> }

export function reject(state: GameState, event: Event, reason: string): StepResult {
  return { state, effects: [{ k: 'rejected', event, reason }] }
}

const notImplemented = (state: GameState, event: Event): StepResult =>
  reject(state, event, 'not_implemented')

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

const handlers: Handlers = {
  tick: (state) =>
    draft(state, (s, effects) => {
      refillFromQueue(s)
      if (s.encounter && s.encounter.enemies.length > 0) resolveRound(s, effects)
      else spawnOnEmptyTick(s, effects)
    }),
  tool_call: (state) => draft(state, (s) => onToolCall(s)),
  turn_end: (state) => draft(state, (s) => onTurnEnd(s)),
  rest: (state) => draft(state, (s) => onRest(s)),
  equip: notImplemented,
  unequip: notImplemented,
  vendor: notImplemented,
  reforge: notImplemented,
  set_party: notImplemented,
  recruit: notImplemented,
  dismiss: notImplemented,
  set_farm: notImplemented,
  expand_inventory: notImplemented,
  expand_roster: notImplemented,
}

export function step(state: GameState, event: Event): StepResult {
  const handler = handlers[event.t] as Handler<EventKind> | undefined
  if (!handler) return reject(state, event, 'unknown_event')
  return handler(state, event as never)
}

export function replay(state: GameState, events: readonly Event[]): StepResult {
  let current = state
  const effects: Effect[] = []
  for (const event of events) {
    const r = step(current, event)
    current = r.state
    for (const e of r.effects) effects.push(e)
  }
  return { state: current, effects }
}
