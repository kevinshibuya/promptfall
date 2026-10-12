import { expect, test } from 'claude-code/testing'
import type { GameView, WorldState } from '../../types'
import { lighten, opaqueBox, shear, squash } from '../sprites/derive'
import { backdropFor, spriteFor } from '../sprites/index'
import { WORLD_DEFAULT } from '../state'
import type { Effect, Rarity } from '../vendor/sim.js'
import { composeFrame } from './compose'
import { boss, wave, worldBoss } from './fixtures'
import { lungeOffset, type StageActor, stageAt } from './model'
import { stagedState } from './staged'
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
  STEP_OUT_MS,
  STEP_PX,
  WINDUP_HOLD_MS,
  ZONE_GROUND,
} from './tuning'

const NOW = 1_000_000 // bobbing(NOW) is 0
const BOX = { columns: 116, rows: 8 }
const BOX_COMPACT = { columns: 52, rows: 4 }
type Opts = { compact: boolean; motion: 'full' | 'still'; scale?: 1 | 1.5 }
const STILL: Opts = { compact: false, motion: 'still' }
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

test('a flashing actor draws white; a lunging hero steps and lunges toward the enemies', () => {
  const effects: Effect[] = [{ k: 'act', actor: 'h1', action: 'attack', at: 0 }, hit('h1', 'e1')]
  const mid = at(wave(), effects, NOW + LUNGE_MS / 2)
  expect(actor(mid.actors, 'h1').x).toBe(
    116 - ACTOR_EDGE - 16 - ACTOR_PITCH * 2 - STEP_PX - LUNGE_PX,
  )
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
  // The step and the lunge, 4 px each at 1, are 6 each at 1.5.
  expect(actor(mid.actors, 'h1').x).toBe(h1.x - 6 - 6)
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

test('the backdrop is the zone painting at the stage scale, and none on the compact stage', () => {
  const full = at(wave(), [], NOW, { columns: 120, rows: 8 }, { compact: false, motion: 'still' })
  expect(full.backdrop).toBe(backdropFor(1, 1))
  const hires = at(
    wave(),
    [],
    NOW,
    { columns: 120, rows: 8 },
    { compact: false, motion: 'still', scale: 1.5 },
  )
  expect(hires.backdrop).toBe(backdropFor(1, 1.5))
  const compact = at(wave(), [], NOW, { columns: 52, rows: 4 }, { compact: true, motion: 'still' })
  expect(compact.backdrop).toBe(null)
})

test("tier 2's zone 1 stands on zone 1's ground and backdrop", () => {
  const opts: Opts = { compact: false, motion: 'still' }
  const zone1 = at(wave(), [], NOW, { columns: 120, rows: 8 }, opts)
  const zone13 = at({ ...wave(), zone: 13 }, [], NOW, { columns: 120, rows: 8 }, opts)
  expect(zone13.ground).toBe(ZONE_GROUND[0])
  expect(zone13.ground).toBe(zone1.ground)
  expect(zone13.backdrop).toBe(backdropFor(1, 1))
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
  for (const opts of [LO, HI, { ...HI, motion: 'still' as const }]) {
    const scale = opts.scale ?? 1
    const stepPx = Math.round(STEP_PX * scale)
    for (const [view, enemy, target] of cases) {
      const effects: Effect[] = [
        { k: 'act', actor: enemy, action: 'attack', at: 0 },
        hit(enemy, target),
      ]
      const rest = xAt(view, [], enemy, held, opts)
      expect(xAt(view, effects, enemy, held, opts) - rest).toBe(stepPx)
      // The lunge adds its own from the stepped position.
      expect(xAt(view, effects, enemy, apex, opts) - rest).toBe(
        stepPx + Math.round(LUNGE_PX * scale),
      )
      // Back where it stood once the action is over.
      expect(xAt(view, effects, enemy, NOW + 1000, opts)).toBe(rest)
    }
  }
  // A hero steps toward the enemies.
  const knightRest = xAt(wave(), [], 'h1', held, LO)
  expect(xAt(wave(), knightHits, 'h1', held, LO) - knightRest).toBe(-STEP_PX)
  // The compact stage steps its one drawing the 1x distance.
  const compact = (effects: Effect[]) => {
    const t = new StageTimeline()
    t.observe(wave(), NOW)
    t.onEffects(effects, NOW)
    const opts: Opts = { compact: true, motion: 'full', scale: HIRES_SCALE }
    const m = stageAt(stagedState(wave(), WORLD_DEFAULT, t, held), t, held, BOX_COMPACT, opts)
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
  // 1x: e1 at x 4, 16 px, centre (12, 26). The chest's bottom starts at that centre and falls to
  // the ground (y 18); the item's centre starts at the closed chest's top (row 5) and rises 10 px.
  const closed = spriteFor('chest', 'closed')
  const lo = (now: number) => chestAt(now, FULL, STILL)
  expect(lo(NOW + 399).chest).toBeUndefined()
  expect(lo(NOW + 400).chest).toEqual({ phase: 'fall', at: [4, 10, 1] })
  // Eased in: a quarter of the way down at half the fall.
  expect(lo(NOW + 550).chest).toEqual({ phase: 'fall', at: [4, 12, 1] })
  for (const [now, phase] of [
    [NOW + 700, 'sit'],
    [NOW + 1200, 'open'],
    [NOW + 1650, 'rise'],
    [NOW + 2000, 'hold'],
  ] as const) {
    expect(lo(now).chest).toEqual({ phase, at: [4, 18, 1] })
  }
  expect(lo(NOW + 700).chestArt).toBe(closed.full)
  expect(lo(NOW + 1200).item).toBeUndefined()
  expect(lo(NOW + 1500).item).toEqual([4, 15, 1])
  expect(lo(NOW + 1650).item).toEqual([4, 10, 1])
  expect(lo(NOW + 2000).item).toEqual([4, 5, 1])
  // The fade takes the chest and the item together.
  expect(lo(NOW + 2700)).toMatchObject({ chest: { phase: 'fade', at: [4, 18, 0.5] } })
  expect(lo(NOW + 2700).item).toEqual([4, 5, 0.5])
  expect(lo(NOW + 2800).chest).toBeUndefined()
  // 1.5x: e1 at x 6, 24 px, centre (18, 39); the chest falls from 15 to 27, the item rises from 22.
  const hi = (now: number) => chestAt(now, FULL, { ...STILL, scale: HIRES_SCALE })
  expect(hi(NOW + 400).chest).toEqual({ phase: 'fall', at: [6, 15, 1] })
  expect(hi(NOW + 1200).chest).toEqual({ phase: 'open', at: [6, 27, 1] })
  expect(hi(NOW + 1500).item).toEqual([6, 22, 1])
  expect(hi(NOW + 2000).item).toEqual([6, 7, 1])
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
  // 1x: a kill's chest in slot 0 is at x 4 and lands at y 18 (the test above). This one falls
  // half its own height onto the same ground, sits, opens, and its item rises to the same place.
  const lo = (now: number) => groundChestAt(now, FULL, STILL)
  expect(lo(NOW).chest).toEqual({ phase: 'fall', at: [4, 10, 1] })
  expect(lo(NOW).actors).toBe(0)
  for (const [now, phase] of [
    [NOW + 300, 'sit'],
    [NOW + 600, 'open'],
    [NOW + 1250, 'rise'],
    [NOW + 1600, 'hold'],
  ] as const) {
    expect(lo(now).chest).toEqual({ phase, at: [4, 18, 1] })
  }
  expect(lo(NOW + 1100).item).toEqual([4, 15, 1])
  expect(lo(NOW + 1600).item).toEqual([4, 5, 1])
  expect(lo(NOW + 2300)).toMatchObject({ chest: { phase: 'fade', at: [4, 18, 0.5] } })
  expect(lo(NOW + 2400).chest).toBeUndefined()
  // 1.5x: a kill's chest in slot 0 is at x 6 on the ground at 27, its item risen to 7.
  const hi = (now: number) => groundChestAt(now, FULL, { ...STILL, scale: HIRES_SCALE })
  expect(hi(NOW + 600).chest).toEqual({ phase: 'open', at: [6, 27, 1] })
  expect(hi(NOW + 1600).item).toEqual([6, 7, 1])
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
    for (const [opts, art] of [
      [STILL, sprite?.full],
      [{ ...STILL, scale: HIRES_SCALE }, sprite?.hires],
    ] as const) {
      const at = chestAt(now, FULL, opts)
      expect(at.chestArt, `${now - NOW} ms at ${opts.scale ?? 1}x`).toBe(art)
    }
    expect(chestAt(now, BOX_COMPACT, { ...STILL, compact: true }).chestArt).toBe(sprite?.compact)
  }
  // The open art is under the item while it rises and holds.
  const rising = chestAt(NOW + 1650, FULL, STILL)
  expect(rising.item).toEqual([4, 10, 1])
  expect(rising.chestArt).toBe(open?.full)
})

test("the glow sits on the risen item's centre in its rarity colour, ramps in over the rise, holds and fades with the item; a legendary's is wider", () => {
  const FULL = { columns: 116, rows: 17 }
  const glow = (now: number, opts: Opts, rarity: Rarity = 'common', box = FULL) => {
    const g = chestAt(now, box, opts, rarity).glow
    return g && [g.x, g.y, g.r, g.alpha]
  }
  const grey = RARITY_RGB.common
  // 1x: the item risen at (4, 5), 16 px: its centre (12, 13). The rise runs NOW + 1500 to 1800.
  expect(glow(NOW + 1499, STILL)).toBeUndefined()
  expect(glow(NOW + 1500, STILL)).toEqual([12, 13, 8, 0])
  expect(glow(NOW + 1650, STILL)).toEqual([12, 13, 8, 0.25])
  expect(glow(NOW + 2000, STILL)).toEqual([12, 13, 8, 0.5])
  expect(chestAt(NOW + 2000, FULL, STILL).glow?.rgb).toBe(grey)
  // A common's fade runs NOW + 2600 to 2800, with the item's.
  expect(glow(NOW + 2700, STILL)).toEqual([12, 13, 8, 0.25])
  expect(glow(NOW + 2800, STILL)).toBeUndefined()
  // A legendary's glow is wider and gold, and holds until NOW + 3800.
  expect(glow(NOW + 3700, STILL, 'legendary')).toEqual([12, 13, 12, 0.5])
  expect(chestAt(NOW + 3700, FULL, STILL, 'legendary').glow?.rgb).toBe(RARITY_RGB.legendary)
  // 1.5x: the item risen at (6, 7), 24 px.
  const hi: Opts = { ...STILL, scale: HIRES_SCALE }
  expect(glow(NOW + 2000, hi)).toEqual([18, 19, 12, 0.5])
  expect(glow(NOW + 2000, hi, 'legendary')).toEqual([18, 19, 18, 0.5])
  // The compact stage: the 8 px item at (0, 0).
  const compact = { ...STILL, compact: true }
  expect(glow(NOW + 2000, compact, 'common', BOX_COMPACT)).toEqual([4, 4, 4, 0.5])
  expect(glow(NOW + 2000, compact, 'legendary', BOX_COMPACT)).toEqual([4, 4, 6, 0.5])
})
