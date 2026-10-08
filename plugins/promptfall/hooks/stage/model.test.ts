import { expect, test } from 'claude-code/testing'
import { lighten, opaqueBox, shear, squash } from '../sprites/derive'
import { spriteFor } from '../sprites/index'
import type { Effect } from '../vendor/sim.js'
import { composeFrame } from './compose'
import { boss, wave } from './fixtures'
import { lungeOffset, type StageActor, stageAt } from './model'
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
  WINDUP_HOLD_MS,
} from './tuning'

const NOW = 1_000_000 // bobbing(NOW) is 0
const BOX = { columns: 116, rows: 8 }
type Opts = { compact: boolean; motion: 'full' | 'still'; scale?: 1 | 1.5 }
const STILL: Opts = { compact: false, motion: 'still' }
const hit = (by: string, target: string): Effect => ({ k: 'hit', by, target, amount: 12 })

function at(view = wave(), effects: Effect[] = [], now = NOW, box = BOX, opts: Opts = STILL) {
  const t = new StageTimeline()
  t.observe(view, NOW)
  // An attack holds its wind-up before it moves: start it a hold early, so it moves at NOW.
  t.onEffects(effects, effects.some((e) => e.k === 'act') ? NOW - WINDUP_HOLD_MS : NOW)
  return stageAt(view, t, now, box, opts)
}

const actor = (actors: StageActor[], key: string) => {
  const a = actors.find((x) => x.key === key)
  if (!a) throw new Error(`no actor ${key}`)
  return a
}

const overlaps = (a: StageActor, b: StageActor) =>
  a.x < b.x + b.art.width && b.x < a.x + a.art.width

test('enemies from the left by slot, heroes in party order with the last at the right, feet on the ground, no overlap', () => {
  const m = at()
  ;['e1', 'e2', 'e3'].forEach((key, i) => {
    expect(actor(m.actors, key).x).toBe(ACTOR_EDGE + ACTOR_PITCH * i)
  })
  // Left to right as the heroes window lists them: the first faces the enemies, the last stands back.
  ;['h1', 'h2', 'h3'].forEach((key, i) => {
    const a = actor(m.actors, key)
    expect(a.x).toBe(116 - ACTOR_EDGE - 16 - ACTOR_PITCH * (2 - i))
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
  expect(actor(mid.actors, 'h1').x).toBe(116 - ACTOR_EDGE - 16 - ACTOR_PITCH * 2 - LUNGE_PX)
  const e1 = actor(mid.actors, 'e1')
  expect(e1.flashing).toBe(true)
  expect(e1.palette.slice(1).every((c) => c === FLASH_RGB)).toBe(true)
  const h1 = actor(mid.actors, 'h1')
  expect(h1.spriteId).toBe('hero:knight')
  expect(h1.art).toBe(spriteFor('hero_attack', 'knight').full)
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
  expect(actor(m.actors, 'h3').x).toBe(52 - actor(m.actors, 'h3').art.width)
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
  // 116 columns are 174 pixels; edge 6, pitch 27. The knight leads, two pitches in from the edge.
  expect(h1.x).toBe(174 - 6 - 24 - 2 * 27)
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

const HI: Opts = { compact: false, motion: 'full', scale: HIRES_SCALE }
const LO: Opts = { compact: false, motion: 'full', scale: 1 }
const knightHits: Effect[] = [{ k: 'act', actor: 'h1', action: 'attack', at: 0 }, hit('h1', 'e1')]
const slimeHits: Effect[] = [{ k: 'act', actor: 'e1', action: 'attack', at: 0 }, hit('e1', 'h1')]
const knight = spriteFor('hero', 'knight')
const knightAttack = spriteFor('hero_attack', 'knight')

test('at 1.5 the knight winds up, strikes in its attack art and follows through', () => {
  const windup = actor(at(wave(), knightHits, NOW + 60, BOX, HI).actors, 'h1')
  const rest = actor(at(wave(), [], NOW, BOX, HI).actors, 'h1')
  expect(windup.pose).toBe('windup')
  expect(windup.art).toBe(knight.frames?.windup.art)
  expect(windup.x).toBe(
    rest.x +
      lungeOffset(
        { kind: 'lunge', actor: 'h1', from: NOW, until: NOW + LUNGE_MS, dir: -1 },
        NOW + 60,
        HIRES_SCALE,
      ),
  )
  expect(windup.x).not.toBe(rest.x)
  const strike = actor(at(wave(), knightHits, NOW + 180, BOX, HI).actors, 'h1')
  expect(strike.pose).toBe('strike')
  expect(strike.art).toBe(knightAttack.hires)
  expect(strike.spriteId).toBe('hero:knight')
  const follow = actor(at(wave(), knightHits, NOW + 300, BOX, HI).actors, 'h1')
  expect(follow.pose).toBe('follow')
  expect(follow.art).toBe(knight.frames?.follow?.art)
})

test('at 1.5 the struck enemy leans back from its idle place, lightened, and blinks white', () => {
  const rest = actor(at(wave(), [], NOW, BOX, HI).actors, 'e1')
  const struck = actor(at(wave(), knightHits, NOW + 150, BOX, HI).actors, 'e1')
  const idle = spriteFor('enemy', 'goblin_scout').hires
  const leaned = shear(idle)
  expect(struck.pose).toBe('hit')
  expect(struck.poses.hit.art).toBe(leaned.art)
  expect(struck.poses.hit.dx).toBe(-leaned.grow)
  expect(struck.x).toBe(rest.x)
  expect(struck.poses.hit.palette).toEqual(idle.palette.map((c, i) => (i === 0 ? c : lighten(c))))
  expect(struck.flashing).toBe(true)
  const later = actor(at(wave(), knightHits, NOW + 230, BOX, HI).actors, 'e1')
  expect(later.pose).toBe('hit')
  expect(later.flashing).toBe(false)
  expect(later.palette).toEqual(later.poses.hit.palette)
})

test('at 1.5 a struck hero leans back with no offset, from its idle place', () => {
  const rest = actor(at(wave(), [], NOW, BOX, HI).actors, 'h1')
  const struck = actor(at(wave(), slimeHits, NOW + 150, BOX, HI).actors, 'h1')
  expect(struck.pose).toBe('hit')
  expect(struck.poses.hit.dx).toBe(0)
  expect(struck.x).toBe(rest.x)
})

test('at 1 the knight shows its attack art through the lunge and its idle art after', () => {
  for (const ms of [60, 180]) {
    expect(actor(at(wave(), knightHits, NOW + ms, BOX, LO).actors, 'h1').art).toBe(
      knightAttack.full,
    )
  }
  expect(actor(at(wave(), knightHits, NOW + 300, BOX, LO).actors, 'h1').art).toBe(knight.full)
  const e1 = actor(at(wave(), knightHits, NOW + 230, BOX, LO).actors, 'e1')
  expect(e1.flashing).toBe(true)
  expect(e1.art).toBe(spriteFor('enemy', 'goblin_scout').full)
})

test('at rest the second half-second shows idle B at 1.5 and the 1-pixel bob at 1; still shows idle A', () => {
  const later = NOW + 700
  const hi = actor(at(wave(), [], later, BOX, HI).actors, 'h1')
  const hiRest = actor(at(wave(), [], NOW, BOX, HI).actors, 'h1')
  expect(hi.pose).toBe('idle_b')
  expect(hi.art).toBe(squash(knight.hires))
  expect(hi.y).toBe(hiRest.y)
  const lo = actor(at(wave(), [], later, BOX, LO).actors, 'h1')
  const loRest = actor(at(wave(), [], NOW, BOX, LO).actors, 'h1')
  expect(lo.art).toBe(knight.full)
  expect(loRest.y - lo.y).toBe(IDLE_BOB_PX)
  const still = actor(at(wave(), [], later, BOX, { ...HI, motion: 'still' }).actors, 'h1')
  expect(still.pose).toBe('idle')
  expect(still.art).toBe(knight.hires)
})

test("a black mage's fireball is halfway from its front edge to the target's centre at 220 ms", () => {
  const effects: Effect[] = [{ k: 'act', actor: 'h2', action: 'attack', at: 0 }, hit('h2', 'e1')]
  const m = at(wave(), effects, NOW + 220, BOX, HI)
  expect(m.effects).toHaveLength(1)
  const fb = m.effects[0]
  if (!fb) throw new Error('no effect')
  expect(fb.spriteId).toBe('effect:fireball')
  expect(fb.flipX).toBe(true)
  const box = opaqueBox(fb.art)
  if (!box) throw new Error('empty fireball')
  const cx = fb.x + fb.art.width - (box.x0 + box.x1 + 1) / 2
  const cy = fb.y + (box.y0 + box.y1 + 1) / 2
  const mage = actor(m.actors, 'h2')
  const e1 = actor(m.actors, 'e1')
  const tx = e1.x + e1.poses.idle.art.width / 2
  const ty = e1.y + e1.poses.idle.art.height / 2
  const fy = mage.y + mage.poses.idle.art.height / 2
  expect(Math.abs(cx - (mage.x + tx) / 2)).toBeLessThanOrEqual(0.5)
  expect(Math.abs(cy - (fy + ty) / 2)).toBeLessThanOrEqual(0.5)
  expect(at(wave(), effects, NOW + 100, BOX, HI).effects).toEqual([])
  expect(at(wave(), effects, NOW + 330, BOX, HI).effects).toEqual([])
})

test('the compact stage draws every pose and effect from compact art, its frame still 52 x 8', () => {
  const COMPACT: Opts = { compact: true, motion: 'full' }
  const box = { columns: 52, rows: 4 }
  const lunging = at(wave(), knightHits, NOW + 60, box, COMPACT)
  expect(actor(lunging.actors, 'h1').art).toBe(knightAttack.compact)
  const struck = at(wave(), knightHits, NOW + 150, box, COMPACT)
  expect(actor(struck.actors, 'e1').art).toBe(spriteFor('enemy', 'goblin_scout').compact)
  for (const a of struck.actors) {
    for (const p of Object.values(a.poses)) expect(p.art.height).toBeLessThanOrEqual(8)
  }
  const bolt = at(
    wave(),
    [{ k: 'act', actor: 'h2', action: 'attack', at: 0 }, hit('h2', 'e1')],
    NOW + 220,
    box,
    COMPACT,
  )
  expect(bolt.effects[0]?.art).toBe(spriteFor('effect', 'fireball').compact)
  const f = composeFrame(bolt, { numbers: false })
  expect([f.width, f.height]).toEqual([52, 8])
})
