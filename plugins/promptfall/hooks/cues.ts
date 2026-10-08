/** The four sound cues; each rides a toast, and the toast table names which (spec §10). */
export type Cue = 'drop' | 'legendary' | 'level_up' | 'boss'

/** The plugin file each cue plays. */
export const CUE_ASSET: Record<Cue, string> = {
  drop: 'cues/drop.wav',
  legendary: 'cues/legendary.wav',
  level_up: 'cues/level_up.wav',
  boss: 'cues/boss.wav',
}
