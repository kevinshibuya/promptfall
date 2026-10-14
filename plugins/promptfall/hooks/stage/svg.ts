import type { GameView } from '../../types'
import { shearShifts, squashRow } from '../sprites/derive'
import { SPRITES } from '../sprites/generated'
import { decodePixels } from '../sprites/index'
import type { SpriteArt } from '../sprites/types'
import { CELL_H, CELL_W } from '../windows/tuning'
import { backdropOrigin, frameSize } from './compose'
import { GLYPH_HEIGHT, glyphBlock, TEXT_OUTLINE_RGB, textWidth } from './font'
import type { Box } from './layout'
import {
  actionOffset,
  CHESTS,
  chestPlace,
  effectAt,
  glowOf,
  groundStand,
  type Mark,
  type Pose,
  type ShieldMark,
  type StageActor,
  type StageModel,
  stageAt,
  stepOffset,
  travelAt,
  variant,
} from './model'
import { colourPath } from './paths'
import { svgFrame } from './playfield'
import {
  bobbingAt,
  CHEST_SHOW_MS,
  type HuddleMotion,
  type Motion,
  type StageTimeline,
} from './timeline'
import {
  BLINK_MS,
  CAMPFIRE_MS,
  CHEST_FALL_MS,
  CHEST_OPEN_MS,
  CHEST_SIT_MS,
  COMPACT_STAGE_ROWS,
  ENRAGE_RGB,
  ENRAGE_TINT,
  GLOW_ALPHA,
  IDLE_BOB_PX,
  IDLE_FRAME_MS,
  LEVEL_RGB,
  LUNGE_PX,
  NUMBER_RISE_PX,
  REVEAL_FADE_MS,
  REVEAL_RISE_MS,
  STEP_OUT_MS,
  STEP_PX,
  SVG_FALLBACK_FRAME_MS,
  SVG_MAX_CHARS,
  TRAVEL_PX,
} from './tuning'

type PoseMotion = Extract<Motion, { kind: 'windup' | 'strike' | 'follow' | 'hit' | 'victory' }>
/** A span a pose shows over: a pose motion's, or a huddle's slide, which holds idle A. */
type PoseSpan = { kind: PoseMotion['kind'] | 'huddle'; from: number; until: number }
const POSE_RANK: Readonly<Record<PoseSpan['kind'], number>> = {
  hit: 4,
  follow: 3,
  strike: 2,
  windup: 1,
  victory: 0,
  huddle: -1,
}
const isPoseMotion = (m: Motion): m is PoseMotion =>
  m.kind === 'windup' ||
  m.kind === 'strike' ||
  m.kind === 'follow' ||
  m.kind === 'hit' ||
  m.kind === 'victory'

/**
 * The pose motions whose frames a redraw at `now` carries (reading 10): live at `now` or starting
 * before the next redraw, and any that follows on from one of those without a gap (the rest of
 * the same action). A victory pose is carried from the kill, so the hold plays with no redraw.
 */
export function framesInUse(mine: readonly Motion[], now: number): PoseMotion[] {
  const poses = mine.filter(isPoseMotion).filter((m) => m.until > now)
  const used = new Set(
    poses.filter((m) => m.from < now + SVG_FALLBACK_FRAME_MS || m.kind === 'victory'),
  )
  let grew = true
  while (grew) {
    grew = false
    for (const m of poses) {
      if (used.has(m)) continue
      if ([...used].some((u) => u.until === m.from)) {
        used.add(m)
        grew = true
      }
    }
  }
  return poses.filter((m) => used.has(m))
}

/** Disjoint spans of the pose shown, each the highest-ranked pose motion over it. */
function poseSpans(
  motions: readonly PoseSpan[],
  now: number,
): { pose: Pose; from: number; until: number }[] {
  const cuts = [...new Set(motions.flatMap((m) => [m.from, m.until]))].sort((a, b) => a - b)
  const spans: { pose: Pose; from: number; until: number }[] = []
  for (let i = 0; i + 1 < cuts.length; i++) {
    const a = cuts[i] ?? 0
    const b = cuts[i + 1] ?? 0
    if (b <= now) continue
    let top: PoseSpan | null = null
    for (const m of motions) {
      if (m.from <= a && a < m.until && (top === null || POSE_RANK[m.kind] > POSE_RANK[top.kind]))
        top = m
    }
    if (top === null) continue
    const pose = top.kind === 'huddle' ? 'idle' : top.kind
    const last = spans.at(-1)
    if (last && last.pose === pose && last.until === a) last.until = b
    else spans.push({ pose, from: a, until: b })
  }
  return spans
}

/** The flood filters: the white flash, Enrage's red, a level-up's gold. */
type Flash = 'flash' | 'redflash' | 'goldflash'
const FLASH_OF: Partial<Record<Motion['kind'], Flash>> = {
  flash: 'flash',
  red_flash: 'redflash',
  gold_flash: 'goldflash',
}
/** The flood filter a motion blinks, if it is a flash. */
const flashOf = (m: Motion): Flash | null => FLASH_OF[m.kind] ?? null
/**
 * An actor still to appear: spawning, or stepping on after a travel whose step off this picture no
 * longer carries. It starts transparent and its animation fades it in.
 */
const appearing = (mine: readonly Motion[]): boolean =>
  mine.some((m) => m.kind === 'spawn') ||
  (mine.some((m) => m.kind === 'travel_on') && !mine.some((m) => m.kind === 'travel_off'))

const hex = (rgb: number) => `#${(rgb & 0xffffff).toString(16).padStart(6, '0')}`
/** The stage picture's colours: `#abc` where the six digits pair up. */
const paint = (rgb: number) => hex(rgb).replace(/^#(\w)\1(\w)\2(\w)\3$/, '#$1$2$3')
const seconds = (ms: number) => `${Number((ms / 1000).toFixed(3))}s`
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/** One <path> per colour: the run-length `M x y h w v 1 h -w z` of its horizontal runs. */
export function artPaths(art: SpriteArt, raritySlot: number | null): string {
  const px = decodePixels(art)
  const runs = new Map<number, string[]>()
  for (let y = 0; y < art.height; y++) {
    let x = 0
    while (x < art.width) {
      const v = px[y * art.width + x] ?? 0
      let end = x + 1
      while (end < art.width && px[y * art.width + end] === v) end++
      if (v !== 0) {
        const w = end - x
        const list = runs.get(v) ?? []
        list.push(`M${x} ${y}h${w}v1h-${w}z`)
        runs.set(v, list)
      }
      x = end
    }
  }
  return [...runs.keys()]
    .sort((a, b) => a - b)
    .map((v) => {
      const fill = v === raritySlot ? 'currentColor' : hex(art.palette[v] ?? 0)
      return `<path fill="${fill}" d="${(runs.get(v) ?? []).join('')}"/>`
    })
    .join('')
}

/**
 * Where each copy of a `w`-wide painting goes across a `W`-wide frame whose painting starts at
 * `ox`: the painting itself, then mirrored copies outward on both sides until the frame is covered,
 * every other one plain again. A mirrored copy at `x` is drawn with `scale(-1 1)`, so `x` is its
 * right edge; this matches compose's `mirrored` column by column.
 */
export function backdropPlacements(
  w: number,
  W: number,
  ox: number,
): { x: number; mirror: boolean }[] {
  const out: { x: number; mirror: boolean }[] = [{ x: ox, mirror: false }]
  for (let k = 1; ox - (k - 1) * w > 0 || ox + k * w < W; k++) {
    const mirror = k % 2 === 1
    if (ox - (k - 1) * w > 0) out.push({ x: mirror ? ox - (k - 1) * w : ox - k * w, mirror })
    if (ox + k * w < W) out.push({ x: mirror ? ox + (k + 1) * w : ox + k * w, mirror })
  }
  return out
}

/**
 * An art on the stage picture (ticket #210's encoding): each colour one path, the shortest of its
 * rectangles filled and its runs stroked (`paths.ts`), the rarity colour as currentColor. Built
 * once per art and slot: the backdrop is the largest art on the stage, and every redraw draws
 * the same arts again.
 */
const strokeCache = new WeakMap<SpriteArt, Map<number | null, string>>()
export function strokePaths(art: SpriteArt, raritySlot: number | null): string {
  let bySlot = strokeCache.get(art)
  if (bySlot === undefined) {
    bySlot = new Map()
    strokeCache.set(art, bySlot)
  }
  let paths = bySlot.get(raritySlot)
  if (paths === undefined) {
    const grid = { width: art.width, height: art.height, px: decodePixels(art) }
    paths = [...new Set(grid.px)]
      .filter((v) => v !== 0)
      .sort((a, b) => a - b)
      .map((v) =>
        colourPath(grid, v, v === raritySlot ? 'currentColor' : paint(art.palette[v] ?? 0)),
      )
      .join('')
    bySlot.set(raritySlot, paths)
  }
  return paths
}

/**
 * The stage picture's ids, one letter each while there are few enough: the filters and the
 * backdrop on their own, the arts and their row clips in turn from the letters left.
 */
const ID = { flash: 'f', redflash: 'r', goldflash: 'g', hit: 'h', backdrop: 'b' } as const
const LETTERS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'
const FREE = [...LETTERS].filter((c) => !Object.values(ID).some((id) => id === c))
const nthId = (i: number): string => {
  if (i < FREE.length) return FREE[i] ?? ''
  const j = i - FREE.length
  return `${LETTERS[Math.floor(j / LETTERS.length) % LETTERS.length]}${LETTERS[j % LETTERS.length]}`
}

/**
 * The degradation ladder (spec #209) for a picture past the engine's cap: each rung keeps the ones
 * before it. The idle pair goes (idle A alone, the actor holds still), then the hit filter (the
 * hit frame's lean without its lightening), then the backdrop painting (the ground strip alone).
 * No rung drops a drawn frame.
 */
export const RUNGS = ['first rung', 'no idle pair', 'no hit filter', 'no backdrop'] as const
export type Rung = 0 | 1 | 2 | 3

export type SvgOpts = {
  smil: boolean
  now: number
  width: number
  motion: 'full' | 'still'
  fit?: number
  /** The ladder's rung drawn; the first when absent. */
  rung?: Rung
}

/**
 * The stage as one SVG document. Each art stem is drawn once under <defs> and <use>d per actor.
 * With `smil`, motions under way or still to come animate from their offsets against `now`
 * (negative `begin` for one already under way), so a redraw resumes mid-motion; without it,
 * the model as of `now`. Dissolve and spawn are opacity here, not the Bayer pattern.
 */
export function renderSvg(model: StageModel, motions: readonly Motion[], opts: SvgOpts): string {
  const { width: W, height: H } = frameSize(model)
  const rung = opts.rung ?? 0
  const hitLit = model.scale !== 1 && rung < 2
  const backdrop = rung < 3 ? model.backdrop : null
  const scale = model.scale
  const px = (v: number) => Math.round(v * scale)
  const block = glyphBlock(scale)
  const compact = model.box.rows <= COMPACT_STAGE_ROWS
  const live = motions.filter((m) => m.until > opts.now)
  let named = 0
  const ids = new Map<SpriteArt, string>()
  const defs: string[] = []
  const define = (art: SpriteArt, raritySlot: number | null): string => {
    let id = ids.get(art)
    if (id === undefined) {
      id = nthId(named++)
      ids.set(art, id)
      defs.push(`<g id="${id}" fill="none">${strokePaths(art, raritySlot)}</g>`)
    }
    return id
  }
  const clips = new Map<string, string>()
  /** A row band of an art, in its own coordinates; deduplicated per art like the defs. */
  const rowClip = (key: string, width: number, y: number, h: number): string => {
    let id = clips.get(key)
    if (id === undefined) {
      id = nthId(named++)
      clips.set(key, id)
      defs.push(
        `<clipPath id="${id}"><rect x="0" y="${y}" width="${width}" height="${h}"/></clipPath>`,
      )
    }
    return id
  }
  const begin = (m: Motion) => seconds(m.from - opts.now)
  const dur = (m: Motion) => seconds(m.until - m.from)
  const bobPx = px(IDLE_BOB_PX)
  const travelPx = px(TRAVEL_PX)
  /**
   * The step and the lunge as translates on the actor's group, summed with its place; a travel's
   * step off and on with their fades.
   */
  const moveAnim = (m: Motion): string | null => {
    if (m.kind === 'travel_off') {
      return `<animateTransform attributeName="transform" type="translate" additive="sum" values="0 0;${travelPx} 0" begin="${begin(m)}" dur="${dur(m)}"/><animate attributeName="opacity" values="1;0" begin="${begin(m)}" dur="${dur(m)}" fill="freeze"/>`
    }
    if (m.kind === 'travel_on') {
      return `<animateTransform attributeName="transform" type="translate" additive="sum" values="-${travelPx} 0;0 0" begin="${begin(m)}" dur="${dur(m)}"/><animate attributeName="opacity" values="0;1" begin="${begin(m)}" dur="${dur(m)}" fill="freeze"/>`
    }
    if (m.kind === 'lunge') {
      const dx = m.dir * px(LUNGE_PX)
      return `<animateTransform attributeName="transform" type="translate" additive="sum" values="0 0;${dx} 0;0 0" begin="${begin(m)}" dur="${dur(m)}"/>`
    }
    if (m.kind === 'step') {
      const dx = m.dir * px(STEP_PX)
      const out = Number((STEP_OUT_MS / (m.until - m.from)).toFixed(3))
      return `<animateTransform attributeName="transform" type="translate" additive="sum" values="0 0;${dx} 0;${dx} 0;0 0" keyTimes="0;${out};${Number((1 - out).toFixed(3))};1" begin="${begin(m)}" dur="${dur(m)}"/>`
    }
    return null
  }
  /**
   * A huddle's slide on a member's group, as a translate summed with its place: from where the
   * slide starts to where it ends, held there.
   */
  const slideAnim = (actor: StageActor, m: HuddleMotion): string => {
    const dx = (m.dir === 'in' ? 1 : -1) * (actor.huddle?.dx ?? 0)
    return `<animateTransform attributeName="transform" type="translate" additive="sum" values="0 0;${dx} 0" begin="${begin(m)}" dur="${dur(m)}" fill="freeze"/>`
  }
  const ground = px(2)

  // The backdrop as paths, like any art (no <image>): one def, used bottom-anchored and centred
  // as compose places it, and mirrored outward on each side while the frame is wider (the
  // Image zoom-out; the desktop Svg never outgrows the painting, ADR 0004).
  const body: string[] = [
    backdrop
      ? (() => {
          const at = backdropOrigin(backdrop, W, H)
          defs.push(`<g id="${ID.backdrop}" fill="none">${strokePaths(backdrop, null)}</g>`)
          return backdropPlacements(backdrop.width, W, at.x)
            .map(
              (p) =>
                `<use href="#${ID.backdrop}" transform="translate(${p.x} ${at.y})${p.mirror ? ' scale(-1 1)' : ''}"/>`,
            )
            .join('')
        })()
      : `<rect x="0" y="${H - ground}" width="${W}" height="${ground}" fill="${paint(model.ground)}"/>`,
  ]
  const base = new Map<string, { x: number; y: number; actor: StageActor }>()
  /** Guard's shield on the flat Svg, white while a hit lands on it: drawn over every actor. */
  const marks: string[] = []

  /** Enrage's red is in the document: its filter goes in the defs. */
  let red = false
  /** A level-up's gold is in the document: its filter goes in the defs. */
  let gold = false
  /**
   * One pose of an actor, drawn from its art's def; the hit pose leans through row clips. A flash
   * filter (white or red) floods the art, so it carries no colour.
   */
  const poseMarkup = (actor: StageActor, pose: Pose, filter: 'hit' | Flash | null): string => {
    const shown = actor.poses[pose]
    const slot = shown.raritySlot
    // The hit's palette is already lightened; its filter lightens the idle colour instead.
    const tint = pose === 'hit' ? actor.poses.idle.palette : shown.palette
    const flood = filter !== null && filter !== 'hit'
    if (filter === 'redflash') red = true
    if (filter === 'goldflash') gold = true
    const color = slot === null || flood ? '' : ` color="${paint(tint[slot] ?? 0)}"`
    const filt = filter ? ` filter="url(#${ID[filter]})"` : ''
    const derivedFrom = pose === 'hit' || pose === 'idle_b' ? actor.poses.idle : shown
    const art = derivedFrom.art
    const id = define(art, derivedFrom.raritySlot)
    const flipOf = (w: number) => (actor.flipX ? `translate(${w} 0) scale(-1 1)` : '')
    if (pose === 'idle_b') {
      const cut = squashRow(art)
      if (!cut)
        return `<use href="#${id}"${actor.flipX ? ` transform="${flipOf(art.width)}"` : ''}${color}${filt}/>`
      const up = rowClip(`${id}:u`, art.width, 0, cut.m)
      const low = rowClip(`${id}:l`, art.width, cut.m + 1, art.height - cut.m - 1)
      return `<g${color}${filt}><use href="#${id}" clip-path="url(#${up})" transform="${['translate(0 1)', flipOf(art.width)].filter(Boolean).join(' ')}"/><use href="#${id}" clip-path="url(#${low})"${actor.flipX ? ` transform="${flipOf(art.width)}"` : ''}/></g>`
    }
    if (pose === 'hit') {
      const s = shearShifts(art)
      const k = s?.k ?? 0
      const bands: string[] = []
      if (s) {
        for (let v = 0; v <= k; v++) {
          let y0 = -1
          let y1 = -1
          for (let y = s.r0; y <= s.r1; y++) {
            if (s.shift(y) !== v) continue
            if (y0 < 0) y0 = y
            y1 = y
          }
          if (y0 < 0) continue
          const c = rowClip(`${id}:h${v}`, art.width, y0, y1 - y0 + 1)
          bands.push(`<use href="#${id}" clip-path="url(#${c})" transform="translate(${v} 0)"/>`)
        }
      } else bands.push(`<use href="#${id}"/>`)
      const flip = flipOf(art.width + k)
      const t = `translate(${shown.dx} 0)${flip ? ` ${flip}` : ''}`
      return `<g transform="${t}"${color}${filt}>${bands.join('')}</g>`
    }
    // Guard's stance carries the offset that keeps its feet on the idle's.
    const t = [
      shown.dx ? `translate(${shown.dx} 0)` : '',
      actor.flipX ? flipOf(shown.art.width) : '',
    ]
      .filter(Boolean)
      .join(' ')
    return `<use href="#${define(shown.art, slot)}"${t ? ` transform="${t}"` : ''}${color}${filt}/>`
  }
  /** A mark drawn with an actor (Haste's streak, Guard's shield), from its idle top-left. */
  const markUse = (m: Mark | null | undefined): string =>
    m ? `<use href="#${define(m.art, null)}" transform="translate(${m.dx} ${m.dy})"/>` : ''
  /** The hits Guard's shield takes: each hero's white flash, whoever it struck. */
  const heroes = new Set(model.actors.filter((a) => a.flipX).map((a) => a.key))
  const blows = live.filter((m) => m.kind === 'flash' && heroes.has(m.actor))
  /**
   * Guard's shield under SMIL, from its holder's idle top-left: white over each hit's blink (`blink`
   * of the flash, the whole flash on the compact stage), as the struck hero's own.
   */
  const shieldMarkup = (m: ShieldMark | null | undefined, blink: (f: Motion) => string): string => {
    if (!m) return ''
    const t = `transform="translate(${m.dx} ${m.dy})"`
    const id = define(m.art, null)
    const flashes = blows
      .map(
        (f) =>
          `<use href="#${id}" ${t} filter="url(#${ID.flash})" opacity="0"><animate attributeName="opacity" values="1;0" begin="${begin(f)}" dur="${blink(f)}"/></use>`,
      )
      .join('')
    return `<use href="#${id}" ${t}/>${flashes}`
  }
  /**
   * The bob's frame of an actor: its own, or (a hand-built actor) the plain one unless it holds
   * still; none from the ladder's second rung.
   */
  const bobMsOf = (actor: StageActor): number | null =>
    rung >= 1
      ? null
      : actor.bobMs !== undefined
        ? actor.bobMs
        : opts.motion === 'full' && !actor.fallen
          ? IDLE_FRAME_MS
          : null
  /** Each tint's red overlay held from its start to its hit's show time (or for good, still to come). */
  const tintSets = (mine: readonly Motion[]): string =>
    mine
      .filter((m) => m.kind === 'enraged')
      .map((m) => {
        const end = Number.isFinite(m.until) ? ` dur="${dur(m)}"` : ''
        return `<set attributeName="opacity" to="${ENRAGE_TINT}" begin="${begin(m)}"${end}/>`
      })
      .join('')

  /** The 1.5x actor under SMIL: the idle pair on the bob's clock, the frames in use over it. */
  const hiresActor = (
    actor: StageActor,
    mine: readonly Motion[],
    x: number,
    slides: readonly HuddleMotion[],
  ): string => {
    const anim: string[] = slides.map((m) => slideAnim(actor, m))
    for (const m of mine) {
      const move = moveAnim(m)
      if (move !== null) {
        anim.push(move)
      } else if (m.kind === 'spawn') {
        anim.push(
          `<animate attributeName="opacity" values="0;1" begin="${begin(m)}" dur="${dur(m)}" fill="freeze"/>`,
        )
      } else if (m.kind === 'dissolve') {
        anim.push(
          `<animate attributeName="opacity" values="1;0" begin="${begin(m)}" dur="${dur(m)}" fill="freeze"/>`,
        )
      }
    }
    const spans = actor.fallen
      ? []
      : poseSpans([...framesInUse(mine, opts.now), ...slides], opts.now)
    const hide = spans
      .map(
        (sp) =>
          `<set attributeName="visibility" to="hidden" begin="${seconds(sp.from - opts.now)}" dur="${seconds(sp.until - sp.from)}"/>`,
      )
      .join('')
    const parts: string[] = []
    const rest = actor.rest ?? 'idle'
    const bobMs = actor.fallen || rest === 'guard' ? null : bobMsOf(actor)
    // An enraged enemy's tint: each pose shown carries its red overlay while the tint holds.
    const tints = tintSets(mine)
    const tinted = (pose: Pose) =>
      tints ? `<g opacity="0">${tints}${poseMarkup(actor, pose, 'redflash')}</g>` : ''
    // Haste's streak trails the idle pair, under it.
    const streak = markUse(actor.fallen ? null : actor.streak)
    if (bobMs !== null) {
      // Discrete on the bob's clock (1 s, or half that hasted), B in the second half; begun whole
      // periods early so any pose span (always later) outranks it.
      const period = bobMs * 2
      const start = seconds(-((opts.now % period) + 10 * period))
      const clock = (values: string) =>
        `<animate attributeName="visibility" values="${values}" calcMode="discrete" begin="${start}" dur="${seconds(period)}" repeatCount="indefinite"/>`
      parts.push(
        `<g>${clock('visible;hidden')}${hide}${streak}${poseMarkup(actor, 'idle', null)}${tinted('idle')}</g>`,
      )
      parts.push(
        `<g visibility="hidden">${clock('hidden;visible')}${hide}${streak}${poseMarkup(actor, 'idle_b', null)}${tinted('idle_b')}</g>`,
      )
    } else {
      const under = rest === 'idle' ? streak : ''
      parts.push(`<g>${hide}${under}${poseMarkup(actor, rest, null)}${tinted(rest)}</g>`)
    }
    const byPose = new Map<Pose, string[]>()
    for (const sp of spans) {
      const list = byPose.get(sp.pose) ?? []
      list.push(
        `<set attributeName="visibility" to="visible" begin="${seconds(sp.from - opts.now)}" dur="${seconds(sp.until - sp.from)}"/>`,
      )
      byPose.set(sp.pose, list)
    }
    for (const [pose, sets] of byPose) {
      parts.push(
        `<g visibility="hidden">${sets.join('')}${poseMarkup(actor, pose, pose === 'hit' && hitLit ? 'hit' : null)}${tinted(pose)}</g>`,
      )
    }
    // The white blink, Enrage's red one and a level-up's gold: over the hit frame while it shows,
    // else over the art at rest.
    for (const m of mine) {
      const filter = flashOf(m)
      if (filter === null) continue
      const onHit = byPose.has('hit') && !actor.fallen
      parts.push(
        `<g opacity="0"><animate attributeName="opacity" values="1;0" begin="${begin(m)}" dur="${seconds(BLINK_MS)}"/>${poseMarkup(actor, onHit ? 'hit' : rest, filter)}</g>`,
      )
    }
    const op = actor.fallen ? ' opacity="0.5"' : appearing(mine) ? ' opacity="0"' : ''
    const shield = shieldMarkup(actor.shield, () => seconds(BLINK_MS))
    return `<g transform="translate(${x} ${actor.y})"${op}>${anim.join('')}${parts.join('')}${shield}</g>`
  }

  for (const actor of model.actors) {
    const mine = live.filter((m) => m.actor === actor.key)
    if (actor.alpha <= 0 && !(opts.smil && appearing(mine))) {
      // Not drawn, but a chest still on its ground needs its anchor.
      base.set(actor.key, { x: actor.x, y: actor.y, actor })
      continue
    }
    // The pose-at-now art, for the paths that draw it: the 1.5x SMIL path draws every pose from
    // `poses` and must not define it (an idle B or hit art here is a def nothing uses).
    const held = rung >= 1 && actor.pose === 'idle_b'
    const drawNow = () => {
      // From the ladder's second rung the idle pair goes here too: idle B draws as idle A.
      const art = held ? actor.poses.idle.art : actor.art
      const slot = actor.raritySlot
      const id = define(art, slot)
      // The accent before any flash: the flash is an overlay here, never baked into the base. A
      // hit's own palette is already lightened; its filter lightens the idle colour instead.
      const accent =
        scale !== 1 && actor.pose === 'hit' && slot !== null
          ? actor.poses.idle.palette[slot]
          : (actor.accent ?? (slot === null ? undefined : actor.palette[slot]))
      const color = slot === null ? '' : ` color="${paint(accent ?? 0)}"`
      const flip = actor.flipX ? ` transform="translate(${art.width} 0) scale(-1 1)"` : ''
      return {
        use: `<use href="#${id}"${flip}${color}/>`,
        flashUse: `<use href="#${id}"${flip} filter="url(#${ID.flash})"`,
        redUse: `<use href="#${id}"${flip} filter="url(#${ID.redflash})"`,
        goldUse: `<use href="#${id}"${flip} filter="url(#${ID.goldflash})"`,
      }
    }
    // Haste's streak, drawn under the idle pair from the idle's place.
    const resting = actor.pose === 'idle' || actor.pose === 'idle_b'
    const streakAt = (x: number, y: number) =>
      actor.streak && resting
        ? `<g transform="translate(${x} ${y})">${markUse(actor.streak)}</g>`
        : ''

    if (!opts.smil) {
      const { use, flashUse, redUse, goldUse } = drawNow()
      const opacity = actor.fallen ? 0.5 : actor.alpha
      const op = opacity < 1 ? ` opacity="${Number(opacity.toFixed(2))}"` : ''
      if (actor.goldFlashing) gold = true
      const flash = actor.flashing ? `${flashUse}/>` : actor.goldFlashing ? `${goldUse}/>` : ''
      if (actor.redFlashing || actor.tinted) red = true
      const enraged = actor.redFlashing
        ? `${redUse}/>`
        : actor.tinted
          ? `${redUse} opacity="${ENRAGE_TINT}"/>`
          : ''
      const dx = actor.poses[held ? 'idle' : actor.pose].dx
      const hit = hitLit && actor.pose === 'hit' ? ` filter="url(#${ID.hit})"` : ''
      const drawn = hit ? `<g${hit}>${use}</g>` : use
      body.push(streakAt(actor.x, actor.y))
      body.push(
        `<g transform="translate(${actor.x + dx} ${actor.y})"${op}>${drawn}${flash}${enraged}</g>`,
      )
      const shield = actor.shield
      if (shield) {
        const white = shield.flashing
          ? `<use href="#${define(shield.art, null)}" transform="translate(${shield.dx} ${shield.dy})" filter="url(#${ID.flash})"/>`
          : ''
        marks.push(`<g transform="translate(${actor.x} ${actor.y})">${markUse(shield)}${white}</g>`)
      }
      base.set(actor.key, { x: actor.x, y: actor.y, actor })
      continue
    }

    // Back out the offsets the model baked in at `now`; the animations reapply them. A huddle
    // member stands where its first slide still to end starts, and each slide moves it on.
    const started = (kind: Motion['kind']) =>
      mine.find((m) => m.kind === kind && m.from <= opts.now)
    const huddle = actor.huddle
    const slides = huddle
      ? live
          .filter((m): m is HuddleMotion => m.kind === 'huddle' && m.members.includes(actor.key))
          .sort((a, b) => a.from - b.from)
      : []
    const first = slides[0]
    const huddled =
      huddle && first
        ? Math.round(huddle.dx * huddle.share) - (first.dir === 'in' ? 0 : huddle.dx)
        : 0
    const x =
      actor.x -
      huddled -
      actionOffset(started('step'), started('lunge'), opts.now, scale) -
      travelAt(started('travel_off'), started('travel_on'), opts.now, scale).dx
    if (scale !== 1) {
      // 1.5: no bob; the idle pair and the frames in use, one shown at any instant.
      base.set(actor.key, { x, y: actor.y, actor })
      body.push(hiresActor(actor, mine, x, slides))
      continue
    }
    const { use, flashUse, redUse, goldUse } = drawNow()
    // Back out the model's lift on the actor's own bob clock.
    const bobMs = bobMsOf(actor)
    const y = actor.y + (bobMs === null ? 0 : bobbingAt(opts.now, bobMs) * bobPx)
    base.set(actor.key, { x, y, actor })
    const anim: string[] = []
    for (const m of mine) {
      const move = moveAnim(m)
      if (move !== null) {
        anim.push(move)
      } else if (m.kind === 'spawn') {
        anim.push(
          `<animate attributeName="opacity" values="0;1" begin="${begin(m)}" dur="${dur(m)}" fill="freeze"/>`,
        )
      } else if (m.kind === 'dissolve') {
        anim.push(
          `<animate attributeName="opacity" values="1;0" begin="${begin(m)}" dur="${dur(m)}" fill="freeze"/>`,
        )
      }
    }
    if (bobMs !== null) {
      // Discrete, so it matches the pixel surfaces' bob: up for the second half of each period.
      const phase = opts.now % (bobMs * 2)
      anim.push(
        `<animateTransform attributeName="transform" type="translate" additive="sum" values="0 0;0 -${bobPx}" calcMode="discrete" begin="${seconds(-phase)}" dur="${seconds(bobMs * 2)}" repeatCount="indefinite"/>`,
      )
    }
    const uses = { flash: flashUse, redflash: redUse, goldflash: goldUse } as const
    const flashes = mine
      .map((m) => {
        const filter = flashOf(m)
        return filter === null
          ? ''
          : `${uses[filter]} opacity="0"><animate attributeName="opacity" values="1;0" begin="${begin(m)}" dur="${dur(m)}"/></use>`
      })
      .join('')
    const tints = tintSets(mine)
    if (tints || flashes.includes(`url(#${ID.redflash})`)) red = true
    if (flashes.includes(`url(#${ID.goldflash})`)) gold = true
    const tinted = tints ? `${redUse} opacity="0">${tints}</use>` : ''
    const op = actor.fallen ? ' opacity="0.5"' : appearing(mine) ? ' opacity="0"' : ''
    body.push(
      `<g transform="translate(${x} ${y})"${op}>${anim.join('')}${actor.fallen ? '' : markUse(actor.streak)}${use}${tinted}${flashes}${shieldMarkup(actor.shield, dur)}</g>`,
    )
  }
  body.push(...marks)

  /** A glow's circle in its rarity fill; `extra` its opacity or its animation. */
  const circle = (g: { x: number; y: number; r: number; rgb: number }, extra: string) =>
    `<circle cx="${g.x}" cy="${g.y}" r="${g.r}" fill="${paint(g.rgb)}"${extra}`

  if (!opts.smil) {
    for (const g of model.glows) {
      if (g.alpha > 0) body.push(`${circle(g, ` opacity="${Number(g.alpha.toFixed(2))}"`)}/>`)
    }
    for (const c of model.chests) {
      const op = c.alpha < 1 ? ` opacity="${Number(c.alpha.toFixed(2))}"` : ''
      body.push(`<use href="#${define(c.art, null)}" transform="translate(${c.x} ${c.y})"${op}/>`)
    }
    for (const d of model.drops) {
      const op = d.alpha < 1 ? ` opacity="${Number(d.alpha.toFixed(2))}"` : ''
      body.push(`<use href="#${define(d.art, null)}" transform="translate(${d.x} ${d.y})"${op}/>`)
    }
    const fire = model.campfire
    if (fire && fire.alpha > 0) {
      const op = fire.alpha < 1 ? ` opacity="${Number(fire.alpha.toFixed(2))}"` : ''
      body.push(
        `<use href="#${define(fire.art, null)}" transform="translate(${fire.x} ${fire.y})"${op}/>`,
      )
    }
    for (const e of model.effects) {
      const flip = e.flipX ? ` translate(${e.art.width} 0) scale(-1 1)` : ''
      body.push(`<use href="#${define(e.art, null)}" transform="translate(${e.x} ${e.y})${flip}"/>`)
    }
    for (const n of model.numbers) body.push(text(n.text, n.x, n.y, n.rgb, block, ''))
  } else {
    // Effects draw under the numbers, as on the pixel surfaces: they go in before the first one.
    let firstNumber = -1
    const effects: string[] = []
    for (const m of live) {
      if (m.kind === 'chest') {
        const sprite = SPRITES[m.spriteId]
        if (!sprite) continue
        const closed = variant(CHESTS.closed, compact)
        const item = variant(sprite, compact)
        // Where the actor stood, on the ground whatever its bob; with no actor, its slot's ground.
        const at = m.actor === null ? undefined : base.get(m.actor)
        const idle = at?.actor.poses.idle.art
        let stood = m.actor === null ? groundStand(m.slot, closed, H, compact, scale) : null
        if (at && idle)
          stood = { x: at.x, y: H - idle.height, width: idle.width, height: idle.height }
        if (stood === null) continue
        const place = chestPlace(stood, closed, item, { width: W, height: H }, scale)
        /** Visible from `from` to the chest's end, fading over its last REVEAL_FADE_MS. */
        const shown = (from: number) => {
          const fade = Number((1 - REVEAL_FADE_MS / (m.until - from)).toFixed(3))
          return `<animate attributeName="opacity" values="1;1;0" keyTimes="0;${fade};1" begin="${seconds(from - opts.now)}" dur="${seconds(m.until - from)}"/>`
        }
        const rise = m.from + CHEST_SHOW_MS - REVEAL_RISE_MS
        // The glow, behind the chest: its alpha ramps in over the rise, holds and fades.
        const ramp = Number((REVEAL_RISE_MS / (m.until - rise)).toFixed(3))
        const fade = Number((1 - REVEAL_FADE_MS / (m.until - rise)).toFixed(3))
        body.push(
          `${circle(glowOf(m, item, place, 1), ' opacity="0"')}><animate attributeName="opacity" values="0;${GLOW_ALPHA};${GLOW_ALPHA};0" keyTimes="0;${ramp};${fade};1" begin="${seconds(rise - opts.now)}" dur="${seconds(m.until - rise)}"/></circle>`,
        )
        // The three arts in turn, as the pose frames are: closed to the open phase, opening its
        // first half, open after; only those still to show. All one size, so one place.
        const opens = m.from + CHEST_FALL_MS + CHEST_SIT_MS
        const arts = [
          { sprite: CHESTS.closed, from: m.from, until: opens },
          { sprite: CHESTS.opening, from: opens, until: opens + CHEST_OPEN_MS / 2 },
          { sprite: CHESTS.open, from: opens + CHEST_OPEN_MS / 2, until: m.until },
        ].filter((a) => a.until > opts.now)
        const uses = arts.map((a) => {
          const href = `#${define(variant(a.sprite, compact), null)}`
          if (arts.length === 1 && a.from <= opts.now) return `<use href="${href}"/>`
          return `<use href="${href}" visibility="hidden"><set attributeName="visibility" to="visible" begin="${seconds(a.from - opts.now)}" dur="${seconds(a.until - a.from)}"/></use>`
        })
        // The fall eases in (a quadratic), as the pixel surfaces draw it.
        const fall =
          m.from + CHEST_FALL_MS > opts.now
            ? `<animateTransform attributeName="transform" type="translate" additive="sum" values="0 ${place.fromY - place.groundY};0 0" calcMode="spline" keyTimes="0;1" keySplines="0.333 0 0.667 0.333" begin="${begin(m)}" dur="${seconds(CHEST_FALL_MS)}"/>`
            : ''
        body.push(
          `<g transform="translate(${place.x} ${place.groundY})" opacity="0">${shown(m.from)}${fall}${uses.join('')}</g>`,
        )
        body.push(
          `<use href="#${define(item, null)}" transform="translate(${place.itemX} ${place.itemY})" opacity="0">${shown(rise)}<animateTransform attributeName="transform" type="translate" additive="sum" values="0 0;0 ${place.risenY - place.itemY}" begin="${seconds(rise - opts.now)}" dur="${seconds(REVEAL_RISE_MS)}" fill="freeze"/></use>`,
        )
        continue
      }
      if (m.kind === 'campfire') {
        // It sits CAMPFIRE_MS from its start, then fades; hidden until it is lit.
        const fire = model.campfire
        if (!fire) continue
        const sit = Number((CAMPFIRE_MS / (m.until - m.from)).toFixed(3))
        effects.push(
          `<use href="#${define(fire.art, null)}" transform="translate(${fire.x} ${fire.y})" opacity="0"><animate attributeName="opacity" values="1;1;0" keyTimes="0;${sit};1" begin="${begin(m)}" dur="${dur(m)}"/></use>`,
        )
        continue
      }
      if (m.actor === null) continue
      const at = base.get(m.actor)
      if (!at) continue
      if (m.kind === 'number') {
        if (firstNumber < 0) firstNumber = body.length
        const w = textWidth(m.text, block)
        const x = clamp(
          Math.round(at.x + (at.actor.poses.idle.art.width - w) / 2),
          0,
          Math.max(0, W - w),
        )
        const glyphH = GLYPH_HEIGHT * block
        const top = clamp(at.y + px(2), 0, H - glyphH)
        const rise = clamp(at.y + px(2) - px(NUMBER_RISE_PX), 0, H - glyphH) - top
        const anim = `<animate attributeName="opacity" values="1;1" begin="${begin(m)}" dur="${dur(m)}"/><animateTransform attributeName="transform" type="translate" values="0 0;0 ${rise}" begin="${begin(m)}" dur="${dur(m)}"/>`
        body.push(text(m.text, x, top, m.rgb, block, anim, ' opacity="0"'))
      } else if (m.kind === 'effect') {
        const to = base.get(m.target)
        const sprite = SPRITES[`effect:${m.effect}`]
        if (!to || !sprite) continue
        const art = variant(sprite, compact)
        // The attacker throws from where it stands as it throws: stepped out, in its own action's
        // step (a second queued action has its own).
        const step = live.find(
          (o) => o.actor === m.actor && o.kind === 'step' && o.from <= m.from && m.from < o.until,
        )
        const thrower = { ...at, x: at.x + stepOffset(step, m.from, scale) }
        const place = (a: typeof at) => ({
          x: a.x,
          y: a.y,
          width: a.actor.poses.idle.art.width,
          height: a.actor.poses.idle.art.height,
        })
        const flipX = at.actor.flipX
        const end = effectAt(art, flipX, place(thrower), place(to), 1)
        const start = m.shape === 'bolt' ? effectAt(art, flipX, place(thrower), place(to), 0) : end
        if (!start || !end) continue
        const flip = flipX ? ` transform="translate(${art.width} 0) scale(-1 1)"` : ''
        const fly =
          m.shape === 'bolt'
            ? `<animateTransform attributeName="transform" type="translate" additive="sum" values="0 0;${end.x - start.x} ${end.y - start.y}" begin="${begin(m)}" dur="${dur(m)}"/>`
            : ''
        effects.push(
          `<g transform="translate(${start.x} ${start.y})" opacity="0"><animate attributeName="opacity" values="1;1" begin="${begin(m)}" dur="${dur(m)}"/>${fly}<use href="#${define(art, null)}"${flip}/></g>`,
        )
      }
    }
    body.splice(firstNumber < 0 ? body.length : firstNumber, 0, ...effects)
  }

  const flashFilter = `<filter id="${ID.flash}"><feFlood flood-color="#fff"/><feComposite operator="in" in2="SourceAlpha"/></filter>`
  // `lighten` on every fill and stroke, currentColor included: gamma 0.6 per channel, in sRGB.
  const hitFilter = hitLit
    ? `<filter id="${ID.hit}" color-interpolation-filters="sRGB"><feComponentTransfer><feFuncR type="gamma" exponent="0.6"/><feFuncG type="gamma" exponent="0.6"/><feFuncB type="gamma" exponent="0.6"/></feComponentTransfer></filter>`
    : ''
  // Enrage's red, beside the white: the flash at the mishap and, at ENRAGE_TINT, the tint.
  const redFilter = red
    ? `<filter id="${ID.redflash}"><feFlood flood-color="${paint(ENRAGE_RGB)}"/><feComposite operator="in" in2="SourceAlpha"/></filter>`
    : ''
  // A level-up's gold, beside the white.
  const goldFilter = gold
    ? `<filter id="${ID.goldflash}"><feFlood flood-color="${paint(LEVEL_RGB)}"/><feComposite operator="in" in2="SourceAlpha"/></filter>`
    : ''
  const head = (w: number, h: number, fill = '') =>
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${opts.width}" height="${Math.round((opts.width * h) / w)}" shape-rendering="crispEdges"${fill}><defs>${flashFilter}${redFilter}${goldFilter}${hitFilter}${defs.join('')}</defs>`
  if (opts.fit === undefined) return `${head(W, H)}${body.join('')}</svg>`
  // The band's stage Svg (spec #45): the band's width on the windows' grid, the shell under the
  // stage and the line's top and sides over it. A stage fitted to `fit` of its height sits
  // centred on the shell between the line's sides; the document keeps the band's width.
  const gw = model.box.columns * CELL_W
  const gh = Number((model.box.rows * CELL_H * opts.fit).toFixed(2))
  const s = gh / H
  const dx = Number(((gw - W * s) / 2).toFixed(2))
  const frame = svgFrame(gw, gh, 'top')
  // Its rounded height must not letterbox the grid: a sliver of no shell would show under it.
  return `${head(gw, gh, ' preserveAspectRatio="none"')}${frame.under}<g transform="translate(${dx} 0) scale(${Number(s.toFixed(4))})">${body.join('')}</g>${frame.over}</svg>`
}

/**
 * The picture on the ladder's first rung its markup fits the engine's cap on, and that rung; the
 * last rung's when none fits. A rung past the first is rendered only when the one before it is
 * over the cap, so a picture under the cap never changes.
 */
export function fitSvg(
  model: StageModel,
  motions: readonly Motion[],
  opts: Omit<SvgOpts, 'rung'>,
): { svg: string; rung: Rung } {
  let rung: Rung = 0
  let svg = renderSvg(model, motions, opts)
  while (svg.length >= SVG_MAX_CHARS && rung < 3) {
    rung = (rung + 1) as Rung
    svg = renderSvg(model, motions, { ...opts, rung })
  }
  return { svg, rung }
}

/**
 * The desktop's full stage as the band's stage Svg, `fit` of its natural height: the one model on
 * the ladder's rung that fits the engine's cap. `view` is the staged state at `now`.
 */
export function stageSvg(
  view: GameView,
  timeline: StageTimeline,
  now: number,
  box: Box,
  opts: { smil: boolean; width: number; motion: 'full' | 'still'; fit: number },
): string {
  const model = stageAt(view, timeline, now, box, { compact: false, motion: opts.motion })
  return fitSvg(model, timeline.active(now), { ...opts, now }).svg
}

/** One art alone at its own size, in its own colours: the dialog's list sprites. */
export function artSvg(art: SpriteArt): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${art.width} ${art.height}" width="${art.width}" height="${art.height}" shape-rendering="crispEdges">${artPaths(art, null)}</svg>`
}

/** A number as SVG text: top-left at (x, y), the baseline under the glyph, `block` its pixel size. */
function text(
  s: string,
  x: number,
  y: number,
  rgb: number,
  block: number,
  anim: string,
  extra = '',
): string {
  // The stroke under the fill is the pixel surfaces' one-pixel outline, for pale backdrops.
  return `<text x="${x}" y="${y + GLYPH_HEIGHT * block}" fill="${paint(rgb)}" stroke="${paint(TEXT_OUTLINE_RGB)}" stroke-width="1" paint-order="stroke" font-family="monospace" font-size="${6 * block}" font-weight="bold"${extra}>${anim}${s}</text>`
}
