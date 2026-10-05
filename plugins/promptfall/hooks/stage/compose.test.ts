import { expect, test } from 'claude-code/testing'
import { spriteFor } from '../sprites/index'
import { artFrame, composeFrame } from './compose'
import { DIGITS } from './font'
import { fnv1a64 } from './hash'
import type { StageModel } from './model'
import { ZONE_GROUND } from './tuning'

const slime = spriteFor('enemy', 'road_slime').full

function model(overrides: Partial<StageModel> = {}): StageModel {
  return {
    box: { columns: 40, rows: 10 },
    ground: ZONE_GROUND[0] ?? 0,
    actors: [],
    numbers: [],
    drops: [],
    alt: '',
    ...overrides,
  }
}

const actorAt = (alpha: number) => ({
  key: 'e1',
  spriteId: 'enemy:road_slime',
  art: slime,
  palette: slime.palette,
  x: 0,
  y: 0,
  flipX: false,
  alpha,
  fallen: false,
  flashing: false,
})

const opaqueIn = (f: { width: number; rgba: Uint8ClampedArray }, w: number, h: number) => {
  let n = 0
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (f.rgba[(y * f.width + x) * 4 + 3]) n++
  return n
}

test('the ground strip fills the bottom two pixel rows in the zone colour', () => {
  const f = composeFrame(model(), { numbers: true })
  const g = ZONE_GROUND[0] ?? 0
  for (const y of [18, 19]) {
    for (let x = 0; x < 40; x++) {
      const i = (y * 40 + x) * 4
      expect([f.rgba[i], f.rgba[i + 1], f.rgba[i + 2], f.rgba[i + 3]]).toEqual([
        (g >> 16) & 0xff,
        (g >> 8) & 0xff,
        g & 0xff,
        255,
      ])
    }
  }
  expect(f.rgba[17 * 40 * 4 + 3]).toBe(0)
})

test('transparent sprite pixels stay transparent; half alpha shows about half', () => {
  const whole = opaqueIn(composeFrame(model({ actors: [actorAt(1)] }), { numbers: false }), 16, 16)
  const half = opaqueIn(composeFrame(model({ actors: [actorAt(0.5)] }), { numbers: false }), 16, 16)
  expect(whole).toBeLessThan(256)
  expect(half / whole).toBeGreaterThanOrEqual(0.4)
  expect(half / whole).toBeLessThanOrEqual(0.6)
  expect(opaqueIn(composeFrame(model({ actors: [actorAt(0)] }), { numbers: false }), 16, 16)).toBe(
    0,
  )
})

test('numbers draw only when asked', () => {
  const numbers = [{ text: '8', x: 10, y: 2, rgb: 0xffffff }]
  const at = (f: { rgba: Uint8ClampedArray }) => f.rgba[(2 * 40 + 10) * 4 + 3]
  expect(at(composeFrame(model({ numbers }), { numbers: true }))).toBe(255)
  expect(at(composeFrame(model({ numbers }), { numbers: false }))).toBe(0)
})

test('artFrame is the art size; the font has 11 glyphs of 3 × 5; fnv1a64 of nothing', () => {
  const f = artFrame(slime)
  expect([f.width, f.height]).toEqual([16, 16])
  expect(Object.keys(DIGITS)).toHaveLength(11)
  for (const g of Object.values(DIGITS)) {
    expect(g).toHaveLength(5)
    for (const row of g) expect(row).toHaveLength(3)
  }
  expect(fnv1a64('')).toBe('cbf29ce484222325')
  expect(fnv1a64('a')).toBe('af63dc4c8601ec8c')
})
