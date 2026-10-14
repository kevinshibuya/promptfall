// Measures the desktop stage picture's length under candidate encodings (ticket #210): every stage
// golden scenario at its golden instant, ADR 0006's fuller legal frame at rest and lunging with no
// backdrop and over each zone's, and the bandit captain's strike, SMIL on and off. Each candidate
// is a rewrite of today's markup, so the pixels it draws are today's and only the encoding moves.
// `pnpm svg:measure` prints the tables; `--render` also loads every document in the smoke's
// headless Chromium, as an Svg document and as an <img>, and compares its pixels with today's.

import { encode } from '../plugins/promptfall/hooks/sprites/base64'
import { BACKDROPS } from '../plugins/promptfall/hooks/sprites/generated'
import { fullerFrame } from '../plugins/promptfall/hooks/stage/fixtures'
import type { StageModel } from '../plugins/promptfall/hooks/stage/model'
import { crc32 } from '../plugins/promptfall/hooks/stage/png'
import { SCENARIOS, stage } from '../plugins/promptfall/hooks/stage/scenarios'
import { renderSvg } from '../plugins/promptfall/hooks/stage/svg'
import type { Motion } from '../plugins/promptfall/hooks/stage/timeline'
import { SVG_MAX_CHARS } from '../plugins/promptfall/hooks/stage/tuning'
import { zlibSync } from '../plugins/promptfall/hooks/vendor/fflate.js'

// The markup as a tree: renderSvg writes no comments, entities or whitespace between tags.

export type El = { tag: string; attrs: [string, string][]; kids: Node[]; empty: boolean }
export type Node = El | string

export function parse(svg: string): El {
  const root: El = { tag: '#root', attrs: [], kids: [], empty: false }
  const stack = [root]
  for (const m of svg.matchAll(/<(\/?)([A-Za-z][\w:-]*)((?:\s+[\w:-]+="[^"]*")*)(\/?)>|([^<]+)/g)) {
    const top = stack[stack.length - 1] ?? root
    if (m[5] !== undefined) top.kids.push(m[5])
    else if (m[1]) stack.pop()
    else {
      const attrs = [...(m[3] ?? '').matchAll(/([\w:-]+)="([^"]*)"/g)].map(
        (a): [string, string] => [a[1] ?? '', a[2] ?? ''],
      )
      const el: El = { tag: m[2] ?? '', attrs, kids: [], empty: m[4] === '/' }
      top.kids.push(el)
      if (!el.empty) stack.push(el)
    }
  }
  const svgRoot = root.kids[0]
  if (typeof svgRoot !== 'object') throw new Error('no root element')
  return svgRoot
}

export function serialize(n: Node): string {
  if (typeof n === 'string') return n
  const attrs = n.attrs.map(([k, v]) => ` ${k}="${v}"`).join('')
  return n.empty && n.kids.length === 0
    ? `<${n.tag}${attrs}/>`
    : `<${n.tag}${attrs}>${n.kids.map(serialize).join('')}</${n.tag}>`
}

const attr = (el: El, k: string) => el.attrs.find((a) => a[0] === k)?.[1]
const el = (tag: string, attrs: [string, string][], kids: Node[] = []): El => ({
  tag,
  attrs,
  kids,
  empty: kids.length === 0,
})
const isEl = (n: Node): n is El => typeof n === 'object'
const defsOf = (root: El) => root.kids.filter(isEl).find((k) => k.tag === 'defs')

function walk(n: El, f: (e: El) => void): void {
  f(n)
  for (const k of n.kids) if (isEl(k)) walk(k, f)
}

// An art def's pixels, read back from its paths.

export type Rect = { x: number; y: number; w: number; h: number }
export type Grid = { width: number; height: number; fills: string[]; px: Uint8Array }

const RECT = /M(-?[\d.]+) (-?[\d.]+)h(\d+)v(\d+)h-\d+z/g
const rectsOf = (d: string): Rect[] =>
  [...d.matchAll(RECT)].map((m) => ({
    x: Number(m[1]),
    y: Number(m[2]),
    w: Number(m[3]),
    h: Number(m[4]),
  }))
/** True when `d` is nothing but today's rectangles, `M x y h w v h h -w z`. */
const allRects = (d: string) => d.replace(RECT, '') === ''

/** An art def's grid, each pixel its fill's index + 1; null for a def that is not an art. */
export function gridOf(def: El): Grid | null {
  if (def.tag !== 'g' || def.kids.length === 0) return null
  const paths: { fill: string; rects: Rect[] }[] = []
  for (const k of def.kids) {
    const fill = isEl(k) ? attr(k, 'fill') : undefined
    const d = isEl(k) ? attr(k, 'd') : undefined
    if (!isEl(k) || k.tag !== 'path' || fill === undefined || d === undefined || !allRects(d))
      return null
    paths.push({ fill, rects: rectsOf(d) })
  }
  const all = paths.flatMap((p) => p.rects)
  const width = Math.max(...all.map((r) => r.x + r.w))
  const height = Math.max(...all.map((r) => r.y + r.h))
  const px = new Uint8Array(width * height)
  paths.forEach((p, i) => {
    for (const r of p.rects)
      for (let y = r.y; y < r.y + r.h; y++) px.fill(i + 1, y * width + r.x, y * width + r.x + r.w)
  })
  return { width, height, fills: paths.map((p) => p.fill), px }
}

/** Fill `v`'s horizontal runs, row by row. */
export function hRuns(g: Grid, v: number): Rect[] {
  const out: Rect[] = []
  for (let y = 0; y < g.height; y++) {
    for (let x = 0; x < g.width; x++) {
      if (g.px[y * g.width + x] !== v) continue
      let end = x + 1
      while (end < g.width && g.px[y * g.width + end] === v) end++
      out.push({ x, y, w: end - x, h: 1 })
      x = end - 1
    }
  }
  return out
}

/** Fill `v`'s vertical runs, column by column. */
export function vRuns(g: Grid, v: number): Rect[] {
  const out: Rect[] = []
  for (let x = 0; x < g.width; x++) {
    for (let y = 0; y < g.height; y++) {
      if (g.px[y * g.width + x] !== v) continue
      let end = y + 1
      while (end < g.height && g.px[end * g.width + x] === v) end++
      out.push({ x, y, w: 1, h: end - y })
      y = end - 1
    }
  }
  return out
}

/** `rectPaths`' rectangles: a run joins the run under it when both span the same columns. */
export function joinedRects(g: Grid, v: number): Rect[] {
  const out: Rect[] = []
  let above: Rect[] = []
  for (let y = 0; y < g.height; y++) {
    const open: Rect[] = []
    for (const run of hRuns({ ...g, height: 1, px: g.px.subarray(y * g.width) }, v)) {
      let r = above.find((a) => a.x === run.x && a.w === run.w && a.y + a.h === y)
      if (r) r.h++
      else {
        r = { ...run, y }
        out.push(r)
      }
      open.push(r)
    }
    above = open
  }
  return out
}

// Path grammars.

/** Today's: absolute, closed, one separator between every pair of numbers. */
export const absD = (rs: readonly Rect[]) =>
  rs.map((r) => `M${r.x} ${r.y}h${r.w}v${r.h}h-${r.w}z`).join('')

const num = (n: number) => {
  const s = String(n)
  return s.startsWith('0.') ? s.slice(1) : s.startsWith('-0.') ? `-${s.slice(2)}` : s
}
/** A command and its numbers, a space only where the next number does not start with `-`. */
const cmd = (c: string, ...ns: number[]) =>
  c + ns.map((n, i) => (i > 0 && n >= 0 ? ' ' : '') + num(n)).join('')

/** Relative, unclosed (a fill closes it): `m dx dy h w v h h -w`, from where the last one ended. */
export function tightD(rs: readonly Rect[]): string {
  let cx = 0
  let cy = 0
  let out = ''
  rs.forEach((r, i) => {
    out += i === 0 ? cmd('M', r.x, r.y) : cmd('m', r.x - cx, r.y - cy)
    out += cmd('h', r.w) + cmd('v', r.h) + cmd('h', -r.w)
    cx = r.x
    cy = r.y + r.h
  })
  return out
}

/** Horizontal runs as one-pixel strokes along each row's middle: `m dx dy h w`. */
export function hStrokeD(rs: readonly Rect[]): string {
  let cx = 0
  let cy = 0
  let out = ''
  rs.forEach((r, i) => {
    const y = r.y + 0.5
    out += (i === 0 ? cmd('M', r.x, y) : cmd('m', r.x - cx, y - cy)) + cmd('h', r.w)
    cx = r.x + r.w
    cy = y
  })
  return out
}

/** Vertical runs as one-pixel strokes down each column's middle: `m dx dy v h`. */
export function vStrokeD(rs: readonly Rect[]): string {
  let cx = 0
  let cy = 0
  let out = ''
  rs.forEach((r, i) => {
    const x = r.x + 0.5
    out += (i === 0 ? cmd('M', x, r.y) : cmd('m', x - cx, r.y - cy)) + cmd('v', r.h)
    cx = x
    cy = r.y + r.h
  })
  return out
}

// Embedded images.

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length)
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
  out.set(data, 8)
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
  return out
}

/**
 * An indexed PNG of a grid, index 0 transparent: 1, 2, 4 or 8 bits a pixel as its colours need,
 * filter none, deflate at level 9. A `currentColor` fill is left transparent: a path draws it.
 */
export function indexedPng(g: Grid): Uint8Array {
  const rgb = g.fills.map((f) => (f.startsWith('#') ? Number.parseInt(f.slice(1), 16) : null))
  const colours = [...new Set(rgb.filter((c): c is number => c !== null))]
  const index = rgb.map((c) => (c === null ? 0 : colours.indexOf(c) + 1))
  const n = colours.length + 1
  const depth = n <= 2 ? 1 : n <= 4 ? 2 : n <= 16 ? 4 : 8
  const stride = Math.ceil((g.width * depth) / 8)
  const raw = new Uint8Array((stride + 1) * g.height)
  for (let y = 0; y < g.height; y++) {
    for (let x = 0; x < g.width; x++) {
      const v = g.px[y * g.width + x] ?? 0
      const i = v === 0 ? 0 : (index[v - 1] ?? 0)
      const bit = x * depth
      const at = y * (stride + 1) + 1 + (bit >> 3)
      raw[at] = (raw[at] ?? 0) | (i << (8 - depth - (bit & 7)))
    }
  }
  const ihdr = new Uint8Array(13)
  const view = new DataView(ihdr.buffer)
  view.setUint32(0, g.width)
  view.setUint32(4, g.height)
  ihdr.set([depth, 3, 0, 0, 0], 8)
  const plte = new Uint8Array(3 * n)
  for (const [i, c] of colours.entries())
    plte.set([(c >> 16) & 255, (c >> 8) & 255, c & 255], 3 * (i + 1))
  const parts = [
    Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10),
    chunk('IHDR', ihdr),
    chunk('PLTE', plte),
    chunk('tRNS', Uint8Array.of(0)),
    chunk('IDAT', zlibSync(raw, { level: 9 })),
    chunk('IEND', new Uint8Array(0)),
  ]
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

// The candidates, each a rewrite of today's tree in place.

/** Each art def (the sprites' `a<n>` and the backdrop's `bg`) with its grid. */
function artDefs(root: El): { def: El; grid: Grid }[] {
  const defs = defsOf(root)
  if (!defs) return []
  return defs.kids.filter(isEl).flatMap((def) => {
    const grid = gridOf(def)
    return grid ? [{ def, grid }] : []
  })
}

const fillPath = (fill: string, d: string) =>
  el('path', [
    ['fill', fill],
    ['d', d],
  ])

/** Candidate 3: every art's colours as rectangles, as the backdrop already is. */
export function rects(root: El): void {
  for (const { def, grid } of artDefs(root))
    def.kids = grid.fills.map((f, i) => fillPath(f, absD(joinedRects(grid, i + 1))))
}

/** Candidate 4's grammar on every path drawn in rectangles. */
export function relative(root: El): void {
  walk(root, (e) => {
    const d = attr(e, 'd')
    if (e.tag === 'path' && d !== undefined && allRects(d))
      e.attrs = e.attrs.map(([k, v]): [string, string] => [k, k === 'd' ? tightD(rectsOf(v)) : v])
  })
}

const short = (i: number): string => {
  const A = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'
  return i < A.length ? (A[i] ?? '') : short(Math.floor(i / A.length) - 1) + (A[i % A.length] ?? '')
}

/** Candidate 4's ids and colours: one or two letters an id, `#abc` for `#aabbcc`. */
export function shortNames(root: El): void {
  const ids = new Map<string, string>()
  walk(root, (e) => {
    const id = attr(e, 'id')
    if (id !== undefined) ids.set(id, short(ids.size))
  })
  walk(root, (e) => {
    e.attrs = e.attrs.map(([k, v]): [string, string] => {
      if (k === 'id') return [k, ids.get(v) ?? v]
      if (k === 'href' && v.startsWith('#')) return [k, `#${ids.get(v.slice(1)) ?? v.slice(1)}`]
      const w = v.replace(/url\(#([^)]+)\)/g, (_, id: string) => `url(#${ids.get(id) ?? id})`)
      return [k, w.replace(/^#(\w)\1(\w)\2(\w)\3$/, '#$1$2$3')]
    })
  })
}

/** Candidate 4: relative commands, no separator the parser does not need, short ids. */
export function tight(root: El): void {
  relative(root)
  shortNames(root)
}

/**
 * Candidate 4, pushed: each colour of each art as the shortest of its rectangles (filled), its
 * horizontal runs or its vertical runs (stroked one pixel wide down their middles), relative.
 */
export function strokes(root: El): void {
  for (const { def, grid } of artDefs(root)) {
    def.attrs.push(['fill', 'none'])
    def.kids = grid.fills.map((f, i) => {
      const v = i + 1
      const filled = tightD(joinedRects(grid, v))
      const across = hStrokeD(hRuns(grid, v))
      const down = vStrokeD(vRuns(grid, v))
      const best = Math.min(filled.length, across.length, down.length)
      if (filled.length === best) return fillPath(f, filled)
      return el('path', [
        ['stroke', f],
        ['d', across.length === best ? across : down],
      ])
    })
  }
  shortNames(root)
}

/** Candidate 5: each art an indexed PNG as a data URI, its rarity colour a path over it. */
export function png(root: El): void {
  for (const { def, grid } of artDefs(root)) {
    const image = el('image', [
      ['width', String(grid.width)],
      ['height', String(grid.height)],
      ['href', `data:image/png;base64,${encode(indexedPng(grid))}`],
    ])
    const current = grid.fills.indexOf('currentColor')
    def.kids =
      current < 0 ? [image] : [image, fillPath('currentColor', absD(hRuns(grid, current + 1)))]
  }
  root.attrs.push(['image-rendering', 'pixelated'])
}

type Affine = { sx: 1 | -1; tx: number; ty: number }
/** A use's transform: translates and `scale(-1 1)` only, as renderSvg writes them. */
function affineOf(t: string | undefined): Affine {
  let a: Affine = { sx: 1, tx: 0, ty: 0 }
  // `transform="A B"` maps a point through B, then A: compose right to left.
  const steps = [...(t ?? '').matchAll(/(translate|scale)\(([^)]*)\)/g)].reverse()
  for (const [, op, args] of steps) {
    const [p = 0, q = 0] = (args ?? '').split(/[ ,]+/).map(Number)
    a =
      op === 'translate'
        ? { ...a, tx: a.tx + p, ty: a.ty + q }
        : { sx: (a.sx * (p < 0 ? -1 : 1)) as 1 | -1, tx: a.tx * p, ty: a.ty }
  }
  return a
}
const mapRect = (r: Rect, a: Affine): Rect => {
  const x1 = a.sx * r.x + a.tx
  const x2 = a.sx * (r.x + r.w) + a.tx
  return { x: Math.min(x1, x2), y: r.y + a.ty, w: r.w, h: r.h }
}
const clipRows = (rs: readonly Rect[], from: number, to: number): Rect[] =>
  rs.flatMap((r) => {
    const y0 = Math.max(r.y, from)
    const y1 = Math.min(r.y + r.h, to)
    return y1 > y0 ? [{ ...r, y: y0, h: y1 - y0 }] : []
  })

/**
 * Candidate 2: no defs; every use of an art is its paths, placed (and clipped to its row band)
 * where it is used; then the paths of one colour merge across the arts drawn side by side in one
 * group, wherever no animation or attribute keeps them apart.
 */
export function merged(root: El): void {
  const defs = defsOf(root)
  if (!defs) return
  const arts = new Map<string, { fill: string; rects: Rect[] }[]>()
  for (const { def, grid } of artDefs(root)) {
    const id = attr(def, 'id') ?? ''
    arts.set(
      id,
      grid.fills.map((fill, i) => ({ fill, rects: joinedRects(grid, i + 1) })),
    )
  }
  const clips = new Map<string, { from: number; to: number }>()
  for (const c of defs.kids.filter(isEl)) {
    const r = c.kids.find(isEl)
    if (c.tag !== 'clipPath' || !r) continue
    const y = Number(attr(r, 'y'))
    clips.set(attr(c, 'id') ?? '', { from: y, to: y + Number(attr(r, 'height')) })
  }
  const inline = (parent: El): void => {
    const kids: Node[] = []
    for (const k of parent.kids) {
      const href = isEl(k) && k.tag === 'use' ? attr(k, 'href')?.slice(1) : undefined
      const art = href === undefined ? undefined : arts.get(href)
      if (!isEl(k) || !art) {
        if (isEl(k)) inline(k)
        kids.push(k)
        continue
      }
      const clip = clips.get(/url\(#([^)]+)\)/.exec(attr(k, 'clip-path') ?? '')?.[1] ?? '')
      const keep = k.attrs.filter(([n]) => !['href', 'transform', 'clip-path'].includes(n))
      // Animations on the use move it: they keep its transform, on the group that replaces it.
      const baked = k.kids.length === 0
      const a = baked ? affineOf(attr(k, 'transform')) : affineOf(undefined)
      const paths = art.flatMap(({ fill, rects }) => {
        const shown = clip ? clipRows(rects, clip.from, clip.to) : rects
        return shown.length ? [fillPath(fill, absD(shown.map((r) => mapRect(r, a))))] : []
      })
      if (baked && keep.length === 0) kids.push(...paths)
      else {
        const t = attr(k, 'transform')
        const own: [string, string][] =
          baked || t === undefined ? keep : [['transform', t], ...keep]
        kids.push(el('g', own, [...k.kids, ...paths]))
      }
    }
    parent.kids = mergeRuns(kids)
  }
  inline(root)
  defs.kids = defs.kids.filter(
    (d) => !isEl(d) || !(arts.has(attr(d, 'id') ?? '') || d.tag === 'clipPath'),
  )
}

/** Plain sibling paths (a fill and a d only), merged by fill in each unbroken run of them. */
function mergeRuns(kids: Node[]): Node[] {
  const out: Node[] = []
  let run: El[] = []
  const flush = () => {
    const byFill = new Map<string, string>()
    for (const p of run)
      byFill.set(attr(p, 'fill') ?? '', (byFill.get(attr(p, 'fill') ?? '') ?? '') + attr(p, 'd'))
    for (const [fill, d] of byFill) out.push(fillPath(fill, d))
    run = []
  }
  for (const k of kids) {
    if (isEl(k) && k.tag === 'path' && k.attrs.length === 2 && attr(k, 'fill') && attr(k, 'd'))
      run.push(k)
    else {
      flush()
      out.push(k)
    }
  }
  flush()
  return out
}

export type Candidate = { name: string; label: string; apply: (root: El) => void }
export const CANDIDATES: readonly Candidate[] = [
  { name: 'today', label: '1. today', apply: () => {} },
  { name: 'merged', label: '2. merged', apply: merged },
  { name: 'rects', label: '3. rects', apply: rects },
  { name: 'tight', label: '4. tight', apply: tight },
  {
    name: 'tight-rects',
    label: '3+4. tight rects',
    apply: (r) => {
      rects(r)
      tight(r)
    },
  },
  { name: 'strokes', label: '4b. strokes', apply: strokes },
  { name: 'png', label: '5. png', apply: png },
]

export function encodeAs(svg: string, c: Candidate): string {
  if (c.name === 'today') return svg
  const root = parse(svg)
  c.apply(root)
  return serialize(root)
}

// The degradation ladder (spec #209): each rung keeps the ones before it.

export const RUNGS = ['first rung', 'no idle pair', 'no hit filter', 'no backdrop'] as const

/** The hit frame's lean without its lightening: no `filter="url(#hit)"` and no hit filter. */
export function noHitFilter(svg: string): string {
  return svg.replace(/ filter="url\(#hit\)"/g, '').replace(/<filter id="hit"[\s\S]*?<\/filter>/, '')
}

// The fixed frames.

export type Fixed = { name: string; model: StageModel; motions: readonly Motion[]; now: number }

const NOW = 1_000_000

export function scenarioFrame(name: (typeof SCENARIOS)[number]): Fixed {
  const s = stage(name)
  return { name, model: s.hires, motions: s.motions, now: s.now }
}

export function fullerFrames(): Fixed[] {
  const zones = Object.keys(BACKDROPS).sort((a, b) => Number(a) - Number(b))
  return [false, true].flatMap((acting) =>
    [null, ...zones].map((zone) => {
      const f = fullerFrame(1.5, acting, NOW)
      const backdrop = zone === null ? null : (BACKDROPS[zone]?.hires ?? null)
      return {
        name: `fuller ${acting ? 'lunging' : 'at rest'}, ${zone === null ? 'no backdrop' : `zone ${zone}`}`,
        model: { ...f.model, backdrop },
        motions: f.motions,
        now: NOW,
      }
    }),
  )
}

export function corpus(): Fixed[] {
  return [
    ...SCENARIOS.map(scenarioFrame),
    ...fullerFrames(),
    { ...scenarioFrame('boss-strike'), name: 'captain strike (boss-strike)' },
  ]
}

/** Today's markup of `f` on `rung` of the ladder. */
export function render(f: Fixed, smil: boolean, rung = 0): string {
  const still = (m: StageModel): StageModel => ({
    ...m,
    actors: m.actors.map((a) => ({ ...a, bobMs: null })),
  })
  let model = rung >= 1 ? still(f.model) : f.model
  if (rung >= 3) model = { ...model, backdrop: null }
  const svg = renderSvg(model, f.motions, { smil, now: f.now, width: 960, motion: 'full' })
  return rung >= 2 ? noHitFilter(svg) : svg
}

export type Row = { frame: string; cells: { on: number; off: number }[] }

export function measure(frames: readonly Fixed[], cands: readonly Candidate[] = CANDIDATES): Row[] {
  return frames.map((f) => {
    const on = render(f, true)
    const off = render(f, false)
    return {
      frame: f.name,
      cells: cands.map((c) => ({ on: encodeAs(on, c).length, off: encodeAs(off, c).length })),
    }
  })
}

const n = (v: number) => v.toLocaleString('en-US')

export function table(rows: readonly Row[], cands: readonly Candidate[] = CANDIDATES): string {
  const head = `| frame | ${cands.map((c) => c.label).join(' | ')} |`
  const rule = `|---|${cands.map(() => '--:').join('|')}|`
  const lines = rows.map(
    (r) => `| ${r.frame} | ${r.cells.map((c) => `${n(c.on)} / ${n(c.off)}`).join(' | ')} |`,
  )
  return [head, rule, ...lines].join('\n')
}

/** Per candidate: the largest scenario, against three quarters of the cap. */
export function headroom(rows: readonly Row[], cands: readonly Candidate[] = CANDIDATES): string {
  const scenarios = rows.filter((r) => (SCENARIOS as readonly string[]).includes(r.frame))
  const bar = (SVG_MAX_CHARS * 3) / 4
  return [
    `| candidate | largest scenario, SMIL on | largest, SMIL off | all under ${n(bar)} |`,
    '|---|--:|--:|:-:|',
    ...cands.map((c, i) => {
      const on = Math.max(...scenarios.map((r) => r.cells[i]?.on ?? 0))
      const off = Math.max(...scenarios.map((r) => r.cells[i]?.off ?? 0))
      return `| ${c.label} | ${n(on)} | ${n(off)} | ${on < bar && off < bar ? 'yes' : 'no'} |`
    }),
  ].join('\n')
}

/**
 * Per candidate: the fuller frame at rest and lunging over its worst zone, on each rung, SMIL on;
 * the rung it lands on is the first under the cap.
 */
export function ladder(cands: readonly Candidate[] = CANDIDATES): string {
  const frames = fullerFrames().filter((f) => !f.name.endsWith('no backdrop'))
  const lines = [
    `| candidate | frame | ${RUNGS.join(' | ')} | lands on |`,
    `|---|---|${RUNGS.map(() => '--:').join('|')}|---|`,
  ]
  for (const c of cands) {
    for (const acting of ['at rest', 'lunging']) {
      const mine = frames.filter((f) => f.name.includes(acting))
      const worst = mine
        .map((f) => ({ f, len: encodeAs(render(f, true), c).length }))
        .reduce((a, b) => (b.len > a.len ? b : a))
      const counts = RUNGS.map((_, rung) => encodeAs(render(worst.f, true, rung), c).length)
      const first = counts.findIndex((v) => v < SVG_MAX_CHARS)
      lines.push(
        `| ${c.label} | ${worst.f.name.replace('fuller ', '')} | ${counts.map(n).join(' | ')} | ${first < 0 ? `none (${n(counts.at(-1) ?? 0)})` : RUNGS[first]} |`,
      )
    }
  }
  return lines.join('\n')
}

// Chromium: each candidate's documents loaded as the smoke loads them, and as an <img>.

type Seen = { error: string | null; shot: Buffer | null }
/** The largest channel difference that is compositing rounding, not a different picture. */
const FAINT = 2

async function renderAll(): Promise<string> {
  const { chromium } = await import('playwright')
  const { PNG } = await import('pngjs')
  const browser = await chromium.launch()
  const page = await browser.newPage()
  const errors: string[] = []
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console error: ${m.text()}`)
  })
  page.on('pageerror', (e) => errors.push(`page error: ${e.message}`))
  const URL = 'http://smoke.test/stage.svg'
  let body = ''
  await page.route(URL, (r) =>
    r.fulfill({ contentType: body.startsWith('<svg') ? 'image/svg+xml' : 'text/html', body }),
  )
  /** `svg` as a document (`img` false) paused at `t` seconds, or as an <img> in a page. */
  const look = async (svg: string, img: boolean, t: number): Promise<Seen> => {
    errors.length = 0
    const w = Number(/ width="(\d+)"/.exec(svg)?.[1] ?? 960)
    const h = Number(/ height="(\d+)"/.exec(svg)?.[1] ?? 240)
    await page.setViewportSize({ width: w, height: h })
    body = img
      ? `<!doctype html><body style="margin:0;background:#fff"><img id="i" src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}"></body>`
      : svg
    await page.goto(URL, { waitUntil: 'load' })
    const state = await page.evaluate(
      async ({ img, t }) => {
        if (img) {
          const i = document.getElementById('i') as HTMLImageElement
          await i.decode().catch(() => {})
          return i.naturalWidth > 0 ? null : 'the <img> does not decode'
        }
        if (document.getElementsByTagName('parsererror').length > 0)
          return 'the document does not parse'
        const root = document.documentElement as unknown as SVGSVGElement
        if (root.localName !== 'svg') return 'the root is not an svg element'
        root.pauseAnimations()
        root.setCurrentTime(t)
        return null
      },
      { img, t },
    )
    await page.waitForTimeout(30)
    const error = state ?? errors[0] ?? null
    return { error, shot: error ? null : await page.screenshot() }
  }
  /** The pixels that differ by more than FAINT on some channel, and those that differ by less. */
  const differing = (a: Buffer, b: Buffer): { px: number; faint: number } => {
    if (a.equals(b)) return { px: 0, faint: 0 }
    const p = PNG.sync.read(a)
    const q = PNG.sync.read(b)
    if (p.width !== q.width || p.height !== q.height) return { px: p.width * p.height, faint: 0 }
    let px = 0
    let faint = 0
    for (let i = 0; i < p.data.length; i += 4) {
      const d = Math.max(
        ...[0, 1, 2].map((k) => Math.abs((p.data[i + k] ?? 0) - (q.data[i + k] ?? 0))),
      )
      if (d > FAINT) px++
      else if (d > 0) faint++
    }
    return { px, faint }
  }
  // The SMIL documents are compared paused at their start and 120 ms in; an <img> runs its own
  // clock, so it is compared with SMIL off only.
  const looks = [
    { smil: true, img: false, t: 0 },
    { smil: true, img: false, t: 0.12 },
    { smil: false, img: false, t: 0 },
    { smil: false, img: true, t: 0 },
  ]
  type Tally = {
    docs: number
    errors: string[]
    faint: number
    diffs: { at: string; px: number }[]
  }
  const tally: Tally[] = CANDIDATES.map(() => ({ docs: 0, errors: [], faint: 0, diffs: [] }))
  try {
    for (const f of corpus()) {
      for (const l of looks) {
        const today = render(f, l.smil)
        const base = await look(today, l.img, l.t)
        for (const [i, c] of CANDIDATES.entries()) {
          const t = tally[i]
          if (!t) continue
          const seen = i === 0 ? base : await look(encodeAs(today, c), l.img, l.t)
          t.docs++
          const where = `${f.name}, SMIL ${l.smil ? 'on' : 'off'}${l.img ? ', <img>' : ` at ${l.t}s`}`
          if (seen.error) t.errors.push(`${where}: ${seen.error}`)
          else if (base.shot && seen.shot) {
            // A difference of 2/255 or less on every channel is compositing rounding, unseen.
            const d = differing(base.shot, seen.shot)
            if (d.px > 0) t.diffs.push({ at: where, px: d.px })
            else if (d.faint > 0) t.faint++
          }
        }
      }
    }
  } finally {
    await browser.close()
  }
  return [
    `| candidate | looks | errors | identical to today | within ${FAINT}/255 | visibly different | rendered clean |`,
    '|---|--:|--:|--:|--:|--:|:-:|',
    ...CANDIDATES.map((c, i) => {
      const t = tally[i] ?? { docs: 0, errors: [], faint: 0, diffs: [] }
      const same = t.docs - t.errors.length - t.faint - t.diffs.length
      return `| ${c.label} | ${t.docs} | ${t.errors.length} | ${same} | ${t.faint} | ${t.diffs.length} | ${t.errors.length + t.diffs.length === 0 ? 'yes' : 'no'} |`
    }),
    '',
    ...CANDIDATES.flatMap((c, i) => {
      const t = tally[i]
      if (!t) return []
      const worst = [...t.diffs].sort((a, b) => b.px - a.px).map((d) => `${d.at}: ${d.px} px`)
      return [...t.errors, ...worst].slice(0, 6).map((s) => `- ${c.label}: ${s}`)
    }),
  ].join('\n')
}

async function main(): Promise<void> {
  const rows = measure(corpus())
  console.log('Characters, SMIL on / SMIL off; the cap is', n(SVG_MAX_CHARS), '\n')
  console.log(table(rows), '\n')
  console.log(headroom(rows), '\n')
  console.log(ladder(), '\n')
  if (process.argv.includes('--render')) console.log(await renderAll())
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) await main()
