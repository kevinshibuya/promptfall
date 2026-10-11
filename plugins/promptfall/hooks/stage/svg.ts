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
  type Pose,
  type StageActor,
  type StageModel,
  stageAt,
  stepOffset,
  variant,
} from './model'
import { svgFrame } from './playfield'
import { bobbingAt, CHEST_SHOW_MS, type Motion, type StageTimeline } from './timeline'
import {
  BLINK_MS,
  CHEST_FALL_MS,
  CHEST_OPEN_MS,
  CHEST_SIT_MS,
  COMPACT_STAGE_ROWS,
  GLOW_ALPHA,
  HIRES_SCALE,
  IDLE_BOB_PX,
  IDLE_FRAME_MS,
  LUNGE_PX,
  NUMBER_RISE_PX,
  REVEAL_FADE_MS,
  REVEAL_RISE_MS,
  STEP_OUT_MS,
  STEP_PX,
  SVG_FALLBACK_FRAME_MS,
  SVG_MAX_CHARS,
} from './tuning'

type PoseMotion = Extract<Motion, { kind: 'windup' | 'strike' | 'follow' | 'hit' }>
const POSE_RANK: Readonly<Record<PoseMotion['kind'], number>> = {
  hit: 4,
  follow: 3,
  strike: 2,
  windup: 1,
}
const isPoseMotion = (m: Motion): m is PoseMotion =>
  m.kind === 'windup' || m.kind === 'strike' || m.kind === 'follow' || m.kind === 'hit'

/**
 * The pose motions whose frames a redraw at `now` carries (reading 10): live at `now` or starting
 * before the next redraw, and any that follows on from one of those without a gap (the rest of
 * the same action).
 */
export function framesInUse(mine: readonly Motion[], now: number): PoseMotion[] {
  const poses = mine.filter(isPoseMotion).filter((m) => m.until > now)
  const used = new Set(poses.filter((m) => m.from < now + SVG_FALLBACK_FRAME_MS))
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
  motions: readonly PoseMotion[],
  now: number,
): { pose: Pose; from: number; until: number }[] {
  const cuts = [...new Set(motions.flatMap((m) => [m.from, m.until]))].sort((a, b) => a - b)
  const spans: { pose: Pose; from: number; until: number }[] = []
  for (let i = 0; i + 1 < cuts.length; i++) {
    const a = cuts[i] ?? 0
    const b = cuts[i + 1] ?? 0
    if (b <= now) continue
    let top: PoseMotion | null = null
    for (const m of motions) {
      if (m.from <= a && a < m.until && (top === null || POSE_RANK[m.kind] > POSE_RANK[top.kind]))
        top = m
    }
    if (top === null) continue
    const last = spans.at(-1)
    if (last && last.pose === top.kind && last.until === a) last.until = b
    else spans.push({ pose: top.kind, from: a, until: b })
  }
  return spans
}

const hex = (rgb: number) => `#${(rgb & 0xffffff).toString(16).padStart(6, '0')}`
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
 * One <path> per colour of a painting, each a set of rectangles: a horizontal run joins the run
 * directly under it when both start and end at the same columns, so a sky or ground band is one
 * `M x y h w v h h -w z`. Against `artPaths` this saves 10% (zone 1) to 45% (zone 11).
 */
export function rectPaths(art: SpriteArt): string {
  const px = decodePixels(art)
  type Run = { x: number; y: number; w: number; h: number }
  const rects = new Map<number, Run[]>()
  /** The runs of the row above still open for joining, by colour. */
  let above = new Map<number, Run[]>()
  for (let y = 0; y < art.height; y++) {
    const open = new Map<number, Run[]>()
    let x = 0
    while (x < art.width) {
      const v = px[y * art.width + x] ?? 0
      let end = x + 1
      while (end < art.width && px[y * art.width + end] === v) end++
      if (v !== 0) {
        const w = end - x
        const join = above.get(v)?.find((r) => r.x === x && r.w === w && r.y + r.h === y)
        let run = join
        if (!run) {
          run = { x, y, w, h: 1 }
          const list = rects.get(v) ?? []
          list.push(run)
          rects.set(v, list)
        } else run.h++
        const list = open.get(v) ?? []
        list.push(run)
        open.set(v, list)
      }
      x = end
    }
    above = open
  }
  return [...rects.keys()]
    .sort((a, b) => a - b)
    .map((v) => {
      const d = (rects.get(v) ?? []).map((r) => `M${r.x} ${r.y}h${r.w}v${r.h}h-${r.w}z`).join('')
      return `<path fill="${hex(art.palette[v] ?? 0)}" d="${d}"/>`
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

/** A backdrop's paths, built once per painting: it is static and the largest art on the stage. */
const backdropCache = new WeakMap<SpriteArt, string>()
function backdropPaths(art: SpriteArt): string {
  let paths = backdropCache.get(art)
  if (paths === undefined) {
    paths = rectPaths(art)
    backdropCache.set(art, paths)
  }
  return paths
}

/**
 * The stage as one SVG document. Each art stem is drawn once under <defs> and <use>d per actor.
 * With `smil`, motions under way or still to come animate from their offsets against `now`
 * (negative `begin` for one already under way), so a redraw resumes mid-motion; without it,
 * the model as of `now`. Dissolve and spawn are opacity here, not the Bayer pattern.
 */
export function renderSvg(
  model: StageModel,
  motions: readonly Motion[],
  opts: { smil: boolean; now: number; width: number; motion: 'full' | 'still'; fit?: number },
): string {
  const { width: W, height: H } = frameSize(model)
  const scale = model.scale
  const px = (v: number) => Math.round(v * scale)
  const block = glyphBlock(scale)
  const compact = model.box.rows <= COMPACT_STAGE_ROWS
  const live = motions.filter((m) => m.until > opts.now)
  const ids = new Map<SpriteArt, string>()
  const defs: string[] = []
  const define = (art: SpriteArt, raritySlot: number | null): string => {
    let id = ids.get(art)
    if (id === undefined) {
      id = `a${ids.size}`
      ids.set(art, id)
      defs.push(`<g id="${id}">${artPaths(art, raritySlot)}</g>`)
    }
    return id
  }
  const clips = new Map<string, string>()
  /** A row band of an art, in its own coordinates; deduplicated per art like the defs. */
  const rowClip = (key: string, width: number, y: number, h: number): string => {
    let id = clips.get(key)
    if (id === undefined) {
      id = key
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
  /** The step and the lunge as translates on the actor's group, summed with its place. */
  const moveAnim = (m: Motion): string | null => {
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
  const bob = opts.motion === 'full' ? bobbingAt(opts.now) * bobPx : 0
  const ground = px(2)

  // The backdrop as paths, like any art (no <image>): one def, used bottom-anchored and centred
  // as compose places it, and mirrored outward on each side while the frame is wider (the
  // Image zoom-out; the desktop Svg never outgrows the painting, ADR 0004).
  const body: string[] = [
    model.backdrop
      ? (() => {
          const art = model.backdrop
          const at = backdropOrigin(art, W, H)
          defs.push(`<g id="bg">${backdropPaths(art)}</g>`)
          return backdropPlacements(art.width, W, at.x)
            .map(
              (p) =>
                `<use href="#bg" transform="translate(${p.x} ${at.y})${p.mirror ? ' scale(-1 1)' : ''}"/>`,
            )
            .join('')
        })()
      : `<rect x="0" y="${H - ground}" width="${W}" height="${ground}" fill="${hex(model.ground)}"/>`,
  ]
  const base = new Map<string, { x: number; y: number; actor: StageActor }>()

  /** One pose of an actor, drawn from its art's def; the hit pose leans through row clips. */
  const poseMarkup = (actor: StageActor, pose: Pose, filter: 'hit' | 'flash' | null): string => {
    const shown = actor.poses[pose]
    const slot = shown.raritySlot
    // The hit's palette is already lightened; its filter lightens the idle colour instead.
    const tint = pose === 'hit' ? actor.poses.idle.palette : shown.palette
    const color = slot === null || filter === 'flash' ? '' : ` color="${hex(tint[slot] ?? 0)}"`
    const filt = filter ? ` filter="url(#${filter})"` : ''
    const derivedFrom = pose === 'hit' || pose === 'idle_b' ? actor.poses.idle : shown
    const art = derivedFrom.art
    const id = define(art, derivedFrom.raritySlot)
    const flipOf = (w: number) => (actor.flipX ? `translate(${w} 0) scale(-1 1)` : '')
    if (pose === 'idle_b') {
      const cut = squashRow(art)
      if (!cut)
        return `<use href="#${id}"${actor.flipX ? ` transform="${flipOf(art.width)}"` : ''}${color}${filt}/>`
      const up = rowClip(`${id}u`, art.width, 0, cut.m)
      const low = rowClip(`${id}l`, art.width, cut.m + 1, art.height - cut.m - 1)
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
          const c = rowClip(`${id}h${v}`, art.width, y0, y1 - y0 + 1)
          bands.push(`<use href="#${id}" clip-path="url(#${c})" transform="translate(${v} 0)"/>`)
        }
      } else bands.push(`<use href="#${id}"/>`)
      const flip = flipOf(art.width + k)
      const t = `translate(${shown.dx} 0)${flip ? ` ${flip}` : ''}`
      return `<g transform="${t}"${color}${filt}>${bands.join('')}</g>`
    }
    const flip = actor.flipX ? ` transform="${flipOf(shown.art.width)}"` : ''
    return `<use href="#${define(shown.art, slot)}"${flip}${color}${filt}/>`
  }

  /** The 1.5x actor under SMIL: the idle pair on the bob's clock, the frames in use over it. */
  const hiresActor = (actor: StageActor, mine: readonly Motion[], x: number): string => {
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
    const spans = actor.fallen ? [] : poseSpans(framesInUse(mine, opts.now), opts.now)
    const hide = spans
      .map(
        (sp) =>
          `<set attributeName="visibility" to="hidden" begin="${seconds(sp.from - opts.now)}" dur="${seconds(sp.until - sp.from)}"/>`,
      )
      .join('')
    const parts: string[] = []
    const pair = opts.motion === 'full' && !actor.fallen
    if (pair) {
      // Discrete on the bob's 1 s clock, B in the second half; begun whole periods early so any
      // pose span (always later) outranks it.
      const period = IDLE_FRAME_MS * 2
      const start = seconds(-((opts.now % period) + 10 * period))
      const clock = (values: string) =>
        `<animate attributeName="visibility" values="${values}" calcMode="discrete" begin="${start}" dur="${seconds(period)}" repeatCount="indefinite"/>`
      parts.push(`<g>${clock('visible;hidden')}${hide}${poseMarkup(actor, 'idle', null)}</g>`)
      parts.push(
        `<g visibility="hidden">${clock('hidden;visible')}${hide}${poseMarkup(actor, 'idle_b', null)}</g>`,
      )
    } else {
      parts.push(`<g>${hide}${poseMarkup(actor, 'idle', null)}</g>`)
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
        `<g visibility="hidden">${sets.join('')}${poseMarkup(actor, pose, pose === 'hit' ? 'hit' : null)}</g>`,
      )
    }
    // The white blink: over the hit frame while it shows, else over the idle art.
    for (const m of mine) {
      if (m.kind !== 'flash') continue
      const onHit = byPose.has('hit') && !actor.fallen
      parts.push(
        `<g opacity="0"><animate attributeName="opacity" values="1;0" begin="${begin(m)}" dur="${seconds(BLINK_MS)}"/>${poseMarkup(actor, onHit ? 'hit' : 'idle', 'flash')}</g>`,
      )
    }
    const spawning = mine.some((m) => m.kind === 'spawn')
    const op = actor.fallen ? ' opacity="0.5"' : spawning ? ' opacity="0"' : ''
    return `<g transform="translate(${x} ${actor.y})"${op}>${anim.join('')}${parts.join('')}</g>`
  }

  for (const actor of model.actors) {
    const mine = live.filter((m) => m.actor === actor.key)
    const spawning = mine.some((m) => m.kind === 'spawn')
    if (actor.alpha <= 0 && !(opts.smil && spawning)) {
      // Not drawn, but a chest still on its ground needs its anchor.
      base.set(actor.key, { x: actor.x, y: actor.y, actor })
      continue
    }
    // The pose-at-now art, for the paths that draw it: the 1.5x SMIL path draws every pose from
    // `poses` and must not define it (an idle B or hit art here is a def nothing uses).
    const drawNow = () => {
      const slot = actor.raritySlot
      const id = define(actor.art, slot)
      // The accent before any flash: the flash is an overlay here, never baked into the base. A
      // hit's own palette is already lightened; its filter lightens the idle colour instead.
      const accent =
        scale !== 1 && actor.pose === 'hit' && slot !== null
          ? actor.poses.idle.palette[slot]
          : (actor.accent ?? (slot === null ? undefined : actor.palette[slot]))
      const color = slot === null ? '' : ` color="${hex(accent ?? 0)}"`
      const flip = actor.flipX ? ` transform="translate(${actor.art.width} 0) scale(-1 1)"` : ''
      return {
        use: `<use href="#${id}"${flip}${color}/>`,
        flashUse: `<use href="#${id}"${flip} filter="url(#flash)"`,
      }
    }

    if (!opts.smil) {
      const { use, flashUse } = drawNow()
      const opacity = actor.fallen ? 0.5 : actor.alpha
      const op = opacity < 1 ? ` opacity="${Number(opacity.toFixed(2))}"` : ''
      const flash = actor.flashing ? `${flashUse}/>` : ''
      const dx = actor.poses[actor.pose].dx
      const hit = scale !== 1 && actor.pose === 'hit' ? ' filter="url(#hit)"' : ''
      const drawn = hit ? `<g${hit}>${use}</g>` : use
      body.push(`<g transform="translate(${actor.x + dx} ${actor.y})"${op}>${drawn}${flash}</g>`)
      base.set(actor.key, { x: actor.x, y: actor.y, actor })
      continue
    }

    // Back out the offsets the model baked in at `now`; the animations reapply them.
    const started = (kind: Motion['kind']) =>
      mine.find((m) => m.kind === kind && m.from <= opts.now)
    const x = actor.x - actionOffset(started('step'), started('lunge'), opts.now, scale)
    if (scale !== 1) {
      // 1.5: no bob; the idle pair and the frames in use, one shown at any instant.
      base.set(actor.key, { x, y: actor.y, actor })
      body.push(hiresActor(actor, mine, x))
      continue
    }
    const { use, flashUse } = drawNow()
    const y = actor.y + (actor.fallen ? 0 : bob)
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
    if (opts.motion === 'full' && !actor.fallen) {
      // Discrete, so it matches the pixel surfaces' bob: up for the second half of each second.
      const phase = opts.now % (IDLE_FRAME_MS * 2)
      anim.push(
        `<animateTransform attributeName="transform" type="translate" additive="sum" values="0 0;0 -${bobPx}" calcMode="discrete" begin="${seconds(-phase)}" dur="${seconds(IDLE_FRAME_MS * 2)}" repeatCount="indefinite"/>`,
      )
    }
    const flashes = mine
      .filter((m) => m.kind === 'flash')
      .map(
        (m) =>
          `${flashUse} opacity="0"><animate attributeName="opacity" values="1;0" begin="${begin(m)}" dur="${dur(m)}"/></use>`,
      )
      .join('')
    const op = actor.fallen ? ' opacity="0.5"' : spawning ? ' opacity="0"' : ''
    body.push(`<g transform="translate(${x} ${y})"${op}>${anim.join('')}${use}${flashes}</g>`)
  }

  /** A glow's circle in its rarity fill; `extra` its opacity or its animation. */
  const circle = (g: { x: number; y: number; r: number; rgb: number }, extra: string) =>
    `<circle cx="${g.x}" cy="${g.y}" r="${g.r}" fill="${hex(g.rgb)}"${extra}`

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
      } else if (m.kind === 'chest') {
        const sprite = SPRITES[m.spriteId]
        if (!sprite) continue
        const closed = variant(CHESTS.closed, compact, scale)
        const item = variant(sprite, compact, scale)
        const idle = at.actor.poses.idle.art
        // Where the actor stood: on the ground, whatever its bob.
        const stood = { x: at.x, y: H - idle.height, width: idle.width, height: idle.height }
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
          const href = `#${define(variant(a.sprite, compact, scale), null)}`
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
      } else if (m.kind === 'effect') {
        const to = base.get(m.target)
        const sprite = SPRITES[`effect:${m.effect}`]
        if (!to || !sprite) continue
        const art = variant(sprite, compact, scale)
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

  const flashFilter =
    '<filter id="flash"><feFlood flood-color="#ffffff"/><feComposite operator="in" in2="SourceAlpha"/></filter>'
  // `lighten` on every fill, currentColor included: gamma 0.6 per channel, in sRGB.
  const hitFilter =
    scale === 1
      ? ''
      : '<filter id="hit" color-interpolation-filters="sRGB"><feComponentTransfer><feFuncR type="gamma" exponent="0.6"/><feFuncG type="gamma" exponent="0.6"/><feFuncB type="gamma" exponent="0.6"/></feComponentTransfer></filter>'
  const head = (w: number, h: number, fill = '') =>
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${opts.width}" height="${Math.round((opts.width * h) / w)}" shape-rendering="crispEdges"${fill}><defs>${flashFilter}${hitFilter}${defs.join('')}</defs>`
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
 * The 1.5x Svg when its markup fits the engine's cap, else the 1x Svg (grill Q12): the rendered
 * size is the same either way; only the viewBox differs.
 */
export function svgWithFallback(
  hi: StageModel,
  lo: StageModel,
  motions: readonly Motion[],
  opts: { smil: boolean; now: number; width: number; motion: 'full' | 'still'; fit?: number },
): string {
  return svgOrFallback(renderSvg(hi, motions, opts), () => renderSvg(lo, motions, opts))
}

/** The 1.5x Svg while it is under the cap, else the 1x one, `lo` rendered only then. */
export function svgOrFallback(hi: string, lo: () => string): string {
  return hi.length < SVG_MAX_CHARS ? hi : lo()
}

/**
 * The desktop's full stage as the band's stage Svg, `fit` of its natural height: the 1.5x model,
 * falling back to the 1x one over the cap. `view` is the staged state at `now`.
 */
export function stageSvg(
  view: GameView,
  timeline: StageTimeline,
  now: number,
  box: Box,
  opts: { smil: boolean; width: number; motion: 'full' | 'still'; fit: number },
): string {
  const at = { compact: false, motion: opts.motion }
  const hi = stageAt(view, timeline, now, box, { ...at, scale: HIRES_SCALE })
  const lo = stageAt(view, timeline, now, box, at)
  return svgWithFallback(hi, lo, timeline.active(now), { ...opts, now })
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
  return `<text x="${x}" y="${y + GLYPH_HEIGHT * block}" fill="${hex(rgb)}" stroke="${hex(TEXT_OUTLINE_RGB)}" stroke-width="1" paint-order="stroke" font-family="monospace" font-size="${6 * block}" font-weight="bold"${extra}>${anim}${s}</text>`
}
