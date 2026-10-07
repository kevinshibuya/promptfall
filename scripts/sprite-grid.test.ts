import { describe, expect, it } from 'vitest'
import { blank } from './png'
import { fromGrid, toGrid } from './sprite-grid'

describe('sprite grid', () => {
  it('round-trips a 3-colour sprite pixel for pixel', () => {
    const img = blank(4, 3)
    const set = (x: number, y: number, rgb: number) =>
      img.data.set([rgb >> 16, (rgb >> 8) & 0xff, rgb & 0xff, 255], (y * 4 + x) * 4)
    for (let x = 0; x < 4; x++) set(x, 0, 0x000000)
    set(1, 1, 0xd03030)
    set(2, 1, 0x3060c0)
    set(0, 2, 0x000000)
    set(3, 2, 0xd03030)
    const text = toGrid(img)
    expect(text).toBe(
      ['0 #000000', '1 #3060c0', '2 #d03030', '', '0000', '.21.', '0..2', ''].join('\n'),
    )
    expect(fromGrid(text)).toEqual(img)
  })

  it('throws on a ragged row, naming its line', () => {
    expect(() => fromGrid(['0 #000000', '', '00', '0', ''].join('\n'))).toThrow(/line 4/)
  })

  it('throws on a character missing from the legend, naming its line', () => {
    expect(() => fromGrid(['0 #000000', '', '00', '0x', ''].join('\n'))).toThrow(/line 4/)
  })
})
