// What every pane builder reads, and the message window's first four rules
// (docs/plans/2026-10-06-ui-pr2-pane-windows.md, "Message window"; PR 3's "Pane input").
import type {
  BoardsState,
  ChatState,
  DialogState,
  DialogTab,
  GameView,
  JournalState,
  MarketState,
  Mode,
  OrdersState,
  Renderer,
  Settings,
  WorldState,
} from '../../../types'
import type { Span } from '../../windows/kit'
import { DOWN_RGB, TEXT_RGB, WARN_RGB } from '../../windows/tuning'
import { paneLayout } from './frame'

/** What the frame reads: layout, the read-only rule, the dialog state, the tab. */
export type FrameInput = {
  tab: DialogTab
  dialog: DialogState
  mode: Mode
  readOnly: boolean
  /** This session paused for a ban: Account still offers the delete, the one verb it lets through. */
  banned?: boolean
  notice: string | null
  /** The picture's columns and rows (at most PANE_MAX_COLUMNS × PANE_ROWS). */
  columns: number
  rows: number
}

/** Machine and session facts the Account tab shows. */
export type AccountInput = {
  /** The server label: 'in-process' or the URL. */
  server: string
  leaseOwner: string | null
  settings: Settings
  /** The probe's verdict, for `auto (image)`. */
  renderer: Renderer
  /** prefs.collapsed */
  collapsed: boolean
  /** The session's mark: a play here was skipped, so no cue is tried. */
  soundSilent: boolean
}

export type PaneInput = FrameInput & {
  view: GameView
  world: WorldState | null
  /** A game handle exists: Sell needs one. */
  running: boolean
  /** Pixel encoders draw sprites; false on raster. */
  art: boolean
  /** The surface has an Input (the sell price, the order price, the chat line). */
  hasInput: boolean
  /** The surface has an Input, but the pane is too short for its row: `hasInput` is false. */
  shortPane?: true
  remainingMs: (deadline: number) => number
  /** The server's clock now as this session reckons it (the client's before any): the Journal's day. */
  serverNow: number
  market: MarketState
  orders: OrdersState
  chat: ChatState
  boards: BoardsState
  journal: JournalState
  account: AccountInput
}

/** A message line: plain text in TEXT_RGB, or spans (a gate line in WARN_RGB). */
export type MessageLine = string | Span[]

/** Why the view is read-only, as the dialog's header says it. */
export function readOnlyReason(mode: Mode, notice: string | null): string {
  if (mode === 'secondary') return 'Playing in another session: this view is read-only.'
  if (mode === 'paused') return notice ?? 'Promptfall is paused.'
  return notice ?? 'Promptfall is not playing in this session.'
}

const line = (text: MessageLine, rgb: number = TEXT_RGB): Span[] =>
  typeof text !== 'string' ? text : text ? [{ text, rgb }] : []

/**
 * The message window's two lines: rules 1 to 4 here (rule 4 is the tab's `error`, in red);
 * `state` carries the caller's lines for the rest.
 */
export function messageLines(
  input: FrameInput,
  error: string | null,
  state: [MessageLine, MessageLine],
): [Span[], Span[]] {
  if (paneLayout(input.columns, input.rows).kind === 'small')
    return [line('The pane needs more room.'), line('Widen it or give it more rows.')]
  if (input.readOnly) {
    // A refusal still shows under the reason: a banned session's delete can be refused.
    return [
      line(readOnlyReason(input.mode, input.notice), WARN_RGB),
      input.dialog.paneNotice
        ? line(`Refused: ${input.dialog.paneNotice}`, DOWN_RGB)
        : line(input.mode === 'secondary' ? 'p: play here.' : ''),
    ]
  }
  if (input.dialog.paneNotice)
    return [line(`Refused: ${input.dialog.paneNotice}`, DOWN_RGB), line(state[1])]
  if (error) return [line(error, DOWN_RGB), line(state[1])]
  return [line(state[0]), line(state[1])]
}
