// The band's window strip (grill 1.7, 1.13, 1.15, 1.16): the enemy, message, party and purse
// windows under the stage, or the one party window beside the compact stage. Pure: the view,
// the stage timeline, the gauge tracker and the log in, a scene out; the encoders draw it.
import type { BandTab, GameView, HeroView, Settings, WorldState } from '../../types'
import type { GaugeTrack } from '../stage/gauges'
import type { MessageLog } from '../stage/log'
import type { StageTimeline } from '../stage/timeline'
import { COMPACT_STAGE_COLUMNS, RARITY_RGB } from '../stage/tuning'
import { GAUGE_FULL } from '../vendor/sim.js'
import {
  chars,
  drawable,
  type Line,
  type Scene,
  type Span,
  spanCells,
  type Track,
  type Win,
} from '../windows/kit'
import {
  COMPACT_WINDOW_ROWS,
  DIM_RGB,
  DOWN_RGB,
  ENEMY_COLUMNS,
  GAUGE_FULL_RGB,
  GAUGE_RGB,
  HP_BAR_RGB,
  PARTY_COLUMNS,
  PURSE_COLUMNS,
  STRIP_MAX_COLUMNS,
  STRIP_ROWS,
  TEXT_RGB,
  WARN_RGB,
} from '../windows/tuning'
import { shownBoss } from './boss'
import { clip, formatCount } from './format'
import { formatRemaining, remainingRealMs } from './time'
import { worldRows } from './world-rows'

export type StripInput = {
  view: GameView
  world: WorldState
  tab: BandTab
  /** full: under the stage; compact: the party window beside the compact stage; bare: Loot/World. */
  kind: 'full' | 'compact' | 'bare'
  columns: number
  now: number
  notice: string | null
  motion: Settings['motion']
  timeline: StageTimeline
  gauges: GaugeTrack
  log: MessageLog
}

export type Hotspot = {
  hotkey: 'p' | 'l' | 'w' | 'c' | 'f'
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
type Built = { win: Win; hotspots: Hotspot[]; slots: Slots[] }

const FULL_MIN = 116
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
function heroRgb(h: HeroView): number {
  if (!h.alive || h.hp <= 0) return DOWN_RGB
  return h.hp * 4 < h.maxHp ? WARN_RGB : TEXT_RGB
}

/** Word-wrapped rows of at most `n` cells; a word longer than a row is cut. */
export function wrap(line: string, n: number): string[] {
  const rows: string[] = []
  let row = ''
  for (const word of line.split(' ')) {
    let w = word
    while (chars(w).length > n) {
      if (row) {
        rows.push(row)
        row = ''
      }
      rows.push(chars(w).slice(0, n).join(''))
      w = chars(w).slice(n).join('')
    }
    if (!row) row = w
    else if (chars(row).length + 1 + chars(w).length <= n) row = `${row} ${w}`
    else {
      rows.push(row)
      row = w
    }
  }
  if (row) rows.push(row)
  return rows
}

function enemyLabel(input: StripInput): { title: string; boss: boolean } {
  const { view, world, now } = input
  if (view.enemies.some((e) => e.kind === 'world_boss')) {
    const shown = shownBoss(view, world)
    const left =
      shown && world.clock
        ? ` · ${formatRemaining(remainingRealMs(shown.boss.endsAt, world.clock, now))}`
        : ''
    return { title: `World boss${left}`, boss: true }
  }
  if (view.wave >= 11 || view.enemies.some((e) => e.kind === 'zone_boss' || e.kind === 'turn_boss'))
    return { title: `Zone ${view.zone} · Boss`, boss: true }
  return { title: `Zone ${view.zone} · Wave ${view.wave}`, boss: false }
}

/** The live enemies in line order, each with the HP it shows (the world boss's predicted bar). */
function enemies(input: StripInput): { name: string; hp: number; maxHp: number; boss: boolean }[] {
  const { view, world, timeline } = input
  const slot = new Map(timeline.known().map((k, place) => [k.id, place]))
  const shown = shownBoss(view, world)
  return [...view.enemies]
    .sort((a, b) => (slot.get(a.id) ?? 9) - (slot.get(b.id) ?? 9))
    .map((e) => {
      const hp = e.kind === 'world_boss' && shown ? shown.shownHp : e.hp
      const maxHp = e.kind === 'world_boss' && shown ? shown.boss.maxHp : e.maxHp
      return { name: e.name, hp, maxHp, boss: e.kind !== 'wave' }
    })
}

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
  const list = enemies(input).slice(0, 3)
  const inner = ENEMY_COLUMNS - 2
  const lines: Line[] = list.map((e) => ({ spans: [pad(1), ...enemyRow(e, inner - 2), pad(1)] }))
  const alt = `${title}. ${list.map((e) => `${e.name} ${e.hp} of ${e.maxHp} HP`).join(', ') || 'No enemies'}.`
  return {
    win: {
      key: 'enemy',
      x,
      columns: ENEMY_COLUMNS,
      rows: STRIP_ROWS,
      title: [text(title)],
      lines,
      alt,
    },
    hotspots: [],
    slots: [],
  }
}

/**
 * The command line `▶Party Loot World … ▾` in `n` cells, and where its words sit (cell offsets).
 * `n` null: the short form, `▾` right after World (compact's footer, which must leave its border).
 */
function commandLine(
  tab: BandTab,
  n: number | null,
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
  spans.push(pad(n === null ? 1 : Math.max(1, n - width(spans) - 1) - 1))
  at.push({ hotkey: 'c', label: '▾', x: width(spans) })
  spans.push(text('▾'))
  return { spans, at }
}

/** The tab's two rows under the command line, each a Line, in `n` cells. */
function tabRows(input: StripInput, n: number, at = input.now): Line[] {
  const { view, world, tab } = input
  if (tab === 'loot') {
    const loot = view.loot.slice(-2)
    if (loot.length === 0) return [{ spans: [text(padTo('No loot yet', n), DIM_RGB)] }]
    // A loot line opens with its glyph; the font lacks the hero ones (♞ ✶ ✚ ➶): drop those.
    const shown = (t: string) => {
      const [first, second] = chars(t)
      const bare = first && drawable(first) === '?' && first !== '?' && second === ' '
      return bare ? chars(t).slice(2).join('') : t
    }
    return loot.map((l) => ({
      spans: [text(padTo(clip(shown(l.text), n), n), RARITY_RGB[l.rarity] ?? TEXT_RGB)],
    }))
  }
  if (tab === 'world') {
    const [presence, , chat] = worldRows(view, world, at)
    const records = `highest zone ${view.highestZone} · kills ${view.kills} · wipes ${view.wipes}${view.farm ? ' · farming' : ''}`
    const second = chat && !chat.dim ? chat.text : records
    return [
      { spans: [text(clip(presence?.text ?? '', n), presence?.dim ? DIM_RGB : TEXT_RGB)] },
      { spans: [text(clip(second, n))] },
    ]
  }
  // Party: the log's newest two rows, a long line wrapped over both, the newest typing.
  const rows: Line[] = []
  for (const l of input.log.shown(at, input.motion)) {
    let left = l.revealed
    for (const row of wrap(l.text, n)) {
      const len = chars(row).length
      const reveal = Math.max(0, Math.min(len, left))
      left -= len + 1
      rows.push({ spans: [text(row, l.rgb)], ...(reveal < len ? { reveal } : {}) })
    }
  }
  return rows.slice(-2)
}

function messageLines(input: StripInput, columns: number, at = input.now): Line[] {
  const inner = columns - 2
  const n = inner - 2
  const cmd = commandLine(input.tab, n)
  const rows = tabRows(input, n, at).map((l) => ({ ...l, spans: [pad(1), ...l.spans] }))
  while (rows.length < 2) rows.push({ spans: [] })
  if (input.notice) rows[1] = { spans: [pad(1), text(clip(input.notice, n))] }
  return [{ spans: [pad(1), ...cmd.spans] }, ...rows]
}

function messageWindow(input: StripInput, x: number, columns: number): Built {
  const n = columns - 4
  const cmd = commandLine(input.tab, n)
  const lines = messageLines(input, columns)
  const hotspots = cmd.at.map((c) => ({
    hotkey: c.hotkey,
    label: c.label,
    x: x + 2 + c.x,
    y: 1,
    columns: c.hotkey === 'c' ? 1 : chars(c.label).length + 1,
  }))
  const shown = lines
    .slice(1)
    .map((l) =>
      l.spans
        .map((s) => ('text' in s ? s.text : ''))
        .join('')
        .trim(),
    )
    .filter(Boolean)
  const alt = `${input.tab[0]?.toUpperCase()}${input.tab.slice(1)} tab. ${shown.join(' ')}`.trim()
  return { win: { key: 'message', x, columns, rows: STRIP_ROWS, lines, alt }, hotspots, slots: [] }
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
  }
}

function purseWindow(input: StripInput, x: number): Built {
  const gold = clip(`${formatCount(input.view.gold)}G`, 9)
  const tactics = input.view.farm ? 'Farm here' : 'Push on'
  // The sandbox mark takes the tactics line; farming moves to the title, and `f` still toggles.
  const sandbox = input.view.account.sandbox
  const lines: Line[] = [
    { spans: [pad(1), text(gold)] },
    { spans: [pad(1), text(sandbox ? 'Sandbox' : tactics)] },
  ]
  const alt = `Gold ${formatCount(input.view.gold)}.${sandbox ? ' Sandbox.' : ''} Tactics: ${tactics.toLowerCase()}.`
  return {
    win: {
      key: 'purse',
      x,
      columns: PURSE_COLUMNS,
      rows: STRIP_ROWS,
      ...(sandbox && input.view.farm ? { title: [text('Farm')] } : {}),
      lines,
      alt,
    },
    hotspots: [{ hotkey: 'f', label: tactics, x: x + 2, y: 2, columns: 9 }],
    slots: [],
  }
}

function compactWindow(input: StripInput, x: number, columns: number): Built {
  const { view } = input
  const inner = columns - 2
  const wave = view.wave >= 11 ? 'Boss' : `W${view.wave}`
  let title = `Z${view.zone} · ${wave} · ${formatCount(view.gold)}G`
  if (view.farm && chars(`${title} · Farm`).length <= inner - 3) title = `${title} · Farm`
  const acting = input.timeline.acting(input.now)
  const lines: Line[] = []
  const slots: Slots[] = []
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
    const gauge = { line: lines.length, span: spans.length }
    spans.push({ bar: g.fill, cells: rest - hpBar, rgb: g.rgb })
    slots.push({ hero: h, cursor: { line: lines.length, span: 1 }, gauge })
    lines.push({ spans })
  }
  const front = enemies(input)[0]
  if (input.notice) lines[3] = { spans: [pad(1), text(clip(input.notice, inner - 2))] }
  else if (front) lines[3] = { spans: [pad(1), ...enemyRow(front, Math.min(inner - 2, 27))] }
  const cmd = commandLine(input.tab, null)
  const hotspots: Hotspot[] = cmd.at.map((c) => ({
    hotkey: c.hotkey,
    label: c.label,
    x: x + 2 + c.x,
    y: COMPACT_WINDOW_ROWS - 1,
    columns: c.hotkey === 'c' ? 1 : chars(c.label).length + 1,
  }))
  hotspots.push({ hotkey: 'f', label: title, x: x + 2, y: 0, columns: chars(title).length })
  const alt = `${title}. Party: ${view.heroes.map((h) => heroAlt(input, h)).join('; ')}.${front ? ` Front enemy ${front.name} ${front.hp} of ${front.maxHp} HP.` : ''}`
  return {
    win: {
      key: 'compact',
      x,
      columns,
      rows: COMPACT_WINDOW_ROWS,
      title: [text(title)],
      footer: cmd.spans,
      lines,
      alt,
    },
    hotspots,
    slots,
  }
}

function build(input: StripInput): { scene: Scene; built: Built[] } {
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
    }
  }
  const withEnemy = input.kind === 'full' || columns >= FULL_MIN
  const message = columns - (withEnemy ? ENEMY_COLUMNS : 0) - PARTY_COLUMNS - PURSE_COLUMNS
  const built: Built[] = []
  let x = 0
  if (withEnemy) {
    built.push(enemyWindow(input, x))
    x += ENEMY_COLUMNS
  }
  built.push(messageWindow(input, x, message))
  x += message
  built.push(partyWindow(input, x))
  x += PARTY_COLUMNS
  built.push(purseWindow(input, x))
  const windows = built.map((b) => b.win)
  return {
    scene: { columns, rows: STRIP_ROWS, windows, alt: windows.map((w) => w.alt).join(' ') },
    built,
  }
}

export function stripScene(input: StripInput): { scene: Scene; hotspots: readonly Hotspot[] } {
  const { scene, built } = build(input)
  return { scene, hotspots: built.flatMap((b) => b.hotspots) }
}

/** The desktop's motion over the next `horizonMs`: gauges, the ▶, the message window's lines. */
export function stripTracks(input: StripInput, horizonMs: number): Track[] {
  const { built } = build(input)
  const tracks: Track[] = []
  const now = input.now
  const actions = input.timeline.actions()
  for (const b of built) {
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
      // A notice holds the typing row, and motion still shows lines whole: no typing then.
      const types = input.motion !== 'still' && !input.notice
      const width = b.win.columns - 4
      const lastRow = (text: string, revealed: number) => {
        // Cells of the line's last row already shown: its leading gap, then what typed into it.
        const rows = wrap(text, width)
        const before = rows.slice(0, -1).reduce((k, r) => k + chars(r).length + 1, 0)
        return 1 + Math.max(0, revealed - before)
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
