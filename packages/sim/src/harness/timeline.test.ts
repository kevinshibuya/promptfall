import { describe, expect, it } from 'vitest'
import { referenceRow } from './reference'
import { runScenario } from './scenario'

// One short seeded run, the Legendary granted early so its timeline has something in it.
const run = runScenario({ seed: 7, hours: 4, legendaryAtHour: 1 })

describe('the per-zone timeline', () => {
  it('lists every zone the party reached, in order, from zone 1 at hour 0', () => {
    expect(run.zones.map((z) => z.zone)).toEqual(
      Array.from({ length: run.highestZone }, (_, i) => i + 1),
    )
    expect(run.zones[0]?.firstReachedHour).toBe(0)
  })

  it('dates a zone’s first clear, and the next zone is reached at that hour', () => {
    const [z1, z2] = run.zones
    expect(z1?.firstClearedHour).toBeGreaterThan(0)
    expect(z1?.firstClearedHour).toBeLessThan(4)
    expect(z2?.firstReachedHour).toBe(z1?.firstClearedHour)
    // The highest zone is still being fought unless the run cleared it on its last tick.
    for (const z of run.zones.slice(0, -1)) expect(z.firstClearedHour).not.toBeNull()
  })

  it('counts each wipe in the zone it happened in, and a retreat when it fell back', () => {
    expect(run.wipes).toBeGreaterThan(0)
    expect(run.zones.reduce((n, z) => n + z.wipes, 0)).toBe(run.wipes)
    // Today every wipe past zone 1 falls back a zone; zone 1 has nowhere to fall to.
    for (const z of run.zones) expect(z.retreats).toBe(z.zone === 1 ? 0 : z.wipes)
  })
})

describe('the level timeline', () => {
  it('dates each level a party hero first held, from 1 at hour 0, later levels never earlier', () => {
    expect(run.levels[0]).toEqual({ level: 1, hour: 0 })
    for (let i = 1; i < run.levels.length; i++) {
      expect(run.levels[i]?.level).toBe((run.levels[i - 1]?.level ?? 0) + 1)
      expect(run.levels[i]?.hour).toBeGreaterThanOrEqual(run.levels[i - 1]?.hour ?? 0)
    }
    expect(run.levels.length).toBeGreaterThan(5)
    const top = Math.max(...run.party.map((h) => h.level))
    expect(run.levels.at(-1)?.level).toBeGreaterThanOrEqual(top)
  })
})

describe('the Legendary grant', () => {
  it('puts a Legendary Knight in the Knight’s place at the reference level of its zone', () => {
    const l = run.legendary
    expect(l).not.toBeNull()
    if (!l) return
    expect(l.grantedHour).toBe(1)
    expect(l.level).toBe(referenceRow(l.zone).level)
    expect(l.level).toBeLessThan(50)
    expect(run.party[0]).toMatchObject({ cls: 'knight', rarity: 'legendary' })
    for (const { level, hour } of l.levels) {
      expect(level).toBeGreaterThan(l.level)
      expect(hour).toBeGreaterThanOrEqual(l.grantedHour)
    }
    expect(run.party[0]?.level).toBe(l.levels.at(-1)?.level ?? l.level)
    // A short run never takes it to 50.
    expect(l.capHour).toBeNull()
  })

  it('is absent when the run ends first or the grant is off', () => {
    expect(runScenario({ seed: 7, hours: 1, legendaryAtHour: 2 }).legendary).toBeNull()
    expect(runScenario({ seed: 7, hours: 1, legendaryAtHour: null }).legendary).toBeNull()
  })
})

describe('the player model', () => {
  it('vendors what it does not wear, so a late upgrade is still equipped', () => {
    // More drops than the inventory holds: without disposal every later one is vendored unseen.
    expect(run.drops.taken).toBeGreaterThan(30)
    expect(run.drops.vendoredAtTurnEnd).toBeGreaterThan(0)
    expect(run.upgrades.pastFullInventory).toBeGreaterThan(0)
  })
})
