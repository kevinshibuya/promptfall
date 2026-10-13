/** Battle time one tick advances, whatever the cadence (grill 1.1). Fixed. */
export const TICK_MS = 2000
/** Resolution of the battle loop: 20 steps per tick. Fixed. */
export const STEP_MS = 100
/** A full action gauge. Fixed. */
export const GAUGE_FULL = 10000
/** An action lasts this many steps of battle time. Tunable (plan Task 4). */
export const ACTION_STEPS = 5
/** Speed constant: fill is proportional to spd + FILL_K (grill 1.2). Tunable. */
export const FILL_K = 10
/** Per-step fill = floor((spd + FILL_K) × FILL_BP / 1000). Tunable. */
export const FILL_BP = 16667
/** Every damage and heal amount × POWER_BP / 10000 (grill 1.5). Tunable. */
export const POWER_BP = 20000
/** While Haste is on, a hero's per-step fill × HASTE_BP / 10000. Tunable (the arc check of #156). */
export const HASTE_BP = 12500
/** Haste's countdown: 90 ticks, 3 minutes of battle time. */
export const HASTE_TICKS = 90
/** Guard's countdown: 60 ticks, 2 minutes of battle time. */
export const GUARD_TICKS = 60
/** While Guard is on, the damage a hero takes × GUARD_DAMAGE_BP / 10000. */
export const GUARD_DAMAGE_BP = 5000
/** An enraged enemy's next attack uses its atk × ENRAGE_BP / 10000. */
export const ENRAGE_BP = 15000
/** A zone boss's moves (#169), each in basis points of its atk: a strike-twice hit, a whole-party hit, its self-heal. */
export const STRIKE_TWICE_BP = 7000
export const HIT_ALL_BP = 6000
export const SELF_HEAL_BP = 5000
/** A raging zone boss under half its HP hits from its atk × RAGE_BP / 10000. */
export const RAGE_BP = 15000
/** A spawned enemy's gauge starts at draw(SPAWN_GAUGE_MAX + 1). */
export const SPAWN_GAUGE_MAX = 5000

/** Gauge gained per step at this speed, never below 1. */
export function fill(spd: number): number {
  return Math.max(1, Math.floor(((spd + FILL_K) * FILL_BP) / 1000))
}

/** An amount scaled by POWER_BP, never below 1. Integer at every step. */
export function scaled(raw: number, powerBp: number = POWER_BP): number {
  return Math.max(1, Math.floor((raw * powerBp) / 10000))
}
