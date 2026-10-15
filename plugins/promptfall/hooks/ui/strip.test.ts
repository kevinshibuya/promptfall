import { expect, test } from 'claude-code/testing'

const fail = (): never => {
  throw new Error('no page')
}

import type { GameView, WorldState } from '../../types'
import { spriteFor } from '../sprites/index'
import { boss, wave, worldBoss } from '../stage/fixtures'
import { STRIP_SCENARIOS, strip } from '../stage/scenarios'
import { stagedState } from '../stage/staged'
import { StageTimeline } from '../stage/timeline'
import { DISSOLVE_MS, FLASH_MS, RARITY_RGB, VICTORY_MS, WAVE_GAP_MS } from '../stage/tuning'
import { glyph } from '../windows/glyphs'
import type { Line, Scene, Track, Win } from '../windows/kit'
import { DIM_RGB, DOWN_RGB, WARN_RGB } from '../windows/tuning'
import {
  PAGE_ROWS,
  paged,
  type StripInput,
  stripScene,
  stripTracks,
  wrap,
  wrapSpans,
} from './strip'
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
    .map((s) => ('text' in s ? s.text : 'art' in s ? (s.mark?.ch ?? '') : ''))
    .join('')

test('at 120 columns the four windows fill the band; the message window takes the rest', () => {
  const { scene } = stripScene(strip('strip-rest'))
  expect(scene.windows.map((w) => w.key)).toEqual(['enemy', 'message', 'party', 'purse'])
  expect(scene.windows.reduce((n, w) => n + w.columns, 0)).toBe(120)
  expect(win(scene, 'message').columns).toBe(38)
  expect(win(stripScene({ ...strip('strip-rest'), columns: 116 }).scene, 'message').columns).toBe(
    34,
  )
  // Windows sit side by side, in order.
  for (let i = 1; i < scene.windows.length; i++) {
    const a = scene.windows[i - 1] as Win
    expect((scene.windows[i] as Win).x).toBe(a.x + a.columns)
  }
})

test('Loot and World lay out the four windows as Party does; a wide band lays out in 160', () => {
  for (const name of ['strip-loot', 'strip-world'] as const) {
    const { scene } = stripScene({ ...strip(name), columns: 116 })
    expect(scene.windows.map((w) => w.key)).toEqual(['enemy', 'message', 'party', 'purse'])
    expect(scene.windows.reduce((n, w) => n + w.columns, 0)).toBe(116)
  }
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

test('a notice wraps in full over the rows it needs, on Loot too', () => {
  const { scene } = stripScene(strip('strip-notice'))
  const message = win(scene, 'message')
  expect(message.lines.slice(1).map((l) => lineText(l).trim())).toEqual([
    'Promptfall: server unreachable,',
    'retrying',
  ])
})

test('the welcome notice shows its opt-out first at 120 columns full and at 100 compact', () => {
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
  // full at 110 columns keeps the enemy window: the message window is 28 wide, 24 cells of text.
  const later = { ...input, columns: 110, now: input.now + 10_000 }
  const message = win(stripScene(later).scene, 'message')
  expect(message.columns).toBe(28)
  const last = input.log.shown(later.now, 'still').at(-1)?.text ?? ''
  const rows = wrap(last, 24)
  expect(rows).toHaveLength(2)
  expect(lineText(message.lines[1]).trim()).toBe(rows[0])
  expect(lineText(message.lines[2]).trim()).toBe(rows[1])
})

test("the wrap keeps each span's colour across the rows it breaks into", () => {
  const rows = wrapSpans(
    [
      { text: 'Epic drop:', rgb: 0xa040f0 },
      { text: ' Sword of the Long Night.', rgb: 0x58d858 },
    ],
    12,
  )
  expect(rows.map((r) => r.spans)).toEqual([
    [{ text: 'Epic drop:', rgb: 0xa040f0 }],
    [{ text: 'Sword of the', rgb: 0x58d858 }],
    [{ text: 'Long Night.', rgb: 0x58d858 }],
  ])
  // Each row's first character, counted over the line's text: the space a break eats is skipped.
  expect(rows.map((r) => r.from)).toEqual([0, 11, 24])
  // A row that joins two spans keeps both colours; a word longer than a row is cut, not dropped.
  expect(
    wrapSpans(
      [
        { text: 'Rare', rgb: 1 },
        { text: ' drop', rgb: 2 },
      ],
      20,
    )[0]?.spans,
  ).toEqual([
    { text: 'Rare', rgb: 1 },
    { text: ' drop', rgb: 2 },
  ])
  expect(wrapSpans([{ text: 'Promptwyrmling' }], 6).map((r) => r.spans)).toEqual([
    [{ text: 'Prompt' }],
    [{ text: 'wyrmli' }],
    [{ text: 'ng' }],
  ])
  // A span that is not text (an art span) rides in its row whole.
  const art = { gap: 2 }
  expect(wrapSpans([art, { text: ' Silk Robe' }], 20)[0]?.spans).toEqual([
    art,
    { text: ' Silk Robe' },
  ])
})

/** Loot lines of these texts, oldest first, each with no lead: its name the text. */
const lootOf = (texts: readonly string[]): GameView['loot'] =>
  texts.map((text) => ({
    text,
    rarity: 'common',
    kind: 'drop' as const,
    itemId: null,
    lead: null,
    name: text,
    rest: '',
  }))
/** The Loot tab over these lines, scrolled as given. */
const lootTab = (texts: readonly string[], scroll: StripInput['scroll'] = null): StripInput => {
  const input = strip('strip-loot')
  return { ...input, view: { ...input.view, loot: lootOf(texts) }, scroll }
}
/** The message window's two rows, trimmed, and the command line's footer before the hint. */
const shownRows = (i: StripInput) => {
  const message = win(stripScene(i).scene, 'message')
  const cmd = lineText(message.lines[0])
  return {
    rows: message.lines.slice(1).map((l) => lineText(l).trim()),
    footer: cmd.match(/ (\d+-\d+\/\d+) c ▾$/)?.[1] ?? null,
  }
}

test('j pages the Loot tab back two rows and k forward; the footer reads the rows shown, none at the newest', () => {
  expect(PAGE_ROWS).toBe(2)
  const five = ['L1', 'L2', 'L3', 'L4', 'L5']
  const newest = lootTab(five)
  expect(shownRows(newest)).toEqual({ rows: ['L4', 'L5'], footer: null })
  const back = paged(stripScene(newest).page ?? fail(), PAGE_ROWS)
  expect(back.rows).toBe(2)
  expect(shownRows(lootTab(five, back))).toEqual({ rows: ['L2', 'L3'], footer: '2-3/5' })
  // Past the oldest the page clamps to the first two rows.
  const oldest = paged(stripScene(lootTab(five, back)).page ?? fail(), PAGE_ROWS)
  expect(shownRows(lootTab(five, oldest))).toEqual({ rows: ['L1', 'L2'], footer: '1-2/5' })
  // k comes back, and at the newest the footer goes.
  const forward = paged(stripScene(lootTab(five, oldest)).page ?? fail(), -PAGE_ROWS)
  expect(shownRows(lootTab(five, forward))).toEqual({ rows: ['L3', 'L4'], footer: '3-4/5' })
  const home = paged(stripScene(lootTab(five, forward)).page ?? fail(), -2 * PAGE_ROWS)
  expect(home.rows).toBe(0)
  expect(shownRows(lootTab(five, home))).toEqual({ rows: ['L4', 'L5'], footer: null })
})

test('a new line while paged back leaves the window where it is, the oldest trimmed or not; at the newest it follows', () => {
  const five = ['L1', 'L2', 'L3', 'L4', 'L5']
  const back = paged(stripScene(lootTab(five)).page ?? fail(), PAGE_ROWS)
  // L6 arrives and L1 is trimmed: the window still shows L2 and L3.
  const trimmed = ['L2', 'L3', 'L4', 'L5', 'L6']
  expect(shownRows(lootTab(trimmed, back))).toEqual({ rows: ['L2', 'L3'], footer: '1-2/5' })
  // L6 and a two-row L7 arrive, nothing trimmed: the window has not moved either.
  const long = 'L7 is a line long enough to wrap over two rows'
  const grown = [...five, 'L6', long]
  expect(shownRows(lootTab(grown, back))).toEqual({ rows: ['L2', 'L3'], footer: '2-3/8' })
  // At the newest the window follows the new lines.
  const home = paged(stripScene(lootTab(five)).page ?? fail(), 0)
  expect(shownRows(lootTab(trimmed, home)).rows).toEqual(['L5', 'L6'])
})

test('no line is cut: a line longer than two rows shows its tail at the newest and its head paged back', () => {
  // At 120 columns the message window holds 36 cells of text a row.
  const long = 'Inventory full: Ancient Runed Greatsword of the Endless Night vendored for 1,240G.'
  // A loot row's lead takes three of them; its text wraps in the rest.
  const rows = wrap(long, 33)
  expect(rows).toHaveLength(3)
  const newest = lootTab([long])
  expect(shownRows(newest)).toEqual({ rows: rows.slice(1), footer: null })
  const back = paged(stripScene(newest).page ?? fail(), PAGE_ROWS)
  expect(shownRows(lootTab([long], back))).toEqual({ rows: rows.slice(0, 2), footer: '1-2/3' })
  // No ellipsis anywhere in the message window, on either log tab, on any page.
  const lines = Array.from({ length: 40 }, (_, i) => `${i}: ${long}`)
  for (const tab of ['party', 'loot'] as const) {
    // The Party log's long line is the camp's.
    const camp = strip('strip-camping')
    let input: StripInput =
      tab === 'loot' ? lootTab(lines) : { ...camp, now: camp.now + 10_000, columns: 110 }
    for (let page = 0; page < 70; page++) {
      const { scene, page: at } = stripScene(input)
      expect(allText(win(scene, 'message')), `${tab} page ${page}`).not.toContain('…')
      input = { ...input, scroll: paged(at ?? fail(), PAGE_ROWS) }
    }
  }
})

/** A drop, a sale, a hero joining and a contract sold, oldest first. */
const leads: GameView['loot'] = [
  {
    text: '/ Iron Sword (epic)',
    rarity: 'epic',
    kind: 'drop',
    itemId: 'i1',
    lead: { kind: 'item', key: 'iron_sword' },
    name: 'Iron Sword',
    rest: ' (epic)',
  },
  {
    text: 'Silk Robe sold for 3g',
    rarity: 'rare',
    kind: 'vendored',
    itemId: 'i2',
    lead: { kind: 'item', key: 'silk_robe' },
    name: 'Silk Robe',
    rest: ' sold for 3g',
  },
  {
    text: '➶ Kestrel joined (uncommon)',
    rarity: 'uncommon',
    kind: 'market',
    itemId: null,
    lead: { kind: 'hero', key: 'archer' },
    name: 'Kestrel',
    rest: ' joined (uncommon)',
  },
  {
    text: 'Hero contract sold for 90g',
    rarity: 'common',
    kind: 'market',
    itemId: null,
    lead: null,
    name: 'Hero contract',
    rest: ' sold for 90g',
  },
]
/** The message window's two rows' spans on the Loot tab over these lines. */
const lootRows = (lines: GameView['loot']) => {
  const input = strip('strip-loot')
  return win(stripScene({ ...input, view: { ...input.view, loot: lines } }).scene, 'message')
    .lines.slice(1)
    .map((l) => l.spans)
}

test('a loot row leads with its item’s sprite, then its name in the rarity colour, then the rest', () => {
  const [drop, sale] = lootRows(leads.slice(0, 2))
  expect(drop).toEqual([
    { gap: 1 },
    { art: spriteFor('item', 'iron_sword').full, mark: { ch: '█', rgb: RARITY_RGB.epic } },
    { gap: 1 },
    { text: 'Iron Sword', rgb: RARITY_RGB.epic },
    { text: ' (epic)' },
  ])
  expect(sale).toEqual([
    { gap: 1 },
    { art: spriteFor('item', 'silk_robe').full, mark: { ch: '█', rgb: RARITY_RGB.rare } },
    { gap: 1 },
    { text: 'Silk Robe', rgb: RARITY_RGB.rare },
    { text: ' sold for 3g' },
  ])
})

test('a hero line leads with the hero’s class sprite; a line with neither with a blank gap', () => {
  const [hero, contract] = lootRows(leads.slice(2))
  expect(hero).toEqual([
    { gap: 1 },
    { art: spriteFor('hero', 'archer').full, mark: { ch: '█', rgb: RARITY_RGB.uncommon } },
    { gap: 1 },
    { text: 'Kestrel', rgb: RARITY_RGB.uncommon },
    { text: ' joined (uncommon)' },
  ])
  expect(contract).toEqual([
    { gap: 1 },
    { gap: 2 },
    { gap: 1 },
    { text: 'Hero contract', rgb: RARITY_RGB.common },
    { text: ' sold for 90g' },
  ])
})

test('a wrapped loot line hangs its later rows under the name', () => {
  const long = {
    ...(leads[0] as GameView['loot'][number]),
    rest: ' (epic), the blade of a long forgotten king',
  }
  const [first, second] = lootRows([long])
  // lineText reads the sprite as no text: its two cells are the gap before the name.
  expect(lineText({ spans: first ?? [] })).toBe('  Iron Sword (epic), the blade of')
  expect(first?.[1]).toHaveProperty('art')
  expect(lineText({ spans: second ?? [] })).toBe('    a long forgotten king')
})

test('the Loot tab shows every line the view holds, 40 by paging', () => {
  const lines = Array.from({ length: 40 }, (_, i) => `Drop ${i + 1}`)
  let input = lootTab(lines)
  const seen = new Set<string>()
  for (let i = 0; i < 20; i++) {
    for (const row of shownRows(input).rows) seen.add(row)
    input = { ...input, scroll: paged(stripScene(input).page ?? fail(), PAGE_ROWS) }
  }
  expect(seen.size).toBe(40)
  expect(shownRows(input).footer).toBe('1-2/40')
})

test('the footer drops when the tabs, it and the hint do not fit the message window; the hint stays', () => {
  const five = ['L1', 'L2', 'L3', 'L4', 'L5']
  const back = paged(stripScene(lootTab(five)).page ?? fail(), PAGE_ROWS)
  // full at 110 columns keeps the enemy window: the message window's 26 cells hold no footer.
  const narrow = { ...lootTab(five, back), kind: 'full' as const, columns: 110 }
  const message = win(stripScene(narrow).scene, 'message')
  expect(lineText(message.lines[0])).toMatch(/World +c ▾$/)
  expect(shownRows(narrow).rows).toEqual(['L2', 'L3'])
})

test('the Party log pages too, and the World tab never does', () => {
  // The scenario's log, all three lines shown, one row each.
  const input = {
    ...strip('strip-rest'),
    now: strip('strip-rest').now + 10_000,
    motion: 'still' as const,
  }
  const texts = input.log.shown(input.now, 'still').map((l) => l.text)
  expect(shownRows(input)).toEqual({ rows: texts.slice(1), footer: null })
  const back = paged(stripScene(input).page ?? fail(), PAGE_ROWS)
  expect(shownRows({ ...input, scroll: back })).toEqual({
    rows: texts.slice(0, 2),
    footer: '1-2/3',
  })
  expect(stripScene({ ...input, tab: 'world' }).page).toBeNull()
  // The compact band has no message window to page.
  expect(stripScene({ ...input, kind: 'compact', columns: 110 }).page).toBeNull()
})

test('a notice is the newest of the paging: its first rows at the newest, k reaches the rest, j the log', () => {
  const notice =
    'Sound on; /promptfall sound off silences it. Welcome to Promptfall. /promptfall heroes to meet your party.'
  const rows = wrap(notice, 34)
  expect(rows).toHaveLength(4)
  const input = { ...strip('strip-rest'), now: strip('strip-rest').now + 10_000, notice }
  const texts = input.log.shown(input.now, 'still').map((l) => l.text)
  // Three log rows, then the notice's four: the window at the notice's first two, more after.
  expect(shownRows(input)).toEqual({ rows: rows.slice(0, 2), footer: '4-5/7' })
  const page = stripScene(input).page ?? fail()
  expect(shownRows({ ...input, scroll: paged(page, -PAGE_ROWS) })).toEqual({
    rows: rows.slice(2),
    footer: null,
  })
  expect(shownRows({ ...input, scroll: paged(page, PAGE_ROWS) })).toEqual({
    rows: texts.slice(1),
    footer: '2-3/7',
  })
  // A notice of one row takes the bottom row under the newest log row, as before.
  expect(shownRows({ ...input, notice: 'Promptfall resynced' })).toEqual({
    rows: [texts[2], 'Promptfall resynced'],
    footer: null,
  })
})

test('hotspots cover the command line words and the tactics', () => {
  const { scene, hotspots } = stripScene(strip('strip-rest'))
  const message = win(scene, 'message')
  expect(hotspots.map((h) => h.hotkey).sort()).toEqual(['c', 'f', 'l', 'p', 'w'])
  const party = hotspots.find((h) => h.hotkey === 'p')
  expect(party?.y).toBe(1)
  expect(party && party.x >= message.x && party.x < message.x + message.columns).toBe(true)
})

test('the command line ends on a dim c ▾, the collapse hotspot over all three cells', () => {
  const { scene, hotspots } = stripScene(strip('strip-rest'))
  const message = win(scene, 'message')
  const cmd = message.lines[0]
  // 38 columns: the border and a gap each side leave 34 cells, the hint in the last three.
  expect(lineText(cmd)).toBe(' ▶Party  Loot  World            c ▾')
  const hint = cmd?.spans.at(-1)
  expect(hint).toEqual({ text: 'c ▾', rgb: DIM_RGB })
  expect(hotspots.find((h) => h.hotkey === 'c')).toEqual({
    hotkey: 'c',
    label: 'c ▾',
    x: message.x + 2 + 31,
    y: 1,
    columns: 3,
  })
  // The compact window's command line, in its bottom border, ends on it too.
  const compact = win(stripScene(strip('strip-compact')).scene, 'compact')
  expect(lineText({ spans: compact.footer ?? [] })).toBe('▶Party  Loot  World c ▾')
  expect(compact.footer?.at(-1)).toEqual({ text: 'c ▾', rgb: DIM_RGB })
})

test('the alt names every hero’s HP and gauge', () => {
  const input = strip('strip-rest')
  const { scene } = stripScene(input)
  for (const h of input.view.heroes)
    expect(scene.alt).toContain(`${h.shortName} level ${h.level}, HP ${h.hp} of ${h.maxHp}`)
  expect(scene.alt).toContain('gauge full')
})

test('every character a strip scene holds has a glyph, on every tab, with a notice and paged back', () => {
  const paging = lootTab(['L1', 'L2', 'L3', 'L4', 'L5'], { rows: 2, lines: [] })
  expect(shownRows(paging).footer).toBe('2-3/5')
  for (const [name, input] of [
    ...STRIP_SCENARIOS.map((name) => [name, strip(name)] as const),
    ['paged', paging] as const,
  ]) {
    for (const tab of ['party', 'loot', 'world'] as const) {
      const { scene } = stripScene({ ...input, tab })
      for (const w of scene.windows)
        for (const ch of Array.from(allText(w)))
          expect(glyph(ch) !== null, `${name} ${tab} ${JSON.stringify(ch)}`).toBe(true)
    }
  }
})

test('desktop tracks: the line typing at render goes on from where it is; a notice, motion still or a page back types nothing', () => {
  const input = strip('strip-rest')
  const lines = (i: StripInput) =>
    stripTracks(i, 3000).find((t): t is Extract<Track, { kind: 'lines' }> => t.kind === 'lines')
  const first = lines(input)?.frames[0]
  expect(first?.at).toBe(0)
  expect(first?.typing?.from ?? 0).toBeGreaterThan(1)
  // Paged back, the typing line is out of the window: the frames keep the page and type nothing.
  const back = { ...input, scroll: paged(stripScene(input).page ?? fail(), PAGE_ROWS) }
  expect(back.scroll.rows).toBeGreaterThan(0)
  for (const i of [
    { ...input, notice: 'Promptfall resynced' },
    { ...input, motion: 'still' as const },
    back,
  ])
    expect(lines(i)?.frames.every((f) => f.typing === undefined) ?? true).toBe(true)
  const shown = win(stripScene(back).scene, 'message').lines.map(lineText)
  for (const f of lines(back)?.frames ?? []) expect(f.lines.map(lineText)).toEqual(shown)
})

test('a hero-joined loot line drops the glyph the font lacks', () => {
  const input = strip('strip-loot')
  const view = {
    ...input.view,
    loot: [
      {
        text: '♞ Aldric joined (rare)',
        rarity: 'rare',
        kind: 'market' as const,
        itemId: null,
        lead: { kind: 'hero' as const, key: 'knight' },
        name: 'Aldric',
        rest: ' joined (rare)',
      },
    ],
  }
  const { scene } = stripScene({ ...input, view })
  const message = win(scene, 'message')
  expect(lineText(message.lines[1]).trim()).toBe('Aldric joined (rare)')
  expect(allText(message)).not.toContain('♞')
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
  // The newest log row: the camp's own line wraps, and its last row shows above the camp's.
  expect(lineText(message.lines[1]).trim()).toBe('gathers its thoughts.')
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

test('the compact window on Loot shows the newest four loot rows, each led by its sprite; a notice takes the last row', () => {
  const input = strip('strip-loot')
  const [first, ...rest] = input.view.loot
  if (!first) throw new Error('no loot')
  const more = [1, 2].map((i) => ({ ...first, text: `Loot ${i}`, name: `Loot ${i}`, rest: '' }))
  const view = { ...input.view, loot: [...more, first, ...rest] }
  const compact = (patch: Partial<StripInput>) =>
    win(stripScene({ ...input, view, kind: 'compact', columns: 110, ...patch }).scene, 'compact')
  const loot = compact({})
  expect(loot.lines.map((l) => lineText(l).trim())).toEqual([
    'Loot 2',
    'Kestrel joined (uncommon)',
    'Iron Sword (epic)',
    'Silk Robe sold for 3g',
  ])
  // Each row leads with its sprite, marked on the Raster, then its name in the rarity's colour.
  expect(loot.lines[2]?.spans.some((s) => 'art' in s)).toBe(true)
  expect(loot.lines[2]?.spans.find((s) => 'text' in s && s.text === 'Iron Sword')).toEqual({
    text: 'Iron Sword',
    rgb: RARITY_RGB.epic,
  })
  expect(loot.alt).toContain('Loot tab.')
  const noticed = compact({ notice: 'Promptfall resynced' })
  expect(noticed.lines.map((l) => lineText(l).trim())).toEqual([
    'Kestrel joined (uncommon)',
    'Iron Sword (epic)',
    'Silk Robe sold for 3g',
    'Promptfall resynced',
  ])
  const none = compact({ view: { ...view, loot: [] } })
  expect(lineText(none.lines[0]).trim()).toBe('No loot yet')
  // The command line and the title stay as on Party.
  expect(lineText({ spans: loot.footer ?? [] })).toBe(' Party ▶Loot  World c ▾')
  expect(lineText({ spans: loot.title ?? [] })).toBe(
    lineText({ spans: compact({ tab: 'party' }).title ?? [] }),
  )
})

test('the compact window on World shows presence, the records row, chat and a blank row a notice takes', () => {
  const input = { ...strip('strip-world'), kind: 'compact' as const, columns: 110 }
  const world = win(stripScene(input).scene, 'compact')
  expect(world.lines.map((l) => lineText(l).trim())).toEqual([
    '13 online · zone 1: Bea, Kit',
    'Z1 K0 W0 · world boss and hunt are off',
    'Kit: anyone grinding zone 1?',
    '',
  ])
  expect(world.alt).toContain('World tab.')
  const noticed = win(stripScene({ ...input, notice: 'Promptfall resynced' }).scene, 'compact')
  expect(lineText(noticed.lines[3]).trim()).toBe('Promptfall resynced')
  expect(lineText(noticed.lines[0])).toBe(lineText(world.lines[0]))
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

test("the purse's third row counts the zone's falls; boss mode shows none", () => {
  const rest = strip('strip-rest')
  const purse = (i: StripInput) => stripScene(i)
  const rows = (i: StripInput) => win(purse(i).scene, 'purse').lines.map((l) => lineText(l).trim())
  expect(rows(rest)).toEqual(['0G', 'f: Next zone', 'Falls 0/3'])
  expect(win(purse(rest).scene, 'purse').alt).toContain('Falls 0 of 3 before a retreat.')
  const two = { ...rest, view: { ...rest.view, zoneWipes: 2, gold: 123_456_789 } }
  expect(rows(two)[2]).toBe('Falls 2/3')
  expect(win(purse(two).scene, 'purse').alt).toContain('Falls 2 of 3 before a retreat.')
  // Nothing clips: each row fits the purse's inner width.
  const p = win(purse(two).scene, 'purse')
  expect(p.columns).toBe(15)
  for (const l of p.lines) expect([...lineText(l)].length).toBeLessThanOrEqual(p.columns - 2)
  // Boss mode counts no wipes: no row, nothing in the alt.
  const boss = strip('strip-world-boss')
  expect(rows(boss)).toHaveLength(2)
  expect(win(purse(boss).scene, 'purse').alt).not.toContain('Falls')
})

test('the purse reads f: Next zone or f: Stay here, the f: dim, in and out of the sandbox', () => {
  const rest = strip('strip-rest')
  const staying = { ...rest, view: { ...rest.view, farm: true } }
  const sandbox = (i: StripInput) => ({
    ...i,
    view: { ...i.view, account: { ...i.view.account, sandbox: true } },
  })
  for (const [input, tactic] of [
    [rest, 'Next zone'],
    [staying, 'Stay here'],
    [sandbox(rest), 'Next zone'],
    [sandbox(staying), 'Stay here'],
  ] as const) {
    const { scene, hotspots } = stripScene(input)
    const p = win(scene, 'purse')
    expect(lineText(p.lines[1])).toBe(` f: ${tactic}`)
    expect(p.lines[1]?.spans).toContainEqual({ text: 'f:', rgb: DIM_RGB })
    expect(p.lines[1]?.spans).toContainEqual({ text: tactic })
    // No title: the sandbox mark is the message window's.
    expect(p.title).toBeUndefined()
    // The hotspot covers the whole row inside the border.
    expect(hotspots.find((h) => h.hotkey === 'f')).toEqual({
      hotkey: 'f',
      label: `f: ${tactic}`,
      x: p.x + 1,
      y: 2,
      columns: p.columns - 2,
    })
  }
  expect(win(stripScene(rest).scene, 'purse').alt).toContain(
    'After the boss: on to the next zone. f: stay and repeat it.',
  )
  expect(win(stripScene(staying).scene, 'purse').alt).toContain(
    'After the boss: stay and repeat the zone from wave 1. f: move on.',
  )
})

test('in the sandbox the message window is titled Sandbox on every tab; the enemy title stays', () => {
  for (const tab of ['party', 'loot', 'world'] as const) {
    const input = { ...strip('strip-sandbox'), tab }
    const { scene } = stripScene(input)
    expect(lineText({ spans: win(scene, 'message').title ?? [] })).toBe('Sandbox')
    expect(win(scene, 'message').alt.startsWith('Sandbox.')).toBe(true)
    expect(lineText({ spans: win(scene, 'enemy').title ?? [] })).toBe('Zone 1 · Wave 2')
    const real = { ...strip('strip-rest'), tab }
    expect(win(stripScene(real).scene, 'message').title).toBeUndefined()
    expect(stripScene(real).scene.alt).not.toContain('Sandbox')
  }
})

test('the compact title says Stay here and Sandbox when they fit, never Farm, nothing for Next zone', () => {
  const titled = (patch: Partial<GameView>, columns = 110) => {
    const rest = strip('strip-rest')
    const view = { ...rest.view, ...patch }
    const scene = stripScene({ ...rest, view, kind: 'compact', columns }).scene
    return lineText({ spans: win(scene, 'compact').title ?? [] })
  }
  const account = strip('strip-rest').view.account
  expect(titled({})).toMatch(/^Z1 · W2 · \d+G$/)
  expect(titled({ farm: true })).toMatch(/^Z1 · W2 · \d+G · Stay here$/)
  expect(titled({ account: { ...account, sandbox: true } })).toMatch(/^Z1 · W2 · \d+G · Sandbox$/)
  expect(titled({ farm: true, account: { ...account, sandbox: true } })).toMatch(
    /^Z1 · W2 · \d+G · Stay here · Sandbox$/,
  )
  for (const columns of [100, 110, 160])
    expect(titled({ farm: true, account: { ...account, sandbox: true } }, columns)).not.toContain(
      'Farm',
    )
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

/** strip-world's band with the hunt and the world boss on and Kit's message the newest in chat. */
function worldTab(patch: Partial<WorldState> = {}, columns = 120): StripInput {
  const input = strip('strip-world')
  const snapshot = input.world.snapshot as NonNullable<WorldState['snapshot']>
  const world: WorldState = {
    ...input.world,
    snapshot: {
      ...snapshot,
      hunt: {
        name: 'casters',
        target: 20_000,
        count: 12_400,
        endsAt: input.now + 3 * 86_400_000 + 5 * 3_600_000,
        yours: 0,
      },
      flags: { ...snapshot.flags, 'worldboss.enabled': true, 'hunt.enabled': true },
    },
    ...patch,
  }
  const view = {
    ...input.view,
    account: { ...input.view.account, server: 'https://promptfall.example' },
  }
  return { ...input, view, world, columns }
}
const messageRows = (i: StripInput) => win(stripScene(i).scene, 'message').lines.map(lineText)

test('the World tab: the records row with the hunt bar, then chat; presence after the tabs', () => {
  expect(messageRows(worldTab({}, 122))).toEqual([
    '  Party  Loot ▶World · 13 online  c ▾',
    ' Hunt casters ██░░ 12.4k / 20k 3d',
    ' Kit: anyone grinding zone 1?',
  ])
  // At 120 and under, the purse's 15 columns leave presence no room beside the hint.
  expect(messageRows(worldTab())[0]).toBe('  Party  Loot ▶World            c ▾')
  // At 116 the records row still fits the hunt with its bar, its counts short.
  expect(messageRows(worldTab({}, 116))).toEqual([
    '  Party  Loot ▶World        c ▾',
    ' Hunt casters ██░░ 12k/20k 3d',
    ' Kit: anyone grinding zone 1?',
  ])
  // Chat quiet: its dim word in row two, the records row unchanged.
  const quiet = worldTab({ messages: [] })
  expect(messageRows(quiet)[1]).toBe(' Hunt casters ██░░ 12.4k / 20k 3d')
  expect(messageRows(quiet)[2]).toBe(' chat is quiet')
  expect(win(stripScene(quiet).scene, 'message').lines[2]?.spans.at(-1)).toEqual({
    text: 'chat is quiet',
    rgb: DIM_RGB,
  })
  // A notice takes the bottom row; the records row stays.
  expect(messageRows({ ...worldTab(), notice: 'Promptfall resynced' }).slice(1)).toEqual([
    ' Hunt casters ██░░ 12.4k / 20k 3d',
    ' Promptfall resynced',
  ])
})

test('presence on the command line drops the names, then the zone, then the count, keeping the hint', () => {
  const cmd = (columns: number) => messageRows(worldTab({}, columns))[0]
  expect(cmd(160)).toMatch(/^ {2}Party {2}Loot ▶World · 13 online · zone 1: Bea, Kit +c ▾$/)
  expect(cmd(130)).toMatch(/^ {2}Party {2}Loot ▶World · 13 online · zone 1 +c ▾$/)
  expect(cmd(122)).toMatch(/^ {2}Party {2}Loot ▶World · 13 online +c ▾$/)
  expect(cmd(120)).toMatch(/^ {2}Party {2}Loot ▶World +c ▾$/)
  expect(cmd(116)).toMatch(/^ {2}Party {2}Loot ▶World +c ▾$/)
  // The alt carries it whole at any width.
  expect(win(stripScene(worldTab({}, 116)).scene, 'message').alt).toContain(
    '13 online · zone 1: Bea, Kit',
  )
  // The collapse hotspot still sits over the hint.
  const { scene, hotspots } = stripScene(worldTab({}, 160))
  const message = win(scene, 'message')
  const c = hotspots.find((h) => h.hotkey === 'c')
  expect(c?.x).toBe(message.x + message.columns - 2 - 3)
  // Party and Loot carry no presence.
  for (const tab of ['party', 'loot'] as const)
    expect(messageRows({ ...worldTab({}, 160), tab })[0]).not.toContain('online')
})

test('presence reads plain with dim separators, all dim when stale, and the gated texts take its place', () => {
  const spans = (i: StripInput) => win(stripScene(i).scene, 'message').lines[0]?.spans ?? []
  const colourOf = (i: StripInput, t: string) => spans(i).find((s) => 'text' in s && s.text === t)
  const fresh = worldTab({}, 160)
  expect(colourOf(fresh, '13 online')).toEqual({ text: '13 online', rgb: 0xf0f0e8 })
  expect(colourOf(fresh, '·')).toEqual({ text: '·', rgb: DIM_RGB })
  expect(colourOf(worldTab({ stale: true }, 160), '13 online')).toEqual({
    text: '13 online',
    rgb: DIM_RGB,
  })
  const off = worldTab({}, 160)
  const flags = { ...(off.world.snapshot?.flags ?? {}), 'presence.enabled': false }
  const gated = {
    ...off,
    world: {
      ...off.world,
      snapshot: { ...(off.world.snapshot as NonNullable<WorldState['snapshot']>), flags },
    },
  }
  expect(messageRows(gated)[0]).toMatch(/▶World · presence is off +c ▾$/)
  expect(colourOf(gated, 'presence is off')).toEqual({ text: 'presence is off', rgb: DIM_RGB })
})
