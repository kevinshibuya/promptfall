import { describe, expect, it } from 'vitest'
import { bossInRebase } from './boss-in'

describe('bossInRebase', () => {
  it('moves the clock forward to put the next grid point that many real seconds away', () => {
    expect(bossInRebase(1_700_000_000_000, 60, 10)).toBe(1_700_005_800_000)
  })

  it('answers null when the next grid point is already nearer', () => {
    expect(bossInRebase(1_700_006_399_000, 60, 10)).toBeNull()
  })
})
