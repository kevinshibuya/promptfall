import { expect, test } from 'claude-code/testing'
import {
  createInitialState,
  GOLDEN_HASH,
  GOLDEN_SEED,
  goldenEvents,
  hashState,
  replay,
} from './vendor/sim.js'

// The same literal holds under vitest (packages/sim) and here, in the mod
// runtime: the cross-engine determinism check.
test('the vendored sim replays the golden script to the golden hash', () => {
  const r = replay(createInitialState(GOLDEN_SEED), goldenEvents())
  expect(hashState(r.state)).toBe(GOLDEN_HASH)
})
