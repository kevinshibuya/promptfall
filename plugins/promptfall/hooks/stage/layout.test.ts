import { expect, test } from 'claude-code/testing'
import { cellsOf, imageScaleFor, layoutFor } from './layout'
import { IMAGE_MAX_SIDE, IMAGE_SCALE } from './tuning'

const PARTY = { tab: 'party', extra: 0 } as const

test('the full layout fits the stage rows plus the 5-row strip', () => {
  expect(layoutFor(8, { bodyColumns: 120, maxRows: 20 }, 'terminal', PARTY)).toEqual({
    kind: 'full',
    box: { columns: 120, rows: 8 },
    bandRows: 13,
  })
  expect(layoutFor(17, { bodyColumns: 120, maxRows: 22 }, 'terminal', PARTY)).toEqual({
    kind: 'full',
    box: { columns: 120, rows: 17 },
    bandRows: 22,
  })
  expect(layoutFor(8, { bodyColumns: 200, maxRows: 20 }, 'terminal', PARTY).box?.columns).toBe(160)
  expect(
    layoutFor(8, { bodyColumns: 120, maxRows: 20 }, 'terminal', { tab: 'party', extra: 1 })
      .bandRows,
  ).toBe(14)
})

test('too short or too narrow falls back to a 6-row compact band, then one row', () => {
  expect(layoutFor(17, { bodyColumns: 120, maxRows: 11 }, 'terminal', PARTY)).toEqual({
    kind: 'compact',
    box: { columns: 52, rows: 4 },
    bandRows: 6,
  })
  expect(layoutFor(8, { bodyColumns: 115, maxRows: 20 }, 'terminal', PARTY).kind).toBe('compact')
  expect(layoutFor(8, { bodyColumns: 99, maxRows: 20 }, 'terminal', PARTY)).toEqual({
    kind: 'collapsed',
    box: null,
    bandRows: 1,
  })
  // Grill 1.17: compact needs its 6 rows.
  expect(layoutFor(8, { bodyColumns: 120, maxRows: 5 }, 'terminal', PARTY).kind).toBe('collapsed')
  expect(layoutFor(8, { bodyColumns: 120, maxRows: 6 }, 'terminal', PARTY).kind).toBe('compact')
})

test('a Raster stage too tall for the band keeps its size and shows its bottom rows, down to 8 (ADR 0010)', () => {
  // A 17-row stage on a 16-row band: 11 rows left above the strip, the sky's 6 rows cropped.
  expect(layoutFor(17, { bodyColumns: 144, maxRows: 16 }, 'terminal', PARTY)).toEqual({
    kind: 'full',
    box: { columns: 144, rows: 17 },
    cells: { columns: 144, rows: 11 },
    bandRows: 16,
  })
  // The same on a Raster, and with rung (c)'s extra row: 10 rows left.
  expect(
    layoutFor(17, { bodyColumns: 144, maxRows: 16 }, 'terminal', { tab: 'party', extra: 1 }),
  ).toEqual({
    kind: 'full',
    box: { columns: 144, rows: 17 },
    cells: { columns: 144, rows: 10 },
    bandRows: 16,
  })
  // Exactly the actors' height left: still full.
  expect(cellsOf(layoutFor(17, { bodyColumns: 144, maxRows: 13 }, 'terminal', PARTY))).toEqual({
    columns: 144,
    rows: 8,
  })
  // Room for the whole stage: no cells, as before.
  expect(layoutFor(17, { bodyColumns: 144, maxRows: 22 }, 'terminal', PARTY)).toEqual({
    kind: 'full',
    box: { columns: 144, rows: 17 },
    bandRows: 22,
  })
  // Under the actors' height, or too narrow, it is compact as before.
  expect(layoutFor(17, { bodyColumns: 144, maxRows: 12 }, 'terminal', PARTY).kind).toBe('compact')
  expect(layoutFor(17, { bodyColumns: 115, maxRows: 20 }, 'terminal', PARTY).kind).toBe('compact')
})

test('an Image stage too tall for the band zooms the whole scene out; the Raster crop stops at the tallest actor', () => {
  const boss = { tab: 'party', extra: 0, minRows: 17 } as const
  // A boss on a 16-row band: 11 rows left, under the boss's 17. The Raster does not zoom out.
  expect(layoutFor(17, { bodyColumns: 144, maxRows: 16 }, 'terminal', boss).kind).toBe('compact')
  // The Image never crops: at rest on the same band it zooms out just the same.
  expect(
    layoutFor(17, { bodyColumns: 144, maxRows: 16 }, 'terminal', {
      ...boss,
      minRows: 8,
      scalable: true,
    }),
  ).toMatchObject({
    kind: 'full',
    box: { columns: 223, rows: 17 },
    cells: { columns: 144, rows: 11 },
  })
  // The Image widens the scene to 223 columns, which 11 rows of it span at the band's 144,
  // so nothing is cropped and the boss stays whole.
  expect(
    layoutFor(17, { bodyColumns: 144, maxRows: 16 }, 'terminal', { ...boss, scalable: true }),
  ).toEqual({
    kind: 'full',
    box: { columns: 223, rows: 17 },
    cells: { columns: 144, rows: 11 },
    bandRows: 16,
  })
  // A turn boss (12 rows) on a 17-row Raster band: 12 rows left meet its floor, so it is cropped.
  expect(
    layoutFor(17, { bodyColumns: 144, maxRows: 17 }, 'terminal', { ...boss, minRows: 12 }),
  ).toEqual({
    kind: 'full',
    box: { columns: 144, rows: 17 },
    cells: { columns: 144, rows: 12 },
    bandRows: 17,
  })
  // Under the compact stage's 4 rows the Image is compact too.
  expect(
    layoutFor(17, { bodyColumns: 144, maxRows: 8 }, 'terminal', { ...boss, scalable: true }).kind,
  ).toBe('compact')
})

test('an Image boss under a tall prompt still spans the band (#21)', () => {
  const boss = { tab: 'party', extra: 0, minRows: 17, scalable: true } as const
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

test('Loot and World are the strip alone: 5 rows, collapsed under 5 rows or 100 columns', () => {
  for (const tab of ['loot', 'world'] as const) {
    expect(layoutFor(17, { bodyColumns: 120, maxRows: 20 }, 'terminal', { tab, extra: 0 })).toEqual(
      {
        kind: 'bare',
        box: null,
        bandRows: 5,
      },
    )
    expect(layoutFor(8, { bodyColumns: 105, maxRows: 5 }, 'terminal', { tab, extra: 0 }).kind).toBe(
      'bare',
    )
    expect(layoutFor(8, { bodyColumns: 120, maxRows: 4 }, 'terminal', { tab, extra: 0 }).kind).toBe(
      'collapsed',
    )
    expect(layoutFor(8, { bodyColumns: 99, maxRows: 20 }, 'terminal', { tab, extra: 0 }).kind).toBe(
      'collapsed',
    )
  }
})

test('the desktop always draws the full stage, the art at least 116 and at most 160 wide', () => {
  const desk = { tab: 'party', extra: 1 } as const
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
  expect(
    layoutFor(8, { bodyColumns: 95, maxRows: 2 }, 'desktop', { tab: 'world', extra: 1 }).kind,
  ).toBe('bare')
  expect(layoutFor(8, { bodyColumns: 95, maxRows: 12 }, 'vscode', desk)).toEqual(
    layoutFor(8, { bodyColumns: 95, maxRows: 12 }, 'desktop', desk),
  )
})
