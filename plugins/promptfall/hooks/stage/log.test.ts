import { expect, test } from 'claude-code/testing'
import type { GameView } from '../../types'
import type { Effect, Item } from '../vendor/sim.js'
import { CHAR_FAST_MS, CHAR_MS, LINE_MIN_MS } from '../windows/tuning'
import { wave } from './fixtures'
import { MessageLog } from './log'
import { StageTimeline } from './timeline'
import { RARITY_RGB } from './tuning'

const NOW = 1_000_000
const act = (actor: string, at: number): Effect => ({ k: 'act', actor, action: 'attack', at })
const hit = (by: string, target: string, amount: number): Effect => ({
  k: 'hit',
  by,
  target,
  amount,
})
const item = (base: string, rarity = 'rare'): Item =>
  ({ id: 'i1', base, rarity, affixes: [], equippedBy: null, tradeableAt: null }) as unknown as Item

/** Applies one batch the way register does and answers the log's texts. */
function run(
  effects: Effect[],
  opts: {
    before?: GameView
    after?: GameView
    cadence?: number
    log?: MessageLog
    now?: number
  } = {},
) {
  const log = opts.log ?? new MessageLog()
  const t = new StageTimeline()
  const before = opts.before ?? wave()
  const after = opts.after ?? before
  const now = opts.now ?? NOW
  t.observe(before, now - 1)
  log.onEffects([], [], before, now - 1, opts.cadence ?? 2000, t)
  const starts = t.onEffects(effects, now, opts.cadence ?? 2000)
  t.observe(after, now)
  log.onEffects(effects, starts, after, now, opts.cadence ?? 2000, t)
  return { log, texts: log.shown(Number.POSITIVE_INFINITY, 'still').map((l) => l.text) }
}

const names = (v: GameView) => ({ hero: v.heroes[0]?.shortName, enemy: v.enemies[0]?.name })

/** The wave with its party in the roster, where the log looks a hero's full name up. */
function rostered(names: Record<string, string> = {}): GameView {
  const v = wave()
  const roster = v.heroes.map((h) => ({
    id: h.id,
    name: names[h.id] ?? h.name,
    cls: h.cls,
    glyph: h.glyph,
    rarity: h.rarity,
    level: h.level,
    traits: [],
    inParty: true,
    inPendingParty: true,
    tradeableAt: null,
    equipment: { weapon: null, armour: null, accessory: null },
  }))
  return { ...v, roster }
}

const traded = (what: 'sold' | 'bought' | 'returned', gold = 120) =>
  ({
    k: 'traded',
    entry: { k: 'trade', what, kind: 'item', base: 'oak_staff', rarity: 'rare', gold },
  }) as unknown as Effect

test('each row of the wording table prints as written', () => {
  const v = rostered()
  const { hero, enemy } = names(v)
  const e1 = v.enemies[0]?.id ?? ''
  const h1 = v.heroes[0]?.id ?? ''
  const h3 = v.heroes[2]?.id ?? ''
  const { texts } = run(
    [
      act(h1, 0),
      hit(h1, e1, 12),
      act(e1, 500),
      hit(e1, h1, 5),
      act(h3, 1000),
      { k: 'heal', by: h3, target: h1, amount: 14 },
      { k: 'drop', item: item('oak_staff', 'common') },
      { k: 'drop', item: item('oak_staff', 'rare') },
      { k: 'drop_vendored', item: item('oak_staff', 'common'), gold: 12 },
      { k: 'level_up', heroId: h1, level: 5 },
      { k: 'hero_fell', heroId: h1 },
      { k: 'boss_spawned', kind: 'zone_boss', def: 'goblin_scout' },
      { k: 'zone_cleared', zone: 3, advancedTo: 4 },
      { k: 'zone_cleared', zone: 3, advancedTo: 3 },
      { k: 'wipe', retreatedTo: 2 },
      traded('sold'),
      {
        k: 'rewarded',
        bossId: 'wb1',
        goods: { kind: 'item', item: item('oak_staff', 'epic') },
        gold: 120,
      } as unknown as Effect,
      { k: 'rewarded', bossId: 'wb1', goods: null, gold: 120 },
      { k: 'gold', amount: 9 },
      { k: 'wave_cleared', zone: 1, wave: 2 },
    ],
    { before: v },
  )
  expect(texts).toEqual([
    `${hero} hits ${enemy} for 12.`,
    `${enemy} hits ${hero} for 5.`,
    `${v.heroes[2]?.shortName} heals ${hero} for 14.`,
    'Drop: Oak Staff.',
    'Rare drop: Oak Staff.',
    'Inventory full: Oak Staff vendored for 12G.',
    'Aldric reached level 5.',
    'Aldric falls!',
    'Goblin Scout appears!',
    'The party reached zone 4, Old Barrow Hills.',
    'Zone 3 cleared.',
    'The party fell, retreating to zone 2.',
    'Oak Staff sold for 120G.',
    'Your share of the boss: 120G and Oak Staff.',
    'Your share of the boss: 120G.',
  ])
})

test('a level-up names the hero the way its toast does, from the roster', () => {
  const v = rostered({ h1: 'Aldric the Steadfast' })
  const { texts } = run(
    [
      { k: 'level_up', heroId: 'h1', level: 6 },
      { k: 'level_up', heroId: 'h9', level: 2 },
    ],
    { before: v },
  )
  expect(texts).toEqual(['Aldric the Steadfast reached level 6.', 'A hero reached level 2.'])
})

test('a hero won from the boss is named by its template', () => {
  const { texts } = run([
    {
      k: 'rewarded',
      bossId: 'wb1',
      goods: { kind: 'hero', hero: { template: 'knight_1', epithet: 'the Steadfast' } },
      gold: 40,
    } as unknown as Effect,
  ])
  expect(texts).toEqual(['Your share of the boss: 40G and Aldric.'])
})

test('a drop names its rarity when the rarity is the news', () => {
  const { texts } = run([
    { k: 'drop', item: item('oak_staff', 'common') },
    { k: 'drop', item: item('oak_staff', 'uncommon') },
    { k: 'drop', item: item('oak_staff', 'rare') },
    { k: 'drop', item: item('oak_staff', 'epic') },
    { k: 'drop', item: item('oak_staff', 'legendary') },
  ])
  expect(texts).toEqual([
    'Drop: Oak Staff.',
    'Drop: Oak Staff.',
    'Rare drop: Oak Staff.',
    'Epic drop: Oak Staff.',
    'Legendary drop: Oak Staff.',
  ])
})

test('a drop line takes its rarity colour', () => {
  const { log } = run([{ k: 'drop', item: item('silk_robe', 'epic') }])
  expect(log.shown(Number.POSITIVE_INFINITY, 'still')[0]?.rgb).toBe(RARITY_RGB.epic)
})

test('a black mage action with three hits is one line', () => {
  const v = wave()
  const by = v.heroes[1]?.id ?? ''
  const [a, b, c] = v.enemies.map((e) => e.id)
  const { texts } = run([act(by, 0), hit(by, a ?? '', 8), hit(by, b ?? '', 9), hit(by, c ?? '', 7)])
  expect(texts).toEqual([`${v.heroes[1]?.shortName} hits 3 foes for 8, 9 and 7.`])
})

test('a kill prints after the killing action; a world boss leaving prints none', () => {
  const v = wave()
  const by = v.heroes[0]?.id ?? ''
  const target = v.enemies[0]
  const after = { ...v, enemies: v.enemies.slice(1) }
  const { texts } = run(
    [act(by, 0), hit(by, target?.id ?? '', 30), { k: 'drop', item: item('silk_robe') }],
    { before: v, after },
  )
  expect(texts.slice(0, 2)).toEqual([
    `${v.heroes[0]?.shortName} hits ${target?.name} for 30.`,
    `${target?.name} is defeated!`,
  ])
  expect(texts[2]).toBe('Rare drop: Silk Robe.')

  const boss: GameView = {
    ...v,
    enemies: [
      {
        id: 'wb',
        def: 'world_boss',
        name: 'Ashen Wyrm',
        glyph: 'W',
        hp: 1,
        maxHp: 9,
        kind: 'world_boss',
      },
    ],
  }
  const gone = run([act(by, 0), hit(by, 'wb', 3)], {
    before: boss,
    after: { ...boss, enemies: [] },
  })
  expect(gone.texts.some((t) => t.includes('defeated'))).toBe(false)
})

test('a kill of an enemy whose spawn tick had no effects still prints', () => {
  const log = new MessageLog()
  const t = new StageTimeline()
  const empty = { ...wave(), enemies: [] }
  const spawned = wave()
  const by = spawned.heroes[0]?.id ?? ''
  const target = spawned.enemies[0]
  t.observe(empty, NOW - 3000)
  log.onEffects([], [], empty, NOW - 3000, 2000, t)
  // The spawn tick: no effects, the new enemies arrive with the view.
  log.onEffects([], [], spawned, NOW - 2000, 2000, t)
  const effects = [act(by, 0), hit(by, target?.id ?? '', 40)]
  const starts = t.onEffects(effects, NOW, 2000)
  log.onEffects(effects, starts, { ...spawned, enemies: spawned.enemies.slice(1) }, NOW, 2000, t)
  expect(log.shown(Number.POSITIVE_INFINITY, 'still').map((l) => l.text)).toContain(
    `${target?.name} is defeated!`,
  )
})

test('two actions 500 ms apart start their lines 500 ms apart', () => {
  // Short names: each line types in under 500 ms, so typing does not push the second back.
  const base = wave()
  const v: GameView = {
    ...base,
    heroes: base.heroes.map((h, i) => ({ ...h, shortName: ['Al', 'Bo', 'Cy'][i] ?? 'X' })),
    enemies: base.enemies.map((e) => ({ ...e, name: 'Rat' })),
  }
  const [h1, h2] = v.heroes.map((h) => h.id)
  const e1 = v.enemies[0]?.id ?? ''
  const { log } = run(
    [act(h1 ?? '', 0), hit(h1 ?? '', e1, 1), act(h2 ?? '', 500), hit(h2 ?? '', e1, 2)],
    { before: v },
  )
  const shownAt = (ms: number) => log.shown(NOW + ms, 'still').length
  expect(shownAt(0)).toBe(1)
  expect(shownAt(499)).toBe(1)
  expect(shownAt(500)).toBe(2)
})

test('a line types CHAR_MS per character; motion still shows it whole', () => {
  const v = wave()
  const { log } = run([
    act(v.heroes[0]?.id ?? '', 0),
    hit(v.heroes[0]?.id ?? '', v.enemies[0]?.id ?? '', 7),
  ])
  expect(log.shown(NOW + 3 * CHAR_MS, 'full')[0]?.revealed).toBe(3)
  const whole = log.shown(NOW, 'still')[0]
  expect(whole?.revealed).toBe(Array.from(whole?.text ?? '').length)
  expect(log.isBusy(NOW + 3 * CHAR_MS, 'full')).toBe(true)
  expect(log.isBusy(NOW + 3 * CHAR_MS, 'still')).toBe(false)
})

test('a burst more than a tick behind drops hit lines, never a drop or a level-up', () => {
  const v = rostered()
  const h1 = v.heroes[0]?.id ?? ''
  const e1 = v.enemies[0]?.id ?? ''
  const effects: Effect[] = []
  // Every action also drops: key lines back the queue up past a tick.
  for (let i = 0; i < 12; i++)
    effects.push(act(h1, i * 10), hit(h1, e1, 100 + i), { k: 'drop', item: item('silk_robe') })
  effects.push({ k: 'level_up', heroId: h1, level: 9 })
  const { log, texts } = run(effects, { before: v })
  expect(texts.filter((t) => t.includes(' hits ')).length).toBeLessThan(12)
  expect(texts).toContain('Rare drop: Silk Robe.')
  expect(texts).toContain('Aldric reached level 9.')
  // Lines never overlap: each starts after the one before has typed, at least LINE_MIN_MS later.
  const lines = log.upcoming(NOW - 1, 1e9)
  for (let i = 1; i < lines.length; i++)
    expect((lines[i]?.at ?? 0) - (lines[i - 1]?.at ?? 0)).toBeGreaterThanOrEqual(LINE_MIN_MS)
  // Lines scheduled behind two unfinished ones type fast.
  expect(lines.some((l) => l.charMs === CHAR_FAST_MS)).toBe(true)
})

test('a wipe after a hit that did not kill prints no defeated line', () => {
  const v = wave()
  const h1 = v.heroes[0]?.id ?? ''
  const e1 = v.enemies[0]
  // The encounter is cleared by the wipe: every enemy leaves the view alive.
  const after = { ...v, enemies: [] }
  const { texts } = run(
    [
      act(h1, 0),
      hit(h1, e1?.id ?? '', 1),
      act(e1?.id ?? '', 500),
      hit(e1?.id ?? '', h1, 99),
      { k: 'hero_fell', heroId: h1 },
      { k: 'wipe', retreatedTo: 1 },
    ],
    { before: v, after },
  )
  expect(texts.some((t) => t.includes('defeated'))).toBe(false)
  expect(texts).toContain('The party fell, retreating to zone 1.')
})

test('an enemy no view ever held is a Foe, and its kill still prints', () => {
  const v = wave()
  const h1 = v.heroes[0]?.id ?? ''
  const { texts } = run([act(h1, 0), hit(h1, 'e57', 30)])
  expect(texts).toEqual([`${v.heroes[0]?.shortName} hits Foe for 30.`, 'Foe is defeated!'])
})

test('a purchase or a return prints nothing; a sale prints', () => {
  const { texts } = run([traded('bought'), traded('returned'), traded('sold')])
  expect(texts).toEqual(['Oak Staff sold for 120G.'])
})
