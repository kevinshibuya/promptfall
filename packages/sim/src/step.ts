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

const handlers: Handlers = {
  tick: notImplemented,
  tool_call: notImplemented,
  turn_end: notImplemented,
  rest: notImplemented,
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
