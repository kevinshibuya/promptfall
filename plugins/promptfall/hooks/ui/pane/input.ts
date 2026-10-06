// What every pane builder reads (Inventory, Heroes, the sell window), and the message window's
// first four rules (docs/plans/2026-10-06-ui-pr2-pane-windows.md, "Message window").
import type { DialogState, GameView, Mode, WorldState } from '../../../types'
import type { Span } from '../../windows/kit'
import { DOWN_RGB, TEXT_RGB, WARN_RGB } from '../../windows/tuning'
import { paneLayout } from './frame'

export type PaneInput = {
  tab: 'inventory' | 'heroes'
  view: GameView
  dialog: DialogState
  mode: Mode
  readOnly: boolean
  notice: string | null
  world: WorldState | null
  /** A game handle exists: Sell needs one. */
  running: boolean
  /** The picture's columns and rows (at most PANE_MAX_COLUMNS × PANE_ROWS). */
  columns: number
  rows: number
  /** Pixel encoders draw sprites; false on raster. */
  art: boolean
  /** The surface has an Input (the sell price). */
  hasInput: boolean
  remainingMs: (deadline: number) => number
}

/** Why the view is read-only, as the dialog's header says it. */
export function readOnlyReason(mode: Mode, notice: string | null): string {
  if (mode === 'secondary') return 'Playing in another session: this view is read-only.'
  if (mode === 'paused') return notice ?? 'Promptfall is paused.'
  return notice ?? 'Promptfall is not playing in this session.'
}

const line = (text: string, rgb: number = TEXT_RGB): Span[] => (text ? [{ text, rgb }] : [])

/** The message window's two lines: rules 1 to 4 here; `state` carries the caller's rule 5 to 10 lines. */
export function messageLines(input: PaneInput, state: [string, string]): [Span[], Span[]] {
  if (paneLayout(input.columns, input.rows).kind === 'small')
    return [line('The pane needs more room.'), line('Widen it or give it more rows.')]
  if (input.readOnly) {
    return [
      line(readOnlyReason(input.mode, input.notice), WARN_RGB),
      line(input.mode === 'secondary' ? 'p: play here.' : ''),
    ]
  }
  if (input.dialog.paneNotice)
    return [line(`Refused: ${input.dialog.paneNotice}`, DOWN_RGB), line(state[1])]
  if (input.dialog.sell?.error) return [line(input.dialog.sell.error, DOWN_RGB), line(state[1])]
  return [line(state[0]), line(state[1])]
}
