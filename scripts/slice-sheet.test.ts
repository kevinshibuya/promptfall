import { describe, expect, it } from 'vitest'
import { blank, type Rgba } from './png'
import { type SliceOptions, type SliceResult, sliceSheet } from './slice-sheet'

/** Native art: one row per pixel row, an RGB number per pixel, null for transparent. */
type Art = (number | null)[][]

const TOP = 0x3080e0
const BOTTOM = 0xe0c040
const FRINGE = 0x806080
const BURST = 0xffd040

/** A filled ellipse touching all four edges, outlined in black `thick` pixels deep. */
function blob(w: number, h: number, thick = 1, outline = 0x000000): Art {
  const inside = (x: number, y: number) =>
    x >= 0 &&
    y >= 0 &&
    x < w &&
    y < h &&
    ((x - (w - 1) / 2) / (w / 2)) ** 2 + ((y - (h - 1) / 2) / (h / 2)) ** 2 <= 1
  const edge = (x: number, y: number) => {
    for (let d = 1; d <= thick; d++) {
      if (!inside(x - d, y) || !inside(x + d, y) || !inside(x, y - d) || !inside(x, y + d)) {
        return true
      }
    }
    return false
  }
  return Array.from({ length: h }, (_, y) =>
    Array.from({ length: w }, (_, x) => {
      if (!inside(x, y)) return null
      if (edge(x, y)) return outline
      return y < h / 2 ? TOP : BOTTOM
    }),
  )
}

function magenta(w: number, h: number): Rgba {
  const img = blank(w, h)
  for (let i = 0; i < img.data.length; i += 4) img.data.set([255, 0, 255, 255], i)
  return img
}

/** Draws `art` at block size `b` with its top-left corner at (x0, y0); each sheet pixel takes
 * the native pixel under its centre. */
function draw(sheet: Rgba, art: Art, x0: number, y0: number, b: number): void {
  const h = art.length
  const w = art[0]?.length ?? 0
  for (let y = Math.floor(y0); y < Math.ceil(y0 + h * b); y++) {
    for (let x = Math.floor(x0); x < Math.ceil(x0 + w * b); x++) {
      const v = art[Math.floor((y + 0.5 - y0) / b)]?.[Math.floor((x + 0.5 - x0) / b)]
      if (v === undefined || v === null) continue
      sheet.data.set([v >> 16, (v >> 8) & 0xff, v & 0xff, 255], (y * sheet.width + x) * 4)
    }
  }
}

function fill(sheet: Rgba, x0: number, y0: number, w: number, h: number, rgb: number): void {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      sheet.data.set([rgb >> 16, (rgb >> 8) & 0xff, rgb & 0xff, 255], (y * sheet.width + x) * 4)
    }
  }
}

function toArt(img: Rgba): Art {
  return Array.from({ length: img.height }, (_, y) =>
    Array.from({ length: img.width }, (_, x) => {
      const i = (y * img.width + x) * 4
      if (img.data[i + 3] === 0) return null
      return ((img.data[i] ?? 0) << 16) | ((img.data[i + 1] ?? 0) << 8) | (img.data[i + 2] ?? 0)
    }),
  )
}

/** `art` placed bottom-centred on an n × n canvas. */
function padded(art: Art, n: number): Art {
  const h = art.length
  const w = art[0]?.length ?? 0
  const ox = Math.floor((n - w) / 2)
  const oy = n - h
  return Array.from({ length: n }, (_, y) =>
    Array.from({ length: n }, (_, x) => art[y - oy]?.[x - ox] ?? null),
  )
}

function ok(r: SliceResult | undefined): Extract<SliceResult, { art: Rgba }> {
  if (r === undefined || 'error' in r)
    throw new Error(`expected a sprite, got ${JSON.stringify(r)}`)
  return r
}

const opts = (o: Partial<SliceOptions> & Pick<SliceOptions, 'cols' | 'rows'>): SliceOptions => ({
  row: null,
  colours: 4,
  size: 16,
  fit: null,
  ...o,
})

describe('sliceSheet', () => {
  it('finds rows by their gutters, so sprites past the equal-cell lines come back whole', () => {
    const sheet = magenta(400, 300)
    const big = blob(16, 16)
    const small = blob(10, 10)
    // Row 0 hangs 15 px past y = 100; row 2 starts 10 px above y = 200.
    for (const x of [30, 230]) {
      draw(sheet, big, x, 19, 6)
      draw(sheet, small, x, 125, 6)
      draw(sheet, big, x, 190, 6)
    }
    const out = sliceSheet(sheet, opts({ cols: 2, rows: 3 }))
    expect(out).toHaveLength(6)
    const expected = [big, big, small, small, big, big]
    out.forEach((r, i) => {
      expect(toArt(ok(r).native)).toEqual(expected[i])
      expect(ok(r).block).toBeCloseTo(6, 1)
    })
  })

  it('keeps a detached burst inside the column gap with its sprite', () => {
    const sheet = magenta(400, 140)
    const art = blob(16, 16)
    draw(sheet, art, 20, 20, 6)
    // 2 × 2 art pixels, one art pixel (6 px) right of the sprite.
    fill(sheet, 122, 62, 12, 12, BURST)
    draw(sheet, art, 230, 20, 6)
    const out = sliceSheet(sheet, opts({ cols: 2, rows: 1 }))
    expect(out).toHaveLength(2)
    const native = toArt(ok(out[0]).native)
    expect(native[0]).toHaveLength(19)
    expect(native[7]?.slice(17)).toEqual([BURST, BURST])
    expect(native[8]?.slice(17)).toEqual([BURST, BURST])
    expect(toArt(ok(out[1]).native)).toEqual(art)
  })

  it('recovers a blob drawn at a fractional block size beside a fringe', () => {
    const sheet = magenta(160, 160)
    const art = blob(16, 16)
    const b = 7.3
    draw(sheet, art, 13.4, 21.7, b)
    // A 2 px non-key fringe down the blob's right side.
    fill(sheet, Math.ceil(13.4 + 16 * b), 22, 2, 116, FRINGE)
    const r = ok(sliceSheet(sheet, opts({ cols: 1, rows: 1 }))[0])
    expect(r.block).toBeCloseTo(b, 0)
    expect(toArt(r.art)).toEqual(art)
  })

  it('shrinks a large blob to its canvas with a black outline on every edge', () => {
    const sheet = magenta(260, 260)
    draw(sheet, blob(20, 20), 30, 30, 10)
    const r = ok(sliceSheet(sheet, opts({ cols: 1, rows: 1 }))[0])
    expect(r.art.width).toBe(16)
    expect(r.art.height).toBe(16)
    const art = toArt(r.art)
    art.forEach((row, y) => {
      row.forEach((v, x) => {
        if (v === null) return
        const nearEmpty = [art[y - 1]?.[x], art[y + 1]?.[x], row[x - 1], row[x + 1]].some(
          (n) => n === null,
        )
        if (nearEmpty) expect(v, `pixel ${x},${y}`).toBe(0x000000)
      })
    })
  })

  it('pads a small blob bottom-centred without upscaling it', () => {
    const sheet = magenta(200, 200)
    const art = blob(12, 10)
    draw(sheet, art, 40, 50, 8)
    const r = ok(sliceSheet(sheet, opts({ cols: 1, rows: 1 }))[0])
    expect(toArt(r.art)).toEqual(padded(art, 16))
  })

  it("replaces a block size far from the sheet's median with the median", () => {
    const sheet = magenta(800, 200)
    for (const x of [20, 220, 420]) draw(sheet, blob(16, 16), x, 20, 10)
    draw(sheet, blob(16, 16, 2), 620, 20, 10)
    const out = sliceSheet(sheet, opts({ cols: 4, rows: 1 }))
    const odd = ok(out[3])
    expect(odd.block).toBe(10)
    expect(odd.fromMedian).toBe(true)
    expect(ok(out[0]).fromMedian).toBe(false)
    expect(toArt(odd.native)).toEqual(blob(16, 16, 2))
  })

  it('reports a sprite without an outline and still slices its neighbours', () => {
    const sheet = magenta(600, 140)
    draw(sheet, blob(16, 16), 20, 20, 6)
    draw(sheet, blob(16, 16, 1, 0x40a060), 220, 20, 6)
    draw(sheet, blob(16, 16), 420, 20, 6)
    const out = sliceSheet(sheet, opts({ cols: 3, rows: 1 }))
    expect(out[1]).toEqual({ error: 'no outline found' })
    expect(toArt(ok(out[0]).native)).toEqual(blob(16, 16))
    expect(toArt(ok(out[2]).native)).toEqual(blob(16, 16))
  })

  it('errors every sprite of a sheet whose rows touch', () => {
    const sheet = magenta(400, 260)
    draw(sheet, blob(16, 16), 20, 10, 6)
    draw(sheet, blob(16, 16), 220, 10, 6)
    draw(sheet, blob(16, 16), 20, 140, 6)
    draw(sheet, blob(16, 16), 220, 140, 6)
    // A bridge from the top-left sprite down to the one below it.
    fill(sheet, 60, 100, 6, 45, TOP)
    const out = sliceSheet(sheet, opts({ cols: 2, rows: 2 }))
    expect(out).toHaveLength(4)
    for (const r of out) {
      expect(r).toEqual({ error: expect.stringContaining('sprites touch, no gutter') })
    }
  })

  it('keeps a purple sprite whole: only the near-pure magenta of the ground is key', () => {
    const sheet = magenta(200, 200)
    const art = blob(16, 16).map((row) =>
      row.map((v) => (v === TOP ? 0x8000c0 : v === BOTTOM ? 0x9000d0 : v)),
    )
    draw(sheet, art, 40, 40, 7)
    // An anti-aliased pink fringe between the sprite and the ground is still key.
    fill(sheet, 40, 33, 112, 2, 0xf880f8)
    expect(toArt(ok(sliceSheet(sheet, opts({ cols: 1, rows: 1 }))[0]).native)).toEqual(art)
  })

  it('keeps one row with --row', () => {
    const sheet = magenta(400, 260)
    draw(sheet, blob(16, 16), 20, 10, 6)
    draw(sheet, blob(16, 16), 220, 10, 6)
    draw(sheet, blob(12, 10), 20, 160, 6)
    draw(sheet, blob(12, 10), 220, 160, 6)
    const out = sliceSheet(sheet, opts({ cols: 2, rows: 2, row: 1 }))
    expect(out).toHaveLength(2)
    for (const r of out) expect(toArt(ok(r).native)).toEqual(blob(12, 10))
  })

  describe('the 1.5× cut', () => {
    it('shrinks a large native to 24 on its long side on the 24 × 24 canvas', () => {
      const sheet = magenta(360, 360)
      draw(sheet, blob(30, 30), 30, 30, 10)
      const r = ok(sliceSheet(sheet, opts({ cols: 1, rows: 1 }))[0])
      expect(r.hires.width).toBe(24)
      expect(r.hires.height).toBe(24)
      const art = toArt(r.hires)
      expect(art[0]?.some((v) => v !== null)).toBe(true)
      expect(art.map((row) => row[0]).some((v) => v !== null)).toBe(true)
      expect(r.art.width).toBe(16)
    })

    it('pads a small native bottom-centred on the 24 × 24 canvas without upscaling it', () => {
      const sheet = magenta(200, 200)
      const art = blob(12, 10)
      draw(sheet, art, 40, 50, 8)
      const r = ok(sliceSheet(sheet, opts({ cols: 1, rows: 1 }))[0])
      expect(toArt(r.hires)).toEqual(padded(art, 24))
    })

    it('fits --fit sprites in the 1.5× box, unpadded', () => {
      const sheet = magenta(500, 340)
      draw(sheet, blob(60, 40), 30, 30, 6)
      const r = ok(
        sliceSheet(
          sheet,
          opts({ cols: 1, rows: 1, size: null, fit: { width: 48, height: 34 } }),
        )[0],
      )
      expect(r.hires.width).toBe(60)
      expect(r.hires.height).toBe(40)
      expect(r.art.width).toBeLessThanOrEqual(48)
    })

    it('shrinks a --fit native larger than the 1.5× box into it', () => {
      const sheet = magenta(620, 440)
      draw(sheet, blob(100, 70), 10, 10, 6)
      const r = ok(
        sliceSheet(
          sheet,
          opts({ cols: 1, rows: 1, size: null, fit: { width: 48, height: 34 } }),
        )[0],
      )
      expect(r.hires.width).toBeLessThanOrEqual(72)
      expect(r.hires.height).toBeLessThanOrEqual(51)
      expect(Math.max(r.hires.width / 72, r.hires.height / 51)).toBeCloseTo(1, 1)
    })

    it('holds at most 16 colours whatever --colours says', () => {
      const sheet = magenta(260, 260)
      const art = blob(20, 20).map((row, y) =>
        row.map((v, x) =>
          v === null || v === 0 ? v : (((x * 12) % 256) << 16) | ((y * 12) << 8) | 0x40,
        ),
      )
      draw(sheet, art, 30, 30, 10)
      const r = ok(sliceSheet(sheet, opts({ cols: 1, rows: 1, colours: 4 }))[0])
      const colours = new Set(
        toArt(r.hires)
          .flat()
          .filter((v) => v !== null),
      )
      expect(
        new Set(
          toArt(r.native)
            .flat()
            .filter((v) => v !== null),
        ).size,
      ).toBeGreaterThan(30)
      expect(colours.size).toBeLessThanOrEqual(16)
      expect(colours.size).toBeGreaterThan(4)
    })
  })
})
