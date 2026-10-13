import { expect, test } from 'claude-code/testing'
import type { GameView } from '../../types'
import type { Toast } from '../toasts'
import type { Effect, Item } from '../vendor/sim.js'
import { CHAR_FAST_MS, CHAR_MS, LINE_MIN_MS } from '../windows/tuning'
import { boss, wave } from './fixtures'
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
const item = (base: string, rarity = 'rare', id = 'i1'): Item =>
  ({ id, base, rarity, affixes: [], equippedBy: null, tradeableAt: null }) as unknown as Item

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
  return {
    log,
    t,
    starts,
    texts: log.shown(Number.POSITIVE_INFINITY, 'still').map((l) => l.text),
  }
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
      { k: 'drop_vendored', item: item('oak_staff', 'common'), gold: 12, cause: 'full' },
      { k: 'drop_vendored', item: item('oak_staff', 'common'), gold: 3, cause: 'setting' },
      { k: 'level_up', heroId: h1, level: 5 },
      { k: 'hero_fell', heroId: h1 },
      { k: 'boss_spawned', kind: 'zone_boss', def: 'goblin_scout' },
      { k: 'zone_cleared', zone: 3, advancedTo: 4 },
      { k: 'zone_cleared', zone: 3, advancedTo: 3 },
      { k: 'wipe', zone: 3 },
      { k: 'retreat', zone: 2 },
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
  // The drops wait for their chests' reveal: their lines take their place at its show time,
  // after the actions that started by then and ahead of the lines still queued for later.
  expect(texts).toEqual([
    `${hero} hits ${enemy} for 12.`,
    `${enemy} hits ${hero} for 5.`,
    `${v.heroes[2]?.shortName} heals ${hero} for 14.`,
    'Drop: Oak Staff.',
    'Rare drop: Oak Staff.',
    'Inventory full: Oak Staff vendored for 12G.',
    'Oak Staff vendored, 3G.',
    'Aldric reached level 5.',
    'Aldric falls!',
    'Goblin Scout appears!',
    'The party reached zone 4, Old Barrow Hills.',
    'Zone 3 cleared.',
    'The party fell.',
    'The party retreats to zone 2.',
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
        enraged: false,
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

test('the zone lines carry the tier past zone 12', () => {
  const { texts } = run([
    { k: 'zone_cleared', zone: 12, advancedTo: 13 },
    { k: 'zone_cleared', zone: 36, advancedTo: 36 },
    { k: 'retreat', zone: 13 },
  ])
  expect(texts).toEqual([
    'The party reached tier 2, zone 1, Greenmeadow Road.',
    'Tier 3, zone 12 cleared.',
    'The party retreats to tier 2, zone 1.',
  ])
})

test('a wipe or a retreat after a hit that did not kill prints no defeated line', () => {
  for (const [fall, line] of [
    [{ k: 'wipe', zone: 1 }, 'The party fell.'],
    [{ k: 'retreat', zone: 1 }, 'The party retreats to zone 1.'],
  ] as const) {
    const v = wave()
    const h1 = v.heroes[0]?.id ?? ''
    const e1 = v.enemies[0]
    // The encounter is cleared by the fall: every enemy leaves the view alive.
    const after = { ...v, enemies: [] }
    const { texts } = run(
      [
        act(h1, 0),
        hit(h1, e1?.id ?? '', 1),
        act(e1?.id ?? '', 500),
        hit(e1?.id ?? '', h1, 99),
        { k: 'hero_fell', heroId: h1 },
        fall,
      ],
      { before: v, after },
    )
    expect(texts.some((t) => t.includes('defeated'))).toBe(false)
    expect(texts).toContain(line)
  }
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

/** The wave with names short enough that no line's typing pushes the next back. */
function terse(): GameView {
  const base = wave()
  return {
    ...base,
    heroes: base.heroes.map((h, i) => ({ ...h, shortName: ['Al', 'Bo', 'Cy'][i] ?? 'X' })),
    enemies: base.enemies.map((e) => ({ ...e, name: 'Rat' })),
  }
}

test('a drop line prints when its item has risen from the chest, not at the kill', () => {
  const v = terse()
  const by = v.heroes[0]?.id ?? ''
  const target = v.enemies[0]?.id ?? ''
  const after = { ...v, enemies: v.enemies.slice(1) }
  const { log, t } = run(
    [
      act(by, 0),
      hit(by, target, 30),
      { k: 'drop', item: item('silk_robe', 'rare', 'i1') },
      { k: 'drop_vendored', item: item('oak_staff', 'common', 'i2'), gold: 12, cause: 'full' },
    ],
    { before: v, after },
  )
  const show = t.showAt('i1') ?? 0
  expect(show).toBeGreaterThan(NOW + 1000)
  const texts = (now: number) => log.shown(now, 'still').map((l) => l.text)
  // The kill line prints after the killing action, as ever; the drop waits for its reveal.
  expect(texts(show - 1)).toEqual(['Al hits Rat for 30.', 'Rat is defeated!'])
  const lines = log.upcoming(show - 1, 10_000)
  expect(lines[0]).toMatchObject({ text: 'Rare drop: Silk Robe.', key: true, at: show })
  expect(lines[1]?.text).toBe('Inventory full: Oak Staff vendored for 12G.')
  expect(lines[1]?.key).toBe(true)
  expect(log.isBusy(show - 1, 'still')).toBe(true)
  expect(texts(show)).toContain('Rare drop: Silk Robe.')
})

test("a lone drop on the empty stage waits for its chest on the ground, as a kill's does", () => {
  // A sandbox item between spawns: no row to fall from, the chest falls on the front slot's ground.
  const v = { ...terse(), enemies: [] }
  const { log, t } = run([{ k: 'drop', item: item('silk_robe', 'rare', 'i1') }], {
    before: v,
  })
  const show = t.showAt('i1') ?? 0
  expect(show).toBe(NOW + 1400)
  const texts = (now: number) => log.shown(now, 'still').map((l) => l.text)
  expect(texts(show - 1)).toEqual([])
  expect(texts(show)).toEqual(['Rare drop: Silk Robe.'])
})

test('a hit line after a pending drop line is neither delayed nor dropped', () => {
  const v = terse()
  const [h1, h2] = v.heroes.map((h) => h.id)
  const [e1, e2] = v.enemies.map((e) => e.id)
  const after = { ...v, enemies: v.enemies.slice(1) }
  // The second action starts once the kill's lines have typed: only a drop line could be ahead.
  const { log, starts } = run(
    [
      act(h1 ?? '', 0),
      hit(h1 ?? '', e1 ?? '', 30),
      { k: 'drop', item: item('silk_robe') },
      act(h2 ?? '', 800),
      hit(h2 ?? '', e2 ?? '', 4),
    ],
    { before: v, after },
  )
  const line = log.upcoming(NOW - 1, 1e9).find((l) => l.text === 'Bo hits Rat for 4.')
  expect(line).toBeDefined()
  expect(line?.at).toBe(starts[1])
})

/** The zone boss of zone 1 fell: the sim moved on to zone 2, wave 1, and brought the next wave. */
const nextZone = (): GameView => ({ ...wave(), zone: 2, zoneName: 'Whisperwood', wave: 1 })

/**
 * Aldric kills the zone boss for a legendary robe, i1, and the burst clears zone 1 into
 * `advancedTo`. The log reads the batch as register hands it over: before any draw departs the boss.
 */
function killBoss(advancedTo: number): { log: MessageLog; t: StageTimeline; next: GameView } {
  const v = boss()
  const next = advancedTo > 1 ? nextZone() : { ...wave(), wave: 1 }
  const log = new MessageLog()
  const t = new StageTimeline()
  t.observe(v, NOW - 1)
  log.onEffects([], [], v, NOW - 1, 2000, t)
  const effects: Effect[] = [
    act('h1', 0),
    hit('h1', 'e9', 500),
    { k: 'drop', item: item('silk_robe', 'legendary', 'i1') },
    { k: 'zone_cleared', zone: 1, advancedTo },
  ]
  const starts = t.onEffects(effects, NOW, 2000)
  log.onEffects(effects, starts, next, NOW, 2000, t)
  return { log, t, next }
}

test("the zone line is held to the zone's show time and takes its place at release", () => {
  const { log, t, next } = killBoss(2)
  const zoneLine = 'The party reached zone 2, Whisperwood.'
  const show = t.zoneShowAt(1) ?? 0
  // The boss's drop reveals before its row leaves: its line lands first.
  expect(t.showAt('i1') ?? show).toBeLessThan(show)
  // A later tick's hit, in the new zone, once the drop's line has typed and while the zone line
  // is held.
  const tick = NOW + 3000
  expect(tick).toBeLessThan(show)
  const hitting: Effect[] = [act('h2', 0), hit('h2', 'e1', 4)]
  const [start = 0] = t.onEffects(hitting, tick, 2000)
  log.onEffects(hitting, [start], next, tick, 2000, t)
  // A draw departs the boss and schedules its dissolve and chest: the show time stands.
  t.observe(next, tick + 1)
  expect(t.zoneShowAt(1)).toBe(show)
  const texts = (now: number) => log.shown(now, 'still').map((l) => l.text)
  const before = texts(show - 1)
  expect(before).toContain('Legendary drop: Silk Robe.')
  expect(before).not.toContain(zoneLine)
  // The hit line after it is neither delayed nor dropped.
  const hitLine = log.upcoming(tick - 1, 1e9).find((l) => l.text.endsWith('for 4.'))
  expect(hitLine?.at).toBe(start)
  expect(log.upcoming(show - 1, 10_000)[0]).toMatchObject({ text: zoneLine, key: true, at: show })
  expect(log.isBusy(show - 1, 'still')).toBe(true)
  expect(texts(show).at(-1)).toBe(zoneLine)
  // Released, it stays in its place once the boss's row has gone.
  t.observe(next, show)
  expect(texts(show + 1).at(-1)).toBe(zoneLine)
})

test('the farming line is not held: it prints with its action', () => {
  const { log, t } = killBoss(1)
  const farming = log.upcoming(NOW - 1, 1e9).find((l) => l.text === 'Zone 1 cleared.')
  expect(farming).toBeDefined()
  expect(farming?.at ?? Number.POSITIVE_INFINITY).toBeLessThan(t.showAt('i1') ?? 0)
})

/** A drop toast as toastsFor gives it, waiting for its item. */
const dropToast = (itemId: string, text = 'Rare drop: Silk Robe'): Toast => ({
  row: 'rare_drop',
  text,
  timeoutMs: 4000,
  cue: 'drop',
  wait: { item: itemId },
})

/** A kill that drops a robe, i1, applied to a log and a timeline as register applies it. */
function killDropping(): { log: MessageLog; t: StageTimeline } {
  const v = terse()
  const by = v.heroes[0]?.id ?? ''
  const target = v.enemies[0]?.id ?? ''
  const after = { ...v, enemies: v.enemies.slice(1) }
  const { log, t } = run(
    [act(by, 0), hit(by, target, 30), { k: 'drop', item: item('silk_robe', 'rare', 'i1') }],
    { before: v, after },
  )
  return { log, t }
}

test('a held toast is released at its show time, once, and no read of the log releases it', () => {
  const { log, t } = killDropping()
  const show = t.showAt('i1') ?? 0
  expect(show).toBeGreaterThan(NOW + 1000)
  const toast = dropToast('i1')
  expect(log.hold([toast], t, NOW)).toEqual([])
  expect(log.nextRelease(NOW)).toBe(show)
  expect(log.isBusy(show - 1, 'still')).toBe(true)
  expect(log.release(show - 1)).toEqual([])
  // The reads that only look, even past the show time: the desktop's horizon among them.
  log.shown(show + 10, 'full')
  log.typing(show + 10, 'full')
  log.upcoming(show - 1, 10_000)
  log.isBusy(show + 10, 'full')
  expect(log.release(show)).toEqual([toast])
  expect(log.release(show + 1)).toEqual([])
  expect(log.nextRelease(show)).toBeNull()
})

test('a toast with no wait, a wait with no show time, or a show time past is answered at once', () => {
  const { log, t } = killDropping()
  const show = t.showAt('i1') ?? 0
  const plain: Toast = { row: 'level_up', text: 'Al reached level 2', timeoutMs: 4000, cue: null }
  const zone: Toast = {
    row: 'zone_arrival',
    text: 'The party reached zone 2',
    timeoutMs: 4000,
    cue: null,
    wait: { zone: 1 },
  }
  const unknown = dropToast('i-none', 'Rare drop: Oak Staff')
  const held = dropToast('i1')
  // In order, the held one left out.
  expect(log.hold([plain, held, zone, unknown], t, NOW)).toEqual([plain, zone, unknown])
  expect(log.hold([dropToast('i1', 'Again')], t, show)).toEqual([dropToast('i1', 'Again')])
  expect(log.release(show)).toEqual([held])
})

test('everything held is due at an infinite now, in show order', () => {
  const { log, t } = killDropping()
  const first = dropToast('i1')
  log.hold([first], t, NOW)
  expect(log.release(Number.POSITIVE_INFINITY)).toEqual([first])
  expect(log.nextRelease(NOW)).toBeNull()
})

test('a held toast whose chest a resync took away is due at once, not at the lost reveal', () => {
  const { log, t } = killDropping()
  const show = t.showAt('i1') ?? 0
  const toast = dropToast('i1')
  expect(log.hold([toast], t, NOW)).toEqual([])
  // The resync's view has the enemy back: its dissolve and its chest go.
  const back = NOW + 100
  expect(back).toBeLessThan(show)
  t.observe(terse(), back)
  expect(t.showAt('i1')).toBeNull()
  expect(log.nextRelease(back)).toBeNull()
  expect(log.release(back)).toEqual([toast])
})

test('a held toast follows its chest when the backlog re-times it', () => {
  const v = terse()
  const [h1] = v.heroes.map((h) => h.id)
  const [e1, e2] = v.enemies.map((e) => e.id)
  const log = new MessageLog()
  const t = new StageTimeline()
  t.observe(v, NOW - 1)
  log.onEffects([], [], v, NOW - 1, 2000, t)
  const queue = Array.from({ length: 6 }, () => [act(e2 ?? '', 0), hit(e2 ?? '', h1 ?? '', 1)])
  const first: Effect[] = [
    ...queue.flat(),
    act(h1 ?? '', 0),
    hit(h1 ?? '', e1 ?? '', 30),
    { k: 'drop', item: item('silk_robe') },
  ]
  const after = { ...v, enemies: v.enemies.slice(1) }
  log.onEffects(first, t.onEffects(first, NOW, 2000), after, NOW, 2000, t)
  t.observe(after, NOW + 1)
  const toast = dropToast('i1')
  expect(log.hold([toast], t, NOW)).toEqual([])
  const planned = t.showAt('i1') ?? 0
  const cut = NOW + 2500
  const next = Array.from({ length: 10 }, () => act(e2 ?? '', 0))
  log.onEffects(next, t.onEffects(next, cut, 2000), after, cut, 2000, t)
  const moved = t.showAt('i1') ?? 0
  expect(moved).toBeLessThan(planned)
  expect(log.nextRelease(cut)).toBe(moved)
  expect(log.release(moved - 1)).toEqual([])
  expect(log.release(moved)).toEqual([toast])
})

test('a held drop line follows its chest when the backlog re-times it', () => {
  const v = terse()
  const [h1] = v.heroes.map((h) => h.id)
  const [e1, e2] = v.enemies.map((e) => e.id)
  const log = new MessageLog()
  const t = new StageTimeline()
  t.observe(v, NOW - 1)
  log.onEffects([], [], v, NOW - 1, 2000, t)
  // Six attacks queue ahead of the blow that kills e1 and drops a robe.
  const queue = Array.from({ length: 6 }, () => [act(e2 ?? '', 0), hit(e2 ?? '', h1 ?? '', 1)])
  const first: Effect[] = [
    ...queue.flat(),
    act(h1 ?? '', 0),
    hit(h1 ?? '', e1 ?? '', 30),
    { k: 'drop', item: item('silk_robe') },
  ]
  const after = { ...v, enemies: v.enemies.slice(1) }
  log.onEffects(first, t.onEffects(first, NOW, 2000), after, NOW, 2000, t)
  t.observe(after, NOW + 1)
  const planned = t.showAt('i1') ?? 0
  // The next round's actions put the stage two rounds behind: the killing blow goes with the
  // queue and the chest lands sooner. They hit nothing, so they print nothing.
  const cut = NOW + 2500
  const next = Array.from({ length: 10 }, () => act(e2 ?? '', 0))
  log.onEffects(next, t.onEffects(next, cut, 2000), after, cut, 2000, t)
  const moved = t.showAt('i1') ?? 0
  expect(moved).toBeLessThan(planned)
  const drop = (now: number) =>
    log.shown(now, 'still').some((l) => l.text === 'Rare drop: Silk Robe.')
  expect(drop(moved - 1)).toBe(false)
  expect(drop(moved)).toBe(true)
})

test("a drop line due after the next tick's lines are queued takes its place at its show time", () => {
  const v = terse()
  const [h1, h2, h3] = v.heroes.map((h) => h.id ?? '')
  const [e1, e2] = v.enemies.map((e) => e.id ?? '')
  const after = { ...v, enemies: v.enemies.slice(1) }
  const log = new MessageLog()
  const t = new StageTimeline()
  t.observe(v, NOW - 1)
  log.onEffects([], [], v, NOW - 1, 2000, t)
  // The kill late in its tick: its reveal comes after the next tick's batch is queued.
  const first: Effect[] = [
    act(h1 ?? '', 500),
    hit(h1 ?? '', e1 ?? '', 30),
    { k: 'drop', item: item('silk_robe') },
  ]
  log.onEffects(first, t.onEffects(first, NOW, 2000), after, NOW, 2000, t)
  t.observe(after, NOW + 1)
  const second: Effect[] = [
    act(h2 ?? '', 0),
    hit(h2 ?? '', e2 ?? '', 4),
    act(e2 ?? '', 500),
    hit(e2 ?? '', h2 ?? '', 3),
    act(h3 ?? '', 1000),
    hit(h3 ?? '', e2 ?? '', 2),
  ]
  const starts = t.onEffects(second, NOW + 2000, 2000)
  log.onEffects(second, starts, after, NOW + 2000, 2000, t)
  const show = t.showAt('i1') ?? 0
  expect(show).toBeGreaterThan(starts[0] ?? 0)
  expect(show).toBeLessThan(starts[1] ?? 0)
  const lines = log.upcoming(NOW + 1999, 1e9)
  const at = (text: string) => lines.find((l) => l.text === text)?.at
  // The drop line types at its show time, or as soon as the line ahead of it has typed.
  const drop = at('Rare drop: Silk Robe.') ?? 0
  expect(drop).toBeGreaterThanOrEqual(show)
  expect(drop).toBeLessThan(starts[1] ?? 0)
  // The line queued by the show time keeps its time; the one after it moves back, not out.
  expect(at('Bo hits Rat for 4.')).toBe(starts[0])
  const moved = at('Rat hits Bo for 3.') ?? 0
  expect(moved).toBeGreaterThanOrEqual(drop + LINE_MIN_MS)
  expect(moved).toBeLessThan((starts[1] ?? 0) + 2000)
  expect(at('Cy hits Rat for 2.')).toBeDefined()
  for (let i = 1; i < lines.length; i++)
    expect((lines[i]?.at ?? 0) - (lines[i - 1]?.at ?? 0)).toBeGreaterThanOrEqual(LINE_MIN_MS)
  expect(log.shown(drop, 'still').map((l) => l.text)).toContain('Rare drop: Silk Robe.')
  expect(log.shown(drop, 'still').map((l) => l.text)).not.toContain('Rat hits Bo for 3.')
})

test('at the idle cadence a drop line slots into the gap and moves nothing', () => {
  const v = terse()
  const [h1, h2, h3] = v.heroes.map((h) => h.id ?? '')
  const [e1, e2, e3] = v.enemies.map((e) => e.id ?? '')
  const after = { ...v, enemies: v.enemies.slice(1) }
  const { log, t, starts } = run(
    [
      act(h1 ?? '', 0),
      hit(h1 ?? '', e1 ?? '', 30),
      { k: 'drop', item: item('silk_robe') },
      act(e2 ?? '', 500),
      hit(e2 ?? '', h2 ?? '', 1),
      act(e3 ?? '', 1000),
      hit(e3 ?? '', h3 ?? '', 1),
      act(h2 ?? '', 1500),
      hit(h2 ?? '', e2 ?? '', 2),
    ],
    { before: v, after, cadence: 5000 },
  )
  const show = t.showAt('i1') ?? 0
  const lines = log.upcoming(NOW - 1, 1e9)
  const at = (text: string) => lines.find((l) => l.text === text)?.at
  expect(at('Rare drop: Silk Robe.')).toBe(show)
  expect(at('Al hits Rat for 30.')).toBe(starts[0])
  expect(at('Rat hits Bo for 1.')).toBe(starts[1])
  expect(at('Rat hits Cy for 1.')).toBe(starts[2])
  expect(at('Bo hits Rat for 2.')).toBe(starts[3])
})
