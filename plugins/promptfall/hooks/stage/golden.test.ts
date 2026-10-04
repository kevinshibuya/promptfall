import { expect, test } from 'claude-code/testing'
import { encode } from '../sprites/base64'
import { spriteFor } from '../sprites/index'
import type { SpriteArt } from '../sprites/types'
import { composeFrame } from './compose'
import { GOLDENS } from './goldens/index'
import { imageBytes } from './image'
import type { StageActor, StageModel } from './model'
import { encodeRaster, rasterPairs } from './raster'
import { goldenOf, SCENARIOS, stage } from './scenarios'
import { renderSvg } from './svg'
import type { Motion } from './timeline'
import {
  IMAGE_MAX_BYTES,
  IMAGE_SCALE,
  RASTER_MAX_PAIRS,
  SVG_MAX_CHARS,
  ZONE_GROUND,
} from './tuning'

function withinBudgets(model: StageModel, motions: readonly Motion[], now: number): void {
  const svg = renderSvg(model, motions, { smil: true, now, width: 960, motion: 'full' })
  expect(svg.length).toBeLessThan(SVG_MAX_CHARS)
  const flat = renderSvg(model, motions, { smil: false, now, width: 960, motion: 'full' })
  expect(flat.length).toBeLessThan(SVG_MAX_CHARS)
  const cells = encodeRaster(composeFrame(model, { numbers: false }), model.numbers)
  expect(rasterPairs(cells)).toBeLessThanOrEqual(RASTER_MAX_PAIRS)
  expect(imageBytes(composeFrame(model, { numbers: true }), IMAGE_SCALE)).toBeLessThanOrEqual(
    IMAGE_MAX_BYTES,
  )
}

for (const name of SCENARIOS) {
  test(`the ${name} scenario matches its goldens on every renderer and stays in budget`, () => {
    const s = stage(name)
    expect(goldenOf(s)).toEqual(GOLDENS[name])
    withinBudgets(s.model, s.motions, s.now)
  })
}

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
  }
}

/** Three heroes lunging, three numbers rising, a drop popping. */
function busyMotions(boss: string): Motion[] {
  return [
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
    { kind: 'drop', actor: boss, item: 'item:iron_sword', from: NOW - 300, until: NOW + 300 },
  ]
}

test('worst case: the concept boss at 160 × 17 with three lunging heroes, numbers and a drop', () => {
  const boss = spriteFor('enemy', 'bandit_captain').full
  const heroes = ['knight', 'black_mage', 'white_mage'].map((c) => spriteFor('hero', c).full)
  const drop = spriteFor('item', 'iron_sword').full
  const model: StageModel = {
    box: { columns: 160, rows: 17 },
    ground: ZONE_GROUND[0] ?? 0,
    actors: [
      actor('e1', 'enemy:bandit_captain', boss, 4, 0, false),
      ...heroes.map((art, i) =>
        actor(
          `h${i + 1}`,
          `hero:${['knight', 'black_mage', 'white_mage'][i]}`,
          art,
          140 - i * 18,
          18,
          true,
        ),
      ),
    ],
    numbers: [0, 1, 2].map((i) => ({ text: '999', x: 10 + i * 14, y: 2, rgb: 0xffffff })),
    drops: [{ spriteId: 'item:iron_sword', art: drop, x: 20, y: 6, alpha: 1 }],
    alt: 'worst',
  }
  withinBudgets(model, busyMotions('e1'), NOW)
})

/** A legal-sized checkerboard: every pixel opaque, alternating two colours, the worst run length. */
function checker(width: number, height: number, a: number, b: number): SpriteArt {
  const px = new Uint8Array(width * height).map(
    (_, i) => 1 + (((i % width) + Math.floor(i / width)) % 2),
  )
  return { width, height, palette: [0, a, b], pixels: encode(px) }
}

test('adversarial legal art: a 48 × 34 checker boss, three checker heroes, a checker drop', () => {
  const boss = checker(48, 34, 0x102030, 0xf0e0d0)
  const heroes = [0, 1, 2].map((i) =>
    checker(16, 16, 0x400000 + i * 0x101010, 0x00c000 + i * 0x000a0a),
  )
  const drop = checker(16, 16, 0x808080, 0x0000ff)
  const model: StageModel = {
    box: { columns: 160, rows: 17 },
    ground: ZONE_GROUND[0] ?? 0,
    actors: [
      actor('e1', 'adversarial:boss', boss, 4, 0, false),
      ...heroes.map((art, i) =>
        actor(`h${i + 1}`, `adversarial:h${i}`, art, 140 - i * 18, 18, true),
      ),
    ],
    numbers: [{ text: '-999', x: 10, y: 2, rgb: 0xff5050 }],
    drops: [{ spriteId: 'adversarial:drop', art: drop, x: 20, y: 6, alpha: 0.5 }],
    alt: 'adversarial',
  }
  withinBudgets(
    model,
    busyMotions('e1').filter((m) => m.kind !== 'drop'),
    NOW,
  )
})
