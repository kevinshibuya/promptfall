import { fill, GUARD_TICKS, HASTE_BP, HASTE_TICKS } from './battle'
import { enemyStats } from './combat'
import { heroStats, onRest, partyHeroes } from './progression'
import type { Effect, Enemy, EnemyKind, GameState, Hero } from './types'

// The reactive events (spec #131). ADR 0014: each shapes the fight and never the reward.

/** A hero's gauge gained per step as the battle fills it: zero while guarding or camped, scaled while hasted. */
export function heroFill(s: GameState, hero: Hero): number {
  if (s.guardTicks > 0 || s.camp) return 0
  const base = fill(heroStats(s, hero).spd)
  return s.hasteTicks > 0 ? Math.max(1, Math.floor((base * HASTE_BP) / 10000)) : base
}

/** turn_start: Haste on for its whole countdown, a refresh when already on. */
export function onTurnStart(s: GameState, effects: Effect[]): void {
  if (s.hasteTicks === 0) effects.push({ k: 'haste', on: true })
  s.hasteTicks = HASTE_TICKS
}

export function stopHaste(s: GameState, effects: Effect[]): void {
  if (s.hasteTicks === 0) return
  s.hasteTicks = 0
  effects.push({ k: 'haste', on: false })
}

/** guard: on sets the countdown, off clears it; on while on and off while off change nothing. */
export function onGuard(s: GameState, on: boolean, effects: Effect[]): void {
  if (!on) stopGuard(s, effects)
  if (!on || s.guardTicks > 0) return
  s.guardTicks = GUARD_TICKS
  effects.push({ k: 'guard', on: true })
}

export function stopGuard(s: GameState, effects: Effect[]): void {
  if (s.guardTicks === 0) return
  s.guardTicks = 0
  effects.push({ k: 'guard', on: false })
}

/** The end of every tick: each countdown on loses a tick, and the one that reaches 0 ends. */
export function countDown(s: GameState, effects: Effect[]): void {
  if (s.hasteTicks > 0 && --s.hasteTicks === 0) effects.push({ k: 'haste', on: false })
  if (s.guardTicks > 0 && --s.guardTicks === 0) effects.push({ k: 'guard', on: false })
}

const KIND_RANK: Record<EnemyKind, number> = { wave: 0, turn_boss: 1, zone_boss: 2, world_boss: 3 }

/** The first rank that differs decides; equal ranks are not stronger. */
function outranks(a: readonly number[], b: readonly number[]): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return (a[i] ?? 0) > (b[i] ?? 0)
  return false
}

/** The strongest enemy on the field: by kind, then attack, then max HP; the front-most of equals. */
function strongest(s: GameState): Enemy | undefined {
  let best: { enemy: Enemy; rank: number[] } | undefined
  for (const enemy of s.encounter?.enemies ?? []) {
    const rank = [KIND_RANK[enemy.kind], enemyStats(s, enemy).atk, enemy.maxHp]
    if (!best || outranks(rank, best.rank)) best = { enemy, rank }
  }
  return best?.enemy
}

/**
 * tool_mishap: the strongest enemy on the field is enraged until its next attack. An enraged pick
 * means nothing happens, and while camped nothing does.
 */
export function onMishap(s: GameState, effects: Effect[]): void {
  if (s.camp) return
  const enemy = strongest(s)
  if (!enemy || enemy.enraged) return
  enemy.enraged = true
  effects.push({ k: 'enraged', enemyId: enemy.id })
}

/**
 * camp on: a rest's heal, and the fight held where it stands until camp breaks. With a world boss
 * engaged it heals and holds nothing; camped already, it does nothing. Haste and Guard stay as
 * they are. camp off breaks camp.
 */
export function onCamp(s: GameState, on: boolean, effects: Effect[]): void {
  if (!on) {
    breakCamp(s, effects)
    return
  }
  if (s.camp) return
  const before = partyHeroes(s).map((h) => ({ heroId: h.id, hp: h.hp }))
  onRest(s)
  const heals = before.map(({ heroId, hp }) => ({
    heroId,
    amount: (s.roster.find((h) => h.id === heroId)?.hp ?? hp) - hp,
  }))
  if (s.boss) {
    effects.push({ k: 'camp', heals })
    return
  }
  s.camp = true
  effects.push({ k: 'camp', on: true, heals })
}

/** Breaks camp ahead of the event's own work; not camped, nothing. */
export function breakCamp(s: GameState, effects: Effect[]): void {
  if (!s.camp) return
  s.camp = false
  effects.push({ k: 'camp', on: false, heals: [] })
}
