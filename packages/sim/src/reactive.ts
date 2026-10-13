import { fill, GUARD_TICKS, HASTE_BP, HASTE_TICKS } from './battle'
import { heroStats, onRest, partyHeroes } from './progression'
import type { Effect, GameState, Hero } from './types'

// The reactive events (spec #131). ADR 0014: each shapes the fight and never the reward.

/** A hero's gauge gained per step as the battle fills it: zero while guarding, scaled while hasted. */
export function heroFill(s: GameState, hero: Hero): number {
  if (s.guardTicks > 0) return 0
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

/** tool_mishap: the front enemy, the engaged world boss included, is enraged until its next attack. */
export function onMishap(s: GameState, effects: Effect[]): void {
  const enemy = s.encounter?.enemies[0]
  if (!enemy || enemy.enraged) return
  enemy.enraged = true
  effects.push({ k: 'enraged', enemyId: enemy.id })
}

/** camp: a rest's heal, in boss mode too, told apart by its effect. Haste and Guard stay as they are. */
export function onCamp(s: GameState, effects: Effect[]): void {
  const before = partyHeroes(s).map((h) => ({ heroId: h.id, hp: h.hp }))
  onRest(s)
  const heals = before.map(({ heroId, hp }) => ({
    heroId,
    amount: (s.roster.find((h) => h.id === heroId)?.hp ?? hp) - hp,
  }))
  effects.push({ k: 'camp', heals })
}
