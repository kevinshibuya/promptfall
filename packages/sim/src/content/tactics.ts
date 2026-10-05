import type { HeroClass } from '../types'
import type { Archetype, Tactic, Tactics } from './types'

// The picker's rules (grill 1.10). A later skill or technique is a new entry here, not new code.

const ENEMY_ATTACK: Tactic[] = [
  // A knight weighs 11 against 2 for any other hero: 11/15 ≈ 73% with a full party, today's pull.
  {
    action: 'attack',
    weight: { kind: 'fixed', weight: 10 },
    target: { kind: 'class', cls: 'knight', match: 11, other: 2 },
  },
]

export const heroTactics: Record<HeroClass, Tactic[]> = {
  knight: [
    {
      action: 'attack',
      weight: { kind: 'fixed', weight: 10 },
      target: { kind: 'front', front: 3, other: 1 },
    },
  ],
  black_mage: [
    { action: 'attack_all', weight: { kind: 'fixed', weight: 10 }, target: { kind: 'none' } },
  ],
  white_mage: [
    {
      action: 'attack',
      weight: { kind: 'fixed', weight: 10 },
      target: { kind: 'weakest', weakest: 1, other: 0 },
    },
    // Alone she only fights: healing herself could outlast the enemy forever.
    {
      action: 'heal',
      weight: { kind: 'ally_need', belowBp: 5000, scale: 30 },
      target: { kind: 'ally_lowest' },
      minAllies: 2,
    },
  ],
  archer: [
    {
      action: 'attack',
      weight: { kind: 'fixed', weight: 10 },
      target: { kind: 'weakest', weakest: 4, other: 1 },
    },
  ],
}

/** Keyed by enemy archetype (grill 1.10), plus the world boss. All share one table for now. */
export const enemyTactics: Record<Archetype | 'world_boss', Tactic[]> = {
  brute: ENEMY_ATTACK,
  swift: ENEMY_ATTACK,
  tank: ENEMY_ATTACK,
  caster: ENEMY_ATTACK,
  boss: ENEMY_ATTACK,
  turn_boss: ENEMY_ATTACK,
  world_boss: ENEMY_ATTACK,
}

export const tactics: Tactics = { heroes: heroTactics, enemies: enemyTactics }
