import type { GameView, WorldState } from '../../types'
import { PAUSED_LINE } from '../engine'
import {
  CHAT_BUCKET_CAPACITY,
  CHAT_MAX_CHARS,
  CHAT_REFILL_MS,
  type ChatRefusal,
  type MarketRefusal,
} from '../vendor/protocol.js'
import { gates } from '../view'

/** A merge-updater over one atom, written at the hook. */
export type Updater<T> = (fn: (current: T) => T) => Promise<void>
export type After = (ms: number, fn: () => void) => void

export const GATE_CLOSED = 'The market is closed.'
export const GATE_UNLINKED = 'Link your GitHub account: press a for the Account tab'
export const GATE_CHAT_CLOSED = 'Chat is closed.'
/** The in-process ledger has nobody to talk to: say how to reach a server. */
export const GATE_CHAT_LOCAL = 'Chat needs a server: /promptfall server <url>'
export const GATE_BOARDS_CLOSED = 'Leaderboards are closed.'
const ERROR_MS = 5000

/** Why this player cannot trade right now, or null: shown in place of the trade buttons. */
export function gateLine(view: GameView, world: WorldState | null): string | null {
  if (!gates(world, view.account).marketOpen) return GATE_CLOSED
  if (!view.account.linked) return GATE_UNLINKED
  return null
}

/** One line per refusal; the rest in the spec's words. */
export function refusalText(reason: MarketRefusal, remaining?: string): string {
  switch (reason) {
    case 'not_enough_gold':
      return 'Not enough gold'
    case 'no_space':
      return 'No free slot'
    case 'buyer_full':
      return "The buyer's inventory is full"
    case 'in_cooldown':
      return remaining ? `Tradeable in ${remaining}` : 'Not tradeable yet'
    // The listing or order closed before the call: a buy another buyer won, a cancel after a sale,
    // a fill or an expiry. The bare token read as goods lost (#186).
    case 'gone':
      return 'Already sold, filled or expired: the log says which'
    default:
      return reason.replaceAll('_', ' ')
  }
}

/** One line per chat refusal; the numbers come from the protocol. */
export function chatRefusalText(reason: ChatRefusal): string {
  switch (reason) {
    case 'too_long':
      return `Too long: ${CHAT_MAX_CHARS} characters at most`
    case 'rate_limited':
      return `Slow down: ${CHAT_BUCKET_CAPACITY} quick messages, then one every ${CHAT_REFILL_MS / 1000} seconds`
    case 'blocked':
      return 'That word is not allowed here'
    case 'empty':
      return 'Nothing to send'
    case 'not_linked':
      return GATE_UNLINKED
    case 'chat_closed':
      return GATE_CHAT_CLOSED
    case 'unauthorized':
      return 'Session expired: /promptfall server <url> again'
  }
}

/** A thrown market call, in words. */
export function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (message === 'paused') return PAUSED_LINE
  if (message === 'not_primary' || message === 'not_started') return 'Playing in another session'
  if (message === 'unreachable') return 'Server unreachable'
  return message
}

/** Shows `text` in red for 5 seconds, as the pane notice does. */
export async function flash<T extends { error: string | null }>(
  upd: Updater<T>,
  after: After,
  text: string,
): Promise<void> {
  await upd((s) => ({ ...s, error: text }))
  after(ERROR_MS, () => {
    void upd((s) => (s.error === text ? { ...s, error: null } : s))
  })
}
