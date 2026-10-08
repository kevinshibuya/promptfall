import { expect, test } from 'claude-code/testing'
import { ACTION_STEPS, type Effect, STEP_MS } from '../vendor/sim.js'
import { boss, wave, worldBoss } from './fixtures'
import { ACTION_MS, type Motion, StageTimeline } from './timeline'
import {
  BOLT_MS,
  BURST_MS,
  DISSOLVE_MS,
  DROP_MS,
  FLASH_MS,
  LUNGE_MS,
  NUMBER_MS,
  NUMBER_RGB_HEAL,
  SPAWN_MS,
  STAGE_BOSS_ROWS,
  STAGE_REST_ROWS,
  WINDUP_MS,
} from './tuning'

const NOW = 1_000_000
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
    ['h1', NOW],
    ['e2', NOW + 500],
    ['e3', NOW + 1000],
  ])
  expect(lunges.map((m) => (m.kind === 'lunge' ? m.dir : 0))).toEqual([-1, 1, 1])
  expect(of(t.active(NOW), 'flash').map((m) => m.from)).toEqual(
    [0, 500, 1000].map((at) => NOW + at + LUNGE_MS / 2),
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
    expect(lunges.map((m) => m.from)).toEqual([NOW, NOW + gap])
    for (const m of lunges) expect(m.until - m.from).toBe(LUNGE_MS)
  }
})

test("a black mage's three hits number three enemies at one impact", () => {
  const t = observed()
  t.onEffects([act('h2', 0, 'attack_all'), hit('h2', 'e1'), hit('h2', 'e2'), hit('h2', 'e3')], NOW)
  expect(of(t.active(NOW), 'strike')).toHaveLength(1)
  const numbers = of(t.active(NOW), 'number')
  expect(numbers.map((m) => m.actor)).toEqual(['e1', 'e2', 'e3'])
  expect(new Set(numbers.map((m) => m.from))).toEqual(new Set([NOW + WINDUP_MS + BOLT_MS]))
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
      from: NOW + WINDUP_MS + BURST_MS / 2,
      until: NOW + WINDUP_MS + BURST_MS / 2 + NUMBER_MS,
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

test("a black mage's kill of the first of two targets drops from the first", () => {
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
  expect(of(t.active(NOW), 'drop')[0]).toMatchObject({
    actor: 'e1',
    from: NOW + WINDUP_MS + BOLT_MS + FLASH_MS,
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
  // Once the numbers have risen, the newcomer takes the first slot to free, with a spawn.
  const later = NOW + 1900 + WINDUP_MS + BOLT_MS + NUMBER_MS
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

test('onEffects answers each group’s start, the lunge’s own start', () => {
  const t = observed()
  const starts = t.onEffects([act('h1', 0), hit('h1', 'e1'), act('e1', 500), hit('e1', 'h1')], NOW)
  const lunges = of(t.active(NOW), 'lunge')
  expect(starts).toEqual(lunges.map((m) => m.from))
  expect(starts).toEqual([NOW, NOW + 500])
})

test('acting names the actor during its action and the next actor once that one starts', () => {
  const t = observed()
  t.onEffects([act('h1', 0), hit('h1', 'e1'), act('e1', 400), hit('e1', 'h1')], NOW)
  expect(t.acting(NOW - 1)).toBe(null)
  expect(t.acting(NOW + 100)).toBe('h1')
  expect(t.acting(NOW + 400)).toBe('e1')
  expect(t.acting(NOW + 400 + ACTION_STEPS * STEP_MS)).toBe(null)
  expect(t.actionStarts('e1')).toEqual([NOW + 400])
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

test('an enemy attack winds up over the lunge out, strikes from the apex, and its target takes the hit', () => {
  const t = observed()
  t.onEffects([act('e1', 0), hit('e1', 'h1')], NOW)
  const m = t.active(NOW)
  const span = (kind: Motion['kind']) =>
    of(m, kind).map((x) => [x.actor, x.from - NOW, x.until - NOW])
  expect(span('windup')).toEqual([['e1', 0, 120]])
  expect(span('strike')).toEqual([['e1', 120, 240]])
  expect(of(m, 'strike').map((x) => (x.kind === 'strike' ? x.shape : null))).toEqual(['lunge'])
  expect(span('lunge')).toEqual([['e1', 0, 240]])
  expect(span('hit')).toEqual([['h1', 120, 280]])
  expect(span('flash')).toEqual([['h1', 120, 280]])
  expect(of(m, 'number').map((x) => x.from - NOW)).toEqual([120])
  expect(span('follow')).toEqual([])
  expect(span('effect')).toEqual([])
})

test("a black mage's attack strikes in place while a fireball flies, and the hit lands at 320", () => {
  const t = observed()
  t.onEffects([act('h2', 0), hit('h2', 'e1')], NOW)
  const m = t.active(NOW)
  expect(of(m, 'lunge')).toEqual([])
  expect(of(m, 'strike')).toEqual([
    { kind: 'strike', actor: 'h2', from: NOW + 120, until: NOW + 320, shape: 'bolt' },
  ])
  expect(of(m, 'effect')).toEqual([
    {
      kind: 'effect',
      actor: 'h2',
      target: 'e1',
      effect: 'fireball',
      from: NOW + 120,
      until: NOW + 320,
      shape: 'bolt',
    },
  ])
  expect(of(m, 'hit').map((x) => [x.actor, x.from - NOW])).toEqual([['e1', 320]])
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

test('the knight lunges and follows through from 240 to 360', () => {
  const t = observed()
  t.onEffects([act('h1', 0), hit('h1', 'e1')], NOW)
  const m = t.active(NOW)
  expect(of(m, 'follow')).toEqual([
    { kind: 'follow', actor: 'h1', from: NOW + 240, until: NOW + 360 },
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
      from: NOW + 120,
      until: NOW + 320,
      shape: 'burst',
    },
  ])
  expect(of(m, 'hit')).toEqual([])
  expect(of(m, 'flash')).toEqual([])
  expect(of(m, 'number').map((x) => x.from - NOW)).toEqual([220])
})

test('ACTION_MS is 360, and the wind-up is the lunge out', () => {
  expect(ACTION_MS).toBe(360)
  expect(WINDUP_MS).toBe(LUNGE_MS / 2)
})

test('a hit with no act takes its hit frame at the lunge apex', () => {
  const t = observed()
  t.onEffects([hit('e2', 'h2')], NOW)
  expect(of(t.active(NOW), 'hit').map((x) => [x.actor, x.from - NOW])).toEqual([['h2', 120]])
  expect(of(t.active(NOW), 'windup')).toEqual([])
})
