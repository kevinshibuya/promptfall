import type { Effect } from './vendor/sim.js'

/** The four sound cues; each a strict subset of a toast (spec §10). */
export type Cue = 'drop' | 'legendary' | 'level_up' | 'boss'

/** The plugin file each cue plays. */
export const CUE_ASSET: Record<Cue, string> = {
  drop: 'cues/drop.wav',
  legendary: 'cues/legendary.wav',
  level_up: 'cues/level_up.wav',
  boss: 'cues/boss.wav',
}

/** The cue an effect earns: Rare and Epic drops, a Legendary drop, a level up. The boss cue comes from the world poll. */
export function cueFor(effect: Effect): Cue | null {
  if (effect.k === 'drop') {
    if (effect.item.rarity === 'legendary') return 'legendary'
    if (effect.item.rarity === 'rare' || effect.item.rarity === 'epic') return 'drop'
    return null
  }
  if (effect.k === 'level_up') return 'level_up'
  return null
}
