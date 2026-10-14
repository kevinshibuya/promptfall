// Writes plugins/promptfall/hooks/stage/goldens/parity-<sheet>.png: a contact sheet per key
// scenario, to judge the three surfaces' timing parity by eye once, at the PR. Three rows: the
// Image frame as the terminal shows it in the stage's cells, the Raster's cells drawn as pixels
// with their text glyphs, and the desktop's picture with SMIL off rasterised in headless Chromium,
// each the stage's box in pixels; one column per instant, at fixed fractions of each stretch. A
// command, not a gate: `pnpm stage:parity`, which needs Playwright's Chromium
// (`pnpm exec playwright install chromium`).
import { join } from 'node:path'
import type { Browser } from 'playwright'
import type { Frame } from '../plugins/promptfall/hooks/stage/compose'
import {
  caseOf,
  cellsPicture,
  renders,
  type Scenario,
  type Staged,
} from '../plugins/promptfall/hooks/stage/scenarios'
import type { Motion } from '../plugins/promptfall/hooks/stage/timeline'
import { glyphFor } from '../plugins/promptfall/hooks/windows/kit'
import { CELL_H, CELL_W } from '../plugins/promptfall/hooks/windows/tuning'
import { type Rgba, writePng } from './png'

const OUT = join(import.meta.dirname, '../plugins/promptfall/hooks/stage/goldens')

/** The fractions of a stretch a sheet shows it at: its start, its end and four between. */
export const INSTANTS = [0, 0.2, 0.4, 0.6, 0.8, 1] as const

/** A sheet's stretch: its scenario's case, from the start to the end of its first `kind` motion. */
export type Stretch = { scenario: Scenario; kind: Motion['kind'] }
export type Sheet = { name: string; stretches: readonly Stretch[] }

export const SHEETS: readonly Sheet[] = [
  // The knight's attack with its hit: its step spans the action, from the wind-up's hold to the
  // follow-through's end.
  { name: 'strike', stretches: [{ scenario: 'strike', kind: 'step' }] },
  // The goblin scout's fade, then, after the kill's pause, the hedge sprite's in its place.
  {
    name: 'spawn',
    stretches: [
      { scenario: 'dissolve', kind: 'dissolve' },
      { scenario: 'spawn', kind: 'spawn' },
    ],
  },
  // The kill's chest from its fall through its reveal and the item's fade.
  { name: 'chest', stretches: [{ scenario: 'chest', kind: 'chest' }] },
]

/** A sheet's column: its head, and the scenario staged at its instant. */
export type Column = { head: string; staged: Staged }

/** A sheet's columns: each stretch staged at each of the INSTANTS, headed by its ms into it. */
export function columnsOf(sheet: Sheet): Column[] {
  return sheet.stretches.flatMap(({ scenario, kind }) => {
    const c = caseOf(scenario)
    const motion = c.at(c.from).motions.find((m) => m.kind === kind)
    if (motion === undefined) throw new Error(`${scenario}: no ${kind} motion after its events`)
    const from = Math.max(motion.from, c.from)
    return INSTANTS.map((f) => {
      const ms = Math.round((motion.until - from) * f)
      return { head: `${kind} ${ms}ms`, staged: c.at(from + ms) }
    })
  })
}

/** The Image frame scaled into `width` × `height`, the box the terminal shows it in: nearest pixel. */
export function imageRow(frame: Frame, width: number, height: number): Frame {
  const rgba = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    const sy = Math.floor((y * frame.height) / height)
    for (let x = 0; x < width; x++) {
      const si = (sy * frame.width + Math.floor((x * frame.width) / width)) * 4
      rgba.set(frame.rgba.subarray(si, si + 4), (y * width + x) * 4)
    }
  }
  return { width, height, rgba }
}

/** A sheet's background: the dark terminal the goldens' PNGs lay their pixels on. */
export const BG = [0x1e, 0x1e, 0x24] as const
const INK = [0xd0, 0xd0, 0xd0] as const
const LAYOUT = { label: 8 * CELL_W, head: CELL_H + CELL_H / 2, gap: CELL_W }

/**
 * The sheet: each row's frames side by side under the columns' heads, its label in the gutter on
 * its left; every pixel over the background by its alpha.
 */
export function contactSheet(
  heads: readonly string[],
  rows: readonly { label: string; frames: readonly Frame[] }[],
): { png: Rgba; layout: typeof LAYOUT } {
  const { label, head, gap } = LAYOUT
  const widths = heads.map((_, i) => Math.max(...rows.map((r) => r.frames[i]?.width ?? 0)))
  const heights = rows.map((r) => Math.max(...r.frames.map((f) => f.height)))
  const xs = widths.map((_, i) => label + widths.slice(0, i).reduce((a, w) => a + w + gap, 0))
  const ys = heights.map((_, i) => head + heights.slice(0, i).reduce((a, h) => a + h + gap, 0))
  const width = (xs.at(-1) ?? label) + (widths.at(-1) ?? 0)
  const height = (ys.at(-1) ?? head) + (heights.at(-1) ?? 0)
  const data = new Uint8Array(width * height * 4)
  for (let i = 0; i < data.length; i += 4) data.set([...BG, 255], i)
  const put = (x: number, y: number, rgb: readonly number[], a: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height || a === 0) return
    const i = (y * width + x) * 4
    for (let k = 0; k < 3; k++) {
      data[i + k] = Math.round(((rgb[k] ?? 0) * a + (data[i + k] ?? 0) * (255 - a)) / 255)
    }
  }
  const text = (s: string, x0: number, y0: number) => {
    ;[...s].forEach((ch, n) => {
      const glyph = glyphFor(ch)
      for (let gy = 0; gy < CELL_H; gy++) {
        for (let gx = 0; gx < CELL_W; gx++) {
          if ((glyph[gy] ?? 0) & (0x80 >> gx)) put(x0 + n * CELL_W + gx, y0 + gy, INK, 255)
        }
      }
    })
  }
  heads.forEach((h, i) => {
    text(h, xs[i] ?? 0, (head - CELL_H) / 2)
  })
  rows.forEach((row, r) => {
    const y0 = ys[r] ?? 0
    text(row.label, 0, y0 + Math.floor(((heights[r] ?? 0) - CELL_H) / 2))
    row.frames.forEach((f, c) => {
      const x0 = xs[c] ?? 0
      for (let y = 0; y < f.height; y++) {
        for (let x = 0; x < f.width; x++) {
          const si = (y * f.width + x) * 4
          put(x0 + x, y0 + y, [...f.rgba.subarray(si, si + 3)], f.rgba[si + 3] ?? 0)
        }
      }
    })
  })
  return { png: { width, height, data }, layout: LAYOUT }
}

const URL = 'http://parity.test/stage.svg'

/** The desktop's flat picture rasterised in Chromium at `width` × `height`, its clear pixels clear. */
async function desktopRow(browser: Browser, svg: string, width: number, height: number) {
  const { PNG } = await import('pngjs')
  const page = await browser.newPage({ viewport: { width, height } })
  try {
    // The root drawn at the box's size, so the row is the Image's height whatever the picture says.
    const sized = svg.replace(
      /^(<svg[^>]*?) width="\d+" height="\d+"/,
      `$1 width="${width}" height="${height}"`,
    )
    await page.route(URL, (r) => r.fulfill({ contentType: 'image/svg+xml', body: sized }))
    await page.goto(URL, { waitUntil: 'load' })
    const parsed = await page.evaluate(
      () => document.getElementsByTagName('parsererror').length === 0,
    )
    if (!parsed) throw new Error('the desktop picture does not parse')
    const png = PNG.sync.read(await page.screenshot({ omitBackground: true }))
    return { width: png.width, height: png.height, rgba: new Uint8ClampedArray(png.data) }
  } finally {
    await page.close()
  }
}

async function main(): Promise<void> {
  const { chromium } = await import('playwright')
  const browser = await chromium.launch()
  try {
    for (const sheet of SHEETS) {
      const columns = columnsOf(sheet)
      const image: Frame[] = []
      const raster: Frame[] = []
      const desktop: Frame[] = []
      for (const { staged } of columns) {
        const r = renders(staged)
        const { columns: cols, rows } = staged.model.box
        const [w, h] = [cols * CELL_W, rows * CELL_H]
        image.push(imageRow(r.image, w, h))
        raster.push(cellsPicture(r.cells, cols))
        desktop.push(await desktopRow(browser, r.svgFlat, w, h))
      }
      const { png } = contactSheet(
        columns.map((c) => c.head),
        [
          { label: 'Image', frames: image },
          { label: 'Raster', frames: raster },
          { label: 'desktop', frames: desktop },
        ],
      )
      const path = join(OUT, `parity-${sheet.name}.png`)
      writePng(path, png)
      console.log(`${path}: ${columns.length} instants, ${png.width} × ${png.height}`)
    }
  } finally {
    await browser.close()
  }
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) await main()
