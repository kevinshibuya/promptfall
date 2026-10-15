import { expect, test } from 'claude-code/testing'
import { type Box, cellsOf, imageScaleFor, layoutFor } from './layout'
import { IMAGE_MAX_SIDE, IMAGE_SCALE, RASTER_MIN_ROWS, STAGE_MIN_ROWS } from './tuning'

const TERMINAL = { extra: 0 } as const

test('the full layout fits the stage rows plus the 5-row strip', () => {
  expect(layoutFor(8, { bodyColumns: 120, maxRows: 20 }, 'terminal', TERMINAL)).toEqual({
    kind: 'full',
    box: { columns: 120, rows: 8 },
    bandRows: 13,
  })
  expect(layoutFor(17, { bodyColumns: 120, maxRows: 22 }, 'terminal', TERMINAL)).toEqual({
    kind: 'full',
    box: { columns: 120, rows: 17 },
    bandRows: 22,
  })
  expect(layoutFor(8, { bodyColumns: 200, maxRows: 20 }, 'terminal', TERMINAL).box?.columns).toBe(
    160,
  )
  expect(layoutFor(8, { bodyColumns: 120, maxRows: 20 }, 'terminal', { extra: 1 }).bandRows).toBe(
    14,
  )
})

test('too short or too narrow falls back to a 6-row compact band, then one row', () => {
  expect(layoutFor(17, { bodyColumns: 120, maxRows: 11 }, 'terminal', TERMINAL)).toEqual({
    kind: 'compact',
    box: { columns: 52, rows: 4 },
    bandRows: 6,
  })
  expect(layoutFor(8, { bodyColumns: 115, maxRows: 20 }, 'terminal', TERMINAL).kind).toBe('compact')
  expect(layoutFor(8, { bodyColumns: 99, maxRows: 20 }, 'terminal', TERMINAL)).toEqual({
    kind: 'collapsed',
    box: null,
    bandRows: 1,
  })
  // Grill 1.17: compact needs its 6 rows.
  expect(layoutFor(8, { bodyColumns: 120, maxRows: 5 }, 'terminal', TERMINAL).kind).toBe(
    'collapsed',
  )
  expect(layoutFor(8, { bodyColumns: 120, maxRows: 6 }, 'terminal', TERMINAL).kind).toBe('compact')
})

test('a Raster stage too tall for the band keeps its size and shows its bottom rows, down to 8 (ADR 0010)', () => {
  // A 17-row stage on a 16-row band: 11 rows left above the strip, the sky's 6 rows cropped.
  expect(layoutFor(17, { bodyColumns: 144, maxRows: 16 }, 'terminal', TERMINAL)).toEqual({
    kind: 'full',
    box: { columns: 144, rows: 17 },
    cells: { columns: 144, rows: 11 },
    bandRows: 16,
  })
  // The same on a Raster, and with rung (c)'s extra row: 10 rows left.
  expect(layoutFor(17, { bodyColumns: 144, maxRows: 16 }, 'terminal', { extra: 1 })).toEqual({
    kind: 'full',
    box: { columns: 144, rows: 17 },
    cells: { columns: 144, rows: 10 },
    bandRows: 16,
  })
  // Exactly the actors' height left: still full.
  expect(cellsOf(layoutFor(17, { bodyColumns: 144, maxRows: 13 }, 'terminal', TERMINAL))).toEqual({
    columns: 144,
    rows: 8,
  })
  // Room for the whole stage: no cells, as before.
  expect(layoutFor(17, { bodyColumns: 144, maxRows: 22 }, 'terminal', TERMINAL)).toEqual({
    kind: 'full',
    box: { columns: 144, rows: 17 },
    bandRows: 22,
  })
  // Under the actors' height, or too narrow, it is compact as before.
  expect(layoutFor(17, { bodyColumns: 144, maxRows: 12 }, 'terminal', TERMINAL).kind).toBe(
    'compact',
  )
  expect(layoutFor(17, { bodyColumns: 115, maxRows: 20 }, 'terminal', TERMINAL).kind).toBe(
    'compact',
  )
})

test('an Image stage too tall for the band zooms the whole scene out and never crops', () => {
  const boss = { extra: 0, minRows: 17, scalable: true } as const
  // The Image never crops: at rest on a 16-row band it zooms out just as with a boss.
  expect(
    layoutFor(17, { bodyColumns: 144, maxRows: 16 }, 'terminal', { ...boss, minRows: 8 }),
  ).toMatchObject({
    kind: 'full',
    box: { columns: 223, rows: 17 },
    cells: { columns: 144, rows: 11 },
  })
  // The Image widens the scene to 223 columns, which 11 rows of it span at the band's 144,
  // so nothing is cropped and the boss stays whole.
  expect(layoutFor(17, { bodyColumns: 144, maxRows: 16 }, 'terminal', boss)).toEqual({
    kind: 'full',
    box: { columns: 223, rows: 17 },
    cells: { columns: 144, rows: 11 },
    bandRows: 16,
  })
  // Under the compact stage's 4 rows the Image is compact too.
  expect(layoutFor(17, { bodyColumns: 144, maxRows: 8 }, 'terminal', boss).kind).toBe('compact')
})

test(`the Raster crops the sky to the tallest actor, then zooms down to ${RASTER_MIN_ROWS} rows, then is compact (#230)`, () => {
  const at = (maxRows: number, minRows: number) =>
    layoutFor(17, { bodyColumns: 144, maxRows }, 'terminal', { extra: 0, minRows })
  // A zone or world boss on a 15-row band: 10 rows left, under its 17. The whole 17-row scene,
  // widened to 245 columns so its ratio holds, zooms into the 10 rows at the band's 144.
  expect(at(15, 17)).toEqual({
    kind: 'full',
    box: { columns: 245, rows: 17 },
    cells: { columns: 144, rows: 10 },
    bandRows: 15,
  })
  // On a 13-row band the 8 rows left are the floor: still zoomed.
  expect(at(13, 17)).toEqual({
    kind: 'full',
    box: { columns: 306, rows: 17 },
    cells: { columns: 144, rows: 8 },
    bandRows: 13,
  })
  // Under the floor, compact.
  expect(at(12, 17).kind).toBe('compact')
  // A turn boss on a 17-row band: 12 rows left meet its height, so it is cropped at full size.
  expect(at(17, 12)).toEqual({
    kind: 'full',
    box: { columns: 144, rows: 17 },
    cells: { columns: 144, rows: 12 },
    bandRows: 17,
  })
  // With 8 to 11 rows left it crops to its 12 and zooms the rest: the box is the cropped scene.
  expect(at(15, 12)).toEqual({
    kind: 'full',
    box: { columns: 173, rows: 12 },
    cells: { columns: 144, rows: 10 },
    bandRows: 15,
  })
  expect(at(13, 12)).toMatchObject({ box: { rows: 12 }, cells: { columns: 144, rows: 8 } })
  expect(at(12, 12).kind).toBe('compact')
  // A wave fight's crop floor is the zoom's: it crops at full size down to 8 and never zooms.
  expect(at(13, STAGE_MIN_ROWS)).toEqual({
    kind: 'full',
    box: { columns: 144, rows: 17 },
    cells: { columns: 144, rows: 8 },
    bandRows: 13,
  })
  expect(at(12, STAGE_MIN_ROWS).kind).toBe('compact')
  // Every zoom keeps the scene's ratio: the cells are the box scaled by one factor.
  for (const maxRows of [13, 14, 15, 16, 17, 18, 19, 20, 21]) {
    for (const minRows of [12, 17]) {
      const layout = at(maxRows, minRows)
      if (layout.kind !== 'full' || !layout.cells || layout.cells.columns === layout.box.columns)
        continue
      const ratio = (b: Box) => b.columns / b.rows
      expect(Math.abs(ratio(layout.cells) / ratio(layout.box) - 1)).toBeLessThan(0.01)
    }
  }
  // Too narrow for the full stage, compact as before.
  expect(
    layoutFor(17, { bodyColumns: 115, maxRows: 15 }, 'terminal', {
      extra: 0,
      minRows: 17,
    }).kind,
  ).toBe('compact')
})

test('an Image boss under a tall prompt still spans the band (#21)', () => {
  const boss = { extra: 0, minRows: 17, scalable: true } as const
  // 5 rows left under the strip: the scene widens to 490 columns so 5 rows of it span 144.
  const layout = layoutFor(17, { bodyColumns: 144, maxRows: 10 }, 'terminal', boss)
  expect(layout).toEqual({
    kind: 'full',
    box: { columns: 490, rows: 17 },
    cells: { columns: 144, rows: 5 },
    bandRows: 10,
  })
  // Its picture stays within the host's 2048 px a side: the pre-upscale drops below 6.
  const scale = imageScaleFor(490)
  expect(scale).toBeLessThan(IMAGE_SCALE)
  expect(490 * scale).toBeLessThanOrEqual(IMAGE_MAX_SIDE)
  // A stage at the band's own width keeps the crisp 6.
  expect(imageScaleFor(160)).toBe(IMAGE_SCALE)
})

test('Loot and World lay out as Party does: the layout takes no tab, so the stage stays on every tab', () => {
  // A tab is no input: the band's height is a function of the terminal and the stage alone.
  const loot = layoutFor(17, { bodyColumns: 120, maxRows: 22 }, 'terminal', {
    // @ts-expect-error the layout has no tab to read
    tab: 'loot',
    extra: 0,
  })
  expect(loot).toEqual({ kind: 'full', box: { columns: 120, rows: 17 }, bandRows: 22 })
  expect(loot).toEqual(layoutFor(17, { bodyColumns: 120, maxRows: 22 }, 'terminal', TERMINAL))
})

test('the desktop always draws the full stage, the art at least 116 and at most 160 wide', () => {
  const desk = { extra: 1 } as const
  expect(layoutFor(8, { bodyColumns: 95, maxRows: 12 }, 'desktop', desk)).toEqual({
    kind: 'full',
    box: { columns: 116, rows: 8 },
    bandRows: 14,
  })
  expect(layoutFor(17, { bodyColumns: 60, maxRows: 12 }, 'desktop', desk).box).toEqual({
    columns: 116,
    rows: 17,
  })
  expect(layoutFor(8, { bodyColumns: 130, maxRows: 12 }, 'desktop', desk).box?.columns).toBe(130)
  expect(layoutFor(8, { bodyColumns: 200, maxRows: 3 }, 'desktop', desk).box?.columns).toBe(160)
  // However short, and on every tab: the desktop scales the band (ADR 0004).
  expect(layoutFor(8, { bodyColumns: 95, maxRows: 2 }, 'desktop', desk).kind).toBe('full')
  expect(layoutFor(8, { bodyColumns: 95, maxRows: 12 }, 'vscode', desk)).toEqual(
    layoutFor(8, { bodyColumns: 95, maxRows: 12 }, 'desktop', desk),
  )
})
