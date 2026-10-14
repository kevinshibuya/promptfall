// Builds plugins/promptfall/hooks/sprites/generated.ts from art/manifest.json, the master palettes
// and the PNGs under art/. A pure function of input: `pnpm sprites:check` fails when
// the generated module is stale, regardless of its Git status.
//
// tsx scripts/sprites.ts                       build, exit 1 listing every failure
// tsx scripts/sprites.ts --check               check the module without writing it
// tsx scripts/sprites.ts --derive-snes-master  write art/palettes/snes.json from the snes stems
// tsx scripts/sprites.ts --derive-hires-master write art/palettes/hires.json from the 1.5x art
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { worldBossKey } from '../plugins/promptfall/hooks/sprites/keys'
import { STAGE_MAX_COLUMNS, STAGE_ROWS } from '../plugins/promptfall/hooks/stage/tuning'
import { hex, medianCut, nearest, parseHex, type Rgba, readPng, rgbOf } from './png'

export type Style = 'nes' | 'snes'
export type Kind = 'hero' | 'hero_attack' | 'enemy' | 'world_boss' | 'item' | 'effect' | 'chest'
export type FrameName = 'windup' | 'strike' | 'follow' | 'victory'

export type ManifestEntry = {
  id: string
  /** A PNG stem under art/, 'concept/<name>': marks the sprite a placeholder. */
  alias?: string
  /** A PNG under art/ holding the sprite at true size (PR 2). */
  file?: string
  style: string
  /** The exact source colour whose palette index takes the hero's rarity colour. */
  rarityColor?: string
  /** A PNG under art/ holding the sprite's 1.5x art; without it the 1.5x art is `full` upscaled. */
  fileHires?: string
  /** As `rarityColor`, for `fileHires`. */
  rarityColorHires?: string
  fit?: { height: number }
  /**
   * PNGs under art/ holding the drawn 1.5x frames; a hero's strike defaults to its hero_attack,
   * and its victory pose, a hero's only, to its idle 1.5x art.
   */
  frames?: { windup: string; strike?: string; follow?: string; victory?: string }
  /** A hero's rarity colour per drawn frame, as `rarityColorHires`. */
  frameRarityColors?: { windup: string; follow?: string; victory?: string }
}
/** One zone's stage backdrop: the 1.5x painting at the full stage's size. */
export type BackdropEntry = {
  zone: number
  /** A PNG under art/, exactly BACKDROP_HIRES, opaque, at most BACKDROP_COLOURS colours. */
  fileHires: string
}
export type Manifest = {
  palettes: { nes: string; snes: string; hires?: string }
  sprites: ManifestEntry[]
  backdrops?: BackdropEntry[]
}

/** Palette indices: index 0 is transparent, `palette[0]` is 0 and never drawn. */
export type Indexed = { width: number; height: number; palette: number[]; idx: Uint8Array }
export type Variants = { full: Indexed; hires: Indexed; compact: Indexed; small: Indexed }
export type BuiltFrame = { art: Indexed; raritySlot: number | null }
export type BuiltFrames = {
  windup: BuiltFrame
  strike: BuiltFrame
  follow: BuiltFrame | null
  /** A hero's victory pose: drawn, or its idle 1.5x art by identity; null for any other sprite. */
  victory: BuiltFrame | null
}
export type BuiltSprite = {
  id: string
  kind: Kind
  style: Style
  stem: string
  raritySlot: number | null
  raritySlotHires: number | null
  isPlaceholder: boolean
  /** The drawn 1.5x frames on the idle 1.5x canvas; null without `frames`. */
  frames: BuiltFrames | null
}
export type BuildInput = {
  manifest: Manifest
  /** `hires` is empty when the manifest names no 1.5x master. */
  palettes: { nes: readonly number[]; snes: readonly number[]; hires: readonly number[] }
  /** Reads a PNG by its path under art/; null when it does not exist. */
  load: (path: string) => Rgba | null
  /** Every sprite id the content needs. */
  expected: readonly string[]
  /** The content's zone count: a backdrop past it is an error. Unbounded when absent. */
  zones?: number
}
export type BuiltBackdrop = { zone: number; art: Indexed }
export type BuildResult = {
  errors: string[]
  sprites: BuiltSprite[]
  art: Map<string, Variants>
  /** One per manifest backdrop, in zone order. */
  backdrops: BuiltBackdrop[]
  /**
   * Frames whose native's long side is over 20% off its idle native's, or that the fit to the idle
   * canvas shrinks by more than 20%: a report, not an error.
   */
  drift: string[]
}

export const LIMITS: Record<Style, { colours: number; width: number; height: number }> = {
  nes: { colours: 4, width: 16, height: 16 },
  snes: { colours: 16, width: 48, height: 34 },
}
const COMPACT_HEIGHT = 8
const SMALL = { width: 8, height: 4 }
const KINDS: readonly Kind[] = [
  'hero',
  'hero_attack',
  'enemy',
  'world_boss',
  'item',
  'effect',
  'chest',
]
/**
 * The effect sprites the stage draws: a hero's action's, Camp's campfire and Guard's shield; not
 * content, so listed here.
 */
export const EFFECT_IDS = [
  'effect:fireball',
  'effect:light_burst',
  'effect:arrow',
  'effect:campfire',
  'effect:shield',
] as const
/** The chest a drop leaves, one sprite per state of its reveal; not content, so listed here. */
export const CHEST_IDS = ['chest:closed', 'chest:opening', 'chest:open'] as const
const FRAME_DRIFT = 0.2
const ALPHA_MIN = 128
/** The 1.5x art: its scale over the 1x canvases and its colour limit. */
const HIRES_SCALE = 1.5
const HIRES_COLOURS = 16
const HIRES_MASTER_SIZE = 128
/**
 * A zone backdrop's canvas: the widest, tallest full stage at 1.5x (compose.ts frameSize).
 * The stage bottom-anchors it and centre-crops narrower boxes.
 */
export const BACKDROP_HIRES = {
  width: Math.ceil(STAGE_MAX_COLUMNS * HIRES_SCALE),
  height: Math.ceil(STAGE_ROWS * 2 * HIRES_SCALE),
}
export const BACKDROP_COLOURS = 16

/**
 * An opaque painting indexed by its own colours (no master): null with the count over `limit`, or
 * with the number of transparent pixels, which a backdrop may not have.
 */
export function indexOwn(
  image: Rgba,
  limit: number,
): { art: Indexed } | { count: number } | { transparent: number } {
  const colours = new Set<number>()
  let transparent = 0
  for (let p = 0; p < image.width * image.height; p++) {
    if ((image.data[p * 4 + 3] ?? 0) < ALPHA_MIN) transparent++
    else colours.add(rgbOf(image.data, p * 4))
  }
  if (transparent > 0) return { transparent }
  if (colours.size > limit) return { count: colours.size }
  const palette = [0, ...[...colours].sort((a, b) => a - b)]
  const idx = new Uint8Array(image.width * image.height)
  for (let p = 0; p < idx.length; p++) idx[p] = palette.indexOf(rgbOf(image.data, p * 4), 1)
  return { art: { width: image.width, height: image.height, palette, idx } }
}

/** The manifest's backdrops, each PNG checked for size, opacity and colours. */
export function buildBackdrops(input: BuildInput, errors: string[]): BuiltBackdrop[] {
  const built: BuiltBackdrop[] = []
  const zones = new Set<number>()
  for (const entry of input.manifest.backdrops ?? []) {
    const label = `backdrop zone ${entry.zone}`
    if (!Number.isInteger(entry.zone) || entry.zone < 1) {
      errors.push(`${label}: zone must be a positive integer`)
      continue
    }
    if (input.zones !== undefined && entry.zone > input.zones) {
      errors.push(`${label}: the content has ${input.zones} zones`)
      continue
    }
    if (zones.has(entry.zone)) {
      errors.push(`${label}: duplicate zone`)
      continue
    }
    zones.add(entry.zone)
    const one = (path: string, size: { width: number; height: number }): Indexed | null => {
      const source = input.load(path)
      if (source === null) {
        errors.push(`${label}: missing file art/${path}`)
        return null
      }
      if (source.width !== size.width || source.height !== size.height) {
        errors.push(
          `${label}: art/${path} is ${source.width} x ${source.height}, not ${size.width} x ${size.height}`,
        )
        return null
      }
      const indexed = indexOwn(source, BACKDROP_COLOURS)
      if ('transparent' in indexed) {
        errors.push(`${label}: art/${path} has ${indexed.transparent} transparent pixels`)
        return null
      }
      if ('count' in indexed) {
        errors.push(
          `${label}: art/${path} has ${indexed.count} colours, a backdrop allows ${BACKDROP_COLOURS}`,
        )
        return null
      }
      return indexed.art
    }
    const art = one(entry.fileHires, BACKDROP_HIRES)
    if (art === null) continue
    built.push({ zone: entry.zone, art })
  }
  return built.sort((a, b) => a.zone - b.zone)
}

/**
 * Downsamples to `W × H`: output pixel (i, j) takes the most frequent opaque index of its source
 * block (the lowest on a tie), transparent only when the block has no opaque pixel. A block is at
 * least one source pixel, so an upscale repeats pixels.
 */
export function downsample(art: Indexed, W: number, H: number): Indexed {
  const { width: w, height: h } = art
  const idx = new Uint8Array(W * H)
  const counts = new Array<number>(art.palette.length).fill(0)
  for (let j = 0; j < H; j++) {
    const y0 = Math.floor((j * h) / H)
    const y1 = Math.max(y0 + 1, Math.floor(((j + 1) * h) / H))
    for (let i = 0; i < W; i++) {
      const x0 = Math.floor((i * w) / W)
      const x1 = Math.max(x0 + 1, Math.floor(((i + 1) * w) / W))
      counts.fill(0)
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const v = art.idx[y * w + x] ?? 0
          if (v !== 0) counts[v] = (counts[v] ?? 0) + 1
        }
      }
      let best = 0
      for (let v = 1; v < counts.length; v++) if ((counts[v] ?? 0) > (counts[best] ?? 0)) best = v
      idx[j * W + i] = best
    }
  }
  return { width: W, height: H, palette: art.palette, idx }
}

/** Snaps every opaque pixel to the master palette; null with the count when over the limit. */
export function snap(
  image: Rgba,
  master: readonly number[],
  limit: number,
): { art: Indexed } | { count: number } {
  const snapped = new Int32Array(image.width * image.height).fill(-1)
  const distinct = new Set<number>()
  for (let p = 0; p < snapped.length; p++) {
    if ((image.data[p * 4 + 3] ?? 0) < ALPHA_MIN) continue
    const rgb = nearest(rgbOf(image.data, p * 4), master)
    snapped[p] = rgb
    distinct.add(rgb)
  }
  if (distinct.size > limit) return { count: distinct.size }
  const palette = [0, ...[...distinct].sort((a, b) => a - b)]
  const idx = new Uint8Array(snapped.length)
  snapped.forEach((rgb, p) => {
    if (rgb >= 0) idx[p] = palette.indexOf(rgb, 1)
  })
  return { art: { width: image.width, height: image.height, palette, idx } }
}

/** Pads with transparency to `W × H`, bottom-centred. */
export function pad(art: Indexed, W: number, H: number): Indexed {
  const idx = new Uint8Array(W * H)
  const ox = Math.floor((W - art.width) / 2)
  const oy = H - art.height
  for (let y = 0; y < art.height; y++) {
    for (let x = 0; x < art.width; x++) {
      idx[(oy + y) * W + ox + x] = art.idx[y * art.width + x] ?? 0
    }
  }
  return { width: W, height: H, palette: art.palette, idx }
}

function kindOf(id: string): Kind | null {
  if (id === 'fallback') return 'item'
  const prefix = id.slice(0, id.indexOf(':'))
  return (KINDS as readonly string[]).includes(prefix) ? (prefix as Kind) : null
}

export function buildSprites(input: BuildInput): BuildResult {
  const errors: string[] = []
  const sprites: BuiltSprite[] = []
  const art = new Map<string, Variants>()
  const sources = new Map<string, Rgba>()
  const styles = new Map<string, Style>()
  /** The fileHires each stem's 1.5x art came from. */
  const hiresPaths = new Map<string, string>()
  const seen = new Set<string>()
  const expected = new Set(input.expected)
  const drift: string[] = []
  /** Heroes with frames and no strike: resolved to their hero_attack after the loop. */
  const pendingStrike: {
    sprite: BuiltSprite
    windup: BuiltFrame
    follow: BuiltFrame | null
    victory: BuiltFrame | null
  }[] = []

  for (const entry of input.manifest.sprites) {
    const { id } = entry
    if (seen.has(id)) {
      errors.push(`${id}: duplicate id`)
      continue
    }
    seen.add(id)
    if (!expected.has(id)) errors.push(`${id}: not a content id`)
    const kind = kindOf(id)
    if (kind === null) continue
    if (entry.style !== 'nes' && entry.style !== 'snes') {
      errors.push(`${id}: unknown style ${entry.style}`)
      continue
    }
    const style: Style = entry.style
    if (entry.fileHires !== undefined && input.palettes.hires.length === 0) {
      errors.push(`${id}: fileHires needs palettes.hires`)
      continue
    }
    if ((entry.alias === undefined) === (entry.file === undefined)) {
      errors.push(`${id}: exactly one of alias and file`)
      continue
    }
    const path = entry.alias !== undefined ? `${entry.alias}.png` : (entry.file ?? '')
    const base = entry.alias ?? path.replace(/\.png$/, '')
    const stem = entry.fit ? `${base}@h${entry.fit.height}` : base
    const source = sources.get(path) ?? input.load(path)
    if (source === null) {
      errors.push(`${id}: missing file art/${path}`)
      continue
    }
    sources.set(path, source)
    if (styles.has(stem) && styles.get(stem) !== style) {
      errors.push(`${id}: ${stem} drawn in two styles`)
      continue
    }
    styles.set(stem, style)

    if (!art.has(stem)) {
      const built = buildArt(stem, source, style, input.palettes[style], entry.fit, errors)
      if (built === null) continue
      art.set(stem, built)
    }
    const variants = art.get(stem)
    if (!variants) continue

    let hiresSource: Rgba | null = null
    if (entry.fileHires !== undefined) {
      if (hiresPaths.has(stem) && hiresPaths.get(stem) !== entry.fileHires) {
        errors.push(`${id}: ${stem} has two fileHires`)
        continue
      }
      hiresSource = sources.get(entry.fileHires) ?? input.load(entry.fileHires)
      if (hiresSource === null) {
        errors.push(`${id}: missing file art/${entry.fileHires}`)
        continue
      }
      sources.set(entry.fileHires, hiresSource)
      if (!hiresPaths.has(stem)) {
        const hires = buildHires(id, hiresSource, style, input.palettes.hires, entry.fit, errors)
        if (hires === null) continue
        variants.hires = hires
        hiresPaths.set(stem, entry.fileHires)
      }
    } else if (hiresPaths.has(stem)) {
      errors.push(`${id}: ${stem} has two fileHires`)
      continue
    }

    let raritySlot: number | null = null
    let raritySlotHires: number | null = null
    if (kind === 'hero' || kind === 'hero_attack') {
      raritySlot = raritySlotOf(id, entry, source, variants.full, input.palettes[style], errors)
      if (raritySlot === null) continue
      raritySlotHires =
        hiresSource === null
          ? raritySlot
          : raritySlotHiresOf(id, entry, hiresSource, variants.hires, input.palettes.hires, errors)
      if (raritySlotHires === null) continue
    }
    const sprite: BuiltSprite = {
      id,
      kind,
      style,
      stem,
      raritySlot,
      raritySlotHires,
      isPlaceholder: entry.alias !== undefined,
      frames: null,
    }
    if (entry.frames !== undefined) {
      const hero = kind === 'hero'
      const f = entry.frames
      if (!hero && f.strike === undefined) {
        errors.push(`${id}: frames.strike is required for a non-hero`)
        continue
      }
      if (hero && f.strike !== undefined) {
        errors.push(`${id}: frames.strike: a hero strikes in its hero_attack art`)
        continue
      }
      if (!hero && f.victory !== undefined) {
        errors.push(`${id}: frames.victory: only a hero holds a victory pose`)
        continue
      }
      const ctx = { id, entry, idle: variants.hires, master: input.palettes.hires, hero, input }
      const windup = buildFrame(ctx, 'windup', f.windup, errors, drift)
      const strike =
        f.strike === undefined ? null : buildFrame(ctx, 'strike', f.strike, errors, drift)
      const follow =
        f.follow === undefined ? null : buildFrame(ctx, 'follow', f.follow, errors, drift)
      // Undrawn, a hero's victory pose is its idle 1.5x art (ADR 0007: none at 1x).
      const victory =
        f.victory !== undefined
          ? buildFrame(ctx, 'victory', f.victory, errors, drift)
          : hero
            ? { art: variants.hires, raritySlot: raritySlotHires }
            : null
      if (windup === null || (f.strike !== undefined && strike === null)) continue
      if (f.follow !== undefined && follow === null) continue
      if (f.victory !== undefined && victory === null) continue
      if (strike !== null) sprite.frames = { windup, strike, follow, victory }
      else pendingStrike.push({ sprite, windup, follow, victory })
    }
    sprites.push(sprite)
  }
  for (const { sprite, windup, follow, victory } of pendingStrike) {
    const attackId = sprite.id.replace(/^hero:/, 'hero_attack:')
    const attack = sprites.find((s) => s.id === attackId)
    const hires = attack ? art.get(attack.stem)?.hires : undefined
    if (!attack || !hires) {
      errors.push(`${sprite.id}: frames.strike needs ${attackId}`)
      continue
    }
    sprite.frames = {
      windup,
      strike: { art: hires, raritySlot: attack.raritySlotHires },
      follow,
      victory,
    }
  }
  for (const id of input.expected) {
    if (!seen.has(id)) errors.push(`${id}: no manifest entry`)
  }
  const backdrops = buildBackdrops(input, errors)
  return { errors, sprites, art, backdrops, drift }
}

type FrameContext = {
  id: string
  entry: ManifestEntry
  /** The idle 1.5x art: every frame lands on its canvas. */
  idle: Indexed
  master: readonly number[]
  hero: boolean
  input: BuildInput
}

/** `art/sheets/native/<kind>/<name>.png` for a PNG at `<dir>/<kind>/<name>.png` under art/. */
const nativeOf = (path: string): string => `sheets/native/${path.split('/').slice(1).join('/')}`

/**
 * A drawn frame: snapped to the 1.5x master (16 colours at most), shrunk to fit the idle 1.5x art
 * if larger, then padded bottom-centred to exactly its width and height.
 */
function buildFrame(
  ctx: FrameContext,
  name: FrameName,
  path: string,
  errors: string[],
  drift: string[],
): BuiltFrame | null {
  const { id, entry, idle, master, input } = ctx
  const source = input.load(path)
  if (source === null) {
    errors.push(`${id}: frames.${name}: missing file art/${path}`)
    return null
  }
  const snapped = snap(source, master, HIRES_COLOURS)
  if ('count' in snapped) {
    errors.push(
      `${id}: frames.${name} has ${snapped.count} colours, the 1.5x art allows ${HIRES_COLOURS}`,
    )
    return null
  }
  let art = snapped.art
  const s = Math.min(1, idle.width / art.width, idle.height / art.height)
  if (s < 1) {
    art = downsample(
      art,
      Math.max(1, Math.round(art.width * s)),
      Math.max(1, Math.round(art.height * s)),
    )
  }
  art = pad(art, idle.width, idle.height)
  if (s < 1 - FRAME_DRIFT) {
    drift.push(`${id} frames.${name}: the fit shrinks it to ${Math.round(s * 100)}%`)
  }

  const idleFile = entry.file
  const frameNative = input.load(nativeOf(path))
  const idleNative = idleFile === undefined ? null : input.load(nativeOf(idleFile))
  if (frameNative !== null && idleNative !== null) {
    const a = Math.max(frameNative.width, frameNative.height)
    const b = Math.max(idleNative.width, idleNative.height)
    const off = a / b - 1
    if (Math.abs(off) > FRAME_DRIFT) {
      const pct = `${off > 0 ? '+' : ''}${Math.round(off * 100)}%`
      drift.push(`${id} frames.${name}: native ${a} against idle ${b} (${pct})`)
    }
  }

  let raritySlot: number | null = null
  if (ctx.hero) {
    if (name === 'strike') return { art, raritySlot }
    const colourHex = entry.frameRarityColors?.[name]
    if (colourHex === undefined) {
      errors.push(`${id}: a hero with frames.${name} needs frameRarityColors.${name}`)
      return null
    }
    const colour = parseHex(colourHex)
    let found = false
    for (let i = 0; i < source.data.length && !found; i += 4) {
      found = (source.data[i + 3] ?? 0) >= ALPHA_MIN && rgbOf(source.data, i) === colour
    }
    const slot = art.palette.indexOf(nearest(colour, master), 1)
    if (!found || slot <= 0) {
      errors.push(`${id}: frameRarityColors.${name} ${colourHex} is not in its PNG`)
      return null
    }
    if (!oneRegion(art, slot)) {
      errors.push(`${id}: frameRarityColors.${name} is not one region`)
      return null
    }
    raritySlot = slot
  }
  return { art, raritySlot }
}

function buildArt(
  stem: string,
  source: Rgba,
  style: Style,
  master: readonly number[],
  fit: { height: number } | undefined,
  errors: string[],
): Variants | null {
  const limit = LIMITS[style]
  const snapped = snap(source, master, limit.colours)
  if ('count' in snapped) {
    errors.push(`${stem}: ${snapped.count} colours, ${style} allows ${limit.colours}`)
    return null
  }
  let full = snapped.art
  if (fit) {
    full = downsample(full, Math.round((full.width * fit.height) / full.height), fit.height)
  }
  if (full.width > limit.width || full.height > limit.height) {
    errors.push(
      `${stem}: ${full.width} x ${full.height} exceeds the ${style} canvas of ${limit.width} x ${limit.height}`,
    )
    return null
  }
  if (style === 'nes') full = pad(full, limit.width, limit.height)
  const compact = downsample(
    full,
    Math.max(1, Math.round((full.width * COMPACT_HEIGHT) / full.height)),
    COMPACT_HEIGHT,
  )
  return {
    full,
    hires: downsample(
      full,
      Math.round(full.width * HIRES_SCALE),
      Math.round(full.height * HIRES_SCALE),
    ),
    compact,
    small: downsample(full, SMALL.width, SMALL.height),
  }
}

/** The 1.5x art from its own PNG: snapped, shrunk (never grown) to the 1.5x canvas, nes padded. */
function buildHires(
  id: string,
  source: Rgba,
  style: Style,
  master: readonly number[],
  fit: { height: number } | undefined,
  errors: string[],
): Indexed | null {
  const snapped = snap(source, master, HIRES_COLOURS)
  if ('count' in snapped) {
    errors.push(`${id}: hires ${snapped.count} colours, the 1.5x art allows ${HIRES_COLOURS}`)
    return null
  }
  const limit = LIMITS[style]
  const canvas = {
    width: Math.round(limit.width * HIRES_SCALE),
    height: Math.round(limit.height * HIRES_SCALE),
  }
  const maxHeight = fit ? Math.round(fit.height * HIRES_SCALE) : canvas.height
  let art = snapped.art
  const s = Math.min(1, canvas.width / art.width, maxHeight / art.height)
  if (s < 1) {
    art = downsample(
      art,
      Math.max(1, Math.round(art.width * s)),
      Math.max(1, Math.round(art.height * s)),
    )
  }
  return style === 'nes' ? pad(art, canvas.width, canvas.height) : art
}

/** The 1.5x rarity slot: after the snap, and its pixels one 8-connected region. */
function raritySlotHiresOf(
  id: string,
  entry: ManifestEntry,
  source: Rgba,
  hires: Indexed,
  master: readonly number[],
  errors: string[],
): number | null {
  if (entry.rarityColorHires === undefined) {
    errors.push(`${id}: a hero with fileHires needs a rarityColorHires`)
    return null
  }
  const colour = parseHex(entry.rarityColorHires)
  let found = false
  for (let i = 0; i < source.data.length && !found; i += 4) {
    found = (source.data[i + 3] ?? 0) >= ALPHA_MIN && rgbOf(source.data, i) === colour
  }
  const slot = hires.palette.indexOf(nearest(colour, master), 1)
  if (!found || slot <= 0) {
    errors.push(`${id}: rarityColorHires ${entry.rarityColorHires} is not in its PNG`)
    return null
  }
  if (!oneRegion(hires, slot)) {
    errors.push(`${id}: rarityColorHires is not one region`)
    return null
  }
  return slot
}

/** Whether the pixels at `slot` form one 8-connected region. */
function oneRegion(art: Indexed, slot: number): boolean {
  const { width: w, height: h } = art
  const total = art.idx.reduce((n, v) => n + (v === slot ? 1 : 0), 0)
  const start = art.idx.indexOf(slot)
  if (start < 0) return false
  const seen = new Uint8Array(w * h)
  const stack = [start]
  seen[start] = 1
  let reached = 0
  while (stack.length > 0) {
    const p = stack.pop() ?? 0
    reached++
    const x = p % w
    const y = Math.floor(p / w)
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
        const q = ny * w + nx
        if (seen[q] || art.idx[q] !== slot) continue
        seen[q] = 1
        stack.push(q)
      }
    }
  }
  return reached === total
}

function raritySlotOf(
  id: string,
  entry: ManifestEntry,
  source: Rgba,
  full: Indexed,
  master: readonly number[],
  errors: string[],
): number | null {
  if (entry.rarityColor === undefined) {
    errors.push(`${id}: a hero needs a rarityColor`)
    return null
  }
  const colour = parseHex(entry.rarityColor)
  let found = false
  for (let i = 0; i < source.data.length && !found; i += 4) {
    found = (source.data[i + 3] ?? 0) >= ALPHA_MIN && rgbOf(source.data, i) === colour
  }
  const slot = full.palette.indexOf(nearest(colour, master), 1)
  if (!found || slot <= 0) {
    errors.push(`${id}: rarityColor ${entry.rarityColor} is not in its PNG`)
    return null
  }
  return slot
}

function artLiteral(a: Indexed): string {
  const pixels = Buffer.from(a.idx).toString('base64')
  const palette = a.palette.map((c) => `0x${c.toString(16).padStart(6, '0')}`).join(', ')
  return `{ width: ${a.width}, height: ${a.height}, palette: [${palette}], pixels: '${pixels}' }`
}

/** The generated module: plain data, sorted keys, no imports. */
export function emitModule(result: BuildResult): string {
  const stems = [...result.art.keys()].sort()
  const name = new Map(stems.map((stem, i) => [stem, `a${i}`]))
  const sprites = [...result.sprites].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const items = new Set(sprites.filter((s) => s.kind === 'item').map((s) => s.stem))
  /**
   * A frame that is a stem's 1.5x art (a hero's strike, an undrawn victory pose) is emitted as a
   * reference to it.
   */
  const hiresRef = new Map<Indexed, string>()
  for (const stem of stems) {
    const v = result.art.get(stem)
    if (v) hiresRef.set(v.hires, `${name.get(stem)}.hires`)
  }
  const lines = [
    '// Generated by scripts/sprites.ts from art/manifest.json. Do not edit: run `pnpm sprites`.',
    '',
    'type Art = { width: number; height: number; palette: readonly number[]; pixels: string }',
    'type Variants = { full: Art; hires: Art; compact: Art; small: Art | null }',
    'type Frame = { art: Art; raritySlot: number | null }',
    'type Frames = { windup: Frame; strike: Frame; follow: Frame | null; victory: Frame | null }',
    '',
  ]
  for (const stem of stems) {
    const v = result.art.get(stem)
    if (!v) continue
    const small = items.has(stem) ? artLiteral(v.small) : 'null'
    lines.push(`// ${stem}`)
    lines.push(
      `const ${name.get(stem)}: Variants = {\n  full: ${artLiteral(v.full)},\n  hires: ${artLiteral(v.hires)},\n  compact: ${artLiteral(v.compact)},\n  small: ${small},\n}`,
    )
  }
  /** Each drawn frame once, as a module-level object: the Svg dedupes defs by identity. */
  const frameNames = new Map<Indexed, string>()
  for (const s of sprites) {
    if (!s.frames) continue
    for (const [key, frame] of Object.entries(s.frames) as [FrameName, BuiltFrame | null][]) {
      if (!frame || hiresRef.has(frame.art) || frameNames.has(frame.art)) continue
      const f = `f${frameNames.size}`
      frameNames.set(frame.art, f)
      lines.push(`// ${s.id} ${key}`)
      lines.push(`const ${f}: Art = ${artLiteral(frame.art)}`)
    }
  }
  const frameLiteral = (frame: BuiltFrame | null): string =>
    frame === null
      ? 'null'
      : `{ art: ${hiresRef.get(frame.art) ?? frameNames.get(frame.art)}, raritySlot: ${frame.raritySlot} }`
  const framesLiteral = (f: BuiltFrames | null): string =>
    f === null
      ? 'null'
      : `{ windup: ${frameLiteral(f.windup)}, strike: ${frameLiteral(f.strike)}, follow: ${frameLiteral(f.follow)}, victory: ${frameLiteral(f.victory)} }`
  lines.push('')
  lines.push('export const ART: Readonly<Record<string, Variants>> = {')
  for (const stem of stems) lines.push(`  '${stem}': ${name.get(stem)},`)
  lines.push('}')
  lines.push('')
  lines.push(
    "export const SPRITES: Readonly<Record<string, { id: string; kind: 'hero' | 'hero_attack' | 'enemy' | 'world_boss' | 'item' | 'effect' | 'chest'; style: 'nes' | 'snes'; raritySlot: number | null; raritySlotHires: number | null; isPlaceholder: boolean; frames: Frames | null } & Variants>> = {",
  )
  for (const s of sprites) {
    const v = name.get(s.stem)
    const small = s.kind === 'item' ? `${v}.small` : 'null'
    lines.push(
      `  '${s.id}': { id: '${s.id}', kind: '${s.kind}', style: '${s.style}', raritySlot: ${s.raritySlot}, raritySlotHires: ${s.raritySlotHires}, isPlaceholder: ${s.isPlaceholder}, full: ${v}.full, hires: ${v}.hires, compact: ${v}.compact, small: ${small}, frames: ${framesLiteral(s.frames)} },`,
    )
  }
  lines.push('}')
  lines.push('')
  lines.push(
    '/** The zone backdrops by zone number: each a 1.5x painting at the full stage size. */',
  )
  lines.push('export const BACKDROPS: Readonly<Record<string, Art>> = {')
  for (const b of result.backdrops) {
    lines.push(`  // backdrop zone ${b.zone}`)
    lines.push(`  '${b.zone}': ${artLiteral(b.art)},`)
  }
  lines.push('}')
  lines.push('')
  lines.push(`export const SPRITE_COUNT = ${sprites.length}`)
  lines.push(`export const PLACEHOLDER_COUNT = ${sprites.filter((s) => s.isPlaceholder).length}`)
  lines.push('')
  return lines.join('\n')
}

/** Median cut to `size` over the opaque pixels of every image. */
function deriveMaster(images: readonly Rgba[], size: number): number[] {
  const counts = new Map<number, number>()
  for (const image of images) {
    for (let i = 0; i < image.data.length; i += 4) {
      if ((image.data[i + 3] ?? 0) < ALPHA_MIN) continue
      const rgb = rgbOf(image.data, i)
      counts.set(rgb, (counts.get(rgb) ?? 0) + 1)
    }
  }
  return medianCut(counts, size)
}

/** Median cut to 64 over the opaque pixels of every snes stem. */
export function deriveSnesMaster(images: readonly Rgba[]): number[] {
  return deriveMaster(images, 64)
}

/** Median cut to 128 over the opaque pixels of every 1.5x PNG. */
export function deriveHiresMaster(images: readonly Rgba[]): number[] {
  return deriveMaster(images, HIRES_MASTER_SIZE)
}

/** The distinct `fileHires` paths, in manifest order. */
export function hiresMasterPaths(manifest: Manifest): string[] {
  return [...new Set(manifest.sprites.flatMap((s) => (s.fileHires ? [s.fileHires] : [])))]
}

/** The distinct `file` paths of the snes sprites: the master comes from real art, never a concept alias. */
export function snesMasterPaths(manifest: Manifest): string[] {
  const paths = manifest.sprites.flatMap((s) =>
    s.style === 'snes' && s.file !== undefined ? [s.file] : [],
  )
  return [...new Set(paths)]
}

const ROOT = join(import.meta.dirname, '..')
const ART_DIR = join(ROOT, 'art')
const OUT = join(ROOT, 'plugins/promptfall/hooks/sprites/generated.ts')

/** Every sprite id the build expects: the content's, the effects, the chests and the fallback. */
export async function expectedIds(): Promise<string[]> {
  const { content } = await import('@promptfall/sim')
  const { WORLD_BOSSES } = await import('@promptfall/ledger')
  const classes = [...new Set(Object.values(content.heroTemplates).map((t) => t.cls))]
  return [
    ...classes.flatMap((cls) => [`hero:${cls}`, `hero_attack:${cls}`]),
    ...Object.keys(content.enemies).map((id) => `enemy:${id}`),
    ...WORLD_BOSSES.map((b) => `world_boss:${worldBossKey(b.name)}`),
    ...Object.keys(content.itemBases).map((id) => `item:${id}`),
    ...EFFECT_IDS,
    ...CHEST_IDS,
    'fallback',
  ]
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

function loadArt(path: string): Rgba | null {
  try {
    return readPng(join(ART_DIR, path))
  } catch {
    return null
  }
}

async function main(): Promise<void> {
  const manifest = readJson<Manifest>(join(ART_DIR, 'manifest.json'))
  if (process.argv.includes('--derive-snes-master')) {
    const images = snesMasterPaths(manifest)
      .map(loadArt)
      .filter((i): i is Rgba => i !== null)
    const master = deriveSnesMaster(images)
    writeFileSync(
      join(ART_DIR, manifest.palettes.snes),
      `${JSON.stringify(master.map(hex), null, 2)}\n`,
    )
    console.log(
      `art/${manifest.palettes.snes}: ${master.length} colours from ${images.length} stems`,
    )
    return
  }
  if (process.argv.includes('--derive-hires-master')) {
    const images = hiresMasterPaths(manifest)
      .map(loadArt)
      .filter((i): i is Rgba => i !== null)
    const master = deriveHiresMaster(images)
    const path = manifest.palettes.hires ?? 'palettes/hires.json'
    writeFileSync(join(ART_DIR, path), `${JSON.stringify(master.map(hex), null, 2)}\n`)
    if (manifest.palettes.hires === undefined) {
      // Rewrites only the palettes line, in the shape biome formats it.
      const file = join(ART_DIR, 'manifest.json')
      const palettes = { ...manifest.palettes, hires: path }
      const block = Object.entries(palettes)
        .map(([k, v]) => `    "${k}": "${v}"`)
        .join(',\n')
      const text = readFileSync(file, 'utf8').replace(
        /"palettes": \{[^}]*\}/,
        `"palettes": {\n${block}\n  }`,
      )
      writeFileSync(file, text)
    }
    console.log(`art/${path}: ${master.length} colours from ${images.length} files`)
    return
  }
  const palette = (path: string) => readJson<string[]>(join(ART_DIR, path)).map(parseHex)
  const result = buildSprites({
    manifest,
    palettes: {
      nes: palette(manifest.palettes.nes),
      snes: palette(manifest.palettes.snes),
      hires: manifest.palettes.hires === undefined ? [] : palette(manifest.palettes.hires),
    },
    load: loadArt,
    expected: await expectedIds(),
    zones: (await import('@promptfall/sim')).content.zones.length,
  })
  if (result.errors.length > 0) {
    for (const e of result.errors) console.error(e)
    process.exit(1)
  }
  const source = emitModule(result)
  if (process.argv.includes('--check')) {
    if (!existsSync(OUT) || readFileSync(OUT, 'utf8') !== source) {
      console.error(`${OUT}: stale; run pnpm sprites`)
      process.exitCode = 1
      return
    }
  } else {
    writeFileSync(OUT, source)
  }
  if (result.drift.length > 0) {
    console.log('frame size drift:')
    for (const d of result.drift) console.log(`  ${d}`)
  }
  const placeholders = result.sprites.filter((s) => s.isPlaceholder).length
  console.log(
    `${OUT}: ${result.sprites.length} sprites, ${result.art.size} art stems, ${placeholders} placeholders, ${result.backdrops.length} backdrops`,
  )
}

if (import.meta.url === `file://${process.argv[1]}`) await main()
