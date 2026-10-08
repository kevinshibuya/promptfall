import { expect, test } from 'claude-code/testing'
import type { GameView } from '../types'
import { revokedToast, type Toast, toastsFor, worldToast } from './toasts'
import { createInitialState, type Effect, type Hero, type Item, type Rarity } from './vendor/sim.js'
import { toAccountView, toGameView } from './view'

/** A view whose first roster hero is Aldric the Steadfast. */
function aldricView(): { view: GameView; aldricId: string } {
  const s0 = createInitialState(1)
  const roster = s0.roster.map((h, i) =>
    i === 0 ? { ...h, template: 'knight_1', epithet: 'the Steadfast' } : h,
  )
  const state = { ...s0, roster }
  const view = toGameView(state, 'a1', false, toAccountView(null, null, 'in-process', 0))
  return { view, aldricId: roster[0]?.id ?? '' }
}

const NO_BOSS = { bossName: () => null }

test('a level-up names its hero with the epithet', () => {
  const { view, aldricId } = aldricView()
  const effects: Effect[] = [{ k: 'level_up', heroId: aldricId, level: 5 }]
  expect(toastsFor(effects, view, NO_BOSS)).toEqual([
    {
      row: 'level_up',
      text: 'Aldric the Steadfast reached level 5',
      timeoutMs: 4000,
      cue: 'level_up',
    },
  ])
})

test('a hero the roster does not hold reads "A hero"; so does any hero with no view', () => {
  const { view, aldricId } = aldricView()
  const unknown: Effect[] = [{ k: 'level_up', heroId: 'h-gone', level: 5 }]
  expect(toastsFor(unknown, view, NO_BOSS).map((t) => t.text)).toEqual(['A hero reached level 5'])
  const known: Effect[] = [{ k: 'level_up', heroId: aldricId, level: 5 }]
  expect(toastsFor(known, null, NO_BOSS).map((t) => t.text)).toEqual(['A hero reached level 5'])
})

function oakStaff(rarity: Rarity): Item {
  return { id: 'i1', base: 'oak_staff', rarity, affixes: [], equippedBy: null, tradeableAt: null }
}

/** Morwen the Bold, a rare recruit. */
const MORWEN: Hero = {
  ...(createInitialState(1).roster[0] as Hero),
  id: 'h-morwen',
  template: 'black_mage_1',
  cls: 'black_mage',
  epithet: 'the Bold',
  rarity: 'rare',
}

const BOSSES = { bossName: (id: string) => (id === 'wb1' ? 'The Promptwyrm' : null) }

function trade(
  what: 'sold' | 'bought' | 'returned',
  kind: 'item' | 'hero',
  base: string,
  gold: number,
): Effect {
  return { k: 'traded', entry: { k: 'trade', what, kind, base, rarity: 'rare', gold } }
}

const SHORT = 4000
const LONG = 8000

// One case per effect-backed row of spec §10's table, each string the spec's, verbatim.
const SINGLE: [string, Effect, Toast][] = [
  [
    'a legendary drop',
    { k: 'drop', item: oakStaff('legendary') },
    { row: 'legendary_drop', text: 'Legendary drop: Oak Staff', timeoutMs: LONG, cue: 'legendary' },
  ],
  [
    'a recruit',
    { k: 'hero_recruited', hero: MORWEN, via: 'tavern' },
    { row: 'recruit', text: 'Rare recruit: Morwen the Bold', timeoutMs: LONG, cue: null },
  ],
  [
    'a reward of gold alone',
    { k: 'rewarded', bossId: 'wb1', goods: null, gold: 120 },
    { row: 'reward', text: 'Your share of The Promptwyrm: 120 gold', timeoutMs: LONG, cue: null },
  ],
  [
    'a reward of gold and an item',
    { k: 'rewarded', bossId: 'wb1', goods: { kind: 'item', item: oakStaff('rare') }, gold: 120 },
    {
      row: 'reward',
      text: 'Your share of The Promptwyrm: 120 gold and Oak Staff',
      timeoutMs: LONG,
      cue: null,
    },
  ],
  [
    'a reward of gold and a hero',
    { k: 'rewarded', bossId: 'wb1', goods: { kind: 'hero', hero: MORWEN }, gold: 120 },
    {
      row: 'reward',
      text: 'Your share of The Promptwyrm: 120 gold and Morwen',
      timeoutMs: LONG,
      cue: null,
    },
  ],
  [
    'a reward from a boss whose name is unknown',
    { k: 'rewarded', bossId: 'wb9', goods: { kind: 'item', item: oakStaff('rare') }, gold: 120 },
    {
      row: 'reward',
      text: 'Your share of the world boss: 120 gold and Oak Staff',
      timeoutMs: LONG,
      cue: null,
    },
  ],
  [
    'a wipe',
    { k: 'wipe', retreatedTo: 2 },
    { row: 'wipe', text: 'The party fell, retreating to zone 2', timeoutMs: LONG, cue: null },
  ],
  [
    'a zone arrival',
    { k: 'zone_cleared', zone: 3, advancedTo: 4 },
    {
      row: 'zone_arrival',
      text: 'The party reached zone 4, Old Barrow Hills',
      timeoutMs: SHORT,
      cue: null,
    },
  ],
  [
    'a rare drop',
    { k: 'drop', item: oakStaff('rare') },
    { row: 'rare_drop', text: 'Rare drop: Oak Staff', timeoutMs: SHORT, cue: 'drop' },
  ],
  [
    'an epic drop',
    { k: 'drop', item: oakStaff('epic') },
    { row: 'rare_drop', text: 'Epic drop: Oak Staff', timeoutMs: SHORT, cue: 'drop' },
  ],
  ...(['rare', 'epic', 'legendary'] as const).map((rarity): [string, Effect, Toast] => [
    `${rarity} item vendored`,
    { k: 'drop_vendored', item: oakStaff(rarity), gold: 40 },
    {
      row: 'vendored',
      text: 'Inventory full: Oak Staff vendored for 40 gold',
      timeoutMs: SHORT,
      cue: null,
    },
  ]),
  [
    'an item sold',
    trade('sold', 'item', 'oak_staff', 120),
    { row: 'sold', text: 'Oak Staff sold for 120 gold', timeoutMs: SHORT, cue: null },
  ],
  [
    'a traded hero, by its template name',
    trade('sold', 'hero', 'black_mage_1', 300),
    { row: 'sold', text: 'Morwen sold for 300 gold', timeoutMs: SHORT, cue: null },
  ],
  [
    'an item bought',
    trade('bought', 'item', 'oak_staff', 120),
    { row: 'bought', text: 'Oak Staff bought for 120 gold', timeoutMs: SHORT, cue: null },
  ],
  [
    'an item returned',
    trade('returned', 'item', 'oak_staff', 0),
    { row: 'returned', text: 'Oak Staff returned, unsold', timeoutMs: SHORT, cue: null },
  ],
]

for (const [name, effect, expected] of SINGLE) {
  test(`${name} toasts "${expected.text}"`, () => {
    expect(toastsFor([effect], null, BOSSES)).toEqual([expected])
  })
}

const SILENT: [string, Effect][] = [
  ['a farming clear', { k: 'zone_cleared', zone: 4, advancedTo: 4 }],
  ['a common drop', { k: 'drop', item: oakStaff('common') }],
  ['an uncommon drop', { k: 'drop', item: oakStaff('uncommon') }],
  ['a common item vendored', { k: 'drop_vendored', item: oakStaff('common'), gold: 5 }],
  ['a hit', { k: 'hit', by: 'h1', target: 'e1', amount: 12 }],
  ['a heal', { k: 'heal', by: 'h1', target: 'h2', amount: 12 }],
  ['an action', { k: 'act', actor: 'h1', action: 'attack', at: 0 }],
  ['a wave cleared', { k: 'wave_cleared', zone: 1, wave: 2 }],
  ['a gold tick', { k: 'gold', amount: 7 }],
  ['a zone boss appearing', { k: 'boss_spawned', kind: 'zone_boss', def: 'elder_treant' }],
  ['a hero falling', { k: 'hero_fell', heroId: 'h1' }],
  ['a party change', { k: 'party_applied', heroIds: ['h1', 'h2', 'h3'] }],
]

for (const [name, effect] of SILENT) {
  test(`${name} toasts nothing`, () => {
    expect(toastsFor([effect], null, BOSSES)).toEqual([])
  })
}

test('the world boss appearing is long with the boss cue; going down is short with none', () => {
  expect(worldToast('appeared', 'The Promptwyrm')).toEqual({
    row: 'world_boss_appeared',
    text: 'World boss The Promptwyrm has appeared',
    timeoutMs: LONG,
    cue: 'boss',
  })
  expect(worldToast('down', 'The Promptwyrm')).toEqual({
    row: 'world_boss_down',
    text: 'World boss The Promptwyrm is down',
    timeoutMs: SHORT,
    cue: null,
  })
})

test('a revoked item is named while its name is known, else counted', () => {
  const revoked = (text: string): Toast => ({ row: 'revoked', text, timeoutMs: LONG, cue: null })
  expect(revokedToast(['Oak Staff'])).toEqual(revoked('The server revoked Oak Staff'))
  expect(revokedToast([null])).toEqual(revoked('The server revoked an item'))
  expect(revokedToast(['Oak Staff', null, 'Oak Bow'])).toEqual(
    revoked('The server revoked 3 items'),
  )
  expect(revokedToast([])).toBeNull()
})
