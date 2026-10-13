// The World tab's rows and the boss's status segment: pure, shared by the band and the window
// strip (hooks/ui/strip.ts), so the strip and the golden script need no engine import.
import type { GameView, HuntView, WorldState } from '../../types'
import { IN_PROCESS } from '../server'
import { gates } from '../view'
import { zoneMark } from '../zone-words'
import { type ShownBoss, shownBoss } from './boss'
import { formatCount } from './format'
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

/** `3 days left`, `1 day left`, then `16h left` under a day; empty without a server clock. */
function daysLeft(hunt: HuntView, world: WorldState, now: number): string {
  if (!world.clock) return ''
  const ms = remainingRealMs(hunt.endsAt, world.clock, now)
  const days = Math.floor(ms / DAY_MS)
  if (days >= 2) return `, ${days} days left`
  if (days === 1) return ', 1 day left'
  return `, ${formatRemaining(ms)} left`
}

/** The hunt's segment, with its bar or without: `Hunt: casters ████░░░░ 12,400 / 20,000, 3 days left`. */
function huntSegment(hunt: HuntView, world: WorldState, now: number, bar: boolean): string {
  const filled =
    hunt.target > 0
      ? Math.min(HUNT_BAR_CELLS, Math.floor((hunt.count * HUNT_BAR_CELLS) / hunt.target))
      : 0
  const drawn = bar ? ` ${'█'.repeat(filled)}${'░'.repeat(HUNT_BAR_CELLS - filled)}` : ''
  return `Hunt: ${hunt.name}${drawn} ${formatCount(hunt.count)} / ${formatCount(hunt.target)}${daysLeft(hunt, world, now)}`
}

/**
 * The account's records with the week's hunt after the highest zone and the kills, then, with the
 * world boss or the hunt off by the server's flag, a note saying so in place: the World rows'
 * second row when no boss is up, and the strip's World tab's while chat is closed or quiet. In
 * `cells` the note goes first, then the hunt's bar, then the wipes, then the hunt, so the highest
 * zone, the kills and the wipes stay whole.
 */
export function recordsRow(
  view: GameView,
  world: WorldState,
  cells = Number.POSITIVE_INFINITY,
  now = 0,
): string {
  const head = `highest zone ${zoneMark(view.highestZone)} · kills ${view.kills}`
  const tail = `wipes ${view.wipes}${view.farm ? ' · farming' : ''}`
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
  const noted = note ? [note] : []
  const candidates: string[][] = []
  if (hunt) {
    const bar = huntSegment(hunt, world, now, true)
    const plain = huntSegment(hunt, world, now, false)
    candidates.push(
      [head, bar, tail, ...noted],
      [head, bar, tail],
      [head, plain, tail, ...noted],
      [head, plain, tail],
      [head, plain],
    )
  }
  candidates.push([head, tail, ...noted], [head, tail])
  const rows = candidates.map((parts) => parts.join(' · '))
  return rows.find((row) => [...row].length <= cells) ?? `${head} · ${tail}`
}

/**
 * The World tab's three rows: who is around, the account's records or the boss, the chat ticker.
 * `view` is the staged state, so the boss's bar drops as the hits land.
 */
export function worldRows(
  view: GameView,
  world: WorldState,
  now = 0,
): { text: string; dim: boolean }[] {
  const open = gates(world, view.account)
  const snapshot = world.snapshot
  let presence: { text: string; dim: boolean }
  if (!open.presenceOpen) presence = { text: 'presence is off', dim: true }
  else if (!snapshot) presence = { text: 'connecting to the world…', dim: true }
  else {
    const here = snapshot.here.length > 0 ? snapshot.here.join(', ') : 'nobody else here'
    presence = {
      text: `${snapshot.online} online · ${zoneMark(view.zone, 'zone ')}: ${here}`,
      dim: world.stale,
    }
  }
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
  const last = world.messages.at(-1)
  const chat = !open.chatOpen
    ? {
        text: view.account.server === IN_PROCESS ? 'chat needs a server' : 'chat is closed',
        dim: true,
      }
    : last
      ? { text: `${last.name}: ${last.text}`, dim: false }
      : { text: 'chat is quiet', dim: true }
  return [presence, { text: records, dim: false }, chat]
}
