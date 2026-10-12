import { describe, expect, it } from 'vitest'
import { GOLDEN_HASH, GOLDEN_SEED, goldenEvents } from './golden'
import { hashState } from './hash'
import { createInitialState } from './state'
import { replay } from './step'

describe('golden replay', () => {
  it('has 300 events', () => {
    expect(goldenEvents()).toHaveLength(300)
  })

  // GOLDEN_HASH pins the rules and the content. Changing the literal requires bumping SIM_VERSION.
  // SIM_VERSION 4 (combat flow) changed the draw order of every fight, so the v2 pin is gone.
  // SIM_VERSION 5 (turn boss mid-wave, boss-mode wipe) moves it through `v` alone: the script
  // reaches neither path.
  // SIM_VERSION 6 (ratio mitigation, gentler enemy growth, the flatter xp curve) changes every hit
  // and every level-up, so the script lands elsewhere.
  // SIM_VERSION 7 (hero rarity multiplies base stats and growth) moves it through `v` alone: the
  // script's heroes are all Common and it never leaves zone 1.
  // SIM_VERSION 8 (an item carries its tier; affixes scale at read) moves it through `v` and each
  // item's tier: the script's one affix is on a tier-1 charm, so no stat changes.
  // SIM_VERSION 9 (a wipe restarts the zone, the third is a retreat; rests heal 50%) moves it
  // through every rest and the zone's wipe count: the script wipes eight times in zone 1.
  it('replays to the golden hash', () => {
    const r = replay(createInitialState(GOLDEN_SEED), goldenEvents())
    expect(hashState(r.state)).toBe(GOLDEN_HASH)
  })

  // hit, act and heal are output only: effects are not part of the state the hash reads.
  it('the replay reports hits, actions and heals without moving the hash', () => {
    const r = replay(createInitialState(GOLDEN_SEED), goldenEvents())
    expect(GOLDEN_HASH).toBe('c4b9d7bc0e818a92')
    expect(r.effects.some((e) => e.k === 'hit')).toBe(true)
    expect(r.effects.some((e) => e.k === 'act')).toBe(true)
    expect(r.effects.some((e) => e.k === 'heal')).toBe(true)
  })
})
