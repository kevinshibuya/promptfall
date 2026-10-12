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
  return {
    id: 'i1',
    base: 'oak_staff',
    rarity,
    tier: 1,
    affixes: [],
    equippedBy: null,
    tradeableAt: null,
  }
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
    {
      row: 'legendary_drop',
      text: 'Legendary drop: Oak Staff',
      timeoutMs: LONG,
      cue: 'legendary',
      wait: { item: 'i1' },
    },
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
      text: 'Your share of The Promptwyrm: 120 gold and Morwen the Bold',
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
    'a retreat',
    { k: 'retreat', zone: 3 },
    {
      row: 'retreat',
      text: 'The party retreats to zone 3, Marsh of Sighs',
      timeoutMs: LONG,
      cue: null,
    },
  ],
  [
    'a wipe',
    { k: 'wipe', zone: 4 },
    {
      row: 'wipe',
      text: 'The party fell, back to wave 1 of zone 4, Old Barrow Hills',
      timeoutMs: SHORT,
      cue: null,
    },
  ],
  [
    'a zone arrival past tier 1',
    { k: 'zone_cleared', zone: 12, advancedTo: 13 },
    {
      row: 'zone_arrival',
      text: 'The party reached tier 2, zone 1, Greenmeadow Road',
      timeoutMs: SHORT,
      cue: null,
      wait: { zone: 12 },
    },
  ],
  [
    'a zone arrival',
    { k: 'zone_cleared', zone: 3, advancedTo: 4 },
    {
      row: 'zone_arrival',
      text: 'The party reached zone 4, Old Barrow Hills',
      timeoutMs: SHORT,
      cue: null,
      wait: { zone: 3 },
    },
  ],
  [
    'a rare drop',
    { k: 'drop', item: oakStaff('rare') },
    {
      row: 'rare_drop',
      text: 'Rare drop: Oak Staff',
      timeoutMs: SHORT,
      cue: 'drop',
      wait: { item: 'i1' },
    },
  ],
  [
    'an epic drop',
    { k: 'drop', item: oakStaff('epic') },
    {
      row: 'rare_drop',
      text: 'Epic drop: Oak Staff',
      timeoutMs: SHORT,
      cue: 'drop',
      wait: { item: 'i1' },
    },
  ],
  ...(['rare', 'epic', 'legendary'] as const).map((rarity): [string, Effect, Toast] => [
    `${rarity} item vendored`,
    { k: 'drop_vendored', item: oakStaff(rarity), gold: 40, cause: 'full' },
    {
      row: 'vendored',
      text: 'Inventory full: Oak Staff vendored for 40 gold',
      timeoutMs: SHORT,
      cue: null,
      wait: { item: 'i1' },
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
  [
    'a common item vendored',
    { k: 'drop_vendored', item: oakStaff('common'), gold: 5, cause: 'full' },
  ],
  [
    'an uncommon item the setting vendored',
    { k: 'drop_vendored', item: oakStaff('uncommon'), gold: 8, cause: 'setting' },
  ],
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

// ---------------------------------------------------------------------------
// Folding: one burst, grouped by row

/** A view whose first three roster heroes are Aldric, Morwen and Selene, no epithets. */
function partyView(): { view: GameView; ids: [string, string, string] } {
  const s0 = createInitialState(1)
  const templates = ['knight_1', 'black_mage_1', 'white_mage_1']
  const roster = s0.roster.map((h, i) => ({
    ...h,
    template: templates[i] ?? h.template,
    epithet: '',
  }))
  const state = { ...s0, roster }
  const view = toGameView(state, 'a1', false, toAccountView(null, null, 'in-process', 0))
  const [a, b, c] = roster.map((h) => h.id)
  if (!a || !b || !c) throw new Error('the initial roster holds fewer than three heroes')
  return { view, ids: [a, b, c] }
}

function drop(base: string, rarity: Rarity, id = 'i1'): Effect {
  return { k: 'drop', item: { ...oakStaff(rarity), base, id } }
}

const texts = (effects: Effect[], view: GameView | null = null) =>
  toastsFor(effects, view, BOSSES).map((t) => t.text)

test('each rare drop is its own toast, at its own reveal', () => {
  const effects = [
    drop('oak_staff', 'rare', 'i1'),
    drop('willow_staff', 'rare', 'i2'),
    drop('rune_staff', 'rare', 'i3'),
  ]
  expect(toastsFor(effects, null, BOSSES)).toEqual(
    [
      ['Oak Staff', 'i1'],
      ['Willow Staff', 'i2'],
      ['Rune Staff', 'i3'],
    ].map(([name, item]) => ({
      row: 'rare_drop',
      text: `Rare drop: ${name}`,
      timeoutMs: SHORT,
      cue: 'drop',
      wait: { item },
    })),
  )
})

test('each epic drop is its own toast too', () => {
  const effects = [drop('oak_staff', 'epic'), drop('willow_staff', 'epic')]
  expect(texts(effects)).toEqual(['Epic drop: Oak Staff', 'Epic drop: Willow Staff'])
})

test('five rare drops are five toasts, no count and no "and 2 more"', () => {
  const bases = ['oak_staff', 'willow_staff', 'rune_staff', 'ember_rod', 'storm_rod']
  expect(texts(bases.map((b) => drop(b, 'rare')))).toEqual([
    'Rare drop: Oak Staff',
    'Rare drop: Willow Staff',
    'Rare drop: Rune Staff',
    'Rare drop: Ember Rod',
    'Rare drop: Storm Rod',
  ])
})

test('rare and epic drops in one burst are one toast each, epics first', () => {
  const effects = [
    drop('oak_staff', 'rare'),
    drop('willow_staff', 'epic'),
    drop('rune_staff', 'rare'),
    drop('ember_rod', 'epic'),
  ]
  expect(texts(effects)).toEqual([
    'Epic drop: Willow Staff',
    'Epic drop: Ember Rod',
    'Rare drop: Oak Staff',
    'Rare drop: Rune Staff',
  ])
})

test('one epic and two rare drops: three single forms, the epic first', () => {
  const effects = [
    drop('oak_staff', 'rare'),
    drop('willow_staff', 'epic'),
    drop('rune_staff', 'rare'),
  ]
  expect(texts(effects)).toEqual([
    'Epic drop: Willow Staff',
    'Rare drop: Oak Staff',
    'Rare drop: Rune Staff',
  ])
})

test('each vendored item is its own toast, at its own reveal', () => {
  const effects: Effect[] = [
    { k: 'drop_vendored', item: { ...oakStaff('rare'), id: 'i1' }, gold: 40, cause: 'full' },
    { k: 'drop_vendored', item: { ...oakStaff('epic'), id: 'i2' }, gold: 30, cause: 'full' },
    { k: 'drop_vendored', item: { ...oakStaff('common'), id: 'i3' }, gold: 5, cause: 'full' },
    { k: 'drop_vendored', item: { ...oakStaff('legendary'), id: 'i4' }, gold: 25, cause: 'full' },
  ]
  expect(toastsFor(effects, null, BOSSES)).toEqual(
    [
      [40, 'i1'],
      [30, 'i2'],
      [25, 'i4'],
    ].map(([gold, item]) => ({
      row: 'vendored',
      text: `Inventory full: Oak Staff vendored for ${gold} gold`,
      timeoutMs: SHORT,
      cue: null,
      wait: { item },
    })),
  )
})

test('drop and vendored toasts wait for their item, a zone arrival for its zone; every other toast carries no wait', () => {
  const { view, ids } = partyView()
  const effects: Effect[] = [
    drop('rune_staff', 'legendary', 'i-l'),
    { k: 'hero_recruited', hero: MORWEN, via: 'tavern' },
    { k: 'rewarded', bossId: 'wb1', goods: null, gold: 120 },
    { k: 'retreat', zone: 3 },
    { k: 'wipe', zone: 4 },
    { k: 'zone_cleared', zone: 3, advancedTo: 4 },
    drop('ember_rod', 'epic', 'i-e'),
    drop('oak_staff', 'rare', 'i-r'),
    { k: 'drop_vendored', item: { ...oakStaff('rare'), id: 'i-v' }, gold: 40, cause: 'full' },
    { k: 'level_up', heroId: ids[0], level: 6 },
    trade('sold', 'item', 'oak_staff', 120),
    trade('bought', 'item', 'oak_staff', 120),
    trade('returned', 'item', 'oak_staff', 0),
  ]
  expect(toastsFor(effects, view, BOSSES).map((t) => [t.row, t.wait ?? null])).toEqual([
    ['legendary_drop', { item: 'i-l' }],
    ['recruit', null],
    ['reward', null],
    ['retreat', null],
    ['wipe', null],
    ['zone_arrival', { zone: 3 }],
    ['rare_drop', { item: 'i-e' }],
    ['rare_drop', { item: 'i-r' }],
    ['vendored', { item: 'i-v' }],
    ['level_up', null],
    ['sold', null],
    ['bought', null],
    ['returned', null],
  ])
  expect(worldToast('appeared', 'The Promptwyrm').wait).toBeUndefined()
  expect(revokedToast(['Oak Staff'])?.wait).toBeUndefined()
})

test('sales fold into a count and the gold', () => {
  const effects = [
    trade('sold', 'item', 'oak_staff', 120),
    trade('sold', 'hero', 'black_mage_1', 200),
    trade('sold', 'item', 'rune_staff', 90),
  ]
  expect(toastsFor(effects, null, BOSSES)).toEqual([
    { row: 'sold', text: '3 items sold for 410 gold', timeoutMs: SHORT, cue: null },
  ])
})

test('purchases fold into a count and the gold', () => {
  const effects = [
    trade('bought', 'item', 'oak_staff', 120),
    trade('bought', 'item', 'rune_staff', 180),
  ]
  expect(texts(effects)).toEqual(['2 items bought for 300 gold'])
})

test('returns fold into a count', () => {
  const effects = [
    trade('returned', 'item', 'oak_staff', 0),
    trade('returned', 'item', 'rune_staff', 0),
    trade('returned', 'hero', 'black_mage_1', 0),
  ]
  expect(texts(effects)).toEqual(['3 items returned, unsold'])
})

test('two heroes reaching the same level fold into one sentence', () => {
  const { view, ids } = partyView()
  const effects: Effect[] = [
    { k: 'level_up', heroId: ids[0], level: 6 },
    { k: 'level_up', heroId: ids[1], level: 6 },
  ]
  expect(toastsFor(effects, view, BOSSES)).toEqual([
    {
      row: 'level_up',
      text: 'Aldric and Morwen reached level 6',
      timeoutMs: SHORT,
      cue: 'level_up',
    },
  ])
})

test('three heroes reaching the same level are listed with commas, "and" before the last', () => {
  const { view, ids } = partyView()
  const effects: Effect[] = ids.map((heroId) => ({ k: 'level_up', heroId, level: 6 }))
  expect(texts(effects, view)).toEqual(['Aldric, Morwen and Selene reached level 6'])
})

test('heroes reaching different levels get one clause each, in effect order', () => {
  const { view, ids } = partyView()
  const effects: Effect[] = [
    { k: 'level_up', heroId: ids[0], level: 6 },
    { k: 'level_up', heroId: ids[1], level: 4 },
    { k: 'level_up', heroId: ids[2], level: 3 },
  ]
  expect(texts(effects, view)).toEqual(['Aldric reached level 6, Morwen level 4, Selene level 3'])
})

test('one hero levelling twice in a burst toasts once, at the highest level', () => {
  const { view, ids } = partyView()
  const effects: Effect[] = [
    { k: 'level_up', heroId: ids[0], level: 6 },
    { k: 'level_up', heroId: ids[0], level: 7 },
  ]
  expect(toastsFor(effects, view, BOSSES)).toEqual([
    { row: 'level_up', text: 'Aldric reached level 7', timeoutMs: SHORT, cue: 'level_up' },
  ])
})

test('a hero levelling twice beside another counts once in the fold', () => {
  const { view, ids } = partyView()
  const effects: Effect[] = [
    { k: 'level_up', heroId: ids[0], level: 6 },
    { k: 'level_up', heroId: ids[1], level: 7 },
    { k: 'level_up', heroId: ids[0], level: 7 },
  ]
  expect(texts(effects, view)).toEqual(['Aldric and Morwen reached level 7'])
})

test('a burst with one effect of a folding row gives the single form, not a count of one', () => {
  expect(texts([trade('sold', 'item', 'oak_staff', 120)])).toEqual(['Oak Staff sold for 120 gold'])
  expect(texts([drop('oak_staff', 'rare')])).toEqual(['Rare drop: Oak Staff'])
})

test('two legendary drops give two toasts', () => {
  const effects = [drop('oak_staff', 'legendary'), drop('rune_staff', 'legendary')]
  expect(texts(effects)).toEqual(['Legendary drop: Oak Staff', 'Legendary drop: Rune Staff'])
})

test('rows that never fold give one toast per effect', () => {
  const effects: Effect[] = [
    { k: 'hero_recruited', hero: MORWEN, via: 'tavern' },
    { k: 'hero_recruited', hero: { ...MORWEN, id: 'h-2', epithet: 'the Wise' }, via: 'tavern' },
    { k: 'rewarded', bossId: 'wb1', goods: null, gold: 120 },
    { k: 'rewarded', bossId: 'wb1', goods: null, gold: 80 },
    { k: 'retreat', zone: 3 },
    { k: 'retreat', zone: 2 },
    { k: 'wipe', zone: 4 },
    { k: 'wipe', zone: 4 },
    { k: 'zone_cleared', zone: 3, advancedTo: 4 },
    { k: 'zone_cleared', zone: 4, advancedTo: 5 },
  ]
  expect(toastsFor(effects, null, BOSSES).map((t) => t.row)).toEqual([
    'recruit',
    'recruit',
    'reward',
    'reward',
    'retreat',
    'retreat',
    'wipe',
    'wipe',
    'zone_arrival',
    'zone_arrival',
  ])
})

test("a burst mixing kinds raises one toast per row's group, in the table's order", () => {
  const { view, ids } = partyView()
  const effects: Effect[] = [
    trade('sold', 'item', 'oak_staff', 120),
    { k: 'level_up', heroId: ids[0], level: 6 },
    drop('willow_staff', 'rare'),
    trade('sold', 'item', 'rune_staff', 90),
    { k: 'zone_cleared', zone: 3, advancedTo: 4 },
    { k: 'level_up', heroId: ids[1], level: 6 },
    drop('rune_staff', 'legendary'),
    { k: 'wipe', zone: 4 },
    { k: 'retreat', zone: 3 },
    drop('ember_rod', 'epic'),
    trade('returned', 'item', 'storm_rod', 0),
  ]
  expect(toastsFor(effects, view, BOSSES).map((t) => [t.text, t.timeoutMs])).toEqual([
    ['Legendary drop: Rune Staff', LONG],
    ['The party retreats to zone 3, Marsh of Sighs', LONG],
    ['The party fell, back to wave 1 of zone 4, Old Barrow Hills', SHORT],
    ['The party reached zone 4, Old Barrow Hills', SHORT],
    ['Epic drop: Ember Rod', SHORT],
    ['Rare drop: Willow Staff', SHORT],
    ['Aldric and Morwen reached level 6', SHORT],
    ['2 items sold for 210 gold', SHORT],
    ['Storm Rod returned, unsold', SHORT],
  ])
})

test('two bursts with one sale each give two single forms, never a fold', () => {
  const first = texts([trade('sold', 'item', 'oak_staff', 120)])
  const second = texts([trade('sold', 'item', 'rune_staff', 90)])
  expect([...first, ...second]).toEqual([
    'Oak Staff sold for 120 gold',
    'Rune Staff sold for 90 gold',
  ])
})
