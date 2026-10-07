// Builds plugins/promptfall/hooks/sprites/generated.ts from art/manifest.json, the master palettes
// and the PNGs under art/. A pure function of committed input: `pnpm sprites:check` fails CI when
// the committed module is stale.
//
// tsx scripts/sprites.ts                       build, exit 1 listing every failure
// tsx scripts/sprites.ts --derive-snes-master  write art/palettes/snes.json from the snes stems
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { worldBossKey } from '../plugins/promptfall/hooks/sprites/keys'
import { hex, medianCut, nearest, parseHex, type Rgba, readPng, rgbOf } from './png'

export type Style = 'nes' | 'snes'
export type Kind = 'hero' | 'hero_attack' | 'enemy' | 'world_boss' | 'item'

export type ManifestEntry = {
  id: string
  /** A PNG stem under art/, 'concept/<name>': marks the sprite a placeholder. */
  alias?: string
  /** A PNG under art/ holding the sprite at true size (PR 2). */
  file?: string
  style: string
  /** The exact source colour whose palette index takes the hero's rarity colour. */
  rarityColor?: string
  fit?: { height: number }
}
export type Manifest = { palettes: { nes: string; snes: string }; sprites: ManifestEntry[] }

/** Palette indices: index 0 is transparent, `palette[0]` is 0 and never drawn. */
export type Indexed = { width: number; height: number; palette: number[]; idx: Uint8Array }
export type Variants = { full: Indexed; compact: Indexed; small: Indexed }
export type BuiltSprite = {
  id: string
  kind: Kind
  style: Style
  stem: string
  raritySlot: number | null
  isPlaceholder: boolean
}
export type BuildInput = {
  manifest: Manifest
  palettes: { nes: readonly number[]; snes: readonly number[] }
  /** Reads a PNG by its path under art/; null when it does not exist. */
  load: (path: string) => Rgba | null
  /** Every sprite id the content needs. */
  expected: readonly string[]
}
export type BuildResult = {
  errors: string[]
  sprites: BuiltSprite[]
  art: Map<string, Variants>
}

export const LIMITS: Record<Style, { colours: number; width: number; height: number }> = {
  nes: { colours: 4, width: 16, height: 16 },
  snes: { colours: 16, width: 48, height: 34 },
}
const COMPACT_HEIGHT = 8
const SMALL = { width: 8, height: 4 }
const KINDS: readonly Kind[] = ['hero', 'hero_attack', 'enemy', 'world_boss', 'item']
const ALPHA_MIN = 128

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
  const seen = new Set<string>()
  const expected = new Set(input.expected)

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

    let raritySlot: number | null = null
    if (kind === 'hero' || kind === 'hero_attack') {
      raritySlot = raritySlotOf(id, entry, source, variants.full, input.palettes[style], errors)
      if (raritySlot === null) continue
    }
    sprites.push({ id, kind, style, stem, raritySlot, isPlaceholder: entry.alias !== undefined })
  }
  for (const id of input.expected) {
    if (!seen.has(id)) errors.push(`${id}: no manifest entry`)
  }
  return { errors, sprites, art }
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
  return { full, compact, small: downsample(full, SMALL.width, SMALL.height) }
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
  const lines = [
    '// Generated by scripts/sprites.ts from art/manifest.json. Do not edit: run `pnpm sprites`.',
    '',
    'type Art = { width: number; height: number; palette: readonly number[]; pixels: string }',
    'type Variants = { full: Art; compact: Art; small: Art | null }',
    '',
  ]
  for (const stem of stems) {
    const v = result.art.get(stem)
    if (!v) continue
    const small = items.has(stem) ? artLiteral(v.small) : 'null'
    lines.push(`// ${stem}`)
    lines.push(
      `const ${name.get(stem)}: Variants = {\n  full: ${artLiteral(v.full)},\n  compact: ${artLiteral(v.compact)},\n  small: ${small},\n}`,
    )
  }
  lines.push('')
  lines.push('export const ART: Readonly<Record<string, Variants>> = {')
  for (const stem of stems) lines.push(`  '${stem}': ${name.get(stem)},`)
  lines.push('}')
  lines.push('')
  lines.push(
    "export const SPRITES: Readonly<Record<string, { id: string; kind: 'hero' | 'hero_attack' | 'enemy' | 'world_boss' | 'item'; style: 'nes' | 'snes'; raritySlot: number | null; isPlaceholder: boolean } & Variants>> = {",
  )
  for (const s of sprites) {
    const v = name.get(s.stem)
    const small = s.kind === 'item' ? `${v}.small` : 'null'
    lines.push(
      `  '${s.id}': { id: '${s.id}', kind: '${s.kind}', style: '${s.style}', raritySlot: ${s.raritySlot}, isPlaceholder: ${s.isPlaceholder}, full: ${v}.full, compact: ${v}.compact, small: ${small} },`,
    )
  }
  lines.push('}')
  lines.push('')
  lines.push(`export const SPRITE_COUNT = ${sprites.length}`)
  lines.push(`export const PLACEHOLDER_COUNT = ${sprites.filter((s) => s.isPlaceholder).length}`)
  lines.push('')
  return lines.join('\n')
}

/** Median cut to 64 over the opaque pixels of every snes stem. */
export function deriveSnesMaster(images: readonly Rgba[]): number[] {
  const counts = new Map<number, number>()
  for (const image of images) {
    for (let i = 0; i < image.data.length; i += 4) {
      if ((image.data[i + 3] ?? 0) < ALPHA_MIN) continue
      const rgb = rgbOf(image.data, i)
      counts.set(rgb, (counts.get(rgb) ?? 0) + 1)
    }
  }
  return medianCut(counts, 64)
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

async function expectedIds(): Promise<string[]> {
  const { content } = await import('@promptfall/sim')
  const { WORLD_BOSSES } = await import('@promptfall/ledger')
  const classes = [...new Set(Object.values(content.heroTemplates).map((t) => t.cls))]
  return [
    ...classes.flatMap((cls) => [`hero:${cls}`, `hero_attack:${cls}`]),
    ...Object.keys(content.enemies).map((id) => `enemy:${id}`),
    ...WORLD_BOSSES.map((b) => `world_boss:${worldBossKey(b.name)}`),
    ...Object.keys(content.itemBases).map((id) => `item:${id}`),
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
  const palette = (path: string) => readJson<string[]>(join(ART_DIR, path)).map(parseHex)
  const result = buildSprites({
    manifest,
    palettes: { nes: palette(manifest.palettes.nes), snes: palette(manifest.palettes.snes) },
    load: loadArt,
    expected: await expectedIds(),
  })
  if (result.errors.length > 0) {
    for (const e of result.errors) console.error(e)
    process.exit(1)
  }
  writeFileSync(OUT, emitModule(result))
  const placeholders = result.sprites.filter((s) => s.isPlaceholder).length
  console.log(
    `${OUT}: ${result.sprites.length} sprites, ${result.art.size} art stems, ${placeholders} placeholders`,
  )
}

if (import.meta.url === `file://${process.argv[1]}`) await main()
