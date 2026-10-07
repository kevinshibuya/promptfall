import type { GameView } from '../../types'
import { SPRITES } from '../sprites/generated'
import { decodePixels } from '../sprites/index'
import type { SpriteArt } from '../sprites/types'
import { frameSize } from './compose'
import { GLYPH_HEIGHT, glyphBlock, textWidth } from './font'
import type { Box } from './layout'
import { lungeOffset, type StageActor, type StageModel, stageAt } from './model'
import { bobbingAt, type Motion, type StageTimeline } from './timeline'
import {
  COMPACT_STAGE_ROWS,
  DROP_RISE_PX,
  HIRES_SCALE,
  IDLE_BOB_PX,
  IDLE_FRAME_MS,
  LUNGE_PX,
  NUMBER_RISE_PX,
  SVG_MAX_CHARS,
} from './tuning'

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
 * The stage as one SVG document. Each art stem is drawn once under <defs> and <use>d per actor.
 * With `smil`, motions under way or still to come animate from their offsets against `now`
 * (negative `begin` for one already under way), so a redraw resumes mid-motion; without it,
 * the model as of `now`. Dissolve and spawn are opacity here, not the Bayer pattern.
 */
export function renderSvg(
  model: StageModel,
  motions: readonly Motion[],
  opts: { smil: boolean; now: number; width: number; motion: 'full' | 'still' },
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
  const begin = (m: Motion) => seconds(m.from - opts.now)
  const dur = (m: Motion) => seconds(m.until - m.from)
  const bobPx = px(IDLE_BOB_PX)
  const bob = opts.motion === 'full' ? bobbingAt(opts.now) * bobPx : 0
  const ground = px(2)

  const body: string[] = [
    `<rect x="0" y="${H - ground}" width="${W}" height="${ground}" fill="${hex(model.ground)}"/>`,
  ]
  const base = new Map<string, { x: number; y: number; actor: StageActor }>()

  for (const actor of model.actors) {
    const mine = live.filter((m) => m.actor === actor.key)
    const spawning = mine.some((m) => m.kind === 'spawn')
    if (actor.alpha <= 0 && !(opts.smil && spawning)) {
      // Not drawn, but a drop still rising from it needs its anchor.
      base.set(actor.key, { x: actor.x, y: actor.y, actor })
      continue
    }
    const slot = actor.raritySlot
    const id = define(actor.art, slot)
    // The accent before any flash: the flash is an overlay here, never baked into the base.
    const color = slot === null ? '' : ` color="${hex(actor.accent ?? actor.palette[slot] ?? 0)}"`
    const flip = actor.flipX ? ` transform="translate(${actor.art.width} 0) scale(-1 1)"` : ''
    const use = `<use href="#${id}"${flip}${color}/>`
    const flashUse = `<use href="#${id}"${flip} filter="url(#flash)"`

    if (!opts.smil) {
      const opacity = actor.fallen ? 0.5 : actor.alpha
      const op = opacity < 1 ? ` opacity="${Number(opacity.toFixed(2))}"` : ''
      const flash = actor.flashing ? `${flashUse}/>` : ''
      body.push(`<g transform="translate(${actor.x} ${actor.y})"${op}>${use}${flash}</g>`)
      base.set(actor.key, { x: actor.x, y: actor.y, actor })
      continue
    }

    // Back out the offsets the model baked in at `now`; the animations reapply them.
    const lunge = mine.find((m) => m.kind === 'lunge' && m.from <= opts.now)
    const x = actor.x - lungeOffset(lunge, opts.now, scale)
    const y = actor.y + (actor.fallen ? 0 : bob)
    base.set(actor.key, { x, y, actor })
    const anim: string[] = []
    for (const m of mine) {
      if (m.kind === 'lunge') {
        const dx = m.dir * px(LUNGE_PX)
        anim.push(
          `<animateTransform attributeName="transform" type="translate" additive="sum" values="0 0;${dx} 0;0 0" begin="${begin(m)}" dur="${dur(m)}"/>`,
        )
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

  if (!opts.smil) {
    for (const d of model.drops) {
      const op = d.alpha < 1 ? ` opacity="${Number(d.alpha.toFixed(2))}"` : ''
      body.push(`<use href="#${define(d.art, null)}" transform="translate(${d.x} ${d.y})"${op}/>`)
    }
    for (const n of model.numbers) body.push(text(n.text, n.x, n.y, n.rgb, block, ''))
  } else {
    for (const m of live) {
      const at = base.get(m.actor)
      if (!at) continue
      if (m.kind === 'number') {
        const w = textWidth(m.text, block)
        const x = clamp(Math.round(at.x + (at.actor.art.width - w) / 2), 0, Math.max(0, W - w))
        const glyphH = GLYPH_HEIGHT * block
        const top = clamp(at.y + px(2), 0, H - glyphH)
        const rise = clamp(at.y + px(2) - px(NUMBER_RISE_PX), 0, H - glyphH) - top
        const anim = `<animate attributeName="opacity" values="1;1" begin="${begin(m)}" dur="${dur(m)}"/><animateTransform attributeName="transform" type="translate" values="0 0;0 ${rise}" begin="${begin(m)}" dur="${dur(m)}"/>`
        body.push(text(m.text, x, top, m.rgb, block, anim, ' opacity="0"'))
      } else if (m.kind === 'drop') {
        const sprite = SPRITES[m.item]
        if (!sprite) continue
        const art = compact ? sprite.compact : scale === 1 ? sprite.full : sprite.hires
        const cx = at.x + at.actor.art.width / 2
        const cy = at.y + at.actor.art.height / 2
        const x = clamp(Math.round(cx - art.width / 2), 0, Math.max(0, W - art.width))
        const y = clamp(Math.round(cy - art.height / 2), 0, Math.max(0, H - art.height))
        const rise = clamp(y - px(DROP_RISE_PX), 0, H) - y
        body.push(
          `<use href="#${define(art, null)}" transform="translate(${x} ${y})" opacity="0"><animate attributeName="opacity" values="1;1;0" keyTimes="0;0.667;1" begin="${begin(m)}" dur="${dur(m)}"/><animateTransform attributeName="transform" type="translate" additive="sum" values="0 0;0 ${rise}" begin="${begin(m)}" dur="${dur(m)}"/></use>`,
        )
      }
    }
  }

  const height = Math.round((opts.width * H) / W)
  const flashFilter =
    '<filter id="flash"><feFlood flood-color="#ffffff"/><feComposite operator="in" in2="SourceAlpha"/></filter>'
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${opts.width}" height="${height}" shape-rendering="crispEdges"><defs>${flashFilter}${defs.join('')}</defs>${body.join('')}</svg>`
}

/**
 * The 1.5x Svg when its markup fits the engine's cap, else the 1x Svg (grill Q12): the rendered
 * size is the same either way; only the viewBox differs.
 */
export function svgWithFallback(
  hi: StageModel,
  lo: StageModel,
  motions: readonly Motion[],
  opts: { smil: boolean; now: number; width: number; motion: 'full' | 'still' },
): string {
  const svg = renderSvg(hi, motions, opts)
  return svg.length < SVG_MAX_CHARS ? svg : renderSvg(lo, motions, opts)
}

/** The desktop's full stage: the 1.5x model, falling back to the 1x one over the cap. */
export function stageSvg(
  view: GameView,
  timeline: StageTimeline,
  now: number,
  box: Box,
  opts: { smil: boolean; width: number; motion: 'full' | 'still' },
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
  return `<text x="${x}" y="${y + GLYPH_HEIGHT * block}" fill="${hex(rgb)}" font-family="monospace" font-size="${6 * block}" font-weight="bold"${extra}>${anim}${s}</text>`
}
