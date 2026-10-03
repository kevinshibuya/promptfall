import { createInitialState, type GameState, type PlayerEvent, replay } from '@promptfall/sim'
import { BOT_START_GOLD } from './bot-config'

const ROUND: PlayerEvent[] = [{ t: 'tool_call' }, { t: 'tick' }, { t: 'tick' }, { t: 'tick' }]

/**
 * A bot's starting state, the same for a given seed and index: a fresh
 * account given gold (host construction, not a trade), then a scripted
 * stretch of play that vendors its commons and recruits now and then.
 */
export function rollBotState(seed: number, i: number): GameState {
  let s: GameState = { ...createInitialState((seed ^ (i + 1)) >>> 0), gold: BOT_START_GOLD }
  const rounds = 600 + ((i * 37) % 300)
  for (let r = 1; r <= rounds; r++) {
    s = replay(s, ROUND).state
    if (r % 20 === 0) {
      const junk = s.inventory.filter(
        (it) => (it.rarity === 'common' || it.rarity === 'uncommon') && it.equippedBy === null,
      )
      s = replay(
        s,
        junk.map((it) => ({ t: 'vendor', itemId: it.id }) as PlayerEvent),
      ).state
    }
    if (r % 60 === 0) s = replay(s, [{ t: 'recruit' }]).state
  }
  return replay(s, [{ t: 'rest' }]).state
}
