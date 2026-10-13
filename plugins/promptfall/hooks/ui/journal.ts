import type { JournalState } from '../../types'
import type { GameHandle } from '../engine'
import { type After, errorText, flash, type Updater } from './trade'

/** Fetches the journal, as the boards are fetched: the bestiary and the collection read the view. */
export async function loadJournal(
  game: GameHandle,
  upd: Updater<JournalState>,
  after: After,
): Promise<void> {
  await upd((s) => ({ ...s, busy: true }))
  try {
    const r = await game.journal()
    if ('reason' in r) throw new Error('Session expired: /promptfall server <url> again')
    await upd((s) => ({ ...s, journal: r, busy: false }))
  } catch (error) {
    await upd((s) => ({ ...s, busy: false }))
    await flash(upd, after, errorText(error))
  }
}
