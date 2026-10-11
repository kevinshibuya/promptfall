import { expect, test } from 'claude-code/testing'
import { decode } from '../sprites/base64'
import { stripScene } from '../ui/strip'
import { windowFrame } from '../windows/image'
import type { Scene } from '../windows/kit'
import { sceneCells } from '../windows/raster'
import { BORDER_RGB, FIELD_RGB } from '../windows/tuning'
import type { Frame } from './compose'
import { composeBand, composeBandCells, playfieldOf } from './playfield'
import { CLEAR } from './raster'
import { band, bandPicture, strip } from './scenarios'

const WHITE = BORDER_RGB
const SHELL = FIELD_RGB

/** A 1.5x stage frame whose art pixel (x, y) is colour 0x01xxyy... : each one tells where it came from. */
function marked(width: number, height: number): Frame {
  const rgba = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      rgba[i] = 0x80 | (x >> 8)
      rgba[i + 1] = x & 0xff
      rgba[i + 2] = y
      rgba[i + 3] = 255
    }
  return { width, height, rgba }
}

const art = (x: number, y: number): number => ((0x80 | (x >> 8)) << 16) | ((x & 0xff) << 8) | y

function at(f: Frame, x: number, y: number): number {
  const i = (y * f.width + x) * 4
  return ((f.rgba[i] ?? 0) << 16) | ((f.rgba[i + 1] ?? 0) << 8) | (f.rgba[i + 2] ?? 0)
}

function alpha(f: Frame, x: number, y: number): number {
  return f.rgba[(y * f.width + x) * 4 + 3] ?? 0
}

function stripOf(columns: number): Scene {
  return stripScene({ ...strip('strip-rest'), columns }).scene
}

const frames = new WeakMap<Scene['windows'][number], Frame>()

/** The strip's windows, each on the shell: what the strip's rows must show pixel for pixel. */
function stripPixel(scene: Scene, x: number, y: number): number {
  const win = scene.windows.find((w) => x >= w.x * 8 && x < (w.x + w.columns) * 8)
  if (!win) return SHELL
  const f = frames.get(win) ?? windowFrame(win)
  frames.set(win, f)
  const wx = x - win.x * 8
  return alpha(f, wx, y) === 0 ? SHELL : at(f, wx, y)
}

test('at 160 columns the band is the box on the 8 by 16 grid, the line over the outermost stage pixels', () => {
  const band = composeBand({ columns: 160, rows: 22 }, marked(240, 51), stripOf(160))
  expect([band.width, band.height]).toEqual([1280, 352])
  // Left and right: shell, shell, then the line's two white pixels, then the stage.
  for (const y of [100, 200, 271]) {
    expect([at(band, 0, y), at(band, 1, y), at(band, 2, y), at(band, 3, y)]).toEqual([
      SHELL,
      SHELL,
      WHITE,
      WHITE,
    ])
    expect([at(band, 1279, y), at(band, 1278, y), at(band, 1277, y), at(band, 1276, y)]).toEqual([
      SHELL,
      SHELL,
      WHITE,
      WHITE,
    ])
  }
  // Top: the same two rows of shell and two of line over the sky's first art row.
  for (const x of [100, 640, 1200]) {
    expect([0, 1, 2, 3].map((y) => at(band, x, y))).toEqual([SHELL, SHELL, WHITE, WHITE])
  }
  // The cut corner: the line's outermost corner pixel is shell.
  expect(at(band, 2, 2)).toBe(SHELL)
  expect(at(band, 3, 2)).toBe(WHITE)
  expect(at(band, 1277, 2)).toBe(SHELL)
})

test('at 160 columns the stage keeps all 17 rows and every column, 16/3 pixels an art pixel', () => {
  const band = composeBand({ columns: 160, rows: 22 }, marked(240, 51), stripOf(160))
  // The outermost art pixels keep the sliver inside the line.
  expect(at(band, 4, 4)).toBe(art(0, 0))
  expect(at(band, 1275, 4)).toBe(art(239, 0))
  // Art pixel 1 starts at 16/3, art pixel 2 at 32/3; the last art row ends at the stage's 272nd row.
  expect([at(band, 5, 100), at(band, 6, 100)]).toEqual([art(0, 18), art(1, 18)])
  expect([at(band, 10, 100), at(band, 11, 100)]).toEqual([art(1, 18), art(2, 18)])
  expect([at(band, 640, 266), at(band, 640, 267), at(band, 640, 271)]).toEqual([
    art(120, 49),
    art(120, 50),
    art(120, 50),
  ])
})

test('the strip composes pixel-exact under the stage, its own lines inside, the line over its outer one', () => {
  const scene = stripOf(160)
  const band = composeBand({ columns: 160, rows: 22 }, marked(240, 51), scene)
  // Inside the line: from the 5th pixel in at each side down to the strip's own bottom line.
  const misses: string[] = []
  for (let y = 0; y < 68; y++)
    for (let x = 4; x < 1276; x++) {
      if (at(band, x, 272 + y) !== stripPixel(scene, x, y)) misses.push(`${x},${y}`)
    }
  expect(misses.slice(0, 5)).toEqual([])
  // The bottom line is the strip's own outer line: white 12 and 11 rows from the bottom, shell under.
  expect([340, 341, 342, 351].map((y) => at(band, 640, y))).toEqual([WHITE, WHITE, SHELL, SHELL])
  // The line runs on down the sides past the stage, over the outer windows' side lines.
  expect([272, 282, 300].map((y) => at(band, 2, y))).toEqual([WHITE, WHITE, WHITE])
})

test('the band is opaque: a transparent stage pixel shows the shell', () => {
  const stage = marked(240, 51)
  stage.rgba.fill(0)
  const band = composeBand({ columns: 160, rows: 22 }, stage, stripOf(160))
  expect([alpha(band, 640, 100), at(band, 640, 100)]).toEqual([255, SHELL])
  expect(alpha(band, 640, 290)).toBe(255)
})

test('at 165 columns the playfield is 160 wide and centred, the line in the shell beside it', () => {
  const band = composeBand({ columns: 165, rows: 22 }, marked(240, 51), stripOf(160))
  expect([band.width, band.height]).toEqual([1320, 352])
  // Two cells of shell on the left, three on the right; the line's two pixels against the
  // playfield, whose outermost stage pixels are whole.
  for (const y of [100, 271, 300]) {
    expect([0, 13].map((x) => at(band, x, y))).toEqual([SHELL, SHELL])
    expect([at(band, 14, y), at(band, 15, y)]).toEqual([WHITE, WHITE])
    expect([at(band, 1296, y), at(band, 1297, y)]).toEqual([WHITE, WHITE])
    expect([1298, 1319].map((x) => at(band, x, y))).toEqual([SHELL, SHELL])
  }
  expect([at(band, 16, 100), at(band, 1295, 100)]).toEqual([art(0, 18), art(239, 18)])
  // The top still sits over the sky's first art row: no row of shell above the playfield.
  expect([0, 1, 2, 3, 4].map((y) => at(band, 640, y))).toEqual([
    SHELL,
    SHELL,
    WHITE,
    WHITE,
    art(117, 0),
  ])
  // The cut corners, out in the margin.
  expect([at(band, 14, 2), at(band, 15, 2), at(band, 1297, 2)]).toEqual([SHELL, WHITE, SHELL])
  // The strip's leftmost window keeps its own side line inside the playfield.
  expect([at(band, 18, 300), at(band, 19, 300)]).toEqual([WHITE, WHITE])
  expect([at(band, 16, 300), at(band, 17, 300)]).toEqual([SHELL, SHELL])
})

test('every pixel outside the line is the shell', () => {
  const band = composeBand({ columns: 165, rows: 22 }, marked(240, 51), stripOf(160))
  const off: string[] = []
  for (let y = 0; y < band.height; y++)
    for (let x = 0; x < band.width; x++) {
      const outside = x < 14 || x > 1297 || y < 2 || y > 341
      if (outside && at(band, x, y) !== SHELL) off.push(`${x},${y}`)
    }
  expect(off.slice(0, 5)).toEqual([])
})

test('the placement in cells is where the pixels put the playfield', () => {
  for (const band of [
    { columns: 160, rows: 22 },
    { columns: 165, rows: 22 },
    { columns: 255, rows: 22 },
    { columns: 160, rows: 12 },
  ]) {
    const at0 = playfieldOf(band)
    const stage = marked(240, 51)
    const picture = composeBand(band, stage, stripOf(at0.columns))
    // The playfield's first and last stage column, read off the picture, in cells.
    const row = 100
    let first = -1
    let last = -1
    for (let x = 0; x < picture.width; x++) {
      // A marked art pixel's red is 0x80 to 0x87; the line's white and the shell are not.
      if (at(picture, x, row) >> 19 === 0x10) {
        if (first < 0) first = x
        last = x
      }
    }
    const edge = band.columns > 160 ? 0 : 4
    expect({ ...at0, x: (first - edge) / 8, columns: (last - first + 1 + 2 * edge) / 8 }).toEqual(
      at0,
    )
    expect([at0.y, at0.rows]).toEqual([0, band.rows])
  }
  expect(playfieldOf({ columns: 165, rows: 22 })).toEqual({ x: 2, y: 0, columns: 160, rows: 22 })
  expect(playfieldOf({ columns: 255, rows: 22 })).toEqual({ x: 47, y: 0, columns: 160, rows: 22 })
})

function painted(width: number, height: number, rgbAt: (x: number, y: number) => number): Frame {
  const rgba = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const rgb = rgbAt(x, y)
      rgba.set([(rgb >> 16) & 0xff, (rgb >> 8) & 0xff, rgb & 0xff, 255], i)
    }
  return { width, height, rgba }
}

test('a short band is the rows left: the zoomed stage above the strip, the line around both', () => {
  // 12 rows: the strip's 5 and 7 of stage, 112 pixels, under a scene widened to 389 columns.
  const scene = painted(584, 51, (x) => (x < 292 ? 0xc00000 : 0x0000c0))
  const band = composeBand({ columns: 160, rows: 12 }, scene, stripOf(160))
  expect([band.width, band.height]).toEqual([1280, 192])
  expect([at(band, 100, 50), at(band, 1200, 111)]).toEqual([0xc00000, 0x0000c0])
  // The strip starts right under the stage's 112 rows: its windows' shell margin, then their line.
  expect([at(band, 640, 112), at(band, 640, 122), at(band, 640, 123)]).toEqual([
    SHELL,
    WHITE,
    WHITE,
  ])
  expect([at(band, 2, 50), at(band, 2, 150), at(band, 640, 180), at(band, 640, 2)]).toEqual([
    WHITE,
    WHITE,
    WHITE,
    WHITE,
  ])
})

test('a zoomed scene is shrunk by area averaging, not sampled', () => {
  // Twice the stage's pixels each way, a one-pixel checker: every band pixel covers two by two.
  const checker = painted(2560, 224, (x, y) => ((x + y) % 2 === 0 ? 0xffffff : 0x000000))
  const band = composeBand({ columns: 160, rows: 12 }, checker, stripOf(160))
  expect([at(band, 4, 4), at(band, 640, 60), at(band, 1275, 111)]).toEqual([
    0x808080, 0x808080, 0x808080,
  ])
  // A red-blue seam at art column 291 falls inside band pixel 637's footprint (290.6 to 291.1)
  // and blends there.
  const halves = painted(584, 51, (x) => (x < 291 ? 0xc00000 : 0x0000c0))
  const seam = at(composeBand({ columns: 160, rows: 12 }, halves, stripOf(160)), 637, 50)
  expect([seam >> 16 > 0 && seam >> 16 < 0xc0, (seam & 0xff) > 0]).toEqual([true, true])
})

// The Raster's band (#61): the same placement in cells, the line in box-drawing text.

type Cell = { ch: string; fg: number; bg: number }

/** Raster cells, `columns` wide, as a grid of characters and colours. */
function grid(cells: string, columns: number): Cell[][] {
  const bytes = decode(cells)
  const words = new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4)
  const rows: Cell[][] = []
  for (let w = 0; w < words.length; w += 3) {
    const i = w / 3
    const y = Math.floor(i / columns)
    rows[y] ??= []
    rows[y].push({
      ch: String.fromCodePoint(words[w] ?? 0),
      fg: words[w + 1] ?? 0,
      bg: words[w + 2] ?? 0,
    })
  }
  return rows
}

const text = (g: Cell[][], y: number): string => (g[y] ?? []).map((c) => c.ch).join('')
const shell: Cell = { ch: ' ', fg: SHELL, bg: SHELL }
const line = (ch: string): Cell => ({ ch, fg: WHITE, bg: SHELL })

/** A 1x stage frame of `rows` cells, every pixel opaque and telling where it came from. */
const stage1x = (rows: number) => marked(160, rows * 2)

test('the Raster band at 165 columns: shell cells beside the line, the playfield whole inside it', () => {
  const scene = stripOf(160)
  const g = grid(composeBandCells({ columns: 165, rows: 22 }, stage1x(17), [], scene), 165)
  expect([g.length, g[0]?.length]).toEqual([22, 165])
  // Two cells of margin on the left, three on the right: the line takes the inner one.
  for (const y of [0, 5, 16, 17, 20, 21]) {
    expect([g[y]?.[0], g[y]?.[163], g[y]?.[164]]).toEqual([shell, shell, shell])
  }
  expect([g[0]?.[1], g[0]?.[2], g[0]?.[161], g[0]?.[162]]).toEqual([
    line('╭'),
    line('─'),
    line('─'),
    line('╮'),
  ])
  for (const y of [1, 10, 16, 17, 19, 20])
    expect([g[y]?.[1], g[y]?.[162]]).toEqual([line('│'), line('│')])
  expect([g[21]?.[1], g[21]?.[162]]).toEqual([line('╰'), line('╯')])
  // Under the top line every stage column is whole: art column 0 at cell 2, 159 at cell 161.
  expect(g[5]?.[2]).toEqual({ ch: '▀', fg: art(0, 10), bg: art(0, 11) })
  expect(g[5]?.[161]).toEqual({ ch: '▀', fg: art(159, 10), bg: art(159, 11) })
  // The strip's rows are its own cells above the line: its windows' top lines meet the stage.
  const own = grid(sceneCells(scene), 160)
  for (const y of [0, 1, 2, 3]) {
    const want = (own[y] ?? []).map((c) => (c.bg === CLEAR ? shell : c))
    expect(g[17 + y]?.slice(2, 162)).toEqual(want)
  }
  // The bottom line runs over the strip's own bottom line, each window side meeting it.
  const bottom = text(g, 21).slice(2, 162)
  expect(bottom.replace(/[─┴]/g, '')).toBe('')
  expect([...text(own, 4)].flatMap((ch, x) => ('╰╯'.includes(ch) ? [x] : []))).toEqual(
    [...bottom].flatMap((ch, x) => (ch === '┴' ? [x] : [])),
  )
})

test('the Raster band at 160 to 163 columns draws like 160: the line over the outermost cells', () => {
  const at160 = grid(
    composeBandCells({ columns: 160, rows: 22 }, stage1x(17), [], stripOf(160)),
    160,
  )
  expect([
    text(at160, 0)[0],
    text(at160, 0)[159],
    text(at160, 21)[0],
    text(at160, 21)[159],
  ]).toEqual(['╭', '╮', '╰', '╯'])
  // The line's sides replace the stage's outermost columns and the strip's outer side lines,
  // and meet the strip windows' top lines.
  expect([at160[5]?.[0], at160[5]?.[159], at160[5]?.[1]]).toEqual([
    line('│'),
    line('│'),
    { ch: '▀', fg: art(1, 10), bg: art(1, 11) },
  ])
  expect([at160[17]?.[0], at160[17]?.[159]]).toEqual([line('├'), line('┤')])
  for (const columns of [161, 162, 163]) {
    const x = Math.floor((columns - 160) / 2)
    const g = grid(composeBandCells({ columns, rows: 22 }, stage1x(17), [], stripOf(160)), columns)
    for (let y = 0; y < 22; y++) {
      expect(g[y]?.slice(x, x + 160)).toEqual(at160[y])
      expect([...(g[y]?.slice(0, x) ?? []), ...(g[y]?.slice(x + 160) ?? [])]).toEqual(
        Array(columns - 160).fill(shell),
      )
    }
  }
})

test('the Raster band under a short band: the stage rows shown above the strip, the line around them', () => {
  // 12 rows: 7 of the stage's bottom rows over the 5-row strip.
  const g = grid(composeBandCells({ columns: 160, rows: 12 }, stage1x(7), [], stripOf(160)), 160)
  expect(g).toHaveLength(12)
  expect(text(g, 0)).toBe(`╭${'─'.repeat(158)}╮`)
  expect(g[1]?.[1]).toEqual({ ch: '▀', fg: art(1, 2), bg: art(1, 3) })
  expect(g[6]?.[80]).toEqual({ ch: '▀', fg: art(80, 12), bg: art(80, 13) })
  expect([g[7]?.[0], g[7]?.[159]]).toEqual([line('├'), line('┤')])
  expect([text(g, 11)[0], text(g, 11)[159]]).toEqual(['╰', '╯'])
})

test('the Raster band is opaque: a transparent stage pixel shows the shell', () => {
  const stage = stage1x(17)
  stage.rgba.fill(0)
  const g = grid(composeBandCells({ columns: 160, rows: 22 }, stage, [], stripOf(160)), 160)
  expect(g[5]?.[80]).toEqual({ ch: '▀', fg: SHELL, bg: SHELL })
  expect(g.flat().filter((c) => c.fg === CLEAR || c.bg === CLEAR)).toEqual([])
})

test('a damage number over the Raster band is never under the line', () => {
  const numbers = [
    { text: '12', x: 0, y: 0, rgb: 0xff0000 },
    { text: '345', x: 159, y: 30, rgb: 0x00ff00 },
  ] as Parameters<typeof composeBandCells>[2]
  const g = grid(
    composeBandCells({ columns: 160, rows: 22 }, stage1x(17), numbers, stripOf(160)),
    160,
  )
  expect(text(g, 1).slice(1, 3)).toBe('12')
  expect(text(g, 15).slice(156, 159)).toBe('345')
  expect([text(g, 0)[1], text(g, 15)[159]]).toEqual(['─', '│'])
})

test('compact beside its stage at 170 columns: one line on the right, the window’s own', () => {
  const pic = bandPicture(band('band-compact-wide'))
  // Across a row through the window, white runs past the playfield's centre: its lines only.
  const runs: number[] = []
  for (let x = pic.width / 2; x < pic.width; x++) {
    const white = at(pic, x, 48) === WHITE
    if (white && at(pic, x - 1, 48) !== WHITE) runs.push(x)
  }
  // The window's right line, and shell from there to the band's edge.
  const last = runs.at(-1) ?? 0
  for (let x = last + 2; x < pic.width; x++) expect(at(pic, x, 48)).toBe(SHELL)
  expect(last).toBeLessThan(((170 - 160) / 2 + 160) * 8)
})

test('the Raster band opens its top line where an actor’s art reaches the stage’s top cell', () => {
  const heads = Array.from({ length: 160 }, (_, x) => x >= 40 && x < 44)
  const g = grid(
    composeBandCells({ columns: 160, rows: 22 }, stage1x(17), [], stripOf(160), heads),
    160,
  )
  // Cells 40 to 43 keep the stage's art; the line runs on either side of them.
  expect(g[0]?.[40]).toEqual({ ch: '▀', fg: art(40, 0), bg: art(40, 1) })
  expect(g[0]?.[43]).toEqual({ ch: '▀', fg: art(43, 0), bg: art(43, 1) })
  expect([g[0]?.[39], g[0]?.[44]]).toEqual([line('─'), line('─')])
  // Without heads the line is whole.
  const whole = grid(
    composeBandCells({ columns: 160, rows: 22 }, stage1x(17), [], stripOf(160)),
    160,
  )
  expect(text(whole, 0).slice(1, 159)).toBe('─'.repeat(158))
})
