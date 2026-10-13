import type { Event, Item, WaveArchetype } from './types'

const GOLDEN_BOSS = 'wbgold'
const GOLDEN_REWARD: Item = {
  id: 'r0',
  base: 'steel_longsword',
  rarity: 'rare',
  tier: 2,
  affixes: [],
  equippedBy: null,
  tradeableAt: null,
}

export const GOLDEN_SEED = 20261002

/** The hints the script's tool calls carry in turn, an unhinted call among them. */
const HINTS: (WaveArchetype | null)[] = ['swift', null, 'brute', 'caster', null, 'tank']

/**
 * A fixed 300-event script mixing world events, commands, the reactive events
 * (every turn hasted, hinted calls, a mishap, a guard, a camp in boss mode and
 * one out of it) and a world boss stretch (engaged after turn 3, disengaged
 * after turn 6, a reward after turn 7). Ids are the ones the initial state
 * mints (h0 to h3) plus guesses, so some commands are rejected; rejections are
 * part of the contract too.
 */
export function goldenEvents(options: { boss?: boolean } = {}): Event[] {
  const boss = options.boss ?? true
  const events: Event[] = [
    { t: 'set_party', heroIds: ['h0', 'h3', 'h2'] },
    { t: 'set_farm', on: false },
    { t: 'recruit' },
  ]
  for (let turn = 0; events.length < 300; turn++) {
    events.push({ t: 'rest' })
    events.push({ t: 'turn_start' })
    for (let i = 0; i < 12 && events.length < 296; i++) {
      events.push({ t: 'tick' })
      if (i % 3 === 0) {
        const hint = HINTS[(turn + i / 3) % HINTS.length] ?? null
        events.push(hint ? { t: 'tool_call', hint } : { t: 'tool_call' })
      }
      if (i === 4 && turn % 2 === 1) events.push({ t: 'tool_mishap' })
      if (i === 6 && turn === 8) events.push({ t: 'guard', on: true })
      if (i === 10 && turn === 8) events.push({ t: 'guard', on: false })
    }
    events.push({ t: 'turn_end' })
    if (turn === 5 || turn === 9) events.push({ t: 'camp' })
    if (boss && turn === 3) {
      events.push({
        t: 'boss_engaged',
        bossId: GOLDEN_BOSS,
        name: 'Golden Wyrm',
        glyph: '☠',
        stats: { hp: 630, atk: 14, def: 4, spd: 5 },
      })
    }
    if (boss && turn === 6) events.push({ t: 'boss_disengaged', bossId: GOLDEN_BOSS })
    if (boss && turn === 7) {
      events.push({
        t: 'rewarded',
        bossId: GOLDEN_BOSS,
        goods: { kind: 'item', item: GOLDEN_REWARD },
        gold: 45,
      })
    }
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
export const GOLDEN_HASH = '62144fd6f78c2048'
