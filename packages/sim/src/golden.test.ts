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
  it('replays to the golden hash', () => {
    const r = replay(createInitialState(GOLDEN_SEED), goldenEvents())
    expect(hashState(r.state)).toBe(GOLDEN_HASH)
  })

  // hit, act and heal are output only: effects are not part of the state the hash reads.
  it('the replay reports hits, actions and heals without moving the hash', () => {
    const r = replay(createInitialState(GOLDEN_SEED), goldenEvents())
    expect(GOLDEN_HASH).toBe('0343e76688254278')
    expect(r.effects.some((e) => e.k === 'hit')).toBe(true)
    expect(r.effects.some((e) => e.k === 'act')).toBe(true)
    expect(r.effects.some((e) => e.k === 'heal')).toBe(true)
  })
})
