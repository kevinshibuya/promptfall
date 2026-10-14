import { describe, expect, it } from 'vitest'
import type { Frame } from '../plugins/promptfall/hooks/stage/compose'
import { caseOf } from '../plugins/promptfall/hooks/stage/scenarios'
import { BG, columnsOf, contactSheet, INSTANTS, imageRow, SHEETS } from './stage-parity'

const frame = (width: number, height: number, rgba: number[]): Frame => ({
  width,
  height,
  rgba: Uint8ClampedArray.from(rgba),
})

describe('stage-parity', () => {
  it('writes the strike, spawn and chest sheets', () => {
    expect(SHEETS.map((s) => s.name)).toEqual(['strike', 'spawn', 'chest'])
  })

  it("stages the knight's attack from its start to its end at the fixed instants", () => {
    const strike = SHEETS.find((s) => s.name === 'strike')
    const columns = columnsOf(strike ?? { name: '', stretches: [] })
    const c = caseOf('strike')
    expect(columns.map((col) => col.staged.now - c.from)).toEqual([0, 100, 200, 300, 400, 500])
    expect(columns.map((col) => col.head)).toEqual([
      'step 0ms',
      'step 100ms',
      'step 200ms',
      'step 300ms',
      'step 400ms',
      'step 500ms',
    ])
  })

  it('stages the dissolve through its fade, then the spawn that follows it through its own', () => {
    const spawn = SHEETS.find((s) => s.name === 'spawn')
    const columns = columnsOf(spawn ?? { name: '', stretches: [] })
    expect(columns).toHaveLength(INSTANTS.length * 2)
    expect(columns[0]?.head).toBe('dissolve 0ms')
    expect(columns.at(-1)?.head).toBe('spawn 360ms')
    const fading = columns[2]?.staged.motions.find((m) => m.kind === 'dissolve')
    expect(fading?.actor).toBe('e1')
    const entering = columns[INSTANTS.length + 2]?.staged.motions.find((m) => m.kind === 'spawn')
    expect(entering?.actor).toBe('e4')
  })

  it('stages the chest from its fall to the end of its reveal', () => {
    const chest = SHEETS.find((s) => s.name === 'chest')
    const columns = columnsOf(chest ?? { name: '', stretches: [] })
    expect(columns[0]?.head).toBe('chest 0ms')
    expect(columns.at(-1)?.head).toBe('chest 3200ms')
  })

  it('scales the Image frame into the box the terminal shows it in, nearest pixel', () => {
    // 2 × 1: red, then clear; into 4 × 2.
    const f = imageRow(frame(2, 1, [255, 0, 0, 255, 0, 0, 0, 0]), 4, 2)
    expect([f.width, f.height]).toEqual([4, 2])
    expect([...f.rgba.slice(0, 16)]).toEqual([
      255, 0, 0, 255, 255, 0, 0, 255, 0, 0, 0, 0, 0, 0, 0, 0,
    ])
    expect([...f.rgba.slice(16, 20)]).toEqual([255, 0, 0, 255])
  })

  it('lays the rows under their heads beside their labels, the clear pixels on the background', () => {
    // Rows a glyph tall, so each label fits its row.
    const fill = (rgba: number[]) => frame(1, 16, Array.from({ length: 16 }, () => rgba).flat())
    const red = fill([255, 0, 0, 255])
    const clear = fill([0, 0, 0, 0])
    const s = contactSheet(
      ['a', 'b'],
      [
        { label: 'Image', frames: [red, clear] },
        { label: 'Raster', frames: [clear, red] },
        { label: 'desktop', frames: [red, red] },
      ],
    )
    const { label, head, gap } = s.layout
    expect(s.png.width).toBe(label + 2 + gap)
    expect(s.png.height).toBe(head + 3 * 16 + 2 * gap)
    const at = (x: number, y: number) => {
      const i = (y * s.png.width + x) * 4
      return [...s.png.data.slice(i, i + 4)]
    }
    const bg = [...BG, 255]
    expect(at(label, head)).toEqual([255, 0, 0, 255])
    expect(at(label + 1 + gap, head)).toEqual(bg)
    expect(at(label + 1 + gap, head + 16 + gap)).toEqual([255, 0, 0, 255])
    // Each row's label is drawn in its gutter, and each column's head above it.
    const lit = (x0: number, x1: number, y0: number, y1: number) => {
      for (let y = y0; y < y1; y++)
        for (let x = x0; x < x1; x++) if (at(x, y).join() !== bg.join()) return true
      return false
    }
    for (let r = 0; r < 3; r++) {
      const y = head + r * (16 + gap)
      expect(lit(0, label, y, y + 16), `row ${r}'s label`).toBe(true)
    }
    expect(lit(label, s.png.width, 0, head), "the columns' heads").toBe(true)
  })
})
