import type { EnemyKind, Stats } from '../types'
import type { Archetype, EnemyDef } from './types'

// Multipliers on the zone baseline, in basis points; spd is a flat offset.
const ARCHETYPES: Record<Archetype, { hpBp: number; atkBp: number; defBp: number; spd: number }> = {
  brute: { hpBp: 12000, atkBp: 11000, defBp: 9000, spd: 3 },
  swift: { hpBp: 8000, atkBp: 10000, defBp: 7000, spd: 8 },
  tank: { hpBp: 14000, atkBp: 8000, defBp: 13000, spd: 2 },
  caster: { hpBp: 9000, atkBp: 12500, defBp: 8000, spd: 6 },
  boss: { hpBp: 70000, atkBp: 20000, defBp: 12000, spd: 5 },
  turn_boss: { hpBp: 30000, atkBp: 12000, defBp: 11000, spd: 5 },
}

/**
 * The numbers every enemy is built from: the zone 1 baseline, how each stat grows per zone in
 * basis points, and a per-zone multiplier on atk, hp and xp over the growth curve.
 */
export type EnemyTuning = {
  zone1: { hp: number; atk: number; def: number; xp: number; goldMin: number; goldMax: number }
  growthBp: { hp: number; atk: number; def: number; xp: number; gold: number }
  /** One entry per base zone, in basis points. */
  zoneAtkBp: readonly number[]
  zoneHpBp: readonly number[]
  zoneXpBp: readonly number[]
  /** One entry per base zone, in basis points, on the zone boss's hp alone; the later tiers take zone 12's. */
  zoneBossHpBp: readonly number[]
}

// Zones 9 to 12 moved for sim version 7 (#139): the reference Knight there is Legendary, and its
// rarity now multiplies its base and growth by 1.5. Sim version 11 (#143) tuned the tier-1 arc in
// one bounded search: hp grows ×1.275 per zone (was ×1.19). Sim version 12 (#151) tuned it again,
// for the dedicated harness player and the halved targets, in one more: every zone gives ×1.3 xp,
// and enemies hold 0.565 of #143's hp in zones 1 to 6 and 0.45 in zones 7 to 12, so a party kills
// fast enough to reach the Legendary's cap in time; atk, and so the feel probe, is untouched.
// Sim version 14 (#153) slowed the tier-1 arc outside the kill rate: every wipe there is a boss
// wipe, so a zone takes its boss attempts times its ten-wave walk. The zone boss's hp ramps from
// ×1 at zone 1 to ×4 at zone 12; zones 7 to 12 walk longer (hp ×1.3 rising to ×4.6 over sim 13's)
// and zones 7 to 10 pay xp to match and more (×1.25 at zone 7, ×1.35 at 8 to 10, over the hp's
// factor), so the Knight's levels 20 to 30 come at pace; from zone 10 a kill's xp stops growing, so
// the Legendary's cap waits on zones 11 and 12. Six nine-seed runs, pasted on #153.
export const ENEMY_TUNING: EnemyTuning = {
  zone1: { hp: 90, atk: 8, def: 4, xp: 5, goldMin: 1, goldMax: 3 },
  growthBp: { hp: 12750, atk: 13000, def: 13000, xp: 11300, gold: 11300 },
  zoneAtkBp: [10800, 8500, 8350, 6750, 7050, 6650, 5500, 6700, 9100, 8100, 7300, 6650],
  zoneHpBp: [5650, 5650, 5650, 5650, 5650, 5650, 5850, 7650, 7140, 7875, 13956, 21945],
  zoneXpBp: [13000, 13000, 13000, 13000, 13000, 13000, 21125, 29835, 36855, 43875, 38830, 34360],
  zoneBossHpBp: [
    10000, 12750, 15500, 18250, 21000, 23750, 26500, 29250, 32000, 34750, 37500, 40000,
  ],
}

/**
 * A value after `steps` zones of growth at `bp`. It carries four decimal places between steps and
 * floors once at the end, so a small value grows too: 5 at ×1.15 is not floored back to 5.
 */
function grow(value: number, bp: number, steps: number): number {
  let v = value * 10000
  for (let i = 0; i < steps; i++) v = Math.floor((v * bp) / 10000)
  return Math.max(1, Math.floor(v / 10000))
}

type Baseline = {
  hp: number
  atk: number
  def: number
  xp: number
  goldMin: number
  goldMax: number
}

/** The baseline of base zone z + 1. */
function baseline(t: EnemyTuning, z: number): Baseline {
  const { zone1, growthBp } = t
  return {
    hp: Math.floor((grow(zone1.hp, growthBp.hp, z) * (t.zoneHpBp[z] ?? 10000)) / 10000),
    atk: Math.floor((grow(zone1.atk, growthBp.atk, z) * (t.zoneAtkBp[z] ?? 10000)) / 10000),
    def: grow(zone1.def, growthBp.def, z),
    xp: Math.floor((grow(zone1.xp, growthBp.xp, z) * (t.zoneXpBp[z] ?? 10000)) / 10000),
    goldMin: grow(zone1.goldMin, growthBp.gold, z),
    goldMax: grow(zone1.goldMax, growthBp.gold, z),
  }
}

// Per zone: four wave enemies (brute, swift, tank, caster), the zone boss, the turn boss.
const ROSTERS: [string, string, Archetype][][] = [
  [
    ['road_slime', 'Road Slime', 'tank'],
    ['field_rat', 'Field Rat', 'swift'],
    ['goblin_scout', 'Goblin Scout', 'brute'],
    ['hedge_sprite', 'Hedge Sprite', 'caster'],
    ['bandit_captain', 'Bandit Captain', 'boss'],
    ['wild_boar', 'Wild Boar', 'turn_boss'],
  ],
  [
    ['bramble_wolf', 'Bramble Wolf', 'swift'],
    ['moss_golem', 'Moss Golem', 'tank'],
    ['wood_goblin', 'Wood Goblin', 'brute'],
    ['whisper_wisp', 'Whisper Wisp', 'caster'],
    ['elder_treant', 'Elder Treant', 'boss'],
    ['owlbear_cub', 'Owlbear Cub', 'turn_boss'],
  ],
  [
    ['bog_lurker', 'Bog Lurker', 'brute'],
    ['marsh_leech', 'Marsh Leech', 'swift'],
    ['mire_toad', 'Mire Toad', 'tank'],
    ['will_o_wisp', "Will-o'-Wisp", 'caster'],
    ['sigh_hag', 'The Sighing Hag', 'boss'],
    ['giant_heron', 'Giant Heron', 'turn_boss'],
  ],
  [
    ['barrow_wight', 'Barrow Wight', 'caster'],
    ['grave_hound', 'Grave Hound', 'swift'],
    ['bone_soldier', 'Bone Soldier', 'brute'],
    ['cairn_crawler', 'Cairn Crawler', 'tank'],
    ['barrow_king', 'The Barrow King', 'boss'],
    ['crypt_ogre', 'Crypt Ogre', 'turn_boss'],
  ],
  [
    ['salt_crab', 'Salt Crab', 'tank'],
    ['gull_harpy', 'Gull Harpy', 'swift'],
    ['drowned_sailor', 'Drowned Sailor', 'brute'],
    ['tide_witch', 'Tide Witch', 'caster'],
    ['glass_leviathan', 'Glass Leviathan', 'boss'],
    ['reef_troll', 'Reef Troll', 'turn_boss'],
  ],
  [
    ['ember_imp', 'Ember Imp', 'swift'],
    ['magma_beetle', 'Magma Beetle', 'tank'],
    ['cinder_orc', 'Cinder Orc', 'brute'],
    ['flame_adept', 'Flame Adept', 'caster'],
    ['emberfall_wyrm', 'Emberfall Wyrm', 'boss'],
    ['slag_giant', 'Slag Giant', 'turn_boss'],
  ],
  [
    ['frost_wolf', 'Frost Wolf', 'swift'],
    ['ice_troll', 'Ice Troll', 'brute'],
    ['rime_golem', 'Rime Golem', 'tank'],
    ['snow_shaman', 'Snow Shaman', 'caster'],
    ['frostvein_yeti', 'Frostvein Yeti', 'boss'],
    ['avalanche_drake', 'Avalanche Drake', 'turn_boss'],
  ],
  [
    ['drowned_monk', 'Drowned Monk', 'brute'],
    ['abbey_gargoyle', 'Abbey Gargoyle', 'tank'],
    ['bell_wraith', 'Bell Wraith', 'caster'],
    ['eel_serpent', 'Eel Serpent', 'swift'],
    ['sunken_abbot', 'The Sunken Abbot', 'boss'],
    ['choir_of_bones', 'Choir of Bones', 'turn_boss'],
  ],
  [
    ['ash_ghoul', 'Ash Ghoul', 'brute'],
    ['dust_stalker', 'Dust Stalker', 'swift'],
    ['cinder_colossus', 'Cinder Colossus', 'tank'],
    ['ash_oracle', 'Ash Oracle', 'caster'],
    ['waste_tyrant', 'Tyrant of the Waste', 'boss'],
    ['sand_basilisk', 'Sand Basilisk', 'turn_boss'],
  ],
  [
    ['star_sentinel', 'Star Sentinel', 'tank'],
    ['comet_hound', 'Comet Hound', 'swift'],
    ['spire_warden', 'Spire Warden', 'brute'],
    ['astral_seer', 'Astral Seer', 'caster'],
    ['fallen_star', 'The Fallen Star', 'boss'],
    ['void_manta', 'Void Manta', 'turn_boss'],
  ],
  [
    ['hollow_knight', 'Hollow Knight', 'brute'],
    ['court_jester', 'Court Jester', 'swift'],
    ['throne_guard', 'Throne Guard', 'tank'],
    ['court_mage', 'Court Mage', 'caster'],
    ['hollow_king', 'The Hollow King', 'boss'],
    ['royal_chimera', 'Royal Chimera', 'turn_boss'],
  ],
  [
    ['ink_horror', 'Ink Horror', 'brute'],
    ['blank_page', 'Blank Page', 'swift'],
    ['quill_golem', 'Quill Golem', 'tank'],
    ['erased_scribe', 'Erased Scribe', 'caster'],
    ['unwritten_one', 'The Unwritten One', 'boss'],
    ['margin_beast', 'Margin Beast', 'turn_boss'],
  ],
]

const GLYPHS: Record<Archetype, string> = {
  brute: 'B',
  swift: 's',
  tank: 'T',
  caster: 'c',
  boss: 'Ω',
  turn_boss: 'Ψ',
}

function kindOf(archetype: Archetype): EnemyKind {
  if (archetype === 'boss') return 'zone_boss'
  if (archetype === 'turn_boss') return 'turn_boss'
  return 'wave'
}

function scale(value: number, bp: number): number {
  return Math.max(1, Math.floor((value * bp) / 10000))
}

/**
 * One enemy at a baseline: its archetype's share of each number, its kind's xp and gold, and a
 * zone boss's hp scaled by `bossHpBp`.
 */
function enemyOf(
  [id, name, archetype]: [string, string, Archetype],
  zone: number,
  b: Baseline,
  spdZone: number,
  bossHpBp: number,
): EnemyDef {
  const a = ARCHETYPES[archetype]
  const kind = kindOf(archetype)
  const hp = scale(b.hp, a.hpBp)
  const stats: Stats = {
    hp: kind === 'zone_boss' ? scale(hp, bossHpBp) : hp,
    atk: scale(b.atk, a.atkBp),
    def: scale(b.def, a.defBp),
    spd: a.spd + Math.floor(spdZone / 3),
  }
  const bossMult = kind === 'zone_boss' ? 8 : kind === 'turn_boss' ? 4 : 1
  return {
    id,
    name,
    glyph: GLYPHS[archetype],
    zone,
    kind,
    archetype,
    stats,
    xp: b.xp * bossMult,
    gold: [b.goldMin * bossMult, b.goldMax * bossMult],
    dropBp: kind === 'zone_boss' ? 10000 : kind === 'turn_boss' ? 6000 : 1500,
    contractBp: kind === 'zone_boss' ? 1500 : kind === 'turn_boss' ? 400 : 0,
  }
}

/** Every enemy's stats, xp and gold from the tuning: computed once, at load. */
export function buildEnemies(t: EnemyTuning): Record<string, EnemyDef> {
  const out: Record<string, EnemyDef> = {}
  ROSTERS.forEach((roster, i) => {
    const b = baseline(t, i)
    const bossHpBp = t.zoneBossHpBp[i] ?? 10000
    for (const entry of roster) out[entry[0]] = enemyOf(entry, i + 1, b, i + 1, bossHpBp)
  })
  return out
}

/**
 * The growth of an enemy's stats, xp and gold per zone past the first tier, in basis points, one
 * entry per tier from tier 2: zone 12 + k fights at zone 12's numbers grown once per zone, each
 * zone at its own tier's rate. Tier 2 ramps from zone 12 at ×1.1325, so zone 24 lands where a
 * ×2.78 step at zone 13 and ×1.04 a zone put it (1.1325¹² = 2.78 × 1.04¹² = 4.45, equal to the
 * fourth decimal, so a defence or an attack there may sit a point or two off); tier 3 grows ×1.04
 * from there. Both are tuned to the feel probe at tiers 2 and 3.
 */
export const TIER_GROWTH_BP: readonly number[] = [11325, 10400]

/**
 * A value after one zone of growth per entry of `bps`, carried at four decimal places between
 * steps and floored once at the end, as `grow` does.
 */
function growThrough(value: number, bps: readonly number[]): number {
  let v = value * 10000
  for (const bp of bps) v = Math.floor((v * bp) / 10000)
  return Math.max(1, Math.floor(v / 10000))
}

/**
 * Every enemy at every running zone past the first tier, `last` the ladder's end: zone 12's
 * baseline, its stats, xp and gold grown once per zone past 12 at that zone's tier's rate in
 * `growthBp` (tier 2 first), through each enemy's own archetype. Speed stays at zone 12's.
 * Computed once, at load.
 */
export function buildTierEnemies(
  t: EnemyTuning,
  growthBp: readonly number[],
  last: number,
): Record<number, Record<string, EnemyDef>> {
  const top = ROSTERS.length
  const b12 = baseline(t, top - 1)
  const bossHpBp = t.zoneBossHpBp[top - 1] ?? 10000
  const out: Record<number, Record<string, EnemyDef>> = {}
  const steps: number[] = []
  for (let zone = top + 1; zone <= last; zone++) {
    const tier = Math.floor((zone - 1) / top) + 1
    const bp = growthBp[tier - 2] ?? growthBp[growthBp.length - 1]
    if (bp === undefined) throw new Error(`no tier growth for zone ${zone}`)
    steps.push(bp)
    const b: Baseline = {
      hp: growThrough(b12.hp, steps),
      atk: growThrough(b12.atk, steps),
      def: growThrough(b12.def, steps),
      xp: growThrough(b12.xp, steps),
      goldMin: growThrough(b12.goldMin, steps),
      goldMax: growThrough(b12.goldMax, steps),
    }
    const at: Record<string, EnemyDef> = {}
    for (const roster of ROSTERS)
      for (const entry of roster) at[entry[0]] = enemyOf(entry, zone, b, top, bossHpBp)
    out[zone] = at
  }
  return out
}

export const enemies: Record<string, EnemyDef> = buildEnemies(ENEMY_TUNING)
export const zoneRosters: string[][] = ROSTERS.map((r) => r.map(([id]) => id))
