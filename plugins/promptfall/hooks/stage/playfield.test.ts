import { expect, test } from 'claude-code/testing'
import { stripScene } from '../ui/strip'
import { windowFrame } from '../windows/image'
import type { Scene } from '../windows/kit'
import { BORDER_RGB, FIELD_RGB } from '../windows/tuning'
import type { Frame } from './compose'
import { composeBand, playfieldOf } from './playfield'
import { strip } from './scenarios'

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
