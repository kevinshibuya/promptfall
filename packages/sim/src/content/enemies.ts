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

// Zone 1 baseline, and how each stat grows per zone in basis points.
const ZONE1 = { hp: 90, atk: 7, def: 4, xp: 4, goldMin: 1, goldMax: 3 }
const GROWTH_BP = { hp: 14500, atk: 15000, def: 14500, xp: 14000, gold: 14000 }

function grow(value: number, bp: number, steps: number): number {
  let v = value
  for (let i = 0; i < steps; i++) v = Math.floor((v * bp) / 10000)
  return Math.max(1, v)
}

// Per-zone difficulty on top of the growth curve, in basis points on hp and atk.
const ZONE_BP = [10000, 10000, 13000, 12000, 11000, 11000, 11000, 11000, 11000, 11000, 11000, 11000]

// Zone baselines: hp, atk, def, xp, gold min, gold max.
const BASELINES: [number, number, number, number, number, number][] = Array.from(
  { length: 12 },
  (_, z) => [
    Math.floor((grow(ZONE1.hp, GROWTH_BP.hp, z) * (ZONE_BP[z] ?? 10000)) / 10000),
    Math.floor((grow(ZONE1.atk, GROWTH_BP.atk, z) * (ZONE_BP[z] ?? 10000)) / 10000),
    grow(ZONE1.def, GROWTH_BP.def, z),
    grow(ZONE1.xp, GROWTH_BP.xp, z),
    grow(ZONE1.goldMin, GROWTH_BP.gold, z),
    grow(ZONE1.goldMax, GROWTH_BP.gold, z),
  ],
)

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

function build(): Record<string, EnemyDef> {
  const out: Record<string, EnemyDef> = {}
  ROSTERS.forEach((roster, i) => {
    const zone = i + 1
    const [hp, atk, def, xp, goldMin, goldMax] = BASELINES[i] ?? [1, 1, 1, 1, 1, 1]
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

export const enemies: Record<string, EnemyDef> = build()
export const zoneRosters: string[][] = ROSTERS.map((r) => r.map(([id]) => id))
