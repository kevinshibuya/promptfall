import { expect, test } from 'claude-code/testing'
import type { Effect } from '../vendor/sim.js'
import { boss, wave, worldBoss } from './fixtures'
import { type Motion, StageTimeline } from './timeline'
import {
  DISSOLVE_MS,
  DROP_MS,
  FLASH_MS,
  HIT_STAGGER_MS,
  LUNGE_MS,
  SPAWN_MS,
  STAGE_BOSS_ROWS,
  STAGE_REST_ROWS,
} from './tuning'

const NOW = 1_000_000
const hit = (by: string, target: string, amount = 5): Effect => ({ k: 'hit', by, target, amount })
const item = (base: string) => ({
  id: 'i1',
  base,
  rarity: 'rare' as const,
  affixes: [],
  equippedBy: null,
  tradeableAt: null,
})
const of = (motions: readonly Motion[], kind: Motion['kind']) =>
  motions.filter((m) => m.kind === kind)

function observed(view = wave()): StageTimeline {
  const t = new StageTimeline()
  t.observe(view, NOW)
  return t
}

test('the first observe assigns slots and starts nothing', () => {
  const t = observed()
  expect(t.active(NOW)).toEqual([])
  expect(t.known().map((k) => [k.id, k.slot])).toEqual([
    ['e1', 0],
    ['e2', 1],
    ['e3', 2],
  ])
  expect(t.isBusy(NOW)).toBe(false)
})

test('hits in one call stagger their lunges, flashes and numbers', () => {
  const t = observed()
  t.onEffects([hit('h1', 'e1'), hit('e2', 'h2'), hit('h3', 'e3'), hit('h1', 'e1')], NOW)
  const lunges = of(t.active(NOW), 'lunge')
  expect(lunges.map((m) => m.from)).toEqual([0, 1, 2, 3].map((i) => NOW + i * HIT_STAGGER_MS))
  expect(lunges.map((m) => (m.kind === 'lunge' ? m.dir : 0))).toEqual([-1, 1, -1, -1])
  const flashes = of(t.active(NOW), 'flash')
  expect(flashes.map((m) => m.from)).toEqual(
    [0, 1, 2, 3].map((i) => NOW + i * HIT_STAGGER_MS + LUNGE_MS / 2),
  )
  expect(of(t.active(NOW), 'number').map((m) => m.actor)).toEqual(['e1', 'h2', 'e3', 'e1'])
})

test('a departed enemy dissolves after its last flash and keeps its slot until then', () => {
  const t = observed()
  t.onEffects([hit('h1', 'e1')], NOW)
  const flashEnd = NOW + LUNGE_MS / 2 + FLASH_MS
  const v = wave()
  v.enemies = v.enemies.filter((e) => e.id !== 'e1')
  t.observe(v, NOW + 10)
  const dissolve = of(t.active(NOW + 10), 'dissolve')
  expect(dissolve).toEqual([
    { kind: 'dissolve', actor: 'e1', from: flashEnd, until: flashEnd + DISSOLVE_MS },
  ])
  expect(t.known().find((k) => k.id === 'e1')?.slot).toBe(0)
  t.observe(v, flashEnd + DISSOLVE_MS)
  expect(t.known().map((k) => k.id)).toEqual(['e2', 'e3'])
})

test('survivors keep their slots and a newcomer takes the lowest free one, with a spawn', () => {
  const t = observed()
  const v = wave()
  v.enemies = v.enemies.filter((e) => e.id !== 'e1')
  t.observe(v, NOW)
  t.observe(v, NOW + DISSOLVE_MS)
  v.enemies.push({
    id: 'e4',
    def: 'road_slime',
    name: 'Road Slime',
    glyph: 'T',
    hp: 9,
    maxHp: 9,
    kind: 'wave',
  })
  t.observe(v, NOW + DISSOLVE_MS + 1)
  expect(t.known().map((k) => [k.id, k.slot])).toEqual([
    ['e4', 0],
    ['e2', 1],
    ['e3', 2],
  ])
  expect(of(t.active(NOW + DISSOLVE_MS + 1), 'spawn')).toEqual([
    {
      kind: 'spawn',
      actor: 'e4',
      from: NOW + DISSOLVE_MS + 1,
      until: NOW + DISSOLVE_MS + 1 + SPAWN_MS,
    },
  ])
})

test('rowsAt holds the boss height through the dissolve, then rests', () => {
  const t = observed(boss())
  expect(t.rowsAt(boss(), NOW)).toBe(STAGE_BOSS_ROWS)
  const after = boss()
  after.enemies = []
  t.observe(after, NOW)
  expect(t.rowsAt(after, NOW + DISSOLVE_MS / 2)).toBe(STAGE_BOSS_ROWS)
  expect(t.rowsAt(after, NOW + DISSOLVE_MS)).toBe(STAGE_REST_ROWS)
})

test('a drop pops from the target of the hit before it', () => {
  const t = observed()
  t.onEffects([hit('h1', 'e3'), { k: 'drop', item: item('iron_sword') }], NOW)
  const drop = of(t.active(NOW), 'drop')[0]
  expect(drop).toMatchObject({ actor: 'e3', item: 'item:iron_sword' })
  expect(drop?.from).toBe(NOW + LUNGE_MS / 2 + FLASH_MS)
  expect(drop?.until).toBe((drop?.from ?? 0) + DROP_MS)
  expect(t.known().find((k) => k.id === 'e3')?.slot).toBe(2)
  const t2 = observed()
  t2.onEffects([hit('h2', 'e2'), { k: 'drop_vendored', item: item('iron_sword'), gold: 3 }], NOW)
  expect(of(t2.active(NOW), 'drop')[0]?.actor).toBe('e2')
})

test('a hit naming an unknown actor is dropped', () => {
  const t = observed()
  t.onEffects([hit('nobody', 'ghost')], NOW)
  expect(t.active(NOW)).toEqual([])
})

test('a departed world boss still knows its sprite', () => {
  const t = observed(worldBoss())
  const after = worldBoss()
  after.enemies = []
  t.observe(after, NOW)
  expect(t.known()[0]?.spriteId).toBe('world_boss:the_promptwyrm')
})

test('isBusy is false once every motion ends', () => {
  const t = observed()
  t.onEffects([hit('h1', 'e1')], NOW)
  expect(t.isBusy(NOW)).toBe(true)
  const end = Math.max(...t.active(NOW).map((m) => m.until))
  expect(t.isBusy(end - 1)).toBe(true)
  expect(t.isBusy(end)).toBe(false)
})

test('an id that comes back as another enemy is a new actor: the world boss is not drawn as the slime', () => {
  // A primary session predicts ahead of the server: once boss_engaged is replayed under its
  // ticks, the boss can take the id the predicted slime had.
  const t = new StageTimeline()
  const slime = wave()
  slime.enemies = slime.enemies.slice(2, 3).map((e) => ({ ...e, id: 'e25' }))
  t.observe(slime, 1_000)
  const engaged = worldBoss()
  engaged.enemies = engaged.enemies.slice(0, 1).map((e) => ({ ...e, id: 'e25' }))
  t.observe(engaged, 2_000)
  const known = t.known().find((k) => k.id === 'e25')
  expect(known?.spriteId).toBe('world_boss:the_promptwyrm')
  expect(known?.kind).toBe('world_boss')
  expect(t.active(2_000).some((m) => m.kind === 'spawn' && m.actor === 'e25')).toBe(true)
})

test('an enemy that comes back after leaving is live again: no dissolve, not departed', () => {
  // A resync can bring back an enemy the local prediction had killed, same id and def.
  const t = new StageTimeline()
  const w = wave()
  t.observe(w, 1_000)
  const gone = wave()
  gone.enemies = gone.enemies.filter((e) => e.id !== 'e3')
  t.observe(gone, 2_000)
  expect(t.isDeparted('e3')).toBe(true)
  t.observe(w, 2_100)
  expect(t.isDeparted('e3')).toBe(false)
  expect(t.active(2_100).some((m) => m.actor === 'e3' && m.kind === 'dissolve')).toBe(false)
  expect(t.known().find((k) => k.id === 'e3')?.slot).toBe(2)
})

test('motions that ended are pruned as effects land, even while nothing observes', () => {
  // On the Loot or World tab, or with the band off, nothing calls observe.
  const t = new StageTimeline()
  t.observe(wave(), 1_000)
  for (let i = 0; i < 500; i++) {
    t.onEffects([{ k: 'hit', by: 'h1', target: 'e1', amount: 1 }] as Effect[], 2_000 + i * 2_000)
  }
  const motions = (t as unknown as { motions: unknown[] }).motions
  expect(motions.length).toBeLessThan(20)
})
