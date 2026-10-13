import { expect, test } from 'claude-code/testing'
import type { GameView } from '../../types'
import { encode } from '../sprites/base64'
import { stance } from '../sprites/derive'
import { spriteFor } from '../sprites/index'
import { WORLD_DEFAULT } from '../state'
import type { Effect } from '../vendor/sim.js'
import { wave } from './fixtures'
import { effectAt, SHIELD, stageAt } from './model'
import { stage } from './scenarios'
import { stagedState } from './staged'
import { artPaths, backdropPlacements, framesInUse, renderSvg, svgWithFallback } from './svg'
import { type Motion, type StageEffect, StageTimeline } from './timeline'
import {
  CAMPFIRE_FADE_MS,
  CAMPFIRE_MS,
  CLASS_RGB,
  ENRAGE_RGB,
  ENRAGE_TINT,
  HASTE_FRAME_MS,
  HIRES_SCALE,
  IDLE_BOB_PX,
  LEVEL_RGB,
  LUNGE_MS,
  RARITY_RGB,
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

const hit: Effect = { k: 'hit', by: 'h1', target: 'e1', amount: 7 }
const act: Effect = { k: 'act', actor: 'h1', action: 'attack', at: 0 }

test('a well-formed document on the stage box', () => {
  const s = svg()
  expect(s.startsWith('<svg')).toBe(true)
  expect(s.endsWith('</svg>')).toBe(true)
  expect(balanced(s)).toBe(true)
  expect(s).toContain('viewBox="0 0 120 16"')
  expect(s).not.toContain('<script')
  expect(s).not.toContain('<image')
})

test('each art stem is defined once, one path per colour, the rarity colour as currentColor', () => {
  const s = svg()
  const ids = [...s.matchAll(/<g id="(a\d+)">(.*?)<\/g>/g)]
  // Six actors, six stems: the three heroes' classes and the three enemies' archetypes.
  expect(ids).toHaveLength(6)
  expect(new Set(ids.map((m) => m[1])).size).toBe(6)
  for (const [, , paths] of ids) {
    const fills = [...(paths ?? '').matchAll(/<path fill="([^"]+)"/g)].map((m) => m[1])
    expect(new Set(fills).size).toBe(fills.length)
  }
  expect(s).toContain('fill="currentColor"')
  const slime = spriteFor('enemy', 'road_slime').full
  expect(slime.palette.length).toBeGreaterThan(1)
})

test('smil animates a lunge already under way from a negative begin', () => {
  const s = svg([act, hit], NOW + 100)
  expect(s.match(/<animateTransform[^>]*values="0 0;-4 0;0 0"[^>]*>/g)).toHaveLength(1)
  expect(s).toContain('begin="-0.1s"')
  expect(s).toContain('filter="url(#flash)"')
})

test('smil plays the step as a translate on the stepper from its place, under Motion still too', () => {
  const still: Opts = { smil: true, motion: 'still' }
  const held = NOW + 110
  const s = svg([act, hit], held, still)
  expect(s.match(/<animateTransform[^>]*values="0 0;-4 0;-4 0;0 0"[^>]*>/g)).toEqual([
    '<animateTransform attributeName="transform" type="translate" additive="sum" values="0 0;-4 0;-4 0;0 0" keyTimes="0;0.16;0.84;1" begin="-0.11s" dur="0.5s"/>',
  ])
  // The groups stand where they stand at rest: the animation adds the step.
  const places = (doc: string) =>
    [...doc.matchAll(/<g transform="(translate\([^)]*\))"/g)].map((m) => m[1])
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

test('the idle bob animates with motion full only', () => {
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
function defIdOf(doc: string, art: Parameters<typeof artPaths>[0] | undefined): string {
  if (!art) throw new Error('no art')
  const id = doc.match(new RegExp(`<g id="(a\\d+)">${artPaths(art, null)}</g>`))?.[1]
  if (!id) throw new Error('no def for the art')
  return id
}

test('the SMIL Svg drops the chest with a translate, shows its three arts in turn and raises its item', () => {
  const [closed, opening, open] = (['closed', 'opening', 'open'] as const).map(
    (id) => spriteFor('chest', id).full,
  )
  // Before the chest starts: e1 stood at x 4 on a 34 px stage; the chest falls 8 px to y 18 from
  // 0.4 s over 0.3 s, shows closed to 1 s, opening to 1.25 s and open after; the item rises 10 px
  // from y 15 from 1.5 s, the end of the open phase. Both fade over the last 0.2 s of the rare
  // item's 2.8 s.
  const before = chestSvg(NOW, true).doc
  const [c, o, a] = [closed, opening, open].map((art) => defIdOf(before, art))
  expect(before).toContain(
    `<g transform="translate(4 18)" opacity="0"><animate attributeName="opacity" values="1;1;0" keyTimes="0;0.929;1" begin="0.4s" dur="2.8s"/>`,
  )
  expect(before).toMatch(
    /<animateTransform attributeName="transform" type="translate" additive="sum" values="0 -8;0 0" [^>]*begin="0.4s" dur="0.3s"\/>/,
  )
  expect(before).toContain(
    `<use href="#${c}" visibility="hidden"><set attributeName="visibility" to="visible" begin="0.4s" dur="0.6s"/></use><use href="#${o}" visibility="hidden"><set attributeName="visibility" to="visible" begin="1s" dur="0.25s"/></use><use href="#${a}" visibility="hidden"><set attributeName="visibility" to="visible" begin="1.25s" dur="1.95s"/></use></g>`,
  )
  expect(before).toMatch(
    /<use href="#a\d+" transform="translate\(4 15\)" opacity="0"><animate attributeName="opacity" values="1;1;0" keyTimes="0;0.882;1" begin="1.5s" dur="1.7s"\/><animateTransform attributeName="transform" type="translate" additive="sum" values="0 0;0 -10" begin="1.5s" dur="0.3s" fill="freeze"\/><\/use>/,
  )
  // A redraw mid-hold, the enemy long faded, resumes the same chest: open, the only art it draws.
  const held = chestSvg(NOW + 2000, true)
  expect(held.chests).toBe(1)
  expect(held.doc).toContain('begin="-1.6s" dur="2.8s"')
  expect(held.doc).toContain(`<use href="#${defIdOf(held.doc, open)}"/></g>`)
  for (const id of ['closed', 'opening']) {
    expect(held.doc).not.toContain(defOf(spriteFor('chest', id).full, null))
  }
  expect(held.doc).toContain('values="0 0;0 -10" begin="-0.5s"')
  // Without SMIL, the model as of now: the open chest on the ground, the item risen.
  const flat = chestSvg(NOW + 2000, false).doc
  expect(flat).toContain(`<use href="#${defIdOf(flat, open)}" transform="translate(4 18)"/>`)
  expect(flat).toMatch(/<use href="#a\d+" transform="translate\(4 5\)"\/>/)
  expect(flat).not.toContain('<animate')
})

test("a chest with no actor draws on the front slot's ground, under SMIL and without it", () => {
  // A sandbox item dropped at NOW onto a drawn, empty 17-row stage: no row to fall from, so its
  // chest falls onto slot 0's ground, where a kill's there lands (x 4, y 18; the test above).
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
  expect(before).toContain('<g transform="translate(4 18)" opacity="0">')
  expect(before).toMatch(/values="0 -8;0 0" [^>]*begin="0s" dur="0.3s"\/>/)
  expect(before).toMatch(/<use href="#a\d+" transform="translate\(4 15\)" opacity="0">/)
  expect(before.match(/<circle/g)).toHaveLength(1)
  const flat = doc(NOW + 1600, false)
  const open = spriteFor('chest', 'open').full
  expect(flat).toContain(`<use href="#${defIdOf(flat, open)}" transform="translate(4 18)"/>`)
  expect(flat).toMatch(/<use href="#a\d+" transform="translate\(4 5\)"\/>/)
})

test('the glow is one circle in the rarity colour, behind the chest, its alpha ramping in over the rise', () => {
  // The rare item risen at (4, 5), 16 px: the glow on its centre (12, 13), radius 10. Its rise
  // runs 1.5 s to 1.8 s and its fade from 3 s to 3.2 s: of its 1.7 s, 0.176 and 0.882.
  const blue = `#${(RARITY_RGB.rare ?? 0).toString(16).padStart(6, '0')}`
  const before = chestSvg(NOW, true).doc
  expect(before.match(/<circle/g)).toHaveLength(1)
  expect(before).toContain(
    `<circle cx="12" cy="13" r="10" fill="${blue}" opacity="0"><animate attributeName="opacity" values="0;0.5;0.5;0" keyTimes="0;0.176;0.882;1" begin="1.5s" dur="1.7s"/></circle>`,
  )
  const chest = before.indexOf('<g transform="translate(4 18)" opacity="0">')
  expect(chest).toBeGreaterThan(0)
  expect(before.indexOf('<circle')).toBeLessThan(chest)
  // A redraw mid-hold resumes it.
  const held = chestSvg(NOW + 2000, true).doc
  expect(held.match(/<circle/g)).toHaveLength(1)
  expect(held).toContain('values="0;0.5;0.5;0" keyTimes="0;0.176;0.882;1" begin="-0.5s" dur="1.7s"')
  // Without SMIL, the glow as of now.
  const flat = chestSvg(NOW + 2000, false).doc
  expect(flat.match(/<circle/g)).toHaveLength(1)
  expect(flat).toContain(`<circle cx="12" cy="13" r="10" fill="${blue}" opacity="0.5"/>`)
  // Before the rise, no glow.
  expect(chestSvg(NOW + 1200, false).doc).not.toContain('<circle')
})

test('the reveal scenarios stay under the Svg cap with SMIL on and never fall back to the 1x Svg', () => {
  for (const name of ['reveal', 'reveal-legendary'] as const) {
    const s = stage(name)
    const opts = { smil: true, now: s.now, width: 960, motion: 'full' as const }
    const hi = renderSvg(s.hires, s.motions, opts)
    expect(hi.length, name).toBeLessThan(SVG_MAX_CHARS)
    expect(svgWithFallback(s.hires, s.model, s.motions, opts), name).toBe(hi)
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
  const rare = `#${(RARITY_RGB.rare ?? 0).toString(16).padStart(6, '0')}`
  expect(s).toContain(`color="${rare}"`)
})

test('the rest scenario at 1.5: viewBox 0 0 180 51 at the same rendered width', () => {
  const s = stage('rest')
  const opts = { smil: true, now: s.now, width: 960, motion: 'full' as const }
  const hi = svgWithFallback(s.hires, s.model, s.motions, opts)
  const lo = renderSvg(s.model, s.motions, opts)
  expect(hi).toContain('viewBox="0 0 180 51" width="960" height="272"')
  expect(lo).toContain('viewBox="0 0 120 34" width="960" height="272"')
  // The hero art carries its 1.5x rarity slot as currentColor.
  expect(hi).toContain('fill="currentColor"')
})

const SMIL = { smil: true, width: 960, motion: 'full' as const }
const hiSvg = (name: Parameters<typeof stage>[0], smil = true) => {
  const s = stage(name)
  return renderSvg(s.hires, s.motions, { ...SMIL, smil, now: s.now })
}
const knightHi = spriteFor('hero', 'knight')
const defOf = (art: Parameters<typeof artPaths>[0], slot: number | null) =>
  `>${artPaths(art, slot)}</g>`
const count = (s: string, needle: string) => s.split(needle).length - 1

test('at 1.5 the rest scenario defines each art once, two row clips per art, and no bob', () => {
  const svg = hiSvg('rest')
  const defs = count(svg, '<g id="a')
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
  expect(svg).toMatch(/<clipPath id="a\d+h0">/)
  // The wind-up, from the action's start through the hold and the lunge out, is 60 ms from over.
  const begin = String(-(WINDUP_HOLD_MS + 60) / 1000).replace('.', '\\.')
  const dur = String((WINDUP_HOLD_MS + WINDUP_MS) / 1000).replace('.', '\\.')
  expect(svg).toMatch(
    new RegExp(
      `<g visibility="hidden"><set attributeName="visibility" to="visible" begin="${begin}s" dur="${dur}s"/>`,
    ),
  )
  expect(svg).toContain('filter="url(#hit)"')
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
    scale: HIRES_SCALE,
  })
  const svg = renderSvg(model, t.active(moving), { ...SMIL, now: moving })
  const f = knightHi.frames
  if (!f) throw new Error('the knight has no frames')
  expect(svg).not.toContain(defOf(f.windup.art, f.windup.raritySlot))
  // The knight's hit, inside the goblin's action, is in use.
  expect(svg).toContain('filter="url(#hit)"')
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
    scale: HIRES_SCALE,
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
  const svg = renderSvg(s.hires, s.motions, { ...SMIL, now: s.now })
  const fireball = spriteFor('effect', 'fireball').hires
  expect(svg).toContain(defOf(fireball, null))
  const mage = s.hires.actors.find((a) => a.key === 'h2')
  const goblin = s.hires.actors.find((a) => a.key === 'e1')
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
    /<g opacity="0"><animate attributeName="opacity" values="1;0" begin="[-0-9.]+s" dur="0\.1s"\/><g transform="translate\(-?\d+ 0\)[^"]*" filter="url\(#flash\)">/,
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
    scale: HIRES_SCALE,
  })
  expect(model.actors.every((a) => a.pose === 'idle_b')).toBe(true)
  const svg = renderSvg(model, t.active(at), { ...SMIL, now: at })
  for (const a of model.actors) expect(svg).not.toContain(defOf(a.art, a.raritySlot))
  // The same document as at rest in the A half, but for the clock's begin offsets.
  expect(Math.abs(svg.length - hiSvg('rest').length)).toBeLessThan(100)
  const s = stage('strike')
  const goblin = s.hires.actors.find((a) => a.key === 'e1')
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
    scale: HIRES_SCALE,
  })
  const svg = renderSvg(model, t.active(at), { ...SMIL, smil: false, now: at })
  const common = `#${(RARITY_RGB.common ?? 0).toString(16).padStart(6, '0')}`
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
    scale: HIRES_SCALE,
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

test('a backdrop is one def, used under the actors in place of the ground strip; never an <image>', () => {
  const t = new StageTimeline()
  const v = wave()
  t.observe(v, NOW)
  const base = stageAt(stagedState(v, WORLD_DEFAULT, t, NOW), t, NOW, BOX, {
    compact: false,
    motion: 'still',
    scale: HIRES_SCALE,
  })
  const idx = new Uint8Array(240 * 51).fill(1)
  for (let x = 0; x < 240; x++) idx[50 * 240 + x] = 2
  const backdrop = { width: 240, height: 51, palette: [0, 0x203040, 0x506070], pixels: encode(idx) }
  const opts = { smil: false, now: NOW, width: 960, motion: 'still' as const }
  const s = renderSvg({ ...base, backdrop }, [], opts)
  expect(s).not.toContain('<image')
  expect(s).not.toContain('<rect x="0" y="21"')
  expect(s).toContain('<g id="bg"><path fill="#203040"')
  expect(s).toContain('<path fill="#506070" d="M0 50h240v1h-240z"/></g>')
  // The 180 × 24 frame (120 columns, 8 rows at 1.5) centre-crops the 240 × 51 painting: one use,
  // before any actor.
  const uses = [...s.matchAll(/<use href="#bg"[^>]*>/g)].map((m) => m[0])
  expect(uses).toEqual(['<use href="#bg" transform="translate(-30 -27)"/>'])
  expect(s.indexOf('<use href="#bg"')).toBeLessThan(s.indexOf('<use href="#a'))
  // The strip stays for a model without a backdrop.
  const bare = renderSvg({ ...base, backdrop: null }, [], opts)
  expect(bare).toContain('<rect x="0" y="21" width="180" height="3"')
  // A zoomed-out 600-wide frame: the painting at 180, mirrored copies to 0 and 600.
  const wide = renderSvg({ ...base, backdrop, box: { columns: 400, rows: 8 } }, [], opts)
  expect([...wide.matchAll(/<use href="#bg"[^>]*>/g)].map((m) => m[0])).toEqual([
    '<use href="#bg" transform="translate(180 -27)"/>',
    '<use href="#bg" transform="translate(180 -27) scale(-1 1)"/>',
    '<use href="#bg" transform="translate(660 -27) scale(-1 1)"/>',
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

/** The Svg of `v` after `effects` at `at`, at `scale`. */
function svgOf(
  v: GameView,
  effects: StageEffect[] = [],
  at = NOW,
  scale: 1 | 1.5 = HIRES_SCALE,
  opts: Opts = { smil: true, motion: 'full' },
) {
  const t = new StageTimeline()
  t.observe(v, NOW)
  t.onEffects(effects, NOW)
  const model = stageAt(stagedState(v, WORLD_DEFAULT, t, at), t, at, BOX, {
    compact: false,
    motion: opts.motion,
    scale,
  })
  return renderSvg(model, t.active(at), { ...opts, now: at, width: 960 })
}
const party = (patch: Partial<GameView['heroes'][number]>): GameView => {
  const v = wave()
  v.heroes = v.heroes.map((h) => ({ ...h, ...patch }))
  return v
}

test('hasted, the idle pair turns on a half-second clock with the streak under it; at 1 the bob does', () => {
  const hi = svgOf(party({ hasted: true }))
  expect(balanced(hi)).toBe(true)
  expect(hi).toContain(`dur="${(HASTE_FRAME_MS * 2) / 1000}s" repeatCount="indefinite"`)
  for (const h of wave().heroes) {
    expect(hi).toContain(`fill="#${(CLASS_RGB[h.cls] ?? 0).toString(16).padStart(6, '0')}"`)
  }
  const calm = svgOf(wave())
  expect(calm).not.toContain(`fill="#${(CLASS_RGB.knight ?? 0).toString(16)}"`)
  const lo = svgOf(party({ hasted: true }), [], NOW, 1)
  expect(lo).toContain(`dur="${(HASTE_FRAME_MS * 2) / 1000}s" repeatCount="indefinite"`)
  expect(lo).not.toContain(`fill="#${(CLASS_RGB.knight ?? 0).toString(16)}"`)
  // Under still the streak draws and nothing bobs.
  const still = svgOf(party({ hasted: true }), [], NOW, HIRES_SCALE, {
    smil: true,
    motion: 'still',
  })
  expect(still).toContain(`fill="#${(CLASS_RGB.knight ?? 0).toString(16)}"`)
  expect(still).not.toContain('repeatCount')
})

test('a mishap flashes red beside the white flash filter and holds the tint until the hit', () => {
  const enraged: Effect[] = [{ k: 'enraged', enemyId: 'e1' }]
  for (const scale of [1, HIRES_SCALE] as const) {
    const s = svgOf(wave(), enraged, NOW + 10, scale)
    expect(balanced(s), `${scale}`).toBe(true)
    expect(s, `${scale}`).toContain(
      `<filter id="redflash"><feFlood flood-color="#${ENRAGE_RGB.toString(16)}"/>`,
    )
    expect(s, `${scale}`).toContain(`<filter id="flash"><feFlood flood-color="#ffffff"/>`)
    expect(s, `${scale}`).toContain(
      `<set attributeName="opacity" to="${ENRAGE_TINT}" begin="-0.01s"/>`,
    )
    const flat = svgOf(wave(), enraged, NOW + 1000, scale, { smil: false, motion: 'full' })
    expect(flat, `${scale}`).toContain(`filter="url(#redflash)" opacity="${ENRAGE_TINT}"`)
  }
  // No mishap, no red in the document.
  expect(svgOf(wave())).not.toContain('redflash')
})

test('a camp lights the campfire, then fades it, under SMIL and without it', () => {
  const camp: Effect[] = [{ k: 'camp', heals: [] }]
  const campfire = spriteFor('effect', 'campfire')
  for (const scale of [1, HIRES_SCALE] as const) {
    const s = svgOf(wave(), camp, NOW + 1000, scale)
    expect(s, `${scale}`).toContain(
      `keyTimes="0;${Number((CAMPFIRE_MS / (CAMPFIRE_MS + CAMPFIRE_FADE_MS)).toFixed(3))};1" begin="-1s"`,
    )
    const art = scale === 1 ? campfire.full : campfire.hires
    expect(s, `${scale}`).toContain(artPaths(art, null))
    const flat = svgOf(wave(), camp, NOW + CAMPFIRE_MS + CAMPFIRE_FADE_MS / 2, scale, {
      smil: false,
      motion: 'full',
    })
    expect(flat, `${scale}`).toContain('opacity="0.5"/>')
  }
})

test('guarding heroes hold the stance with no idle clock; the front hero wears the shield at 1.5', () => {
  const hi = svgOf(party({ guarding: true }))
  expect(balanced(hi)).toBe(true)
  // Only the enemies still bob.
  expect(hi.match(/repeatCount="indefinite"/g)?.length).toBe(2 * wave().enemies.length)
  expect(hi).toContain(artPaths(SHIELD, null))
  const lo = svgOf(party({ guarding: true }), [], NOW, 1)
  expect(lo.match(/repeatCount="indefinite"/g)?.length).toBe(wave().enemies.length)
  expect(lo).not.toContain(artPaths(SHIELD, null))
  const knight = spriteFor('hero', 'knight')
  expect(lo).toContain(artPaths(stance(knight.full).art, knight.raritySlot))
})

test('a level-up flashes gold beside the white flash filter and its deltas rise as gold text', () => {
  const up: StageEffect[] = [{ k: 'level_up', heroId: 'h1', level: 6, deltas: { atk: 3, def: 2 } }]
  const gold = `#${LEVEL_RGB.toString(16)}`
  for (const scale of [1, HIRES_SCALE] as const) {
    const s = svgOf(wave(), up, NOW + 10, scale)
    expect(balanced(s), `${scale}`).toBe(true)
    expect(s, `${scale}`).toContain(`<filter id="goldflash"><feFlood flood-color="${gold}"/>`)
    expect(s, `${scale}`).toContain(`<filter id="flash"><feFlood flood-color="#ffffff"/>`)
    expect(s, `${scale}`).toContain(`fill="${gold}"`)
    expect(s, `${scale}`).toContain('+3 atk  +2 def</text>')
    const flat = svgOf(wave(), up, NOW + 10, scale, { smil: false, motion: 'full' })
    expect(flat, `${scale}`).toContain('filter="url(#goldflash)"/>')
  }
  expect(svgOf(wave())).not.toContain('goldflash')
})

test('a travel steps the party off fading and on from the left, under SMIL and without it', () => {
  const traveled: StageEffect[] = [{ k: 'traveled', from: 1, to: 3 }]
  for (const scale of [1, HIRES_SCALE] as const) {
    const px = Math.round(TRAVEL_PX * scale)
    const s = svgOf(wave(), traveled, NOW + 100, scale)
    expect(balanced(s), `${scale}`).toBe(true)
    expect(s, `${scale}`).toContain(`values="0 0;${px} 0" begin="-0.1s"`)
    expect(s, `${scale}`).toContain(`values="1;0" begin="-0.1s" dur="0.5s" fill="freeze"`)
    expect(s, `${scale}`).toContain(`values="-${px} 0;0 0" begin="0.4s"`)
    // Drawn once the backdrop has changed, the party starts unseen and fades in.
    const on = svgOf(wave(), traveled, NOW + TRAVEL_OFF_MS + 100, scale)
    expect(on, `${scale}`).toContain(`values="0;1" begin="-0.1s" dur="0.5s" fill="freeze"`)
    expect(on, `${scale}`).not.toContain(`values="1;0" begin=`)
    const flat = svgOf(wave(), traveled, NOW + TRAVEL_OFF_MS / 2, scale, {
      smil: false,
      motion: 'full',
    })
    expect(flat, `${scale}`).toContain('opacity="0.5"')
  }
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
