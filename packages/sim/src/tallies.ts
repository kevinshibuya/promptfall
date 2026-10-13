import type { Enemy, GameState, Rarity, RarityCounts, Tallies } from './types'

// The tallies count on a draft state: each helper is called where play does the thing it counts.

export function noRarities(): RarityCounts {
  return { common: 0, uncommon: 0, rare: 0, epic: 0, legendary: 0 }
}

export function emptyTallies(): Tallies {
  return {
    enemies: {},
    collection: {},
    zoneBosses: 0,
    cleanZoneBosses: 0,
    turnBosses: 0,
    drops: noRarities(),
    recruits: noRarities(),
    reforges: 0,
    goldEarned: 0,
  }
}

function bestiaryRow(s: GameState, def: string): { seen: number; defeated: number } {
  const row = s.tallies.enemies[def] ?? { seen: 0, defeated: 0 }
  s.tallies.enemies[def] = row
  return row
}

export function tallySeen(s: GameState, def: string): void {
  bestiaryRow(s, def).seen += 1
}

/** A kill: its definition's defeated count, and the boss count of its kind. Read before the kill resets the zone. */
export function tallyKill(s: GameState, enemy: Enemy): void {
  bestiaryRow(s, enemy.def).defeated += 1
  if (enemy.kind === 'zone_boss') {
    s.tallies.zoneBosses += 1
    if (s.zoneWipes === 0) s.tallies.cleanZoneBosses += 1
  } else if (enemy.kind === 'turn_boss') s.tallies.turnBosses += 1
}

/** Marks a base held at a rarity in the collection. */
export function markHeld(s: GameState, base: string, rarity: Rarity): void {
  const marks = s.tallies.collection[base] ?? noRarities()
  marks[rarity] = 1
  s.tallies.collection[base] = marks
}

/** A drop the party found, kept or vendored on pickup. */
export function tallyDrop(s: GameState, base: string, rarity: Rarity): void {
  markHeld(s, base, rarity)
  s.tallies.drops[rarity] += 1
}

/** Gold earned: added to the purse and to the tally together. */
export function earn(s: GameState, gold: number): void {
  s.gold += gold
  s.tallies.goldEarned += gold
}
