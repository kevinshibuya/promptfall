import { expect, test } from 'claude-code/testing'
import type { GameView } from '../../types'
import { STRIP_SCENARIOS, strip } from '../stage/scenarios'
import { StageTimeline } from '../stage/timeline'
import { glyph } from '../windows/glyphs'
import type { Line, Scene, Track, Win } from '../windows/kit'
import { DOWN_RGB, WARN_RGB } from '../windows/tuning'
import { type StripInput, stripScene, stripTracks, wrap } from './strip'

const win = (scene: Scene, key: string) => scene.windows.find((w) => w.key === key) as Win
const lineText = (l: Line | undefined) =>
  (l?.spans ?? [])
    .map((s) =>
      'text' in s
        ? s.text
        : 'gap' in s
          ? ' '.repeat(s.gap)
          : 'cursor' in s
            ? s.cursor
              ? '▶'
              : ' '
            : '',
    )
    .join('')
const allText = (w: Win) =>
  [...(w.title ?? []), ...(w.footer ?? []), ...w.lines.flatMap((l) => l.spans)]
    .map((s) => ('text' in s ? s.text : ''))
    .join('')

test('at 120 columns the four windows fill the band; the message window takes the rest', () => {
  const { scene } = stripScene(strip('strip-rest'))
  expect(scene.windows.map((w) => w.key)).toEqual(['enemy', 'message', 'party', 'purse'])
  expect(scene.windows.reduce((n, w) => n + w.columns, 0)).toBe(120)
  expect(win(scene, 'message').columns).toBe(40)
  expect(win(stripScene({ ...strip('strip-rest'), columns: 116 }).scene, 'message').columns).toBe(
    36,
  )
  // Windows sit side by side, in order.
  for (let i = 1; i < scene.windows.length; i++) {
    const a = scene.windows[i - 1] as Win
    expect((scene.windows[i] as Win).x).toBe(a.x + a.columns)
  }
})

test('Loot and World drop the enemy window under 116 columns; a wide band lays out in 160', () => {
  const bare = stripScene({ ...strip('strip-loot'), columns: 110 }).scene
  expect(bare.windows.map((w) => w.key)).toEqual(['message', 'party', 'purse'])
  expect(bare.windows.reduce((n, w) => n + w.columns, 0)).toBe(110)
  expect(stripScene({ ...strip('strip-rest'), columns: 250 }).scene.columns).toBe(160)
})

test('the enemy window titles: a wave, a boss, the world boss with its time left', () => {
  const titled = (i: StripInput) =>
    lineText({ spans: win(stripScene(i).scene, 'enemy').title ?? [] })
  const rest = strip('strip-rest')
  const at = (v: GameView) => ({ ...v, zone: 3, wave: 2 })
  expect(titled({ ...rest, view: at(rest.view) })).toBe('Zone 3 · Wave 2')
  const boss = strip('strip-boss')
  expect(titled({ ...boss, view: { ...boss.view, zone: 3 } })).toBe('Zone 3 · Boss')
  expect(titled(strip('strip-world-boss'))).toBe('World boss · 11m')
})

test('▶ marks the acting hero and the current tab', () => {
  const input = strip('strip-rest')
  const { scene } = stripScene(input)
  const acting = input.timeline.acting(input.now)
  const hero = input.view.heroes.find((h) => h.id === acting)
  expect(lineText(win(scene, 'party').lines[0])).toContain(`▶${hero?.shortName}`)
  expect(lineText(win(scene, 'message').lines[0]).trim().startsWith('▶Party')).toBe(true)
  const loot = stripScene(strip('strip-loot')).scene
  expect(lineText(win(loot, 'message').lines[0])).toContain('▶Loot')
})

test('a hero under 25% HP draws in WARN_RGB, one at 0 in DOWN_RGB', () => {
  const { scene } = stripScene(strip('strip-low-hp'))
  const header = win(scene, 'party').lines[0]?.spans ?? []
  const colours = header.flatMap((s) => ('text' in s && s.rgb !== undefined ? [s.rgb] : []))
  expect(colours).toContain(WARN_RGB)
  expect(colours).toContain(DOWN_RGB)
})

test('a notice replaces the third message row, on Loot too', () => {
  const { scene } = stripScene(strip('strip-notice'))
  expect(lineText(win(scene, 'message').lines[2])).toContain('Promptfall: server unreachable')
})

test('a log line longer than the message window wraps over both rows', () => {
  const input = strip('strip-rest')
  // full at 110 columns keeps the enemy window: the message window is 30 wide, 26 cells of text.
  const later = { ...input, columns: 110, now: input.now + 10_000 }
  const message = win(stripScene(later).scene, 'message')
  expect(message.columns).toBe(30)
  const last = input.log.shown(later.now, 'still').at(-1)?.text ?? ''
  const rows = wrap(last, 26)
  expect(rows).toHaveLength(2)
  expect(lineText(message.lines[1]).trim()).toBe(rows[0])
  expect(lineText(message.lines[2]).trim()).toBe(rows[1])
})

test('hotspots cover the command line words and the tactics', () => {
  const { scene, hotspots } = stripScene(strip('strip-rest'))
  const message = win(scene, 'message')
  expect(hotspots.map((h) => h.hotkey).sort()).toEqual(['c', 'f', 'l', 'p', 'w'])
  const party = hotspots.find((h) => h.hotkey === 'p')
  expect(party?.y).toBe(1)
  expect(party && party.x >= message.x && party.x < message.x + message.columns).toBe(true)
})

test('the alt names every hero’s HP and gauge', () => {
  const input = strip('strip-rest')
  const { scene } = stripScene(input)
  for (const h of input.view.heroes)
    expect(scene.alt).toContain(`${h.shortName} level ${h.level}, HP ${h.hp} of ${h.maxHp}`)
  expect(scene.alt).toContain('gauge full')
})

/** The HP the strip's alt gives `hero` at each time, after `enemy` hits it for `amount`. */
function hpAfterHit(before: number, amount: number, times: (impact: number) => number[]) {
  const base = strip('strip-rest')
  const hero = base.view.heroes[0] as GameView['heroes'][number]
  const enemy = base.view.enemies[0] as GameView['enemies'][number]
  const withHp = (hp: number): GameView => ({
    ...base.view,
    heroes: base.view.heroes.map((h) => (h.id === hero.id ? { ...h, hp, alive: hp > 0 } : h)),
  })
  // The stage last saw the hero before the tick; the sim's tick has already taken the HP.
  const timeline = new StageTimeline()
  timeline.observe(withHp(before), base.now - 1)
  const [start = 0] = timeline.onEffects(
    [
      { k: 'act', actor: enemy.id, action: 'attack', at: 0 },
      { k: 'hit', by: enemy.id, target: hero.id, amount },
    ],
    base.now,
    2000,
  )
  const view = withHp(Math.max(0, before - amount))
  // The impact: when the hit's number shows on the stage.
  const number = timeline.active(start).find((m) => m.kind === 'number' && m.actor === hero.id)
  const impact = number?.from ?? Number.NaN
  return times(impact).map((now) => {
    const { scene } = stripScene({ ...base, view, timeline, now })
    return Number(scene.alt.match(new RegExp(`${hero.shortName} level \\d+, HP (\\d+) of`))?.[1])
  })
}

test('a hero’s HP drops when the hit lands on the stage, not when the sim applies it (#20)', () => {
  expect(hpAfterHit(50, 5, (impact) => [impact - 1, impact])).toEqual([50, 45])
  // A killing blow over the HP left shows the HP left until it lands, never more.
  expect(hpAfterHit(3, 10, (impact) => [impact - 1, impact])).toEqual([3, 0])
})

test('every character a strip scene holds has a glyph, on every tab and with a notice', () => {
  for (const name of STRIP_SCENARIOS) {
    for (const tab of ['party', 'loot', 'world'] as const) {
      const { scene } = stripScene({ ...strip(name), tab })
      for (const w of scene.windows)
        for (const ch of Array.from(allText(w)))
          expect(glyph(ch) !== null, `${name} ${tab} ${JSON.stringify(ch)}`).toBe(true)
    }
  }
})

test('desktop tracks: the line typing at render goes on from where it is; a notice or motion still types nothing', () => {
  const input = strip('strip-rest')
  const lines = (i: StripInput) =>
    stripTracks(i, 3000).find((t): t is Extract<Track, { kind: 'lines' }> => t.kind === 'lines')
  const first = lines(input)?.frames[0]
  expect(first?.at).toBe(0)
  expect(first?.typing?.from ?? 0).toBeGreaterThan(1)
  for (const i of [
    { ...input, notice: 'Promptfall resynced' },
    { ...input, motion: 'still' as const },
  ])
    expect(lines(i)?.frames.every((f) => f.typing === undefined) ?? true).toBe(true)
})

test('a hero-joined loot line drops the glyph the font lacks', () => {
  const input = strip('strip-loot')
  const view = { ...input.view, loot: [{ text: '♞ Aldric joined (rare)', rarity: 'rare' }] }
  const { scene } = stripScene({ ...input, view })
  const message = win(scene, 'message')
  expect(lineText(message.lines[1]).trim()).toBe('Aldric joined (rare)')
})
