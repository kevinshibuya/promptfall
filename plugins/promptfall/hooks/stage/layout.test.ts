import { expect, test } from 'claude-code/testing'
import { layoutFor } from './layout'

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
  expect(layoutFor(17, { bodyColumns: 120, maxRows: 12 }, 'terminal', PARTY)).toEqual({
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

test('an Image stage too tall for the band shrinks to fit, keeping its proportions', () => {
  const image = { tab: 'party', extra: 0, scalable: true } as const
  // A zone boss on a 16-row band: the 17-row scene draws into the 11 rows left above the strip.
  expect(layoutFor(17, { bodyColumns: 144, maxRows: 16 }, 'terminal', image)).toEqual({
    kind: 'full',
    box: { columns: 144, rows: 17 },
    cells: { columns: 93, rows: 11 },
    bandRows: 16,
  })
  // A taller prompt squeezes the rest stage too; it stays full.
  expect(layoutFor(8, { bodyColumns: 144, maxRows: 12 }, 'terminal', image)).toEqual({
    kind: 'full',
    box: { columns: 144, rows: 8 },
    cells: { columns: 126, rows: 7 },
    bandRows: 12,
  })
  // Room for the whole stage: no cells, as before.
  expect(layoutFor(8, { bodyColumns: 144, maxRows: 16 }, 'terminal', image)).toEqual({
    kind: 'full',
    box: { columns: 144, rows: 8 },
    bandRows: 13,
  })
  // Under the compact stage's 4 rows, or too narrow, it is compact as before.
  expect(layoutFor(17, { bodyColumns: 144, maxRows: 8 }, 'terminal', image).kind).toBe('compact')
  expect(layoutFor(8, { bodyColumns: 115, maxRows: 20 }, 'terminal', image).kind).toBe('compact')
  // A Raster cannot scale: it falls back to compact.
  expect(layoutFor(17, { bodyColumns: 144, maxRows: 16 }, 'terminal', PARTY).kind).toBe('compact')
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
