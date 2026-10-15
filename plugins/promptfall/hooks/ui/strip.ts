// The band's window strip (grill 1.7, 1.13, 1.15, 1.16): the enemy, message, party and purse
// windows under the stage, or one window beside the compact stage, on every tab. Pure: the view,
// the stage timeline, the gauge tracker and the log in, a scene out; the encoders draw it.
import type {
  BandTab,
  GameView,
  HeroView,
  LogScroll,
  LootView,
  Settings,
  WorldState,
} from '../../types'
import { spriteFor } from '../sprites/index'
import type { GaugeTrack } from '../stage/gauges'
import type { MessageLog } from '../stage/log'
import { landingsWithin, stagedState } from '../stage/staged'
import type { StageTimeline } from '../stage/timeline'
import { COMPACT_STAGE_COLUMNS, RARITY_RGB } from '../stage/tuning'
import { GAUGE_FULL, RETREAT_AT } from '../vendor/sim.js'
import {
  chars,
  type Line,
  type Scene,
  type Span,
  spanCells,
  type Track,
  type Win,
} from '../windows/kit'
import {
  ART_CELLS,
  COMPACT_WINDOW_ROWS,
  DIM_RGB,
  DOWN_RGB,
  ENEMY_COLUMNS,
  GAUGE_FULL_RGB,
  GAUGE_RGB,
  GOLD_RGB,
  HP_BAR_RGB,
  PARTY_COLUMNS,
  PURSE_COLUMNS,
  STRIP_MAX_COLUMNS,
  STRIP_ROWS,
  TEXT_RGB,
  WARN_RGB,
} from '../windows/tuning'
import { zoneMark } from '../zone-words'
import { clip, formatCount, tacticsName } from './format'
import { formatRemaining, remainingRealMs } from './time'
import { type Presence, worldTabRows } from './world-rows'

export type StripInput = {
  view: GameView
  world: WorldState
  tab: BandTab
  /** full: the four windows under the stage; compact: one window beside the compact stage. */
  kind: 'full' | 'compact'
  columns: number
  now: number
  notice: string | null
  motion: Settings['motion']
  timeline: StageTimeline
  gauges: GaugeTrack
  log: Pick<MessageLog, 'shown' | 'typing' | 'upcoming'>
  /** The current tab's scroll: Party's and Loot's log, World's long notice; null at the newest. */
  scroll: LogScroll | null
}

export type Hotspot = {
  hotkey: 'p' | 'l' | 'w' | 'c' | 'f' | 'g'
  label: string
  x: number
  y: number
  columns: number
}

/** Where a hero's ▶ and gauge bar sit in a window, for the desktop's tracks. */
type Slots = {
  hero: HeroView
  cursor: { line: number; span: number }
  gauge: { line: number; span: number }
}
/** Where an actor's HP bar sits in a window, for the desktop's HP tracks. */
type HpSlot = { id: string; line: number; span: number }
type Built = { win: Win; hotspots: Hotspot[]; slots: Slots[]; hp: HpSlot[] }

/** The message window's row while the party camps, in the row a notice takes: `g` breaks camp. */
const BACK_TO_FIGHT = 'g: back to the fight'
/** The enemy window's first row and the compact window's front enemy while the party camps. */
const CAMPING = 'camping'
const pad = (n: number): Span => ({ gap: n })
const text = (t: string, rgb?: number): Span => (rgb === undefined ? { text: t } : { text: t, rgb })
const width = (spans: readonly Span[]) => spans.reduce((n, s) => n + spanCells(s), 0)
const padTo = (t: string, n: number) => {
  const cs = chars(t)
  return cs.length >= n ? cs.slice(0, n).join('') : t + ' '.repeat(n - cs.length)
}
const right = (t: string, n: number) => {
  const cs = chars(t)
  return cs.length >= n ? cs.slice(-n).join('') : ' '.repeat(n - cs.length) + t
}
const pct = (hp: number, max: number) => (max > 0 ? Math.floor((hp * 100) / max) : 0)
const fill = (hp: number, max: number) => (max > 0 ? Math.floor((hp * GAUGE_FULL) / max) : 0)

/** A hero's text colour: orange under 25% HP, red at 0 (grill 1.13). */
export function heroRgb(h: HeroView): number {
  if (!h.alive || h.hp <= 0) return DOWN_RGB
  return h.hp * 4 < h.maxHp ? WARN_RGB : TEXT_RGB
}

/** A character of a line's text with its colour and its index in the text, or a span laid whole. */
type Unit = { ch: string; rgb?: number; at: number } | { span: Span; at: number }
const cellsOf = (units: readonly Unit[]) =>
  units.reduce((n, u) => n + ('ch' in u ? 1 : spanCells(u.span)), 0)

/** A wrapped row's spans, and `from`, the line's text characters before its first one. */
export type WrappedRow = { spans: Span[]; from: number }

/**
 * Word-wrapped rows of at most `n` cells, each span keeping its colour on every row it reaches;
 * a word longer than a row is cut, and a span that is not text (an art span) is never split.
 */
export function wrapSpans(spans: readonly Span[], n: number): WrappedRow[] {
  const words: Unit[][] = [[]]
  /** The space before each word but the first: the break between two words, coloured. */
  const spaces: (Unit | null)[] = [null]
  let at = 0
  for (const s of spans) {
    if (!('text' in s)) {
      words[words.length - 1]?.push({ span: s, at })
      continue
    }
    for (const ch of chars(s.text)) {
      const u: Unit = s.rgb === undefined ? { ch, at } : { ch, rgb: s.rgb, at }
      at += 1
      if (ch === ' ') {
        words.push([])
        spaces.push(u)
      } else words[words.length - 1]?.push(u)
    }
  }
  const rows: Unit[][] = []
  let row: Unit[] = []
  for (const [i, word] of words.entries()) {
    let w = word
    while (cellsOf(w) > n && w.length > 1) {
      if (row.length > 0) {
        rows.push(row)
        row = []
      }
      let k = 0
      while (k < w.length - 1 && cellsOf(w.slice(0, k + 1)) <= n) k += 1
      rows.push(w.slice(0, Math.max(1, k)))
      w = w.slice(Math.max(1, k))
    }
    const space = spaces[i]
    if (row.length === 0) row = [...w]
    else if (space && cellsOf(row) + 1 + cellsOf(w) <= n) row = [...row, space, ...w]
    else {
      rows.push(row)
      row = [...w]
    }
  }
  if (row.length > 0) rows.push(row)
  return rows.map((units) => {
    const out: Span[] = []
    for (const u of units) {
      if ('span' in u) {
        out.push(u.span)
        continue
      }
      const last = out.at(-1)
      if (last && 'text' in last && last.rgb === u.rgb)
        out[out.length - 1] = { ...last, text: last.text + u.ch }
      else out.push(u.rgb === undefined ? { text: u.ch } : { text: u.ch, rgb: u.rgb })
    }
    const first = units.find((u) => 'ch' in u) ?? units[0]
    return { spans: out, from: first?.at ?? 0 }
  })
}

/** Word-wrapped rows of at most `n` cells; a word longer than a row is cut. */
export function wrap(line: string, n: number): string[] {
  return wrapSpans([{ text: line }], n).map((r) =>
    r.spans.map((s) => ('text' in s ? s.text : '')).join(''),
  )
}

/**
 * The world boss's time left while the staged enemies hold its row: '' without a clock or a
 * polled boss, null when no world boss is up.
 */
function worldBossLeft(input: StripInput): string | null {
  const { view, world, now } = input
  if (!view.enemies.some((e) => e.kind === 'world_boss')) return null
  const boss = world.snapshot?.boss
  return boss && world.clock ? formatRemaining(remainingRealMs(boss.endsAt, world.clock, now)) : ''
}

function enemyLabel(input: StripInput): { title: string; boss: boolean } {
  const { view } = input
  const left = worldBossLeft(input)
  if (left !== null) return { title: left ? `World boss · ${left}` : 'World boss', boss: true }
  // Past tier 1 the short form: "Tier 2, zone 1 · Wave 10" outruns the window's 21 title cells.
  if (view.wave >= 11 || view.enemies.some((e) => e.kind === 'zone_boss' || e.kind === 'turn_boss'))
    return { title: `${zoneMark(view.zone, 'Zone ')} · Boss`, boss: true }
  return { title: `${zoneMark(view.zone, 'Zone ')} · Wave ${view.wave}`, boss: false }
}

/** The staged enemies in line order, each with its staged HP, the world boss's bar included. */
function enemies(
  input: StripInput,
): { id: string; name: string; hp: number; maxHp: number; boss: boolean }[] {
  return input.view.enemies.map((e) => ({
    id: e.id,
    name: e.name,
    hp: e.hp,
    maxHp: e.maxHp,
    boss: e.kind !== 'wave',
  }))
}

/** The bar's span in `enemyRow`'s spans. */
const ENEMY_BAR_SPAN = 2

/** One enemy row in `n` cells: name, gap, bar; a boss: name, gap, bar, percentage in 4. */
function enemyRow(
  e: { name: string; hp: number; maxHp: number; boss: boolean },
  n: number,
): Span[] {
  const bar = 8
  if (e.boss) {
    const name = Math.max(1, n - 1 - bar - 4)
    return [
      text(padTo(clip(e.name, name), name)),
      pad(1),
      { bar: fill(e.hp, e.maxHp), cells: bar, rgb: HP_BAR_RGB },
      text(right(`${pct(e.hp, e.maxHp)}%`, 4)),
    ]
  }
  const name = Math.max(1, n - 1 - bar)
  return [
    text(padTo(clip(e.name, name), name)),
    pad(1),
    { bar: fill(e.hp, e.maxHp), cells: bar, rgb: HP_BAR_RGB },
  ]
}

function enemyWindow(input: StripInput, x: number): Built {
  const { title } = enemyLabel(input)
  // A camp holds the encounter off the field: its rows blank but a dim word, title and footer kept.
  const camping = input.view.camping
  const list = camping ? [] : enemies(input).slice(0, 3)
  const inner = ENEMY_COLUMNS - 2
  const lines: Line[] = camping
    ? [{ spans: [pad(1), text(CAMPING, DIM_RGB)] }]
    : list.map((e) => ({ spans: [pad(1), ...enemyRow(e, inner - 2), pad(1)] }))
  // The three rows are the field's: the queue behind them is the footer, the sim's count.
  const { waiting } = input.view
  const field = camping
    ? 'Camping'
    : list.map((e) => `${e.name} ${e.hp} of ${e.maxHp} HP`).join(', ') || 'No enemies'
  const alt = `${title}. ${field}.${waiting > 0 ? ` ${waiting} more waiting.` : ''}`
  const hp = list.map((e, line) => ({ id: e.id, line, span: 1 + ENEMY_BAR_SPAN }))
  return {
    win: {
      key: 'enemy',
      x,
      columns: ENEMY_COLUMNS,
      rows: STRIP_ROWS,
      title: [text(title)],
      ...(waiting > 0 ? { footer: [text(`+${waiting} waiting`, DIM_RGB)] } : {}),
      lines,
      alt,
    },
    hotspots: [],
    slots: [],
    hp,
  }
}

/** The collapse hint at the command line's right end: the key, then the mark. */
const COLLAPSE_HINT = 'c ▾'

/**
 * The command line `▶Party Loot World … 5-6/61 c ▾` in `n` cells, and where its words sit (cell
 * offsets). On World, presence follows the tabs, `· 13 online · zone 1: Bea, Kit`, its longest
 * candidate that leaves room for the hint and the footer's shortest form, else for the hint alone.
 * The page footer, while the window is off the paging space's last row, sits before the hint in
 * its longest form that fits; the hint is never dropped. `n` null:
 * the short form, the hint right after World (compact's footer, which must leave its border).
 */
function commandLine(
  tab: BandTab,
  n: number | null,
  footer: readonly string[] = [],
  presence: Presence | null = null,
): { spans: Span[]; at: { hotkey: Hotspot['hotkey']; label: string; x: number }[] } {
  const items: { hotkey: Hotspot['hotkey']; label: string; tab: BandTab }[] = [
    { hotkey: 'p', label: 'Party', tab: 'party' },
    { hotkey: 'l', label: 'Loot', tab: 'loot' },
    { hotkey: 'w', label: 'World', tab: 'world' },
  ]
  const spans: Span[] = []
  const at: { hotkey: Hotspot['hotkey']; label: string; x: number }[] = []
  for (const [i, item] of items.entries()) {
    if (i > 0) spans.push(pad(1))
    at.push({ hotkey: item.hotkey, label: item.label, x: width(spans) })
    spans.push({ cursor: tab === item.tab }, text(item.label))
  }
  const hint = chars(COLLAPSE_HINT).length
  if (presence && n !== null) {
    const rgb = presence.dim ? DIM_RGB : TEXT_RGB
    const shortest = footer.at(-1)
    const room = shortest === undefined ? 0 : 1 + chars(shortest).length
    const candidates = presence.parts.map((parts) =>
      parts.flatMap((p) => [pad(1), text('·', DIM_RGB), pad(1), text(p, rgb)]),
    )
    const fitted =
      candidates.find((p) => width(spans) + width(p) + room + 1 + hint <= n) ??
      candidates.find((p) => width(spans) + width(p) + 1 + hint <= n)
    if (fitted) spans.push(...fitted)
  }
  const fits =
    n === null ? undefined : footer.find((f) => width(spans) + 1 + chars(f).length + 1 + hint <= n)
  const tail = fits === undefined ? [] : [text(fits), pad(1)]
  spans.push(pad(n === null ? 1 : Math.max(1, n - width(spans) - width(tail) - hint)), ...tail)
  at.push({ hotkey: 'c', label: COLLAPSE_HINT, x: width(spans) })
  spans.push(text(COLLAPSE_HINT, DIM_RGB))
  return { spans, at }
}

/** The cells a loot row's lead takes: the sprite and the gap after it, as an inventory row's. */
const LEAD_CELLS = ART_CELLS + 1
/** What the Raster draws in a loot row's sprite cells, in the rarity's colour. */
const LOOT_MARK = '█'

/**
 * A loot row's lead: the item's sprite or the hero's class sprite, marked on the Raster with a
 * block in the rarity's colour, or a blank gap; then the gap before the name.
 */
function lootLead(l: LootView, rgb: number): Span[] {
  const art: Span = l.lead
    ? { art: spriteFor(l.lead.kind, l.lead.key).full, mark: { ch: LOOT_MARK, rgb } }
    : pad(ART_CELLS)
  return [art, pad(1)]
}

/** The Loot tab's one row before the first drop. */
const NO_LOOT = 'No loot yet'

/** A log line as the message window pages it: its text, and its rows wrapped to the window. */
type LogRows = { text: string; rows: Line[] }

/** The log tab's lines in `n` cells, oldest first, each wrapped in full; the newest typing. */
function logLines(input: StripInput, n: number, at: number): LogRows[] {
  if (input.tab === 'loot') {
    return input.view.loot.map((l) => {
      const rgb = RARITY_RGB[l.rarity] ?? TEXT_RGB
      const rows = wrapSpans([text(l.name, rgb), ...(l.rest ? [text(l.rest)] : [])], n - LEAD_CELLS)
      return {
        text: l.text,
        rows: rows.map((r, i) => ({
          spans: [...(i === 0 ? lootLead(l, rgb) : [pad(LEAD_CELLS)]), ...r.spans],
        })),
      }
    })
  }
  return input.log.shown(at, input.motion).map((l) => ({
    text: l.text,
    rows: wrapSpans([text(l.text, l.rgb)], n).map((r) => {
      const len = r.spans.reduce((k, s) => k + ('text' in s ? chars(s.text).length : 0), 0)
      const reveal = Math.max(0, Math.min(len, l.revealed - r.from))
      return { spans: r.spans, ...(reveal < len ? { reveal } : {}) }
    }),
  }))
}

/** Rows a page of the message window moves: its two text rows. */
export const PAGE_ROWS = 2

/**
 * Where the message window stands on a log tab, what `j` and `k` page from: `offset` rows back
 * from the newest position, between `min` (a notice's last rows) and `max` (the oldest rows), and
 * the tab's line texts and the notice's row count it was read against.
 */
export type Page = {
  offset: number
  min: number
  max: number
  lines: readonly string[]
  notes: number
}

/** The scroll `by` rows from `page`, older for a positive `by`: `j` is PAGE_ROWS, `k` its negative. */
export function paged(page: Page, by: number): LogScroll {
  return {
    rows: Math.max(page.min, Math.min(page.max, page.offset + by)),
    lines: page.lines,
    notes: page.notes,
  }
}

/** Lines at the end of `now` that came after `before`'s newest: how far its window was pushed back. */
function newSince(before: readonly string[], now: readonly string[]): number {
  for (let k = 0; k < now.length; k++) {
    const n = Math.min(now.length - k, before.length)
    if (n === 0) break
    let same = true
    for (let i = 1; i <= n && same; i++)
      same = now[now.length - k - i] === before[before.length - i]
    if (same) return k
  }
  return 0
}

/** Whether the message window shows `g: back to the fight`: camping, and no notice holds its row. */
const backToFight = (input: StripInput) => input.view.camping && !input.notice

/**
 * The footer's forms while the window is off the paging space's last row, `end` its last row
 * shown: `37-38/40`, then `37/40`, then `/40`, for the command line to fit the longest.
 */
const footerForms = (end: number, total: number): string[] =>
  end < total ? [`${end - 1}-${end}/${total}`, `${end - 1}/${total}`, `/${total}`] : []

/** The message window's two rows, the footer's forms while paged off the newest, and its page. */
type Body = {
  rows: Line[]
  footer: string[]
  page: Page | null
  /** The window row the `g: back to the fight` row shows on, if it shows. */
  back: number | null
  /** On World, presence for the command line. */
  presence?: Presence | null
}

/**
 * The rows under the command line in `n` cells. On Party and Loot the log's rows, every line
 * wrapped in full, then a notice's (or the camp's `g` row's), are one paging space: at the newest
 * the window shows the log's tail, or a notice's first rows, and the scroll pages it back. On
 * World a notice takes the bottom row, or both rows and the paging space when it needs two or more:
 * its first rows at the newest, the scroll paging on through it.
 */
function messageBody(input: StripInput, n: number, at: number): Body {
  const back = backToFight(input)
  const note = input.notice ?? (back ? BACK_TO_FIGHT : null)
  const notes: Line[] =
    note === null ? [] : wrapSpans([text(note)], n).map((r) => ({ spans: r.spans }))
  if (input.tab === 'world') {
    // Two fixed rows, the records row then chat; presence goes to the command line.
    const world = worldTabRows(input.view, input.world, PAGE_ROWS, n, at)
    const rows: Line[] = world.rows.map((r) => ({
      spans: [r.dim ? text(r.text, DIM_RGB) : text(r.text)],
    }))
    const presence = world.presence
    if (notes.length >= PAGE_ROWS) {
      // No log behind it: the offset runs from 0, its first rows, to its last rows.
      const min = PAGE_ROWS - notes.length
      const offset = Math.max(min, Math.min(0, input.scroll?.rows ?? 0))
      const end = PAGE_ROWS - offset
      return {
        rows: notes.slice(end - PAGE_ROWS, end),
        footer: footerForms(end, notes.length),
        page: { offset, min, max: 0, lines: [], notes: notes.length },
        back: back && offset === 0 ? 0 : null,
        presence,
      }
    }
    if (notes[0]) rows[1] = notes[0]
    return { rows, footer: [], page: null, back: back ? 1 : null, presence }
  }
  const lines = logLines(input, n, at)
  const texts = lines.map((l) => l.text)
  const log: Line[] =
    input.tab === 'loot' && lines.length === 0
      ? [{ spans: [text(NO_LOOT, DIM_RGB)] }]
      : lines.flatMap((l) => l.rows)
  const total = log.length + notes.length
  if (total <= PAGE_ROWS) {
    const blank = Array.from({ length: notes.length > 0 ? PAGE_ROWS - total : 0 }, () => ({
      spans: [],
    }))
    return {
      rows: [...log, ...blank, ...notes],
      footer: [],
      page: { offset: 0, min: 0, max: 0, lines: texts, notes: notes.length },
      back: back ? log.length + blank.length : null,
    }
  }
  // Rows back from the newest position; a scroll set back from the newest is pushed back by the
  // rows of every line since, and by the rows a notice come or gone adds to the newest position,
  // so the window stays on what it showed.
  const scroll = input.scroll
  const noted = Math.min(PAGE_ROWS, notes.length)
  let offset = scroll?.rows ?? 0
  if (scroll && scroll.rows > 0) {
    const k = newSince(scroll.lines, texts)
    offset += lines.slice(lines.length - k).reduce((r, l) => r + l.rows.length, 0)
    offset += noted - Math.min(PAGE_ROWS, scroll.notes)
  }
  const newest = log.length + noted
  const min = newest - total
  const max = newest - PAGE_ROWS
  offset = Math.max(min, Math.min(max, offset))
  const end = newest - offset
  const noteAt = log.length - (end - PAGE_ROWS)
  return {
    rows: [...log, ...notes].slice(end - PAGE_ROWS, end),
    footer: footerForms(end, total),
    page: { offset, min, max, lines: texts, notes: notes.length },
    back: back && noteAt >= 0 && noteAt < PAGE_ROWS ? noteAt : null,
  }
}

/** The message window's lines: the command line, then the body's rows; the body at `at` unless given. */
function messageLines(
  input: StripInput,
  columns: number,
  at = input.now,
  body = messageBody(input, columns - 4, at),
): Line[] {
  const cmd = commandLine(input.tab, columns - 4, body.footer, body.presence)
  const rows = body.rows.map((l) => ({ ...l, spans: [pad(1), ...l.spans] }))
  while (rows.length < PAGE_ROWS) rows.push({ spans: [] })
  return [{ spans: [pad(1), ...cmd.spans] }, ...rows]
}

function messageWindow(
  input: StripInput,
  x: number,
  columns: number,
): Built & { page: Page | null } {
  const n = columns - 4
  const body = messageBody(input, n, input.now)
  const cmd = commandLine(input.tab, n, body.footer, body.presence)
  const lines = messageLines(input, columns, input.now, body)
  const hotspots: Hotspot[] = cmd.at.map((c) => ({
    hotkey: c.hotkey,
    label: c.label,
    x: x + 2 + c.x,
    y: 1,
    columns: c.hotkey === 'c' ? chars(c.label).length : chars(c.label).length + 1,
  }))
  // The camp's row, under the command line where it shows: the top border, then the command line.
  if (body.back !== null)
    hotspots.push({
      hotkey: 'g',
      label: BACK_TO_FIGHT,
      x: x + 2,
      y: 2 + body.back,
      columns: Math.min(n, chars(BACK_TO_FIGHT).length),
    })
  const shown = lines
    .slice(1)
    .map((l) =>
      l.spans
        .map((s) => ('text' in s ? s.text : ''))
        .join('')
        .trim(),
    )
    .filter(Boolean)
  const full = body.footer[0]
  const where = full === undefined ? '' : ` Rows ${full.replace('/', ' of ')}.`
  const seen = body.presence?.parts[0]?.join(' · ')
  // The sandbox mark: the window's title on every tab, so a sandbox screenshot never reads as real play.
  const sandbox = input.view.account.sandbox
  const alt =
    `${sandbox ? 'Sandbox. ' : ''}${input.tab[0]?.toUpperCase()}${input.tab.slice(1)} tab.${where}${seen ? ` ${seen}.` : ''} ${shown.join(' ')}`.trim()
  return {
    win: {
      key: 'message',
      x,
      columns,
      rows: STRIP_ROWS,
      ...(sandbox ? { title: [text('Sandbox')] } : {}),
      lines,
      alt,
    },
    hotspots,
    slots: [],
    hp: [],
    page: body.page,
  }
}

function gaugeOf(input: StripInput, h: HeroView): { fill: number; rgb: number } {
  if (!h.alive) return { fill: 0, rgb: DIM_RGB }
  const g = input.gauges.at(h, input.now)
  return { fill: g, rgb: g >= GAUGE_FULL ? GAUGE_FULL_RGB : GAUGE_RGB }
}

function heroAlt(input: StripInput, h: HeroView): string {
  const g = gaugeOf(input, h).fill
  const gauge = !h.alive ? 'down' : g >= GAUGE_FULL ? 'gauge full' : `gauge ${Math.floor(g / 100)}%`
  return `${h.shortName} level ${h.level}, HP ${h.hp} of ${h.maxHp}, ${gauge}`
}

function partyWindow(input: StripInput, x: number): Built {
  const acting = input.timeline.acting(input.now)
  const header: Span[] = [pad(1)]
  const hp: Span[] = [pad(1)]
  const gauge: Span[] = [pad(1)]
  const slots: Slots[] = []
  const bars: HpSlot[] = []
  for (const [i, h] of input.view.heroes.slice(0, 3).entries()) {
    if (i > 0) {
      header.push(pad(1))
      hp.push(pad(1))
      gauge.push(pad(1))
    }
    const rgb = heroRgb(h)
    const level = ` L${h.level}`
    const name = clip(h.shortName, Math.max(1, 11 - chars(level).length))
    const cursor = { line: 0, span: header.length }
    header.push({ cursor: acting === h.id }, text(padTo(name + level, 11), rgb))
    bars.push({ id: h.id, line: 1, span: hp.length + 3 })
    hp.push(text('H', rgb), text(right(String(h.hp), 4), rgb), pad(1), {
      bar: fill(h.hp, h.maxHp),
      cells: 6,
      rgb: HP_BAR_RGB,
    })
    const g = gaugeOf(input, h)
    const gaugeSlot = { line: 2, span: gauge.length }
    gauge.push({ bar: g.fill, cells: 12, rgb: g.rgb })
    slots.push({ hero: h, cursor, gauge: gaugeSlot })
  }
  const lines: Line[] = [{ spans: header, rule: true }, { spans: hp }, { spans: gauge }]
  const alt = `Party: ${input.view.heroes.map((h) => heroAlt(input, h)).join('; ')}.`
  return {
    win: { key: 'party', x, columns: PARTY_COLUMNS, rows: STRIP_ROWS, lines, alt },
    hotspots: [],
    slots,
    hp: bars,
  }
}

/** What each tactic does after the zone boss, and what `f` does, for the purse's alt. */
const TACTICS_ALT = {
  next: 'After the boss: on to the next zone. f: stay and repeat it.',
  stay: 'After the boss: stay and repeat the zone from wave 1. f: move on.',
}

function purseWindow(input: StripInput, x: number): Built {
  const gold = clip(`${formatCount(input.view.gold)}G`, 9)
  const tactics = tacticsName(input.view.farm)
  const lines: Line[] = [
    { spans: [pad(1), text(gold, GOLD_RGB)] },
    { spans: [pad(1), text('f:', DIM_RGB), pad(1), text(tactics)] },
  ]
  let alt = `Gold ${formatCount(input.view.gold)}. ${input.view.farm ? TACTICS_ALT.stay : TACTICS_ALT.next}`
  // The zone's falls before a retreat; boss mode counts no wipes, so it shows none.
  if (input.view.boss === null) {
    const falls = input.view.zoneWipes
    lines.push({ spans: [pad(1), text(`Falls ${falls}/${RETREAT_AT}`)] })
    alt += ` Falls ${falls} of ${RETREAT_AT} before a retreat.`
  }
  return {
    win: {
      key: 'purse',
      x,
      columns: PURSE_COLUMNS,
      rows: STRIP_ROWS,
      lines,
      alt,
    },
    // The whole row inside the border.
    hotspots: [{ hotkey: 'f', label: `f: ${tactics}`, x: x + 1, y: 2, columns: PURSE_COLUMNS - 2 }],
    slots: [],
    hp: [],
  }
}

/** The compact window's rows inside its border, beside the small stage. */
const COMPACT_ROWS = 4

/** The compact window's rows, the desktop's slots in them, and what they say for the alt. */
type CompactRows = { lines: Line[]; slots: Slots[]; hp: HpSlot[]; alt: string }

/** Party's compact rows: the three heroes, then the front enemy, `camping`, or a notice. */
function compactParty(input: StripInput, inner: number): CompactRows {
  const { view } = input
  const acting = input.timeline.acting(input.now)
  const lines: Line[] = []
  const slots: Slots[] = []
  const bars: HpSlot[] = []
  for (const h of view.heroes.slice(0, 3)) {
    const rgb = heroRgb(h)
    const level = ` L${h.level}`
    const label = padTo(clip(h.shortName, Math.max(1, 11 - chars(level).length)) + level, 11)
    const fixed = 1 + 1 + 11 + 1 + 1 + 4 + 1 + 1 + 1
    const rest = Math.max(2, inner - fixed)
    const hpBar = Math.ceil(rest / 2)
    const g = gaugeOf(input, h)
    const spans: Span[] = [
      pad(1),
      { cursor: acting === h.id },
      text(label, rgb),
      pad(1),
      text('H', rgb),
      text(right(String(h.hp), 4), rgb),
      pad(1),
      { bar: fill(h.hp, h.maxHp), cells: hpBar, rgb: HP_BAR_RGB },
      pad(1),
    ]
    bars.push({ id: h.id, line: lines.length, span: spans.length - 2 })
    const gauge = { line: lines.length, span: spans.length }
    spans.push({ bar: g.fill, cells: rest - hpBar, rgb: g.rgb })
    slots.push({ hero: h, cursor: { line: lines.length, span: 1 }, gauge })
    lines.push({ spans })
  }
  const front = view.camping ? undefined : enemies(input)[0]
  // The heroes keep their rows: a notice takes the front enemy's, its first row, never cut.
  const note = input.notice ? wrap(input.notice, inner - 2)[0] : undefined
  if (note !== undefined) lines[3] = { spans: [pad(1), text(note)] }
  else if (view.camping) lines[3] = { spans: [pad(1), text(CAMPING, DIM_RGB)] }
  else if (front) {
    lines[3] = { spans: [pad(1), ...enemyRow(front, Math.min(inner - 2, 27))] }
    bars.push({ id: front.id, line: 3, span: 1 + ENEMY_BAR_SPAN })
  }
  const field = view.camping
    ? ' Camping.'
    : front
      ? ` Front enemy ${front.name} ${front.hp} of ${front.maxHp} HP.`
      : ''
  const alt = `Party: ${view.heroes.map((h) => heroAlt(input, h)).join('; ')}.${field}`
  return { lines, slots, hp: bars, alt }
}

/**
 * Loot's and World's compact rows, from the rows the message window builds: the newest loot rows,
 * or presence, the records row, chat and a blank row. A notice wraps into the bottom rows it
 * needs, its first four when it needs more, the tab keeping the rows above; nothing pages.
 */
function compactTab(input: StripInput, inner: number): CompactRows {
  const n = inner - 2
  const notes = input.notice ? wrap(input.notice, n).slice(0, COMPACT_ROWS) : []
  const keep = COMPACT_ROWS - notes.length
  let rows: Line[]
  if (input.tab === 'world') {
    rows = worldTabRows(input.view, input.world, COMPACT_ROWS, n, input.now).rows.map((r) => ({
      spans: r.text ? [r.dim ? text(r.text, DIM_RGB) : text(r.text)] : [],
    }))
  } else {
    const lines = logLines(input, n, input.now)
    rows =
      lines.length === 0
        ? [{ spans: [text(NO_LOOT, DIM_RGB)] }]
        : lines.flatMap((l) => l.rows).slice(-COMPACT_ROWS)
    // The newest rows the notice leaves, at the top.
    rows = rows.slice(Math.max(0, rows.length - keep))
  }
  const lines: Line[] = rows.slice(0, keep).map((r) => ({ spans: [pad(1), ...r.spans] }))
  while (lines.length < keep) lines.push({ spans: [] })
  for (const note of notes) lines.push({ spans: [pad(1), text(note)] })
  const said = lines
    .map((l) =>
      l.spans
        .map((s) => ('text' in s ? s.text : ''))
        .join('')
        .trim(),
    )
    .filter(Boolean)
  const tab = `${input.tab[0]?.toUpperCase()}${input.tab.slice(1)} tab.`
  return { lines, slots: [], hp: [], alt: `${tab} ${said.join(' ')}`.trim() }
}

function compactWindow(input: StripInput, x: number, columns: number): Built {
  const { view } = input
  const inner = columns - 2
  // Under 116 columns there is no enemy window: the world boss's time left takes the wave's place.
  const left = worldBossLeft(input)
  const wave =
    left !== null
      ? `World boss${left ? ` ${left}` : ''}`
      : view.wave >= 11
        ? 'Boss'
        : `W${view.wave}`
  let title = `Z${view.zone} · ${wave} · ${formatCount(view.gold)}G`
  // Stay here, then the sandbox mark, each when it fits; Next zone says nothing.
  for (const word of [
    view.farm ? tacticsName(true) : null,
    view.account.sandbox ? 'Sandbox' : null,
  ])
    if (word && chars(`${title} · ${word}`).length <= inner - 3) title = `${title} · ${word}`
  const body = input.tab === 'party' ? compactParty(input, inner) : compactTab(input, inner)
  const cmd = commandLine(input.tab, null)
  const hotspots: Hotspot[] = cmd.at.map((c) => ({
    hotkey: c.hotkey,
    label: c.label,
    x: x + 2 + c.x,
    y: COMPACT_WINDOW_ROWS - 1,
    columns: c.hotkey === 'c' ? chars(c.label).length : chars(c.label).length + 1,
  }))
  hotspots.push({ hotkey: 'f', label: title, x: x + 2, y: 0, columns: chars(title).length })
  const alt = `${title}. ${body.alt}`
  return {
    win: {
      key: 'compact',
      x,
      columns,
      rows: COMPACT_WINDOW_ROWS,
      title: [text(title)],
      footer: cmd.spans,
      lines: body.lines,
      alt,
    },
    hotspots,
    slots: body.slots,
    hp: body.hp,
  }
}

/**
 * The view as the stage shows it: the staged state (stage/staged.ts). A hero is down once his
 * killing blow lands (#20); a killed monster keeps its row, and the encounter its wave and zone,
 * until its death has played; the world boss's bar drops as the hits land.
 */
function asStaged(input: StripInput): StripInput {
  return { ...input, view: stagedState(input.view, input.world, input.timeline, input.now) }
}

function build(raw: StripInput): { scene: Scene; built: Built[]; page: Page | null } {
  const input = asStaged(raw)
  const columns = Math.min(input.columns, STRIP_MAX_COLUMNS)
  if (input.kind === 'compact') {
    // The window sits beside the compact stage: the band's columns less the stage's.
    const w = compactWindow(input, 0, columns - COMPACT_STAGE_COLUMNS)
    return {
      scene: {
        columns: w.win.columns,
        rows: COMPACT_WINDOW_ROWS,
        windows: [w.win],
        alt: w.win.alt,
      },
      built: [w],
      page: null,
    }
  }
  const message = columns - ENEMY_COLUMNS - PARTY_COLUMNS - PURSE_COLUMNS
  const built: Built[] = [enemyWindow(input, 0)]
  let x = ENEMY_COLUMNS
  const msg = messageWindow(input, x, message)
  built.push(msg)
  x += message
  built.push(partyWindow(input, x))
  x += PARTY_COLUMNS
  built.push(purseWindow(input, x))
  const windows = built.map((b) => b.win)
  return {
    scene: { columns, rows: STRIP_ROWS, windows, alt: windows.map((w) => w.alt).join(' ') },
    built,
    page: msg.page,
  }
}

/**
 * The strip's scene and hotspots, and on Party and Loot, or World with a long notice, the message
 * window's page: where the window stands over the rows the strip wrapped at its width, for `j` and
 * `k` to page from.
 */
export function stripScene(input: StripInput): {
  scene: Scene
  hotspots: readonly Hotspot[]
  page: Page | null
} {
  const { scene, built, page } = build(input)
  return { scene, hotspots: built.flatMap((b) => b.hotspots), page }
}

/** The desktop's motion over the next `horizonMs`: HP bars, gauges, the ▶, the message window's lines. */
export function stripTracks(input: StripInput, horizonMs: number): Track[] {
  const { built, page } = build(input)
  const tracks: Track[] = []
  const now = input.now
  const actions = input.timeline.actions()
  const landings = landingsWithin(input.timeline, now, horizonMs)
  // The staged state just after each landing: a bar steps to it at the impact, the way the
  // next redraw would draw it, so a landing past the horizon waits for that redraw.
  const after = new Map<number, GameView>()
  const hpAt = (id: string, at: number) => {
    let view = after.get(at)
    if (!view) {
      view = stagedState(input.view, input.world, input.timeline, at)
      after.set(at, view)
    }
    const a = view.heroes.find((h) => h.id === id) ?? view.enemies.find((e) => e.id === id)
    return a ? fill(a.hp, a.maxHp) : 0
  }
  for (const b of built) {
    for (const s of b.hp) {
      const list = landings.get(s.id)
      if (!list) continue
      let last = hpAt(s.id, now)
      const keys = [{ at: 0, fill: last }]
      for (const l of list) {
        const next = hpAt(s.id, l.at)
        keys.push({ at: l.at - now, fill: last }, { at: l.at - now, fill: next })
        last = next
      }
      keys.push({ at: horizonMs, fill: last })
      tracks.push({
        kind: 'bar',
        window: b.win.key,
        line: s.line,
        span: s.span,
        keys,
        fullRgb: HP_BAR_RGB,
      })
    }
    for (const s of b.slots) {
      tracks.push({
        kind: 'bar',
        window: b.win.key,
        line: s.gauge.line,
        span: s.gauge.span,
        keys: input.gauges.keys(s.hero, now, horizonMs),
        fullRgb: GAUGE_FULL_RGB,
      })
      const on: { from: number; until: number }[] = []
      for (const [i, a] of actions.entries()) {
        if (a.actor !== s.hero.id) continue
        const until = Math.min(a.until, actions[i + 1]?.start ?? a.until)
        if (until <= now || a.start > now + horizonMs) continue
        on.push({ from: Math.max(0, a.start - now), until: until - now })
      }
      if (on.length > 0)
        tracks.push({
          kind: 'cursor',
          window: b.win.key,
          line: s.cursor.line,
          span: s.cursor.span,
          on,
        })
    }
    if (b.win.key === 'message' && input.tab === 'party') {
      // A notice or the camp's row holds the typing row, motion still shows lines whole, and paged
      // back the typing line is out of the window: no typing then.
      const types =
        input.motion !== 'still' && !input.notice && !input.view.camping && !page?.offset
      const width = b.win.columns - 4
      const lastRow = (text: string, revealed: number) => {
        // Cells of the line's last row already shown: its leading gap, then what typed into it.
        const last = wrapSpans([{ text }], width).at(-1)
        return 1 + Math.max(0, revealed - (last?.from ?? 0))
      }
      const frames: Extract<Track, { kind: 'lines' }>['frames'][number][] = []
      const current = input.log.typing(now, input.motion)
      if (current && types) {
        // The line typing when the band rendered goes on typing from where it is.
        const lines = messageLines({ ...input, motion: 'still' }, b.win.columns, now)
        frames.push({
          at: 0,
          lines,
          typing: {
            line: lines.length - 1,
            charMs: current.charMs,
            from: lastRow(current.text, current.revealed),
          },
        })
      }
      for (const l of input.log.upcoming(now, horizonMs)) {
        const lines = messageLines({ ...input, motion: 'still' }, b.win.columns, l.at)
        frames.push({
          at: l.at - now,
          lines,
          ...(types ? { typing: { line: lines.length - 1, charMs: l.charMs } } : {}),
        })
      }
      if (frames.length > 0) tracks.push({ kind: 'lines', window: 'message', frames })
    }
  }
  return tracks
}
