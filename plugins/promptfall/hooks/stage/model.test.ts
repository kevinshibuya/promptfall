import { expect, test } from 'claude-code/testing'
import { spriteFor } from '../sprites/index'
import type { Effect } from '../vendor/sim.js'
import { boss, wave } from './fixtures'
import { type StageActor, stageAt } from './model'
import { StageTimeline } from './timeline'
import {
  ACTOR_EDGE,
  ACTOR_PITCH,
  COMPACT_PITCH,
  FLASH_RGB,
  HIRES_SCALE,
  IDLE_BOB_PX,
  IDLE_FRAME_MS,
  LUNGE_MS,
  LUNGE_PX,
  RARITY_RGB,
} from './tuning'

const NOW = 1_000_000 // bobbing(NOW) is 0
const BOX = { columns: 116, rows: 8 }
type Opts = { compact: boolean; motion: 'full' | 'still'; scale?: 1 | 1.5 }
const STILL: Opts = { compact: false, motion: 'still' }
const hit = (by: string, target: string): Effect => ({ k: 'hit', by, target, amount: 12 })

function at(view = wave(), effects: Effect[] = [], now = NOW, box = BOX, opts: Opts = STILL) {
  const t = new StageTimeline()
  t.observe(view, NOW)
  t.onEffects(effects, NOW)
  return stageAt(view, t, now, box, opts)
}

const actor = (actors: StageActor[], key: string) => {
  const a = actors.find((x) => x.key === key)
  if (!a) throw new Error(`no actor ${key}`)
  return a
}

const overlaps = (a: StageActor, b: StageActor) =>
  a.x < b.x + b.art.width && b.x < a.x + a.art.width

test('enemies from the left by slot, heroes from the right, feet on the ground, no overlap', () => {
  const m = at()
  ;['e1', 'e2', 'e3'].forEach((key, i) => {
    expect(actor(m.actors, key).x).toBe(ACTOR_EDGE + ACTOR_PITCH * i)
  })
  ;['h1', 'h2', 'h3'].forEach((key, i) => {
    const a = actor(m.actors, key)
    expect(a.x).toBe(116 - ACTOR_EDGE - 16 - ACTOR_PITCH * i)
    expect(a.flipX).toBe(true)
  })
  for (const a of m.actors) expect(a.y + a.art.height).toBe(16)
  for (const a of m.actors)
    for (const b of m.actors) if (a !== b) expect(overlaps(a, b)).toBe(false)
})

test('a 48 px boss in slot 0 does not reach the heroes at 116 columns', () => {
  const v = boss()
  const m = at(v, [], NOW, { columns: 116, rows: 17 })
  const b = actor(m.actors, 'e9')
  for (const h of ['h1', 'h2', 'h3']) expect(overlaps(b, actor(m.actors, h))).toBe(false)
  if (b.art.height === 34) expect(b.y).toBe(0)
})

test('the rarity slot takes the hero rarity colour', () => {
  const mira = actor(at().actors, 'h2')
  const slot = spriteFor('hero', 'black_mage').raritySlot ?? -1
  expect(mira.palette[slot]).toBe(RARITY_RGB.rare)
})

test('a flashing actor draws white; a lunging hero steps toward the enemies', () => {
  const effects: Effect[] = [{ k: 'act', actor: 'h1', action: 'attack', at: 0 }, hit('h1', 'e1')]
  const mid = at(wave(), effects, NOW + LUNGE_MS / 2)
  expect(actor(mid.actors, 'h1').x).toBe(116 - ACTOR_EDGE - 16 - LUNGE_PX)
  const e1 = actor(mid.actors, 'e1')
  expect(e1.flashing).toBe(true)
  expect(e1.palette.slice(1).every((c) => c === FLASH_RGB)).toBe(true)
  expect(actor(mid.actors, 'h1').spriteId).toBe('hero_attack:knight')
})

test('the idle bob moves with motion full only', () => {
  const v = wave()
  const full: Opts = { compact: false, motion: 'full' }
  const rest = at(v, [], NOW, BOX, full)
  const up = at(v, [], NOW + IDLE_FRAME_MS, BOX, full)
  expect(actor(rest.actors, 'h1').y - actor(up.actors, 'h1').y).toBe(IDLE_BOB_PX)
  const still = at(v, [], NOW + IDLE_FRAME_MS, BOX, STILL)
  expect(actor(still.actors, 'h1').y).toBe(actor(rest.actors, 'h1').y)
})

test('a fallen hero has its palette halved per channel', () => {
  const v = wave()
  const h = v.heroes[0]
  if (h) Object.assign(h, { hp: 0, alive: false })
  const fallen = actor(at(v).actors, 'h1')
  const alive = actor(at().actors, 'h1')
  expect(fallen.fallen).toBe(true)
  fallen.palette.forEach((c, i) => {
    if (i === 0) return
    const a = alive.palette[i] ?? 0
    expect(c).toBe(
      (((a >> 16) & 0xff) >> 1) * 0x10000 + (((a >> 8) & 0xff) >> 1) * 0x100 + ((a & 0xff) >> 1),
    )
  })
})

test('the compact box uses compact art, the compact pitch and no edge', () => {
  const m = at(wave(), [], NOW, { columns: 52, rows: 4 }, { compact: true, motion: 'still' })
  expect(actor(m.actors, 'e2').x).toBe(COMPACT_PITCH)
  expect(actor(m.actors, 'h1').x).toBe(52 - actor(m.actors, 'h1').art.width)
  for (const a of m.actors) expect(a.art.height).toBeLessThanOrEqual(8)
})

test('a number floats inside the frame over its actor', () => {
  const m = at(wave(), [hit('h1', 'e1')], NOW + LUNGE_MS / 2)
  expect(m.numbers).toHaveLength(1)
  const n = m.numbers[0]
  expect(n?.text).toBe('12')
  expect(n?.y ?? -1).toBeGreaterThanOrEqual(0)
  expect(n?.y ?? 99).toBeLessThanOrEqual(11)
})

test('the alt names the wave, the enemies and the heroes', () => {
  expect(at().alt).toBe(
    'Zone 1, wave 2: Goblin Scout 42/60, Field Rat 10/20, Road Slime 30/90 vs Aldric L5, Mira L4, Tomas L5',
  )
})

test('minions joining a boss stand clear of the boss and the party, and the boss draws whole', () => {
  // Tool calls spawn wave enemies into a boss encounter (spec: at most 3 enemies at once).
  const v = boss()
  const w = wave()
  v.enemies = [...v.enemies, ...w.enemies.slice(0, 2)]
  // Room for the widest legal boss: edge 4, boss 48, gap 2, minion 16, gap 2, party 52, edge 4.
  const m = at(v, [], NOW, { columns: 128, rows: 17 })
  const b = actor(m.actors, 'e9')
  const first = actor(m.actors, 'e1')
  const minions = [first, actor(m.actors, 'e2')]
  const heroes = ['h1', 'h2', 'h3'].map((h) => actor(m.actors, h))
  for (const e of [b, ...minions]) for (const h of heroes) expect(overlaps(e, h)).toBe(false)
  expect(overlaps(b, first)).toBe(false)
  // Whatever overlap is left falls on the minions, under the boss, never over it.
  const order = m.actors.map((a) => a.key)
  expect(order.indexOf('e9')).toBeGreaterThan(order.indexOf('e1'))
  expect(order.indexOf('e9')).toBeGreaterThan(order.indexOf('e2'))
})

test('at scale 1.5 the full stage carries the 1.5x art and every distance grows by 1.5', () => {
  const opts: Opts = { compact: false, motion: 'still', scale: HIRES_SCALE }
  const rest = at(wave(), [], NOW, BOX, opts)
  expect(rest.scale).toBe(1.5)
  const knight = spriteFor('hero', 'knight')
  const h1 = actor(rest.actors, 'h1')
  expect(h1.art).toBe(knight.hires)
  expect(h1.raritySlot).toBe(knight.raritySlotHires)
  expect(h1.palette[knight.raritySlotHires ?? -1]).toBe(RARITY_RGB[wave().heroes[0]?.rarity ?? ''])
  // 116 columns are 174 pixels; edge 6, pitch 27.
  expect(h1.x).toBe(174 - 6 - 24)
  expect(actor(rest.actors, 'h2').x).toBe(174 - 6 - 24 - 27)
  expect(actor(rest.actors, 'e1').x).toBe(6)
  expect(actor(rest.actors, 'e2').x).toBe(6 + 27)
  for (const a of rest.actors) expect(a.y + a.art.height).toBe(24)
  const effects: Effect[] = [{ k: 'act', actor: 'h1', action: 'attack', at: 0 }, hit('h1', 'e1')]
  const mid = at(wave(), effects, NOW + LUNGE_MS / 2, BOX, opts)
  expect(actor(mid.actors, 'h1').x).toBe(h1.x - 6)
  expect(actor(mid.actors, 'h1').art).toBe(spriteFor('hero_attack', 'knight').hires)
})

test('the compact stage ignores the scale and an enemy carries no rarity slot', () => {
  const m = at(
    wave(),
    [],
    NOW,
    { columns: 52, rows: 4 },
    { compact: true, motion: 'still', scale: 1.5 },
  )
  expect(m.scale).toBe(1)
  expect(actor(m.actors, 'h1').art).toBe(spriteFor('hero', 'knight').compact)
  expect(actor(m.actors, 'e1').raritySlot).toBe(null)
  expect(actor(at().actors, 'h1').raritySlot).toBe(spriteFor('hero', 'knight').raritySlot)
})
