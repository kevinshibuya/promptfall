import type { GameView } from '../../types'
import { encode } from '../sprites/base64'
import { lighten, opaqueBox, shear, squash, stance } from '../sprites/derive'
import { SPRITES } from '../sprites/generated'
import { backdropFor, decodePixels, spriteFor } from '../sprites/index'
import type { Sprite, SpriteArt } from '../sprites/types'
import { zoneAt } from '../vendor/sim.js'
import { zoneHead } from '../zone-words'
import { GLYPH_HEIGHT, glyphBlock, textWidth } from './font'
import type { Box } from './layout'
import {
  bobbingAt,
  type ChestMotion,
  type ChestPhase,
  chestPhaseAt,
  enemySpriteId,
  type HuddleMotion,
  huddles,
  type Motion,
  type StageTimeline,
} from './timeline'
import {
  ACTOR_EDGE,
  ACTOR_PITCH,
  BLINK_MS,
  CAMPFIRE_FADE_MS,
  CAMPFIRE_MS,
  CLASS_RGB,
  COMPACT_PITCH,
  DROP_RISE_PX,
  ENRAGE_RGB,
  ENRAGE_TINT,
  FLASH_RGB,
  GLOW_ALPHA,
  GLOW_RADIUS_PX,
  HASTE_FRAME_MS,
  HIRES_SCALE,
  HUDDLE_GAP_PX,
  IDLE_BOB_PX,
  IDLE_FRAME_MS,
  LEVEL_RGB,
  LUNGE_PX,
  NUMBER_RISE_PX,
  RARITY_RGB,
  SHIELD_OVERLAP_PX,
  SPRITE_PX,
  STEP_OUT_MS,
  STEP_PX,
  TRAVEL_PX,
  ZONE_GROUND,
} from './tuning'

/**
 * The drawing an actor shows: idle A and B, the three drawn frames, the hit frame, Guard's
 * stance (derived, as idle B and the hit are), and a hero's victory pose.
 */
export type Pose = 'idle' | 'idle_b' | 'windup' | 'strike' | 'follow' | 'hit' | 'guard' | 'victory'
/** One pose's art, palette (rarity swap and fallen dim, no flash) and its offset from `x`. */
export type PoseArt = {
  art: SpriteArt
  palette: readonly number[]
  raritySlot: number | null
  dx: number
}
/** An effect sprite in flight or bursting; `x`, `y` the art's top-left in stage pixels. */
export type StageEffect = { spriteId: string; art: SpriteArt; x: number; y: number; flipX: boolean }

export const POSES: readonly Pose[] = [
  'idle',
  'idle_b',
  'windup',
  'strike',
  'follow',
  'hit',
  'guard',
  'victory',
]

/** An art drawn with an actor, its top-left `dx`, `dy` from the actor's idle top-left. */
export type Mark = { art: SpriteArt; dx: number; dy: number }
/** Guard's big shield beside its holder, white while a hit lands on it. */
export type ShieldMark = Mark & { flashing: boolean }

/** Every pose the same art, for hand-built actors (tests and fixtures). */
export function samePoses(
  art: SpriteArt,
  palette: readonly number[] = art.palette,
  raritySlot: number | null = null,
): Record<Pose, PoseArt> {
  const one: PoseArt = { art, palette, raritySlot, dx: 0 }
  return {
    idle: one,
    idle_b: one,
    windup: one,
    strike: one,
    follow: one,
    hit: one,
    guard: one,
    victory: one,
  }
}

export type StageActor = {
  /** Hero or enemy id; a departed enemy keeps its id until its motions end. */
  key: string
  /** The idle sprite's id, in every pose. */
  spriteId: string
  /** `poses[pose]`'s art, palette (with the flash) and slot, kept for compose and the Raster. */
  art: SpriteArt
  /** The art's palette after the rarity swap, the fallen-hero dim and the flash. */
  palette: readonly number[]
  /**
   * The idle art's top-left in stage pixels, after step, lunge and bob: the anchor numbers measure
   * from. A pose draws at `x + poses[pose].dx`.
   */
  x: number
  y: number
  /** Source art faces right; heroes (on the right) are flipped to face left. */
  flipX: boolean
  /** 0 to 1: spawn ramps up, dissolve ramps down; the compositor thresholds it. */
  alpha: number
  /** A hero at 0 hp: each palette channel halved (opacity 0.5 on Svg). */
  fallen: boolean
  flashing: boolean
  /** The rarity slot's colour before the flash (the fallen dim applied); null without a slot. */
  accent?: number | null
  /** The palette index of `art` that takes the hero's rarity colour; null for enemies. */
  raritySlot: number | null
  pose: Pose
  /** The art of every pose, so a renderer can schedule poses other than `now`'s. */
  poses: Record<Pose, PoseArt>
  /** The pose between actions: Guard's stance on a guarding hero, else the idle pair. */
  rest?: 'idle' | 'guard'
  /** The bob's frame, twice as fast for a hasted hero; null for an actor holding still. */
  bobMs?: number | null
  /**
   * Haste's speed lines trailing a hasted hero's back, a pattern for idle A and one for idle B,
   * drawn under it in those poses; full stage only, and none in the stance or while camping.
   */
  speedLines?: readonly [Mark, Mark] | null
  /**
   * Guard's big shield, held by the front living hero on the enemies' side and drawn over it;
   * flashing white while a hit on any guarding hero flashes.
   */
  shield?: ShieldMark | null
  /**
   * A huddle member's huddle position less its slot, and the share of that offset in `x` at the
   * model's instant (0 at the slot, 1 huddled); null for a hero outside the huddle and an enemy.
   */
  huddle?: { dx: number; share: number } | null
  /** Enrage's red flash, as `flashing` is the white one. */
  redFlashing?: boolean
  /** A level-up's gold flash, as `flashing` is the white one. */
  goldFlashing?: boolean
  /** An enraged enemy's red tint, until its next hit lands; folded into `palette`. */
  tinted?: boolean
}
/** The text's top-left in stage pixels, already clamped inside the frame. */
export type StageNumber = { text: string; x: number; y: number; rgb: number }
/** A dropped item rising out of its chest. */
export type StageDrop = { spriteId: string; art: SpriteArt; x: number; y: number; alpha: number }
/** A chest where a dead enemy stood, in the phase it is in. */
export type StageChest = {
  spriteId: string
  art: SpriteArt
  x: number
  y: number
  alpha: number
  phase: ChestPhase
}
/** The light behind a rising item: a disc in its rarity colour, centre and radius in stage pixels. */
export type StageGlow = { x: number; y: number; r: number; rgb: number; alpha: number }
export type StageModel = {
  box: Box
  /** The ground strip's colour: drawn alone when the zone has no backdrop. */
  ground: number
  /**
   * The zone's painting at this scale, bottom-anchored and centre-cropped to the frame (edge
   * columns extended past its width); null on the compact stage and for a zone without one.
   */
  backdrop: SpriteArt | null
  actors: StageActor[]
  numbers: StageNumber[]
  /** Drawn after the actors, under the chests. */
  glows: StageGlow[]
  /** Drawn after the glows, under their items. */
  chests: StageChest[]
  drops: StageDrop[]
  /** Drawn after the drops, before the numbers. */
  effects: StageEffect[]
  /** Camp's campfire between the lines, drawn with the effects; `alpha` 0 before it is lit. */
  campfire?: { art: SpriteArt; x: number; y: number; alpha: number } | null
  alt: string
  /** Stage pixels per half-block cell: HIRES_SCALE for the full stage, 1 for the compact one. */
  scale: 1 | 1.5
}

const FALLBACK = spriteFor('item', '')
/** Camp's campfire: an effect sprite, not content. */
export const CAMPFIRE = spriteFor('effect', 'campfire')
/** Guard's big shield: an effect sprite, not content. */
export const SHIELD = spriteFor('effect', 'shield')
/** The chest's three drawings, all one size, so each places as the closed one does. */
export const CHESTS = {
  closed: spriteFor('chest', 'closed'),
  opening: spriteFor('chest', 'opening'),
  open: spriteFor('chest', 'open'),
} as const
/** The chest's sprite in `phase` at `p`: closed to the open phase, opening its first half, open after. */
function chestSprite(phase: ChestPhase, p: number): Sprite {
  if (phase === 'fall' || phase === 'sit') return CHESTS.closed
  return phase === 'open' && p < 0.5 ? CHESTS.opening : CHESTS.open
}
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
const progress = (m: Motion, now: number) => clamp((now - m.from) / (m.until - m.from), 0, 1)

/** The lunge's offset: out over the first half, back over the second. */
export function lungeOffset(m: Motion | undefined, now: number, scale = 1): number {
  if (m?.kind !== 'lunge') return 0
  const p = progress(m, now)
  return m.dir * Math.round(Math.round(LUNGE_PX * scale) * (p < 0.5 ? p * 2 : (1 - p) * 2))
}

/**
 * The step's offset: out over the first STEP_OUT_MS, held, back over the last STEP_OUT_MS. The
 * same pixels for every actor at a scale, a world boss's as a goblin's.
 */
export function stepOffset(m: Motion | undefined, now: number, scale = 1): number {
  if (m?.kind !== 'step') return 0
  const out = clamp((now - m.from) / STEP_OUT_MS, 0, 1)
  const back = clamp((m.until - now) / STEP_OUT_MS, 0, 1)
  return m.dir * Math.round(Math.round(STEP_PX * scale) * Math.min(out, back))
}

/**
 * A travel's offset and opacity: stepping off toward the right while fading out, then on from the
 * left while fading in; none outside a travel.
 */
export function travelAt(
  off: Motion | undefined,
  on: Motion | undefined,
  now: number,
  scale = 1,
): { dx: number; alpha: number } {
  const span = Math.round(TRAVEL_PX * scale)
  if (on?.kind === 'travel_on') {
    const p = progress(on, now)
    return { dx: -Math.round(span * (1 - p)), alpha: p }
  }
  if (off?.kind === 'travel_off') {
    const p = progress(off, now)
    return { dx: Math.round(span * p), alpha: 1 - p }
  }
  return { dx: 0, alpha: 1 }
}

/** An actor's offset from its place: the step, and the lunge from the stepped position. */
export function actionOffset(
  step: Motion | undefined,
  lunge: Motion | undefined,
  now: number,
  scale = 1,
): number {
  return stepOffset(step, now, scale) + lungeOffset(lunge, now, scale)
}

/**
 * How far into its huddle the party stands at `now`, 0 at the slots to 1 huddled, and the huddle
 * motion that says so: the latest started, else the next to come (it holds the party where it
 * starts), else none and the view's own (`huddled`).
 */
function huddleShare(
  motions: readonly Motion[],
  now: number,
  huddled: boolean,
): { share: number; motion: HuddleMotion | null } {
  const slides = motions
    .filter((m): m is HuddleMotion => m.kind === 'huddle' && m.until > now)
    .sort((a, b) => a.from - b.from)
  const started = slides.filter((m) => m.from <= now).at(-1)
  const motion = started ?? slides[0] ?? null
  if (motion === null) return { share: huddled ? 1 : 0, motion }
  // The step's ramp: straight from one end to the other.
  const p = started ? progress(motion, now) : 0
  return { share: motion.dir === 'in' ? p : 1 - p, motion }
}

/** `rgb` moved `share` of the way to `to`, per channel. */
function mix(rgb: number, to: number, share: number): number {
  const ch = (shift: number) => {
    const a = (rgb >> shift) & 0xff
    return Math.round(a + (((to >> shift) & 0xff) - a) * share) << shift
  }
  return ch(16) | ch(8) | ch(0)
}

/** An art from rows of '.' (clear) and 'K', 'S', 'W', the palette's first three colours. */
function solid(rows: readonly string[], palette: readonly number[]): SpriteArt {
  const width = rows[0]?.length ?? 0
  const px = new Uint8Array(width * rows.length)
  rows.forEach((row, y) => {
    for (let x = 0; x < width; x++) px[y * width + x] = '.KSW'.indexOf(row[x] ?? '.')
  })
  return { width, height: rows.length, palette: [0, ...palette], pixels: encode(px) }
}

/**
 * Haste's speed lines: a pattern per bob frame, each run at its share of the figure's height, from
 * the row's back out toward the tail, '.' a gap and K, S, W the tint's steps; each step how far
 * the class colour is mixed toward white, lighter as the line fades.
 */
const SPEED_LINES = {
  tint: [0.45, 0.65, 0.85],
  patterns: [
    [
      { at: 0.3, run: 'KKSSW.W' },
      { at: 0.5, run: 'KKKSSSW.W.W' },
      { at: 0.7, run: 'KKSSW' },
      { at: 0.9, run: 'KKKSSW.W' },
    ],
    [
      { at: 0.3, run: 'KKKSSW.W' },
      { at: 0.5, run: 'KKSSW.W' },
      { at: 0.7, run: 'KKKSSSW.W.W' },
      { at: 0.9, run: 'KKSW' },
    ],
  ],
} as const
const speedLinesCache = new WeakMap<SpriteArt, Map<number, readonly [Mark, Mark]>>()

/**
 * One pattern of the speed lines in `rgb` behind `art`, a hero's idle A or B, from its idle
 * top-left: each run starts in the first column past the figure's back in its row (heroes face
 * left, so their back is on the right).
 */
function speedLinesOn(art: SpriteArt, pattern: number, rgb: number): Mark | null {
  const box = opaqueBox(art)
  const runs = SPEED_LINES.patterns[pattern]
  if (!box || !runs) return null
  const px = decodePixels(art)
  const lines = runs.map(({ at, run }) => {
    const y = box.y0 + Math.round(at * (box.y1 - box.y0))
    // The row's back, mirrored: the first opaque source column is the last drawn one.
    let back = box.x0
    while (back < art.width && (px[y * art.width + back] ?? 0) === 0) back++
    return { y, x: art.width - back, run }
  })
  const x0 = Math.min(...lines.map((l) => l.x))
  const y0 = Math.min(...lines.map((l) => l.y))
  const width = Math.max(...lines.map((l) => l.x + l.run.length)) - x0
  const height = Math.max(...lines.map((l) => l.y)) - y0 + 1
  const rows = Array.from({ length: height }, () => '.'.repeat(width).split(''))
  for (const l of lines) {
    const row = rows[l.y - y0]
    for (let i = 0; i < l.run.length && row; i++) row[l.x - x0 + i] = l.run[i] ?? '.'
  }
  const palette = SPEED_LINES.tint.map((share) => mix(rgb, 0xffffff, share))
  return {
    art: solid(
      rows.map((r) => r.join('')),
      palette,
    ),
    dx: x0,
    dy: y0,
  }
}

/** Haste's speed lines in a class colour behind a hero, for its idle A and its idle B. */
function speedLinesOf(
  idle: SpriteArt,
  idleB: SpriteArt,
  rgb: number,
): readonly [Mark, Mark] | null {
  let byRgb = speedLinesCache.get(idle)
  if (!byRgb) {
    byRgb = new Map()
    speedLinesCache.set(idle, byRgb)
  }
  const hit = byRgb.get(rgb)
  if (hit) return hit
  const a = speedLinesOn(idle, 0, rgb)
  const b = speedLinesOn(idleB, 1, rgb)
  if (!a || !b) return null
  const pair = [a, b] as const
  byRgb.set(rgb, pair)
  return pair
}

/**
 * The big shield `art` beside a hero's idle figure, on the enemies' side: its bottom on the
 * figure's ground row, its back edge over the figure's first `overlap` columns. Heroes are drawn
 * flipped, so the figure's front is the mirror of its art's right edge.
 */
function shieldBeside(
  idle: SpriteArt,
  art: SpriteArt,
  overlap: number,
  flashing: boolean,
): ShieldMark | null {
  const figure = opaqueBox(idle)
  const shield = opaqueBox(art)
  if (!figure || !shield) return null
  const front = idle.width - 1 - figure.x1
  return {
    art,
    dx: front + overlap - 1 - shield.x1,
    dy: figure.y1 - shield.y1,
    flashing,
  }
}

function halve(rgb: number): number {
  return ((rgb >> 1) & 0x7f0000) | ((rgb >> 1) & 0x007f00) | ((rgb >> 1) & 0x00007f)
}

/** The art an actor carries on the stage and its rarity slot: compact, or 1.5x. */
export function variant(sprite: Sprite, compact: boolean): SpriteArt {
  return compact ? sprite.compact : sprite.hires
}

function slotOf(sprite: Sprite, compact: boolean): number | null {
  return compact ? sprite.raritySlot : sprite.raritySlotHires
}

/**
 * The art of each pose. On the full stage the drawn frames, the squash and the hit lean; on the
 * compact stage one drawing, the hero's attack art through the wind-up and strike (as the lunge
 * span showed it before the frames), the idle art otherwise.
 */
function posesOf(
  sprite: Sprite,
  attack: Sprite | null,
  compact: boolean,
  flipX: boolean,
  recolour: (palette: readonly number[], slot: number | null) => readonly number[],
): Record<Pose, PoseArt> {
  const pose = (art: SpriteArt, raritySlot: number | null, dx = 0, lit = false): PoseArt => {
    const palette = recolour(art.palette, raritySlot)
    return {
      art,
      palette: lit ? palette.map((c, i) => (i === 0 ? c : lighten(c))) : palette,
      raritySlot,
      dx,
    }
  }
  const idleArt = variant(sprite, compact)
  const idle = pose(idleArt, slotOf(sprite, compact))
  /** The stance leans toward the art's facing; flipped, it moves left to keep the feet. */
  const guardOf = (): PoseArt => {
    const lean = stance(idleArt)
    return pose(lean.art, idle.raritySlot, flipX ? -lean.grow : 0)
  }
  if (compact) {
    const act = attack ? pose(variant(attack, compact), slotOf(attack, compact)) : idle
    // On the compact stage a hero keeps its idle through the victory too (ADR 0007).
    return {
      idle,
      idle_b: idle,
      windup: act,
      strike: act,
      follow: idle,
      hit: idle,
      guard: guardOf(),
      victory: idle,
    }
  }
  const f = sprite.frames
  const strike = f
    ? pose(f.strike.art, f.strike.raritySlot)
    : attack
      ? pose(attack.hires, attack.raritySlotHires)
      : idle
  const leaned = shear(idleArt)
  return {
    idle,
    idle_b: pose(squash(idleArt), idle.raritySlot),
    windup: f ? pose(f.windup.art, f.windup.raritySlot) : idle,
    strike,
    follow: f?.follow ? pose(f.follow.art, f.follow.raritySlot) : strike,
    hit: pose(leaned.art, idle.raritySlot, flipX ? 0 : -leaned.grow, true),
    guard: guardOf(),
    victory: f?.victory ? pose(f.victory.art, f.victory.raritySlot) : idle,
  }
}

/**
 * The stage at `now`: where every actor, number and drop is and how it looks. `view` is the staged
 * state at `now` (stage/staged.ts): its enemies are the line, a departed one included while it is
 * held, and a hero is fallen once the blow that kills him has landed.
 */
export function stageAt(
  view: GameView,
  timeline: StageTimeline,
  now: number,
  box: Box,
  opts: { compact: boolean; motion: 'full' | 'still' },
): StageModel {
  // The full stage is the one scene at 1.5 on every surface; the compact stage is 1x.
  const scale = opts.compact ? 1 : HIRES_SCALE
  const px = (v: number) => Math.round(v * scale)
  const width = Math.ceil(box.columns * scale)
  const height = Math.ceil(box.rows * 2 * scale)
  const pitch = opts.compact ? COMPACT_PITCH : px(ACTOR_PITCH)
  const edge = opts.compact ? 0 : px(ACTOR_EDGE)
  const started = timeline.active(now).filter((m) => m.from <= now)
  const all = timeline.active(now)
  const motionOf = (actor: string, kind: Motion['kind']) =>
    started.find((m) => m.actor === actor && m.kind === kind)
  /** The bob's frame: twice as fast while hasted; none under still. */
  const bobOf = (hasted: boolean): number | null =>
    opts.motion === 'full' ? (hasted ? HASTE_FRAME_MS : IDLE_FRAME_MS) : null
  /** The bob: on the compact stage the 1-pixel lift on the actor's clock; else the idle pair. */
  const liftOf = (bobMs: number | null): number =>
    opts.compact && bobMs !== null ? bobbingAt(now, bobMs) * px(IDLE_BOB_PX) : 0
  /**
   * Hit wins, then the follow-through, the strike and the wind-up, then a hero's victory pose; at
   * rest Guard's stance, or the idle pair on the actor's bob.
   */
  const poseOf = (
    actor: string,
    fallen: boolean,
    rest: 'idle' | 'guard',
    bobMs: number | null,
    sliding = false,
  ): Pose => {
    if (fallen) return 'idle'
    for (const kind of ['hit', 'follow', 'strike', 'windup', 'victory'] as const) {
      if (motionOf(actor, kind)) return kind
    }
    // A huddle's slide holds idle A, as a step costs no new frame.
    if (sliding) return 'idle'
    if (rest === 'guard') return 'guard'
    return bobMs !== null && bobbingAt(now, bobMs) === 1 ? 'idle_b' : 'idle'
  }
  /** A flash is a blink at its start; on the compact stage it holds for the whole flash. */
  const isFlashing = (
    actor: string,
    kind: 'flash' | 'red_flash' | 'gold_flash' = 'flash',
  ): boolean => {
    const flash = motionOf(actor, kind)
    return flash !== undefined && (opts.compact || now < flash.from + BLINK_MS)
  }
  const fill = (rgb: number) => (palette: readonly number[]) =>
    palette.map((c, i) => (i === 0 ? c : rgb))
  const white = fill(FLASH_RGB)
  const red = fill(ENRAGE_RGB)
  const gold = fill(LEVEL_RGB)

  const actors: StageActor[] = []
  const bosses: StageActor[] = []
  // The party stands in its order, left to right as the heroes window lists it: the first hero
  // faces the enemies, the last stands at the right edge.
  const partySize = Math.min(view.heroes.length, 3)
  // Where the party starts: an enemy never stands in it.
  const frontHero = view.heroes[0]
  const heroLeft = frontHero
    ? width -
      edge -
      variant(spriteFor('hero', frontHero.cls), opts.compact).width -
      (partySize - 1) * pitch
    : width
  // Enemies stand in slot order, each clear of the one before when there is room: a boss is
  // wider than the pitch, and minions can join its encounter.
  let nextFree = edge
  const gap = opts.compact ? 0 : px(ACTOR_PITCH) - px(SPRITE_PX)

  /** Each actor's top-left without the bob: effects never bob. */
  const grounded = new Map<string, { x: number; y: number; width: number; height: number }>()
  /** Each enemy's place on the ground, without its step and lunge: where a chest lands. */
  const stands = new Map<string, { x: number; y: number; width: number; height: number }>()
  for (const known of view.enemies) {
    const sprite = SPRITES[enemySpriteId(known)] ?? FALLBACK
    const art = variant(sprite, opts.compact)
    const slotX = edge + Math.round(timeline.placeAt(known.id, now) * pitch)
    const roomLeft = heroLeft - gap - art.width
    const baseX = Math.max(edge, Math.min(Math.max(slotX, nextFree), roomLeft))
    nextFree = Math.max(nextFree, baseX + art.width + gap)
    // Departed: whole until its dissolve starts, then fading; gone once the dissolve is over and
    // only its drop holds it, dead in the staged state. A live row at 0 stands whole: a world boss
    // whose bar this party has emptied waits for the server to disengage it.
    const dissolve = all.find((m) => m.actor === known.id && m.kind === 'dissolve')
    let alpha = known.hp > 0 || !timeline.isDeparted(known.id) ? 1 : 0
    if (dissolve !== undefined) alpha = now < dissolve.from ? 1 : 1 - progress(dissolve, now)
    const spawn = motionOf(known.id, 'spawn')
    if (spawn) alpha = Math.min(alpha, progress(spawn, now))
    const lunge = motionOf(known.id, 'lunge')
    const step = motionOf(known.id, 'step')
    const flashing = isFlashing(known.id)
    const redFlashing = !flashing && isFlashing(known.id, 'red_flash')
    const tinted = motionOf(known.id, 'enraged') !== undefined
    const boss = known.kind !== 'wave'
    const poses = posesOf(sprite, null, opts.compact, false, (p) => p)
    const bobMs = bobOf(false)
    const pose = poseOf(known.id, false, 'idle', bobMs)
    const shown = poses[pose]
    const palette = flashing
      ? white(shown.palette)
      : redFlashing
        ? red(shown.palette)
        : tinted
          ? shown.palette.map((c, i) => (i === 0 ? c : mix(c, ENRAGE_RGB, ENRAGE_TINT)))
          : shown.palette
    const x = baseX + actionOffset(step, lunge, now, scale)
    const ground = { y: height - art.height, width: art.width, height: art.height }
    grounded.set(known.id, { ...ground, x })
    stands.set(known.id, { ...ground, x: baseX })
    ;(boss ? bosses : actors).push({
      key: known.id,
      spriteId: sprite.id,
      art: shown.art,
      palette,
      x,
      y: height - art.height - liftOf(bobMs),
      flipX: false,
      alpha,
      fallen: false,
      flashing,
      accent: null,
      raritySlot: null,
      pose,
      poses,
      rest: 'idle',
      bobMs,
      redFlashing,
      tinted,
    })
  }
  // The right edge of the enemies' line: where the campfire's ground starts.
  const enemyRight = view.enemies.length > 0 ? nextFree - gap : edge

  // Bosses draw over their minions, never under.
  actors.push(...bosses)

  // The front of the party is its first hero standing: a fallen one holds no shield, and the next
  // one standing takes it at once.
  const front = view.heroes.findIndex((h) => h.alive)
  // A hit on any guarding hero lands on the shield: it flashes in the struck hero's flash.
  const shieldFlashing = view.heroes.some((h) => isFlashing(h.id))
  /** A hero's place in the line, without its offsets. */
  const slotX = (index: number, art: SpriteArt) =>
    width - edge - art.width - (partySize - 1 - index) * pitch
  // Guard's huddle, on the full stage (the compact one draws one hero): its members, fixed as it
  // began, stand in party order, the first in its slot and each other with its figure a gap behind
  // the figure before it. Heroes face left, so a figure's back is its right edge.
  const huddle = huddleShare(all, now, huddles(view))
  const huddleDx = new Map<string, number>()
  if (!opts.compact) {
    const members = new Set(
      huddle.motion?.members ??
        timeline.huddled() ??
        view.heroes.filter((h) => h.alive).map((h) => h.id),
    )
    let back: number | null = null
    view.heroes.forEach((hero, index) => {
      if (!members.has(hero.id)) return
      const art = variant(spriteFor('hero', hero.cls), false)
      const box = opaqueBox(art) ?? { x0: 0, x1: art.width - 1 }
      const slot = slotX(index, art)
      const x = back === null ? slot : back + 1 + HUDDLE_GAP_PX - (art.width - 1 - box.x1)
      huddleDx.set(hero.id, x - slot)
      back = x + art.width - 1 - box.x0
    })
  }
  const sliding = huddle.motion !== null && huddle.motion.from <= now
  view.heroes.forEach((hero, index) => {
    const fallen = !hero.alive
    const lunge = fallen ? undefined : motionOf(hero.id, 'lunge')
    const step = fallen ? undefined : motionOf(hero.id, 'step')
    const sprite = spriteFor('hero', hero.cls)
    const attack = spriteFor('hero_attack', hero.cls)
    const art = variant(sprite, opts.compact)
    const rarity = RARITY_RGB[hero.rarity] ?? RARITY_RGB.common ?? 0
    const recolour = (base: readonly number[], slot: number | null): readonly number[] => {
      let palette = [...base]
      if (slot !== null) palette[slot] = rarity
      if (fallen) palette = palette.map((c, i) => (i === 0 ? c : halve(c)))
      return palette
    }
    const poses = posesOf(sprite, attack, opts.compact, true, recolour)
    const rest = hero.guarding && !fallen ? 'guard' : 'idle'
    const bobMs = fallen || rest === 'guard' ? null : bobOf(hero.hasted)
    const dx = huddleDx.get(hero.id)
    const pose = poseOf(hero.id, fallen, rest, bobMs, sliding && dx !== undefined)
    const shown = poses[pose]
    // Haste's speed lines are the full stage's (compact, the bob alone), at rest in the idle
    // pair only: never in the stance, never in camp. Guard's shield is on both stages.
    const speedLines =
      !opts.compact && !fallen && hero.hasted && rest === 'idle' && !view.camping
        ? speedLinesOf(poses.idle.art, poses.idle_b.art, CLASS_RGB[hero.cls] ?? 0)
        : null
    const shield =
      rest === 'guard' && index === front
        ? shieldBeside(
            poses.idle.art,
            variant(SHIELD, opts.compact),
            px(SHIELD_OVERLAP_PX),
            shieldFlashing,
          )
        : null
    const flashing = !fallen && isFlashing(hero.id)
    const goldFlashing = !fallen && !flashing && isFlashing(hero.id, 'gold_flash')
    const accent = shown.raritySlot === null ? null : (shown.palette[shown.raritySlot] ?? null)
    const travel = travelAt(
      motionOf(hero.id, 'travel_off'),
      motionOf(hero.id, 'travel_on'),
      now,
      scale,
    )
    const x =
      slotX(index, art) +
      Math.round((dx ?? 0) * huddle.share) +
      actionOffset(step, lunge, now, scale) +
      travel.dx
    grounded.set(hero.id, { x, y: height - art.height, width: art.width, height: art.height })
    actors.push({
      key: hero.id,
      spriteId: sprite.id,
      art: shown.art,
      palette: flashing ? white(shown.palette) : goldFlashing ? gold(shown.palette) : shown.palette,
      x,
      y: height - art.height - liftOf(bobMs),
      flipX: true,
      alpha: travel.alpha,
      fallen,
      flashing,
      goldFlashing,
      accent,
      raritySlot: shown.raritySlot,
      pose,
      poses,
      rest,
      bobMs,
      speedLines,
      shield,
      huddle: dx === undefined ? null : { dx, share: huddle.share },
    })
  })

  const at = new Map(actors.map((a) => [a.key, a]))
  const numbers: StageNumber[] = []
  const glows: StageGlow[] = []
  const chests: StageChest[] = []
  const drops: StageDrop[] = []
  const effects: StageEffect[] = []
  const block = glyphBlock(scale)
  for (const m of started) {
    if (m.kind === 'chest') {
      // A chest from where its actor stands; one with no actor from its slot's ground.
      const closed = variant(CHESTS.closed, opts.compact)
      const stood =
        m.actor === null
          ? groundStand(m.slot, closed, height, opts.compact, scale)
          : stands.get(m.actor)
      if (!stood) continue
      const { phase, p } = chestPhaseAt(m, now)
      const sprite = chestSprite(phase, p)
      const art = variant(sprite, opts.compact)
      const item = variant(SPRITES[m.spriteId] ?? FALLBACK, opts.compact)
      const place = chestPlace(stood, closed, item, { width, height }, scale)
      const alpha = phase === 'fade' ? 1 - p : 1
      // The fall eases in, as a thing dropped does.
      const y =
        phase === 'fall' ? place.fromY + (place.groundY - place.fromY) * p * p : place.groundY
      chests.push({ spriteId: sprite.id, art, x: place.x, y: Math.round(y), alpha, phase })
      if (phase === 'fall' || phase === 'sit' || phase === 'open') continue
      const rise = phase === 'rise' ? p : 1
      glows.push(glowOf(m, item, place, rise * alpha))
      drops.push({
        spriteId: m.spriteId,
        art: item,
        x: place.itemX,
        y: Math.round(place.itemY + (place.risenY - place.itemY) * rise),
        alpha,
      })
      continue
    }
    if (m.kind === 'campfire' || m.kind === 'huddle') continue
    const actor = at.get(m.actor)
    if (!actor) continue
    // Numbers measure from the idle art, whatever the pose.
    const anchor = actor.poses.idle.art
    if (m.kind === 'number') {
      const w = textWidth(m.text, block)
      const x = clamp(Math.round(actor.x + (anchor.width - w) / 2), 0, Math.max(0, width - w))
      const rise = progress(m, now) * px(NUMBER_RISE_PX)
      const y = clamp(Math.round(actor.y + px(2) - rise), 0, height - GLYPH_HEIGHT * block)
      numbers.push({ text: m.text, x, y, rgb: m.rgb })
    } else if (m.kind === 'effect') {
      const at = grounded.get(m.actor)
      const to = grounded.get(m.target)
      if (!at || !to) continue
      // Thrown from where the attacker stood as it threw: stepped out, whatever its step does since.
      const step = motionOf(m.actor, 'step')
      const shift = stepOffset(step, m.from, scale) - stepOffset(step, now, scale)
      const from = { ...at, x: at.x + shift }
      const sprite = SPRITES[`effect:${m.effect}`] ?? FALLBACK
      const art = variant(sprite, opts.compact)
      const flipX = actor.flipX
      const p = m.shape === 'bolt' ? progress(m, now) : 1
      const placed = effectAt(art, flipX, from, to, p)
      if (!placed) continue
      const { x: ex, y: ey } = placed
      effects.push({ spriteId: sprite.id, art, x: ex, y: ey, flipX })
    }
  }

  let campfire: StageModel['campfire'] = null
  const camp = all.find((m) => m.kind === 'campfire')
  if (camp) {
    // Centred on the ground between the enemies' line and the party, in the frame.
    const art = variant(CAMPFIRE, opts.compact)
    const x = clamp(
      Math.round((enemyRight + heroLeft - art.width) / 2),
      0,
      Math.max(0, width - art.width),
    )
    const lit = camp.from + CAMPFIRE_MS
    const alpha = now < camp.from ? 0 : now < lit ? 1 : 1 - (now - lit) / CAMPFIRE_FADE_MS
    campfire = { art, x, y: height - art.height, alpha }
  }

  // Ground and backdrop are the base zone's: tier 2's zone 1 stands on zone 1's.
  const base = zoneAt(view.zone)?.base
  return {
    box,
    ground: ZONE_GROUND[(base ?? 1) - 1] ?? ZONE_GROUND[0] ?? 0,
    backdrop: opts.compact || base === undefined ? null : backdropFor(base),
    actors,
    numbers,
    glows,
    chests,
    drops,
    effects,
    campfire,
    alt: altText(view),
    scale,
  }
}

type Place = { x: number; y: number; width: number; height: number }

/**
 * The glow behind a chest's item: on the risen item's centre, its radius by rarity scaled with the
 * item's art, at GLOW_ALPHA times `level` (the rise's progress, then the fade's).
 */
export function glowOf(
  m: ChestMotion,
  item: SpriteArt,
  place: { itemX: number; risenY: number },
  level: number,
): StageGlow {
  return {
    x: place.itemX + item.width / 2,
    y: place.risenY + item.height / 2,
    r: Math.round((GLOW_RADIUS_PX[m.rarity] * item.width) / SPRITE_PX),
    rgb: RARITY_RGB[m.rarity] ?? 0,
    alpha: GLOW_ALPHA * level,
  }
}

/**
 * The box a chest with no actor falls into, in place of an actor's art box: the closed chest
 * (`chest`) centred on `slot`'s place, on the ground of a frame `height` tall, where a wave enemy
 * standing in that slot would leave it.
 */
export function groundStand(
  slot: number,
  chest: SpriteArt,
  height: number,
  compact: boolean,
  scale: number,
): Place {
  const px = (v: number) => Math.round(v * scale)
  const pitch = compact ? COMPACT_PITCH : px(ACTOR_PITCH)
  const edge = compact ? 0 : px(ACTOR_EDGE)
  // An actor fills its pitch less the gap between neighbours, and the compact stage has none.
  const cx = edge + slot * pitch + (compact ? COMPACT_PITCH : px(SPRITE_PX)) / 2
  return {
    x: Math.round(cx - chest.width / 2),
    y: height - chest.height,
    width: chest.width,
    height: chest.height,
  }
}

/**
 * Where a chest goes for the actor that stood at `stood`, in stage pixels: centred under the
 * actor, its bottom starting at the actor's centre (`fromY`) and falling to the ground
 * (`groundY`); its item centred on the chest's top (`itemY`), risen DROP_RISE_PX (`risenY`),
 * kept inside the frame. `chest` is the closed art: the item rises from the box, not the open lid.
 */
export function chestPlace(
  stood: Place,
  chest: SpriteArt,
  item: SpriteArt,
  frame: { width: number; height: number },
  scale: number,
): { x: number; fromY: number; groundY: number; itemX: number; itemY: number; risenY: number } {
  const cx = stood.x + stood.width / 2
  const groundY = frame.height - chest.height
  const top = groundY + (opaqueBox(chest)?.y0 ?? 0)
  const itemTop = (y: number) =>
    clamp(Math.round(y - item.height / 2), 0, Math.max(0, frame.height - item.height))
  return {
    x: clamp(Math.round(cx - chest.width / 2), 0, Math.max(0, frame.width - chest.width)),
    fromY: Math.round(stood.y + stood.height / 2) - chest.height,
    groundY,
    itemX: clamp(Math.round(cx - item.width / 2), 0, Math.max(0, frame.width - item.width)),
    itemY: itemTop(top),
    risenY: itemTop(top - Math.round(DROP_RISE_PX * scale)),
  }
}

/**
 * An effect sprite's top-left at progress `p`: its opaque box's centre (mirrored with the art)
 * moves from the attacker's front edge at its vertical middle (p = 0) to the target's centre
 * (p = 1); a burst sits at p = 1. Null for an empty art.
 */
export function effectAt(
  art: SpriteArt,
  flipX: boolean,
  from: Place,
  to: Place,
  p: number,
): { x: number; y: number } | null {
  const box = opaqueBox(art)
  if (!box) return null
  const bx = (box.x0 + box.x1 + 1) / 2
  const ox = flipX ? art.width - bx : bx
  const oy = (box.y0 + box.y1 + 1) / 2
  const tx = to.x + to.width / 2
  const ty = to.y + to.height / 2
  const fx = flipX ? from.x : from.x + from.width
  const fy = from.y + from.height / 2
  return { x: Math.round(fx + (tx - fx) * p - ox), y: Math.round(fy + (ty - fy) * p - oy) }
}

/** The stage in words; `view` is the staged state, so a hero is down once the blow has landed. */
export function altText(view: GameView): string {
  const enemies = view.enemies.map((e) => `${e.name} ${e.hp}/${e.maxHp}`).join(', ')
  const heroes = view.heroes.map((h) => `${h.name} L${h.level}${h.alive ? '' : ' down'}`).join(', ')
  return `${zoneHead(view.zone)}, wave ${view.wave}: ${enemies || 'no enemies'} vs ${heroes}`
}
