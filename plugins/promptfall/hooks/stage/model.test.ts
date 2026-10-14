import { expect, test } from 'claude-code/testing'
import type { GameView, WorldState } from '../../types'
import { lighten, opaqueBox, shear, squash, stance } from '../sprites/derive'
import { backdropFor, spriteFor } from '../sprites/index'
import { WORLD_DEFAULT } from '../state'
import type { Effect, Rarity } from '../vendor/sim.js'
import { composeFrame } from './compose'
import { boss, wave, worldBoss } from './fixtures'
import { lungeOffset, SHIELD, type StageActor, stageAt } from './model'
import { stagedState } from './staged'
import { StageTimeline } from './timeline'
import {
  ACTOR_EDGE,
  ACTOR_PITCH,
  BLINK_MS,
  CAMPFIRE_FADE_MS,
  CAMPFIRE_MS,
  CLASS_RGB,
  COMPACT_PITCH,
  ENRAGE_RGB,
  FLASH_MS,
  FLASH_RGB,
  HIRES_SCALE,
  HUDDLE_MS,
  IDLE_BOB_PX,
  IDLE_FRAME_MS,
  LEVEL_RGB,
  LUNGE_MS,
  LUNGE_PX,
  RARITY_RGB,
  SHIELD_OVERLAP_PX,
  STEP_OUT_MS,
  STEP_PX,
  TRAVEL_OFF_MS,
  TRAVEL_ON_MS,
  TRAVEL_PX,
  WINDUP_HOLD_MS,
  ZONE_GROUND,
} from './tuning'

const NOW = 1_000_000 // bobbing(NOW) is 0
const BOX = { columns: 116, rows: 8 }
const BOX_COMPACT = { columns: 52, rows: 4 }
const BOSS_BOX = { columns: 120, rows: 17 }
type Opts = { compact: boolean; motion: 'full' | 'still' }
const STILL: Opts = { compact: false, motion: 'still' }
/** A 1x distance on the full stage, which is 1.5. */
const k = (v: number) => Math.round(v * HIRES_SCALE)
const hit = (by: string, target: string): Effect => ({ k: 'hit', by, target, amount: 12 })

function at(view = wave(), effects: Effect[] = [], now = NOW, box = BOX, opts: Opts = STILL) {
  const t = new StageTimeline()
  t.observe(view, NOW)
  // An attack holds its wind-up before it moves: start it a hold early, so it moves at NOW.
  t.onEffects(effects, effects.some((e) => e.k === 'act') ? NOW - WINDUP_HOLD_MS : NOW)
  return stageAt(stagedState(view, WORLD_DEFAULT, t, now), t, now, box, opts)
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
    expect(actor(m.actors, key).x).toBe(k(ACTOR_EDGE) + k(ACTOR_PITCH) * i)
  })
  // Left to right as the heroes window lists them: the first faces the enemies, the last stands back.
  ;['h1', 'h2', 'h3'].forEach((key, i) => {
    const a = actor(m.actors, key)
    expect(a.x).toBe(k(116) - k(ACTOR_EDGE) - 24 - k(ACTOR_PITCH) * (2 - i))
    expect(a.flipX).toBe(true)
  })
  for (const a of m.actors) expect(a.y + a.art.height).toBe(24)
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
  const slot = spriteFor('hero', 'black_mage').raritySlotHires ?? -1
  expect(mira.palette[slot]).toBe(RARITY_RGB.rare)
})

test('a flashing actor draws white; a lunging hero steps and lunges toward the enemies', () => {
  const effects: Effect[] = [{ k: 'act', actor: 'h1', action: 'attack', at: 0 }, hit('h1', 'e1')]
  const mid = at(wave(), effects, NOW + LUNGE_MS / 2)
  expect(actor(mid.actors, 'h1').x).toBe(
    k(116) - k(ACTOR_EDGE) - 24 - k(ACTOR_PITCH) * 2 - k(STEP_PX) - k(LUNGE_PX),
  )
  const e1 = actor(mid.actors, 'e1')
  expect(e1.flashing).toBe(true)
  expect(e1.palette.slice(1).every((c) => c === FLASH_RGB)).toBe(true)
  const h1 = actor(mid.actors, 'h1')
  expect(h1.spriteId).toBe('hero:knight')
  expect(h1.art).toBe(spriteFor('hero_attack', 'knight').hires)
})

test('on the compact stage the idle bob lifts one pixel with motion full only', () => {
  const v = wave()
  const full: Opts = { compact: true, motion: 'full' }
  const rest = at(v, [], NOW, BOX_COMPACT, full)
  const up = at(v, [], NOW + IDLE_FRAME_MS, BOX_COMPACT, full)
  expect(actor(rest.actors, 'h1').y - actor(up.actors, 'h1').y).toBe(IDLE_BOB_PX)
  // One drawing: the lift alone moves it.
  expect(actor(up.actors, 'h1').art).toBe(spriteFor('hero', 'knight').compact)
  const still = at(v, [], NOW + IDLE_FRAME_MS, BOX_COMPACT, { ...full, motion: 'still' })
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

test('a hero struck dead stands, flashes and keeps his colours until the blow lands, then dims', () => {
  const struck = (hp: number): GameView => ({
    ...wave(),
    heroes: wave().heroes.map((h) => (h.id === 'h1' ? { ...h, hp, alive: hp > 0 } : h)),
  })
  const t = new StageTimeline()
  t.observe(struck(7), NOW - 1)
  t.onEffects(
    [
      { k: 'act', actor: 'e1', action: 'attack', at: 0 },
      { k: 'hit', by: 'e1', target: 'h1', amount: 20 },
    ],
    NOW,
  )
  const impact = NOW + WINDUP_HOLD_MS + LUNGE_MS / 2
  // The sim has the hero dead from the tick on.
  const view = struck(0)
  t.observe(view, NOW)
  const hero = (now: number) =>
    actor(stageAt(stagedState(view, WORLD_DEFAULT, t, now), t, now, BOX, STILL).actors, 'h1')
  expect(hero(impact - 1)).toMatchObject({ fallen: false, flashing: false })
  expect(hero(impact)).toMatchObject({ fallen: true, flashing: false, pose: 'idle' })
  const before = stageAt(stagedState(view, WORLD_DEFAULT, t, impact - 1), t, impact - 1, BOX, STILL)
  expect(before.alt).toContain('Aldric L5,')
  const after = stageAt(stagedState(view, WORLD_DEFAULT, t, impact), t, impact, BOX, STILL)
  expect(after.alt).toContain('Aldric L5 down')
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

test('the full stage is 1.5: it carries the 1.5x art and every distance grows by 1.5', () => {
  const opts: Opts = { compact: false, motion: 'still' }
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
  // The step and the lunge, 4 px each at 1, are 6 each at 1.5.
  expect(actor(mid.actors, 'h1').x).toBe(h1.x - 6 - 6)
  expect(actor(mid.actors, 'h1').art).toBe(spriteFor('hero_attack', 'knight').hires)
})

test('the compact stage is 1x and an enemy carries no rarity slot', () => {
  const m = at(wave(), [], NOW, BOX_COMPACT, { compact: true, motion: 'still' })
  expect(m.scale).toBe(1)
  expect(actor(m.actors, 'h1').art).toBe(spriteFor('hero', 'knight').compact)
  expect(actor(m.actors, 'h1').raritySlot).toBe(spriteFor('hero', 'knight').raritySlot)
  expect(actor(m.actors, 'e1').raritySlot).toBe(null)
})

const HI: Opts = { compact: false, motion: 'full' }
const COMPACT: Opts = { compact: true, motion: 'full' }
const knightHits: Effect[] = [{ k: 'act', actor: 'h1', action: 'attack', at: 0 }, hit('h1', 'e1')]
const slimeHits: Effect[] = [{ k: 'act', actor: 'e1', action: 'attack', at: 0 }, hit('e1', 'h1')]
const knight = spriteFor('hero', 'knight')
const knightAttack = spriteFor('hero_attack', 'knight')

test('the knight winds up, strikes in its attack art and follows through', () => {
  const windup = actor(at(wave(), knightHits, NOW + 60, BOX, HI).actors, 'h1')
  const rest = actor(at(wave(), [], NOW, BOX, HI).actors, 'h1')
  expect(windup.pose).toBe('windup')
  expect(windup.art).toBe(knight.frames?.windup.art)
  expect(windup.x).toBe(
    rest.x -
      Math.round(STEP_PX * HIRES_SCALE) +
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

test('the struck enemy leans back from its idle place, lightened, and blinks white', () => {
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

test('a struck hero leans back with no offset, from its idle place', () => {
  const rest = actor(at(wave(), [], NOW, BOX, HI).actors, 'h1')
  const struck = actor(at(wave(), slimeHits, NOW + 150, BOX, HI).actors, 'h1')
  expect(struck.pose).toBe('hit')
  expect(struck.poses.hit.dx).toBe(0)
  expect(struck.x).toBe(rest.x)
})

test('on the compact stage the knight shows its attack art through the lunge and its idle art after, and a flash holds', () => {
  for (const ms of [60, 180]) {
    expect(actor(at(wave(), knightHits, NOW + ms, BOX_COMPACT, COMPACT).actors, 'h1').art).toBe(
      knightAttack.compact,
    )
  }
  expect(actor(at(wave(), knightHits, NOW + 300, BOX_COMPACT, COMPACT).actors, 'h1').art).toBe(
    knight.compact,
  )
  const e1 = actor(at(wave(), knightHits, NOW + 230, BOX_COMPACT, COMPACT).actors, 'e1')
  expect(e1.flashing).toBe(true)
  expect(e1.art).toBe(spriteFor('enemy', 'goblin_scout').compact)
})

test('at rest the second half-second shows idle B with no lift; still shows idle A', () => {
  const later = NOW + 700
  const hi = actor(at(wave(), [], later, BOX, HI).actors, 'h1')
  const hiRest = actor(at(wave(), [], NOW, BOX, HI).actors, 'h1')
  expect(hi.pose).toBe('idle_b')
  expect(hi.art).toBe(squash(knight.hires))
  expect(hi.y).toBe(hiRest.y)
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

test("the backdrop is the zone's 1.5x painting, and none on the compact stage", () => {
  const full = at(wave(), [], NOW, { columns: 120, rows: 8 }, { compact: false, motion: 'still' })
  expect(full.backdrop).toBe(backdropFor(1))
  const compact = at(wave(), [], NOW, { columns: 52, rows: 4 }, { compact: true, motion: 'still' })
  expect(compact.backdrop).toBe(null)
})

test("tier 2's zone 1 stands on zone 1's ground and backdrop", () => {
  const opts: Opts = { compact: false, motion: 'still' }
  const zone1 = at(wave(), [], NOW, { columns: 120, rows: 8 }, opts)
  const zone13 = at({ ...wave(), zone: 13 }, [], NOW, { columns: 120, rows: 8 }, opts)
  expect(zone13.ground).toBe(ZONE_GROUND[0])
  expect(zone13.ground).toBe(zone1.ground)
  expect(zone13.backdrop).toBe(backdropFor(1))
})

test('a world boss at an emptied bar stands whole until the server disengages it, then dissolves', () => {
  const full: Opts = { compact: false, motion: 'full' }
  // The Promptwyrm at 100 HP in the poll, none of this party's damage committed.
  const world: WorldState = {
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
        hp: 100,
        spawnedAt: NOW - 3_600_000,
        endsAt: NOW + 660_000,
        yours: 0,
      },
      hunt: null,
      chat: [],
      flags: {},
    },
    committedDealt: { bossId: 'wb1', dealt: 0 },
  }
  const t = new StageTimeline()
  t.observe(worldBoss(), NOW - 1)
  t.onEffects(
    [
      { k: 'act', actor: 'h1', action: 'attack', at: 0 },
      { k: 'hit', by: 'h1', target: 'e7', amount: 100 },
    ],
    NOW - WINDUP_HOLD_MS,
  )
  const impact =
    t.active(NOW).find((m) => m.kind === 'number' && m.actor === 'e7')?.from ?? Number.NaN
  const engaged: GameView = {
    ...worldBoss(),
    boss: { bossId: 'wb1', name: 'The Promptwyrm', glyph: '☠', dealt: 100 },
  }
  t.observe(engaged, NOW)
  const emptied = stagedState(engaged, world, t, impact)
  expect(emptied.enemies[0]?.hp).toBe(0)
  expect(actor(stageAt(emptied, t, impact, BOX, full).actors, 'e7').alpha).toBe(1)
  // The server disengages it: it dissolves from there.
  const gone: GameView = { ...worldBoss(), enemies: [], boss: null }
  t.observe(gone, impact)
  const dissolve = t.active(impact).find((m) => m.actor === 'e7' && m.kind === 'dissolve')
  expect(dissolve).toBeDefined()
  const mid = ((dissolve?.from ?? 0) + (dissolve?.until ?? 0)) / 2
  const fading = actor(stageAt(stagedState(gone, world, t, mid), t, mid, BOX, full).actors, 'e7')
  expect(fading.alpha).toBeGreaterThan(0)
  expect(fading.alpha).toBeLessThan(1)
})

test('the step is the same distance for a world boss and a goblin', () => {
  const tall = { columns: 116, rows: 17 }
  /** The actor's x at `now`, its action starting at NOW. */
  const xAt = (view: GameView, effects: Effect[], key: string, now: number, opts: Opts) => {
    const t = new StageTimeline()
    t.observe(view, NOW)
    t.onEffects(effects, NOW)
    return actor(stageAt(stagedState(view, WORLD_DEFAULT, t, now), t, now, tall, opts).actors, key)
      .x
  }
  // In the hold, before the lunge: the step is out and nothing else moves the actor.
  const held = NOW + STEP_OUT_MS
  const apex = NOW + WINDUP_HOLD_MS + LUNGE_MS / 2
  const cases: [GameView, string, string][] = [
    [wave(), 'e1', 'h2'],
    [worldBoss(), 'e7', 'h1'],
  ]
  const stepPx = k(STEP_PX)
  for (const opts of [HI, { ...HI, motion: 'still' as const }]) {
    for (const [view, enemy, target] of cases) {
      const effects: Effect[] = [
        { k: 'act', actor: enemy, action: 'attack', at: 0 },
        hit(enemy, target),
      ]
      const rest = xAt(view, [], enemy, held, opts)
      expect(xAt(view, effects, enemy, held, opts) - rest).toBe(stepPx)
      // The lunge adds its own from the stepped position.
      expect(xAt(view, effects, enemy, apex, opts) - rest).toBe(stepPx + k(LUNGE_PX))
      // Back where it stood once the action is over.
      expect(xAt(view, effects, enemy, NOW + 1000, opts)).toBe(rest)
    }
  }
  // A hero steps toward the enemies.
  const knightRest = xAt(wave(), [], 'h1', held, HI)
  expect(xAt(wave(), knightHits, 'h1', held, HI) - knightRest).toBe(-stepPx)
  // The compact stage steps its one drawing the 1x distance.
  const compact = (effects: Effect[]) => {
    const t = new StageTimeline()
    t.observe(wave(), NOW)
    t.onEffects(effects, NOW)
    const m = stageAt(stagedState(wave(), WORLD_DEFAULT, t, held), t, held, BOX_COMPACT, COMPACT)
    return actor(m.actors, 'e1').x
  }
  expect(compact(slimeHits) - compact([])).toBe(STEP_PX)
})

/**
 * e1 killed at NOW with a sword (common unless said): its chest falls from NOW + 400, lands at
 * NOW + 700, opens over NOW + 1000 to 1500 and its item rises until NOW + 1800.
 */
function chestAt(
  now: number,
  box: { columns: number; rows: number },
  opts: Opts,
  rarity: Rarity = 'common',
) {
  const t = new StageTimeline()
  t.observe(wave(), NOW)
  const sword = {
    id: 'i1',
    base: 'iron_sword',
    rarity,
    tier: 1,
    affixes: [],
    equippedBy: null,
    tradeableAt: null,
  }
  t.onEffects([hit('h1', 'e1'), { k: 'drop', item: sword }], NOW)
  const view: GameView = { ...wave(), enemies: wave().enemies.filter((e) => e.id !== 'e1') }
  t.observe(view, NOW + 10)
  const m = stageAt(stagedState(view, WORLD_DEFAULT, t, now), t, now, box, opts)
  const place = (x: { x: number; y: number; alpha: number } | undefined) => x && [x.x, x.y, x.alpha]
  return {
    chest: m.chests[0] && { phase: m.chests[0].phase, at: place(m.chests[0]) },
    item: place(m.drops[0]),
    chestArt: m.chests[0]?.art,
    glow: m.glows[0],
  }
}

test("a chest falls from above the dead enemy's centre to its ground, sits closed, and its item rises from its top", () => {
  const FULL = { columns: 116, rows: 17 }
  // e1 at x 6, 24 px, centre (18, 39). The chest's bottom starts at that centre and falls to the
  // ground (y 27); the item's centre starts at the closed chest's top (row 22) and rises 15 px.
  const closed = spriteFor('chest', 'closed')
  const hi = (now: number) => chestAt(now, FULL, STILL)
  expect(hi(NOW + 399).chest).toBeUndefined()
  expect(hi(NOW + 400).chest).toEqual({ phase: 'fall', at: [6, 15, 1] })
  // Eased in: a quarter of the way down at half the fall.
  expect(hi(NOW + 550).chest).toEqual({ phase: 'fall', at: [6, 18, 1] })
  for (const [now, phase] of [
    [NOW + 700, 'sit'],
    [NOW + 1200, 'open'],
    [NOW + 1650, 'rise'],
    [NOW + 2000, 'hold'],
  ] as const) {
    expect(hi(now).chest).toEqual({ phase, at: [6, 27, 1] })
  }
  expect(hi(NOW + 700).chestArt).toBe(closed.hires)
  expect(hi(NOW + 1200).item).toBeUndefined()
  expect(hi(NOW + 1500).item).toEqual([6, 22, 1])
  expect(hi(NOW + 1650).item).toEqual([6, 15, 1])
  expect(hi(NOW + 2000).item).toEqual([6, 7, 1])
  // The fade takes the chest and the item together.
  expect(hi(NOW + 2700)).toMatchObject({ chest: { phase: 'fade', at: [6, 27, 0.5] } })
  expect(hi(NOW + 2700).item).toEqual([6, 7, 0.5])
  expect(hi(NOW + 2800).chest).toBeUndefined()
  // The compact stage: the 8 px chest on its ground, the item kept inside the frame.
  const compact = chestAt(NOW + 2000, BOX_COMPACT, { ...STILL, compact: true })
  expect(compact).toMatchObject({
    chest: { phase: 'hold', at: [0, 0, 1] },
    item: [0, 0, 1],
  })
})

/**
 * A sandbox sword (common) dropped at NOW onto a drawn, empty stage: its chest falls from NOW,
 * lands at NOW + 300, opens over NOW + 600 to 1100 and its item rises until NOW + 1400.
 */
function groundChestAt(now: number, box: { columns: number; rows: number }, opts: Opts) {
  const t = new StageTimeline()
  const view: GameView = { ...wave(), enemies: [] }
  t.observe(view, NOW)
  const sword = {
    id: 'i1',
    base: 'iron_sword',
    rarity: 'common' as const,
    tier: 1,
    affixes: [],
    equippedBy: null,
    tradeableAt: null,
  }
  t.onEffects([{ k: 'drop', item: sword }], NOW)
  const m = stageAt(stagedState(view, WORLD_DEFAULT, t, now), t, now, box, opts)
  const place = (x: { x: number; y: number; alpha: number } | undefined) => x && [x.x, x.y, x.alpha]
  return {
    chest: m.chests[0] && { phase: m.chests[0].phase, at: place(m.chests[0]) },
    item: place(m.drops[0]),
    actors: m.actors.filter((a) => !a.key.startsWith('h')).length,
  }
}

test("a chest with no actor falls onto the front slot's ground, where a kill's in that slot lands", () => {
  const FULL = { columns: 116, rows: 17 }
  // A kill's chest in slot 0 is at x 6 and lands at y 27 (the test above). This one falls half
  // its own height onto the same ground, sits, opens, and its item rises to the same place.
  const hi = (now: number) => groundChestAt(now, FULL, STILL)
  expect(hi(NOW).chest).toEqual({ phase: 'fall', at: [6, 15, 1] })
  expect(hi(NOW).actors).toBe(0)
  for (const [now, phase] of [
    [NOW + 300, 'sit'],
    [NOW + 600, 'open'],
    [NOW + 1250, 'rise'],
    [NOW + 1600, 'hold'],
  ] as const) {
    expect(hi(now).chest).toEqual({ phase, at: [6, 27, 1] })
  }
  expect(hi(NOW + 1100).item).toEqual([6, 22, 1])
  expect(hi(NOW + 1600).item).toEqual([6, 7, 1])
  expect(hi(NOW + 2300)).toMatchObject({ chest: { phase: 'fade', at: [6, 27, 0.5] } })
  expect(hi(NOW + 2400).chest).toBeUndefined()
  // The compact stage: the 8 px chest at the left edge, as a kill's there.
  expect(groundChestAt(NOW + 1600, BOX_COMPACT, { ...STILL, compact: true })).toMatchObject({
    chest: { phase: 'hold', at: [0, 0, 1] },
    item: [0, 0, 1],
  })
})

test('the reveal shows the chest closed, opening then open, with the open art under the rising item', () => {
  const FULL = { columns: 116, rows: 17 }
  const [closed, opening, open] = (['closed', 'opening', 'open'] as const).map((id) =>
    spriteFor('chest', id),
  )
  // The open phase runs NOW + 1000 to 1500: the opening art its first half, the open art after.
  const shown: [number, typeof closed][] = [
    [NOW + 400, closed],
    [NOW + 999, closed],
    [NOW + 1000, opening],
    [NOW + 1249, opening],
    [NOW + 1250, open],
    [NOW + 1650, open],
    [NOW + 2000, open],
    [NOW + 2700, open],
  ]
  for (const [now, sprite] of shown) {
    expect(chestAt(now, FULL, STILL).chestArt, `${now - NOW} ms`).toBe(sprite?.hires)
    expect(chestAt(now, BOX_COMPACT, { ...STILL, compact: true }).chestArt).toBe(sprite?.compact)
  }
  // The open art is under the item while it rises and holds.
  const rising = chestAt(NOW + 1650, FULL, STILL)
  expect(rising.item).toEqual([6, 15, 1])
  expect(rising.chestArt).toBe(open?.hires)
})

test("the glow sits on the risen item's centre in its rarity colour, ramps in over the rise, holds and fades with the item; a legendary's is wider", () => {
  const FULL = { columns: 116, rows: 17 }
  const glow = (now: number, opts: Opts, rarity: Rarity = 'common', box = FULL) => {
    const g = chestAt(now, box, opts, rarity).glow
    return g && [g.x, g.y, g.r, g.alpha]
  }
  const grey = RARITY_RGB.common
  // The item risen at (6, 7), 24 px: its centre (18, 19). The rise runs NOW + 1500 to 1800.
  expect(glow(NOW + 1499, STILL)).toBeUndefined()
  expect(glow(NOW + 1500, STILL)).toEqual([18, 19, 12, 0])
  expect(glow(NOW + 1650, STILL)).toEqual([18, 19, 12, 0.25])
  expect(glow(NOW + 2000, STILL)).toEqual([18, 19, 12, 0.5])
  expect(chestAt(NOW + 2000, FULL, STILL).glow?.rgb).toBe(grey)
  // A common's fade runs NOW + 2600 to 2800, with the item's.
  expect(glow(NOW + 2700, STILL)).toEqual([18, 19, 12, 0.25])
  expect(glow(NOW + 2800, STILL)).toBeUndefined()
  // A legendary's glow is wider and gold, and holds until NOW + 3800.
  expect(glow(NOW + 3700, STILL, 'legendary')).toEqual([18, 19, 18, 0.5])
  expect(chestAt(NOW + 3700, FULL, STILL, 'legendary').glow?.rgb).toBe(RARITY_RGB.legendary)
  // The compact stage: the 8 px item at (0, 0).
  const compact = { ...STILL, compact: true }
  expect(glow(NOW + 2000, compact, 'common', BOX_COMPACT)).toEqual([4, 4, 4, 0.5])
  expect(glow(NOW + 2000, compact, 'legendary', BOX_COMPACT)).toEqual([4, 4, 6, 0.5])
})

const hasted = (on = true): GameView => {
  const v = wave()
  for (const h of v.heroes) h.hasted = on
  return v
}
const guarding = (on = true): GameView => {
  const v = wave()
  for (const h of v.heroes) h.guarding = on
  return v
}

test('with the front hero fallen, the first hero standing wears the shield', () => {
  const v = guarding()
  const h1 = v.heroes.find((h) => h.id === 'h1')
  if (h1) Object.assign(h1, { hp: 0, alive: false })
  const hi = at(v, [], NOW, BOX, HI)
  expect(actor(hi.actors, 'h1').shield ?? null).toBe(null)
  expect(actor(hi.actors, 'h2').shield).not.toBe(null)
  expect(actor(hi.actors, 'h3').shield ?? null).toBe(null)
})

test('hasted heroes trail a streak in their class colour behind them, and bob twice as fast', () => {
  const m = at(hasted(), [], NOW, BOX, HI)
  for (const key of ['h1', 'h2', 'h3']) {
    const a = actor(m.actors, key)
    const cls = wave().heroes.find((h) => h.id === key)?.cls ?? ''
    expect(a.streak?.art.palette.slice(1), key).toEqual([CLASS_RGB[cls]])
    expect(a.streak?.art.height, key).toBe(2)
    // Behind the hero: past its back, which faces right.
    const box = opaqueBox(a.poses.idle.art)
    expect(a.streak?.dx ?? 0, key).toBeGreaterThan(a.art.width - (box?.x0 ?? 0) - 1)
  }
  // A quarter-second in, the hasted idle pair has turned; the calm one has not.
  expect(actor(at(hasted(), [], NOW + IDLE_FRAME_MS / 2, BOX, HI).actors, 'h1').pose).toBe('idle_b')
  expect(actor(at(wave(), [], NOW + IDLE_FRAME_MS / 2, BOX, HI).actors, 'h1').pose).toBe('idle')
  // Enemies keep their own clock.
  expect(actor(at(hasted(), [], NOW + IDLE_FRAME_MS / 2, BOX, HI).actors, 'e1').pose).toBe('idle')
})

test('on the compact stage a hasted hero bobs twice as fast and trails no streak', () => {
  const quarter = NOW + IDLE_FRAME_MS / 2
  const lo = actor(at(hasted(), [], quarter, BOX_COMPACT, COMPACT).actors, 'h1')
  const rest = actor(at(hasted(), [], NOW, BOX_COMPACT, COMPACT).actors, 'h1')
  expect(rest.y - lo.y).toBe(IDLE_BOB_PX)
  expect(lo.streak ?? null).toBe(null)
  expect(rest.streak ?? null).toBe(null)
})

test('under still the streaks draw and the bob stays stopped; once haste ends they are gone', () => {
  const still = actor(
    at(hasted(), [], NOW + IDLE_FRAME_MS / 2, BOX, { ...HI, motion: 'still' }).actors,
    'h1',
  )
  expect(still.streak).not.toBe(null)
  expect(still.pose).toBe('idle')
  expect(actor(at(hasted(false), [], NOW, BOX, HI).actors, 'h1').streak ?? null).toBe(null)
})

test('guarding heroes hold the derived stance with the bob stopped; the front hero holds the shield, on the compact stage too', () => {
  for (const later of [NOW, NOW + 700]) {
    const hi = at(guarding(), [], later, BOX, HI)
    for (const key of ['h1', 'h2', 'h3']) {
      const a = actor(hi.actors, key)
      expect(a.pose, key).toBe('guard')
      expect(a.art, key).toBe(stance(a.poses.idle.art).art)
    }
    expect(actor(hi.actors, 'h1').shield).not.toBe(null)
    expect(actor(hi.actors, 'h2').shield ?? null).toBe(null)
    const compact = at(guarding(), [], later, BOX_COMPACT, COMPACT)
    const h1 = actor(compact.actors, 'h1')
    expect(h1.pose).toBe('guard')
    expect(h1.y + h1.art.height).toBe(8)
    expect(h1.shield?.art).toBe(SHIELD.compact)
  }
  // The stance leans toward the enemies: its feet stay where the idle's stand.
  const h1 = actor(at(guarding(), [], NOW, BOX, HI).actors, 'h1')
  const lean = stance(h1.poses.idle.art)
  expect(h1.poses.guard.dx).toBe(-lean.grow)
  // A guarding hero still takes its hit frame.
  const struck = at(
    guarding(),
    [{ k: 'act', actor: 'e1', action: 'attack', at: 0 }, hit('e1', 'h1')],
    NOW + LUNGE_MS / 2,
    BOX,
    HI,
  )
  expect(actor(struck.actors, 'h1').pose).toBe('hit')
  // Off guard, the idle pair again.
  expect(actor(at(guarding(false), [], NOW, BOX, HI).actors, 'h1').pose).toBe('idle')
})

/** The opaque columns a hero's idle figure covers on the stage, drawn flipped. */
const figure = (a: StageActor) => {
  const box = opaqueBox(a.poses.idle.art)
  const w = a.poses.idle.art.width
  return { left: a.x + w - 1 - (box?.x1 ?? 0), right: a.x + w - 1 - (box?.x0 ?? 0) }
}
/** The opaque box Guard's shield covers on the stage, beside the hero `a` that holds it. */
const shieldBox = (a: StageActor) => {
  const s = a.shield
  const box = s ? opaqueBox(s.art) : null
  if (!s || !box) throw new Error(`no shield on ${a.key}`)
  const x = a.x + s.dx
  const y = a.y + s.dy
  return { left: x + box.x0, right: x + box.x1, top: y + box.y0, bottom: y + box.y1 }
}

test("the front hero holds the big shield on the enemies' side, about its height, its bottom at its feet and its back edge over its front", () => {
  for (const [box, opts, art, overlap] of [
    [BOX, HI, SHIELD.hires, k(SHIELD_OVERLAP_PX)],
    [BOX_COMPACT, COMPACT, SHIELD.compact, SHIELD_OVERLAP_PX],
  ] as const) {
    const h1 = actor(at(guarding(), [], NOW, box, opts).actors, 'h1')
    const label = opts.compact ? 'compact' : 'full'
    expect(h1.shield?.art, label).toBe(art)
    const shield = shieldBox(h1)
    const hero = figure(h1)
    // Heroes face left: the shield stands left of the figure, its right edge over the figure's
    // first columns.
    expect(shield.right, label).toBe(hero.left + overlap - 1)
    expect(shield.left, label).toBeLessThan(hero.left)
    // On the ground at the hero's feet, never over its head.
    const idle = h1.poses.idle.art
    const feet = h1.y + idle.height - 1
    expect(shield.bottom, label).toBe(feet)
    const figureBox = opaqueBox(idle)
    const tall = (figureBox?.y1 ?? 0) - (figureBox?.y0 ?? 0) + 1
    expect(Math.abs(shield.bottom - shield.top + 1 - tall), label).toBeLessThanOrEqual(tall / 4)
  }
  // Off guard there is none.
  expect(actor(at(guarding(false), [], NOW, BOX, HI).actors, 'h1').shield ?? null).toBe(null)
})

test("an enemy's hit under Guard flashes the shield white in the struck hero's flash, the struck hero shows its hit frame, and the lunge is unchanged", () => {
  const attack = (target: string): Effect[] => [
    { k: 'act', actor: 'e1', action: 'attack', at: 0 },
    hit('e1', target),
  ]
  // The attack moves at NOW; its lunge lands halfway through.
  const impact = NOW + LUNGE_MS / 2
  const shieldOf = (target: string, now: number, box = BOX, opts = HI) =>
    actor(at(guarding(), attack(target), now, box, opts).actors, 'h1').shield
  // A hit on any guarding hero lands on the one shield, the front hero's.
  for (const target of ['h1', 'h2']) {
    expect(shieldOf(target, impact - 1)?.flashing, target).toBe(false)
    expect(shieldOf(target, impact)?.flashing, target).toBe(true)
    expect(shieldOf(target, impact + BLINK_MS - 1)?.flashing, target).toBe(true)
    expect(shieldOf(target, impact + BLINK_MS)?.flashing, target).toBe(false)
    const struck = at(guarding(), attack(target), impact, BOX, HI)
    expect(actor(struck.actors, target).pose, target).toBe('hit')
    expect(actor(struck.actors, target).flashing, target).toBe(true)
  }
  // The compact stage holds its flash for the whole hit frame, the shield's with it.
  expect(shieldOf('h1', impact + BLINK_MS, BOX_COMPACT, COMPACT)?.flashing).toBe(true)
  expect(shieldOf('h1', impact + FLASH_MS, BOX_COMPACT, COMPACT)?.flashing).toBe(false)
  // The enemy lunges its fixed offset, Guard or not.
  for (const now of [impact - LUNGE_MS / 4, impact, impact + LUNGE_MS / 4]) {
    const guarded = actor(at(guarding(), attack('h1'), now, BOX, HI).actors, 'e1').x
    expect(guarded).toBe(actor(at(wave(), attack('h1'), now, BOX, HI).actors, 'e1').x)
  }
})

/** Each hero's x, in party order. */
const heroXs = (m: { actors: StageActor[] }) =>
  ['h1', 'h2', 'h3'].map((key) => actor(m.actors, key).x)

/**
 * A stage that saw the party off or on guard (`patch` applied), then the guard effect turning it
 * `on` at NOW, staged at `now` from `after` (the state past the effect, `patch` applied too).
 */
function guardTurned(
  on: boolean,
  now: number,
  patch: (v: GameView) => void = () => {},
  after: (v: GameView) => void = patch,
  opts: Opts = HI,
  box = BOX,
) {
  const t = new StageTimeline()
  const before = guarding(!on)
  patch(before)
  t.observe(before, NOW - 1000)
  t.onEffects([{ k: 'guard', on }], NOW)
  const v = guarding(on)
  after(v)
  return stageAt(stagedState(v, WORLD_DEFAULT, t, now), t, now, box, opts)
}
const fall = (id: string) => (v: GameView) => {
  const h = v.heroes.find((x) => x.id === id)
  if (h) Object.assign(h, { hp: 0, alive: false })
}

test('guard on slides the living heroes in toward the front hero over one shared duration, in their idle art; they stand pressed in party order, a pixel apart', () => {
  const slots = heroXs(at(wave(), [], NOW, BOX, HI))
  expect(heroXs(guardTurned(true, NOW))).toEqual(slots)
  const mid = guardTurned(true, NOW + HUDDLE_MS / 2)
  const done = guardTurned(true, NOW + HUDDLE_MS)
  const [h1, h2, h3] = ['h1', 'h2', 'h3'].map((key) => actor(done.actors, key))
  if (!h1 || !h2 || !h3) throw new Error('no party')
  // The front hero keeps its slot; each hero behind it stands one empty pixel clear of the one before.
  expect(h1.x).toBe(slots[0])
  expect(figure(h2).left - figure(h1).right).toBe(2)
  expect(figure(h3).left - figure(h2).right).toBe(2)
  for (const [i, key] of ['h2', 'h3'].entries()) {
    const x = actor(mid.actors, key).x
    const from = slots[i + 1] ?? 0
    const to = actor(done.actors, key).x
    expect(to, key).toBeLessThan(from)
    // Halfway through the one duration, halfway there.
    expect(x, key).toBe(from + Math.round((to - from) / 2))
    expect(actor(mid.actors, key).pose, key).toBe('idle')
  }
  // Arrived, they hold the stance and the huddle.
  expect(h2.pose).toBe('guard')
  expect(heroXs(guardTurned(true, NOW + 5000))).toEqual(heroXs(done))
})

test('the fallen keep their slots in the huddle, and the first hero standing is its front', () => {
  const slots = heroXs(at(wave(), [], NOW, BOX, HI))
  // The front hero fallen: the second keeps its slot and the third presses against it.
  const front = guardTurned(true, NOW + HUDDLE_MS, fall('h1'))
  const [h1, h2, h3] = ['h1', 'h2', 'h3'].map((key) => actor(front.actors, key))
  if (!h1 || !h2 || !h3) throw new Error('no party')
  expect([h1.x, h2.x]).toEqual([slots[0], slots[1]])
  expect(figure(h3).left - figure(h2).right).toBe(2)
  // The middle hero fallen: the third presses against the front one, past the fallen.
  const middle = guardTurned(true, NOW + HUDDLE_MS, fall('h2'))
  expect(actor(middle.actors, 'h2').x).toBe(slots[1])
  expect(figure(actor(middle.actors, 'h3')).left - figure(actor(middle.actors, 'h1')).right).toBe(2)
})

test('a hero that falls under Guard keeps its huddle position and nothing shifts until Guard ends', () => {
  const huddled = heroXs(guardTurned(true, NOW + HUDDLE_MS))
  const fell = guardTurned(true, NOW + 2000, () => {}, fall('h2'))
  expect(actor(fell.actors, 'h2').fallen).toBe(true)
  expect(heroXs(fell)).toEqual(huddled)
  // A stage first drawn huddled holds its members too.
  const t = new StageTimeline()
  t.observe(guarding(), NOW)
  const v = guarding()
  fall('h2')(v)
  t.observe(v, NOW + 1000)
  const later = stageAt(stagedState(v, WORLD_DEFAULT, t, NOW + 1000), t, NOW + 1000, BOX, HI)
  expect(heroXs(later)).toEqual(huddled)
})

test('a party already guarding at the first draw stands huddled with no motion', () => {
  const t = new StageTimeline()
  t.observe(guarding(), NOW)
  const first = stageAt(stagedState(guarding(), WORLD_DEFAULT, t, NOW), t, NOW, BOX, HI)
  expect(heroXs(first)).toEqual(heroXs(guardTurned(true, NOW + HUDDLE_MS)))
  expect(t.isBusy(NOW)).toBe(false)
  // Nor does a guard on the timeline hears before its first draw play one.
  const early = new StageTimeline()
  early.onEffects([{ k: 'guard', on: true }], NOW)
  early.observe(guarding(), NOW)
  expect(early.isBusy(NOW)).toBe(false)
  const drawn = stageAt(stagedState(guarding(), WORLD_DEFAULT, early, NOW), early, NOW, BOX, HI)
  expect(heroXs(drawn)).toEqual(heroXs(first))
})

test('guard off slides the huddle back to the slots over the same span, the fallen with it', () => {
  const slots = heroXs(at(wave(), [], NOW, BOX, HI))
  const huddled = heroXs(guardTurned(true, NOW + HUDDLE_MS))
  expect(heroXs(guardTurned(false, NOW))).toEqual(huddled)
  const mid = guardTurned(false, NOW + HUDDLE_MS / 2)
  expect(actor(mid.actors, 'h3').pose).toBe('idle')
  for (const i of [1, 2]) {
    const from = huddled[i] ?? 0
    const to = slots[i] ?? 0
    expect(heroXs(mid)[i]).toBe(from + Math.round((to - from) / 2))
  }
  expect(heroXs(guardTurned(false, NOW + HUDDLE_MS))).toEqual(slots)
  // A hero that fell in the huddle rides back with it.
  const fell = guardTurned(false, NOW + HUDDLE_MS / 2, () => {}, fall('h3'))
  expect(heroXs(fell)[2]).toBe(heroXs(mid)[2])
})

test("a huddled hero's step and lunge add to its huddle position; the compact stage has no huddle", () => {
  const archerHits: Effect[] = [{ k: 'act', actor: 'h3', action: 'attack', at: 0 }, hit('h3', 'e1')]
  const moved = (v: GameView) =>
    actor(at(v, archerHits, NOW + 60, BOX, HI).actors, 'h3').x -
    actor(at(v, [], NOW, BOX, HI).actors, 'h3').x
  expect(moved(guarding())).toBe(moved(wave()))
  expect(moved(guarding())).not.toBe(0)
  const compact = (v: GameView) =>
    at(v, [], NOW, BOX_COMPACT, COMPACT)
      .actors.filter((a) => a.flipX)
      .map((a) => a.x)
  expect(compact(guarding())).toEqual(compact(wave()))
})

test('an enraged enemy flashes red at the mishap and holds a red tint until its hit lands', () => {
  const t = new StageTimeline()
  const v = wave()
  t.observe(v, NOW)
  t.onEffects([{ k: 'enraged', enemyId: 'e1' }], NOW)
  const model = (now: number) => stageAt(stagedState(v, WORLD_DEFAULT, t, now), t, now, BOX, HI)
  const flashed = actor(model(NOW + 10).actors, 'e1')
  expect(flashed.redFlashing).toBe(true)
  expect(flashed.palette.slice(1).every((c) => c === ENRAGE_RGB)).toBe(true)
  const tinted = actor(model(NOW + 1000).actors, 'e1')
  expect(tinted.redFlashing).toBe(false)
  expect(tinted.tinted).toBe(true)
  const plain = actor(model(NOW + 1000).actors, 'e2')
  expect(plain.tinted).toBe(false)
  // Each colour moves toward red: more red, no more green or blue.
  const before = tinted.poses.idle.palette
  tinted.palette.forEach((c, i) => {
    if (i === 0) return
    const b = before[i] ?? 0
    expect((c >> 16) & 0xff).toBeGreaterThanOrEqual((b >> 16) & 0xff)
    expect(c === b && b !== ENRAGE_RGB).toBe(false)
  })
  // The red is a blink, as the white is.
  expect(actor(model(NOW + 120).actors, 'e1').redFlashing).toBe(false)
  const [start] = t.onEffects(
    [{ k: 'act', actor: 'e1', action: 'attack', at: 0 }, hit('e1', 'h1')],
    NOW + 2000,
  )
  const impact = (start ?? 0) + WINDUP_HOLD_MS + LUNGE_MS / 2
  expect(actor(model(impact - 1).actors, 'e1').tinted).toBe(true)
  expect(actor(model(impact).actors, 'e1').tinted).toBe(false)
})

test('a camp sets the campfire between the enemies and the party, then fades it', () => {
  const t = new StageTimeline()
  const v = wave()
  t.observe(v, NOW)
  t.onEffects([{ k: 'camp', heals: [] }], NOW)
  const model = (now: number) => stageAt(stagedState(v, WORLD_DEFAULT, t, now), t, now, BOX, HI)
  const m = model(NOW + 1000)
  const fire = m.campfire
  if (!fire) throw new Error('no campfire')
  expect(fire.alpha).toBe(1)
  const e3 = actor(m.actors, 'e3')
  const h1 = actor(m.actors, 'h1')
  const centre = fire.x + fire.art.width / 2
  expect(centre).toBeGreaterThan(e3.x + e3.art.width / 2)
  expect(centre).toBeLessThan(h1.x + h1.art.width / 2)
  expect(fire.y + fire.art.height).toBe(m.box.rows * 2 * m.scale)
  expect(model(NOW + CAMPFIRE_MS + CAMPFIRE_FADE_MS / 2).campfire?.alpha).toBe(0.5)
  expect(model(NOW + CAMPFIRE_MS + CAMPFIRE_FADE_MS).campfire ?? null).toBe(null)
})

test('a level-up flashes the hero gold, the white flash untouched, and its deltas rise in gold', () => {
  const t = new StageTimeline()
  const v = wave()
  t.observe(v, NOW)
  t.onEffects([{ k: 'level_up', heroId: 'h1', level: 6, deltas: { atk: 3, def: 2 } }], NOW)
  const model = (now: number) => stageAt(stagedState(v, WORLD_DEFAULT, t, now), t, now, BOX, HI)
  const flashed = actor(model(NOW + 10).actors, 'h1')
  expect(flashed.goldFlashing).toBe(true)
  expect(flashed.flashing).toBe(false)
  expect(flashed.palette.slice(1).every((c) => c === LEVEL_RGB)).toBe(true)
  expect(model(NOW + 10).numbers.map((n) => [n.text, n.rgb])).toEqual([
    ['+3 atk  +2 def', LEVEL_RGB],
  ])
  // The gold is a blink, as the white is.
  expect(actor(model(NOW + 120).actors, 'h1').goldFlashing).toBe(false)
})

test('a travel fades the party out stepping right, then in from the left at the new backdrop', () => {
  const t = new StageTimeline()
  const v = wave()
  t.observe(v, NOW)
  t.onEffects([{ k: 'traveled', from: 1, to: 3 }], NOW)
  const next: GameView = { ...v, enemies: [], zone: 3, zoneName: 'Marsh of Sighs', wave: 1 }
  const model = (now: number) => {
    t.observe(next, now)
    return stageAt(stagedState(next, WORLD_DEFAULT, t, now), t, now, BOX, HI)
  }
  const placed = actor(at().actors, 'h1')
  const off = actor(model(NOW + TRAVEL_OFF_MS / 2).actors, 'h1')
  expect(off.alpha).toBe(0.5)
  expect(off.x).toBe(placed.x + k(TRAVEL_PX) / 2)
  const show = NOW + TRAVEL_OFF_MS
  expect(model(show - 1).ground).toBe(ZONE_GROUND[0])
  const on = model(show + TRAVEL_ON_MS / 2)
  expect(on.ground).toBe(ZONE_GROUND[2])
  expect(actor(on.actors, 'h1').alpha).toBe(0.5)
  expect(actor(on.actors, 'h1').x).toBe(placed.x - k(TRAVEL_PX) / 2)
  expect(actor(model(show + TRAVEL_ON_MS).actors, 'h1')).toMatchObject({ x: placed.x, alpha: 1 })
})

test('the victory pose holds the drawn slot, the idle art on the compact stage, and never on a fallen hero', () => {
  const t = new StageTimeline()
  const down = (v: GameView): GameView => ({
    ...v,
    heroes: v.heroes.map((h) => (h.id === 'h3' ? { ...h, hp: 0, alive: false } : h)),
  })
  t.observe(down(boss()), NOW)
  t.onEffects(
    [
      { k: 'act', actor: 'h1', action: 'attack', at: 0 },
      { k: 'hit', by: 'h1', target: 'e9', amount: 500 },
    ],
    NOW,
  )
  const next = down(wave())
  t.observe(next, NOW + 1)
  const from = t.active(NOW + 1).find((m) => m.kind === 'victory')?.from ?? 0
  const model = (opts: Opts, box = BOSS_BOX) =>
    stageAt(stagedState(next, WORLD_DEFAULT, t, from + 500), t, from + 500, box, opts)
  const hi = actor(model(HI).actors, 'h1')
  expect(hi.pose).toBe('victory')
  expect(hi.art).toBe(spriteFor('hero', 'knight').frames?.victory?.art)
  expect(actor(model(HI).actors, 'h3').pose).toBe('idle')
  const compact = actor(model(COMPACT, BOX_COMPACT).actors, 'h1')
  expect(compact.pose).toBe('victory')
  expect(compact.art).toBe(spriteFor('hero', 'knight').compact)
})
