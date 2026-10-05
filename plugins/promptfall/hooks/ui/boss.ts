import type { BossView, GameView, WorldState } from '../../types'

/** The snapshot's boss as this session shows it, or null when there is none. */
export type ShownBoss = {
  boss: BossView
  /** The server's HP less what this party dealt locally beyond its committed tally. */
  shownHp: number
  /** This party's tally: the view's when engaged with this boss, else the server's `yours`. */
  dealt: number
  /** True when the view is in boss mode for this boss. */
  engaged: boolean
}

/**
 * The predicted bar (R5): the server's HP wins at each poll; between polls a
 * primary subtracts what it dealt past the committed tally it reported then.
 * A null or foreign `committedDealt` subtracts nothing.
 */
export function shownBoss(view: GameView, world: WorldState): ShownBoss | null {
  const boss = world.snapshot?.boss
  if (!boss) return null
  const mine = view.boss?.bossId === boss.bossId ? view.boss : null
  if (!mine) return { boss, shownHp: boss.hp, dealt: boss.yours, engaged: false }
  const baseline =
    world.committedDealt?.bossId === boss.bossId ? world.committedDealt.dealt : mine.dealt
  const shownHp = Math.max(0, boss.hp - Math.max(0, mine.dealt - baseline))
  return { boss, shownHp, dealt: mine.dealt, engaged: true }
}
