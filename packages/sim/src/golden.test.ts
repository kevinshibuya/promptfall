import { describe, expect, it } from 'vitest'
import { GOLDEN_HASH, GOLDEN_HASH_V2, GOLDEN_SEED, goldenEvents } from './golden'
import { hashState } from './hash'
import { createInitialState } from './state'
import { replay } from './step'

describe('golden replay', () => {
  it('has 300 events', () => {
    expect(goldenEvents()).toHaveLength(300)
  })

  // GOLDEN_HASH pins the rules and the content. Changing the literal requires bumping SIM_VERSION.
  // Boss mode is the only change of SIM_VERSION 3: without boss events the v2 script must land on
  // the v2 state exactly, which pins the draw order of ordinary drops, combat and every other path.
  it('the boss-free script still reaches the v2 golden state, boss field aside', () => {
    const { boss, ...rest } = replay(
      createInitialState(GOLDEN_SEED),
      goldenEvents({ boss: false }),
    ).state
    expect(boss).toBeNull()
    expect(hashState({ ...rest, v: 2 } as never)).toBe(GOLDEN_HASH_V2)
  })

  it('replays to the golden hash', () => {
    const r = replay(createInitialState(GOLDEN_SEED), goldenEvents())
    expect(hashState(r.state)).toBe(GOLDEN_HASH)
  })
})
