import { expect, test } from 'claude-code/testing'
import { spriteFor } from '../sprites/index'
import type { Effect } from '../vendor/sim.js'
import { wave } from './fixtures'
import { effectAt, stageAt } from './model'
import { stage } from './scenarios'
import { artPaths, renderSvg, svgWithFallback } from './svg'
import { StageTimeline } from './timeline'
import {
  DROP_MS,
  HIRES_SCALE,
  IDLE_BOB_PX,
  LUNGE_MS,
  RARITY_RGB,
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
  const model = stageAt(v, t, at, BOX, { compact: false, motion: opts.motion })
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

test('a motion already over yields nothing', () => {
  const s = svg([hit], NOW + LUNGE_MS + 2000, { smil: true, motion: 'still' })
  expect(s).not.toContain('<animate')
})

test('a drop yields an animated use', () => {
  const s = svg(
    [
      hit,
      {
        k: 'drop',
        item: {
          id: 'i',
          base: 'iron_sword',
          rarity: 'rare',
          affixes: [],
          equippedBy: null,
          tradeableAt: null,
        },
      },
    ],
    NOW + DROP_MS / 2,
  )
  expect(s).toMatch(
    /<use href="#a\d+" transform="translate\(\d+ \d+\)" opacity="0"><animate attributeName="opacity" values="1;1;0"/,
  )
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
    affixes: [],
    equippedBy: null,
    tradeableAt: null,
  },
}

test('a drop still running after its enemy dissolved stays in a redraw', () => {
  const t = new StageTimeline()
  t.observe(wave(), NOW)
  t.onEffects([hit, DROP], NOW)
  const gone = wave()
  gone.enemies = gone.enemies.filter((e) => e.id !== 'e1')
  t.observe(gone, NOW + 10)
  // Past the dissolve, inside the drop.
  const at = NOW + 750
  const model = stageAt(gone, t, at, BOX, { compact: false, motion: 'full' })
  expect(model.drops).toHaveLength(1)
  const s = renderSvg(model, t.active(at), { smil: true, motion: 'full', now: at, width: 960 })
  expect(s).toMatch(/values="1;1;0"/)
})

test('a hero flashing at a redraw keeps its rarity colour under the flash', () => {
  const t = new StageTimeline()
  const v = wave()
  t.observe(v, NOW)
  t.onEffects([{ k: 'hit', by: 'e1', target: 'h2', amount: 3 }], NOW)
  const flash = t.active(NOW).find((m) => m.actor === 'h2' && m.kind === 'flash')
  if (!flash) throw new Error('no flash')
  const at = flash.from + 10
  const model = stageAt(v, t, at, BOX, { compact: false, motion: 'full' })
  const s = renderSvg(model, t.active(at), { smil: true, motion: 'full', now: at, width: 960 })
  const rare = `#${(RARITY_RGB.rare ?? 0).toString(16).padStart(6, '0')}`
  expect(s).toContain(`color="${rare}"`)
})

test('the rest scenario at 1.5: viewBox 0 0 180 24 at the same rendered width', () => {
  const s = stage('rest')
  const opts = { smil: true, now: s.now, width: 960, motion: 'full' as const }
  const hi = svgWithFallback(s.hires, s.model, s.motions, opts)
  const lo = renderSvg(s.model, s.motions, opts)
  expect(hi).toContain('viewBox="0 0 180 24" width="960" height="128"')
  expect(lo).toContain('viewBox="0 0 120 16" width="960" height="128"')
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
  const model = stageAt(v, t, moving, BOX, { compact: false, motion: 'full', scale: HIRES_SCALE })
  const svg = renderSvg(model, t.active(moving), { ...SMIL, now: moving })
  const f = knightHi.frames
  if (!f) throw new Error('the knight has no frames')
  expect(svg).not.toContain(defOf(f.windup.art, f.windup.raritySlot))
  // The knight's hit, inside the goblin's action, is in use.
  expect(svg).toContain('filter="url(#hit)"')
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
  const model = stageAt(v, t, at, BOX, { compact: false, motion: 'full', scale: HIRES_SCALE })
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
  const model = stageAt(v, t, at, BOX, { compact: false, motion: 'full', scale: HIRES_SCALE })
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
  const model = stageAt(v, t, at, BOX, { compact: false, motion: 'full', scale: HIRES_SCALE })
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
