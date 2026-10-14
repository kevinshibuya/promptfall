// The desktop stage picture's path grammar (ticket #210's "strokes", chosen in #212): each colour
// of an art as the shortest of its rectangles filled, its horizontal runs or its vertical runs,
// the runs stroked one pixel wide down their middles; relative commands, a separator only where a
// `-` does not separate, no closing `z` (a fill closes it, a stroke has no area to close).

/** An art's pixels, each a palette index (0 transparent), row by row. */
export type Grid = { width: number; height: number; px: Uint8Array }
export type Rect = { x: number; y: number; w: number; h: number }

/** Index `v`'s horizontal runs, row by row. */
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

/** Index `v`'s vertical runs, column by column. */
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

/** Index `v` as rectangles: a horizontal run joins the run under it when both span the same columns. */
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

const num = (n: number) => {
  const s = String(n)
  return s.startsWith('0.') ? s.slice(1) : s.startsWith('-0.') ? `-${s.slice(2)}` : s
}
/** A command and its numbers, a space only where the next number does not start with `-`. */
const cmd = (c: string, ...ns: number[]) =>
  c + ns.map((n, i) => (i > 0 && n >= 0 ? ' ' : '') + num(n)).join('')

/** Rectangles, filled: `m dx dy h w v h h -w` from where the last one ended. */
export function rectD(rs: readonly Rect[]): string {
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

/**
 * Index `v` of `g` as one path in `paint`: the shortest of its rectangles filled, its horizontal
 * runs stroked and its vertical runs stroked, in that order on a tie. Its group carries
 * `fill="none"`, so a stroked path fills nothing.
 */
export function colourPath(g: Grid, v: number, paint: string): string {
  const filled = rectD(joinedRects(g, v))
  const across = hStrokeD(hRuns(g, v))
  const down = vStrokeD(vRuns(g, v))
  const best = Math.min(filled.length, across.length, down.length)
  if (filled.length === best) return `<path fill="${paint}" d="${filled}"/>`
  return `<path stroke="${paint}" d="${across.length === best ? across : down}"/>`
}
