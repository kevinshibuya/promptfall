// Every tuning number of the stage, and nowhere else. Tests import them rather than repeat them.
import type { Rarity } from '../vendor/sim.js'

// Heights in rows, and the widths that pick the layout (spec §2, ADR 0003, ADR 0010).
/** The stage's rows in every fight: the boss height, so a boss lands at its full size (ADR 0010). */
export const STAGE_ROWS = 17
/**
 * The fewest rows a full stage shows when the band is short: the actors' height (24 px at 1.5x
 * and 16 px at 1x are 8 rows). The stage keeps its art size and loses the sky above (ADR 0010).
 */
export const STAGE_MIN_ROWS = 8
/** The crop's floor with a turn boss (36 px at 1.5x, 24 at 1x) and with a zone or world boss (51, 34). */
export const TURN_BOSS_MIN_ROWS = 12
export const BOSS_MIN_ROWS = 17
export const COMPACT_STAGE_ROWS = 4
export const COMPACT_STAGE_COLUMNS = 52
export const FULL_MIN_COLUMNS = 116
export const MIN_COLUMNS = 100
export const STAGE_MAX_COLUMNS = 160

// Geometry in stage pixels at scale 1; the full stage, on every surface, multiplies every
// stage-pixel quantity by HIRES_SCALE and rounds (ADR 0006).
export const HIRES_SCALE = 1.5
export const SPRITE_PX = 16
export const ACTOR_PITCH = 18
export const ACTOR_EDGE = 4
export const COMPACT_PITCH = 8

// Motion, in ms and px.
export const LUNGE_MS = 240
export const LUNGE_PX = 4
/**
 * The step every attacker takes toward its target: out over the first STEP_OUT_MS of its wind-up
 * hold, back over the last STEP_OUT_MS of its action, the same distance for every actor. Inside
 * the action, so it costs no time (the sim owns STEP_MS).
 */
export const STEP_OUT_MS = 80
export const STEP_PX = 4
/** The wind-up frame covers the lunge's outward half; the strike shows from the apex (reading 1). */
export const WINDUP_MS = 120
/**
 * The wind-up held in place before an attack moves, so the blow reads. It brings the knight's
 * action to 500 ms, one action's battle time at the turn cadence: any longer and playback drifts.
 */
export const WINDUP_HOLD_MS = 140
/** A stage this many rounds behind the sim drops the attacks that have not started. */
export const BACKLOG_ROUNDS = 2
/** The knight's follow-through, in place after the lunge. */
export const FOLLOW_MS = 120
/** A bolt's flight, from the strike to the impact. */
export const BOLT_MS = 200
/** The light burst on its target; the impact lands halfway through. */
export const BURST_MS = 200
/** The hit frame's duration, and the compact stage's white flash. */
export const FLASH_MS = 160
/** The full stage's white overlay: longer than one event frame, so the Image loop cannot step over it. */
export const BLINK_MS = 100
export const NUMBER_MS = 700
/** A level-up's gold numbers rise this long: slow enough to read what the hero gained. */
export const LEVEL_NUMBER_MS = 1200
/** Several level-ups in one group play one after another, this far apart in party-slot order. */
export const LEVEL_STAGGER_MS = 250
export const NUMBER_RISE_PX = 6
export const DISSOLVE_MS = 420
export const SPAWN_MS = 360
/** An enemy's slide into the gap a departed one left. */
export const SLIDE_MS = 240
/**
 * The chest a drop leaves, in phases from its start: it falls, landing as the enemy's fade ends,
 * sits closed, opens, then the item rises out of it, holds by rarity and fades with the chest.
 */
export const CHEST_FALL_MS = 300
export const CHEST_SIT_MS = 300
export const CHEST_OPEN_MS = 500
/** The item's rise out of the open chest: its end is the reveal's show time. */
export const REVEAL_RISE_MS = 300
/** The risen item's hold, longer the rarer the item. */
export const REVEAL_HOLD_MS: Readonly<Record<Rarity, number>> = {
  common: 800,
  uncommon: 1000,
  rare: 1200,
  epic: 1600,
  legendary: 2000,
}
export const REVEAL_FADE_MS = 200
/** After a kill's fade and any chest, the pause before the next enemy steps on stage. */
export const WAVE_GAP_MS = 800
/** How far the item rises from the chest's top. */
export const DROP_RISE_PX = 10
/**
 * The glow behind a revealed item: its radius by rarity for a 1x item (16 px), scaled with the
 * item's art, and its alpha once the item has risen.
 */
export const GLOW_RADIUS_PX: Readonly<Record<Rarity, number>> = {
  common: 8,
  uncommon: 9,
  rare: 10,
  epic: 11,
  legendary: 12,
}
export const GLOW_ALPHA = 0.5
export const IDLE_FRAME_MS = 500
/** The idle bob's frame while Haste is on: twice the rate. */
export const HASTE_FRAME_MS = IDLE_FRAME_MS / 2
/** Camp's campfire: it sits between the lines this long, then fades. */
export const CAMPFIRE_MS = 4000
export const CAMPFIRE_FADE_MS = 400
/**
 * Guard's huddle: every living hero slides between its slot and its huddle position over this
 * one span, so they arrive together, and stands HUDDLE_GAP_PX stage pixels clear of the hero
 * before it (unscaled: one pixel of the scene it is drawn in).
 */
export const HUDDLE_MS = 200
export const HUDDLE_GAP_PX = 1
/** Guard's big shield: its back edge covers this many columns of its holder's front. */
export const SHIELD_OVERLAP_PX = 1
export const EVENT_FRAME_MS = 83
/**
 * A travel: the heroes step off toward the right and fade over TRAVEL_OFF_MS, the backdrop
 * changes as they are gone, and they step on from the left over TRAVEL_ON_MS, TRAVEL_PX each way.
 */
export const TRAVEL_OFF_MS = 500
export const TRAVEL_ON_MS = 500
export const TRAVEL_PX = 12
/**
 * The party's victory pose after a zone boss's dissolve: with Push on, the party then walks to the
 * next zone as a travel does; with Farm here, it holds and stays.
 */
export const VICTORY_MS = 2000
export const IDLE_BOB_PX = 1

// Surfaces and budgets.
export const PROBE_DELAY_MS = 300
/** The smallest pre-upscale that reads crisp in Ghostty (spike findings, 2026-10-04). */
export const IMAGE_SCALE = 6
export const IMAGE_MAX_BYTES = 1_048_576
/** The most bytes an Image's base64 source may decode to: the band's PNG (spec #45). */
export const IMAGE_MAX_SOURCE_BYTES = 2_097_152
/** The host's widest or tallest Image picture, in pixels. */
export const IMAGE_MAX_SIDE = 2048
/** The host's widest Image, in columns: a wider band's picture stops here, centred (spec #45). */
export const IMAGE_MAX_COLUMNS = 255
/** The host's widest Raster: the band's shell stops here, centred, on a wider terminal. */
export const RASTER_MAX_COLUMNS = 512
/** The fewest pixels a column a zoomed-out stage drops to: the 1.5x art still gets more than one. */
export const IMAGE_MIN_SCALE = 2
/** The desktop runs SMIL in the stage Svg (desktop pass, 2026-10-04: the bob, lunge, flash and numbers play). */
export const SVG_SMIL = true
/**
 * The desktop stage Svg is an image, not an interactive frame: SMIL runs in both, but a frame
 * reloads on every new source and shows a blank frame at each redraw (desktop pass, 2026-10-04:
 * 4 blanks in 20 s as a frame, none as an image).
 */
export const SVG_INTERACTIVE = false
export const SVG_FALLBACK_FRAME_MS = 167
/**
 * The stage Svg's markup width per band column off the terminal. The desktop draws about 8 points
 * a column (live check, 2026-10-04) and scales an Svg down to its slot, so a markup wider than the
 * band always fills it; this is a ceiling, not a measurement (ADR 0004).
 */
export const DESKTOP_COLUMN_PX_CEILING = 16
/** The desktop's points per band column and per text row (live check and pass, 2026-10-04). */
export const DESKTOP_COLUMN_PX = 8
export const DESKTOP_ROW_PX = 19
/**
 * The start of the deny a blit answers where the terminal draws no pictures; only it settles the
 * probe on raster. The engine appends the cause in parentheses, which varies by terminal
 * (`(env: terminal=Apple_Terminal, not asked yet, no answer)`), so the probe matches the prefix.
 */
export const PROBE_ALT_DENY =
  'the Image draws its alt here: the terminal draws no placeholder images'
/**
 * The start of every deny a blit answers for an Image drawing its alt: no pictures on the terminal,
 * or no image id for this Image. Either way only a new Image is laid out again as a picture.
 */
export const IMAGE_ALT_DENY = 'the Image draws its alt here'
/**
 * How often an Image drawing its alt is mounted afresh. A background worker's Image is laid out
 * before a terminal attaches, with no pictures and no image id; a new one gets both once it has.
 */
export const ALT_REMOUNT_MS = 2000
export const SVG_MAX_CHARS = 131_072
export const RASTER_MAX_PAIRS = 1024

/** The gain each volume step passes the engine, which takes 0 to 4 (default 1). */
export const SOUND_GAIN = { quiet: 0.25, normal: 0.5, loud: 1 } as const
/**
 * A play the engine answers sooner than this was skipped: every clip is longer, and a real play
 * answers once its clip has ended. A terminal with no audio player answers at once.
 */
export const SKIPPED_PLAY_MS = 100

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
/** Each class's colour, from its sprite's accent: Haste's speed streak behind the hero. */
export const CLASS_RGB: Readonly<Record<string, number>> = {
  knight: 0xe04030,
  black_mage: 0x9050e0,
  white_mage: 0x70e0f0,
  archer: 0xf0c040,
}
/** Enrage's red: the flash at the mishap, and the tint an enraged enemy holds until its hit. */
export const ENRAGE_RGB = 0xe02010
/** How far an enraged enemy's palette is mixed toward ENRAGE_RGB (the Svg overlay's opacity). */
export const ENRAGE_TINT = 0.4
/** Damage taken by a hero. */
export const NUMBER_RGB_HERO = 0xff5050
export const NUMBER_RGB_ENEMY = 0xffffff
/** HP a heal restored. */
export const NUMBER_RGB_HEAL = 0x58d858
/** A level-up's gold: the hero's flash and its stat deltas rising. */
export const LEVEL_RGB = 0xf0c040
