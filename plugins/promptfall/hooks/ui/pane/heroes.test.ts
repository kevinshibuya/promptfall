import { expect, test } from 'claude-code/testing'
import type { DialogState } from '../../../types'
import { tilePositions } from '../../windows/kit'
import { DIM_RGB, HP_BAR_RGB, TEXT_RGB } from '../../windows/tuning'
import { paneInput, paneView } from './fixtures'
import { heroesPane } from './heroes'
import type { PaneInput } from './input'
import { linesOf, textOf, win } from './testing'

function input(patch: Partial<DialogState> = {}, more: Partial<PaneInput> = {}): PaneInput {
  const base = paneInput({ tab: 'heroes', ...more })
  return { ...base, dialog: { ...base.dialog, partyPick: ['h4'], ...patch } }
}
const at = (id: string, index = 0) => ({ cursor: { inventory: null, heroes: { id, index } } })

test('row marks: party, pick, blank; the recruit row last', () => {
  const rows = linesOf(win(heroesPane(input()), 'list'))
  const full = (win(heroesPane(input()), 'list')?.lines ?? []).map((l) => textOf(l.spans))
  expect(full.map((r) => r.slice(-5).trim())).toEqual([
    'party',
    'party',
    'party',
    'pick',
    '',
    '120G',
  ])
  expect(rows[0]?.startsWith('▶ @@ Aldric ')).toBe(true)
  expect(rows[0]?.endsWith('    Knight  L4 party')).toBe(true)
  expect(rows[0]?.length).toBe(78)
  expect(rows[5]?.startsWith('     Recruit a hero')).toBe(true)
})

test("a party hero's detail has the H line and its bar; a bench hero's has none", () => {
  const party = win(heroesPane(input()), 'detail')
  const lines = linesOf(party)
  expect(lines.slice(0, 2)).toEqual([' Aldric L4', ' Knight · common'])
  expect(lines[2]?.startsWith(' H ')).toBe(true)
  const bar = party?.lines[2]?.spans.find((s) => 'bar' in s)
  expect(bar && 'cells' in bar ? [bar.cells, bar.rgb] : null).toEqual([8, HP_BAR_RGB])
  expect(lines.slice(3)).toEqual([
    ' Traits: Brave, Swift',
    ' Weapon    Iron Sword',
    ' Armour    -',
    ' Accessory -',
    ' In the party',
  ])
  const bench = linesOf(win(heroesPane(input(at('h5'))), 'detail'))
  expect(bench).toEqual([
    ' Bram L1',
    ' Knight · common',
    ' Weapon    -',
    ' Armour    -',
    ' Accessory -',
  ])
  expect(linesOf(win(heroesPane(input(at('h4'))), 'detail')).at(-1)).toBe(
    ' Picked for the new party',
  )
})

test('the command window: Party or Unpick, Sell for rare and up, Dismiss off the party', () => {
  const items = (id: string) =>
    linesOf(win(heroesPane(input({ menu: { kind: 'actions', tab: 'heroes', id, at: 0 } })), 'menu'))
  expect(items('h1')).toEqual([' Aldric', '▶Party'])
  expect(items('h2')).toEqual([' Mira', '▶Party', ' Sell'])
  expect(items('h4')).toEqual([' Lyra', '▶Unpick', ' Sell', ' Dismiss'])
  expect(items('h5')).toEqual([' Bram', '▶Party', ' Dismiss'])
  const b = heroesPane(input({ menu: { kind: 'actions', tab: 'heroes', id: 'h5', at: 1 } }))
  expect(b.stops.filter((s) => s.cursor).map((s) => [s.key, s.hotkey, s.action])).toEqual([
    ['menu:0', 'p', { t: 'party', heroId: 'h5' }],
    ['menu:1', 'd', { t: 'open', menu: { kind: 'confirm', action: 'dismiss', id: 'h5', at: 0 } }],
  ])
})

test('dismiss asks; Yes dismisses', () => {
  const b = heroesPane(input({ menu: { kind: 'confirm', action: 'dismiss', id: 'h5', at: 0 } }))
  expect(textOf(win(b, 'message')?.lines[0]?.spans ?? [])).toBe(
    ' Dismiss Bram? They leave for good.',
  )
  expect(b.stops.find((s) => s.key === 'yes')?.action).toEqual({
    t: 'event',
    event: { t: 'dismiss', heroId: 'h5' },
  })
})

test('the recruit row: dim when gold is short, absent in read-only mode', () => {
  const recruit = (b: ReturnType<typeof heroesPane>) =>
    win(b, 'list')?.lines.find((l) => textOf(l.spans).includes('Recruit'))
  const rich = recruit(heroesPane(input()))
  expect(rich?.spans.find((s) => 'text' in s && s.text === 'Recruit a hero')).toEqual({
    text: 'Recruit a hero',
    rgb: TEXT_RGB,
  })
  const view = paneView()
  view.gold = 50
  const poor = recruit(heroesPane(input({}, { view })))
  expect(
    poor?.spans.filter((s) => 'text' in s && s.text.trim()).map((s) => ('rgb' in s ? s.rgb : 0)),
  ).toEqual([DIM_RGB, DIM_RGB])
  const b = heroesPane(input({}, { view }))
  expect(b.stops.find((s) => s.key === 'row:recruit')?.action).toEqual({
    t: 'event',
    event: { t: 'recruit' },
  })
  const ro = heroesPane(input({}, { readOnly: true, mode: 'paused' }))
  expect(recruit(ro)).toBeUndefined()
  expect(ro.stops.some((s) => s.key === 'row:recruit')).toBe(false)
})

test("the recruit row's detail: the price and the nearest guarantee in one line", () => {
  const detail = (view = paneView()) =>
    linesOf(win(heroesPane(input({ partyPick: [], ...at('recruit', 5) }, { view })), 'detail'))
  expect(detail()).toEqual([' Recruit a hero', ' 120G · Rare guaranteed in 20'])
  const near = paneView()
  near.guarantees = { rare: 6, epic: 3, legendary: 300 }
  expect(detail(near)[1]).toBe(' 120G · Epic guaranteed in 3')
  const next = paneView()
  next.guarantees = { rare: 1, epic: 1, legendary: 250 }
  expect(detail(next)[1]).toBe(' 120G · Epic guaranteed next')
})

test('picks: the message names them and the count left', () => {
  const b = heroesPane(input({ partyPick: ['h4', 'h5'] }))
  const m = win(b, 'message')
  expect(textOf(m?.lines[0]?.spans ?? [])).toBe(' New party: Lyra, Bram (pick 1 more).')
  expect(textOf(m?.lines[1]?.spans ?? [])).toBe(
    ' A new party takes the field at the next zone change.',
  )
  const none = heroesPane(input({ partyPick: [] }))
  expect(textOf(win(none, 'message')?.lines[0]?.spans ?? [])).toBe(
    ' Enter: actions. Tab or arrows: move.',
  )
})

test('narrow keeps the header, the class, the H line or traits, and the status', () => {
  expect(linesOf(win(heroesPane(input({}, { columns: 60 })), 'detail'))).toHaveLength(4)
  const bench = linesOf(win(heroesPane(input(at('h4'), { columns: 60 })), 'detail'))
  expect(bench).toEqual([' Lyra L2', ' Archer · rare', ' Picked for the new party'])
})

test('tiles agree, wide and narrow, with the command window and the Yes/No', () => {
  const dialogs: Partial<DialogState>[] = [
    {},
    { menu: { kind: 'actions', tab: 'heroes', id: 'h4', at: 0 } },
    { menu: { kind: 'confirm', action: 'dismiss', id: 'h5', at: 1 } },
  ]
  for (const columns of [120, 60]) {
    for (const d of dialogs) {
      const b = heroesPane(input(d, { columns }))
      const positions = tilePositions(b.scene)
      for (const w of b.scene.windows)
        expect([w.key, positions.get(w.key)]).toEqual([w.key, { x: w.x, y: w.y ?? 0 }])
    }
  }
})
