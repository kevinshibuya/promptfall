import type { GameView } from '../../types'
import { SPRITES } from '../sprites/generated'
import { spriteFor } from '../sprites/index'
import type { Sprite, SpriteArt } from '../sprites/types'
import { GLYPH_HEIGHT, textWidth } from './font'
import type { Box } from './layout'
import type { Motion, StageTimeline } from './timeline'
import {
  ACTOR_EDGE,
  ACTOR_PITCH,
  COMPACT_PITCH,
  DROP_RISE_PX,
  FLASH_RGB,
  IDLE_BOB_PX,
  LUNGE_PX,
  NUMBER_RISE_PX,
  RARITY_RGB,
  ZONE_GROUND,
} from './tuning'

export type StageActor = {
  /** Hero or enemy id; a departed enemy keeps its id until its motions end. */
  key: string
  spriteId: string
  art: SpriteArt
  /** The art's palette after the rarity swap, the fallen-hero dim and the flash. */
  palette: readonly number[]
  /** Top-left in stage pixels, after lunge, bob and spawn offsets. */
  x: number
  y: number
  /** Source art faces right; heroes (on the right) are flipped to face left. */
  flipX: boolean
  /** 0 to 1: spawn ramps up, dissolve ramps down; the compositor thresholds it. */
  alpha: number
  /** A hero at 0 hp: each palette channel halved (opacity 0.5 on Svg). */
  fallen: boolean
  flashing: boolean
}
/** The text's top-left in stage pixels, already clamped inside the frame. */
export type StageNumber = { text: string; x: number; y: number; rgb: number }
export type StageDrop = { spriteId: string; art: SpriteArt; x: number; y: number; alpha: number }
export type StageModel = {
  box: Box
  ground: number
  actors: StageActor[]
  numbers: StageNumber[]
  drops: StageDrop[]
  alt: string
}

const FALLBACK = spriteFor('item', '')
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
const progress = (m: Motion, now: number) => clamp((now - m.from) / (m.until - m.from), 0, 1)

/** The lunge's offset: out over the first half, back over the second. */
function lungeOffset(m: Motion | undefined, now: number): number {
  if (m?.kind !== 'lunge') return 0
  const p = progress(m, now)
  return m.dir * Math.round(LUNGE_PX * (p < 0.5 ? p * 2 : (1 - p) * 2))
}

function halve(rgb: number): number {
  return ((rgb >> 1) & 0x7f0000) | ((rgb >> 1) & 0x007f00) | ((rgb >> 1) & 0x00007f)
}

function variant(sprite: Sprite, compact: boolean): SpriteArt {
  return compact ? sprite.compact : sprite.full
}

/**
 * The stage at `now`: where every actor, number and drop is and how it looks. The caller has
 * observed `view` on `timeline` first, so the enemies it knows are the view's plus the departed.
 */
export function stageAt(
  view: GameView,
  timeline: StageTimeline,
  now: number,
  box: Box,
  opts: { compact: boolean; motion: 'full' | 'still' },
): StageModel {
  const width = box.columns
  const height = box.rows * 2
  const pitch = opts.compact ? COMPACT_PITCH : ACTOR_PITCH
  const edge = opts.compact ? 0 : ACTOR_EDGE
  const started = timeline.active(now).filter((m) => m.from <= now)
  const all = timeline.active(now)
  const bob = opts.motion === 'full' ? timeline.bobbing(now) * IDLE_BOB_PX : 0
  const motionOf = (actor: string, kind: Motion['kind']) =>
    started.find((m) => m.actor === actor && m.kind === kind)

  const actors: StageActor[] = []
  const live = new Set(view.enemies.map((e) => e.id))

  for (const known of timeline.known()) {
    const sprite = SPRITES[known.spriteId] ?? FALLBACK
    const art = variant(sprite, opts.compact)
    let alpha = 1
    if (!live.has(known.id)) {
      // Departed: whole until its dissolve starts, then fading; gone once the dissolve is over.
      const dissolve = all.find((m) => m.actor === known.id && m.kind === 'dissolve')
      alpha = dissolve === undefined ? 0 : now < dissolve.from ? 1 : 1 - progress(dissolve, now)
    }
    const spawn = motionOf(known.id, 'spawn')
    if (spawn) alpha = Math.min(alpha, progress(spawn, now))
    const lunge = motionOf(known.id, 'lunge')
    const flashing = motionOf(known.id, 'flash') !== undefined
    actors.push({
      key: known.id,
      spriteId: sprite.id,
      art,
      palette: flashing ? art.palette.map((c, i) => (i === 0 ? c : FLASH_RGB)) : art.palette,
      x: edge + known.slot * pitch + lungeOffset(lunge, now),
      y: height - art.height - bob,
      flipX: false,
      alpha,
      fallen: false,
      flashing,
    })
  }

  view.heroes.forEach((hero, index) => {
    const fallen = !hero.alive
    const lunge = fallen ? undefined : motionOf(hero.id, 'lunge')
    const sprite = spriteFor(lunge ? 'hero_attack' : 'hero', hero.cls)
    const art = variant(sprite, opts.compact)
    const flashing = !fallen && motionOf(hero.id, 'flash') !== undefined
    let palette = [...art.palette]
    if (sprite.raritySlot !== null) {
      palette[sprite.raritySlot] = RARITY_RGB[hero.rarity] ?? RARITY_RGB.common ?? 0
    }
    if (fallen) palette = palette.map((c, i) => (i === 0 ? c : halve(c)))
    if (flashing) palette = palette.map((c, i) => (i === 0 ? c : FLASH_RGB))
    actors.push({
      key: hero.id,
      spriteId: sprite.id,
      art,
      palette,
      x: width - edge - art.width - index * pitch + lungeOffset(lunge, now),
      y: height - art.height - (fallen ? 0 : bob),
      flipX: true,
      alpha: 1,
      fallen,
      flashing,
    })
  })

  const at = new Map(actors.map((a) => [a.key, a]))
  const numbers: StageNumber[] = []
  const drops: StageDrop[] = []
  for (const m of started) {
    const actor = at.get(m.actor)
    if (!actor) continue
    if (m.kind === 'number') {
      const w = textWidth(m.text)
      const x = clamp(Math.round(actor.x + (actor.art.width - w) / 2), 0, Math.max(0, width - w))
      const rise = progress(m, now) * NUMBER_RISE_PX
      const y = clamp(Math.round(actor.y + 2 - rise), 0, height - GLYPH_HEIGHT)
      numbers.push({ text: m.text, x, y, rgb: m.rgb })
    } else if (m.kind === 'drop') {
      const item = variant(SPRITES[m.item] ?? FALLBACK, opts.compact)
      const p = progress(m, now)
      const cx = actor.x + actor.art.width / 2
      const cy = actor.y + actor.art.height / 2
      drops.push({
        spriteId: m.item,
        art: item,
        x: clamp(Math.round(cx - item.width / 2), 0, Math.max(0, width - item.width)),
        y: clamp(
          Math.round(cy - item.height / 2 - p * DROP_RISE_PX),
          0,
          Math.max(0, height - item.height),
        ),
        alpha: p < 2 / 3 ? 1 : (1 - p) * 3,
      })
    }
  }

  return {
    box,
    ground: ZONE_GROUND[view.zone - 1] ?? ZONE_GROUND[0] ?? 0,
    actors,
    numbers,
    drops,
    alt: altText(view),
  }
}

function altText(view: GameView): string {
  const enemies = view.enemies.map((e) => `${e.name} ${e.hp}/${e.maxHp}`).join(', ')
  const heroes = view.heroes.map((h) => `${h.name} L${h.level}`).join(', ')
  return `Zone ${view.zone}, wave ${view.wave}: ${enemies || 'no enemies'} vs ${heroes}`
}
