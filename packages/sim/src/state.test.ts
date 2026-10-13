import { describe, expect, it } from 'vitest'
import { createInitialState } from './state'
import { replay, step } from './step'
import type { Event } from './types'
import { SIM_VERSION } from './types'

describe('createInitialState', () => {
  const s = createInitialState(1234)

  it('matches the global starting constraints', () => {
    expect(s.v).toBe(SIM_VERSION)
    expect(s.seed).toBe(1234)
    expect(s.rng).toBe(1234)
    expect(s.gold).toBe(0)
    expect(s.zone).toBe(1)
    expect(s.wave).toBe(1)
    expect(s.highestZone).toBe(1)
    expect(s.farm).toBe(false)
    expect(s.inventoryCap).toBe(30)
    expect(s.rosterCap).toBe(24)
    expect(s.inventory).toEqual([])
    expect(s.pendingParty).toBeNull()
    expect(s.turnToolCalls).toBe(0)
    expect(s.encounter).toBeNull()
    expect(s.pendingTurnBoss).toBe(false)
    expect(s.lootLog).toEqual([])
    expect(s.stats).toEqual({ kills: 0, bosses: 0, wipes: 0 })
  })

  it('is version 15 with an empty battle, no wipes in its zone, auto-vendor, Haste and Guard off', () => {
    expect(s.v).toBe(15)
    expect(s.hasteTicks).toBe(0)
    expect(s.guardTicks).toBe(0)
    expect(s.zoneWipes).toBe(0)
    expect(s.autoVendor).toBe(false)
    expect(s.battle).toEqual({ gauges: [], queue: [], busy: 0 })
  })

  it('has one common hero per class', () => {
    expect(s.roster.map((h) => [h.template, h.cls])).toEqual([
      ['knight_1', 'knight'],
      ['black_mage_1', 'black_mage'],
      ['white_mage_1', 'white_mage'],
      ['archer_1', 'archer'],
    ])
    for (const h of s.roster) {
      expect(h.rarity).toBe('common')
      expect(h.level).toBe(1)
      expect(h.xp).toBe(0)
      expect(h.hp).toBeGreaterThan(0)
      expect(h.traits).toEqual([])
      expect(h.equipment).toEqual({ weapon: null, armour: null, accessory: null })
    }
    expect(new Set(s.roster.map((h) => h.id)).size).toBe(4)
  })

  it('starts with Knight, Black Mage, White Mage in the party', () => {
    const cls = s.party.map((id) => s.roster.find((h) => h.id === id)?.cls)
    expect(cls).toEqual(['knight', 'black_mage', 'white_mage'])
  })

  it('is a pure function of the seed', () => {
    expect(createInitialState(1234)).toEqual(s)
  })
})

describe('step and replay', () => {
  it('rejects an unknown hero without changing state', () => {
    const s = createInitialState(1)
    const r = step(s, { t: 'dismiss', heroId: 'nope' })
    expect(r.state).toBe(s)
    expect(r.effects).toHaveLength(1)
    expect(r.effects[0]?.k).toBe('rejected')
  })

  it('replay folds step and concatenates effects', () => {
    const s = createInitialState(1)
    const events: [Event, Event] = [{ t: 'rest' }, { t: 'rest' }]
    const r = replay(s, events)
    const a = step(s, events[0])
    const b = step(a.state, events[1])
    expect(r.state).toEqual(b.state)
    expect(r.effects).toEqual([...a.effects, ...b.effects])
  })
})
