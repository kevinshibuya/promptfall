import { expect } from 'claude-code/testing'
import { decode, encode } from '../sprites/base64'
import { BACKDROPS } from '../sprites/generated'
import { spriteFor } from '../sprites/index'
import type { SpriteArt } from '../sprites/types'
import { test } from '../testing'
import { item, listing, marketPage, paneInput, paneView } from '../ui/pane/fixtures'
import { inventoryPane } from '../ui/pane/inventory'
import { marketPane } from '../ui/pane/market'
import { sceneSvg } from '../windows/svg'
import { CELL_W, PANE_SVG_MAX_CHARS, STRIP_SVG_MAX_CHARS } from '../windows/tuning'
import { composeFrame } from './compose'
import { fullerFrame } from './fixtures'
import { BAND_GOLDENS, GOLDENS, PANE_GOLDENS, STRIP_GOLDENS } from './goldens/index'
import { imageBytes, pngImage } from './image'
import { type StageActor, type StageModel, samePoses } from './model'
import { composeBand } from './playfield'
import { rasterPairs } from './raster'
import {
  BAND_SCENARIOS,
  band,
  bandGoldenOf,
  caseOf,
  type Golden,
  goldenOf,
  PANE_SCENARIOS,
  pane,
  paneGoldenOf,
  renders,
  SCENARIOS,
  type Scenario,
  STRIP_SCENARIOS,
  stage,
  strip,
  stripGoldenOf,
} from './scenarios'
import { fitSvg, type Rung } from './svg'
import type { Motion } from './timeline'
import {
  DESKTOP_COLUMN_PX_CEILING,
  IMAGE_MAX_BYTES,
  IMAGE_MAX_SIDE,
  IMAGE_MAX_SOURCE_BYTES,
  IMAGE_SCALE,
  RASTER_MAX_PAIRS,
  SVG_MAX_CHARS,
  ZONE_GROUND,
} from './tuning'

/** A model's Image frame within the Image budget: its bytes at its share of IMAGE_SCALE. */
function imageWithinBudget(model: StageModel, check = 'image bytes'): void {
  const frame = composeFrame(model, { numbers: true })
  expect(imageBytes(frame, IMAGE_SCALE / model.scale), check).toBeLessThanOrEqual(IMAGE_MAX_BYTES)
}

/** `make(key)` once per key, shared by every test that reads it. */
function once<K, V>(make: (key: K) => V): (key: K) => V {
  const made = new Map<K, V>()
  return (key) => {
    let value = made.get(key)
    if (value === undefined) {
      value = make(key)
      made.set(key, value)
    }
    return value
  }
}

/** Each stage scenario staged and its encodings rendered once: the golden and the budgets read these. */
const staged = once((name: Scenario) => {
  const s = stage(name)
  return { ...s, renders: renders(s) }
})

for (const name of SCENARIOS) {
  test(`the ${name} scenario matches its goldens on every renderer and stays in budget`, () => {
    const s = staged(name)
    const r = s.renders
    const golden = goldenOf(r)
    const want = GOLDENS[name]
    for (const encoding of Object.keys({ ...want, ...golden }) as (keyof Golden)[]) {
      expect(golden[encoding], `${name}: ${encoding}`).toBe(want[encoding])
    }
    // The Raster's cells are the one scene's, resampled: its pairs, on every scenario.
    expect(rasterPairs(r.cells), `${name}: Raster pairs`).toBeLessThanOrEqual(RASTER_MAX_PAIRS)
    expect(
      imageBytes(r.image, IMAGE_SCALE / s.model.scale),
      `${name}: Image bytes`,
    ).toBeLessThanOrEqual(IMAGE_MAX_BYTES)
    // The desktop's Svg through the production ladder: on its first rung, under three quarters of
    // the cap, SMIL on and off.
    for (const [smil, svg, rung] of [
      ['on', r.svg, r.rung],
      ['off', r.svgFlat, r.rungFlat],
    ] as const) {
      expect(rung, `${name}: the desktop's Svg's rung, SMIL ${smil}`).toBe(0)
      expect(svg.length, `${name}: the desktop's Svg, SMIL ${smil}`).toBeLessThan(
        (SVG_MAX_CHARS * 3) / 4,
      )
    }
  })
}

test("a case stages at any instant after its events: the windup's knight, later, is the strike's and the follow-through's", () => {
  const windup = caseOf('windup')
  expect(windup.from).toBeLessThan(windup.now)
  for (const [name, later] of [
    ['strike', 120],
    ['follow', 240],
  ] as const) {
    // The Svg's SMIL clock counts from its own instant, so its hash is the instant's own.
    const g = goldenOf(renders(windup.at(windup.now + later)))
    expect(g.imageHash, `${name}: Image`).toBe(GOLDENS[name].imageHash)
    expect(g.rasterHash, `${name}: Raster`).toBe(GOLDENS[name].rasterHash)
  }
})

test('the spawn scenario stages the hedge sprite halfway through its fade in, after the kill has faded', () => {
  const c = caseOf('spawn')
  const s = c.at(c.now)
  expect(s.motions.filter((m) => m.kind === 'dissolve')).toEqual([])
  const spawn = s.motions.find((m) => m.kind === 'spawn')
  expect(spawn?.actor).toBe('e4')
  expect(spawn?.from).toBe(c.from)
  expect(((spawn?.until ?? 0) + (spawn?.from ?? 0)) / 2).toBe(c.now)
})

const NOW = 1_000_000

function actor(
  key: string,
  spriteId: string,
  art: SpriteArt,
  x: number,
  y: number,
  flipX: boolean,
): StageActor {
  return {
    key,
    spriteId,
    art,
    palette: art.palette,
    x,
    y,
    flipX,
    alpha: 1,
    fallen: false,
    flashing: false,
    raritySlot: null,
    pose: 'idle',
    poses: samePoses(art),
  }
}

/**
 * Three heroes and the boss stepped out, the heroes lunging, three numbers rising, a chest
 * revealing its item.
 */
function busyMotions(boss: string): Motion[] {
  return [
    ...['h1', 'h2', 'h3'].map(
      (h): Motion => ({ kind: 'step', actor: h, from: NOW - 100, until: NOW + 400, dir: -1 }),
    ),
    { kind: 'step', actor: boss, from: NOW - 100, until: NOW + 400, dir: 1 },
    ...['h1', 'h2', 'h3'].map(
      (h): Motion => ({ kind: 'lunge', actor: h, from: NOW - 50, until: NOW + 190, dir: -1 }),
    ),
    ...['h1', 'h2', 'h3'].map(
      (h): Motion => ({
        kind: 'number',
        actor: boss,
        text: `${h.length}99`,
        rgb: 0xffffff,
        from: NOW - 20,
        until: NOW + 680,
      }),
    ),
    { kind: 'flash', actor: boss, from: NOW - 10, until: NOW + 150 },
    {
      kind: 'chest',
      actor: boss,
      itemId: 'i1',
      rarity: 'legendary',
      spriteId: 'item:iron_sword',
      from: NOW - 1500,
      until: NOW + 2100,
    },
  ]
}

test('at scale 1.5 the rest frame and the boss frame are both 180 × 51 (ADR 0010)', () => {
  const rest = staged('rest').renders.image
  expect([rest.width, rest.height]).toEqual([180, 51])
  const boss = staged('boss').renders.image
  expect([boss.width, boss.height]).toEqual([180, 51])
  expect(staged('compact').model.scale).toBe(1)
})

test('hires worst case: the 72 × 51 boss at 160 × 17 with three lunging heroes stays in the Image budget', () => {
  const boss = spriteFor('enemy', 'bandit_captain').hires
  const heroes = ['knight', 'black_mage', 'white_mage'].map((c) => spriteFor('hero', c).hires)
  const model: StageModel = {
    box: { columns: 160, rows: 17 },
    ground: ZONE_GROUND[0] ?? 0,
    backdrop: null,
    actors: [
      actor('e1', 'enemy:bandit_captain', boss, 6, 0, false),
      ...heroes.map((art, i) => actor(`h${i + 1}`, `hero:${i}`, art, 210 - i * 27, 27, true)),
    ],
    numbers: [0, 1, 2].map((i) => ({ text: '999', x: 15 + i * 30, y: 3, rgb: 0xffffff })),
    glows: [{ x: 42, y: 21, r: 18, rgb: 0xf0c040, alpha: 0.5 }],
    chests: [
      {
        spriteId: 'chest:closed',
        art: spriteFor('chest', 'closed').hires,
        x: 30,
        y: 27,
        alpha: 1,
        phase: 'hold',
      },
    ],
    drops: [
      {
        spriteId: 'item:iron_sword',
        art: spriteFor('item', 'iron_sword').hires,
        x: 30,
        y: 9,
        alpha: 1,
      },
    ],
    effects: [],
    alt: 'worst',
    scale: 1.5,
  }
  expect(composeFrame(model, { numbers: true }).width).toBe(240)
  imageWithinBudget(model)
})

/** A legal-sized checkerboard: every pixel opaque, alternating two colours, the worst run length. */
function checker(width: number, height: number, a: number, b: number): SpriteArt {
  const px = new Uint8Array(width * height).map(
    (_, i) => 1 + (((i % width) + Math.floor(i / width)) % 2),
  )
  return { width, height, palette: [0, a, b], pixels: encode(px) }
}

for (const name of STRIP_SCENARIOS) {
  test(`strip golden: ${name}`, () => {
    expect(stripGoldenOf(strip(name))).toEqual(STRIP_GOLDENS[name])
  })
}

for (const name of PANE_SCENARIOS) {
  test(`pane golden: ${name}`, () => {
    expect(paneGoldenOf(pane(name))).toEqual(PANE_GOLDENS[name])
  })
}

/** Each band scenario built once, shared by its three tests. */
const built = once(band)

for (const name of BAND_SCENARIOS) {
  test(`band golden: ${name}`, () => {
    expect(bandGoldenOf(built(name))).toEqual(BAND_GOLDENS[name])
  })
  test(`band ${name}: the Raster's cells are the band's box and fit the colour pair budget`, () => {
    const input = built(name)
    expect(decode(input.cells).length).toBe(input.box.columns * input.box.rows * 12)
    expect(rasterPairs(input.cells)).toBeLessThanOrEqual(RASTER_MAX_PAIRS)
  })
  test(`band ${name}: the desktop's stage and strip Svgs are each the band's width and under their caps`, () => {
    const { svg, box } = built(name)
    const width = `width="${box.columns * DESKTOP_COLUMN_PX_CEILING}"`
    expect(svg.strip).toMatch(new RegExp(`^<svg [^>]*${width}`))
    expect(svg.strip.length).toBeLessThanOrEqual(STRIP_SVG_MAX_CHARS)
    if (svg.stage === null) {
      // Loot and World: the strip's Svg is the whole band, the shell under it and the line all
      // round, its tracks inside.
      expect(svg.strip).toMatch(/<\/defs><rect [^>]*\/>.*<animate.*<path fill="#303028"/)
      expect(svg.strip).toMatch(/<path fill="#f0f0e8" fill-rule="evenodd" d="[^"]*Z"\/><\/svg>$/)
      return
    }
    expect(svg.stage).toMatch(new RegExp(`^<svg [^>]*${width}`))
    // One grid for both: the same viewBox width, so the line's sides meet.
    const gridOf = (doc: string) => doc.match(/viewBox="0 0 (\d+) /)?.[1]
    expect(gridOf(svg.stage)).toBe(gridOf(svg.strip))
    // The SMIL plays inside the frame: the stage's motions in its scaled group, the strip's tracks.
    expect(svg.stage).toMatch(
      /<g transform="translate\([^)]*\) scale\([^)]*\)">.*<animate.*<\/g><path/,
    )
    expect(svg.strip).toMatch(/<\/defs><rect [^>]*\/>.*<animate.*<path fill="#303028"/)
    expect(svg.stage.length).toBeLessThan(SVG_MAX_CHARS)
  })
}

test('the band at 255 × 22 on the 8 by 16 grid is 2040 pixels wide and its PNG fits the host', () => {
  // The rest band's strip, and a stage frame of noise: no run for deflate to find but the 16/3
  // upscale's own.
  const { strip } = built('band-rest')
  const rgba = new Uint8ClampedArray(240 * 51 * 4)
  let seed = 1
  for (let i = 0; i < rgba.length; i++) {
    seed = (seed * 1_103_515_245 + 12_345) >>> 0
    rgba[i] = i % 4 === 3 ? 255 : seed >>> 24
  }
  const picture = composeBand({ columns: 255, rows: 22 }, { width: 240, height: 51, rgba }, strip)
  expect([picture.width, picture.height]).toEqual([2040, 352])
  expect(Math.max(picture.width, picture.height)).toBeLessThanOrEqual(IMAGE_MAX_SIDE)
  const { png } = pngImage(picture, 1)
  expect(Math.ceil((png.length * 3) / 4)).toBeLessThanOrEqual(IMAGE_MAX_SOURCE_BYTES)
})

test('the fullest pane fits the Svg budget', () => {
  // Wide, 120 × 24, 15 rows of 30-character names with sprites, a full detail window, a command
  // window open over it.
  const view = paneView()
  view.inventory = Array.from({ length: 20 }, (_, i) =>
    item(`x${i}`, {
      base: i % 2 === 0 ? 'silk_robe' : 'iron_sword',
      name: `${'Wondrous Gleaming Item'.padEnd(26, 'x')}${String(i).padStart(4, '0')}`,
      rarity: 'legendary',
      affixes: ['+9 Strength', '+9 Defence', '+9% Speed', '+9 Magic'],
      equippedBy: i === 0 ? null : 'h1',
      tradeableAt: 5_000_000,
    }),
  )
  const base = paneInput({ view, remainingMs: () => 3_600_000 })
  const build = inventoryPane({
    ...base,
    dialog: {
      ...base.dialog,
      menu: { kind: 'actions', tab: 'inventory', id: 'x0', at: 0 },
      cursor: { inventory: { id: 'x0', index: 0 }, heroes: null },
    },
  })
  const listed = build.scene.windows.find((w) => w.key === 'list')
  expect(listed?.lines.length).toBe(15)
  const svg = sceneSvg(build.scene, [], { smil: false, width: build.scene.columns * CELL_W })
  expect(svg.length).toBeLessThan(PANE_SVG_MAX_CHARS)
})

test('the fullest Market pane fits the Svg budget', () => {
  // Wide, 120 × 24, ten listings with 30-character names and sprites, both page rows, the Base
  // pick open over the list.
  const listings = Array.from({ length: 10 }, (_, i) =>
    listing(`L${i}`, {
      kind: i % 3 === 0 ? 'hero' : 'item',
      name: `${'Wondrous Gleaming Listing'.padEnd(26, 'x')}${String(i).padStart(4, '0')}`,
      rarity: 'legendary',
      sellerName: 'a-long-seller-name',
      price: 999_999,
      base: i % 3 === 0 ? null : i % 2 === 0 ? 'silk_robe' : 'iron_sword',
      cls: i % 3 === 0 ? 'black_mage' : null,
    }),
  )
  const base = paneInput({
    tab: 'market',
    market: {
      ...marketPage(),
      query: { kind: 'item', sort: 'price', page: 1 },
      page: { listings, page: 1, total: 43 },
    },
  })
  const build = marketPane({
    ...base,
    dialog: { ...base.dialog, menu: { kind: 'pick', field: 'base', at: 20 } },
  })
  const keys = build.stops.filter((s) => s.key.startsWith('row:'))
  expect(keys).toHaveLength(0)
  const list = build.scene.windows.find((w) => w.key === 'list')
  expect(list?.lines.length).toBe(13)
  expect(build.scene.windows.find((w) => w.key === 'menu')).toBeDefined()
  const svg = sceneSvg(build.scene, [], { smil: false, width: build.scene.columns * CELL_W })
  expect(svg.length).toBeLessThan(PANE_SVG_MAX_CHARS)
})

/** The adversarial scene at 1.5: a checker boss, three checker heroes with distinct palettes, a checker drop. */
function adversarial(): StageModel {
  const scale = 1.5
  const k = (v: number) => Math.round(v * scale)
  const boss = checker(k(48), k(34), 0x102030, 0xf0e0d0)
  const heroes = [0, 1, 2].map((i) =>
    checker(k(16), k(16), 0x400000 + i * 0x101010, 0x00c000 + i * 0x000a0a),
  )
  return {
    box: { columns: 160, rows: 17 },
    ground: ZONE_GROUND[0] ?? 0,
    backdrop: null,
    actors: [
      actor('e1', 'adversarial:boss', boss, k(4), 0, false),
      ...heroes.map((art, i) =>
        actor(`h${i + 1}`, `adversarial:h${i}`, art, k(140) - i * k(18), k(34) - art.height, true),
      ),
    ],
    numbers: [{ text: '-999', x: k(10), y: k(2), rgb: 0xff5050 }],
    glows: [{ x: k(28), y: k(14), r: k(12), rgb: 0xf0c040, alpha: 0.5 }],
    chests: [
      {
        spriteId: 'adversarial:chest',
        art: checker(k(16), k(16), 0x604020, 0xf0c040),
        x: k(20),
        y: k(18),
        alpha: 0.5,
        phase: 'hold',
      },
    ],
    drops: [
      {
        spriteId: 'adversarial:drop',
        art: checker(k(16), k(16), 0x808080, 0x0000ff),
        x: k(20),
        y: k(6),
        alpha: 0.5,
      },
    ],
    effects: [],
    alt: 'adversarial',
    scale,
  }
}

test('adversarial legal art at 1.5 (a 72 × 51 checker boss, 24 × 24 heroes) renders on the first rung, under the cap, and in the Image budget', () => {
  const model = adversarial()
  const motions = busyMotions('e1').filter((m) => m.kind !== 'chest')
  for (const smil of [true, false]) {
    const opts = { smil, now: NOW, width: 960, motion: 'full' as const }
    const { svg, rung } = fitSvg(model, motions, opts)
    expect(rung).toBe(0)
    expect(svg.length).toBeLessThan(SVG_MAX_CHARS)
  }
  imageWithinBudget(model)
})

/**
 * ADR 0006's fuller legal frame through the production ladder, SMIL on, at rest with the idle pair
 * and 60 ms into a dithered boss lunge with a hero hit: the rung it lands on and its characters.
 * These are ticket #210's numbers for its strokes encoding (`pnpm svg:measure`), every rung of
 * each; the lunge over zones 3, 8, 9 and 10 lands on the last rung, with no backdrop.
 */
const FULLER_RUNGS: Record<string, { rest: [Rung, number]; lunging: [Rung, number] }> = {
  'no backdrop': { rest: [0, 64_487], lunging: [0, 118_952] },
  1: { rest: [0, 75_363], lunging: [0, 129_828] },
  2: { rest: [0, 76_431], lunging: [0, 130_896] },
  3: { rest: [0, 83_706], lunging: [3, 114_061] },
  4: { rest: [0, 74_686], lunging: [0, 129_151] },
  5: { rest: [0, 73_493], lunging: [0, 127_958] },
  6: { rest: [0, 75_636], lunging: [0, 130_101] },
  7: { rest: [0, 79_394], lunging: [1, 129_201] },
  8: { rest: [0, 83_715], lunging: [3, 114_061] },
  9: { rest: [0, 82_444], lunging: [3, 114_061] },
  10: { rest: [0, 84_894], lunging: [3, 114_061] },
  11: { rest: [0, 78_790], lunging: [1, 128_597] },
  12: { rest: [0, 72_905], lunging: [0, 127_370] },
}

test('the fuller legal frame at rest and lunging, with no backdrop and over every zone backdrop, fits on a rung', () => {
  const zones = Object.keys(BACKDROPS)
  expect(Object.keys(FULLER_RUNGS).sort()).toEqual(['no backdrop', ...zones].sort())
  for (const [zone, pins] of Object.entries(FULLER_RUNGS)) {
    for (const acting of [false, true]) {
      const f = fullerFrame(acting, NOW)
      const model = { ...f.model, backdrop: BACKDROPS[zone]?.hires ?? null }
      const at = `${acting ? 'lunging' : 'at rest'}, ${zone}`
      const on = fitSvg(model, f.motions, { smil: true, now: NOW, width: 960, motion: 'full' })
      expect([on.rung, on.svg.length], at).toEqual(acting ? pins.lunging : pins.rest)
      expect(on.svg.length, at).toBeLessThan(SVG_MAX_CHARS)
      // Without SMIL the picture carries one frame: the first rung, whatever the zone.
      const off = fitSvg(model, f.motions, { smil: false, now: NOW, width: 960, motion: 'full' })
      expect(off.rung, at).toBe(0)
    }
  }
})

test('the bandit captain 60 ms into its lunge, on its drawn frames and stepped: a 1.5x SMIL Svg of 30,386 characters over the zone 1 backdrop, under the cap', () => {
  const svg = staged('boss-strike').renders.svg
  expect(svg.length).toBe(30_386)
  expect(svg.length).toBeLessThan(SVG_MAX_CHARS)
})

test('the fuller frame over every zone backdrop stays in the Image budget', () => {
  const zones = Object.keys(BACKDROPS)
  expect(zones.length).toBeGreaterThan(0)
  for (const zone of zones) {
    const b = BACKDROPS[zone]
    if (!b) continue
    const { model } = fullerFrame(true, NOW)
    imageWithinBudget({ ...model, backdrop: b.hires }, `zone ${zone}: image bytes`)
  }
})
