import { expect, test } from 'claude-code/testing'
import { spriteFor } from '../sprites/index'
import type { Effect } from '../vendor/sim.js'
import { wave } from './fixtures'
import { stageAt } from './model'
import { renderSvg } from './svg'
import { StageTimeline } from './timeline'
import { DROP_MS, LUNGE_MS } from './tuning'

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
  const s = svg([hit], NOW + 100)
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
  expect(svg([hit], NOW + 100, { smil: false, motion: 'full' })).not.toContain('<animate')
})

test('the idle bob animates with motion full only', () => {
  expect(svg([], NOW, { smil: true, motion: 'full' })).toContain('repeatCount="indefinite"')
  expect(svg([], NOW, { smil: true, motion: 'still' })).not.toContain('<animateTransform')
})
