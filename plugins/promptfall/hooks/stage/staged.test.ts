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
