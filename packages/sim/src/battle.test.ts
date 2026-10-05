import { describe, expect, it } from 'vitest'
import { FILL_BP, FILL_K, fill, GAUGE_FULL, STEP_MS, TICK_MS } from './battle'

describe('battle constants', () => {
  it('runs 20 steps of 100 ms per tick', () => {
    expect(TICK_MS / STEP_MS).toBe(20)
  })

  it('fills a speed 5 gauge in 40 steps', () => {
    expect(fill(5)).toBe(250)
    expect(Math.ceil(GAUGE_FULL / fill(5))).toBe(40)
  })

  it('never fills less than 1 per step', () => {
    expect(fill(0)).toBeGreaterThanOrEqual(1)
    expect(fill(-FILL_K)).toBe(1)
  })

  it('stays integer for every speed', () => {
    for (let spd = 0; spd <= 40; spd++) {
      expect(Number.isInteger(fill(spd))).toBe(true)
      expect(fill(spd)).toBe(Math.max(1, Math.floor(((spd + FILL_K) * FILL_BP) / 1000)))
    }
  })
})
