import { expect, test } from 'claude-code/testing'
import { layoutFor } from './layout'

test('the full layout fits the stage rows plus two text rows', () => {
  expect(layoutFor(8, { bodyColumns: 120, maxRows: 20 }, 'terminal')).toEqual({
    kind: 'full',
    box: { columns: 120, rows: 8 },
    bandRows: 10,
  })
  expect(layoutFor(17, { bodyColumns: 120, maxRows: 20 }, 'terminal')).toEqual({
    kind: 'full',
    box: { columns: 120, rows: 17 },
    bandRows: 19,
  })
  expect(layoutFor(8, { bodyColumns: 200, maxRows: 20 }, 'terminal').box?.columns).toBe(160)
})

test('too short or too narrow falls back to compact, then one row', () => {
  expect(layoutFor(17, { bodyColumns: 120, maxRows: 12 }, 'terminal')).toEqual({
    kind: 'compact',
    box: { columns: 52, rows: 4 },
    bandRows: 4,
  })
  expect(layoutFor(8, { bodyColumns: 115, maxRows: 20 }, 'terminal').kind).toBe('compact')
  expect(layoutFor(8, { bodyColumns: 99, maxRows: 20 }, 'terminal')).toEqual({
    kind: 'collapsed',
    box: null,
    bandRows: 1,
  })
  expect(layoutFor(8, { bodyColumns: 120, maxRows: 3 }, 'terminal').kind).toBe('collapsed')
})

test('the desktop always draws the full stage, the art at least 116 and at most 160 wide', () => {
  expect(layoutFor(8, { bodyColumns: 95, maxRows: 12 }, 'desktop')).toEqual({
    kind: 'full',
    box: { columns: 116, rows: 8 },
    bandRows: 10,
  })
  expect(layoutFor(17, { bodyColumns: 60, maxRows: 12 }, 'desktop')).toEqual({
    kind: 'full',
    box: { columns: 116, rows: 17 },
    bandRows: 19,
  })
  expect(layoutFor(8, { bodyColumns: 130, maxRows: 12 }, 'desktop').box?.columns).toBe(130)
  expect(layoutFor(8, { bodyColumns: 200, maxRows: 3 }, 'desktop').box?.columns).toBe(160)
  expect(layoutFor(8, { bodyColumns: 95, maxRows: 12 }, 'vscode')).toEqual(
    layoutFor(8, { bodyColumns: 95, maxRows: 12 }, 'desktop'),
  )
})
