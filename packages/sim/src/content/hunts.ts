import type { GameState } from '../types'
import { enemies } from './enemies'
import type { HuntKind, HuntRow } from './types'

/**
 * The weekly hunts, one a week in turn (`huntAt`). A wave archetype's target is about a fifth of
 * a busy server's week of that archetype's kills; the zone bosses' is in the same proportion to
 * the kills a zone boss takes. Data no sim rule reads: the ledger counts it and pays it.
 */
export const hunts: HuntRow[] = [
  { id: 'casters', name: 'casters', kind: 'caster', target: 20_000 },
  { id: 'brutes', name: 'brutes', kind: 'brute', target: 20_000 },
  { id: 'zone_bosses', name: 'zone bosses', kind: 'zone_boss', target: 1_000 },
  { id: 'tanks', name: 'tanks', kind: 'tank', target: 20_000 },
  { id: 'swifts', name: 'swifts', kind: 'swift', target: 20_000 },
]

/** The hunt of a week, by its index from the epoch's week (`⌊weekStart / week⌋`). */
export function huntAt(week: number, table: readonly HuntRow[] = hunts): HuntRow {
  const row = table[((week % table.length) + table.length) % table.length]
  if (!row) throw new Error('the hunt table is empty')
  return row
}

/** What a state has counted toward a hunt of this kind: the archetype's defeated counts summed, or the zone bosses. */
export function huntCount(kind: HuntKind, state: GameState): number {
  if (kind === 'zone_boss') return state.tallies.zoneBosses
  let sum = 0
  for (const [def, row] of Object.entries(state.tallies.enemies)) {
    if (enemies[def]?.archetype === kind) sum += row.defeated
  }
  return sum
}
