import { describe, expect, it } from 'vitest'
import { weekStartOf } from './world'

const MONDAY = Date.UTC(2023, 10, 13) // Monday 13 November 2023, 00:00 UTC
const WEEK = 7 * 86_400_000

describe('weekStartOf', () => {
  it('answers a Monday 00:00 UTC for itself', () => {
    expect(new Date(MONDAY).getUTCDay()).toBe(1)
    expect(weekStartOf(MONDAY)).toBe(MONDAY)
  })

  it('answers the previous Monday one ms before', () => {
    expect(weekStartOf(MONDAY - 1)).toBe(MONDAY - WEEK)
  })

  it('answers the Monday before a Thursday', () => {
    const thursday = Date.UTC(2023, 10, 16, 15, 30)
    expect(weekStartOf(thursday)).toBe(MONDAY)
    expect(weekStartOf(0)).toBe(Date.UTC(1969, 11, 29))
  })
})
