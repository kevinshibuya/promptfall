import { describe, expect, it } from 'vitest'
import { hashState } from './hash'
import { createInitialState } from './state'
import { replay, step } from './step'
import type { Event, GameState, Rarity, ServerEvent, Slot } from './types'
import { RARITIES } from './types'

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

// Server events the ledger could author: a credit, a purchase of a fresh item, a listing.
function randomServerEvent(r: (n: number) => number, s: GameState): ServerEvent {
  const roll = r(3)
  if (roll === 0) return { t: 'credited', gold: 1 + r(500), reason: 'test' }
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
        affixes: [{ id: 'brutal', value: 1 + r(5) }],
        equippedBy: null,
        tradeableAt: r(100000),
      },
    },
    price: 1 + r(300),
  }
}

function randomEvent(r: (n: number) => number, s: GameState): Event {
  if (r(100) < 4) return randomServerEvent(r, s)
  const heroIds = s.roster.map((h) => h.id)
  const itemIds = s.inventory.map((i) => i.id)
  // One id in ten is junk, so rejections are exercised too.
  const heroId = r(10) === 0 ? 'hjunk' : pick(r, heroIds, 'h0')
  const itemId = r(10) === 0 ? 'ijunk' : pick(r, itemIds, 'i0')
  const roll = r(100)
  if (roll < 40) return { t: 'tick' }
  if (roll < 60) return { t: 'tool_call' }
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
