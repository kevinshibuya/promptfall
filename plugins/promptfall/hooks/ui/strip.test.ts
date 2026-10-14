import { expect, test } from 'claude-code/testing'
import type { GameView, WorldState } from '../../types'
import { boss, wave, worldBoss } from '../stage/fixtures'
import { STRIP_SCENARIOS, strip } from '../stage/scenarios'
import { stagedState } from '../stage/staged'
import { StageTimeline } from '../stage/timeline'
import { DISSOLVE_MS, FLASH_MS, VICTORY_MS, WAVE_GAP_MS } from '../stage/tuning'
import { glyph } from '../windows/glyphs'
import type { Line, Scene, Track, Win } from '../windows/kit'
import { DIM_RGB, DOWN_RGB, WARN_RGB } from '../windows/tuning'
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

test('past tier 1 the enemy window title takes the short tier form and fits the window whole', () => {
  const rest = strip('strip-rest')
  const boss = strip('strip-boss')
  const cases: [StripInput, string][] = [
    [{ ...rest, view: { ...rest.view, zone: 13, wave: 10 } }, 'T2 Z1 · Wave 10'],
    [{ ...rest, view: { ...rest.view, zone: 24, wave: 10 } }, 'T2 Z12 · Wave 10'],
    [{ ...boss, view: { ...boss.view, zone: 36 } }, 'T3 Z12 · Boss'],
    // Inside tier 1 the title is unchanged.
    [{ ...rest, view: { ...rest.view, zone: 1, wave: 2 } }, 'Zone 1 · Wave 2'],
  ]
  // The band's widths with an enemy window: its narrowest, the default and the widest.
  for (const columns of [116, 120, 160])
    for (const [input, title] of cases) {
      const enemy = win(stripScene({ ...input, columns }).scene, 'enemy')
      const spans = enemy.title ?? []
      expect(lineText({ spans })).toBe(title)
      // The border lays a title from cell 2 to the last cell before the corner.
      expect([...lineText({ spans })].length).toBeLessThanOrEqual(enemy.columns - 4)
    }
})

test("the compact window's title carries the world boss's time left", () => {
  const titled = (i: StripInput) =>
    lineText({
      spans: win(stripScene({ ...i, kind: 'compact', columns: 110 }).scene, 'compact').title ?? [],
    })
  expect(titled(strip('strip-world-boss'))).toMatch(/^Z1 · World boss 11m · \d+G$/)
  // None up: the zone and the wave, as before.
  expect(titled(strip('strip-rest'))).toMatch(/^Z1 · W2 · \d+G$/)
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

test('the welcome notice shows its opt-out whole at 120 columns full and at 100 compact', () => {
  const notice =
    'Sound on; /promptfall sound off silences it. Welcome to Promptfall. /promptfall heroes to meet your party.'
  for (const [kind, columns] of [
    ['full', 120],
    ['compact', 100],
  ] as const) {
    const { scene } = stripScene({ ...strip('strip-rest'), kind, columns, notice })
    const rows = scene.windows.flatMap((w) => w.lines.map(lineText))
    expect(rows.some((row) => row.includes('/promptfall sound off'))).toBe(true)
  }
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
  const view = {
    ...input.view,
    loot: [
      { text: '♞ Aldric joined (rare)', rarity: 'rare', kind: 'market' as const, itemId: null },
    ],
  }
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

test('the enemy and compact windows hold a killed zone boss, and its zone, through its death and the victory pose', () => {
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
  // Through the party's victory pose after its dissolve.
  const posed = impact + FLASH_MS + DISSOLVE_MS + VICTORY_MS
  t.observe(next, posed - 1)
  expect(shown(posed - 1)).toEqual({ ...held, front: 'Bandit Captain' })
  // The pose and the pause over, the newcomers step on and the windows take the view's zone.
  const later = posed + WAVE_GAP_MS
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

/** The HP bar tracks of a window's line, in span order. */
const hpBars = (i: StripInput, horizonMs: number, window: string, line: number) =>
  stripTracks(i, horizonMs)
    .filter(
      (t): t is Extract<Track, { kind: 'bar' }> =>
        t.kind === 'bar' && t.window === window && t.line === line,
    )
    .sort((a, b) => a.span - b.span)

test('a landing yields an HP bar keyframe at its impact time', () => {
  const now = 1_000_000
  const t = new StageTimeline()
  t.observe(wave(), now - 1)
  // The Goblin Scout hits Aldric (50 of 50) for 20: the view already has him at 30.
  const impact = strike(t, 'e1', 'h1', 20, now)
  const view: GameView = {
    ...wave(),
    heroes: wave().heroes.map((h) => (h.id === 'h1' ? { ...h, hp: 30 } : h)),
  }
  t.observe(view, now)
  const input = { ...strip('strip-rest'), view, timeline: t, now }
  const at = impact - now
  expect(at).toBeGreaterThan(0)
  const [aldric] = hpBars(input, 6000, 'party', 1)
  expect(aldric?.keys).toEqual([
    { at: 0, fill: 10000 },
    { at, fill: 10000 },
    { at, fill: 6000 },
    { at: 6000, fill: 6000 },
  ])
  // The compact window's bar drops at the same moment.
  const compact = { ...input, kind: 'compact' as const, columns: 110 }
  expect(hpBars(compact, 6000, 'compact', 0)[0]?.keys).toEqual(aldric?.keys)
})

test('an enemy row’s HP bar drops at the impact; a landing past the horizon waits for the redraw', () => {
  const now = 1_000_000
  const t = new StageTimeline()
  t.observe(wave(), now - 1)
  // Aldric hits the Goblin Scout (42 of 60) for 30: the view already has it at 12.
  const impact = strike(t, 'h1', 'e1', 30, now)
  const view: GameView = {
    ...wave(),
    enemies: wave().enemies.map((e) => (e.id === 'e1' ? { ...e, hp: 12 } : e)),
  }
  t.observe(view, now)
  const input = { ...strip('strip-rest'), view, timeline: t, now }
  const at = impact - now
  expect(hpBars(input, 6000, 'enemy', 0)[0]?.keys).toEqual([
    { at: 0, fill: 7000 },
    { at, fill: 7000 },
    { at, fill: 2000 },
    { at: 6000, fill: 2000 },
  ])
  const compact = { ...input, kind: 'compact' as const, columns: 110 }
  expect(hpBars(compact, 6000, 'compact', 3)[0]?.keys.at(-1)).toEqual({ at: 6000, fill: 2000 })
  // A horizon that ends before the impact keys nothing: the bar holds the staged 42 until the
  // next tick's redraw draws what has landed by then.
  expect(hpBars(input, at - 1, 'enemy', 0)).toEqual([])
  const row = win(stripScene(input).scene, 'enemy').lines[0]?.spans.find((s) => 'bar' in s)
  expect(row && 'bar' in row ? row.bar : null).toBe(7000)
})

test("the enemy window's footer counts the queue, dim; at 0 and in a world boss fight there is none", () => {
  const rest = strip('strip-rest')
  const enemy = (i: StripInput) => win(stripScene(i).scene, 'enemy')
  const waiting = enemy({ ...rest, view: { ...rest.view, waiting: 4 } })
  expect(lineText({ spans: waiting.footer ?? [] })).toBe('+4 waiting')
  expect(waiting.footer?.every((s) => !('text' in s) || s.rgb === DIM_RGB)).toBe(true)
  expect(lineText({ spans: waiting.title ?? [] })).toBe('Zone 1 · Wave 2')
  expect(waiting.alt.endsWith('HP. 4 more waiting.')).toBe(true)
  // Two rows drawn: the footer sits on the bottom border all the same.
  const two = { ...rest.view, enemies: rest.view.enemies.slice(0, 2), waiting: 1 }
  expect(lineText({ spans: enemy({ ...rest, view: two }).footer ?? [] })).toBe('+1 waiting')
  for (const i of [rest, strip('strip-world-boss')]) {
    expect(enemy(i).footer ?? []).toEqual([])
    expect(enemy(i).alt).not.toContain('waiting')
  }
  expect(lineText({ spans: enemy(strip('strip-world-boss')).title ?? [] })).toBe('World boss · 11m')
})

test('camping blanks the enemy rows but a dim camping, the title and the footer kept', () => {
  const input = strip('strip-camping')
  const enemy = win(stripScene(input).scene, 'enemy')
  const fighting = win(
    stripScene({ ...input, view: { ...input.view, camping: false } }).scene,
    'enemy',
  )
  expect(enemy.title).toEqual(fighting.title)
  expect(lineText({ spans: enemy.footer ?? [] })).toBe('+2 waiting')
  expect(enemy.lines.map((l) => lineText(l).trim())).toEqual(['camping'])
  expect(enemy.lines[0]?.spans.every((s) => !('text' in s) || s.rgb === DIM_RGB)).toBe(true)
  for (const e of input.view.enemies) expect(allText(enemy)).not.toContain(e.name)
  expect(enemy.alt).toBe('Zone 1 · Wave 2. Camping. 2 more waiting.')
})

test('camping puts g: back to the fight under the newest log line, a hotspot; a notice wins its row', () => {
  const input = strip('strip-camping')
  const { scene, hotspots } = stripScene(input)
  const message = win(scene, 'message')
  // The newest line whole on one row, clipped: the camp's own line.
  expect(lineText(message.lines[1]).trim()).toBe('The party makes camp while Claude g…')
  expect(lineText(message.lines[2]).trim()).toBe('g: back to the fight')
  expect(hotspots.find((h) => h.hotkey === 'g')).toEqual({
    hotkey: 'g',
    label: 'g: back to the fight',
    x: message.x + 2,
    y: 3,
    columns: 20,
  })
  const noticed = stripScene({ ...input, notice: 'Promptfall resynced' })
  expect(lineText(win(noticed.scene, 'message').lines[2]).trim()).toBe('Promptfall resynced')
  expect(noticed.hotspots.some((h) => h.hotkey === 'g')).toBe(false)
  // On Loot the row is the same one a notice takes.
  const loot = win(stripScene({ ...input, tab: 'loot' }).scene, 'message')
  expect(lineText(loot.lines[2]).trim()).toBe('g: back to the fight')
  expect(stripScene(strip('strip-rest')).hotspots.some((h) => h.hotkey === 'g')).toBe(false)
})

test('the compact window shows a dim camping for the front enemy; a notice wins there too', () => {
  const input = strip('strip-compact-camping')
  const compact = win(stripScene(input).scene, 'compact')
  expect(lineText(compact.lines[3]).trim()).toBe('camping')
  expect(compact.lines[3]?.spans.every((s) => !('text' in s) || s.rgb === DIM_RGB)).toBe(true)
  for (const e of input.view.enemies) expect(allText(compact)).not.toContain(e.name)
  const noticed = win(stripScene({ ...input, notice: 'Promptfall resynced' }).scene, 'compact')
  expect(lineText(noticed.lines[3]).trim()).toBe('Promptfall resynced')
})

test('desktop tracks while camping keep the g line and type nothing, as under a notice', () => {
  const input = strip('strip-camping')
  const track = stripTracks(input, 3000).find(
    (t): t is Extract<Track, { kind: 'lines' }> => t.kind === 'lines',
  )
  for (const f of track?.frames ?? []) {
    expect(lineText(f.lines[2]).trim()).toBe('g: back to the fight')
    expect(f.typing).toBeUndefined()
  }
})

test("the purse's third row counts the zone's falls; the sandbox keeps Farm, boss mode shows none", () => {
  const rest = strip('strip-rest')
  const purse = (i: StripInput) => stripScene(i)
  const rows = (i: StripInput) => win(purse(i).scene, 'purse').lines.map((l) => lineText(l).trim())
  expect(rows(rest)).toEqual(['0G', 'Push on', 'Falls 0/3'])
  expect(win(purse(rest).scene, 'purse').alt).toContain('Falls 0 of 3 before a retreat.')
  const two = { ...rest, view: { ...rest.view, zoneWipes: 2, gold: 123_456_789 } }
  expect(rows(two)[2]).toBe('Falls 2/3')
  expect(win(purse(two).scene, 'purse').alt).toContain('Falls 2 of 3 before a retreat.')
  // Nothing clips: each row fits the purse's inner width less its leading gap.
  const p = win(purse(two).scene, 'purse')
  for (const l of p.lines) expect([...lineText(l)].length).toBeLessThanOrEqual(p.columns - 2)
  // The sandbox: Farm keeps the title, Sandbox the tactics row, the falls their own.
  const sandbox = {
    ...rest,
    view: { ...rest.view, farm: true, account: { ...rest.view.account, sandbox: true } },
  }
  const s = win(purse(sandbox).scene, 'purse')
  expect(lineText({ spans: s.title ?? [] })).toBe('Farm')
  expect(rows(sandbox)).toEqual(['0G', 'Sandbox', 'Falls 0/3'])
  // The `f` hotspot stays on the tactics row.
  expect(purse(two).hotspots.find((h) => h.hotkey === 'f')).toMatchObject({ y: 2 })
  // Boss mode counts no wipes: no row, nothing in the alt.
  const boss = strip('strip-world-boss')
  expect(rows(boss)).toHaveLength(2)
  expect(win(purse(boss).scene, 'purse').alt).not.toContain('Falls')
})

test("the footer reads the sim's queue while a kill's refill waits out the dissolve and the pause", () => {
  const now = 1_000_000
  const t = new StageTimeline()
  t.observe({ ...wave(), waiting: 3 }, now - 1)
  const impact = strike(t, 'h1', 'e1', 42, now)
  // The kill's step refilled the slot: e1 gone, e4 on the field, one fewer queued.
  const front = wave().enemies[0] as GameView['enemies'][number]
  const view: GameView = {
    ...wave(),
    enemies: [
      ...wave().enemies.slice(1),
      { ...front, id: 'e4', name: 'Road Slime', hp: 90, maxHp: 90 },
    ],
    waiting: 2,
  }
  t.observe(view, now)
  const at = impact + FLASH_MS + DISSOLVE_MS / 2
  t.observe(view, at)
  const enemy = win(
    stripScene({ ...strip('strip-rest'), view, timeline: t, now: at }).scene,
    'enemy',
  )
  // The dead Goblin Scout still holds its row; the newcomer is off stage.
  expect(enemy.alt).toContain('Goblin Scout 0 of 60')
  expect(enemy.alt).not.toContain('Road Slime 90 of 90')
  expect(lineText({ spans: enemy.footer ?? [] })).toBe('+2 waiting')
})
