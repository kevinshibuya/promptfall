import { describe, expect, it } from 'vitest'
import { GOLDEN_HASH, GOLDEN_SEED, goldenEvents } from './golden'
import { hashState } from './hash'
import { createInitialState } from './state'
import { replay } from './step'

describe('golden replay', () => {
  it('has 300 events', () => {
    expect(goldenEvents()).toHaveLength(300)
  })

  // GOLDEN_HASH pins the rules and the content. Changing the literal requires bumping SIM_VERSION.
  // SIM_VERSION 4 (combat flow) changed the draw order of every fight, so the v2 pin is gone.
  // SIM_VERSION 5 (turn boss mid-wave, boss-mode wipe) moves it through `v` alone: the script
  // reaches neither path.
  // SIM_VERSION 6 (ratio mitigation, gentler enemy growth, the flatter xp curve) changes every hit
  // and every level-up, so the script lands elsewhere.
  // SIM_VERSION 7 (hero rarity multiplies base stats and growth) moves it through `v` alone: the
  // script's heroes are all Common and it never leaves zone 1.
  // SIM_VERSION 8 (an item carries its tier; affixes scale at read) moves it through `v` and each
  // item's tier: the script's one affix is on a tier-1 charm, so no stat changes.
  // SIM_VERSION 9 (a wipe restarts the zone, the third is a retreat; rests heal 50%) moves it
  // through every rest and the zone's wipe count: the script wipes eight times in zone 1.
  // SIM_VERSION 10 (the auto-vendor setting) moves it through `v` and the setting's flag: the
  // script never turns it on, so every drop is kept as before.
  // SIM_VERSION 11 (tiers past zone 12; the tier-1 arc's hp growth and zone 10 and 11 xp) moves it
  // through `v` alone: the script never leaves zone 1, whose numbers no growth reaches.
  // SIM_VERSION 12 (the arc retuned for the dedicated harness player: thinner enemies, ×1.3 xp)
  // moves it through zone 1's hp and xp: the script kills faster and takes more drops.
  // SIM_VERSION 13 (contracts at the tier's odds, the tier ramp) moves it through `v` alone: the
  // script never leaves zone 1, which neither change reaches.
  // SIM_VERSION 14 (zone bosses' hp ramps by zone, zones 7 to 12 walk longer and pay more xp)
  // moves it through `v` alone: zone 1's boss stays at ×1 and its waves are untouched.
  // SIM_VERSION 15 (the reactive events) changes the script: every turn opens hasted, the calls
  // carry hints, mishaps enrage, a guard and two camps; and a wave kill pays by its hp share.
  // SIM_VERSION 16 (the tallies, travel, the tavern guarantee) changes the script: a travel past
  // the highest zone is refused, a credit pays for two more recruits whose counts move the
  // guarantee, and the sandbox moves the party to zone 2 for a travel straight back; every spawn,
  // kill, drop and gold gain lands in the tallies.
  // SIM_VERSION 17 (the zone bosses' moves) moves it through `v` alone: the script never meets a
  // zone boss, and the world boss keeps the single attack at its move-free atk.
  // SIM_VERSION 18 (waves fill every free slot) changes every fight: a wave's draw arrives
  // together, each tool call's enemy joins the wave, and a kill refills in its own step.
  it('replays to the golden hash', () => {
    const r = replay(createInitialState(GOLDEN_SEED), goldenEvents())
    expect(hashState(r.state)).toBe(GOLDEN_HASH)
  })

  // hit, act and heal are output only: effects are not part of the state the hash reads.
  it('the replay reports hits, actions and heals without moving the hash', () => {
    const r = replay(createInitialState(GOLDEN_SEED), goldenEvents())
    expect(GOLDEN_HASH).toBe('9856df8da655c357')
    expect(r.effects.some((e) => e.k === 'hit')).toBe(true)
    expect(r.effects.some((e) => e.k === 'act')).toBe(true)
    expect(r.effects.some((e) => e.k === 'heal')).toBe(true)
  })
})
