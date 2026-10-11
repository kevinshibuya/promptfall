import { expect, test } from 'claude-code/testing'
import type { GameView, WorldState } from '../../types'
import { WORLD_DEFAULT } from '../state'
import type { Effect } from '../vendor/sim.js'
import { boss, wave, worldBoss } from './fixtures'
import { landingsWithin, stagedState } from './staged'
import { StageTimeline } from './timeline'
import { DISSOLVE_MS, WAVE_GAP_MS } from './tuning'

const NOW = 1_000_000

/** `actor` acts at `now` and hits `target` for `amount`; answers the hit's impact. */
function strike(t: StageTimeline, actor: string, target: string, amount: number, now = NOW) {
  const effects: Effect[] = [
    { k: 'act', actor, action: 'attack', at: 0 },
    { k: 'hit', by: actor, target, amount },
  ]
  const [start = now] = t.onEffects(effects, now, 2000)
  const number = t.active(start).find((m) => m.kind === 'number' && m.actor === target)
  return number?.from ?? Number.NaN
}

const withHero = (view: GameView, id: string, hp: number): GameView => ({
  ...view,
  heroes: view.heroes.map((h) => (h.id === id ? { ...h, hp, alive: hp > 0 } : h)),
})

test('a pending kill: the hero stands with his HP until the blow lands, then is down at zero', () => {
  const before = withHero(wave(), 'h1', 7)
  const t = new StageTimeline()
  t.observe(before, NOW - 1)
  const impact = strike(t, 'e1', 'h1', 20)
  // The sim has applied the tick: the hero is dead in the view.
  const view = withHero(wave(), 'h1', 0)
  t.observe(view, NOW)
  const hero = (now: number) => stagedState(view, WORLD_DEFAULT, t, now).heroes[0]
  expect(hero(impact - 1)).toMatchObject({ id: 'h1', hp: 7, alive: true })
  expect(hero(impact)).toMatchObject({ id: 'h1', hp: 0, alive: false })
})

test('a departed monster keeps its row, in arrival order, its HP staged, until the timeline lets it go', () => {
  const t = new StageTimeline()
  t.observe(wave(), NOW - 1)
  const impact = strike(t, 'h1', 'e1', 50)
  // The tick killed the Goblin Scout (42 HP): the view has dropped it.
  const view: GameView = { ...wave(), enemies: wave().enemies.filter((e) => e.id !== 'e1') }
  t.observe(view, NOW)
  const rows = (now: number) =>
    stagedState(view, WORLD_DEFAULT, t, now).enemies.map((e) => [e.name, e.hp])
  expect(rows(impact - 1)).toEqual([
    ['Goblin Scout', 42],
    ['Field Rat', 10],
    ['Road Slime', 30],
  ])
  expect(rows(impact)).toEqual([
    ['Goblin Scout', 0],
    ['Field Rat', 10],
    ['Road Slime', 30],
  ])
  // Its dissolve over, the next observe lets it go.
  const gone = impact + 1_000 + DISSOLVE_MS + WAVE_GAP_MS
  t.observe(view, gone)
  expect(rows(gone)).toEqual([
    ['Field Rat', 10],
    ['Road Slime', 30],
  ])
})

test('the wave and zone hold while a departed enemy of them is held; newcomers wait for the timeline', () => {
  const t = new StageTimeline()
  t.observe(boss(), NOW - 1)
  const impact = strike(t, 'h1', 'e9', 500)
  // The zone boss fell: the sim moved on to zone 2, wave 1, and brought the next wave.
  const next: GameView = { ...wave(), zone: 2, zoneName: 'Whisperwood', wave: 1 }
  t.observe(next, NOW)
  const at = (now: number) => {
    const s = stagedState(next, WORLD_DEFAULT, t, now)
    return {
      zone: s.zone,
      zoneName: s.zoneName,
      wave: s.wave,
      enemies: s.enemies.map((e) => e.name),
    }
  }
  const held = { zone: 1, zoneName: 'Greenmeadow Road', wave: 11, enemies: ['Bandit Captain'] }
  expect(at(impact - 1)).toEqual(held)
  expect(at(impact + DISSOLVE_MS)).toEqual(held)
  // The boss gone and the pause over, the newcomers step on and the encounter is the view's.
  const later = impact + 1_000 + DISSOLVE_MS + WAVE_GAP_MS
  t.observe(next, later)
  expect(at(later)).toEqual({
    zone: 2,
    zoneName: 'Whisperwood',
    wave: 1,
    enemies: ['Goblin Scout', 'Field Rat', 'Road Slime'],
  })
})

test("a zone boss's chest plays whole: the zone and wave hold through its reveal", () => {
  const t = new StageTimeline()
  t.observe(boss(), NOW - 1)
  t.onEffects(
    [
      { k: 'act', actor: 'h1', action: 'attack', at: 0 },
      { k: 'hit', by: 'h1', target: 'e9', amount: 500 },
      {
        k: 'drop',
        item: {
          id: 'i1',
          base: 'iron_sword',
          rarity: 'legendary',
          affixes: [],
          equippedBy: null,
          tradeableAt: null,
        },
      },
    ],
    NOW,
    2000,
  )
  // The zone boss fell: the sim moved on to zone 2, wave 1, and brought the next wave.
  const next: GameView = { ...wave(), zone: 2, zoneName: 'Whisperwood', wave: 1 }
  t.observe(next, NOW)
  const at = (now: number) => {
    const s = stagedState(next, WORLD_DEFAULT, t, now)
    return { zone: s.zone, wave: s.wave, enemies: s.enemies.map((e) => e.name) }
  }
  const shown = t.showAt('i1') ?? 0
  const ended = endOf(t, 'e9', 'chest')
  const held = { zone: 1, wave: 11, enemies: ['Bandit Captain'] }
  // Redraws through the reveal neither cut the chest nor let the next zone's wave on.
  for (const now of [shown, ended - 1]) {
    t.observe(next, now)
    expect(at(now)).toEqual(held)
    expect(endOf(t, 'e9', 'chest', now)).toBe(ended)
  }
  t.observe(next, ended + WAVE_GAP_MS)
  expect(at(ended + WAVE_GAP_MS)).toEqual({
    zone: 2,
    wave: 1,
    enemies: ['Goblin Scout', 'Field Rat', 'Road Slime'],
  })
})

/** A poll of The Promptwyrm at `hp`, this party's committed tally `committed` at the time. */
const polled = (hp: number, committed: number): WorldState => ({
  ...WORLD_DEFAULT,
  snapshot: {
    serverNow: NOW,
    speed: 1,
    online: 1,
    zones: [],
    here: [],
    boss: {
      bossId: 'wb1',
      name: 'The Promptwyrm',
      glyph: 'W',
      maxHp: 90_000,
      hp,
      spawnedAt: NOW - 3_600_000,
      endsAt: NOW + 660_000,
      yours: committed,
    },
    chat: [],
    flags: {},
  },
  committedDealt: { bossId: 'wb1', dealt: committed },
})

test('the world boss bar is the poll less what this party has landed since its baseline, a fresh poll mid-animation included', () => {
  const t = new StageTimeline()
  t.observe(worldBoss(), NOW - 1)
  const impact = strike(t, 'h1', 'e7', 100)
  // The tick dealt 100 more: 1,300 in all, 1,000 of it committed at the last poll.
  const view: GameView = {
    ...worldBoss(),
    enemies: worldBoss().enemies.map((e) => ({ ...e, hp: e.hp - 100 })),
    boss: { bossId: 'wb1', name: 'The Promptwyrm', glyph: '☠', dealt: 1_300 },
  }
  t.observe(view, NOW)
  const bar = (world: WorldState, now: number) => {
    const row = stagedState(view, world, t, now).enemies.find((e) => e.kind === 'world_boss')
    return [row?.hp, row?.maxHp]
  }
  // 55,800 at the poll, less the 200 landed past the 1,000 committed; the 100 lands at impact.
  const old = polled(55_800, 1_000)
  expect(bar(old, impact - 1)).toEqual([55_600, 90_000])
  expect(bar(old, impact)).toEqual([55_500, 90_000])
  // A poll after the submit already counts the 100 still in the air: the bar does not lead it.
  const fresh = polled(55_500, 1_300)
  expect(bar(fresh, impact - 1)).toEqual([55_600, 90_000])
  expect(bar(fresh, impact)).toEqual([55_500, 90_000])
})

test('a hit on the world boss lands whole on its bar, past the local row’s HP', () => {
  const t = new StageTimeline()
  // The sim's world boss row is an undying 630 HP; the party's tally counts every hit whole.
  t.observe(worldBoss(), NOW - 1)
  const effects: Effect[] = [
    { k: 'act', actor: 'h1', action: 'attack', at: 0 },
    { k: 'hit', by: 'h1', target: 'e7', amount: 500 },
    { k: 'hit', by: 'h1', target: 'e7', amount: 400 },
  ]
  t.onEffects(effects, NOW, 2000)
  const impact = t.active(NOW).find((m) => m.kind === 'number' && m.actor === 'e7')?.from ?? 0
  const view: GameView = {
    ...worldBoss(),
    boss: { bossId: 'wb1', name: 'The Promptwyrm', glyph: '☠', dealt: 900 },
  }
  t.observe(view, NOW)
  const bar = (now: number) =>
    stagedState(view, polled(55_800, 0), t, now).enemies.find((e) => e.kind === 'world_boss')?.hp
  expect([bar(impact - 1), bar(impact)]).toEqual([55_800, 54_900])
})

test('a hero’s HP drops when the hit lands on the stage, not when the sim applies it (#20)', () => {
  const hpAround = (before: number, amount: number) => {
    const t = new StageTimeline()
    t.observe(withHero(wave(), 'h1', before), NOW - 1)
    const impact = strike(t, 'e1', 'h1', amount)
    const view = withHero(wave(), 'h1', Math.max(0, before - amount))
    t.observe(view, NOW)
    return [impact - 1, impact].map((now) => stagedState(view, WORLD_DEFAULT, t, now).heroes[0]?.hp)
  }
  expect(hpAround(50, 5)).toEqual([50, 45])
  // A killing blow over the HP left shows the HP left until it lands, never more.
  expect(hpAround(3, 10)).toEqual([3, 0])
})

test('the landings inside a horizon, per actor, in time order', () => {
  const t = new StageTimeline()
  t.observe(wave(), NOW - 1)
  const effects: Effect[] = [
    { k: 'act', actor: 'e1', action: 'attack', at: 0 },
    { k: 'hit', by: 'e1', target: 'h1', amount: 5 },
    { k: 'act', actor: 'e2', action: 'attack', at: 600 },
    { k: 'hit', by: 'e2', target: 'h1', amount: 4 },
    { k: 'act', actor: 'h3', action: 'heal', at: 1200 },
    { k: 'heal', by: 'h3', target: 'h2', amount: 6 },
  ]
  t.onEffects(effects, NOW, 2000)
  const numbers = t
    .active(NOW)
    .filter((m) => m.kind === 'number')
    .map((m) => m.from)
  const [first = 0, second = 0, third = 0] = numbers
  expect(first < second && second < third).toBe(true)
  // The horizon reaches the second hit but not the heal.
  const within = landingsWithin(t, NOW, second - NOW)
  expect(Object.fromEntries(within)).toEqual({
    h1: [
      { at: first, delta: -5 },
      { at: second, delta: -4 },
    ],
  })
  // Past the first landing, only the second is still to come.
  expect(landingsWithin(t, first, third - first).get('h1')).toEqual([{ at: second, delta: -4 }])
  expect(landingsWithin(t, first, third - first).get('h2')).toEqual([{ at: third, delta: 6 }])
})

/** When `actor`'s `kind` motion ends; NaN when it has none. */
const endOf = (t: StageTimeline, actor: string, kind: string, now = NOW) =>
  t.active(now).find((m) => m.actor === actor && m.kind === kind)?.until ?? Number.NaN

test('a wipe: each hero stands until his blow lands, lies fallen while the field clears, and is up at full once it has', () => {
  const before = withHero(withHero(withHero(wave(), 'h1', 7), 'h2', 5), 'h3', 3)
  const t = new StageTimeline()
  t.observe(before, NOW - 1)
  const impacts = [strike(t, 'e1', 'h1', 20), strike(t, 'e2', 'h2', 20), strike(t, 'e3', 'h3', 20)]
  // The sim wiped: the party is healed in place and the encounter is gone.
  const view: GameView = { ...wave(), enemies: [] }
  t.observe(view, NOW)
  const heroes = (now: number) =>
    stagedState(view, WORLD_DEFAULT, t, now).heroes.map((h) => [h.hp, h.alive])
  const rows = (now: number) => stagedState(view, WORLD_DEFAULT, t, now).enemies.map((e) => e.hp)
  const [i1 = 0, i2 = 0, i3 = 0] = impacts
  expect(heroes(i1 - 1)).toEqual([
    [7, true],
    [5, true],
    [3, true],
  ])
  expect(heroes(i2 - 1)).toEqual([
    [0, false],
    [5, true],
    [3, true],
  ])
  expect(heroes(i3)).toEqual([
    [0, false],
    [0, false],
    [0, false],
  ])
  // The monsters left alive: their rows keep their HP through the fade, the last one's after its blow.
  const cleared = endOf(t, 'e3', 'dissolve')
  expect(rows(i3)).toEqual([42, 10, 30])
  expect(heroes(cleared - 1)).toEqual([
    [0, false],
    [0, false],
    [0, false],
  ])
  expect(heroes(cleared)).toEqual([
    [50, true],
    [50, true],
    [50, true],
  ])
})

test('a wave clear: the hero killed in the clearing tick is down from his blow until the killer has faded and its chest played, then up at 15%', () => {
  const lone: GameView = { ...wave(), enemies: wave().enemies.slice(0, 1) }
  const t = new StageTimeline()
  t.observe(withHero(lone, 'h3', 5), NOW - 1)
  const felled = strike(t, 'e1', 'h3', 20)
  t.onEffects(
    [
      { k: 'act', actor: 'h1', action: 'attack', at: 0 },
      { k: 'hit', by: 'h1', target: 'e1', amount: 50 },
      {
        k: 'drop',
        item: {
          id: 'i1',
          base: 'iron_sword',
          rarity: 'rare',
          affixes: [],
          equippedBy: null,
          tradeableAt: null,
        },
      },
    ],
    NOW,
    2000,
  )
  const killed = t.active(NOW).find((m) => m.kind === 'number' && m.actor === 'e1')?.from ?? 0
  // The wave is clear: the fallen hero is revived at 15% (7 of 50).
  const view: GameView = withHero({ ...lone, enemies: [] }, 'h3', 7)
  t.observe(view, NOW)
  const dropped = endOf(t, 'e1', 'chest')
  const h3 = (now: number) => stagedState(view, WORLD_DEFAULT, t, now).heroes[2]
  const e1 = (now: number) => stagedState(view, WORLD_DEFAULT, t, now).enemies[0]?.hp
  expect(h3(felled - 1)).toMatchObject({ hp: 5, alive: true })
  expect(h3(felled)).toMatchObject({ hp: 0, alive: false })
  expect(e1(killed - 1)).toBe(42)
  expect(e1(killed)).toBe(0)
  expect(h3(dropped - 1)).toMatchObject({ hp: 0, alive: false })
  expect(h3(dropped)).toMatchObject({ hp: 7, alive: true })
})

test('an enemy cleared alive keeps its last HP through its fade, and fades after its own last blow', () => {
  const t = new StageTimeline()
  t.observe(wave(), NOW - 1)
  const hit = strike(t, 'h1', 'e1', 10)
  strike(t, 'e1', 'h1', 5)
  const lunged = endOf(t, 'e1', 'lunge')
  // A sandbox wipe of the encounter: every monster leaves the view alive.
  const view: GameView = { ...withHero(wave(), 'h1', 45), enemies: [] }
  t.observe(view, NOW)
  const rows = (now: number) => stagedState(view, WORLD_DEFAULT, t, now).enemies.map((e) => e.hp)
  expect(rows(hit - 1)).toEqual([42, 10, 30])
  expect(rows(hit)).toEqual([32, 10, 30])
  const dissolve = t.active(NOW).find((m) => m.actor === 'e1' && m.kind === 'dissolve')
  expect(dissolve?.from).toBe(lunged)
  expect(rows((dissolve?.until ?? 0) - 1)[0]).toBe(32)
})

test('a state change with nothing in flight lands at once', () => {
  const t = new StageTimeline()
  t.observe(withHero(wave(), 'h1', 7), NOW - 1)
  // A rest: the sim healed the hero, and no blow is on the timeline.
  const view = wave()
  t.observe(view, NOW)
  expect(stagedState(view, WORLD_DEFAULT, t, NOW).heroes[0]).toMatchObject({ hp: 50, alive: true })
})

test('a drop row waits for its reveal; a market row never does', () => {
  const t = new StageTimeline()
  t.observe(wave(), NOW - 1)
  const item = (id: string, base: string) =>
    ({ id, base, rarity: 'rare', affixes: [], equippedBy: null, tradeableAt: null }) as never
  // A drop and a vendored drop: their chests fall on the front enemy now and show together.
  t.onEffects(
    [
      { k: 'drop', item: item('i1', 'silk_robe') },
      { k: 'drop_vendored', item: item('i2', 'oak_staff'), gold: 3 },
    ],
    NOW,
  )
  const show = t.showAt('i1') ?? 0
  // The old sword's chest is long gone: no chest on the timeline holds it.
  const old = { text: 'old sword', rarity: 'common', kind: 'drop', itemId: 'i0' } as const
  const robe = { text: 'robe', rarity: 'rare', kind: 'drop', itemId: 'i1' } as const
  const staff = { text: 'staff sold', rarity: 'rare', kind: 'vendored', itemId: 'i2' } as const
  const bought = { text: 'bought ring', rarity: 'rare', kind: 'market', itemId: null } as const
  const view: GameView = { ...wave(), loot: [old, robe, staff, bought], lastDrop: bought }
  const rows = (now: number) => stagedState(view, WORLD_DEFAULT, t, now).loot.map((l) => l.text)
  expect(rows(show - 1)).toEqual(['old sword', 'bought ring'])
  expect(rows(show)).toEqual(['old sword', 'robe', 'staff sold', 'bought ring'])
  // The band's last drop is the staged rows' newest.
  const drops: GameView = { ...wave(), loot: [old, robe, staff], lastDrop: staff }
  const last = (now: number) => stagedState(drops, WORLD_DEFAULT, t, now).lastDrop?.text
  expect(last(show - 1)).toBe('old sword')
  expect(last(show)).toBe('staff sold')
})

const lootItem = (id: string) =>
  ({
    id,
    base: 'silk_robe',
    rarity: 'rare',
    affixes: [],
    equippedBy: null,
    tradeableAt: null,
  }) as never

test('a row waits for its own reveal: a contract sale beside a boss drop shows at once', () => {
  const t = new StageTimeline()
  t.observe(wave(), NOW - 1)
  t.onEffects([{ k: 'drop', item: lootItem('i1') }], NOW)
  const show = t.showAt('i1') ?? 0
  const robe = { text: 'robe', rarity: 'rare', kind: 'drop', itemId: 'i1' } as const
  const contract = {
    text: 'Hero contract sold for 90g',
    rarity: 'rare',
    kind: 'market',
    itemId: 'hero9',
  } as const
  const view: GameView = { ...wave(), loot: [robe, contract], lastDrop: contract }
  const staged = (now: number) => stagedState(view, WORLD_DEFAULT, t, now)
  expect(staged(show - 1).loot.map((l) => l.text)).toEqual(['Hero contract sold for 90g'])
  expect(staged(show - 1).lastDrop?.text).toBe('Hero contract sold for 90g')
  expect(staged(show).loot.map((l) => l.text)).toEqual(['robe', 'Hero contract sold for 90g'])
})

test("a lone drop that reveals before a queued kill's chest shows first", () => {
  const t = new StageTimeline()
  t.observe(wave(), NOW - 1)
  // A backlog of enemy actions, then the kill: its chest waits behind them.
  t.onEffects(
    [
      { k: 'act', actor: 'e2', action: 'attack', at: 0 },
      { k: 'hit', by: 'e2', target: 'h1', amount: 1 },
      { k: 'act', actor: 'e2', action: 'attack', at: 500 },
      { k: 'hit', by: 'e2', target: 'h1', amount: 1 },
      { k: 'act', actor: 'e2', action: 'attack', at: 1000 },
      { k: 'hit', by: 'e2', target: 'h1', amount: 1 },
      { k: 'act', actor: 'h1', action: 'attack', at: 1500 },
      { k: 'hit', by: 'h1', target: 'e1', amount: 60 },
      { k: 'drop', item: lootItem('i1') },
    ],
    NOW,
  )
  // A sandbox item: a lone drop, its chest on the front enemy at once.
  t.onEffects([{ k: 'drop', item: lootItem('i2') }], NOW + 10)
  const show1 = t.showAt('i1') ?? 0
  const show2 = t.showAt('i2') ?? 0
  expect(show2).toBeLessThan(show1)
  const first = { text: 'first', rarity: 'rare', kind: 'drop', itemId: 'i1' } as const
  const second = { text: 'second', rarity: 'rare', kind: 'drop', itemId: 'i2' } as const
  const view: GameView = { ...wave(), loot: [first, second], lastDrop: second }
  const staged = (now: number) => stagedState(view, WORLD_DEFAULT, t, now)
  expect(staged(show2 - 1).loot).toEqual([])
  expect(staged(show2).loot.map((l) => l.text)).toEqual(['second'])
  expect(staged(show2).lastDrop?.text).toBe('second')
  expect(staged(show1).loot.map((l) => l.text)).toEqual(['first', 'second'])
})
