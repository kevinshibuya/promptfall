import { describe, expect, it } from 'vitest'
import { LADDER_END } from './content'
import { createInitialState } from './state'
import { step } from './step'
import type { Effect, GameState } from './types'

function rejectedReason(effects: Effect[]): string | undefined {
  const e = effects.find((x) => x.k === 'rejected')
  return e?.k === 'rejected' ? e.reason : undefined
}

const s0 = createInitialState(1)
const [knight, blackMage, whiteMage, archer] = s0.roster
if (!knight || !blackMage || !whiteMage || !archer) throw new Error('roster')

/** Mid-fight in zone 3 of the five reached, a wipe behind it, a party change waiting. */
const fighting: GameState = (() => {
  let s: GameState = { ...s0, zone: 3, highestZone: 5, wave: 4, zoneWipes: 2 }
  for (const t of ['tool_call', 'tool_call', 'tick'] as const) s = step(s, { t }).state
  if (!s.encounter || s.encounter.enemies.length === 0) throw new Error('no fight')
  return { ...s, pendingParty: [knight.id, blackMage.id, archer.id] }
})()

describe('travel', () => {
  it('to a reached zone ends the fight with no drop and no XP and starts the zone at wave 1', () => {
    const r = step(fighting, { t: 'travel', zone: 2 })
    expect(rejectedReason(r.effects)).toBeUndefined()
    expect(r.state.zone).toBe(2)
    expect(r.state.wave).toBe(1)
    expect(r.state.zoneWipes).toBe(0)
    expect(r.state.highestZone).toBe(5)
    expect(r.state.encounter).toBeNull()
    expect(r.state.battle).toEqual({ gauges: [], queue: [], busy: 0 })
    expect(r.state.gold).toBe(fighting.gold)
    expect(r.state.inventory).toEqual(fighting.inventory)
    expect(r.state.roster.map((h) => [h.level, h.xp])).toEqual(
      fighting.roster.map((h) => [h.level, h.xp]),
    )
    expect(r.state.stats).toEqual(fighting.stats)
    for (const k of ['drop', 'drop_vendored', 'gold', 'level_up'] as const) {
      expect(r.effects.some((e) => e.k === k)).toBe(false)
    }
  })

  it('applies the pending party and emits traveled with from and to', () => {
    const r = step(fighting, { t: 'travel', zone: 5 })
    expect(r.state.party).toEqual([knight.id, blackMage.id, archer.id])
    expect(r.state.pendingParty).toBeNull()
    expect(r.effects).toEqual([
      { k: 'traveled', from: 3, to: 5 },
      { k: 'party_applied', heroIds: [knight.id, blackMage.id, archer.id] },
    ])
  })

  it('emits only traveled with no party waiting', () => {
    const r = step({ ...fighting, pendingParty: null }, { t: 'travel', zone: 1 })
    expect(r.effects).toEqual([{ k: 'traveled', from: 3, to: 1 }])
  })

  it('takes a retreated party straight back', () => {
    let s: GameState = { ...s0, zone: 4, highestZone: 4, zoneWipes: 2 }
    s = step(s, { t: 'sandbox_wipe' }).state
    expect(s.zone).toBe(3)
    const r = step(s, { t: 'travel', zone: 4 })
    expect(r.state.zone).toBe(4)
    expect(r.effects).toContainEqual({ k: 'traveled', from: 3, to: 4 })
  })

  it('is refused below 1, past the highest zone reached, to the current zone and in boss mode', () => {
    const cases: [GameState, number, string][] = [
      [fighting, 0, 'zone_below_1'],
      [fighting, -2, 'zone_below_1'],
      [fighting, 6, 'zone_not_reached'],
      [fighting, 3, 'already_in_zone'],
    ]
    for (const [state, zone, reason] of cases) {
      const r = step(state, { t: 'travel', zone })
      expect(rejectedReason(r.effects)).toBe(reason)
      expect(r.state).toBe(state)
    }
    const engaged = step(fighting, {
      t: 'boss_engaged',
      bossId: 'wb1',
      name: 'The Promptwyrm',
      glyph: '☠',
      stats: { hp: 630, atk: 14, def: 4, spd: 5 },
    }).state
    const r = step(engaged, { t: 'travel', zone: 2 })
    expect(rejectedReason(r.effects)).toBe('boss_mode')
    expect(r.state).toBe(engaged)
  })

  it("is refused past the ladder's end, whatever the highest zone says", () => {
    const far: GameState = { ...s0, zone: 2, highestZone: LADDER_END + 4 }
    expect(rejectedReason(step(far, { t: 'travel', zone: LADDER_END + 1 }).effects)).toBe(
      'zone_not_reached',
    )
    expect(step(far, { t: 'travel', zone: LADDER_END }).state.zone).toBe(LADDER_END)
  })

  it('refuses a zone that is not a whole number', () => {
    expect(rejectedReason(step(fighting, { t: 'travel', zone: 2.5 }).effects)).toBe('bad_zone')
  })
})
