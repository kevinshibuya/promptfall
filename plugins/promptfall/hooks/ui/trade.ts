import type { Elements, RenderElement } from 'claude-code'
import type { GameView } from '../../types'
import type { MarketRefusal } from '../vendor/protocol.js'

export type Els = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button'> & {
  /** Absent on mobile: presets stand in for typed prices. */
  Input: Elements['terminal']['Input'] | undefined
}

/** A Select where the surface has one; one Button per option elsewhere. */
export type PickFn = (
  key: string,
  label: string,
  options: { value: string; label: string }[],
  onPick: (value: string) => Promise<void>,
  /** The option shown as picked. */
  value?: string,
) => RenderElement

/** A merge-updater over one atom, written at the hook. */
export type Updater<T> = (fn: (current: T) => T) => Promise<void>
export type After = (ms: number, fn: () => void) => void

export const GATE_CLOSED = 'The market is closed.'
export const GATE_UNLINKED = 'Link your GitHub account: press a for the Account tab'
const ERROR_MS = 5000

/** Why this player cannot trade right now, or null: shown in place of the trade buttons. */
export function gateLine(view: GameView): string | null {
  if (!view.account.marketOpen) return GATE_CLOSED
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
    case 'in_cooldown':
      return remaining ? `Tradeable in ${remaining}` : 'Not tradeable yet'
    default:
      return reason.replaceAll('_', ' ')
  }
}

/** A thrown market call, in words. */
export function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
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
