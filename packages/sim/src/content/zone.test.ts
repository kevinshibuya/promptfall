import { describe, expect, it } from 'vitest'
import { LADDER_END, zoneAt } from '../index'
import { content } from './index'

describe('zoneAt', () => {
  it('answers zone 1 as tier 1, base zone 1, with its content', () => {
    expect(zoneAt(1)).toEqual({ base: 1, tier: 1, def: content.zones[0] })
    expect(zoneAt(1)?.def.name).toBe('Greenmeadow Road')
  })

  it('answers zone 12 as tier 1, base zone 12', () => {
    expect(zoneAt(12)).toEqual({ base: 12, tier: 1, def: content.zones[11] })
    expect(zoneAt(12)?.def.name).toBe('The Unwritten Reach')
  })

  it('answers zone 13 as tier 2, base zone 1, with zone 1 content', () => {
    expect(zoneAt(13)).toEqual({ base: 1, tier: 2, def: content.zones[0] })
  })

  it('answers zone 36 as tier 3, base zone 12', () => {
    expect(zoneAt(36)).toMatchObject({ base: 12, tier: 3 })
  })

  it('answers nothing for a zone below 1 or not a whole number', () => {
    expect(zoneAt(0)).toBeUndefined()
    expect(zoneAt(-3)).toBeUndefined()
    expect(zoneAt(1.5)).toBeUndefined()
    expect(zoneAt(Number.NaN)).toBeUndefined()
  })
})

describe('LADDER_END', () => {
  it('is zone 12 for now', () => {
    expect(LADDER_END).toBe(12)
  })
})
