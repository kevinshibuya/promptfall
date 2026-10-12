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
      // A wipe restarts the zone and the third retreats: the dedicated player climbs to zone 7 to 9
      // in two hours, with 13 to 19 wipes across these seeds.
      expect(r.wipes).toBeLessThanOrEqual(20)
      expect(r.roundsPerKillZone1).toBeGreaterThanOrEqual(2)
      expect(r.roundsPerKillZone1).toBeLessThanOrEqual(6)
      // Grill 1.5: a hero acts about once every 2 combat ticks.
      expect(r.heroActsPerCombatTick).toBeGreaterThanOrEqual(0.4)
      expect(r.heroActsPerCombatTick).toBeLessThanOrEqual(0.6)
    },
  )
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
    // 6 lands 10: 10 hits. The Bandit Captain's 16 lands 26: 3 hits.
    expect(p.zones[0]).toMatchObject({
      knight: { hp: 101, def: 16 },
      knightWaveHits: { min: 6, max: 10 },
      knightBossHits: 3,
    })
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

  it('measures tiers 2 and 3 at their reference rows: a capped party in the tier’s item tier', () => {
    expect(probe(2).zones.map((z) => z.zone)).toEqual([13, 18, 24])
    expect(probe(3).zones.map((z) => z.zone)).toEqual([25, 30, 36])
    expect(probe(2).zones[0]).toMatchObject({
      base: 1,
      tier: 2,
      level: 50,
      knightRarity: 'legendary',
      gearTier: 5,
      gearRarity: 'epic',
      rollBp: 0,
    })
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
