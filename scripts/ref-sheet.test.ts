import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { blank, readPng, rgbOf, writePng } from './png'
import { refSheet } from './ref-sheet'

const MAGENTA = 0xff00ff

/** A 24 × 24 sprite, opaque from row 2 to row 21 (bottom two rows transparent), columns 3..20. */
function sprite(rgb: number) {
  const img = blank(24, 24)
  for (let y = 2; y <= 21; y++) {
    for (let x = 3; x <= 20; x++) {
      img.data.set([(rgb >> 16) & 0xff, (rgb >> 8) & 0xff, rgb & 0xff, 255], (y * 24 + x) * 4)
    }
  }
  return img
}

describe('refSheet', () => {
  it('lays two sprites and a blank out bottom-centred, 24 px above the floor, at 7x', () => {
    const dir = mkdtempSync(join(tmpdir(), 'refsheet-'))
    mkdirSync(join(dir, 'sprites-hires', 'enemy'), { recursive: true })
    writePng(join(dir, 'sprites-hires', 'enemy', 'a.png'), sprite(0x112233))
    writePng(join(dir, 'sprites-hires', 'enemy', 'b.png'), sprite(0x445566))
    const out = join(dir, 'ref.png')
    refSheet(out, {
      columns: 3,
      cell: { width: 192, height: 256 },
      scale: 7,
      entries: ['enemy/a', 'enemy/b', 'blank'],
      art: dir,
    })
    const img = readPng(out)
    expect([img.width, img.height]).toEqual([576, 256])
    const at = (x: number, y: number) => rgbOf(img.data, (y * img.width + x) * 4)
    for (const [cell, rgb] of [
      [0, 0x112233],
      [1, 0x445566],
    ] as const) {
      const x0 = cell * 192
      // the 24 × 24 canvas is 168 wide, centred: it starts 12 px into the cell
      const opaqueXs: number[] = []
      const opaqueYs: number[] = []
      for (let y = 0; y < 256; y++) {
        for (let x = x0; x < x0 + 192; x++) {
          if (at(x, y) !== MAGENTA) {
            opaqueXs.push(x - x0)
            opaqueYs.push(y)
            expect(at(x, y)).toBe(rgb)
          }
        }
      }
      expect(Math.min(...opaqueXs)).toBe(12 + 3 * 7)
      expect(Math.max(...opaqueXs)).toBe(12 + 21 * 7 - 1)
      expect(Math.max(...opaqueYs)).toBe(231)
      expect(Math.min(...opaqueYs)).toBe(231 - 20 * 7 + 1)
    }
    for (let y = 0; y < 256; y++) {
      for (let x = 384; x < 576; x++) expect(at(x, y)).toBe(MAGENTA)
    }
  })
})
