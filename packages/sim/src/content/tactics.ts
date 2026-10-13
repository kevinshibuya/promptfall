import type { HeroClass } from '../types'
import { enemies } from './enemies'
import type { Archetype, BossMove, Tactic, Tactics, TargetRule } from './types'

// The picker's rules (grill 1.10). A later skill or technique is a new entry here, not new code.

/** A knight weighs 11 against 2 for any other hero: 11/15 ≈ 73% with a full party, today's pull. */
const KNIGHT_PULL: TargetRule = { kind: 'class', cls: 'knight', match: 11, other: 2 }

const ENEMY_ATTACK: Tactic[] = [
  { action: 'attack', weight: { kind: 'fixed', weight: 10 }, target: KNIGHT_PULL },
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

/**
 * A zone boss's tactics by its move (#169). Rage is no action: it attacks as any enemy, and its
 * hits read its HP.
 */
const MOVE_TACTICS: Record<BossMove, Tactic[]> = {
  strike_twice: [
    { action: 'attack_twice', weight: { kind: 'fixed', weight: 10 }, target: KNIGHT_PULL },
  ],
  // Weighted by need as the White Mage's heal is, on its own HP share.
  heal_self: [
    ...ENEMY_ATTACK,
    {
      action: 'heal',
      weight: { kind: 'self_need', belowBp: 5000, scale: 30 },
      target: { kind: 'self' },
    },
  ],
  hit_all: [
    { action: 'attack_all', weight: { kind: 'fixed', weight: 10 }, target: { kind: 'none' } },
  ],
  rage: ENEMY_ATTACK,
}

/** Keyed by enemy definition: each zone boss's move's tactics. */
export const enemyDefTactics: Record<string, Tactic[]> = Object.fromEntries(
  Object.values(enemies).flatMap((def) => (def.move ? [[def.id, MOVE_TACTICS[def.move]]] : [])),
)

export const tactics: Tactics = {
  heroes: heroTactics,
  enemies: enemyTactics,
  byEnemy: enemyDefTactics,
}
