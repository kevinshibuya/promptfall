import { describe, expect, it } from 'vitest'
import { hashState } from './hash'
import { createInitialState } from './state'
import { replay, step } from './step'
import type { Event, GameState, Rarity, SandboxEvent, ServerEvent, Slot } from './types'
import { RARITIES, SANDBOX_EVENT_KINDS, WAVE_ARCHETYPES } from './types'

// An xorshift32 independent of the sim's PRNG.
function makeRandom(seed: number): (n: number) => number {
  let x = seed >>> 0 || 1
  return (n: number) => {
    x ^= x << 13
    x >>>= 0
    x ^= x >>> 17
    x ^= x << 5
    x >>>= 0
    return x % n
  }
}

const SLOTS: Slot[] = ['weapon', 'armour', 'accessory']

function pick<T>(r: (n: number) => number, list: readonly T[], fallback: T): T {
  return list.length > 0 ? (list[r(list.length)] ?? fallback) : fallback
}

// A sandbox grant, with junk ids, out-of-range zones and levels so its refusals run too.
function randomSandboxEvent(r: (n: number) => number, s: GameState): SandboxEvent {
  const zone = r(14)
  const rarity: Rarity = pick(r, RARITIES, 'rare')
  switch (pick(r, SANDBOX_EVENT_KINDS, 'sandbox_wipe')) {
    case 'sandbox_boss':
      return { t: 'sandbox_boss', zone, boss: r(2) === 0 ? 'zone_boss' : 'turn_boss' }
    case 'sandbox_item':
      return { t: 'sandbox_item', base: r(10) === 0 ? 'junk' : 'oak_staff', rarity }
    case 'sandbox_level': {
      const heroId =
        r(10) === 0
          ? 'hjunk'
          : pick(
              r,
              s.roster.map((h) => h.id),
              'h0',
            )
      return { t: 'sandbox_level', heroId, level: r(55) }
    }
    case 'sandbox_zone':
      return { t: 'sandbox_zone', zone }
    case 'sandbox_recruit':
      return { t: 'sandbox_recruit', rarity }
    case 'sandbox_wipe':
      return { t: 'sandbox_wipe' }
  }
}

// Server events the ledger could author: a credit, a purchase of a fresh item, a listing,
// boss mode, a sandbox grant.
function randomServerEvent(r: (n: number) => number, s: GameState): ServerEvent {
  const roll = r(7)
  if (roll === 0) return { t: 'credited', gold: 1 + r(500), reason: 'test' }
  if (roll === 6) return randomSandboxEvent(r, s)
  // While engaged, a second boss_engaged exercises already_engaged.
  if (roll === 3) {
    return {
      t: 'boss_engaged',
      bossId: `wb${r(1000)}`,
      name: 'Wyrm',
      glyph: '☠',
      stats: { hp: 630, atk: 14, def: 4, spd: 5 },
    }
  }
  if (roll === 4) {
    const bossId = r(10) === 0 ? 'wbjunk' : (s.boss?.bossId ?? 'wbjunk')
    return { t: 'boss_disengaged', bossId }
  }
  if (roll === 5) {
    if (r(2) === 0) return { t: 'rewarded', bossId: 'wb1', goods: null, gold: 1 + r(200) }
    return {
      t: 'rewarded',
      bossId: 'wb1',
      goods: {
        kind: 'item',
        item: {
          id: `r${s.tick.toString(36)}x${r(1000)}`,
          base: 'steel_longsword',
          rarity: pick(r, RARITIES, 'rare'),
          tier: 2,
          affixes: [],
          equippedBy: null,
          tradeableAt: null,
        },
      },
      gold: 1 + r(200),
    }
  }
  const itemId =
    r(10) === 0
      ? 'ijunk'
      : pick(
          r,
          s.inventory.map((i) => i.id),
          'i0',
        )
  if (roll === 1)
    return { t: 'listed', listingId: `L${r(1000)}`, kind: 'item', id: itemId, fee: 1 + r(50) }
  const rarity: Rarity = pick(r, RARITIES, 'rare')
  return {
    t: 'bought',
    listingId: `L${r(1000)}`,
    goods: {
      kind: 'item',
      item: {
        id: `t${s.tick.toString(36)}x${r(1000)}`,
        base: 'steel_longsword',
        rarity,
        tier: 2,
        affixes: [{ id: 'brutal', value: 1 + r(5) }],
        equippedBy: null,
        tradeableAt: r(100000),
      },
    },
    price: 1 + r(300),
  }
}

function randomEvent(r: (n: number) => number, s: GameState): Event {
  // 8%: boss stretches last long enough for ticks to land on the boss.
  if (r(100) < 8) return randomServerEvent(r, s)
  const heroIds = s.roster.map((h) => h.id)
  const itemIds = s.inventory.map((i) => i.id)
  // One id in ten is junk, so rejections are exercised too.
  const heroId = r(10) === 0 ? 'hjunk' : pick(r, heroIds, 'h0')
  const itemId = r(10) === 0 ? 'ijunk' : pick(r, itemIds, 'i0')
  const roll = r(100)
  if (roll < 40) return { t: 'tick' }
  if (roll < 60) {
    // The reactive events ride the tool call's share: a third of it.
    const kind = r(15)
    if (kind < 10) return { t: 'tool_call' }
    if (kind === 10) return { t: 'tool_call', hint: pick(r, WAVE_ARCHETYPES, 'tank') }
    if (kind === 11) return { t: 'turn_start' }
    if (kind === 12) return { t: 'tool_mishap' }
    if (kind === 13) return { t: 'guard', on: r(2) === 0 }
    return { t: 'camp' }
  }
  if (roll < 64) return { t: 'turn_end' }
  if (roll < 67) return { t: 'rest' }
  if (roll < 74) return { t: 'equip', heroId, itemId }
  if (roll < 77) return { t: 'unequip', heroId, slot: pick(r, SLOTS, 'weapon') }
  if (roll < 81) return { t: 'vendor', itemId }
  if (roll < 84) return { t: 'reforge', itemId, affixIndex: r(5) - 1 }
  if (roll < 87) {
    return {
      t: 'set_party',
      heroIds: [pick(r, heroIds, 'h0'), pick(r, heroIds, 'h1'), pick(r, heroIds, 'h2')],
    }
  }
  if (roll < 90) return { t: 'recruit' }
  if (roll < 93) return { t: 'dismiss', heroId }
  if (roll < 96) return { t: 'set_farm', on: r(2) === 0 }
  if (roll < 98) return { t: 'expand_inventory' }
  return { t: 'expand_roster' }
}

describe('determinism', () => {
  it('1000 random sequences replay identically, incrementally, and through JSON', () => {
    const r = makeRandom(0xc0ffee)
    for (let n = 0; n < 1000; n++) {
      const seed = r(0xffffffff)
      const initial = createInitialState(seed)
      // Rich states give commands something to bite on.
      const start: GameState = n % 3 === 0 ? { ...initial, gold: 5000 + r(50000) } : initial
      const length = 1 + r(500)
      const events: Event[] = []
      let s = start
      for (let i = 0; i < length; i++) {
        const e = randomEvent(r, s)
        events.push(e)
        s = step(s, e).state // never throws, or the test fails here
      }
      const a = replay(start, events)
      const b = replay(start, events)
      expect(hashState(a.state)).toBe(hashState(b.state))
      expect(hashState(a.state)).toBe(hashState(s))
      expect(hashState(JSON.parse(JSON.stringify(a.state)))).toBe(hashState(a.state))
    }
  }, 120_000)

  it('step does not mutate its input', () => {
    const r = makeRandom(42)
    let s = { ...createInitialState(5), gold: 20000 }
    for (let i = 0; i < 2000; i++) {
      const frozen = JSON.stringify(s)
      const e = randomEvent(r, s)
      const next = step(s, e).state
      expect(JSON.stringify(s)).toBe(frozen)
      s = next
    }
  })
})
