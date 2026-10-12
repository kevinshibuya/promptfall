/**
 * The eight sound cues; each rides a toast, and the toast table names which (spec §10). The clips
 * are written by `pnpm cues` (scripts/cues.ts).
 */
export type Cue =
  | 'drop'
  | 'legendary'
  | 'level_up'
  | 'boss'
  | 'zone_cleared'
  | 'recruit'
  | 'goal'
  | 'retreat'

/** The plugin file each cue plays. */
export const CUE_ASSET: Record<Cue, string> = {
  drop: 'cues/drop.wav',
  legendary: 'cues/legendary.wav',
  level_up: 'cues/level_up.wav',
  boss: 'cues/boss.wav',
  zone_cleared: 'cues/zone_cleared.wav',
  recruit: 'cues/recruit.wav',
  goal: 'cues/goal.wav',
  retreat: 'cues/retreat.wav',
}
