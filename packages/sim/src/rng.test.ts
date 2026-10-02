import { describe, expect, it } from 'vitest'
import { nextU32, pickWeighted, roll, rollBp } from './rng'
import { createInitialState } from './state'

describe('nextU32', () => {
  it('matches the mulberry32 reference sequence from seed 1', () => {
    let s = 1
    const out: number[] = []
    for (let i = 0; i < 5; i++) {
      const r = nextU32(s)
      s = r.s
      out.push(r.u)
    }
    expect(out).toEqual(REFERENCE)
  })
})

describe('roll', () => {
  it('stays in [0, n)', () => {
    let state = createInitialState(42)
    for (const n of [1, 2, 3, 7, 10000, 2 ** 31]) {
      for (let i = 0; i < 500; i++) {
        const r = roll(state, n)
        state = r.state
        expect(r.value).toBeGreaterThanOrEqual(0)
        expect(r.value).toBeLessThan(n)
        expect(Number.isInteger(r.value)).toBe(true)
      }
    }
  })

  it('advances the rng without mutating the input', () => {
    const state = createInitialState(9)
    const before = state.rng
    const r = roll(state, 6)
    expect(state.rng).toBe(before)
    expect(r.state.rng).not.toBe(before)
  })

  it('rollBp stays in [0, 10000)', () => {
    let state = createInitialState(3)
    for (let i = 0; i < 500; i++) {
      const r = rollBp(state)
      state = r.state
      expect(r.value).toBeGreaterThanOrEqual(0)
      expect(r.value).toBeLessThan(10000)
    }
  })
})

describe('pickWeighted', () => {
  it('ignores key insertion order', () => {
    let state = createInitialState(5)
    for (let i = 0; i < 100; i++) {
      const a = pickWeighted(state, { b: 1, a: 1 })
      const b = pickWeighted(state, { a: 1, b: 1 })
      expect(a.value).toBe(b.value)
      expect(a.state.rng).toBe(b.state.rng)
      state = a.state
    }
  })

  it('never picks a zero weight key', () => {
    let state = createInitialState(11)
    for (let i = 0; i < 300; i++) {
      const r = pickWeighted(state, { a: 0, b: 5, c: 0 })
      state = r.state
      expect(r.value).toBe('b')
    }
  })
})

// Recorded once from the reference mulberry32 implementation.
const REFERENCE = [2693262067, 11749833, 2265367787, 4213581821, 4159151403]
