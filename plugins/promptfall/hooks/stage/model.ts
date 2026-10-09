import type { GameView } from '../../types'
import { lighten, opaqueBox, shear, squash } from '../sprites/derive'
import { SPRITES } from '../sprites/generated'
import { backdropFor, spriteFor } from '../sprites/index'
import type { Sprite, SpriteArt } from '../sprites/types'
import { GLYPH_HEIGHT, glyphBlock, textWidth } from './font'
import type { Box } from './layout'
import { bobbingAt, enemySpriteId, type Motion, type StageTimeline } from './timeline'
import {
  ACTOR_EDGE,
  ACTOR_PITCH,
  BLINK_MS,
  COMPACT_PITCH,
  DROP_RISE_PX,
  FLASH_RGB,
  IDLE_BOB_PX,
  LUNGE_PX,
  NUMBER_RISE_PX,
  RARITY_RGB,
  SPRITE_PX,
  ZONE_GROUND,
} from './tuning'

/** The drawing an actor shows: idle A and B, the three drawn frames, and the hit frame. */
export type Pose = 'idle' | 'idle_b' | 'windup' | 'strike' | 'follow' | 'hit'
/** One pose's art, palette (rarity swap and fallen dim, no flash) and its offset from `x`. */
export type PoseArt = {
  art: SpriteArt
  palette: readonly number[]
  raritySlot: number | null
  dx: number
}
/** An effect sprite in flight or bursting; `x`, `y` the art's top-left in stage pixels. */
export type StageEffect = { spriteId: string; art: SpriteArt; x: number; y: number; flipX: boolean }

export const POSES: readonly Pose[] = ['idle', 'idle_b', 'windup', 'strike', 'follow', 'hit']

/** Every pose the same art, for hand-built actors (tests and fixtures). */
export function samePoses(
  art: SpriteArt,
  palette: readonly number[] = art.palette,
  raritySlot: number | null = null,
): Record<Pose, PoseArt> {
  const one: PoseArt = { art, palette, raritySlot, dx: 0 }
  return { idle: one, idle_b: one, windup: one, strike: one, follow: one, hit: one }
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
   * The idle art's top-left in stage pixels, after lunge and bob: the anchor numbers and drops
   * measure from. A pose draws at `x + poses[pose].dx`.
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
}
/** The text's top-left in stage pixels, already clamped inside the frame. */
export type StageNumber = { text: string; x: number; y: number; rgb: number }
export type StageDrop = { spriteId: string; art: SpriteArt; x: number; y: number; alpha: number }
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
  drops: StageDrop[]
  /** Drawn after the drops, before the numbers. */
  effects: StageEffect[]
  alt: string
  /** Stage pixels per half-block cell: 1, or HIRES_SCALE for the full stage on Image and Svg. */
  scale: 1 | 1.5
}

const FALLBACK = spriteFor('item', '')
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
const progress = (m: Motion, now: number) => clamp((now - m.from) / (m.until - m.from), 0, 1)

/** The lunge's offset: out over the first half, back over the second. */
export function lungeOffset(m: Motion | undefined, now: number, scale = 1): number {
  if (m?.kind !== 'lunge') return 0
  const p = progress(m, now)
  return m.dir * Math.round(Math.round(LUNGE_PX * scale) * (p < 0.5 ? p * 2 : (1 - p) * 2))
}

function halve(rgb: number): number {
  return ((rgb >> 1) & 0x7f0000) | ((rgb >> 1) & 0x007f00) | ((rgb >> 1) & 0x00007f)
}

/** The art an actor carries and its rarity slot: compact, 1x full or 1.5x. */
export function variant(sprite: Sprite, compact: boolean, scale: number): SpriteArt {
  return compact ? sprite.compact : scale === 1 ? sprite.full : sprite.hires
}

function slotOf(sprite: Sprite, compact: boolean, scale: number): number | null {
  return compact || scale === 1 ? sprite.raritySlot : sprite.raritySlotHires
}

/**
 * The art of each pose. At 1.5 the drawn frames, the squash and the hit lean; at 1 and on the
 * compact stage one drawing, the hero's attack art through the wind-up and strike (as the lunge
 * span showed it before the frames), the idle art otherwise.
 */
function posesOf(
  sprite: Sprite,
  attack: Sprite | null,
  compact: boolean,
  scale: number,
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
  const idleArt = variant(sprite, compact, scale)
  const idle = pose(idleArt, slotOf(sprite, compact, scale))
  if (compact || scale === 1) {
    const act = attack
      ? pose(variant(attack, compact, scale), slotOf(attack, compact, scale))
      : idle
    return { idle, idle_b: idle, windup: act, strike: act, follow: idle, hit: idle }
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
  opts: { compact: boolean; motion: 'full' | 'still'; scale?: 1 | 1.5 },
): StageModel {
  // The compact stage is always 1x.
  const scale = opts.compact ? 1 : (opts.scale ?? 1)
  const px = (v: number) => Math.round(v * scale)
  const width = Math.ceil(box.columns * scale)
  const height = Math.ceil(box.rows * 2 * scale)
  const pitch = opts.compact ? COMPACT_PITCH : px(ACTOR_PITCH)
  const edge = opts.compact ? 0 : px(ACTOR_EDGE)
  const started = timeline.active(now).filter((m) => m.from <= now)
  const all = timeline.active(now)
  const bob = opts.motion === 'full' ? timeline.bobbing(now) * px(IDLE_BOB_PX) : 0
  const motionOf = (actor: string, kind: Motion['kind']) =>
    started.find((m) => m.actor === actor && m.kind === kind)
  /** Hit wins, then the follow-through, the strike and the wind-up; at rest the idle pair. */
  const poseOf = (actor: string, fallen: boolean): Pose => {
    if (fallen) return 'idle'
    for (const kind of ['hit', 'follow', 'strike', 'windup'] as const) {
      if (motionOf(actor, kind)) return kind
    }
    return opts.motion === 'full' && bobbingAt(now) === 1 ? 'idle_b' : 'idle'
  }
  /** At 1.5 the white is a blink at the flash's start; at 1 it holds for the whole flash. */
  const isFlashing = (actor: string): boolean => {
    const flash = motionOf(actor, 'flash')
    return flash !== undefined && (scale === 1 || now < flash.from + BLINK_MS)
  }
  const white = (palette: readonly number[]) => palette.map((c, i) => (i === 0 ? c : FLASH_RGB))
  // The bob: at 1 the 1-pixel lift; at 1.5 the idle pair replaces it.
  const lift = scale === 1 ? bob : 0

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
      variant(spriteFor('hero', frontHero.cls), opts.compact, scale).width -
      (partySize - 1) * pitch
    : width
  // Enemies stand in slot order, each clear of the one before when there is room: a boss is
  // wider than the pitch, and minions can join its encounter.
  let nextFree = edge
  const gap = opts.compact ? 0 : px(ACTOR_PITCH) - px(SPRITE_PX)

  /** Each actor's top-left without the bob: effects never bob. */
  const grounded = new Map<string, { x: number; y: number; width: number; height: number }>()
  for (const known of view.enemies) {
    const sprite = SPRITES[enemySpriteId(known)] ?? FALLBACK
    const art = variant(sprite, opts.compact, scale)
    const slotX = edge + Math.round(timeline.placeAt(known.id, now) * pitch)
    const roomLeft = heroLeft - gap - art.width
    const baseX = Math.max(edge, Math.min(Math.max(slotX, nextFree), roomLeft))
    nextFree = Math.max(nextFree, baseX + art.width + gap)
    // Departed: whole until its dissolve starts, then fading; gone once the dissolve is over and
    // only its drop holds it, dead in the staged state.
    const dissolve = all.find((m) => m.actor === known.id && m.kind === 'dissolve')
    let alpha = known.hp > 0 ? 1 : 0
    if (dissolve !== undefined) alpha = now < dissolve.from ? 1 : 1 - progress(dissolve, now)
    const spawn = motionOf(known.id, 'spawn')
    if (spawn) alpha = Math.min(alpha, progress(spawn, now))
    const lunge = motionOf(known.id, 'lunge')
    const flashing = isFlashing(known.id)
    const boss = known.kind !== 'wave'
    const poses = posesOf(sprite, null, opts.compact, scale, false, (p) => p)
    const pose = poseOf(known.id, false)
    const shown = poses[pose]
    const x = baseX + lungeOffset(lunge, now, scale)
    grounded.set(known.id, { x, y: height - art.height, width: art.width, height: art.height })
    ;(boss ? bosses : actors).push({
      key: known.id,
      spriteId: sprite.id,
      art: shown.art,
      palette: flashing ? white(shown.palette) : shown.palette,
      x,
      y: height - art.height - lift,
      flipX: false,
      alpha,
      fallen: false,
      flashing,
      accent: null,
      raritySlot: null,
      pose,
      poses,
    })
  }

  // Bosses draw over their minions, never under.
  actors.push(...bosses)

  view.heroes.forEach((hero, index) => {
    const fallen = !hero.alive
    const lunge = fallen ? undefined : motionOf(hero.id, 'lunge')
    const sprite = spriteFor('hero', hero.cls)
    const attack = spriteFor('hero_attack', hero.cls)
    const art = variant(sprite, opts.compact, scale)
    const rarity = RARITY_RGB[hero.rarity] ?? RARITY_RGB.common ?? 0
    const recolour = (base: readonly number[], slot: number | null): readonly number[] => {
      let palette = [...base]
      if (slot !== null) palette[slot] = rarity
      if (fallen) palette = palette.map((c, i) => (i === 0 ? c : halve(c)))
      return palette
    }
    const poses = posesOf(sprite, attack, opts.compact, scale, true, recolour)
    const pose = poseOf(hero.id, fallen)
    const shown = poses[pose]
    const flashing = !fallen && isFlashing(hero.id)
    const accent = shown.raritySlot === null ? null : (shown.palette[shown.raritySlot] ?? null)
    const x =
      width - edge - art.width - (partySize - 1 - index) * pitch + lungeOffset(lunge, now, scale)
    grounded.set(hero.id, { x, y: height - art.height, width: art.width, height: art.height })
    actors.push({
      key: hero.id,
      spriteId: sprite.id,
      art: shown.art,
      palette: flashing ? white(shown.palette) : shown.palette,
      x,
      y: height - art.height - (fallen ? 0 : lift),
      flipX: true,
      alpha: 1,
      fallen,
      flashing,
      accent,
      raritySlot: shown.raritySlot,
      pose,
      poses,
    })
  })

  const at = new Map(actors.map((a) => [a.key, a]))
  const numbers: StageNumber[] = []
  const drops: StageDrop[] = []
  const effects: StageEffect[] = []
  const block = glyphBlock(scale)
  for (const m of started) {
    const actor = at.get(m.actor)
    if (!actor) continue
    // Numbers and drops measure from the idle art, whatever the pose.
    const anchor = actor.poses.idle.art
    if (m.kind === 'number') {
      const w = textWidth(m.text, block)
      const x = clamp(Math.round(actor.x + (anchor.width - w) / 2), 0, Math.max(0, width - w))
      const rise = progress(m, now) * px(NUMBER_RISE_PX)
      const y = clamp(Math.round(actor.y + px(2) - rise), 0, height - GLYPH_HEIGHT * block)
      numbers.push({ text: m.text, x, y, rgb: m.rgb })
    } else if (m.kind === 'drop') {
      const item = variant(SPRITES[m.item] ?? FALLBACK, opts.compact, scale)
      const p = progress(m, now)
      const cx = actor.x + anchor.width / 2
      const cy = actor.y + anchor.height / 2
      drops.push({
        spriteId: m.item,
        art: item,
        x: clamp(Math.round(cx - item.width / 2), 0, Math.max(0, width - item.width)),
        y: clamp(
          Math.round(cy - item.height / 2 - p * px(DROP_RISE_PX)),
          0,
          Math.max(0, height - item.height),
        ),
        alpha: p < 2 / 3 ? 1 : (1 - p) * 3,
      })
    } else if (m.kind === 'effect') {
      const from = grounded.get(m.actor)
      const to = grounded.get(m.target)
      if (!from || !to) continue
      const sprite = SPRITES[`effect:${m.effect}`] ?? FALLBACK
      const art = variant(sprite, opts.compact, scale)
      const flipX = actor.flipX
      const p = m.shape === 'bolt' ? progress(m, now) : 1
      const placed = effectAt(art, flipX, from, to, p)
      if (!placed) continue
      const { x: ex, y: ey } = placed
      effects.push({ spriteId: sprite.id, art, x: ex, y: ey, flipX })
    }
  }

  return {
    box,
    ground: ZONE_GROUND[view.zone - 1] ?? ZONE_GROUND[0] ?? 0,
    backdrop: opts.compact ? null : backdropFor(view.zone, scale),
    actors,
    numbers,
    drops,
    effects,
    alt: altText(view),
    scale,
  }
}

type Place = { x: number; y: number; width: number; height: number }

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
  return `Zone ${view.zone}, wave ${view.wave}: ${enemies || 'no enemies'} vs ${heroes}`
}
