import { advanceBattle } from './combat'
import {
  dismiss,
  equip,
  expandInventory,
  expandRoster,
  recruit,
  reforge,
  setFarm,
  setParty,
  unequip,
  vendor,
} from './commands'
import { draft, reject } from './draft'
import { onRest, onToolCall, onTurnEnd, refillFromQueue, spawnOnEmptyTick } from './progression'
import {
  bossDisengaged,
  bossEngaged,
  bought,
  credited,
  listed,
  orderFilled,
  orderPlaced,
  orderRefunded,
  orderSold,
  returned,
  rewarded,
  sandboxBoss,
  sandboxItem,
  sandboxLevel,
  sandboxRecruit,
  sandboxWipe,
  sandboxZone,
  sold,
} from './server-events'
import type { Effect, Event, EventKind, GameState, StepResult } from './types'

export type Handler<K extends EventKind> = (
  state: GameState,
  event: Extract<Event, { t: K }>,
) => StepResult

export type Handlers = { [K in EventKind]: Handler<K> }

const handlers: Handlers = {
  tick: (state) =>
    draft(state, (s, effects) => {
      refillFromQueue(s)
      if (s.encounter && s.encounter.enemies.length > 0) advanceBattle(s, effects)
      else {
        spawnOnEmptyTick(s, effects)
        // A whole tick of battle time passed with nobody fighting.
        s.battle.busy = 0
      }
    }),
  tool_call: (state) => draft(state, (s) => onToolCall(s)),
  turn_end: (state) => draft(state, (s) => onTurnEnd(s)),
  rest: (state) => draft(state, (s) => onRest(s)),
  equip,
  unequip,
  vendor,
  reforge,
  set_party: setParty,
  recruit,
  dismiss,
  set_farm: setFarm,
  expand_inventory: expandInventory,
  expand_roster: expandRoster,
  listed,
  returned,
  sold,
  bought,
  order_placed: orderPlaced,
  order_refunded: orderRefunded,
  order_filled: orderFilled,
  order_sold: orderSold,
  credited,
  boss_engaged: bossEngaged,
  boss_disengaged: bossDisengaged,
  rewarded,
  sandbox_boss: sandboxBoss,
  sandbox_item: sandboxItem,
  sandbox_level: sandboxLevel,
  sandbox_zone: sandboxZone,
  sandbox_recruit: sandboxRecruit,
  sandbox_wipe: sandboxWipe,
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
