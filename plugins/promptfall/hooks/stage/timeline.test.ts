import { expect, test } from 'claude-code/testing'
import type { GameView } from '../../types'
import { WORLD_DEFAULT } from '../state'
import { ACTION_STEPS, type Effect, type Rarity, STEP_MS } from '../vendor/sim.js'
import { boss, empty, wave, worldBoss } from './fixtures'
import { stagedState } from './staged'
import { ACTION_MS, chestPhaseAt, type Motion, StageTimeline } from './timeline'
import {
  BOLT_MS,
  BOSS_MIN_ROWS,
  BURST_MS,
  DISSOLVE_MS,
  FLASH_MS,
  LUNGE_MS,
  NUMBER_MS,
  NUMBER_RGB_HEAL,
  SLIDE_MS,
  SPAWN_MS,
  STAGE_MIN_ROWS,
  STAGE_ROWS,
  STEP_OUT_MS,
  WAVE_GAP_MS,
  WINDUP_HOLD_MS,
  WINDUP_MS,
} from './tuning'

const NOW = 1_000_000
/** Every attack holds its wind-up this long before it moves. */
const H = WINDUP_HOLD_MS
const hit = (by: string, target: string, amount = 5): Effect => ({ k: 'hit', by, target, amount })
const act = (
  actor: string,
  at: number,
  action: 'attack' | 'attack_all' | 'heal' = 'attack',
): Effect => ({
  k: 'act',
  actor,
  action,
  at,
})
const item = (base: string, rarity: Rarity = 'rare', id = 'i1') => ({
  id,
  base,
  rarity,
  tier: 1,
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

test('one action at a time: each act lunges once at its offset, its hits flash at the impact', () => {
  const t = observed()
  t.onEffects(
    [
      act('h1', 0),
      hit('h1', 'e1'),
      act('e2', 500),
      hit('e2', 'h2'),
      act('e3', 1000),
      hit('e3', 'h3'),
    ],
    NOW,
  )
  const lunges = of(t.active(NOW), 'lunge')
  expect(lunges.map((m) => [m.actor, m.from])).toEqual([
    ['h1', NOW + WINDUP_HOLD_MS],
    ['e2', NOW + 500 + WINDUP_HOLD_MS],
    ['e3', NOW + 1000 + WINDUP_HOLD_MS],
  ])
  expect(lunges.map((m) => (m.kind === 'lunge' ? m.dir : 0))).toEqual([-1, 1, 1])
  expect(of(t.active(NOW), 'flash').map((m) => m.from)).toEqual(
    [0, 500, 1000].map((at) => NOW + at + WINDUP_HOLD_MS + LUNGE_MS / 2),
  )
  expect(of(t.active(NOW), 'number').map((m) => m.actor)).toEqual(['e1', 'h2', 'h3'])
})

test('the cadence stretches the gaps between actions, not the actions', () => {
  for (const [cadence, gap] of [
    [2000, 500],
    [5000, 1250],
  ] as const) {
    const t = observed()
    t.onEffects([act('h1', 0), hit('h1', 'e1'), act('e2', 500), hit('e2', 'h3')], NOW, cadence)
    const lunges = of(t.active(NOW), 'lunge')
    expect(lunges.map((m) => m.from)).toEqual([NOW, NOW + gap].map((at) => at + WINDUP_HOLD_MS))
    for (const m of lunges) expect(m.until - m.from).toBe(LUNGE_MS)
  }
})

test("a black mage's three hits number three enemies at one impact", () => {
  const t = observed()
  t.onEffects([act('h2', 0, 'attack_all'), hit('h2', 'e1'), hit('h2', 'e2'), hit('h2', 'e3')], NOW)
  expect(of(t.active(NOW), 'strike')).toHaveLength(1)
  const numbers = of(t.active(NOW), 'number')
  expect(numbers.map((m) => m.actor)).toEqual(['e1', 'e2', 'e3'])
  expect(new Set(numbers.map((m) => m.from))).toEqual(
    new Set([NOW + WINDUP_HOLD_MS + WINDUP_MS + BOLT_MS]),
  )
})

test('a heal shows a green number on the healed hero and no flash', () => {
  const t = observed()
  t.onEffects([act('h3', 0, 'heal'), { k: 'heal', by: 'h3', target: 'h1', amount: 14 }], NOW)
  expect(of(t.active(NOW), 'flash')).toEqual([])
  expect(of(t.active(NOW), 'number')).toEqual([
    {
      kind: 'number',
      actor: 'h1',
      text: '14',
      rgb: NUMBER_RGB_HEAL,
      from: NOW + WINDUP_HOLD_MS + WINDUP_MS + BURST_MS / 2,
      until: NOW + WINDUP_HOLD_MS + WINDUP_MS + BURST_MS / 2 + NUMBER_MS,
    },
  ])
})

test('hits with no act play as one action at offset 0, without a lunge', () => {
  const t = observed()
  t.onEffects([hit('h1', 'e1'), hit('e2', 'h2')], NOW, 5000)
  expect(of(t.active(NOW), 'lunge')).toEqual([])
  expect(of(t.active(NOW), 'flash').map((m) => m.from)).toEqual([
    NOW + LUNGE_MS / 2,
    NOW + LUNGE_MS / 2,
  ])
})

test("a black mage's kill of the first of two targets leaves its chest on the first", () => {
  const t = observed()
  t.onEffects(
    [
      act('h2', 0, 'attack_all'),
      hit('h2', 'e1'),
      { k: 'gold', amount: 2 },
      { k: 'drop', item: item('iron_sword') },
      hit('h2', 'e2'),
    ],
    NOW,
  )
  // It lands as e1's fade ends: its 300 ms fall starts before.
  expect(of(t.active(NOW), 'chest')[0]).toMatchObject({
    actor: 'e1',
    from: NOW + WINDUP_HOLD_MS + WINDUP_MS + BOLT_MS + FLASH_MS + DISSOLVE_MS - 300,
  })
})

test('a batch at the turn cadence waits for the idle batch still playing', () => {
  const t = observed()
  // Idle: four actions over 5 s.
  t.onEffects(
    [0, 500, 1000, 1500].flatMap((at) => [act('h1', at), hit('h1', 'e1')]),
    NOW,
    5000,
  )
  const lastOld = NOW + Math.floor((1500 * 5000) / 2000)
  // A turn starts 2 s in: the new tick plays at 2 s cadence.
  t.onEffects([act('e2', 0), hit('e2', 'h3'), act('e3', 500), hit('e3', 'h2')], NOW + 2000, 2000)
  const lunges = of(t.active(NOW + 2000), 'lunge')
  const fresh = lunges.filter((m) => m.actor !== 'h1')
  expect(fresh.map((m) => m.actor)).toEqual(['e2', 'e3'])
  expect(fresh[0]?.from).toBeGreaterThanOrEqual(lastOld + LUNGE_MS)
  expect(fresh[0]?.from).toBeGreaterThanOrEqual(lastOld + LUNGE_MS / 2 + FLASH_MS)
  expect((fresh[1]?.from ?? 0) - (fresh[0]?.from ?? 0)).toBeGreaterThanOrEqual(LUNGE_MS)
  for (let i = 1; i < lunges.length; i++) {
    expect(lunges[i]?.from ?? 0).toBeGreaterThan(lunges[i - 1]?.from ?? 0)
  }
})

test('playback never drifts: an action is over before the next can start at turn cadence', () => {
  // The non-overlap clamp only drains a backlog while an action is shorter than the gap between two.
  expect(ACTION_MS).toBeLessThanOrEqual(ACTION_STEPS * STEP_MS)
})

test('a newcomer waits while every departed enemy still has a hit to show', () => {
  const t = observed()
  // A sweep at the end of the tick lands after the next tick has brought a new enemy.
  t.onEffects(
    [act('h2', 1900, 'attack_all'), hit('h2', 'e1'), hit('h2', 'e2'), hit('h2', 'e3')],
    NOW,
    2000,
  )
  const next = wave()
  next.enemies = [
    { ...next.enemies[0], id: 'e4', def: 'road_slime', name: 'Road Slime', hp: 9, maxHp: 9 },
  ] as typeof next.enemies
  t.observe(next, NOW + 2000)
  expect(t.known().map((k) => k.id)).toEqual(['e1', 'e2', 'e3'])
  expect(of(t.active(NOW + 2000), 'flash').map((m) => m.actor)).toEqual(['e1', 'e2', 'e3'])
  // Once the kills have faded and the pause after them is over, the newcomer takes the first
  // slot to free, with a spawn.
  const impact = NOW + 1900 + WINDUP_HOLD_MS + WINDUP_MS + BOLT_MS
  const later = impact + FLASH_MS + DISSOLVE_MS + WAVE_GAP_MS
  t.observe(next, later)
  const e4 = t.known().find((k) => k.id === 'e4')
  expect(e4).toBeDefined()
  expect(of(t.active(later), 'spawn').map((m) => m.actor)).toEqual(['e4'])
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

test('enemies stand side by side: once one is gone, the ones after it slide over', () => {
  const t = observed()
  expect(['e1', 'e2', 'e3'].map((id) => t.placeAt(id, NOW))).toEqual([0, 1, 2])
  const v = wave()
  v.enemies = v.enemies.filter((e) => e.id !== 'e2')
  // Dissolving, e2 still holds its place.
  t.observe(v, NOW)
  expect(t.placeAt('e3', NOW + 10)).toBe(2)
  // Gone: e3 slides from 2 to 1, and the stage is busy while it does.
  const gone = NOW + DISSOLVE_MS
  t.observe(v, gone)
  expect(t.placeAt('e3', gone)).toBe(2)
  const mid = t.placeAt('e3', gone + SLIDE_MS / 2)
  expect(mid).toBeGreaterThan(1)
  expect(mid).toBeLessThan(2)
  expect(t.isBusy(gone + SLIDE_MS / 2)).toBe(true)
  expect(t.placeAt('e3', gone + SLIDE_MS)).toBe(1)
  expect(t.placeAt('e1', gone + SLIDE_MS)).toBe(0)
})

test('survivors keep their places and a newcomer joins the end of the line after the pause, with a spawn', () => {
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
  const enter = NOW + DISSOLVE_MS + WAVE_GAP_MS
  t.observe(v, enter)
  // The newcomer takes the freed slot but stands after the survivors: the line never shoves back.
  expect(t.known().map((k) => [k.id, k.slot])).toEqual([
    ['e2', 1],
    ['e3', 2],
    ['e4', 0],
  ])
  for (const at of [enter, enter + SLIDE_MS / 2, enter + SLIDE_MS]) {
    expect(['e2', 'e3', 'e4'].map((id) => t.placeAt(id, at))).toEqual([0, 1, 2])
  }
  expect(of(t.active(enter), 'spawn')).toEqual([
    { kind: 'spawn', actor: 'e4', from: enter, until: enter + SPAWN_MS },
  ])
})

test('a monster that enters mid-tick is known to the timeline before the next redraw', () => {
  const two = wave()
  two.enemies = two.enemies.filter((e) => e.id !== 'e3')
  const t = observed(two)
  // The tick refilled the line from the queue, then the newcomer struck: the engine hands the
  // tick's view over with its effects, and no redraw has observed the newcomer yet.
  const tick = wave()
  tick.enemies = [
    ...two.enemies,
    { id: 'e4', def: 'road_slime', name: 'Road Slime', glyph: 'T', hp: 9, maxHp: 9, kind: 'wave' },
  ]
  t.admit(tick, NOW)
  t.onEffects([act('e4', 0), hit('e4', 'h1'), act('h1', 500), hit('h1', 'e4')], NOW)
  expect(t.known().map((k) => [k.id, k.slot])).toEqual([
    ['e1', 0],
    ['e2', 1],
    ['e4', 2],
  ])
  const m = t.active(NOW)
  expect(of(m, 'spawn')).toEqual([{ kind: 'spawn', actor: 'e4', from: NOW, until: NOW + SPAWN_MS }])
  // Its first action plays animated, and the hit on it flashes.
  expect(of(m, 'lunge').map((x) => x.actor)).toEqual(['e4', 'h1'])
  expect(of(m, 'flash').map((x) => x.actor)).toEqual(['h1', 'e4'])
  // Admitting departs nothing: an enemy missing from the tick's view waits for the redraw.
  const kill = wave()
  kill.enemies = kill.enemies.filter((e) => e.id !== 'e1')
  t.admit(kill, NOW + 10)
  expect(t.isDeparted('e1')).toBe(false)
  expect(of(t.active(NOW + 10), 'dissolve')).toEqual([])
})

test('a newcomer the pause after a kill holds back is not admitted with the tick', () => {
  const t = observed()
  const v = wave()
  v.enemies = v.enemies.filter((e) => e.id !== 'e1')
  t.observe(v, NOW)
  v.enemies.push({
    id: 'e4',
    def: 'road_slime',
    name: 'Road Slime',
    glyph: 'T',
    hp: 9,
    maxHp: 9,
    kind: 'wave',
  })
  t.admit(v, NOW + 10)
  expect(t.known().map((k) => k.id)).toEqual(['e1', 'e2', 'e3'])
  expect(of(t.active(NOW + 10), 'spawn')).toEqual([])
  // A kill no redraw has seen yet has no pause on the timeline: the newcomer waits for that redraw.
  const unseen = observed()
  unseen.admit(v, NOW + 10)
  expect(unseen.known().map((k) => k.id)).toEqual(['e1', 'e2', 'e3'])
  expect(of(unseen.active(NOW + 10), 'spawn')).toEqual([])
})

test('rowsAt is the boss height in every fight, with the boss and after it (ADR 0010)', () => {
  const t = observed(boss())
  expect(t.rowsAt(boss(), NOW)).toBe(STAGE_ROWS)
  const after = boss()
  after.enemies = []
  t.observe(after, NOW)
  expect(t.rowsAt(after, NOW + DISSOLVE_MS / 2)).toBe(STAGE_ROWS)
  expect(t.rowsAt(after, NOW + DISSOLVE_MS)).toBe(STAGE_ROWS)
  expect(observed().rowsAt(wave(), NOW)).toBe(STAGE_ROWS)
})

test('minRowsAt is the tallest actor: 17 with a boss through its dissolve, 8 at rest', () => {
  const t = observed(boss())
  expect(t.minRowsAt(boss(), NOW)).toBe(BOSS_MIN_ROWS)
  const after = boss()
  after.enemies = []
  t.observe(after, NOW)
  expect(t.minRowsAt(after, NOW + DISSOLVE_MS / 2)).toBe(BOSS_MIN_ROWS)
  expect(t.minRowsAt(after, NOW + DISSOLVE_MS)).toBe(STAGE_MIN_ROWS)
  expect(observed().minRowsAt(wave(), NOW)).toBe(STAGE_MIN_ROWS)
})

test('a chest lands where the target of the hit before it stood; a vendored drop plays the same chest', () => {
  const t = observed()
  t.onEffects([hit('h1', 'e3'), { k: 'drop', item: item('iron_sword') }], NOW)
  const chest = of(t.active(NOW), 'chest')[0]
  expect(chest).toMatchObject({
    actor: 'e3',
    itemId: 'i1',
    rarity: 'rare',
    spriteId: 'item:iron_sword',
  })
  expect(chest?.from).toBe(NOW + LUNGE_MS / 2 + FLASH_MS + DISSOLVE_MS - 300)
  expect(t.known().find((k) => k.id === 'e3')?.slot).toBe(2)
  const t2 = observed()
  t2.onEffects(
    [hit('h2', 'e2'), { k: 'drop_vendored', item: item('iron_sword'), gold: 3, cause: 'full' }],
    NOW,
  )
  expect(of(t2.active(NOW), 'chest')).toEqual([{ ...chest, actor: 'e2' }])
  // The auto-vendor setting's sale plays the chest a full inventory's does.
  const t3 = observed()
  t3.onEffects(
    [hit('h2', 'e2'), { k: 'drop_vendored', item: item('iron_sword'), gold: 3, cause: 'setting' }],
    NOW,
  )
  expect(of(t3.active(NOW), 'chest')).toEqual([{ ...chest, actor: 'e2' }])
})

test('a lone drop plays its chest on the front slot from now', () => {
  // A sandbox item: no kill in its burst.
  const t = observed()
  t.onEffects([{ k: 'drop', item: item('iron_sword', 'common') }], NOW)
  expect(of(t.active(NOW), 'chest')).toEqual([
    {
      kind: 'chest',
      actor: 'e1',
      itemId: 'i1',
      rarity: 'common',
      spriteId: 'item:iron_sword',
      from: NOW,
      until: NOW + 2400,
    },
  ])
  expect(t.showAt('i1')).toBe(NOW + 1400)
})

test('a lone drop in a delivery falls when it arrived, not at the last tick it is stamped with', () => {
  // A sandbox item synced three seconds after the last tick: at the tick's time its chest would
  // have risen before it was ever drawn.
  const t = observed()
  t.onEffects([{ k: 'drop', item: item('iron_sword', 'common') }], NOW, 5000, NOW + 3000)
  expect(of(t.active(NOW + 3000), 'chest')).toMatchObject([
    { actor: 'e1', from: NOW + 3000, until: NOW + 3000 + 2400 },
  ])
  expect(t.showAt('i1')).toBe(NOW + 3000 + 1400)
})

test('a lone drop with no live enemy falls on the one still leaving', () => {
  const v = wave()
  v.enemies = v.enemies.filter((e) => e.id === 'e1')
  const t = observed(v)
  // e1 is killed: it leaves the view and dissolves.
  t.onEffects([hit('h1', 'e1')], NOW)
  t.observe({ ...v, enemies: [] }, NOW + 10)
  t.onEffects([{ k: 'drop', item: item('iron_sword', 'common', 'i2') }], NOW + 20)
  expect(of(t.active(NOW + 20), 'chest')).toMatchObject([{ actor: 'e1', itemId: 'i2' }])
  expect(t.showAt('i2')).toBe(NOW + 20 + 1400)
})

test("a lone drop with no enemy on the line leaves a chest on the front slot's ground", () => {
  // A sandbox item sent between spawns: the band has drawn the stage, and its line is empty.
  const t = observed(empty())
  t.onEffects([{ k: 'drop', item: item('iron_sword', 'common') }], NOW, 5000, NOW + 3000)
  expect(of(t.active(NOW + 3000), 'chest')).toEqual([
    {
      kind: 'chest',
      actor: null,
      slot: 0,
      itemId: 'i1',
      rarity: 'common',
      spriteId: 'item:iron_sword',
      from: NOW + 3000,
      until: NOW + 3000 + 2400,
    },
  ])
  expect(t.showAt('i1')).toBe(NOW + 3000 + 1400)
  // A timeline the band has never drawn makes none: no drop waits for a stage nobody has seen.
  const unseen = new StageTimeline()
  unseen.onEffects([{ k: 'drop', item: item('iron_sword', 'common') }], NOW)
  expect(of(unseen.active(NOW), 'chest')).toEqual([])
  expect(unseen.showAt('i1')).toBeNull()
})

test('a chest on the empty ground holds the front slot: the next enemy enters after it fades and the pause', () => {
  const t = observed(empty())
  t.onEffects([{ k: 'drop', item: item('iron_sword', 'common') }], NOW)
  const gone = NOW + 2400
  // The wave comes in while the chest plays: nobody steps on until it has faded and paused.
  t.observe(wave(), NOW + 500)
  expect(t.known()).toEqual([])
  expect(t.isBusy(gone + WAVE_GAP_MS - 1)).toBe(true)
  t.observe(wave(), gone + WAVE_GAP_MS - 1)
  expect(t.known()).toEqual([])
  t.observe(wave(), gone + WAVE_GAP_MS)
  expect(t.known().map((k) => [k.id, k.slot])).toEqual([
    ['e1', 0],
    ['e2', 1],
    ['e3', 2],
  ])
  expect(of(t.active(gone + WAVE_GAP_MS), 'spawn').map((m) => m.from)).toEqual([
    gone + WAVE_GAP_MS,
    gone + WAVE_GAP_MS,
    gone + WAVE_GAP_MS,
  ])
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

test('onEffects answers each group’s start, the wind-up’s own start', () => {
  const t = observed()
  const starts = t.onEffects([act('h1', 0), hit('h1', 'e1'), act('e1', 500), hit('e1', 'h1')], NOW)
  const windups = of(t.active(NOW), 'windup')
  expect(starts).toEqual(windups.map((m) => m.from))
  expect(starts).toEqual([NOW, NOW + 500])
})

test('acting names the actor during its action and the next actor once that one starts', () => {
  const t = observed()
  t.onEffects([act('h1', 0), hit('h1', 'e1'), act('e1', 500), hit('e1', 'h1')], NOW)
  expect(t.acting(NOW - 1)).toBe(null)
  expect(t.acting(NOW + 100)).toBe('h1')
  expect(t.acting(NOW + 500)).toBe('e1')
  expect(t.acting(NOW + 500 + ACTION_STEPS * STEP_MS)).toBe(null)
  expect(t.actionStarts('e1')).toEqual([NOW + 500])
  expect(t.actions().map((a) => a.actor)).toEqual(['h1', 'e1'])
})

test('at the idle cadence the ▶ holds for the action’s battle time stretched 2.5 times', () => {
  const t = observed()
  t.onEffects([act('h1', 0), hit('h1', 'e1')], NOW, 5000)
  const [a] = t.actions()
  expect(a ? a.until - a.start : 0).toBe(ACTION_STEPS * STEP_MS * 2.5)
})

test('an act whose actor is not on the stage still gets a start and an action', () => {
  const t = observed()
  const starts = t.onEffects([act('ghost', 200)], NOW)
  expect(starts).toEqual([NOW + 200])
  expect(t.acting(NOW + 250)).toBe('ghost')
})

test('an enemy attack winds up through its hold and the lunge out, strikes from the apex, and its target takes the hit', () => {
  const t = observed()
  t.onEffects([act('e1', 0), hit('e1', 'h1')], NOW)
  const m = t.active(NOW)
  const span = (kind: Motion['kind']) =>
    of(m, kind).map((x) => [x.actor, x.from - NOW, x.until - NOW])
  expect(span('windup')).toEqual([['e1', 0, H + 120]])
  expect(span('strike')).toEqual([['e1', H + 120, H + 240]])
  expect(of(m, 'strike').map((x) => (x.kind === 'strike' ? x.shape : null))).toEqual(['lunge'])
  expect(span('lunge')).toEqual([['e1', H, H + 240]])
  expect(span('hit')).toEqual([['h1', H + 120, H + 280]])
  expect(span('flash')).toEqual([['h1', H + 120, H + 280]])
  expect(of(m, 'number').map((x) => x.from - NOW)).toEqual([H + 120])
  expect(span('follow')).toEqual([])
  expect(span('effect')).toEqual([])
})

test("a black mage's attack strikes in place while a fireball flies, and the hit lands 320 after the hold", () => {
  const t = observed()
  t.onEffects([act('h2', 0), hit('h2', 'e1')], NOW)
  const m = t.active(NOW)
  expect(of(m, 'lunge')).toEqual([])
  expect(of(m, 'strike')).toEqual([
    { kind: 'strike', actor: 'h2', from: NOW + H + 120, until: NOW + H + 320, shape: 'bolt' },
  ])
  expect(of(m, 'effect')).toEqual([
    {
      kind: 'effect',
      actor: 'h2',
      target: 'e1',
      effect: 'fireball',
      from: NOW + H + 120,
      until: NOW + H + 320,
      shape: 'bolt',
    },
  ])
  expect(of(m, 'hit').map((x) => [x.actor, x.from - NOW])).toEqual([['e1', H + 320]])
})

test("a black mage's attack_all throws one fireball per target", () => {
  const t = observed()
  t.onEffects([act('h2', 0, 'attack_all'), hit('h2', 'e1'), hit('h2', 'e2'), hit('h2', 'e3')], NOW)
  const effects = of(t.active(NOW), 'effect')
  expect(effects.map((x) => (x.kind === 'effect' ? [x.effect, x.target] : null))).toEqual([
    ['fireball', 'e1'],
    ['fireball', 'e2'],
    ['fireball', 'e3'],
  ])
})

test('the knight lunges and follows through from 240 to 360 after the hold', () => {
  const t = observed()
  t.onEffects([act('h1', 0), hit('h1', 'e1')], NOW)
  const m = t.active(NOW)
  expect(of(m, 'follow')).toEqual([
    { kind: 'follow', actor: 'h1', from: NOW + H + 240, until: NOW + H + 360 },
  ])
  expect(of(m, 'strike').map((x) => (x.kind === 'strike' ? x.shape : null))).toEqual([
    'lunge_follow',
  ])
  expect(of(m, 'lunge')).toHaveLength(1)
})

test("a white mage's heal bursts on the healed ally, with no hit and no flash", () => {
  const t = observed()
  t.onEffects([act('h3', 0, 'heal'), { k: 'heal', by: 'h3', target: 'h1', amount: 14 }], NOW)
  const m = t.active(NOW)
  expect(of(m, 'windup').map((x) => x.actor)).toEqual(['h3'])
  expect(of(m, 'strike').map((x) => (x.kind === 'strike' ? x.shape : null))).toEqual(['burst'])
  expect(of(m, 'effect')).toEqual([
    {
      kind: 'effect',
      actor: 'h3',
      target: 'h1',
      effect: 'light_burst',
      from: NOW + H + 120,
      until: NOW + H + 320,
      shape: 'burst',
    },
  ])
  expect(of(m, 'hit')).toEqual([])
  expect(of(m, 'flash')).toEqual([])
  expect(of(m, 'number').map((x) => x.from - NOW)).toEqual([H + 220])
})

test('ACTION_MS is 500, the hold plus the knight; the wind-up past the hold is the lunge out', () => {
  expect(ACTION_MS).toBe(500)
  expect(WINDUP_MS).toBe(LUNGE_MS / 2)
})

test('every attacker steps out during its hold, stays stepped through the action and steps back before its end', () => {
  const heal = (by: string, target: string): Effect => ({ k: 'heal', by, target, amount: 9 })
  const cases: [string, ReturnType<typeof wave>, Effect[], 1 | -1, number][] = [
    ['knight', wave(), [act('h1', 0), hit('h1', 'e1')], -1, 120],
    ['goblin', wave(), [act('e1', 0), hit('e1', 'h2')], 1, 120],
    ['black mage', wave(), [act('h2', 0), hit('h2', 'e1')], -1, 320],
    ['white mage', wave(), [act('h3', 0, 'heal'), heal('h3', 'h1')], -1, 220],
    ['world boss', worldBoss(), [act('e7', 0), hit('e7', 'h1')], 1, 120],
  ]
  for (const [, view, effects, dir, impact] of cases) {
    const t = observed(view)
    t.onEffects(effects, NOW)
    const m = t.active(NOW)
    const actor = effects[0]?.k === 'act' ? effects[0].actor : ''
    const steps = of(m, 'step')
    expect(steps).toEqual([{ kind: 'step', actor, from: NOW, until: NOW + ACTION_MS, dir }])
    // Out with the wind-up frame showing, and stepped before the hold is over.
    expect(of(m, 'windup').map((x) => x.from)).toEqual([NOW])
    expect(STEP_OUT_MS).toBeLessThan(H)
    // The lunge starts from the stepped position and is back before the step back begins.
    const stepped = [NOW + STEP_OUT_MS, NOW + ACTION_MS - STEP_OUT_MS]
    for (const l of of(m, 'lunge')) {
      expect(l.from).toBeGreaterThanOrEqual(stepped[0] ?? 0)
      expect(l.until).toBeLessThanOrEqual(stepped[1] ?? 0)
    }
    // The impact is where it was.
    const landed = [...of(m, 'hit'), ...of(m, 'number')].map((x) => x.from - NOW)
    expect(new Set(landed)).toEqual(new Set([H + impact]))
    // A bolt or a burst is still flying or sitting as the attacker steps back.
    for (const e of of(m, 'effect')) {
      expect(e.from).toBeLessThan(NOW + ACTION_MS - STEP_OUT_MS)
      expect(e.until).toBeGreaterThan(NOW + ACTION_MS - STEP_OUT_MS)
    }
    // The action is no longer than it was: the next one starts where it did.
    expect(t.onEffects([act('h1', 0)], NOW)).toEqual([NOW + ACTION_MS])
  }
})

test('a hit with no act takes no step', () => {
  const t = observed()
  t.onEffects([hit('e2', 'h2')], NOW)
  expect(of(t.active(NOW), 'step')).toEqual([])
})

test('a hit with no act takes its hit frame at the lunge apex', () => {
  const t = observed()
  t.onEffects([hit('e2', 'h2')], NOW)
  expect(of(t.active(NOW), 'hit').map((x) => [x.actor, x.from - NOW])).toEqual([['h2', 120]])
  expect(of(t.active(NOW), 'windup')).toEqual([])
})

test('an attack holds its wind-up before it moves, so the blow reads', () => {
  const t = observed()
  t.onEffects([act('e1', 0), hit('e1', 'h1')], NOW)
  const m = t.active(NOW)
  expect(of(m, 'windup')).toEqual([
    { kind: 'windup', actor: 'e1', from: NOW, until: NOW + WINDUP_HOLD_MS + WINDUP_MS },
  ])
  expect(of(m, 'lunge').map((x) => x.from - NOW)).toEqual([WINDUP_HOLD_MS])
  expect(of(m, 'hit').map((x) => x.from - NOW)).toEqual([WINDUP_HOLD_MS + LUNGE_MS / 2])
})

test('a stage two rounds behind drops the attacks that have not started', () => {
  const t = observed()
  // Twelve attacks at once at the turn cadence: six seconds of playback for one 2 s round.
  const effects = Array.from({ length: 12 }, () => [act('e1', 0), hit('e1', 'h1')]).flat()
  t.onEffects(effects, NOW, 2000)
  const starts = of(t.active(NOW), 'lunge').map((x) => x.from - NOW)
  expect(Math.max(...starts)).toBeLessThanOrEqual(2 * 2000 + ACTION_MS)
  // The attack under way when the cap drops the queue still plays out.
  expect(starts).toContain(0 + WINDUP_HOLD_MS)
})

test("a chest whose blow the backlog cap drops is re-timed to the fade's end", () => {
  const t = observed()
  // Six attacks queue ahead of the blow that kills e1 and drops a sword, three seconds out.
  const queue = Array.from({ length: 6 }, () => [act('e2', 0), hit('e2', 'h1')]).flat()
  t.onEffects(
    [...queue, act('h1', 0), hit('h1', 'e1'), { k: 'drop', item: item('iron_sword', 'common') }],
    NOW,
    2000,
  )
  const v = wave()
  v.enemies = v.enemies.filter((e) => e.id !== 'e1')
  t.observe(v, NOW + 1)
  const shown = t.showAt('i1') ?? 0
  // The next round pushes the stage two rounds behind: the queue, the killing blow with it, goes.
  const cut = NOW + 2000
  t.onEffects(Array.from({ length: 10 }, () => [act('e2', 0), hit('e2', 'h1')]).flat(), cut, 2000)
  expect(of(t.active(cut), 'flash').filter((m) => m.actor === 'e1')).toEqual([])
  expect(of(t.active(cut), 'dissolve')).toEqual([
    { kind: 'dissolve', actor: 'e1', from: cut, until: cut + DISSOLVE_MS },
  ])
  // The chest lands as the new fade ends, and its show time moves with it.
  const landed = cut + DISSOLVE_MS
  expect(of(t.active(cut), 'chest')[0]).toMatchObject({
    actor: 'e1',
    from: landed - 300,
    until: landed - 300 + 2400,
  })
  expect(t.showAt('i1')).toBe(landed + 1100)
  expect(t.showAt('i1')).toBeLessThan(shown)
  // The pause after it starts from the re-timed chest.
  t.observe(v, cut + 1)
  const end = landed - 300 + 2400
  expect(t.isBusy(end + WAVE_GAP_MS - 1)).toBe(true)
  const next = wave()
  next.enemies = next.enemies.filter((e) => e.id !== 'e1')
  next.enemies.push({
    ...next.enemies[0],
    id: 'e4',
    name: 'Road Slime',
  } as (typeof next.enemies)[number])
  t.observe(next, end + WAVE_GAP_MS - 1)
  expect(t.known().map((k) => k.id)).not.toContain('e4')
  t.observe(next, end + WAVE_GAP_MS)
  expect(t.known().map((k) => k.id)).toContain('e4')
})

test('a kill without a drop plays in beats: the fade, then a pause, then the next enemy', () => {
  const t = observed()
  t.onEffects([hit('h1', 'e1')], NOW)
  const flashEnd = NOW + LUNGE_MS / 2 + FLASH_MS
  const v = wave()
  v.enemies = v.enemies.filter((e) => e.id !== 'e1')
  t.observe(v, NOW + 10)
  expect(of(t.active(NOW + 10), 'dissolve')[0]).toMatchObject({ from: flashEnd })
  expect(of(t.active(NOW + 10), 'chest')).toEqual([])
  // The next enemy arrives in the view right away, but waits off stage for the pause.
  v.enemies.push({
    ...v.enemies[0],
    id: 'e4',
    def: 'road_slime',
    name: 'Road Slime',
  } as (typeof v.enemies)[number])
  const settled = flashEnd + DISSOLVE_MS
  t.observe(v, settled + WAVE_GAP_MS - 1)
  expect(t.known().map((k) => k.id)).not.toContain('e4')
  expect(t.isBusy(settled + WAVE_GAP_MS - 1)).toBe(true)
  t.observe(v, settled + WAVE_GAP_MS)
  expect(t.known().map((k) => k.id)).toContain('e4')
  expect(of(t.active(settled + WAVE_GAP_MS), 'spawn').map((m) => m.actor)).toEqual(['e4'])
})

test('a chest falls as the enemy fades, sits, opens, rises, holds by rarity and fades before the pause', () => {
  const holds = { common: 800, uncommon: 1000, rare: 1200, epic: 1600, legendary: 2000 } as const
  for (const [rarity, hold] of Object.entries(holds) as [Rarity, number][]) {
    const t = observed()
    t.onEffects([hit('h1', 'e1'), { k: 'drop', item: item('iron_sword', rarity) }], NOW)
    const v = wave()
    v.enemies = v.enemies.filter((e) => e.id !== 'e1')
    t.observe(v, NOW + 10)
    const faded = of(t.active(NOW + 10), 'dissolve')[0]?.until ?? 0
    const chest = of(t.active(NOW + 10), 'chest')[0]
    if (chest?.kind !== 'chest') throw new Error('no chest')
    // Fall 300, landing as the fade ends; sit 300; open 500; rise 300; hold; fade 200.
    const from = faded - 300
    expect([chest.from, chest.until]).toEqual([from, from + 1600 + hold])
    const phases = [
      [from, 'fall'],
      [faded - 1, 'fall'],
      [faded, 'sit'],
      [faded + 300, 'open'],
      [faded + 800, 'rise'],
      [faded + 1100, 'hold'],
      [faded + 1100 + hold - 1, 'hold'],
      [faded + 1100 + hold, 'fade'],
      [from + 1600 + hold - 1, 'fade'],
    ] as const
    for (const [at, phase] of phases)
      expect([at, chestPhaseAt(chest, at).phase]).toEqual([at, phase])
    // The next enemy enters once the pause after the fade is over, not before.
    v.enemies.push({
      ...v.enemies[0],
      id: 'e4',
      def: 'road_slime',
      name: 'Road Slime',
    } as (typeof v.enemies)[number])
    const enter = chest.until + WAVE_GAP_MS
    t.observe(v, enter - 1)
    expect(t.known().map((k) => k.id)).not.toContain('e4')
    expect(t.isBusy(enter - 1)).toBe(true)
    t.observe(v, enter)
    expect(of(t.active(enter), 'spawn').map((m) => m.actor)).toEqual(['e4'])
  }
})

test('two kills in one tick reveal one after the other in kill order', () => {
  const t = observed()
  t.onEffects(
    [
      act('h1', 0),
      hit('h1', 'e2'),
      { k: 'drop', item: item('iron_sword', 'legendary', 'i1') },
      act('h2', 500),
      hit('h2', 'e1'),
      { k: 'drop', item: item('oak_staff', 'common', 'i2') },
    ],
    NOW,
  )
  const v = wave()
  v.enemies = v.enemies.filter((e) => e.id === 'e3')
  t.observe(v, NOW + 10)
  const chests = of(t.active(NOW + 10), 'chest')
  expect(chests.map((m) => m.actor)).toEqual(['e2', 'e1'])
  const first = t.showAt('i1') ?? 0
  const second = t.showAt('i2') ?? 0
  expect(second).toBeGreaterThan(first)
  // Each plays whole: the first chest still holds its slot through its legendary hold.
  const last = Math.max(...chests.map((m) => m.until))
  t.observe(v, first + 1999)
  expect(t.isDeparted('e2')).toBe(true)
  // The common one, shown half a second later, held 800 ms and faded, is over by then.
  expect(of(t.active(first + 1999), 'chest').map((m) => m.actor)).toEqual(['e2'])
  expect(t.isBusy(last + WAVE_GAP_MS - 1)).toBe(true)
})

test('showAt answers the end of the rise and pendingReveals counts the chests still to show', () => {
  const t = observed()
  // Two lone drops, a common and a legendary: their chests fall from now and rise together.
  t.onEffects(
    [
      { k: 'drop', item: item('iron_sword', 'common', 'i1') },
      { k: 'drop_vendored', item: item('oak_staff', 'legendary', 'i2'), gold: 3, cause: 'full' },
    ],
    NOW,
  )
  // The show time is the end of the rise, whatever the rarity: the hold comes after it.
  expect(t.showAt('i1')).toBe(NOW + 1400)
  expect(t.showAt('i2')).toBe(NOW + 1400)
  expect(t.showAt('i9')).toBeNull()
  expect(of(t.active(NOW), 'chest').map((m) => m.until - NOW)).toEqual([2400, 3600])
  expect(t.pendingReveals(NOW)).toBe(2)
  expect(t.pendingReveals(NOW + 1399)).toBe(2)
  expect(t.pendingReveals(NOW + 1400)).toBe(0)
  // A kill's chest later in the tick is still to show once the lone ones have shown.
  t.onEffects([hit('h1', 'e2'), { k: 'drop', item: item('oak_staff', 'rare', 'i3') }], NOW + 1000)
  const landed = NOW + 1000 + LUNGE_MS / 2 + FLASH_MS + DISSOLVE_MS
  expect(t.showAt('i3')).toBe(landed + 1100)
  expect(t.pendingReveals(NOW + 1400)).toBe(1)
  expect(t.pendingReveals(landed + 1100)).toBe(0)
  // Once a chest is over, the timeline no longer holds its item.
  t.onEffects([], NOW + 3600)
  expect(t.showAt('i2')).toBeNull()
})

/** The zone boss of zone 1 fell: the sim moved on to zone 2, wave 1, and brought the next wave. */
const nextZone = (): GameView => ({ ...wave(), zone: 2, zoneName: 'Whisperwood', wave: 1 })
const bossKill = (drop?: Effect): Effect[] => [
  act('h1', 0),
  hit('h1', 'e9', 500),
  ...(drop ? [drop] : []),
]
const endOf = (t: StageTimeline, kind: 'dissolve' | 'chest') =>
  t.active(NOW).find((m) => m.kind === kind && m.actor === 'e9')?.until ?? Number.NaN

test("a zone arrival's show time is the moment the zone boss's row leaves", () => {
  const t = observed(boss())
  t.onEffects(bossKill({ k: 'drop', item: item('iron_sword', 'legendary') }), NOW, 2000)
  // Before any draw the boss is a live row with no dissolve: the show time is predicted, from the
  // chest, whose end is later than the blow's end plus the dissolve.
  const chestEnd = endOf(t, 'chest')
  expect(endOf(t, 'dissolve')).toBeNaN()
  expect(chestEnd).toBeGreaterThan(NOW + H + LUNGE_MS / 2 + FLASH_MS + DISSOLVE_MS)
  expect(t.zoneShowAt(1)).toBe(chestEnd)
  // The draw schedules the dissolve; the answer is the actual end of the row's motions.
  const next = nextZone()
  t.observe(next, NOW + 1)
  expect(endOf(t, 'dissolve')).toBe(NOW + H + LUNGE_MS / 2 + FLASH_MS + DISSOLVE_MS)
  expect(t.zoneShowAt(1)).toBe(chestEnd)
  // The staged state's zone flips at exactly that instant.
  const zoneAt = (now: number) => {
    t.observe(next, now)
    return stagedState(next, WORLD_DEFAULT, t, now).zone
  }
  expect(zoneAt(chestEnd - 1)).toBe(1)
  expect(zoneAt(chestEnd)).toBe(2)
  // No other zone answers, and the row gone, neither does this one.
  expect(t.zoneShowAt(2)).toBeNull()
  expect(t.zoneShowAt(1)).toBeNull()
})

test("a zone boss kill with no drop still answers the zone's show time from its blow", () => {
  const t = observed(boss())
  t.onEffects(bossKill(), NOW, 2000)
  const faded = NOW + H + LUNGE_MS / 2 + FLASH_MS + DISSOLVE_MS
  expect(t.zoneShowAt(1)).toBe(faded)
  const next = nextZone()
  t.observe(next, NOW + 1)
  expect(endOf(t, 'dissolve')).toBe(faded)
  expect(t.zoneShowAt(1)).toBe(faded)
  t.observe(next, faded - 1)
  expect(stagedState(next, WORLD_DEFAULT, t, faded - 1).zone).toBe(1)
  t.observe(next, faded)
  expect(stagedState(next, WORLD_DEFAULT, t, faded).zone).toBe(2)
})

test("a zone arrival's show time moves with the boss's chest when the backlog re-times it", () => {
  const t = observed(boss())
  const heal: Effect[] = [act('h3', 0, 'heal'), { k: 'heal', by: 'h3', target: 'h1', amount: 5 }]
  // Six heals queue ahead of the blow that kills the boss and drops a sword, three seconds out.
  const queue = Array.from({ length: 6 }, () => heal).flat()
  t.onEffects([...queue, ...bossKill({ k: 'drop', item: item('iron_sword', 'common') })], NOW, 2000)
  t.observe(nextZone(), NOW + 1)
  const before = t.zoneShowAt(1) ?? 0
  expect(before).toBe(endOf(t, 'chest'))
  // The next round pushes the stage two rounds behind: the queue, the killing blow with it, goes.
  const cut = NOW + 2000
  t.onEffects(Array.from({ length: 10 }, () => heal).flat(), cut, 2000)
  const retimed = cut + DISSOLVE_MS - 300 + 2400
  expect(endOf(t, 'chest')).toBe(retimed)
  expect(t.zoneShowAt(1)).toBe(retimed)
  expect(retimed).toBeLessThan(before)
})

test('with no boss row on the timeline a zone arrival has no show time', () => {
  // A delivery with no stage: the timeline was never observed, so it holds no row.
  const unseen = new StageTimeline()
  unseen.onEffects(bossKill({ k: 'drop', item: item('iron_sword', 'legendary') }), NOW, 2000)
  expect(unseen.zoneShowAt(1)).toBeNull()
  // A stage with no zone boss on it.
  const t = observed()
  t.onEffects([act('h1', 0), hit('h1', 'e1', 500)], NOW, 2000)
  expect(t.zoneShowAt(1)).toBeNull()
})
