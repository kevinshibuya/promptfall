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
  it('replays to the golden hash', () => {
    const r = replay(createInitialState(GOLDEN_SEED), goldenEvents())
    expect(hashState(r.state)).toBe(GOLDEN_HASH)
  })
})
