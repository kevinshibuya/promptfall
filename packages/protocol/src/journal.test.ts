import { describe, expect, it } from 'vitest'
import { DAY_MS, dayOf, nextMonday, weekdayOf } from './journal'

describe('the journal calendar', () => {
  it('counts UTC days from the epoch, which fell on a Thursday', () => {
    expect(dayOf(0)).toBe(0)
    expect(dayOf(DAY_MS - 1)).toBe(0)
    expect(dayOf(DAY_MS)).toBe(1)
    expect(weekdayOf(0)).toBe(4)
    // 20 November 2023 was a Monday; the 26th a Sunday.
    expect(weekdayOf(dayOf(Date.UTC(2023, 10, 20)))).toBe(1)
    expect(weekdayOf(dayOf(Date.UTC(2023, 10, 26)))).toBe(7)
  })

  it("names the next Monday: a Monday's is a week on", () => {
    const monday = dayOf(Date.UTC(2023, 10, 20))
    for (let d = monday; d < monday + 7; d++) expect(nextMonday(d)).toBe(monday + 7)
    expect(weekdayOf(nextMonday(monday + 3))).toBe(1)
  })
})
