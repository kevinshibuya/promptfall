// The World tab's rows and the boss's status segment: pure, shared by the band and the window
// strip (hooks/ui/strip.ts), so the strip and the golden script need no engine import.
import type { GameView, HuntView, WorldState } from '../../types'
import { IN_PROCESS } from '../server'
import { gates } from '../view'
import { zoneMark } from '../zone-words'
import { type ShownBoss, shownBoss } from './boss'
import { clip, formatCount } from './format'
import { formatRemaining, remainingRealMs } from './time'

const BOSS_BAR_CELLS = 8
const HUNT_BAR_CELLS = 8
const DAY_MS = 86_400_000

function pctOf(shown: ShownBoss): number {
  return shown.boss.maxHp > 0 ? Math.floor((shown.shownHp * 100) / shown.boss.maxHp) : 0
}

function remainingOf(shown: ShownBoss, world: WorldState, now: number): string {
  if (!world.clock) return ''
  return formatRemaining(remainingRealMs(shown.boss.endsAt, world.clock, now))
}

/** `, 3 days left`, `, 1 day left`, then `, 16h left` under a day; `3d` or `16h` short; empty without a clock. */
function timeLeft(hunt: HuntView, world: WorldState, now: number, short: boolean): string {
  if (!world.clock) return ''
  const ms = remainingRealMs(hunt.endsAt, world.clock, now)
  const days = Math.floor(ms / DAY_MS)
  if (short) return ` ${days >= 1 ? `${days}d` : formatRemaining(ms)}`
  if (days >= 2) return `, ${days} days left`
  if (days === 1) return ', 1 day left'
  return `, ${formatRemaining(ms)} left`
}

/** 184, `12.4k`, `1.2M`, floored; `tight` drops the decimal: `12k`. */
function shortCount(n: number, tight = false): string {
  const [unit, by] = n >= 1_000_000 ? ['M', 1_000_000] : n >= 1000 ? ['k', 1000] : ['', 1]
  if (by === 1) return String(n)
  const tenths = Math.floor((n * 10) / by)
  const whole = Math.floor(tenths / 10)
  return tight || tenths % 10 === 0 ? `${whole}${unit}` : `${whole}.${tenths % 10}${unit}`
}

/** How far the hunt's segment is shortened: the counts, then the time and the label, then the bar. */
type HuntForm = { counts: 'full' | 'short' | 'tight'; short: boolean; bar: number }

/** The hunt's segment, `Hunt: casters ████░░░░ 12,400 / 20,000, 3 days left` at its longest. */
function huntSegment(hunt: HuntView, world: WorldState, now: number, form: HuntForm): string {
  const filled =
    hunt.target > 0 ? Math.min(form.bar, Math.floor((hunt.count * form.bar) / hunt.target)) : 0
  const drawn = form.bar > 0 ? ` ${'█'.repeat(filled)}${'░'.repeat(form.bar - filled)}` : ''
  const counts =
    form.counts === 'full'
      ? `${formatCount(hunt.count)} / ${formatCount(hunt.target)}`
      : form.counts === 'short'
        ? `${shortCount(hunt.count)} / ${shortCount(hunt.target)}`
        : `${shortCount(hunt.count, true)}/${shortCount(hunt.target, true)}`
  const label = form.short ? `Hunt ${hunt.name}` : `Hunt: ${hunt.name}`
  return `${label}${drawn} ${counts}${timeLeft(hunt, world, now, form.short)}`
}

/**
 * The account's records with the week's hunt after the highest zone and the kills, then, with the
 * world boss or the hunt off by the server's flag, a note saying so: the World tab's records row.
 * In `cells` the hunt's counts shorten first, then its time, then the records (`Z9 K184 W90`),
 * then the bar to 4 cells; then the counts tighten and the bar goes to keep the short records;
 * then the records go and the bar comes back at 4 cells, then the bar goes, then the hunt. The
 * note is never dropped while it fits alone.
 */
export function recordsRow(
  view: GameView,
  world: WorldState,
  cells = Number.POSITIVE_INFINITY,
  now = 0,
): string {
  const head = `highest zone ${zoneMark(view.highestZone)} · kills ${view.kills}`
  const tail = `wipes ${view.wipes}${view.farm ? ' · staying' : ''}`
  const short = `${zoneMark(view.highestZone, 'Z')} K${shortCount(view.kills)} W${shortCount(view.wipes)}`
  const open = gates(world, view.account)
  const hunt = open.huntOpen ? (world.snapshot?.hunt ?? null) : null
  const note =
    !open.bossOpen && !open.huntOpen
      ? 'world boss and hunt are off'
      : !open.bossOpen
        ? 'world boss is off'
        : !open.huntOpen
          ? 'hunt is off'
          : null
  const candidates: string[][] = []
  if (hunt) {
    const seg = (counts: HuntForm['counts'], short: boolean, bar: number) =>
      huntSegment(hunt, world, now, { counts, short, bar })
    candidates.push(
      [head, seg('full', false, HUNT_BAR_CELLS), tail],
      [head, seg('short', false, HUNT_BAR_CELLS), tail],
      [head, seg('short', true, HUNT_BAR_CELLS), tail],
      [short, seg('short', true, HUNT_BAR_CELLS)],
      [short, seg('short', true, HUNT_BAR_CELLS / 2)],
      [short, seg('tight', true, 0)],
      [seg('short', true, HUNT_BAR_CELLS / 2)],
      [seg('tight', true, HUNT_BAR_CELLS / 2)],
      [seg('tight', true, 0)],
    )
  }
  candidates.push([head, tail], [short])
  const rows = candidates.map((parts) => [...parts, ...(note ? [note] : [])].join(' · '))
  if (note) rows.push(note)
  const fits = rows.find((row) => [...row].length <= cells)
  return fits ?? clip(rows.at(-1) ?? '', cells)
}

/** One World row: its text and whether it is drawn dim. */
export type WorldRow = { text: string; dim: boolean }

/**
 * Presence as the command line fits it: its candidates longest first, each a list of parts the
 * line separates with a dim `·` (the names, then the zone, then `online` go, the count stays), or
 * a gated text alone.
 */
export type Presence = { parts: string[][]; dim: boolean }

function presenceOf(view: GameView, world: WorldState): Presence {
  const open = gates(world, view.account)
  const snapshot = world.snapshot
  if (!open.presenceOpen) return { parts: [['presence is off']], dim: true }
  if (!snapshot) return { parts: [['connecting to the world…']], dim: true }
  const here = snapshot.here.length > 0 ? snapshot.here.join(', ') : 'nobody else here'
  const online = `${snapshot.online} online`
  const zone = zoneMark(view.zone, 'zone ')
  return {
    parts: [[online, `${zone}: ${here}`], [online, zone], [online], [String(snapshot.online)]],
    dim: world.stale,
  }
}

function chatOf(view: GameView, world: WorldState): WorldRow {
  const last = world.messages.at(-1)
  if (!gates(world, view.account).chatOpen)
    return {
      text: view.account.server === IN_PROCESS ? 'chat needs a server' : 'chat is closed',
      dim: true,
    }
  return last
    ? { text: `${last.name}: ${last.text}`, dim: false }
    : { text: 'chat is quiet', dim: true }
}

/**
 * The World tab's rows in `rows` rows of `cells` cells. Two, in the full band: the records row,
 * then chat, with presence for the command line. Four, in the compact band: presence, the records
 * row, chat and a blank row. A chat message longer than its row is cut with an ellipsis: the row
 * is fixed, and the pane's Chat tab shows it whole.
 */
export function worldTabRows(
  view: GameView,
  world: WorldState,
  rows: 2 | 4,
  cells: number,
  now = 0,
): { rows: WorldRow[]; presence: Presence | null } {
  const records = { text: recordsRow(view, world, cells, now), dim: false }
  const said = chatOf(view, world)
  const chat = { ...said, text: clip(said.text, cells) }
  const presence = presenceOf(view, world)
  if (rows === 2) return { rows: [records, chat], presence }
  const fitted =
    presence.parts.map((p) => p.join(' · ')).find((t) => [...t].length <= cells) ??
    clip(presence.parts.at(-1)?.join(' · ') ?? '', cells)
  return {
    rows: [{ text: fitted, dim: presence.dim }, records, chat, { text: '', dim: false }],
    presence: null,
  }
}

/**
 * The World tab's three rows: who is around, the account's records or the boss, the chat ticker.
 * `view` is the staged state, so the boss's bar drops as the hits land.
 */
export function worldRows(view: GameView, world: WorldState, now = 0): WorldRow[] {
  const seen = presenceOf(view, world)
  const presence = { text: seen.parts[0]?.join(' · ') ?? '', dim: seen.dim }
  const shown = shownBoss(view, world)
  let records = recordsRow(view, world, Number.POSITIVE_INFINITY, now)
  if (shown && shown.boss.hp > 0) {
    const max = shown.boss.maxHp
    const filled =
      max > 0 ? Math.min(BOSS_BAR_CELLS, Math.ceil((shown.shownHp * BOSS_BAR_CELLS) / max)) : 0
    const bar = '█'.repeat(filled) + '░'.repeat(BOSS_BAR_CELLS - filled)
    records = `World boss ${shown.boss.name} ${bar} ${pctOf(shown)}% · ${remainingOf(shown, world, now)} left · you ${formatCount(shown.dealt)}`
  } else if (shown) {
    records = `${shown.boss.name} is down · you ${formatCount(shown.dealt)}`
  }
  const chat = chatOf(view, world)
  return [presence, { text: records, dim: false }, chat]
}
