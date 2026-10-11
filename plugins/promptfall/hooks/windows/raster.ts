// The raster encoder: a scene as Raster cells for terminals that draw no pictures (ADR 0005's
// box-drawing text). The byte layout is stage/raster.ts's: per cell a codepoint, then fg, then
// bg, each a little-endian u32; CLEAR is the terminal's own colour.
import { encode } from '../sprites/base64'
import { CLEAR } from '../stage/raster'
import { chars, drawable, placeLine, type Scene, type Span, spanCells, type Win } from './kit'
import { BAR_BACK_RGB, BORDER_RGB, FIELD_RGB } from './tuning'

const BOX = { tl: '╭', tr: '╮', bl: '╰', br: '╯', h: '─', v: '│' }
const BAR = '▬'

type Cell = { ch: string; fg: number; bg: number }

function lay(
  grid: Cell[][],
  spans: readonly Span[],
  x0: number,
  y: number,
  width: number,
  reveal?: number,
): void {
  const row = grid[y]
  if (!row) return
  for (const p of placeLine(spans, width, reveal)) {
    const x = x0 + p.x
    if (p.kind === 'text') {
      for (const [i, ch] of chars(p.text).entries()) {
        const cell = row[x + i]
        if (cell) Object.assign(cell, { ch: drawable(ch), fg: p.rgb })
      }
    } else if (p.kind === 'cursor') {
      const cell = row[x]
      if (cell) Object.assign(cell, { ch: '▶', fg: BORDER_RGB })
    } else if (p.kind === 'bar') {
      const filled = Math.round((p.cells * p.fill) / 10000)
      for (let i = 0; i < p.cells; i++) {
        const cell = row[x + i]
        if (cell) Object.assign(cell, { ch: BAR, fg: i < filled ? p.rgb : BAR_BACK_RGB })
      }
    }
  }
}

/** A title or footer cut into the border line: a blank cell, the text from cell 2, a blank cell. */
function cut(grid: Cell[][], win: Win, spans: readonly Span[] | undefined, y: number): void {
  if (!spans || spans.length === 0) return
  const row = grid[y]
  if (!row) return
  const cells = spans.reduce((n, s) => n + spanCells(s), 0)
  const last = Math.min(win.columns - 2, 2 + cells)
  for (let x = 1; x <= last; x++) {
    const cell = row[win.x + x]
    if (cell) cell.ch = ' '
  }
  lay(grid, spans, win.x + 2, y, Math.max(0, win.columns - 4))
}

/** The whole scene as Raster cells, `columns × rows`, base64. */
export function sceneCells(scene: Scene): string {
  // Uint32Array is host-endian; every host the engine runs on is little-endian, as raster.ts writes.
  return encode(new Uint8Array(sceneWords(scene).buffer))
}

/** sceneCells' cells as words: per cell a codepoint, then fg, then bg. */
export function sceneWords(scene: Scene): Uint32Array {
  const grid: Cell[][] = Array.from({ length: scene.rows }, () =>
    Array.from({ length: scene.columns }, () => ({ ch: ' ', fg: CLEAR, bg: CLEAR })),
  )
  for (const win of scene.windows) {
    const top = win.y ?? 0
    const right = win.columns - 1
    const bottom = win.rows - 1
    for (let y = 0; y <= bottom; y++) {
      for (let x = 0; x <= right; x++) {
        const cell = grid[top + y]?.[win.x + x]
        if (!cell) continue
        const edgeX = x === 0 || x === right
        const edgeY = y === 0 || y === bottom
        let ch = ' '
        if (edgeX && edgeY) ch = y === 0 ? (x === 0 ? BOX.tl : BOX.tr) : x === 0 ? BOX.bl : BOX.br
        else if (edgeY) ch = BOX.h
        else if (edgeX) ch = BOX.v
        Object.assign(cell, { ch, fg: BORDER_RGB, bg: FIELD_RGB })
      }
    }
    cut(grid, win, win.title, top)
    cut(grid, win, win.footer, top + bottom)
    for (const [r, line] of win.lines.slice(0, win.rows - 2).entries()) {
      lay(grid, line.spans, win.x + 1, top + r + 1, win.columns - 2, line.reveal)
    }
  }
  const words = new Uint32Array(scene.columns * scene.rows * 3)
  for (let y = 0; y < scene.rows; y++) {
    for (let x = 0; x < scene.columns; x++) {
      const cell = grid[y]?.[x] as Cell
      const w = (y * scene.columns + x) * 3
      words[w] = cell.ch.codePointAt(0) ?? 0x20
      words[w + 1] = cell.fg
      words[w + 2] = cell.bg
    }
  }
  return words
}
