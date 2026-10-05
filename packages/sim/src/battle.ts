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
