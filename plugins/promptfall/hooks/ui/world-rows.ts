// The World tab's rows and the boss's status segment: pure, shared by the band and the window
// strip (hooks/ui/strip.ts), so the strip and the golden script need no engine import.
import type { GameView, WorldState } from '../../types'
import { IN_PROCESS } from '../server'
import { gates } from '../view'
import { type ShownBoss, shownBoss } from './boss'
import { formatCount } from './format'
import { formatRemaining, remainingRealMs } from './time'

const BOSS_BAR_CELLS = 8

function pctOf(shown: ShownBoss): number {
  return shown.boss.maxHp > 0 ? Math.floor((shown.shownHp * 100) / shown.boss.maxHp) : 0
}

function remainingOf(shown: ShownBoss, world: WorldState, now: number): string {
  if (!world.clock) return ''
  return formatRemaining(remainingRealMs(shown.boss.endsAt, world.clock, now))
}

/**
 * The account's records, then, with the world boss off by the server's flag, a note saying so in
 * place: the World rows' second row when no boss is up, and the strip's World tab's while chat is
 * closed or quiet. The note goes when the row has under `cells` for it, so the records stay whole.
 */
export function recordsRow(
  view: GameView,
  world: WorldState,
  cells = Number.POSITIVE_INFINITY,
): string {
  const records = `highest zone ${view.highestZone} · kills ${view.kills} · wipes ${view.wipes}${view.farm ? ' · farming' : ''}`
  if (gates(world, view.account).bossOpen) return records
  const noted = `${records} · world boss is off`
  return [...noted].length <= cells ? noted : records
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
    presence = { text: `${snapshot.online} online · zone ${view.zone}: ${here}`, dim: world.stale }
  }
  const shown = shownBoss(view, world)
  let records = recordsRow(view, world)
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
