// Every tuning number of the stage, and nowhere else. Tests import them rather than repeat them.

// Heights in rows, and the widths that pick the layout (spec §2, ADR 0003).
export const STAGE_REST_ROWS = 8
export const STAGE_TURN_BOSS_ROWS = 12
export const STAGE_BOSS_ROWS = 17
export const STAGE_TEXT_ROWS = 2
export const COMPACT_ROWS = 4
export const COMPACT_STAGE_COLUMNS = 52
export const FULL_MIN_COLUMNS = 116
export const MIN_COLUMNS = 100
export const STAGE_MAX_COLUMNS = 160

// Geometry in stage pixels.
export const SPRITE_PX = 16
export const ACTOR_PITCH = 18
export const ACTOR_EDGE = 4
export const COMPACT_PITCH = 8

// Motion, in ms and px.
export const HIT_STAGGER_MS = 150
export const LUNGE_MS = 240
export const LUNGE_PX = 4
export const FLASH_MS = 160
export const NUMBER_MS = 700
export const NUMBER_RISE_PX = 6
export const DISSOLVE_MS = 420
export const SPAWN_MS = 360
export const DROP_MS = 600
export const DROP_RISE_PX = 10
export const IDLE_FRAME_MS = 500
export const EVENT_FRAME_MS = 83
export const IDLE_BOB_PX = 1

// Surfaces and budgets.
export const PROBE_DELAY_MS = 300
/** The smallest pre-upscale that reads crisp in Ghostty (spike findings, 2026-10-04). */
export const IMAGE_SCALE = 6
export const IMAGE_MAX_BYTES = 1_048_576
/** The desktop runs SMIL in an `isInteractive` Svg (SvgProps; the desktop spike row confirms). */
export const SVG_SMIL = true
export const SVG_FALLBACK_FRAME_MS = 167
/**
 * The stage Svg's markup width per band column off the terminal. The desktop draws about 8 points
 * a column (live check, 2026-10-04) and scales an Svg down to its slot, so a markup wider than the
 * band always fills it; this is a ceiling, not a measurement (ADR 0004).
 */
export const DESKTOP_COLUMN_PX_CEILING = 16
/**
 * The start of the deny a blit answers where the terminal draws no pictures; only it settles the
 * probe on raster. The engine appends the cause in parentheses, which varies by terminal
 * (`(env: terminal=Apple_Terminal, not asked yet, no answer)`), so the probe matches the prefix.
 */
export const PROBE_ALT_DENY =
  'the Image draws its alt here: the terminal draws no placeholder images'
export const SVG_MAX_CHARS = 131_072
export const RASTER_MAX_PAIRS = 1024

export const CUE_GAIN = 0.6

// Colours, 0xRRGGBB.
export const RARITY_RGB: Readonly<Record<string, number>> = {
  common: 0x9a9a9a,
  uncommon: 0x3fbf5f,
  rare: 0x3f7fff,
  epic: 0xd040d0,
  legendary: 0xf0c040,
}
/** One ground colour per zone, from the zone names in packages/sim/src/content/zones.ts. */
export const ZONE_GROUND: readonly number[] = [
  0x5a8c3a, // Greenmeadow Road
  0x2f5a2a, // Whisperwood
  0x4a5a3a, // Marsh of Sighs
  0x6a6a4a, // Old Barrow Hills
  0xc8b88a, // Saltglass Coast
  0x5a2a1a, // Emberfall Caves
  0xb8d0e0, // Frostvein Pass
  0x3a4a5a, // Sunken Abbey
  0x6a6460, // Ashen Waste
  0x3a2a5a, // Starfall Spire
  0x2a2a30, // Hollow King's Court
  0xe8e4d8, // The Unwritten Reach
]
export const FLASH_RGB = 0xffffff
/** Damage taken by a hero. */
export const NUMBER_RGB_HERO = 0xff5050
export const NUMBER_RGB_ENEMY = 0xffffff
