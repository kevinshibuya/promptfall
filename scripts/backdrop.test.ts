import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { backdropFrom, cutBackdrop, fitCanvas, paintedBand, quantise, resample } from './backdrop'
import { blank, type Rgba, readPng, rgbOf, writePng } from './png'

const KEY = 0xff00ff
function sheet(width: number, height: number, colour: (x: number, y: number) => number): Rgba {
  const img = blank(width, height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const c = colour(x, y)
      img.data.set([(c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff, 255], (y * width + x) * 4)
    }
  }
  return img
}
const at = (img: Rgba, x: number, y: number) => rgbOf(img.data, (y * img.width + x) * 4)

describe('backdrop', () => {
  it('writes one 1.5x PNG and reports one cut from the CLI', () => {
    const dir = mkdtempSync(join(tmpdir(), 'backdrop-'))
    try {
      const source = join(dir, 'sheet.png')
      const out = join(dir, 'art')
      writePng(
        source,
        sheet(8, 4, (_, y) => (y < 2 ? KEY : 0x557733)),
      )
      const report = execFileSync(
        process.execPath,
        [
          '--import',
          'tsx',
          join(import.meta.dirname, 'backdrop.ts'),
          source,
          '--zone',
          '1',
          '--out',
          out,
        ],
        { encoding: 'utf8' },
      )
      expect(readdirSync(out)).toEqual(['backdrops-hires'])
      expect(readdirSync(join(out, 'backdrops-hires'))).toEqual(['zone-1.png'])
      const painting = readPng(join(out, 'backdrops-hires', 'zone-1.png'))
      expect([painting.width, painting.height]).toEqual([240, 51])
      expect(report.trim().split('\n')).toEqual([
        'band: x 0..8, y 2..4 (8 x 2)',
        '1.5x: resampled 240 x 60 into 240 x 51, 1 colours',
        join(out, 'backdrops-hires', 'zone-1.png'),
      ])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('finds the painted band inside the magenta key', () => {
    const s = sheet(100, 60, (x, y) => (y >= 20 && y < 50 && x >= 5 && x < 95 ? 0x336633 : KEY))
    expect(paintedBand(s)).toEqual({ x0: 5, y0: 20, x1: 95, y1: 50 })
    expect(paintedBand(sheet(4, 4, () => KEY))).toBe(null)
  })

  it('resamples by block vote or block mean, leaving key pixels out', () => {
    // Two columns of 4 × 4 blocks: the left dark, the right light with one key pixel and one
    // stray lighter pixel: the vote keeps the block's colour, the mean drifts.
    const s = sheet(8, 4, (x) => (x < 4 ? 0x202020 : 0x606060))
    s.data.set([255, 0, 255, 255], (1 * 8 + 5) * 4)
    s.data.set([0x70, 0x70, 0x70, 255], (2 * 8 + 6) * 4)
    const vote = resample(s, { x0: 0, y0: 0, x1: 8, y1: 4 }, 2, 1, { sample: 'vote', colours: 16 })
    expect([at(vote, 0, 0), at(vote, 1, 0)]).toEqual([0x202020, 0x606060])
    const mean = resample(s, { x0: 0, y0: 0, x1: 8, y1: 4 }, 2, 1, { sample: 'mean', colours: 16 })
    expect([at(mean, 0, 0), at(mean, 1, 0)]).toEqual([0x202020, 0x616161])
    // The snap folds the stray pixel into the palette when the limit is tight.
    const snapped = resample(s, { x0: 0, y0: 0, x1: 8, y1: 4 }, 2, 1, {
      sample: 'vote',
      colours: 2,
    })
    expect([at(snapped, 0, 0), at(snapped, 1, 0)]).toEqual([0x202020, 0x616161])
  })

  it('fits a canvas from the bottom-centre: cropping, or extending the edges', () => {
    const img = sheet(4, 2, (x, y) => 0x010101 * (1 + y * 4 + x))
    const grown = fitCanvas(img, 6, 4)
    expect([grown.width, grown.height]).toEqual([6, 4])
    expect(at(grown, 0, 0)).toBe(0x010101 * 1)
    expect(at(grown, 1, 2)).toBe(0x010101 * 1)
    expect(at(grown, 5, 3)).toBe(0x010101 * 8)
    const cut = fitCanvas(img, 2, 1)
    expect(at(cut, 0, 0)).toBe(0x010101 * (1 + 4 + 1))
  })

  it('quantises to at most n colours', () => {
    const img = sheet(16, 1, (x) => 0x010101 * (x * 16))
    const q = quantise(img, 4)
    expect(q.palette.length).toBeLessThanOrEqual(4)
    const used = new Set<number>()
    for (let x = 0; x < 16; x++) used.add(at(q.image, x, 0))
    expect(used.size).toBeLessThanOrEqual(4)
    for (const c of used) expect(q.palette).toContain(c)
  })

  it('cuts only the 1.5x painting from a sheet: fit by width, the sky extended or cropped', () => {
    // A 1536 × 1024 sheet with a 1536 × 240 band: fitting 240 wide leaves 38 rows, extended to 51.
    const s = sheet(1536, 1024, (_, y) =>
      y >= 600 && y < 840 ? (y < 700 ? 0x8899cc : 0x557733) : KEY,
    )
    const out = backdropFrom(s, { fit: 'width', colours: 16, sample: 'vote' })
    if ('error' in out) throw new Error(out.error)
    expect([out.hires.width, out.hires.height]).toEqual([240, 51])
    expect(out).not.toHaveProperty('full')
    expect(out.report).toEqual([
      'band: x 0..1536, y 600..840 (1536 x 240)',
      '1.5x: resampled 240 x 38 into 240 x 51, 2 colours',
    ])
    expect(at(out.hires, 0, 0)).toBe(0x8899cc)
    expect(at(out.hires, 239, 50)).toBe(0x557733)
    // Fit by height: wider than the canvas, cropped from the centre.
    const byHeight = cutBackdrop(s, { x0: 0, y0: 600, x1: 1536, y1: 840 }, 240, 51, {
      fit: 'height',
      colours: 16,
      sample: 'vote',
    })
    expect(byHeight.resampled).toEqual({ width: 326, height: 51 })
    expect([byHeight.image.width, byHeight.image.height]).toEqual([240, 51])
  })
})
