// The Svg encoder: a scene as one SVG document for the desktop, VS Code and mobile. Each glyph is
// drawn once as a <symbol> and <use>d per character; with `smil`, tracks animate the next tick:
// bars through their keys, the message window's lines frame by frame (typing as a stepped clip),
// the ▶ cursor over its intervals. Times are ms after the scene's now, which is the document's 0.
import {
  barPixels,
  chars,
  glyphFor,
  type Line,
  placeLine,
  type Scene,
  type Span,
  spanCells,
  type Track,
  type Win,
} from './kit'
import {
  BAR_BACK_RGB,
  BAR_H,
  BAR_Y,
  BORDER_RGB,
  CELL_H,
  CELL_W,
  FIELD_RGB,
  STRIP_SVG_MAX_CHARS,
} from './tuning'

const hex = (rgb: number) => `#${(rgb & 0xffffff).toString(16).padStart(6, '0')}`
const ms = (t: number) => `${Math.max(0, Math.round(t))}ms`

/** Collects each glyph's <symbol> the first time it is used. */
class Glyphs {
  private ids = new Map<string, string>()
  readonly defs: string[] = []

  use(ch: string, x: number, y: number, rgb: number, attrs = '', children = ''): string {
    if (ch === ' ') return ''
    let id = this.ids.get(ch)
    if (!id) {
      id = `g${this.ids.size}`
      this.ids.set(ch, id)
      const rows = glyphFor(ch)
      const runs: string[] = []
      for (let gy = 0; gy < CELL_H; gy++) {
        const bits = rows[gy] ?? 0
        let gx = 0
        while (gx < CELL_W) {
          if (!(bits & (0x80 >> gx))) {
            gx++
            continue
          }
          let end = gx + 1
          while (end < CELL_W && bits & (0x80 >> end)) end++
          runs.push(`M${gx} ${gy}h${end - gx}v1h-${end - gx}z`)
          gx = end
        }
      }
      this.defs.push(`<symbol id="${id}"><path d="${runs.join('')}"/></symbol>`)
    }
    const open = `<use href="#${id}" x="${x}" y="${y}" fill="${hex(rgb)}"${attrs ? ` ${attrs}` : ''}`
    return children ? `${open}>${children}</use>` : `${open}/>`
  }
}

type Anim = {
  bar: (line: number, span: number) => Extract<Track, { kind: 'bar' }> | undefined
  cursor: (line: number, span: number) => Extract<Track, { kind: 'cursor' }> | undefined
}

function barAnim(t: Extract<Track, { kind: 'bar' }>, cells: number, rgb: number): string {
  const keys = t.keys
  const end = keys.at(-1)?.at ?? 0
  if (keys.length < 2 || end <= 0) return ''
  const times = keys.map((k) => Number((k.at / end).toFixed(4))).join(';')
  const widths = keys.map((k) => barPixels(cells, k.fill)).join(';')
  const colours = keys.map((k) => hex(k.fill >= 10000 ? t.fullRgb : rgb)).join(';')
  return (
    `<animate attributeName="width" values="${widths}" keyTimes="${times}" dur="${ms(end)}" fill="freeze"/>` +
    `<animate attributeName="fill" values="${colours}" keyTimes="${times}" calcMode="discrete" dur="${ms(end)}" fill="freeze"/>`
  )
}

function cursorAnim(t: Extract<Track, { kind: 'cursor' }>): string {
  return t.on
    .map(
      (i) =>
        `<set attributeName="visibility" to="visible" begin="${ms(i.from)}" end="${ms(i.until)}"/>`,
    )
    .join('')
}

/** One line's spans at (x0, y0); typing wraps its text in a stepped clip. */
function drawLine(
  g: Glyphs,
  spans: readonly Span[],
  width: number,
  x0: number,
  y0: number,
  opts: { reveal?: number; anim?: Anim; line?: number; clip?: string },
): string {
  const out: string[] = []
  const text: string[] = []
  for (const p of placeLine(spans, width, opts.reveal)) {
    const x = x0 + p.x * CELL_W
    if (p.kind === 'text') {
      for (const [i, ch] of chars(p.text).entries()) text.push(g.use(ch, x + i * CELL_W, y0, p.rgb))
    } else if (p.kind === 'cursor') {
      const t = opts.line !== undefined ? opts.anim?.cursor(opts.line, p.span) : undefined
      out.push(
        t
          ? g.use('▶', x, y0, BORDER_RGB, 'visibility="hidden"', cursorAnim(t))
          : g.use('▶', x, y0, BORDER_RGB),
      )
    } else {
      const full = p.cells * CELL_W
      out.push(
        `<rect x="${x}" y="${y0 + BAR_Y}" width="${full}" height="${BAR_H}" fill="${hex(BAR_BACK_RGB)}"/>`,
      )
      const t = opts.line !== undefined ? opts.anim?.bar(opts.line, p.span) : undefined
      const w = barPixels(p.cells, p.fill)
      out.push(
        t
          ? `<rect x="${x}" y="${y0 + BAR_Y}" width="${w}" height="${BAR_H}" fill="${hex(p.rgb)}">${barAnim(t, p.cells, p.rgb)}</rect>`
          : `<rect x="${x}" y="${y0 + BAR_Y}" width="${w}" height="${BAR_H}" fill="${hex(p.rgb)}"/>`,
      )
    }
  }
  const glyphs = text.join('')
  out.push(opts.clip ? `<g clip-path="url(#${opts.clip})">${glyphs}</g>` : glyphs)
  return out.join('')
}

function frame(win: Win): string {
  const x = win.x * CELL_W
  const w = win.columns * CELL_W
  const h = win.rows * CELL_H
  const f = hex(FIELD_RGB)
  const b = hex(BORDER_RGB)
  // The field with its four corner pixels cut, then the white line (2 px, inset 1, corners cut).
  const field = `<path fill="${f}" d="M${x + 2} 9H${x + w - 2}V10H${x + w - 1}V${h - 10}H${x + w - 2}V${h - 9}H${x + 2}V${h - 10}H${x + 1}V10H${x + 2}Z"/>`
  const line = [
    [3, 10, w - 6, 1],
    [2, 11, w - 4, 1],
    [2, h - 12, w - 4, 1],
    [3, h - 11, w - 6, 1],
    [2, 12, 2, h - 24],
    [w - 4, 12, 2, h - 24],
  ]
    .map(
      ([lx, ly, lw, lh]) => `<rect x="${x + (lx ?? 0)}" y="${ly}" width="${lw}" height="${lh}"/>`,
    )
    .join('')
  return `${field}<g fill="${b}">${line}</g>`
}

function plate(g: Glyphs, win: Win, spans: readonly Span[] | undefined, row: number): string {
  if (!spans || spans.length === 0) return ''
  const cells = spans.reduce((n, s) => n + spanCells(s), 0)
  const last = Math.min(win.columns - 2, 2 + cells)
  if (last < 1) return ''
  const x = (win.x + 1) * CELL_W
  const y = row * CELL_H
  return (
    `<rect x="${x}" y="${y}" width="${last * CELL_W}" height="${CELL_H}" fill="${hex(FIELD_RGB)}"/>` +
    drawLine(g, spans, Math.max(0, win.columns - 4), (win.x + 2) * CELL_W, y, {})
  )
}

function linesOf(
  g: Glyphs,
  win: Win,
  lines: readonly Line[],
  anim?: Anim,
  typing?: { line: number; clip: string },
): string {
  const out: string[] = []
  for (const [r, line] of lines.slice(0, win.rows - 2).entries()) {
    const y0 = (r + 1) * CELL_H
    out.push(
      drawLine(g, line.spans, win.columns - 2, (win.x + 1) * CELL_W, y0, {
        reveal: line.reveal,
        anim,
        line: r,
        clip: typing?.line === r ? typing.clip : undefined,
      }),
    )
    if (line.rule) {
      out.push(
        `<rect x="${win.x * CELL_W + 2}" y="${y0 + CELL_H - 1}" width="${win.columns * CELL_W - 4}" height="1" fill="${hex(BORDER_RGB)}"/>`,
      )
    }
  }
  return out.join('')
}

/** The visibility of a group from `from` to `until` (undefined: to the end). */
function during(from: number, until: number | undefined, hiddenAtStart: boolean): string {
  const show = hiddenAtStart
    ? `<set attributeName="visibility" to="visible" begin="${ms(from)}"/>`
    : ''
  const hide =
    until === undefined ? '' : `<set attributeName="visibility" to="hidden" begin="${ms(until)}"/>`
  return show + hide
}

export function sceneSvg(
  scene: Scene,
  tracks: readonly Track[],
  opts: { smil: boolean; width: number },
): string {
  const W = scene.columns * CELL_W
  const H = scene.rows * CELL_H
  const height = Math.round((opts.width * H) / W)
  const live = opts.smil ? tracks : []
  const head = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${opts.width}" height="${height}" shape-rendering="crispEdges">`

  const build = (frameBudget: number): string => {
    const g = new Glyphs()
    const clips: string[] = []
    const body: string[] = []
    for (const win of scene.windows) {
      const anim: Anim = {
        bar: (line, span) =>
          live.find(
            (t): t is Extract<Track, { kind: 'bar' }> =>
              t.kind === 'bar' && t.window === win.key && t.line === line && t.span === span,
          ),
        cursor: (line, span) =>
          live.find(
            (t): t is Extract<Track, { kind: 'cursor' }> =>
              t.kind === 'cursor' && t.window === win.key && t.line === line && t.span === span,
          ),
      }
      const parts = [
        frame(win),
        plate(g, win, win.title, 0),
        plate(g, win, win.footer, win.rows - 1),
      ]
      const track = live.find(
        (t): t is Extract<Track, { kind: 'lines' }> => t.kind === 'lines' && t.window === win.key,
      )
      const frames = track ? track.frames.slice(0, frameBudget) : []
      if (frames.length === 0) {
        parts.push(linesOf(g, win, win.lines, anim))
      } else {
        parts.push(`<g>${during(0, frames[0]?.at, false)}${linesOf(g, win, win.lines, anim)}</g>`)
        for (const [i, fr] of frames.entries()) {
          let typing: { line: number; clip: string } | undefined
          if (fr.typing) {
            const id = `c${clips.length}`
            const line = fr.lines[fr.typing.line]
            // Every cell of the line, its leading gap included, so the last character shows.
            const n = line ? line.spans.reduce((k, s) => k + spanCells(s), 0) : 0
            const x = (win.x + 1) * CELL_W
            const y = (fr.typing.line + 1) * CELL_H
            const steps = Array.from({ length: n + 1 }, (_, k) => k * CELL_W).join(';')
            clips.push(
              `<clipPath id="${id}"><rect x="${x}" y="${y}" width="0" height="${CELL_H}"><animate attributeName="width" values="${steps}" calcMode="discrete" begin="${ms(fr.at)}" dur="${ms(Math.max(1, n) * fr.typing.charMs)}" fill="freeze"/></rect></clipPath>`,
            )
            typing = { line: fr.typing.line, clip: id }
          }
          parts.push(
            `<g visibility="hidden">${during(fr.at, frames[i + 1]?.at, true)}${linesOf(g, win, fr.lines, anim, typing)}</g>`,
          )
        }
      }
      body.push(`<g id="w-${win.key}">${parts.join('')}</g>`)
    }
    return `${head}<defs>${g.defs.join('')}${clips.join('')}</defs>${body.join('')}</svg>`
  }

  const most = Math.max(0, ...live.map((t) => (t.kind === 'lines' ? t.frames.length : 0)))
  let budget = most
  let svg = build(budget)
  while (svg.length > STRIP_SVG_MAX_CHARS && budget > 0) {
    budget -= 1
    svg = build(budget)
  }
  return svg
}
