import { expect, test } from 'claude-code/testing'
import { encode } from '../sprites/base64'
import { spriteFor } from '../sprites/index'
import { artFrame, backdropOrigin, composeFrame, mirrored } from './compose'
import { GLYPHS } from './font'
import { fnv1a64 } from './hash'
import { type StageModel, samePoses } from './model'
import { deltasText } from './timeline'
import { ZONE_GROUND } from './tuning'

const slime = spriteFor('enemy', 'road_slime').full

function model(overrides: Partial<StageModel> = {}): StageModel {
  return {
    box: { columns: 40, rows: 10 },
    ground: ZONE_GROUND[0] ?? 0,
    backdrop: null,
    actors: [],
    numbers: [],
    glows: [],
    chests: [],
    drops: [],
    effects: [],
    alt: '',
    scale: 1,
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
  raritySlot: null,
  pose: 'idle' as const,
  poses: samePoses(slime),
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

test('artFrame is the art size; the font has 20 glyphs of 3 × 5; fnv1a64 of nothing', () => {
  const f = artFrame(slime)
  expect([f.width, f.height]).toEqual([16, 16])
  expect(Object.keys(GLYPHS)).toHaveLength(20)
  // Every number the stage raises: damage, heals and a level-up's deltas, spaces between.
  const raised = `-0123456789 ${deltasText({ hp: 9, atk: 3, def: 2, spd: 1 })}`
  for (const c of raised) if (c !== ' ') expect(GLYPHS[c], c).toBeDefined()
  for (const g of Object.values(GLYPHS)) {
    expect(g).toHaveLength(5)
    for (const row of g) expect(row).toHaveLength(3)
  }
  expect(fnv1a64('')).toBe('cbf29ce484222325')
  expect(fnv1a64('a')).toBe('af63dc4c8601ec8c')
})

test('at scale 1.5 the frame is 1.5 times the box, the ground 3 rows, a glyph pixel a 2 × 2 block', () => {
  const f = composeFrame(
    model({ scale: 1.5, numbers: [{ text: '1', x: 4, y: 2, rgb: 0xffffff }] }),
    { numbers: true },
  )
  expect([f.width, f.height]).toEqual([60, 30])
  const g = ZONE_GROUND[0] ?? 0
  const rgbAt = (x: number, y: number) => {
    const i = (y * f.width + x) * 4
    return f.rgba[i + 3]
      ? ((f.rgba[i] ?? 0) << 16) | ((f.rgba[i + 1] ?? 0) << 8) | (f.rgba[i + 2] ?? 0)
      : null
  }
  for (const y of [27, 28, 29]) expect(rgbAt(0, y)).toBe(g)
  expect(rgbAt(0, 26)).toBe(null)
  // '1' row 0 is '.#.': glyph pixel (1, 0) covers frame pixels (6..7, 2..3).
  const glyph = GLYPHS['1'] ?? []
  for (let gy = 0; gy < 5; gy++) {
    for (let gx = 0; gx < 3; gx++) {
      const on = glyph[gy]?.[gx] === '#'
      for (const [dx, dy] of [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ] as const) {
        expect(rgbAt(4 + gx * 2 + dx, 2 + gy * 2 + dy) === 0xffffff).toBe(on)
      }
    }
  }
})

/** An 8 × 4 painting where pixel (x, y) is palette index 1 + y * 8 + x, colour 0x010101 × index. */
function painting() {
  const idx = new Uint8Array(32)
  for (let i = 0; i < 32; i++) idx[i] = i + 1
  const palette = [0, ...Array.from({ length: 32 }, (_, i) => 0x010101 * (i + 1))]
  return { width: 8, height: 4, palette, pixels: encode(idx) }
}
const rgbAt = (f: { width: number; rgba: Uint8ClampedArray }, x: number, y: number) => {
  const i = (y * f.width + x) * 4
  return f.rgba[i + 3]
    ? ((f.rgba[i] ?? 0) << 16) | ((f.rgba[i + 1] ?? 0) << 8) | (f.rgba[i + 2] ?? 0)
    : null
}

test('a backdrop fills the frame bottom-anchored and centred, mirrored past its sides, the sky above', () => {
  // A 12 × 6 frame around an 8 × 4 painting: the painting lands at (2, 2).
  const f = composeFrame(model({ box: { columns: 12, rows: 3 }, backdrop: painting() }), {
    numbers: false,
  })
  expect(backdropOrigin(painting(), 12, 6)).toEqual({ x: 2, y: 2 })
  expect(rgbAt(f, 5, 3)).toBe(0x010101 * (1 + 8 + 3))
  // Past the sides: the painting mirrored (frame x 0 is painting column 1, x 11 is column 6);
  // above it: its top row. No frame pixel stays transparent.
  expect(rgbAt(f, 0, 0)).toBe(0x010101 * 2)
  expect(rgbAt(f, 11, 5)).toBe(0x010101 * (1 + 24 + 6))
  expect(rgbAt(f, 1, 4)).toBe(0x010101 * (1 + 16))
  expect(rgbAt(f, 1, 2)).toBe(0x010101 * 1)
  expect(opaqueIn(f, 12, 6)).toBe(72)
  // No ground strip over it: the bottom row is the painting's.
  expect(rgbAt(f, 2, 5)).toBe(0x010101 * (1 + 24))
})

test('a frame smaller than its backdrop crops the sides evenly and the sky', () => {
  const f = composeFrame(model({ box: { columns: 4, rows: 1 }, backdrop: painting() }), {
    numbers: false,
  })
  expect(backdropOrigin(painting(), 4, 2)).toEqual({ x: -2, y: -2 })
  expect(rgbAt(f, 0, 0)).toBe(0x010101 * (1 + 16 + 2))
  expect(rgbAt(f, 3, 1)).toBe(0x010101 * (1 + 24 + 5))
})

test('mirrored continues a row past both edges without a seam', () => {
  expect([-3, -2, -1, 0, 1, 7, 8, 9, 15, 16, 17].map((i) => mirrored(i, 8))).toEqual([
    2, 1, 0, 0, 1, 7, 7, 6, 0, 0, 1,
  ])
})

test('a glow is a disc of its colour under the chest, dithered at its alpha', () => {
  const gold = 0xf0c040
  const rgbAt = (f: { width: number; rgba: Uint8ClampedArray }, x: number, y: number) => {
    const i = (y * f.width + x) * 4
    return f.rgba[i + 3]
      ? ((f.rgba[i] ?? 0) << 16) | ((f.rgba[i + 1] ?? 0) << 8) | (f.rgba[i + 2] ?? 0)
      : null
  }
  const full = composeFrame(model({ glows: [{ x: 20, y: 8, r: 4, rgb: gold, alpha: 1 }] }), {
    numbers: true,
  })
  // A pixel is in the disc when its centre is: (23, 8) is 3.5 px off, (24, 8) 4.5.
  expect([rgbAt(full, 20, 8), rgbAt(full, 23, 8), rgbAt(full, 24, 8)]).toEqual([gold, gold, null])
  expect(rgbAt(full, 20, 3)).toBe(null)
  // At alpha 0.5, about half the disc's pixels.
  const disc = opaqueIn(full, 40, 18)
  const half = composeFrame(model({ glows: [{ x: 20, y: 8, r: 4, rgb: gold, alpha: 0.5 }] }), {
    numbers: true,
  })
  expect(opaqueIn(half, 40, 18)).toBe(disc / 2)
  // A chest over it keeps its own colours.
  const chest = spriteFor('chest', 'open').full
  const under = composeFrame(
    model({
      glows: [{ x: 20, y: 8, r: 4, rgb: gold, alpha: 1 }],
      chests: [{ spriteId: 'chest:open', art: chest, x: 12, y: 0, alpha: 1, phase: 'hold' }],
    }),
    { numbers: true },
  )
  const alone = composeFrame(
    model({
      chests: [{ spriteId: 'chest:open', art: chest, x: 12, y: 0, alpha: 1, phase: 'hold' }],
    }),
    { numbers: true },
  )
  for (let y = 0; y < 16; y++) {
    for (let x = 12; x < 28; x++) {
      if (rgbAt(alone, x, y) !== null) expect(rgbAt(under, x, y)).toBe(rgbAt(alone, x, y))
    }
  }
})
