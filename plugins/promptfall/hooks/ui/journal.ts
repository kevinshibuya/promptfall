import type { JournalState } from '../../types'
import type { GameHandle } from '../engine'
import type { RestDaysRefusal } from '../vendor/protocol.js'
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

/** A rest-days refusal in words. */
export function restDaysRefusalText(reason: RestDaysRefusal | 'unauthorized'): string {
  switch (reason) {
    case 'rest_days_count':
      return 'Pick two rest days'
    case 'rest_days_same':
      return 'Pick two different days'
    case 'rest_days_range':
      return 'Not a day of the week'
    case 'unauthorized':
      return 'Session expired: /promptfall server <url> again'
  }
}

/** Sends the rest days; the journal it answers replaces the slice's, a refusal flashes. */
export async function saveRestDays(
  game: GameHandle,
  days: number[],
  upd: Updater<JournalState>,
  after: After,
): Promise<void> {
  try {
    const r = await game.setRestDays(days)
    if (r.ok) await upd((s) => ({ ...s, journal: r.journal }))
    else await flash(upd, after, restDaysRefusalText(r.reason))
  } catch (error) {
    await flash(upd, after, errorText(error))
  }
}
