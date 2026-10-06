import type { BoardsState, GameView, WorldState } from '../../types'
import type { GameHandle } from '../engine'
import { gates } from '../view'
import { type After, errorText, flash, type Updater } from './trade'

/** Fetches the boards; the zone counts come from the world snapshot, never fetched here. */
export async function loadBoards(
  game: GameHandle,
  upd: Updater<BoardsState>,
  after: After,
): Promise<void> {
  await upd((s) => ({ ...s, busy: true }))
  try {
    const r = await game.leaderboards()
    if ('reason' in r) throw new Error('Session expired: /promptfall server <url> again')
    await upd((s) => ({ ...s, boards: r, busy: false }))
  } catch (error) {
    await upd((s) => ({ ...s, busy: false }))
    await flash(upd, after, errorText(error))
  }
}

export function onlineLine(view: GameView, world: WorldState | null): string {
  if (!gates(world, view.account).presenceOpen) return 'presence is off'
  const snapshot = world?.snapshot
  if (!snapshot) return 'connecting to the world…'
  if (snapshot.zones.length === 0) return 'nobody online'
  return `Online by zone: ${snapshot.zones.map((z) => `z${z.zone} ${z.count}`).join(' · ')}`
}
