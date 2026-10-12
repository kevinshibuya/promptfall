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
 * basis points, and a per-zone multiplier on atk and on hp over the growth curve.
 */
export type EnemyTuning = {
  zone1: { hp: number; atk: number; def: number; xp: number; goldMin: number; goldMax: number }
  growthBp: { hp: number; atk: number; def: number; xp: number; gold: number }
  /** One entry per base zone, in basis points. */
  zoneAtkBp: readonly number[]
  zoneHpBp: readonly number[]
}

// Zones 9 to 12 moved for sim version 7 (#139): the reference Knight there is Legendary, and its
// rarity now multiplies its base and growth by 1.5.
export const ENEMY_TUNING: EnemyTuning = {
  zone1: { hp: 90, atk: 8, def: 4, xp: 5, goldMin: 1, goldMax: 3 },
  growthBp: { hp: 11900, atk: 13000, def: 13000, xp: 11300, gold: 11300 },
  zoneAtkBp: [10800, 8500, 8350, 6750, 7050, 6650, 5500, 6700, 9100, 8100, 7300, 6650],
  zoneHpBp: [10000, 10000, 10000, 10000, 10000, 10000, 10000, 10000, 7500, 7000, 8500, 10500],
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
    xp: grow(zone1.xp, growthBp.xp, z),
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

/** Every enemy's stats, xp and gold from the tuning: computed once, at load. */
export function buildEnemies(t: EnemyTuning): Record<string, EnemyDef> {
  const out: Record<string, EnemyDef> = {}
  ROSTERS.forEach((roster, i) => {
    const zone = i + 1
    const { hp, atk, def, xp, goldMin, goldMax } = baseline(t, i)
    for (const [id, name, archetype] of roster) {
      const a = ARCHETYPES[archetype]
      const kind = kindOf(archetype)
      const stats: Stats = {
        hp: scale(hp, a.hpBp),
        atk: scale(atk, a.atkBp),
        def: scale(def, a.defBp),
        spd: a.spd + Math.floor(zone / 3),
      }
      const bossMult = kind === 'zone_boss' ? 8 : kind === 'turn_boss' ? 4 : 1
      out[id] = {
        id,
        name,
        glyph: GLYPHS[archetype],
        zone,
        kind,
        archetype,
        stats,
        xp: xp * bossMult,
        gold: [goldMin * bossMult, goldMax * bossMult],
        dropBp: kind === 'zone_boss' ? 10000 : kind === 'turn_boss' ? 6000 : 1500,
        contractBp: kind === 'zone_boss' ? 1500 : kind === 'turn_boss' ? 400 : 0,
      }
    }
  })
  return out
}

export const enemies: Record<string, EnemyDef> = buildEnemies(ENEMY_TUNING)
export const zoneRosters: string[][] = ROSTERS.map((r) => r.map(([id]) => id))
