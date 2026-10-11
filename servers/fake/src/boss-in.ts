import { BOSS_GRID_MS } from '@promptfall/protocol'

/** The next grid point after `virtualNow`, in virtual ms. */
export function nextGridPoint(virtualNow: number): number {
  return (Math.floor(virtualNow / BOSS_GRID_MS) + 1) * BOSS_GRID_MS
}

/**
 * `--boss-in <seconds>`: the virtual now that puts the next grid point
 * `seconds` real seconds away, or null when it is already nearer. Only ever
 * forward: a skipped window's boss never spawned and owes nothing.
 */
export function bossInRebase(virtualNow: number, seconds: number, speed: number): number | null {
  const target = nextGridPoint(virtualNow) - seconds * 1000 * speed
  return target > virtualNow ? target : null
}
