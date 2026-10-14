import { PNG } from 'pngjs'
import { describe, expect, it } from 'vitest'
import { GOLDENS } from '../plugins/promptfall/hooks/stage/goldens/index'
import {
  CANDIDATES,
  encodeAs,
  type Grid,
  gridOf,
  hRuns,
  hStrokeD,
  indexedPng,
  joinedRects,
  measure,
  parse,
  render,
  scenarioFrame,
  serialize,
  shapesOf,
  table,
  tightD,
  vRuns,
  vStrokeD,
} from './svg-measure'

/** 3 × 2: a two-wide red bar over a red and a blue pixel, a gap at (1, 1). */
const GRID: Grid = {
  width: 3,
  height: 2,
  fills: ['#ff0000', '#0000ff'],
  px: Uint8Array.of(1, 1, 0, 1, 0, 2),
}

describe('svg-measure', () => {
  it("measures the rest scenario under every candidate, today's count its golden's", () => {
    const rows = measure([scenarioFrame('rest')])
    const today = rows[0]?.cells[0]
    expect(today?.on).toBe(GOLDENS.rest.svgChars)
    expect(rows[0]?.cells).toHaveLength(CANDIDATES.length)
    for (const c of rows[0]?.cells ?? []) expect(c.on).toBeGreaterThan(0)
    const printed = table(rows).split('\n')
    expect(printed).toHaveLength(3)
    expect(printed[2]).toMatch(/^\| rest \| [\d,]+ \/ [\d,]+ \|/)
  })

  it("reads today's markup back unchanged, and every art def's pixels from its paths", () => {
    const svg = render(scenarioFrame('rest'), true)
    const root = parse(svg)
    expect(serialize(root)).toBe(svg)
    const defs = root.kids.find((k) => typeof k === 'object' && k.tag === 'defs')
    const arts =
      typeof defs === 'object'
        ? defs.kids.flatMap((d) => (typeof d === 'object' && gridOf(d) ? [d] : []))
        : []
    expect(arts.length).toBeGreaterThan(1)
    // Today's is the strokes encoding: read back and written again, only its ids' letters move.
    const strokes = CANDIDATES.find((c) => c.name === 'strokes')
    if (!strokes) throw new Error('no strokes candidate')
    expect(encodeAs(svg, strokes).length).toBe(svg.length)
  })

  it('reads a stroked or filled path back as the pixels it paints', () => {
    expect(shapesOf('M0 .5h2m-2 1h1', true)).toEqual([
      { x: 0, y: 0, w: 2, h: 1 },
      { x: 0, y: 1, w: 1, h: 1 },
    ])
    expect(shapesOf('M.5 0v2m1-2v1', true)).toEqual([
      { x: 0, y: 0, w: 1, h: 2 },
      { x: 1, y: 0, w: 1, h: 1 },
    ])
    expect(shapesOf('M0 0h2v1h-2m0 0h1v1h-1', false)).toEqual([
      { x: 0, y: 0, w: 2, h: 1 },
      { x: 0, y: 1, w: 1, h: 1 },
    ])
    expect(shapesOf('M2 1h1v1h-1z', false)).toEqual([{ x: 2, y: 1, w: 1, h: 1 }])
  })

  it("writes every candidate's markup as one svg document", () => {
    const svg = render(scenarioFrame('rest'), false)
    for (const c of CANDIDATES) {
      const out = encodeAs(svg, c)
      expect(parse(out).tag, c.name).toBe('svg')
      expect(serialize(parse(out)), c.name).toBe(out)
    }
  })

  it('writes runs, rectangles and strokes in the tight grammar', () => {
    expect(hRuns(GRID, 1)).toEqual([
      { x: 0, y: 0, w: 2, h: 1 },
      { x: 0, y: 1, w: 1, h: 1 },
    ])
    expect(vRuns(GRID, 1)).toEqual([
      { x: 0, y: 0, w: 1, h: 2 },
      { x: 1, y: 0, w: 1, h: 1 },
    ])
    expect(joinedRects({ ...GRID, px: Uint8Array.of(1, 1, 0, 1, 1, 2) }, 1)).toEqual([
      { x: 0, y: 0, w: 2, h: 2 },
    ])
    expect(tightD(hRuns(GRID, 1))).toBe('M0 0h2v1h-2m0 0h1v1h-1')
    expect(tightD(hRuns(GRID, 2))).toBe('M2 1h1v1h-1')
    expect(hStrokeD(hRuns(GRID, 1))).toBe('M0 .5h2m-2 1h1')
    expect(vStrokeD(vRuns(GRID, 1))).toBe('M.5 0v2m1-2v1')
  })

  it('encodes a grid as an indexed PNG whose pixels are the grid', () => {
    const png = PNG.sync.read(Buffer.from(indexedPng(GRID)))
    expect([png.width, png.height]).toEqual([3, 2])
    const rgba = [...png.data]
    expect(rgba).toEqual([
      ...[255, 0, 0, 255, 255, 0, 0, 255, 0, 0, 0, 0],
      ...[255, 0, 0, 255, 0, 0, 0, 0, 0, 0, 255, 255],
    ])
  })
})
