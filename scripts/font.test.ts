import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { bakeGlyph, buildGlyphs, emitModule, loadFont, rowsOf, SET } from './font'

const FONT = loadFont(join(import.meta.dirname, '../art/fonts/misaki_gothic_2nd.ttf'))
const OUT = join(import.meta.dirname, '../plugins/promptfall/hooks/windows/glyphs.ts')

describe('font', () => {
  it('bakes H and 6 at rows 5-11 of the cell, as DQ V places its type', () => {
    const blank = '........'
    expect(rowsOf(bakeGlyph(FONT, 'H'))).toEqual([
      ...Array(5).fill(blank),
      '.#....#.',
      '.#....#.',
      '.#....#.',
      '.######.',
      '.#....#.',
      '.#....#.',
      '.#....#.',
      ...Array(4).fill(blank),
    ])
    const six = rowsOf(bakeGlyph(FONT, '6'))
    expect(six.slice(0, 5).every((r) => r === blank)).toBe(true)
    expect(six.slice(12).every((r) => r === blank)).toBe(true)
    expect(six.slice(5, 12).filter((r) => r !== blank)).toHaveLength(7)
  })

  it('bakes every printable ASCII character, · and …', () => {
    const glyphs = buildGlyphs(FONT)
    for (const ch of SET) expect(glyphs.has(ch), ch).toBe(true)
    for (let c = 0x21; c <= 0x7e; c++) {
      const g = glyphs.get(String.fromCharCode(c))
      expect(
        g?.some((b) => b !== 0),
        String.fromCharCode(c),
      ).toBe(true)
    }
    expect(glyphs.get(' ')?.every((b) => b === 0)).toBe(true)
    expect(glyphs.has('▶') && glyphs.has('▼') && glyphs.has('▾')).toBe(true)
  })

  it('bakes the bar: █ fills the type rows, ░ shades them, so the cells read as one track', () => {
    const glyphs = buildGlyphs(FONT)
    const full = rowsOf(glyphs.get('█') ?? new Uint8Array())
    expect(full.slice(5, 13)).toEqual(Array(8).fill('########'))
    const shade = rowsOf(glyphs.get('░') ?? new Uint8Array())
    const lit = shade
      .slice(5, 13)
      .join('')
      .split('')
      .filter((c) => c === '#').length
    expect(lit).toBeGreaterThan(0)
    expect(lit).toBeLessThan(32)
    expect([...shade.slice(0, 5), ...shade.slice(13)].every((r) => r === '........')).toBe(true)
  })

  it('fails on an outline point off the pixel grid, naming the character', () => {
    const off = {
      unitsPerEm: 2048,
      ascender: 1792,
      charToGlyph: () => ({
        index: 1,
        advanceWidth: 2048,
        path: {
          commands: [
            { type: 'M', x: 300, y: 0 },
            { type: 'L', x: 512, y: 0 },
            { type: 'L', x: 512, y: 512 },
            { type: 'Z' },
          ],
        },
      }),
    }
    expect(() => bakeGlyph(off as never, 'Q')).toThrow(/Q/)
  })

  it('fails on a missing glyph or an advance that is not 8 px', () => {
    const missing = { unitsPerEm: 2048, ascender: 1792, charToGlyph: () => ({ index: 0 }) }
    expect(() => bakeGlyph(missing as never, 'R')).toThrow(/R/)
    const wide = {
      unitsPerEm: 2048,
      ascender: 1792,
      charToGlyph: () => ({ index: 1, advanceWidth: 1024, path: { commands: [] } }),
    }
    expect(() => bakeGlyph(wide as never, 'S')).toThrow(/S/)
  })

  it('the committed module is what the script emits (pnpm font:check)', () => {
    expect(readFileSync(OUT, 'utf8')).toBe(emitModule(buildGlyphs(FONT)))
  })
})
