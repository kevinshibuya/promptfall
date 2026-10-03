import type { Event } from './types'

export const GOLDEN_SEED = 20261002

/**
 * A fixed 300-event script mixing world events and commands. Ids are the ones
 * the initial state mints (h0 to h3) plus guesses, so some commands are
 * rejected; rejections are part of the contract too.
 */
export function goldenEvents(): Event[] {
  const events: Event[] = [
    { t: 'set_party', heroIds: ['h0', 'h3', 'h2'] },
    { t: 'set_farm', on: false },
    { t: 'recruit' },
  ]
  for (let turn = 0; events.length < 300; turn++) {
    events.push({ t: 'rest' })
    for (let i = 0; i < 12 && events.length < 296; i++) {
      events.push({ t: 'tick' })
      if (i % 3 === 0) events.push({ t: 'tool_call' })
    }
    events.push({ t: 'turn_end' })
    if (turn === 2) events.push({ t: 'equip', heroId: 'h0', itemId: 'i10' })
    if (turn === 4) events.push({ t: 'set_party', heroIds: ['h0', 'h1', 'h2'] })
    if (turn === 5) events.push({ t: 'dismiss', heroId: 'h3' })
    if (turn === 6) events.push({ t: 'expand_inventory' })
    if (turn === 7) events.push({ t: 'set_farm', on: true })
    if (turn === 8) events.push({ t: 'vendor', itemId: 'i20' })
    if (turn === 9) events.push({ t: 'unequip', heroId: 'h0', slot: 'weapon' })
    if (turn === 10) events.push({ t: 'reforge', itemId: 'i10', affixIndex: 0 })
    if (turn === 11) events.push({ t: 'recruit' })
    if (turn === 12) events.push({ t: 'expand_roster' })
    if (turn === 13) {
      for (const heroId of ['h0', 'h1', 'h2', 'h3'])
        events.push({ t: 'equip', heroId, itemId: 'i9' })
    }
  }
  return events.slice(0, 300)
}

// Changing this literal is a change of the simulation: bump SIM_VERSION with it.
export const GOLDEN_HASH = '261e337c034123fa'
