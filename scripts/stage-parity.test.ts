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
  it('writes the strike, spawn, chest, haste, guard and camp sheets', () => {
    expect(SHEETS.map((s) => s.name)).toEqual([
      'strike',
      'spawn',
      'chest',
      'haste',
      'guard',
      'camp',
    ])
  })

  it("stages guard's huddle in from its start to its end, then the hit on the shield", () => {
    const guard = SHEETS.find((s) => s.name === 'guard')
    const columns = columnsOf(guard ?? { name: '', stretches: [] })
    expect(columns.map((col) => col.head)).toEqual([
      'huddle 0ms',
      'huddle 40ms',
      'huddle 80ms',
      'huddle 120ms',
      'huddle 160ms',
      'huddle 200ms',
      'step 0ms',
      'step 100ms',
      'step 200ms',
      'step 300ms',
      'step 400ms',
      'step 500ms',
    ])
    const huddling = columns[0]?.staged.motions.find((m) => m.kind === 'huddle')
    expect(huddling && 'dir' in huddling ? huddling.dir : undefined).toBe('in')
    const striking = columns[INSTANTS.length + 3]?.staged.motions.find((m) => m.kind === 'strike')
    expect(striking?.actor).toBe('e1')
  })

  it('stages the enemies walking off as camp is made, then walking back in as it breaks', () => {
    const camp = SHEETS.find((s) => s.name === 'camp')
    const columns = columnsOf(camp ?? { name: '', stretches: [] })
    expect(columns).toHaveLength(INSTANTS.length * 2)
    expect(columns[0]?.head).toBe('camp_leave 0ms')
    expect(columns[INSTANTS.length - 1]?.head).toBe('camp_leave 360ms')
    expect(columns[INSTANTS.length]?.head).toBe('camp_return 0ms')
    expect(columns.at(-1)?.head).toBe('camp_return 360ms')
    expect(columns[0]?.staged.model.box).toEqual(columns.at(-1)?.staged.model.box)
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

  it('stages haste over two hasted bob frames, its desktop row labelled static', () => {
    const haste = SHEETS.find((s) => s.name === 'haste')
    const columns = columnsOf(haste ?? { name: '', stretches: [] })
    const c = caseOf('haste')
    expect(columns.map((col) => col.staged.now - c.from)).toEqual([0, 100, 200, 300, 400, 500])
    expect(columns[0]?.head).toBe('haste 0ms')
    expect(haste?.desktop).toBe('desktop (static)')
    expect(SHEETS.find((s) => s.name === 'strike')?.desktop).toBeUndefined()
  })

  it('stages a fixed span of a scenario from its events at the fixed instants', () => {
    const columns = columnsOf({ name: 'rest', stretches: [{ scenario: 'rest', span: 1000 }] })
    const c = caseOf('rest')
    expect(columns.map((col) => col.staged.now - c.from)).toEqual([0, 200, 400, 600, 800, 1000])
    expect(columns.map((col) => col.head)).toEqual([
      'rest 0ms',
      'rest 200ms',
      'rest 400ms',
      'rest 600ms',
      'rest 800ms',
      'rest 1000ms',
    ])
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

  it('widens the gutter to the longest label, so the frames start past it', () => {
    const red = frame(1, 16, Array.from({ length: 16 }, () => [255, 0, 0, 255]).flat())
    const short = contactSheet(['a'], [{ label: 'desktop', frames: [red] }])
    const long = contactSheet(['a'], [{ label: 'desktop (static)', frames: [red] }])
    expect(long.layout.label).toBeGreaterThan(short.layout.label)
    // Past the label's 16 glyphs, the frame's one red column.
    expect(long.png.width).toBe(long.layout.label + 1)
    expect(long.layout.label).toBeGreaterThanOrEqual(16 * 8)
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
