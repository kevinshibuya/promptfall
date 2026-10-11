import type { BossView, GameView, WorldState } from '../../types'

/** The snapshot's boss as this session shows it, or null when there is none. */
export type ShownBoss = {
  boss: BossView
  /** The bar: the staged world boss row's HP, the poll less what this party has landed. */
  shownHp: number
  /** This party's tally: the view's when engaged with this boss, else the server's `yours`. */
  dealt: number
  /** True when the view is in boss mode for this boss. */
  engaged: boolean
}

/**
 * The boss's bar as the stage shows it (R5). `view` is the staged state (stage/staged.ts): engaged,
 * the bar is its world boss row, the poll less the damage this party has landed since the poll's
 * baseline. Before the stage has admitted the row, the poll less what this party dealt past the
 * committed tally it reported then; a null or foreign `committedDealt` subtracts nothing.
 */
export function shownBoss(view: GameView, world: WorldState): ShownBoss | null {
  const boss = world.snapshot?.boss
  if (!boss) return null
  const mine = view.boss?.bossId === boss.bossId ? view.boss : null
  if (!mine) return { boss, shownHp: boss.hp, dealt: boss.yours, engaged: false }
  const row = view.enemies.find((e) => e.kind === 'world_boss')
  const baseline =
    world.committedDealt?.bossId === boss.bossId ? world.committedDealt.dealt : mine.dealt
  const shownHp = row ? row.hp : Math.max(0, boss.hp - Math.max(0, mine.dealt - baseline))
  return { boss, shownHp, dealt: mine.dealt, engaged: true }
}
