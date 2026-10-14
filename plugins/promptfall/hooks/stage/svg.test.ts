import { expect, test } from 'claude-code/testing'
import type { GameView } from '../../types'
import { encode } from '../sprites/base64'
import { spriteFor } from '../sprites/index'
import { WORLD_DEFAULT } from '../state'
import type { Effect } from '../vendor/sim.js'
import { wave } from './fixtures'
import { effectAt, SHIELD, stageAt } from './model'
import { caseOf, stage } from './scenarios'
import { stagedState } from './staged'
import { backdropPlacements, fitSvg, framesInUse, renderSvg, strokePaths } from './svg'
import { type Motion, type StageEffect, StageTimeline } from './timeline'
import {
  BLINK_MS,
  CAMPFIRE_FADE_MS,
  CAMPFIRE_MS,
  CLASS_RGB,
  ENRAGE_RGB,
  ENRAGE_TINT,
  FLASH_MS,
  HASTE_FRAME_MS,
  HIRES_SCALE,
  HUDDLE_MS,
  IDLE_BOB_PX,
  LEVEL_RGB,
  LUNGE_MS,
  RARITY_RGB,
  SPAWN_MS,
  SVG_FALLBACK_FRAME_MS,
  SVG_MAX_CHARS,
  TRAVEL_OFF_MS,
  TRAVEL_PX,
  WINDUP_HOLD_MS,
  WINDUP_MS,
} from './tuning'

const NOW = 1_000_000
const BOX = { columns: 120, rows: 8 }
type Opts = { smil: boolean; motion: 'full' | 'still' }

function svg(effects: Effect[] = [], at = NOW, opts: Opts = { smil: true, motion: 'full' }) {
  const t = new StageTimeline()
  const v = wave()
  t.observe(v, NOW)
  t.onEffects(effects, NOW)
  const model = stageAt(stagedState(v, WORLD_DEFAULT, t, at), t, at, BOX, {
    compact: false,
    motion: opts.motion,
  })
  return renderSvg(model, t.active(at), { ...opts, now: at, width: 960 })
}

/** Every opened tag closes, in order. */
function balanced(s: string): boolean {
  const stack: string[] = []
  for (const m of s.matchAll(/<(\/?)([a-zA-Z]+)[^>]*?(\/?)>/g)) {
    const [, close, name, self] = m
    if (self) continue
    if (close) {
      if (stack.pop() !== name) return false
    } else stack.push(name ?? '')
  }
  return stack.length === 0
}

/** A colour as the stage picture writes it: `#abc` where the six digits pair up. */
const colour = (rgb: number) =>
  `#${rgb.toString(16).padStart(6, '0')}`.replace(/^#(\w)\1(\w)\2(\w)\3$/, '#$1$2$3')

const hit: Effect = { k: 'hit', by: 'h1', target: 'e1', amount: 7 }
const act: Effect = { k: 'act', actor: 'h1', action: 'attack', at: 0 }

test('a well-formed document on the stage box', () => {
  const s = svg()
  expect(s.startsWith('<svg')).toBe(true)
  expect(s.endsWith('</svg>')).toBe(true)
  expect(balanced(s)).toBe(true)
  expect(s).toContain('viewBox="0 0 180 24"')
  expect(s).not.toContain('<script')
  expect(s).not.toContain('<image')
})

test('each art stem is defined once, one path per colour, the rarity colour as currentColor', () => {
  const s = svg()
  // Every def but the backdrop's (`b`).
  const ids = [...s.matchAll(/<g id="(?!b")(\w+)" fill="none">(.*?)<\/g>/g)]
  // Six actors, six stems: the three heroes' classes and the three enemies' archetypes.
  expect(ids).toHaveLength(6)
  expect(new Set(ids.map((m) => m[1])).size).toBe(6)
  for (const [, , paths] of ids) {
    const fills = [...(paths ?? '').matchAll(/<path (?:fill|stroke)="([^"]+)"/g)].map((m) => m[1])
    expect(new Set(fills).size).toBe(fills.length)
  }
  expect(s).toMatch(/(fill|stroke)="currentColor"/)
  const slime = spriteFor('enemy', 'road_slime').hires
  expect(slime.palette.length).toBeGreaterThan(1)
})

test('smil animates a lunge already under way from a negative begin', () => {
  // The lunge moves after the wind-up's hold, 0.14 s in: 0.06 s under way at 0.2 s.
  const s = svg([act, hit], NOW + 200)
  expect(s.match(/<animateTransform[^>]*values="0 0;-6 0;0 0"[^>]*>/g)).toEqual([
    '<animateTransform attributeName="transform" type="translate" additive="sum" values="0 0;-6 0;0 0" begin="-0.06s" dur="0.24s"/>',
  ])
  expect(s).toContain('filter="url(#f)"')
})

test('smil plays the step as a translate on the stepper from its place, under Motion still too', () => {
  const still: Opts = { smil: true, motion: 'still' }
  const held = NOW + 110
  const s = svg([act, hit], held, still)
  expect(s.match(/<animateTransform[^>]*values="0 0;-6 0;-6 0;0 0"[^>]*>/g)).toEqual([
    '<animateTransform attributeName="transform" type="translate" additive="sum" values="0 0;-6 0;-6 0;0 0" keyTimes="0;0.16;0.84;1" begin="-0.11s" dur="0.5s"/>',
  ])
  // The actors' groups stand where they stand at rest: the animation adds the step. (A hit frame's
  // lean is a group of its own inside its actor's, with its filter.)
  const places = (doc: string) =>
    [...doc.matchAll(/<g transform="(translate\([^)]*\))">/g)].map((m) => m[1])
  expect(places(s)).toEqual(places(svg([], held, still)))
  // Without SMIL the knight is drawn stepped.
  const flat = places(svg([act, hit], held, { smil: false, motion: 'still' }))
  const rest = places(svg([], held, { smil: false, motion: 'still' }))
  expect(flat.filter((p) => !rest.includes(p))).toHaveLength(1)
})

test('a motion already over yields nothing', () => {
  const s = svg([hit], NOW + LUNGE_MS + 2000, { smil: true, motion: 'still' })
  expect(s).not.toContain('<animate')
})

test('without smil no animation element appears', () => {
  expect(svg([act, hit], NOW + 100, { smil: false, motion: 'full' })).not.toContain('<animate')
})

test('the idle pair animates with motion full only', () => {
  expect(svg([], NOW, { smil: true, motion: 'full' })).toContain('repeatCount="indefinite"')
  expect(svg([], NOW, { smil: true, motion: 'still' })).not.toContain('<animateTransform')
})

const DROP: Effect = {
  k: 'drop',
  item: {
    id: 'i',
    base: 'iron_sword',
    rarity: 'rare',
    tier: 1,
    affixes: [],
    equippedBy: null,
    tradeableAt: null,
  },
}

/** e1 killed at NOW with DROP (rare) on a 17-row stage: its chest falls from NOW + 400, lands at NOW + 700. */
function chestSvg(at: number, smil: boolean): { doc: string; chests: number } {
  const t = new StageTimeline()
  t.observe(wave(), NOW)
  t.onEffects([hit, DROP], NOW)
  const gone = wave()
  gone.enemies = gone.enemies.filter((e) => e.id !== 'e1')
  t.observe(gone, NOW + 10)
  const model = stageAt(stagedState(gone, WORLD_DEFAULT, t, at), t, at, TALL, {
    compact: false,
    motion: 'still',
  })
  const doc = renderSvg(model, t.active(at), { smil, motion: 'still', now: at, width: 960 })
  return { doc, chests: model.chests.length }
}
const TALL = { columns: 120, rows: 17 }

/** The def id `art` is drawn under in `doc`. */
function defIdOf(doc: string, art: Parameters<typeof strokePaths>[0] | undefined): string {
  if (!art) throw new Error('no art')
  const id = doc.match(new RegExp(`<g id="(\\w+)" fill="none">${strokePaths(art, null)}</g>`))?.[1]
  if (!id) throw new Error('no def for the art')
  return id
}

test('the SMIL Svg drops the chest with a translate, shows its three arts in turn and raises its item', () => {
  const [closed, opening, open] = (['closed', 'opening', 'open'] as const).map(
    (id) => spriteFor('chest', id).hires,
  )
  // Before the chest starts: e1 stood at x 6 on a 51 px stage; the chest falls 12 px to y 27 from
  // 0.4 s over 0.3 s, shows closed to 1 s, opening to 1.25 s and open after; the item rises 15 px
  // from y 22 from 1.5 s, the end of the open phase. Both fade over the last 0.2 s of the rare
  // item's 2.8 s.
  const before = chestSvg(NOW, true).doc
  const [c, o, a] = [closed, opening, open].map((art) => defIdOf(before, art))
  expect(before).toContain(
    `<g transform="translate(6 27)" opacity="0"><animate attributeName="opacity" values="1;1;0" keyTimes="0;0.929;1" begin="0.4s" dur="2.8s"/>`,
  )
  expect(before).toMatch(
    /<animateTransform attributeName="transform" type="translate" additive="sum" values="0 -12;0 0" [^>]*begin="0.4s" dur="0.3s"\/>/,
  )
  expect(before).toContain(
    `<use href="#${c}" visibility="hidden"><set attributeName="visibility" to="visible" begin="0.4s" dur="0.6s"/></use><use href="#${o}" visibility="hidden"><set attributeName="visibility" to="visible" begin="1s" dur="0.25s"/></use><use href="#${a}" visibility="hidden"><set attributeName="visibility" to="visible" begin="1.25s" dur="1.95s"/></use></g>`,
  )
  expect(before).toMatch(
    /<use href="#\w+" transform="translate\(6 22\)" opacity="0"><animate attributeName="opacity" values="1;1;0" keyTimes="0;0.882;1" begin="1.5s" dur="1.7s"\/><animateTransform attributeName="transform" type="translate" additive="sum" values="0 0;0 -15" begin="1.5s" dur="0.3s" fill="freeze"\/><\/use>/,
  )
  // A redraw mid-hold, the enemy long faded, resumes the same chest: open, the only art it draws.
  const held = chestSvg(NOW + 2000, true)
  expect(held.chests).toBe(1)
  expect(held.doc).toContain('begin="-1.6s" dur="2.8s"')
  expect(held.doc).toContain(`<use href="#${defIdOf(held.doc, open)}"/></g>`)
  for (const id of ['closed', 'opening']) {
    expect(held.doc).not.toContain(defOf(spriteFor('chest', id).hires, null))
  }
  expect(held.doc).toContain('values="0 0;0 -15" begin="-0.5s"')
  // Without SMIL, the model as of now: the open chest on the ground, the item risen.
  const flat = chestSvg(NOW + 2000, false).doc
  expect(flat).toContain(`<use href="#${defIdOf(flat, open)}" transform="translate(6 27)"/>`)
  expect(flat).toMatch(/<use href="#\w+" transform="translate\(6 7\)"\/>/)
  expect(flat).not.toContain('<animate')
})

test("a chest with no actor draws on the front slot's ground, under SMIL and without it", () => {
  // A sandbox item dropped at NOW onto a drawn, empty 17-row stage: no row to fall from, so its
  // chest falls onto slot 0's ground, where a kill's there lands (x 6, y 27; the test above).
  const t = new StageTimeline()
  const view = { ...wave(), enemies: [] }
  t.observe(view, NOW)
  t.onEffects([DROP], NOW)
  const doc = (at: number, smil: boolean) => {
    const model = stageAt(stagedState(view, WORLD_DEFAULT, t, at), t, at, TALL, {
      compact: false,
      motion: 'still',
    })
    return renderSvg(model, t.active(at), { smil, motion: 'still', now: at, width: 960 })
  }
  const before = doc(NOW, true)
  expect(before).toContain('<g transform="translate(6 27)" opacity="0">')
  expect(before).toMatch(/values="0 -12;0 0" [^>]*begin="0s" dur="0.3s"\/>/)
  expect(before).toMatch(/<use href="#\w+" transform="translate\(6 22\)" opacity="0">/)
  expect(before.match(/<circle/g)).toHaveLength(1)
  const flat = doc(NOW + 1600, false)
  const open = spriteFor('chest', 'open').hires
  expect(flat).toContain(`<use href="#${defIdOf(flat, open)}" transform="translate(6 27)"/>`)
  expect(flat).toMatch(/<use href="#\w+" transform="translate\(6 7\)"\/>/)
})

test('the glow is one circle in the rarity colour, behind the chest, its alpha ramping in over the rise', () => {
  // The rare item risen at (6, 7), 24 px: the glow on its centre (18, 19), radius 15. Its rise
  // runs 1.5 s to 1.8 s and its fade from 3 s to 3.2 s: of its 1.7 s, 0.176 and 0.882.
  const blue = colour(RARITY_RGB.rare ?? 0)
  const before = chestSvg(NOW, true).doc
  expect(before.match(/<circle/g)).toHaveLength(1)
  expect(before).toContain(
    `<circle cx="18" cy="19" r="15" fill="${blue}" opacity="0"><animate attributeName="opacity" values="0;0.5;0.5;0" keyTimes="0;0.176;0.882;1" begin="1.5s" dur="1.7s"/></circle>`,
  )
  const chest = before.indexOf('<g transform="translate(6 27)" opacity="0">')
  expect(chest).toBeGreaterThan(0)
  expect(before.indexOf('<circle')).toBeLessThan(chest)
  // A redraw mid-hold resumes it.
  const held = chestSvg(NOW + 2000, true).doc
  expect(held.match(/<circle/g)).toHaveLength(1)
  expect(held).toContain('values="0;0.5;0.5;0" keyTimes="0;0.176;0.882;1" begin="-0.5s" dur="1.7s"')
  // Without SMIL, the glow as of now.
  const flat = chestSvg(NOW + 2000, false).doc
  expect(flat.match(/<circle/g)).toHaveLength(1)
  expect(flat).toContain(`<circle cx="18" cy="19" r="15" fill="${blue}" opacity="0.5"/>`)
  // Before the rise, no glow.
  expect(chestSvg(NOW + 1200, false).doc).not.toContain('<circle')
})

test('the reveal scenarios stay under the Svg cap with SMIL on, on the first rung', () => {
  for (const name of ['reveal', 'reveal-legendary'] as const) {
    const s = stage(name)
    const opts = { smil: true, now: s.now, width: 960, motion: 'full' as const }
    const hi = renderSvg(s.model, s.motions, opts)
    expect(hi.length, name).toBeLessThan(SVG_MAX_CHARS)
    expect(fitSvg(s.model, s.motions, opts), name).toEqual({ svg: hi, rung: 0 })
    expect(hi.match(/<circle/g), name).toHaveLength(1)
  }
})

test('a hero flashing at a redraw keeps its rarity colour under the flash', () => {
  const t = new StageTimeline()
  const v = wave()
  t.observe(v, NOW)
  t.onEffects([{ k: 'hit', by: 'e1', target: 'h2', amount: 3 }], NOW)
  const flash = t.active(NOW).find((m) => m.actor === 'h2' && m.kind === 'flash')
  if (!flash) throw new Error('no flash')
  const at = flash.from + 10
  const model = stageAt(stagedState(v, WORLD_DEFAULT, t, at), t, at, BOX, {
    compact: false,
    motion: 'full',
  })
  const s = renderSvg(model, t.active(at), { smil: true, motion: 'full', now: at, width: 960 })
  const rare = colour(RARITY_RGB.rare ?? 0)
  expect(s).toContain(`color="${rare}"`)
})

test('the rest scenario at 1.5: viewBox 0 0 180 51 at the same rendered width', () => {
  const s = stage('rest')
  const opts = { smil: true, now: s.now, width: 960, motion: 'full' as const }
  const hi = fitSvg(s.model, s.motions, opts).svg
  expect(hi).toContain('viewBox="0 0 180 51" width="960" height="272"')
  // The hero art carries its 1.5x rarity slot as currentColor.
  expect(hi).toMatch(/(fill|stroke)="currentColor"/)
})

const SMIL = { smil: true, width: 960, motion: 'full' as const }
const hiSvg = (name: Parameters<typeof stage>[0], smil = true) => {
  const s = stage(name)
  return renderSvg(s.model, s.motions, { ...SMIL, smil, now: s.now })
}
const knightHi = spriteFor('hero', 'knight')
const defOf = (art: Parameters<typeof strokePaths>[0], slot: number | null) =>
  `>${strokePaths(art, slot)}</g>`
const count = (s: string, needle: string) => s.split(needle).length - 1

test('at 1.5 the rest scenario defines each art once, two row clips per art, and no bob', () => {
  const svg = hiSvg('rest')
  // The arts' defs: every one but the backdrop's.
  const defs = (svg.match(/<g id="(?!b")\w+" fill="none">/g) ?? []).length
  expect(defs).toBe(6)
  expect(count(svg, '<clipPath')).toBe(2 * defs)
  const bobPx = Math.round(IDLE_BOB_PX * HIRES_SCALE)
  expect(svg).not.toContain(`0 -${bobPx}"`)
  expect(svg).toContain('attributeName="visibility" values="visible;hidden" calcMode="discrete"')
})

test("60 ms into the knight's lunge the Svg carries its wind-up, strike and follow-through and the enemy's hit clips", () => {
  const svg = hiSvg('windup')
  const f = knightHi.frames
  if (!f?.follow) throw new Error('the knight has no frames')
  expect(svg).toContain(defOf(f.windup.art, f.windup.raritySlot))
  expect(svg).toContain(defOf(f.strike.art, f.strike.raritySlot))
  expect(svg).toContain(defOf(f.follow.art, f.follow.raritySlot))
  // The hit's lean: a row band shifted one pixel.
  expect(svg).toMatch(/clip-path="url\(#\w+\)" transform="translate\(1 0\)"/)
  // The wind-up, from the action's start through the hold and the lunge out, is 60 ms from over.
  const begin = String(-(WINDUP_HOLD_MS + 60) / 1000).replace('.', '\\.')
  const dur = String((WINDUP_HOLD_MS + WINDUP_MS) / 1000).replace('.', '\\.')
  expect(svg).toMatch(
    new RegExp(
      `<g visibility="hidden"><set attributeName="visibility" to="visible" begin="${begin}s" dur="${dur}s"/>`,
    ),
  )
  expect(svg).toContain('filter="url(#h)"')
})

test('180 ms in, the wind-up is over: no wind-up def', () => {
  const f = knightHi.frames
  if (!f) throw new Error('the knight has no frames')
  expect(hiSvg('strike')).not.toContain(defOf(f.windup.art, f.windup.raritySlot))
})

test('an action that starts after the next redraw carries none of its frames', () => {
  const t = new StageTimeline()
  const v = wave()
  t.observe(v, NOW)
  // The goblin's action at NOW, moving from the end of its hold; the knight's at NOW + 500 (after
  // the goblin's ACTION_MS). Drawn as the goblin starts to move.
  t.onEffects(
    [
      { k: 'act', actor: 'e1', action: 'attack', at: 0 },
      { k: 'hit', by: 'e1', target: 'h1', amount: 3 },
      { k: 'act', actor: 'h1', action: 'attack', at: 300 },
      { k: 'hit', by: 'h1', target: 'e1', amount: 3 },
    ],
    NOW,
  )
  const moving = NOW + WINDUP_HOLD_MS
  const model = stageAt(stagedState(v, WORLD_DEFAULT, t, moving), t, moving, BOX, {
    compact: false,
    motion: 'full',
  })
  const svg = renderSvg(model, t.active(moving), { ...SMIL, now: moving })
  const f = knightHi.frames
  if (!f) throw new Error('the knight has no frames')
  expect(svg).not.toContain(defOf(f.windup.art, f.windup.raritySlot))
  // The knight's hit, inside the goblin's action, is in use.
  expect(svg).toContain('filter="url(#h)"')
})

test('two queued casts both throw from the stepped position', () => {
  const t = new StageTimeline()
  const v = wave()
  t.observe(v, NOW)
  // The mage's second action starts at the first's end, after the first step is back.
  t.onEffects(
    [
      { k: 'act', actor: 'h2', action: 'attack', at: 0 },
      { k: 'hit', by: 'h2', target: 'e1', amount: 3 },
      { k: 'act', actor: 'h2', action: 'attack', at: 300 },
      { k: 'hit', by: 'h2', target: 'e1', amount: 3 },
    ],
    NOW,
  )
  const model = stageAt(stagedState(v, WORLD_DEFAULT, t, NOW), t, NOW, BOX, {
    compact: false,
    motion: 'full',
  })
  const svg = renderSvg(model, t.active(NOW), { ...SMIL, now: NOW })
  const launches = [
    ...svg.matchAll(
      /<g transform="translate\((-?\d+) (-?\d+)\)" opacity="0"><animate attributeName="opacity" values="1;1"/g,
    ),
  ].map((m) => Number(m[1]))
  expect(launches.length).toBe(2)
  expect(launches[1]).toBe(launches[0])
})

test("the bolt scenario flies a fireball from the mage's front edge to the target's centre", () => {
  const s = stage('bolt')
  const svg = renderSvg(s.model, s.motions, { ...SMIL, now: s.now })
  const fireball = spriteFor('effect', 'fireball').hires
  expect(svg).toContain(defOf(fireball, null))
  const mage = s.model.actors.find((a) => a.key === 'h2')
  const goblin = s.model.actors.find((a) => a.key === 'e1')
  if (!mage || !goblin) throw new Error('missing actors')
  const place = (a: typeof mage) => ({
    x: a.x,
    y: a.y,
    width: a.poses.idle.art.width,
    height: a.poses.idle.art.height,
  })
  const from = effectAt(fireball, true, place(mage), place(goblin), 0)
  const to = effectAt(fireball, true, place(mage), place(goblin), 1)
  if (!from || !to) throw new Error('empty fireball')
  expect(svg).toContain(`<g transform="translate(${from.x} ${from.y})" opacity="0">`)
  expect(svg).toContain(`values="0 0;${to.x - from.x} ${to.y - from.y}"`)
})

test('without SMIL each actor draws only the art of its pose at now', () => {
  const svg = hiSvg('windup', false)
  const f = knightHi.frames
  if (!f?.follow) throw new Error('the knight has no frames')
  expect(svg).toContain(defOf(f.windup.art, f.windup.raritySlot))
  expect(svg).not.toContain(defOf(f.strike.art, f.strike.raritySlot))
  expect(svg).not.toContain(defOf(f.follow.art, f.follow.raritySlot))
  expect(svg).not.toContain('<clipPath')
  expect(svg).not.toContain('<animate')
})

test('the 1.5x blink is 100 ms of white over the hit frame', () => {
  const svg = hiSvg('strike')
  expect(svg).toMatch(
    /<g opacity="0"><animate attributeName="opacity" values="1;0" begin="[-0-9.]+s" dur="0\.1s"\/><g transform="translate\(-?\d+ 0\)[^"]*" filter="url\(#f\)">/,
  )
})

test('in the B half of a second, or during a hit, the 1.5x SMIL Svg defines no derived art', () => {
  const t = new StageTimeline()
  const v = wave()
  t.observe(v, NOW)
  const at = NOW + 700 // the second half of the bob's clock: every actor in idle B
  const model = stageAt(stagedState(v, WORLD_DEFAULT, t, at), t, at, BOX, {
    compact: false,
    motion: 'full',
  })
  expect(model.actors.every((a) => a.pose === 'idle_b')).toBe(true)
  const svg = renderSvg(model, t.active(at), { ...SMIL, now: at })
  for (const a of model.actors) expect(svg).not.toContain(defOf(a.art, a.raritySlot))
  // The same document as at rest in the A half, but for the clock's begin offsets.
  expect(Math.abs(svg.length - hiSvg('rest').length)).toBeLessThan(100)
  const s = stage('strike')
  const goblin = s.model.actors.find((a) => a.key === 'e1')
  if (!goblin) throw new Error('no goblin')
  expect(goblin.pose).toBe('hit')
  expect(hiSvg('strike')).not.toContain(defOf(goblin.art, goblin.raritySlot))
})

test('without SMIL, a hero in its hit frame carries its idle rarity colour under the hit filter', () => {
  const t = new StageTimeline()
  const v = wave()
  t.observe(v, NOW)
  t.onEffects(
    [
      { k: 'act', actor: 'e1', action: 'attack', at: 0 },
      { k: 'hit', by: 'e1', target: 'h1', amount: 3 },
    ],
    NOW,
  )
  const at = NOW + 150
  const model = stageAt(stagedState(v, WORLD_DEFAULT, t, at), t, at, BOX, {
    compact: false,
    motion: 'full',
  })
  const svg = renderSvg(model, t.active(at), { ...SMIL, smil: false, now: at })
  const common = colour(RARITY_RGB.common ?? 0)
  expect(svg).toContain(`color="${common}"`)
})

test('under SMIL an effect draws under the numbers, as on the pixel surfaces', () => {
  const t = new StageTimeline()
  const v = wave()
  t.observe(v, NOW)
  t.onEffects(
    [
      { k: 'act', actor: 'h1', action: 'attack', at: 0 },
      { k: 'hit', by: 'h1', target: 'e1', amount: 42 },
      { k: 'act', actor: 'h3', action: 'attack', at: 400 },
      { k: 'hit', by: 'h3', target: 'e1', amount: 5 },
    ],
    NOW,
  )
  const at = NOW + 500
  const model = stageAt(stagedState(v, WORLD_DEFAULT, t, at), t, at, BOX, {
    compact: false,
    motion: 'full',
  })
  const svg = renderSvg(model, t.active(at), { ...SMIL, now: at })
  const burst = svg.indexOf(`href="#${''}`, svg.indexOf('values="1;1" begin'))
  expect(svg.indexOf('>42</text>')).toBeGreaterThan(
    svg.lastIndexOf('<g transform="translate(', svg.indexOf('<text')),
  )
  expect(burst).toBeGreaterThan(-1)
  const effectAt = svg.search(
    /<g transform="translate\(-?\d+ -?\d+\)" opacity="0"><animate attributeName="opacity" values="1;1"[^>]*\/><use/,
  )
  expect(effectAt).toBeGreaterThan(-1)
  expect(effectAt).toBeLessThan(svg.indexOf('<text'))
})

test('a backdrop is one def of stroked and filled paths, used under the actors in place of the ground strip; never an <image>', () => {
  const t = new StageTimeline()
  const v = wave()
  t.observe(v, NOW)
  const base = stageAt(stagedState(v, WORLD_DEFAULT, t, NOW), t, NOW, BOX, {
    compact: false,
    motion: 'still',
  })
  // A sky over a one-pixel ground row, a one-pixel post down its left edge.
  const idx = new Uint8Array(240 * 51).fill(1)
  for (let x = 0; x < 240; x++) idx[50 * 240 + x] = 2
  for (let y = 0; y < 50; y++) idx[y * 240] = 3
  const backdrop = {
    width: 240,
    height: 51,
    palette: [0, 0x203040, 0x506070, 0xff8800],
    pixels: encode(idx),
  }
  const opts = { smil: false, now: NOW, width: 960, motion: 'still' as const }
  const s = renderSvg({ ...base, backdrop }, [], opts)
  expect(s).not.toContain('<image')
  expect(s).not.toContain('<rect x="0" y="21"')
  // Each colour the shortest of its three: the sky a filled rectangle, the ground row stroked
  // across, the post stroked down; a colour whose digits pair up in three digits.
  expect(s).toContain(
    '<g id="b" fill="none"><path fill="#203040" d="M1 0h239v50h-239"/><path stroke="#506070" d="M0 50.5h240"/><path stroke="#f80" d="M.5 0v50"/></g>',
  )
  // The 180 × 24 frame (120 columns, 8 rows at 1.5) centre-crops the 240 × 51 painting: one use,
  // before any actor.
  const uses = [...s.matchAll(/<use href="#b"[^>]*>/g)].map((m) => m[0])
  expect(uses).toEqual(['<use href="#b" transform="translate(-30 -27)"/>'])
  expect(s.indexOf('<use href="#b"')).toBeLessThan(s.indexOf('<use href="#a'))
  // The strip stays for a model without a backdrop.
  const bare = renderSvg({ ...base, backdrop: null }, [], opts)
  expect(bare).toContain('<rect x="0" y="21" width="180" height="3"')
  // A zoomed-out 600-wide frame: the painting at 180, mirrored copies to 0 and 600.
  const wide = renderSvg({ ...base, backdrop, box: { columns: 400, rows: 8 } }, [], opts)
  expect([...wide.matchAll(/<use href="#b"[^>]*>/g)].map((m) => m[0])).toEqual([
    '<use href="#b" transform="translate(180 -27)"/>',
    '<use href="#b" transform="translate(180 -27) scale(-1 1)"/>',
    '<use href="#b" transform="translate(660 -27) scale(-1 1)"/>',
  ])
})

test('backdropPlacements covers a frame of any width with mirrored copies, every other one plain', () => {
  expect(backdropPlacements(240, 180, -30)).toEqual([{ x: -30, mirror: false }])
  expect(backdropPlacements(240, 240, 0)).toEqual([{ x: 0, mirror: false }])
  // 1000 wide: the painting at 380, then 380-240..380 mirrored, 620..860 mirrored, then plain
  // copies at -100 and 860, the plain left one drawn from x -100.
  expect(backdropPlacements(240, 1000, 380)).toEqual([
    { x: 380, mirror: false },
    { x: 380, mirror: true },
    { x: 860, mirror: true },
    { x: -100, mirror: false },
    { x: 860, mirror: false },
  ])
})

/** The full stage's Svg of `v` after `effects` at `at`. */
function svgOf(
  v: GameView,
  effects: StageEffect[] = [],
  at = NOW,
  opts: Opts = { smil: true, motion: 'full' },
) {
  const t = new StageTimeline()
  t.observe(v, NOW)
  t.onEffects(effects, NOW)
  const model = stageAt(stagedState(v, WORLD_DEFAULT, t, at), t, at, BOX, {
    compact: false,
    motion: opts.motion,
  })
  return renderSvg(model, t.active(at), { ...opts, now: at, width: 960 })
}
const party = (patch: Partial<GameView['heroes'][number]>): GameView => {
  const v = wave()
  v.heroes = v.heroes.map((h) => ({ ...h, ...patch }))
  return v
}

test('hasted, the idle pair turns on a half-second clock, each frame over its own speed lines', () => {
  const v = party({ hasted: true })
  const hi = svgOf(v)
  expect(balanced(hi)).toBe(true)
  expect(hi).toContain(`dur="${(HASTE_FRAME_MS * 2) / 1000}s" repeatCount="indefinite"`)
  const t = new StageTimeline()
  t.observe(v, NOW)
  const model = stageAt(stagedState(v, WORLD_DEFAULT, t, NOW), t, NOW, BOX, {
    compact: false,
    motion: 'full',
  })
  /** The tints a hero's speed lines draw in. */
  const tints = (key: string) =>
    model.actors.find((a) => a.key === key)?.speedLines?.[0].art.palette.slice(1) ?? []
  for (const h of wave().heroes) {
    expect(tints(h.id).length, h.id).toBe(3)
    for (const c of tints(h.id)) expect(hi, h.id).toContain(`="${colour(c)}"`)
    // The lines are a light tint, not the class colour itself.
    expect(hi).not.toContain(`="${colour(CLASS_RGB[h.cls] ?? 0)}"`)
  }
  // Each pattern rides its own frame of the bob's clock, under the hero.
  const lines = model.actors.find((a) => a.key === 'h1')?.speedLines
  if (!lines) throw new Error('no lines')
  const [a, b] = lines.map((m) => `transform="translate(${m.dx} ${m.dy})"/>`)
  const idleA =
    hi.match(/<g><animate attributeName="visibility" values="visible;hidden"[\s\S]*?<\/g>/g) ?? []
  const idleB =
    hi.match(
      /<g visibility="hidden"><animate attributeName="visibility" values="hidden;visible"[\s\S]*?<\/g>/g,
    ) ?? []
  expect(idleA.some((g) => g.includes(a ?? '-'))).toBe(true)
  expect(idleB.some((g) => g.includes(b ?? '-'))).toBe(true)
  const calm = svgOf(wave())
  for (const c of tints('h1')) expect(calm).not.toContain(`="${colour(c)}"`)
  // Under still the first pattern draws and nothing bobs.
  const still = svgOf(v, [], NOW, { smil: true, motion: 'still' })
  for (const c of tints('h1')) expect(still).toContain(`="${colour(c)}"`)
  expect(still).not.toContain('repeatCount')
})

test('a mishap flashes red beside the white flash filter and holds the tint until the hit', () => {
  const enraged: Effect[] = [{ k: 'enraged', enemyId: 'e1' }]
  const s = svgOf(wave(), enraged, NOW + 10)
  expect(balanced(s)).toBe(true)
  expect(s).toContain(`<filter id="r"><feFlood flood-color="${colour(ENRAGE_RGB)}"/>`)
  expect(s).toContain(`<filter id="f"><feFlood flood-color="#fff"/>`)
  expect(s).toContain(`<set attributeName="opacity" to="${ENRAGE_TINT}" begin="-0.01s"/>`)
  const flat = svgOf(wave(), enraged, NOW + 1000, { smil: false, motion: 'full' })
  expect(flat).toContain(`filter="url(#r)" opacity="${ENRAGE_TINT}"`)
  // No mishap, no red in the document.
  expect(svgOf(wave())).not.toContain('<filter id="r"')
})

test('a camp lights the campfire, then fades it, under SMIL and without it', () => {
  const camp: Effect[] = [{ k: 'camp', heals: [] }]
  const campfire = spriteFor('effect', 'campfire')
  const s = svgOf(wave(), camp, NOW + 1000)
  expect(s).toContain(
    `keyTimes="0;${Number((CAMPFIRE_MS / (CAMPFIRE_MS + CAMPFIRE_FADE_MS)).toFixed(3))};1" begin="-1s"`,
  )
  expect(s).toContain(strokePaths(campfire.hires, null))
  const flat = svgOf(wave(), camp, NOW + CAMPFIRE_MS + CAMPFIRE_FADE_MS / 2, {
    smil: false,
    motion: 'full',
  })
  expect(flat).toContain('opacity="0.5"/>')
})

test('making camp under SMIL: the enemies walk off toward their edge as they fade, the fire holds lit with no fade', () => {
  const s = svgOf(wave(), [{ k: 'camp', on: true, heals: [] }], NOW + 100)
  expect(balanced(s)).toBe(true)
  const walk = Math.round(TRAVEL_PX * HIRES_SCALE)
  const leave = `values="0 0;-${walk} 0" begin="-0.1s" dur="${SPAWN_MS / 1000}s" fill="freeze"/><animate attributeName="opacity" values="1;0"`
  expect(s.split(leave).length - 1).toBe(wave().enemies.length)
  expect(s).toContain('<set attributeName="opacity" to="1" begin="-0.1s"/>')
  expect(s).not.toMatch(/NaN|Infinity/)
})

test('breaking camp under SMIL: the held enemies walk back in from their edge, the fire fades', () => {
  const t = new StageTimeline()
  t.observe(wave(), NOW - 2000)
  t.onEffects([{ k: 'camp', on: true, heals: [] }], NOW - 1000)
  t.observe({ ...wave(), camping: true }, NOW - 500)
  t.onEffects([{ k: 'camp', on: false, heals: [] }], NOW)
  const at = NOW + 100
  t.observe(wave(), at)
  const model = stageAt(stagedState(wave(), WORLD_DEFAULT, t, at), t, at, BOX, {
    compact: false,
    motion: 'full',
  })
  const s = renderSvg(model, t.active(at), { smil: true, motion: 'full', now: at, width: 960 })
  expect(balanced(s)).toBe(true)
  const walk = Math.round(TRAVEL_PX * HIRES_SCALE)
  const back = `values="-${walk} 0;0 0" begin="-0.1s" dur="${SPAWN_MS / 1000}s" fill="freeze"/><animate attributeName="opacity" values="0;1"`
  expect(s.split(back).length - 1).toBe(wave().enemies.length)
  const sit = Number((1000 / (1000 + CAMPFIRE_FADE_MS)).toFixed(3))
  expect(s).toContain(`values="1;1;0" keyTimes="0;${sit};1" begin="-1.1s"`)
  expect(s).not.toMatch(/NaN|Infinity/)
})

test('a party first drawn camping sits at its lit fire under SMIL, with no enemy drawn', () => {
  const s = svgOf({ ...wave(), camping: true })
  const campfire = spriteFor('effect', 'campfire')
  expect(s).toContain(strokePaths(campfire.hires, null))
  expect(s).not.toContain('<set attributeName="opacity" to="1"')
  // Only the heroes are drawn, and camping they hold still: no clock in the picture.
  expect(s).not.toContain('repeatCount="indefinite"')
})

test('guarding heroes hold the stance with no idle clock; the front hero holds the big shield', () => {
  const hi = svgOf(party({ guarding: true }))
  expect(balanced(hi)).toBe(true)
  // Only the enemies still bob.
  expect(hi.match(/repeatCount="indefinite"/g)?.length).toBe(2 * wave().enemies.length)
  expect(hi).toContain(strokePaths(SHIELD.hires, null))
})

test("an enemy's hit under Guard flashes the shield white in the struck hero's flash, under SMIL and without it", () => {
  const blow: StageEffect[] = [
    { k: 'act', actor: 'e1', action: 'attack', at: 0 },
    { k: 'hit', by: 'e1', target: 'h2', amount: 7 },
  ]
  const impact = NOW + WINDUP_HOLD_MS + LUNGE_MS / 2
  const white = (begin: number, dur: number) =>
    new RegExp(
      `translate\\(-?\\d+ -?\\d+\\)" filter="url\\(#f\\)" opacity="0"><animate attributeName="opacity" values="1;0" begin="${begin / 1000}s" dur="${dur / 1000}s"/></use>`,
    )
  // Drawn before the blow, the shield's white is scheduled at the impact for the hero's blink.
  const hi = svgOf(party({ guarding: true }), blow, NOW)
  expect(balanced(hi)).toBe(true)
  expect(hi).toMatch(white(impact - NOW, BLINK_MS))
  expect(svgOf(party({ guarding: true }), [], NOW)).not.toContain('filter="url(#f)" opacity="0"')
  // The compact stage holds its white for the whole flash, as the struck hero's.
  const t = new StageTimeline()
  const v = party({ guarding: true })
  t.observe(v, NOW)
  t.onEffects(blow, NOW)
  const box = { columns: 52, rows: 4 }
  const compact = stageAt(stagedState(v, WORLD_DEFAULT, t, NOW), t, NOW, box, {
    compact: true,
    motion: 'full',
  })
  const lo = renderSvg(compact, t.active(NOW), { smil: true, motion: 'full', now: NOW, width: 960 })
  expect(lo).toContain(strokePaths(SHIELD.compact, null))
  expect(lo).toMatch(white(impact - NOW, FLASH_MS))
  // Without SMIL, the shield is white at the impact and plain before it.
  const flatWhite = /translate\(-?\d+ -?\d+\)" filter="url\(#f\)"\/>/
  const flat = { smil: false, motion: 'full' } as const
  expect(svgOf(party({ guarding: true }), blow, impact, flat)).toMatch(flatWhite)
  expect(svgOf(party({ guarding: true }), blow, impact - 1, flat)).not.toMatch(flatWhite)
})

/** A stage that saw the party off or on guard, then the guard effect turning it `on` at NOW. */
function guardTurned(on: boolean, at: number, smil = true) {
  const t = new StageTimeline()
  t.observe(party({ guarding: !on }), NOW - 1000)
  t.onEffects([{ k: 'guard', on }], NOW)
  const v = party({ guarding: on })
  const model = stageAt(stagedState(v, WORLD_DEFAULT, t, at), t, at, BOX, {
    compact: false,
    motion: 'full',
  })
  return {
    model,
    svg: renderSvg(model, t.active(at), { smil, motion: 'full', now: at, width: 960 }),
  }
}

test('the huddle slides each hero from its slot as a transform animation, frozen huddled, in idle A until it arrives', () => {
  const xOf = (m: { model: { actors: { key: string; x: number; y: number }[] } }, key: string) =>
    m.model.actors.find((a) => a.key === key) ?? { x: 0, y: 0 }
  const slot = xOf(guardTurned(false, NOW + HUDDLE_MS), 'h3')
  const huddled = xOf(guardTurned(true, NOW + HUDDLE_MS), 'h3')
  const dx = huddled.x - slot.x
  expect(dx).toBeLessThan(0)
  const slide = (values: string) =>
    `<animateTransform attributeName="transform" type="translate" additive="sum" values="${values}" begin="-0.05s" dur="0.2s" fill="freeze"/>`
  // In: drawn 50 ms in, from the slot, frozen at the huddle.
  const on = guardTurned(true, NOW + 50).svg
  expect(balanced(on)).toBe(true)
  expect(on).toContain(`<g transform="translate(${slot.x} ${slot.y})">${slide(`0 0;${dx} 0`)}`)
  // Idle A shows through the rest of the slide; the stance is hidden under it.
  expect(on).toContain('<set attributeName="visibility" to="visible" begin="-0.05s" dur="0.2s"/>')
  expect(on).toContain('<set attributeName="visibility" to="hidden" begin="-0.05s" dur="0.2s"/>')
  // Out: from the huddle back to the slot.
  const off = guardTurned(false, NOW + 50).svg
  expect(off).toContain(
    `<g transform="translate(${huddled.x} ${huddled.y})">${slide(`0 0;${-dx} 0`)}`,
  )
  // Arrived, the huddle is the place and nothing slides; the flat picture draws the model's x.
  const after = guardTurned(true, NOW + HUDDLE_MS + 10).svg
  expect(after).not.toContain('fill="freeze"/>')
  expect(after).toContain(`<g transform="translate(${huddled.x} ${huddled.y})">`)
  const flat = guardTurned(true, NOW + 50, false)
  const mid = xOf(flat, 'h3')
  expect(mid.x).not.toBe(slot.x)
  expect(flat.svg).toContain(`translate(${mid.x} ${mid.y})`)
})

test('a huddle reversed mid-slide is one slide back from where the party stands, as the pixels draw it', () => {
  const xOf = (m: { actors: { key: string; x: number; y: number }[] }, key: string) =>
    m.actors.find((a) => a.key === key) ?? { x: 0, y: 0 }
  const slot = xOf(guardTurned(false, NOW + HUDDLE_MS).model, 'h3')
  const huddled = xOf(guardTurned(true, NOW + HUDDLE_MS).model, 'h3')
  const dx = huddled.x - slot.x
  const t = new StageTimeline()
  t.observe(party({ guarding: false }), NOW - 1000)
  t.onEffects([{ k: 'guard', on: true }], NOW)
  t.onEffects([{ k: 'guard', on: false }], NOW + 50)
  const now = NOW + 60
  const v = party({ guarding: false })
  const model = stageAt(stagedState(v, WORLD_DEFAULT, t, now), t, now, BOX, {
    compact: false,
    motion: 'full',
  })
  const svg = renderSvg(model, t.active(now), { smil: true, motion: 'full', now, width: 960 })
  // Turned a quarter in, the slide back runs as if it began 150 ms before the turn.
  expect(svg).toContain(
    `<g transform="translate(${huddled.x} ${huddled.y})"><animateTransform attributeName="transform" type="translate" additive="sum" values="0 0;${-dx} 0" begin="-0.16s" dur="0.2s" fill="freeze"/>`,
  )
  expect(svg).not.toContain(`values="0 0;${dx} 0"`)
})

test('a level-up flashes gold beside the white flash filter and its deltas rise as gold text', () => {
  const up: StageEffect[] = [{ k: 'level_up', heroId: 'h1', level: 6, deltas: { atk: 3, def: 2 } }]
  const gold = colour(LEVEL_RGB)
  const s = svgOf(wave(), up, NOW + 10)
  expect(balanced(s)).toBe(true)
  expect(s).toContain(`<filter id="g"><feFlood flood-color="${gold}"/>`)
  expect(s).toContain(`<filter id="f"><feFlood flood-color="#fff"/>`)
  expect(s).toContain(`fill="${gold}"`)
  expect(s).toContain('+3 atk  +2 def</text>')
  const flat = svgOf(wave(), up, NOW + 10, { smil: false, motion: 'full' })
  expect(flat).toContain('filter="url(#g)"/>')
  expect(svgOf(wave())).not.toContain('<filter id="g"')
})

test('a travel steps the party off fading and on from the left, under SMIL and without it', () => {
  const traveled: StageEffect[] = [{ k: 'traveled', from: 1, to: 3 }]
  const px = Math.round(TRAVEL_PX * HIRES_SCALE)
  const s = svgOf(wave(), traveled, NOW + 100)
  expect(balanced(s)).toBe(true)
  expect(s).toContain(`values="0 0;${px} 0" begin="-0.1s"`)
  expect(s).toContain(`values="1;0" begin="-0.1s" dur="0.5s" fill="freeze"`)
  expect(s).toContain(`values="-${px} 0;0 0" begin="0.4s"`)
  // Drawn once the backdrop has changed, the party starts unseen and fades in.
  const on = svgOf(wave(), traveled, NOW + TRAVEL_OFF_MS + 100)
  expect(on).toContain(`values="0;1" begin="-0.1s" dur="0.5s" fill="freeze"`)
  expect(on).not.toContain(`values="1;0" begin=`)
  const flat = svgOf(wave(), traveled, NOW + TRAVEL_OFF_MS / 2, {
    smil: false,
    motion: 'full',
  })
  expect(flat).toContain('opacity="0.5"')
})

test('a victory pose is carried from the kill, however far ahead it starts', () => {
  const victory: Motion = {
    kind: 'victory',
    actor: 'h1',
    boss: 'e9',
    from: NOW + 900,
    until: NOW + 2900,
  }
  const windup: Motion = { kind: 'windup', actor: 'h1', from: NOW + 900, until: NOW + 1000 }
  expect(NOW + SVG_FALLBACK_FRAME_MS).toBeLessThan(victory.from)
  expect(framesInUse([victory, windup], NOW)).toEqual([victory])
})

test('the ladder without SMIL: the second rung draws idle B as idle A, the one frame held', () => {
  // An instant in the bob's second half, where a resting actor's pose at now is idle B.
  const c = caseOf('rest')
  const at = [0, 250, 500, 750]
    .map((d) => c.now + d)
    .find((t) => c.at(t).model.actors.some((a) => a.pose === 'idle_b'))
  if (at === undefined) throw new Error('no idle B instant')
  const s = c.at(at)
  const opts = { smil: false, now: at, width: 960, motion: 'full' as const }
  const first = renderSvg(s.model, s.motions, { ...opts, rung: 0 })
  const still = renderSvg(s.model, s.motions, { ...opts, rung: 1 })
  // The first rung carries the squashed idle B; the second the idle art alone (one def swaps for
  // another, so the count need not drop: the rung is for the SMIL picture's pair).
  expect(still).not.toBe(first)
  const bobbing = s.model.actors.filter((a) => a.pose === 'idle_b')
  for (const a of bobbing) {
    const idle = strokePaths(a.poses.idle.art, a.raritySlot)
    const squashed = strokePaths(a.art, a.raritySlot)
    expect(still).toContain(idle)
    expect(still).not.toContain(squashed)
  }
  // The flat picture never climbs: under the cap the ladder answers the first rung.
  expect(fitSvg(s.model, s.motions, opts)).toEqual({ svg: first, rung: 0 })
})

test('the ladder: each rung drops one thing in order, never a drawn frame, and a picture under the cap stays on the first', () => {
  const s = stage('strike')
  const opts = { ...SMIL, now: s.now }
  const at = ([0, 1, 2, 3] as const).map((rung) => renderSvg(s.model, s.motions, { ...opts, rung }))
  const [first, still, unlit, bare] = at
  if (!first || !still || !unlit || !bare) throw new Error('no rung')
  // The first rung: the idle pair on its clock, the hit filter, the backdrop painting.
  expect(first).toContain('repeatCount="indefinite"')
  expect(first).toContain('filter="url(#h)"')
  expect(first).toContain('<use href="#b"')
  // The idle pair goes: idle A alone, the actor holds still.
  expect(still).not.toContain('repeatCount="indefinite"')
  expect(still).toContain('filter="url(#h)"')
  // Then the hit filter: the hit frame leans, unlit.
  expect(unlit).not.toContain('url(#h)')
  expect(unlit).not.toContain('<filter id="h"')
  expect(unlit).toContain('<use href="#b"')
  // Then the backdrop painting: the ground strip alone.
  expect(bare).not.toContain('<use href="#b"')
  expect(bare).toMatch(/<rect x="0" y="\d+" width="180" height="3"/)
  // Every rung shows the same drawn frames over the same spans.
  const shown = (doc: string) => doc.match(/<set attributeName="visibility" to="visible"[^>]*>/g)
  for (const doc of at) expect(shown(doc)).toEqual(shown(first))
  for (const [i, doc] of at.entries()) {
    if (i > 0) expect(doc.length, `rung ${i}`).toBeLessThan(at[i - 1]?.length ?? 0)
  }
  // Under the cap, the ladder answers the first rung and its picture.
  expect(fitSvg(s.model, s.motions, opts)).toEqual({ svg: first, rung: 0 })
})
