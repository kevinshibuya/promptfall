import { expect, test } from 'claude-code/testing'
import type { GameView, WorldState } from '../../types'
import { boss, wave, worldBoss } from '../stage/fixtures'
import { STRIP_SCENARIOS, strip } from '../stage/scenarios'
import { stagedState } from '../stage/staged'
import { StageTimeline } from '../stage/timeline'
import { DISSOLVE_MS, WAVE_GAP_MS } from '../stage/tuning'
import { glyph } from '../windows/glyphs'
import type { Line, Scene, Track, Win } from '../windows/kit'
import { DOWN_RGB, WARN_RGB } from '../windows/tuning'
import { type StripInput, stripScene, stripTracks, wrap } from './strip'
import { worldRows } from './world-rows'

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

/** `actor` acts at `now` and hits `target` for `amount`; answers the hit's impact. */
function strike(t: StageTimeline, actor: string, target: string, amount: number, now: number) {
  const [start = now] = t.onEffects(
    [
      { k: 'act', actor, action: 'attack', at: 0 },
      { k: 'hit', by: actor, target, amount },
    ],
    now,
    2000,
  )
  return t.active(start).find((m) => m.kind === 'number' && m.actor === target)?.from ?? Number.NaN
}

test('the enemy and compact windows hold a killed zone boss, and its zone, until its death has played', () => {
  const now = 1_000_000
  const t = new StageTimeline()
  t.observe(boss(), now - 1)
  const impact = strike(t, 'h1', 'e9', 500, now)
  // The boss fell: the sim moved on to zone 2, wave 1, and brought the next wave.
  const next: GameView = { ...wave(), zone: 2, zoneName: 'Whisperwood', wave: 1 }
  t.observe(next, now)
  const shown = (at: number) => {
    const base = { ...strip('strip-rest'), view: next, timeline: t, now: at }
    const enemy = win(stripScene(base).scene, 'enemy')
    const compact = win(stripScene({ ...base, kind: 'compact', columns: 110 }).scene, 'compact')
    // Names from the alts: a boss's row clips its name to leave room for the percentage.
    return {
      title: lineText({ spans: enemy.title ?? [] }),
      rows: [...enemy.alt.matchAll(/(?:\. |, )([A-Z][\w ]+?) \d+ of/g)].map((m) => m[1]),
      compact: lineText({ spans: compact.title ?? [] })
        .split(' · ')
        .slice(0, 2)
        .join(' · '),
      front: compact.alt.match(/Front enemy (.+?) \d+ of/)?.[1],
    }
  }
  const held = { title: 'Zone 1 · Boss', rows: ['Bandit Captain'], compact: 'Z1 · Boss' }
  expect(shown(impact - 1)).toEqual({ ...held, front: 'Bandit Captain' })
  expect(shown(impact + DISSOLVE_MS)).toEqual({ ...held, front: 'Bandit Captain' })
  // Its dissolve and the pause over, the newcomers step on and the windows take the view's zone.
  const later = impact + 1_000 + DISSOLVE_MS + WAVE_GAP_MS
  t.observe(next, later)
  expect(shown(later)).toEqual({
    title: 'Zone 2 · Wave 1',
    rows: ['Goblin Scout', 'Field Rat', 'Road Slime'],
    compact: 'Z2 · W1',
    front: 'Goblin Scout',
  })
})

test('the world boss bar drops as the hits land, in the enemy window and the World rows', () => {
  const input = strip('strip-world-boss')
  const now = input.now
  const polled = input.world.snapshot?.boss
  if (!polled) throw new Error('the scenario polls a boss')
  // Polled at 55,800 with nothing committed; the party then deals 900 in one blow.
  const world: WorldState = { ...input.world, committedDealt: { bossId: polled.bossId, dealt: 0 } }
  const t = new StageTimeline()
  t.observe(worldBoss(), now - 1)
  const impact = strike(t, 'h1', 'e7', 900, now)
  const view: GameView = {
    ...worldBoss(),
    boss: { bossId: polled.bossId, name: polled.name, glyph: polled.glyph, dealt: 900 },
  }
  t.observe(view, now)
  const bar = (at: number) => {
    const { scene } = stripScene({ ...input, view, world, timeline: t, now: at })
    const enemy = win(scene, 'enemy')
    const records = worldRows(stagedState(view, world, t, at), world, at)[1]?.text ?? ''
    return [enemy.alt.match(/The Promptwyrm (\d+) of/)?.[1], records.match(/ (\d+)% /)?.[1]]
  }
  expect(bar(impact - 1)).toEqual(['55800', '62'])
  expect(bar(impact)).toEqual(['54900', '61'])
})
