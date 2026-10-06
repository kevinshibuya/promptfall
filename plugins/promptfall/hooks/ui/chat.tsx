import type { ChatState, GameView, WorldState } from '../../types'
import type { GameHandle } from '../engine'
import { IN_PROCESS } from '../server'
import { CHAT_MAX_CHARS } from '../vendor/protocol.js'
import { gates } from '../view'
import {
  type After,
  chatRefusalText,
  errorText,
  flash,
  GATE_CHAT_CLOSED,
  GATE_CHAT_LOCAL,
  GATE_UNLINKED,
  type Updater,
} from './trade'

export const CHAT_READ_ONLY = 'Posting needs a terminal or the desktop app.'

/** Posts a line: an empty one is refused here; on success the box empties. */
export async function postChat(
  game: GameHandle,
  text: string,
  upd: Updater<ChatState>,
  after: After,
): Promise<void> {
  // Judged here as the server judges it, so a paste past the wire limit is not a 400 read as an outage.
  const cleaned = text.replace(/\p{Cc}/gu, '').trim()
  if (cleaned === '') {
    await flash(upd, after, chatRefusalText('empty'))
    return
  }
  if (cleaned.length > CHAT_MAX_CHARS) {
    await flash(upd, after, chatRefusalText('too_long'))
    return
  }
  await upd((s) => ({ ...s, draft: text, busy: true }))
  try {
    // The cleaned text goes out: a padded paste can be long raw yet short once stripped.
    const r = await game.chat(cleaned)
    if (r.ok) {
      await upd((s) => ({ ...s, draft: '', busy: false }))
      return
    }
    await upd((s) => ({ ...s, busy: false }))
    await flash(upd, after, chatRefusalText(r.reason))
  } catch (error) {
    await upd((s) => ({ ...s, busy: false }))
    await flash(upd, after, errorText(error))
  }
}

/** Why this player cannot post, or null: chat closed (or local, with no server), or not linked. */
export function chatGate(view: GameView, world: WorldState | null): string | null {
  if (!gates(world, view.account).chatOpen)
    return view.account.server === IN_PROCESS ? GATE_CHAT_LOCAL : GATE_CHAT_CLOSED
  return view.account.linked ? null : GATE_UNLINKED
}
