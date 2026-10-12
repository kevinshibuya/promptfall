import { describe, expect, it } from 'vitest'
import { buildEnemies, ENEMY_TUNING } from './enemies'

describe('buildEnemies', () => {
  it("scales a zone's xp by its zoneXpBp, boss multipliers on top", () => {
    const base = buildEnemies({ ...ENEMY_TUNING, zoneXpBp: [] })
    const zoneXpBp = [10000, 10000, 5000]
    const tuned = buildEnemies({ ...ENEMY_TUNING, zoneXpBp })

    const wave = base.bog_lurker?.xp ?? 0
    expect(tuned.bog_lurker?.xp).toBe(Math.floor((wave * 5000) / 10000))
    expect(tuned.sigh_hag?.xp).toBe(Math.floor((wave * 5000) / 10000) * 8)
    expect(tuned.bramble_wolf?.xp).toBe(base.bramble_wolf?.xp)
  })
})
