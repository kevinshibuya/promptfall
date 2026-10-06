import type { BoardRow, BoardsState, GameView, WorldState } from '../../types'
import type { GameHandle } from '../engine'
import { gates } from '../view'
import { type After, type Els, errorText, flash, GATE_BOARDS_CLOSED, type Updater } from './trade'

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

/** The Leaderboards tab: who is online by zone, the highest-zone board, this week's boss damage. */
export function boardsBody(els: Els, view: GameView, world: WorldState, boards: BoardsState) {
  const { Text } = els
  const body = []
  if (!gates(world, view.account).leaderboardsOpen) {
    body.push(
      <Text key="boards-gate" color="yellow" wrap="wrap">
        {GATE_BOARDS_CLOSED}
      </Text>,
    )
    return body
  }
  if (boards.error) {
    body.push(
      <Text key="boards-error" color="red" wrap="truncate">
        {boards.error}
      </Text>,
    )
  }
  body.push(
    <Text key="boards-online" wrap="truncate">
      {onlineLine(view, world)}
    </Text>,
  )
  if (boards.busy && !boards.boards) {
    body.push(
      <Text key="boards-loading" dimColor>
        loading…
      </Text>,
    )
    return body
  }
  const rows = (key: string, list: BoardRow[], value: (row: BoardRow) => string) =>
    list.map((row, i) => (
      <Text
        key={`${key}-${row.accountId}`}
        {...(row.accountId === view.accountId ? { color: 'cyan' } : {})}
        wrap="truncate"
      >
        {`${i + 1}. ${row.name}  ${value(row)}`}
      </Text>
    ))
  const highest = boards.boards?.highestZone ?? []
  const damage = boards.boards?.damage ?? []
  body.push(
    <Text key="boards-zone-head" bold>
      Highest zone
    </Text>,
    ...rows('zone', highest, (r) => `zone ${r.value}`),
    <Text key="boards-damage-head" bold>
      Boss damage this week
    </Text>,
  )
  if (damage.length === 0) {
    body.push(
      <Text key="boards-damage-empty" dimColor>
        no boss damage yet this week
      </Text>,
    )
  } else {
    body.push(...rows('damage', damage, (r) => String(r.value)))
  }
  return body
}
