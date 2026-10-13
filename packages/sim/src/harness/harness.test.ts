import { describe, expect, it } from 'vitest'
import { parseArgs } from './args'
import { outOfBand, probe } from './probe'
import { runScenario } from './scenario'

describe('the early envelope, at the reference cadence on today’s rules', () => {
  // A floor later tickets inherit: a change that breaks the early game fails here.
  it.each([7, 8, 9])(
    'seed %i clears zone 1 inside the first 30 minutes with a handful of wipes',
    (seed) => {
      const r = runScenario({ seed, hours: 2 })
      const zone1 = r.zones.find((z) => z.zone === 1)
      expect(zone1?.firstClearedHour).not.toBeNull()
      expect(zone1?.firstClearedHour).toBeLessThan(0.5)
      expect(zone1?.wipes).toBeLessThanOrEqual(5)
      // A wipe restarts the zone and the third retreats: with the boss moves (#169) the dedicated
      // player climbs to zone 6 or 7 in two hours, with 15 to 17 wipes across these seeds; zone 3's
      // whole-party boss, sweeping one action in three, costs 1 to 4 of them.
      expect(r.wipes).toBeLessThanOrEqual(20)
      expect(r.roundsPerKillZone1).toBeGreaterThanOrEqual(2)
      expect(r.roundsPerKillZone1).toBeLessThanOrEqual(6)
      // Grill 1.5: a hero acts about once every 2 combat ticks.
      expect(r.heroActsPerCombatTick).toBeGreaterThanOrEqual(0.4)
      expect(r.heroActsPerCombatTick).toBeLessThanOrEqual(0.6)
    },
  )
})

describe('the turn events', () => {
  // A 150 s turn every 250 s: turn_start at 0, 60 and 120 s, a tick every 2 s inside the turn and
  // every 5 s in the 100 s idle gap after it.
  const r = runScenario({
    seed: 3,
    hours: 2.5,
    cadence: { kind: 'fixed', activeShareBp: 6000, toolCallEverySec: 8, turnLengthSec: 150 },
  })

  it('sends turn_start at each turn’s start and every 60 seconds of it', () => {
    expect(r.cadence.prompts).toBe(36)
    expect(r.turnStarts).toBe(3 * 36)
  })

  it('runs every tick inside a turn hasted and every idle tick plain', () => {
    expect(r.ticks).toBe(36 * (75 + 20))
    expect(r.hastedTicks).toBe(36 * 75)
  })
})

describe('the feel probe', () => {
  const p = probe(1)

  it('measures the reference Knight at every zone of the tier', () => {
    expect(p.zones.map((z) => z.zone)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    expect(p.zones[4]).toMatchObject({ knightRarity: 'common', gearTier: 2 })
    expect(p.zones[8]).toMatchObject({ knightRarity: 'legendary', gearTier: 3 })
  })

  it('computes zone 1 from content through the sim’s damage, without variance', () => {
    // Level 4 Common Knight in Bronze Axe, Chainmail and Bone Charm: 101 HP, 16 def. The Hedge
    // Sprite's 10 atk lands 8 through 100 / 116, doubled to 16: 6 hits survived. The Road Slime's
    // 6 lands 10: 10 hits. The Bandit Captain strikes twice from 12 atk: each hit from 70%, 8,
    // lands 6, doubled to 12, so an action lands 24: 4 actions survived.
    expect(p.zones[0]).toMatchObject({
      knight: { hp: 101, def: 16 },
      knightWaveHits: { min: 6, max: 10 },
      bossMove: 'strike_twice',
      knightBossHits: 4,
    })
  })

  it('models each boss move as its tactics weigh its actions on the Knight', () => {
    // Zones 3 and 4: a level 6 Common Knight, 121 HP and 20 def, so a hit lands 100 / 120 of its atk.
    // The Sighing Hag sweeps one action in three from 22 atk: its single attack lands 18, doubled
    // to 36; its sweep from 60%, 13, lands 10, doubled to 20. Weighted 150 to 75: (120 × 225) /
    // (150 × 36 + 75 × 20) is 3.9: 3.
    expect(p.zones[2]).toMatchObject({ bossMove: 'hit_all', knightBossHits: 3 })
    // The Barrow King rages from 14 atk: 150% under half, 21, lands 17, doubled to 34: 3.
    expect(p.zones[3]).toMatchObject({ bossMove: 'rage', knightBossHits: 3 })
    // The Elder Treant's heal is no hit: its 16 atk lands 26, as before the moves: 3.
    expect(p.zones[1]).toMatchObject({ bossMove: 'heal_self', knightBossHits: 3 })
  })

  it('reports how many Knight hits a healing boss’s heals add to the fight, and none for another move', () => {
    const heals = p.zones.filter((z) => z.bossMove === 'heal_self')
    expect(heals.map((z) => z.zone)).toEqual([2, 6, 10])
    for (const z of heals) expect(z.healKnightHits).toBeGreaterThan(0)
    for (const z of p.zones) if (z.bossMove !== 'heal_self') expect(z.healKnightHits).toBe(0)
  })

  it('names every zone outside 6 to 10 wave hits or 3 to 4 boss hits, and today there is none', () => {
    expect(outOfBand(p)).toEqual([])
    const out = { ...p, zones: p.zones.map((z) => ({ ...z, knightBossHits: 2 })) }
    expect(outOfBand(out)).toHaveLength(12)
    expect(outOfBand(out)[0]).toBe('zone 1: boss hits 2, not 3 to 4')
    const inBand = {
      ...p,
      zones: p.zones.map((z) => ({ ...z, knightWaveHits: { min: 6, max: 10 }, knightBossHits: 3 })),
    }
    expect(outOfBand(inBand)).toEqual([])
  })

  it('measures tiers 2 and 3 at their reference rows: zone 12’s party at zone 13, capped past it', () => {
    expect(probe(2).zones.map((z) => z.zone)).toEqual([13, 24])
    expect(probe(3).zones.map((z) => z.zone)).toEqual([25, 30, 36])
    // Tier 2 ramps from zone 12 (#152), so its first zone takes the party that clears zone 12.
    expect(probe(2).zones[0]).toMatchObject({
      base: 1,
      tier: 2,
      level: 37,
      knightRarity: 'legendary',
      gearTier: 3,
      gearRarity: 'uncommon',
    })
    expect(probe(2).zones[1]).toMatchObject({ base: 12, level: 50, gearTier: 5 })
    expect(probe(3).zones[2]).toMatchObject({ base: 12, gearTier: 6, gearRarity: 'legendary' })
  })

  it('refuses a tier past the ladder’s end', () => {
    expect(() => probe(4)).toThrow(/past the ladder's end/)
    expect(() => probe(0)).toThrow(/tier/)
  })
})

describe('the CLI’s arguments', () => {
  it('defaults to a run at the reference cadence', () => {
    const a = parseArgs([])
    expect(a).toMatchObject({ mode: 'run', options: { seed: 7, hours: 8, player: 'dedicated' } })
    if (a.mode !== 'run') return
    expect(a.options.cadence).toMatchObject({ kind: 'distribution', name: 'reference' })
  })

  it('keeps today’s shape behind --cadence fixed and its old flags', () => {
    const a = parseArgs(['--', '--cadence', 'fixed', '--tool-every', '4', '--hours', '1'])
    expect(a).toMatchObject({
      mode: 'run',
      options: {
        hours: 1,
        cadence: { kind: 'fixed', toolCallEverySec: 4, turnLengthSec: 90, activeShareBp: 6000 },
      },
    })
  })

  it('reads the probe, its assertion and a tier', () => {
    expect(parseArgs(['--probe'])).toEqual({ mode: 'probe', tier: 1, assert: false })
    expect(parseArgs(['--probe', '--assert', '--tier', '2'])).toEqual({
      mode: 'probe',
      tier: 2,
      assert: true,
    })
    expect(parseArgs(['--legendary-at', 'off'])).toMatchObject({
      options: { legendaryAtHour: null },
    })
    expect(parseArgs(['--player', 'lazy'])).toMatchObject({ options: { player: 'lazy' } })
  })

  it('refuses an unknown flag, a missing value, and a flag the mode would ignore', () => {
    for (const argv of [
      ['--bogus-flag'],
      ['--hours'],
      ['--hours', 'many'],
      ['--tool-every', '4'],
      ['--assert'],
      ['--cadence', 'slow'],
      ['--player', 'idle'],
      ['--cadence', 'fixed', '--cadence-file', 'x.json'],
      ['--probe', '--hours', '2'],
    ]) {
      expect(parseArgs(argv), argv.join(' ')).toMatchObject({ mode: 'error' })
    }
  })
})
