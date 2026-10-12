import { describe, expect, it } from 'vitest'
import { GAUGE_FULL } from './battle'
import { content } from './content'
import { heroStats } from './progression'
import { createInitialState } from './state'
import { step } from './step'
import type { Effect, Enemy, EnemyKind, Event, GameState } from './types'

const toolCall = { t: 'tool_call' } as const
const turnEnd = { t: 'turn_end' } as const
const tick = { t: 'tick' } as const

/** Every party hero's gauge one point short of full: the party acts in the next tick's first steps. */
function ready(s: GameState): GameState {
  return {
    ...s,
    battle: { gauges: s.party.map((id) => ({ id, g: GAUGE_FULL - 1 })), queue: [], busy: 0 },
  }
}

function killAll(s: GameState): GameState {
  if (!s.encounter) return s
  return { ...s, encounter: { ...s.encounter, enemies: [] } }
}

describe('turn boss', () => {
  it('ten tool calls then turn_end spawn a turn boss on the next empty tick', () => {
    let s = run(createInitialState(1), [...times(10, toolCall), turnEnd]).state
    expect(s.pendingTurnBoss).toBe(true)
    expect(s.turnToolCalls).toBe(0)
    s = {
      ...killAll(s),
      encounter: s.encounter ? { ...s.encounter, enemies: [], queue: [] } : null,
    }
    const r = run(s, [tick])
    expect(r.effects).toContainEqual({
      k: 'boss_spawned',
      kind: 'turn_boss',
      def: 'wild_boar',
    })
    expect(r.state.pendingTurnBoss).toBe(false)
    expect(r.state.encounter?.enemies.map((e) => e.kind)).toEqual(['turn_boss'])
  })

  it("a turn boss spawned mid-wave leaves the wave's progress alone", () => {
    // Wave 3 of 3 monsters, one already beaten, and a turn boss due.
    let s: GameState = {
      ...createInitialState(1),
      wave: 3,
      pendingTurnBoss: true,
      encounter: { enemies: [], queue: [], waveSize: 3, spawnedInWave: 1 },
    }
    s = run(s, [tick]).state
    expect(s.encounter?.enemies.map((e) => e.kind)).toEqual(['turn_boss'])
    expect(s.encounter).toMatchObject({ waveSize: 3, spawnedInWave: 1 })

    let r = run(finishFront(s), [tick])
    expect(r.state.stats).toMatchObject({ kills: 1, bosses: 1 })
    expect(r.effects.some((e) => e.k === 'wave_cleared')).toBe(false)
    expect(r.state.wave).toBe(3)
    expect(r.state.encounter).toEqual({ enemies: [], queue: [], waveSize: 3, spawnedInWave: 1 })

    // The wave goes on where it was: two more monsters, then the clear.
    for (const spawned of [2, 3]) {
      s = run(r.state, [tick]).state
      expect(s.encounter?.enemies.map((e) => e.kind)).toEqual(['wave'])
      expect(s.encounter?.spawnedInWave).toBe(spawned)
      r = run(finishFront(s), [tick])
    }
    expect(r.effects).toContainEqual({ k: 'wave_cleared', zone: 1, wave: 3 })
    expect(r.state.wave).toBe(4)
    expect(r.state.encounter).toBeNull()
  })

  it("a turn boss killed after the wave's last monster still clears the wave", () => {
    const s0 = createInitialState(1)
    let s: GameState = {
      ...s0,
      wave: 3,
      encounter: { enemies: [], queue: [], waveSize: 2, spawnedInWave: 2 },
    }
    s = injectEnemy(s, 'wild_boar', 'turn_boss')
    const r = run(finishFront(s), [tick])
    expect(r.effects).toContainEqual({ k: 'wave_cleared', zone: 1, wave: 3 })
    expect(r.state.wave).toBe(4)
    expect(r.state.encounter).toBeNull()
  })

  it('a turn boss in an encounter of its own closes it when it dies', () => {
    let s: GameState = { ...createInitialState(1), wave: 3, pendingTurnBoss: true }
    s = run(s, [tick]).state
    expect(s.encounter).toMatchObject({ waveSize: 0, spawnedInWave: 0 })
    const r = run(finishFront(s), [tick])
    expect(r.effects.some((e) => e.k === 'wave_cleared')).toBe(false)
    expect(r.state.wave).toBe(3)
    expect(r.state.encounter).toBeNull()
  })

  it('nine tool calls then turn_end do not', () => {
    const s = run(createInitialState(1), [...times(9, toolCall), turnEnd]).state
    expect(s.pendingTurnBoss).toBe(false)
    const cleared: GameState = {
      ...s,
      encounter: s.encounter ? { ...s.encounter, enemies: [], queue: [] } : null,
    }
    const r = run(cleared, [tick])
    expect(r.effects.some((e) => e.k === 'boss_spawned')).toBe(false)
  })
})

describe('spawning', () => {
  it('caps the fight at 3 and the queue at 10, dropping the 14th', () => {
    const s = run(createInitialState(1), times(14, toolCall)).state
    expect(s.encounter?.enemies).toHaveLength(3)
    expect(s.encounter?.queue).toHaveLength(10)
    expect(s.encounter?.spawnedInWave).toBe(0)
    expect(s.turnToolCalls).toBe(14)
    // The test kills one enemy; the next tick refills from the queue.
    const enc = s.encounter
    if (!enc) throw new Error('no encounter')
    const oneDown: GameState = { ...s, encounter: { ...enc, enemies: enc.enemies.slice(1) } }
    const r = run(oneDown, [tick])
    expect(r.state.encounter?.queue).toHaveLength(9)
    expect(r.state.encounter?.enemies.length).toBeGreaterThanOrEqual(2)
    const ids = new Set(r.state.encounter?.enemies.map((e) => e.id))
    expect(ids.size).toBe(r.state.encounter?.enemies.length)
  })

  it('an idle tick with nothing alive spawns a wave enemy', () => {
    const r = run(createInitialState(2), [tick])
    expect(r.state.encounter?.enemies).toHaveLength(1)
    expect(r.state.encounter?.spawnedInWave).toBe(1)
    expect(r.state.encounter?.waveSize).toBeGreaterThanOrEqual(1)
    expect(r.state.encounter?.waveSize).toBeLessThanOrEqual(3)
  })
})

describe('zone boss and pending party', () => {
  it('applies a pending party when the zone boss dies', () => {
    const s0 = createInitialState(5)
    const [k, b, , a] = s0.roster
    if (!k || !b || !a) throw new Error('roster')
    let s: GameState = {
      ...s0,
      wave: 11,
      pendingParty: [k.id, b.id, a.id],
    }
    s = injectEnemy(s, 'bandit_captain')
    const enc = s.encounter
    if (!enc) throw new Error('enc')
    const boss = enc.enemies[0]
    if (!boss) throw new Error('boss')
    // Leave the boss at 1 hp and the party ready so the next tick kills it.
    s = ready({ ...s, encounter: { ...enc, enemies: [{ ...boss, hp: 1 }] } })
    const r = run(s, [tick])
    expect(r.effects).toContainEqual({ k: 'zone_cleared', zone: 1, advancedTo: 2 })
    expect(r.effects).toContainEqual({ k: 'party_applied', heroIds: [k.id, b.id, a.id] })
    expect(r.state.party).toEqual([k.id, b.id, a.id])
    expect(r.state.pendingParty).toBeNull()
    expect(r.state.zone).toBe(2)
    expect(r.state.highestZone).toBe(2)
    expect(r.state.wave).toBe(1)
    expect(r.state.encounter).toBeNull()
    expect(r.state.stats.bosses).toBe(1)
  })

  it('the party that takes the field in the next zone is revived like after a wave', () => {
    const s0 = createInitialState(5)
    const [k, b, w, a] = s0.roster
    if (!k || !b || !w || !a) throw new Error('roster')
    const roster = s0.roster.map((h) => (h.id === a.id || h.id === w.id ? { ...h, hp: 0 } : h))
    for (const pending of [[k.id, b.id, a.id] as [string, string, string], null]) {
      let s: GameState = { ...s0, roster, wave: 11, pendingParty: pending }
      s = injectEnemy(s, 'bandit_captain')
      const enc = s.encounter
      const boss = enc?.enemies[0]
      if (!enc || !boss) throw new Error('enc')
      s = ready({ ...s, encounter: { ...enc, enemies: [{ ...boss, hp: 1 }] } })
      const r = run(s, [tick])
      expect(r.state.zone).toBe(2)
      const fallen = pending ? a : w
      const hero = r.state.roster.find((h) => h.id === fallen.id)
      if (!hero) throw new Error('hero')
      expect(r.state.party.includes(fallen.id)).toBe(true)
      expect(hero.hp).toBe(Math.max(1, Math.floor((heroStats(r.state, hero).hp * 1500) / 10000)))
    }
  })

  it('farm restarts the zone instead of advancing', () => {
    let s: GameState = { ...createInitialState(5), wave: 11, farm: true }
    s = injectEnemy(s, 'bandit_captain')
    const enc = s.encounter
    const boss = enc?.enemies[0]
    if (!enc || !boss) throw new Error('enc')
    s = ready({ ...s, encounter: { ...enc, enemies: [{ ...boss, hp: 1 }] } })
    const r = run(s, [tick])
    expect(r.state.zone).toBe(1)
    expect(r.state.wave).toBe(1)
    expect(r.effects).toContainEqual({ k: 'zone_cleared', zone: 1, advancedTo: 1 })
  })
})

describe('the xp curve', () => {
  const table = Array.from({ length: 50 }, (_, i) => content.xpToNext(i + 1))
  const toReach = (level: number) => table.slice(0, level - 1).reduce((n, xp) => n + xp, 0)

  it('is a table of 50 integers, each level dearer than the last', () => {
    for (const xp of table) expect(Number.isInteger(xp)).toBe(true)
    for (let i = 1; i < table.length; i++) expect(table[i]).toBeGreaterThan(table[i - 1] ?? 0)
  })

  it('takes about 10k, 68k, 207k and 836k xp to reach levels 10, 20, 30 and 50', () => {
    const near = (level: number, total: number) => {
      expect(toReach(level)).toBeGreaterThan(total * 0.95)
      expect(toReach(level)).toBeLessThan(total * 1.05)
    }
    near(10, 10000)
    near(20, 68000)
    near(30, 207000)
    near(50, 836000)
  })

  it("levels a hero when a kill's xp reaches the table's entry for its level", () => {
    const s0 = createInitialState(1)
    const knight = s0.roster[0]
    if (!knight) throw new Error('roster')
    const roster = s0.roster.map((h) =>
      h.id === knight.id ? { ...h, level: 10, xp: content.xpToNext(10) - 1 } : h,
    )
    let s = injectEnemy({ ...s0, roster }, 'road_slime')
    const enemy = s.encounter?.enemies[0]
    if (!s.encounter || !enemy) throw new Error('setup')
    s = { ...s, encounter: { ...s.encounter, enemies: [{ ...enemy, hp: 1 }] } }
    const r = run(ready(s), [tick])
    expect(r.effects).toContainEqual({ k: 'level_up', heroId: knight.id, level: 11 })
    expect(r.state.roster[0]?.level).toBe(11)
  })
})

describe('rest', () => {
  it('heals 30% and revives the fallen at 30%', () => {
    const s0 = createInitialState(1)
    const roster = s0.roster.map((h, i) =>
      i === 0 ? { ...h, hp: 0 } : i === 1 ? { ...h, hp: 1 } : h,
    )
    const r = run({ ...s0, roster }, [{ t: 'rest' }])
    const [k, b, w] = r.state.roster
    expect(k?.hp).toBe(Math.floor((60 * 3000) / 10000))
    expect(b?.hp).toBe(1 + Math.floor((36 * 3000) / 10000))
    expect(w?.hp).toBe(40)
  })
})

describe('waves', () => {
  it('the wave clear heals 15% and revives the fallen at 15%, capped at max', () => {
    const s0 = createInitialState(1)
    const [k, b, , a] = s0.roster
    if (!k || !b || !a) throw new Error('roster')
    const max = (id: string) => {
      const hero = s0.roster.find((h) => h.id === id)
      if (!hero) throw new Error(id)
      return heroStats(s0, hero).hp
    }
    // No white mage: nobody heals before the clear. Kill xp is far below a level.
    let s: GameState = {
      ...s0,
      party: [k.id, b.id, a.id],
      roster: s0.roster.map((h) =>
        h.id === k.id ? { ...h, hp: max(k.id) - 1 } : h.id === b.id ? { ...h, hp: 0 } : h,
      ),
      encounter: { enemies: [], queue: [], waveSize: 1, spawnedInWave: 1 },
    }
    s = injectEnemy(s, 'field_rat')
    s = finishFront(s)
    const archerHp = 5
    s = { ...s, roster: s.roster.map((h) => (h.id === a.id ? { ...h, hp: archerHp } : h)) }
    const r = run(s, [tick])
    expect(r.effects).toContainEqual({ k: 'wave_cleared', zone: 1, wave: 1 })
    const hp = (id: string) => r.state.roster.find((h) => h.id === id)?.hp
    const heal = (id: string) => Math.max(1, Math.floor((max(id) * 1500) / 10000))
    expect(hp(k.id)).toBe(max(k.id))
    expect(hp(b.id)).toBe(heal(b.id))
    expect(hp(a.id)).toBe(archerHp + heal(a.id))
    expect(r.state.wave).toBe(2)
  })

  it('clears waves and advances over time', () => {
    const r = run(createInitialState(11), times(200, tick))
    expect(r.effects.some((e) => e.k === 'wave_cleared')).toBe(true)
    expect(r.state.wave).toBeGreaterThan(1)
  })

  it('levels heroes from kill xp', () => {
    const r = run(createInitialState(11), times(400, tick))
    expect(r.effects.some((e) => e.k === 'level_up')).toBe(true)
  })
})

describe('wipe', () => {
  /** The whole party down, mid-fight: gauges part-filled, one unit queued, an action running. */
  function beaten(s: GameState): GameState {
    const ids = [...s.party, ...(s.encounter?.enemies.map((e) => e.id) ?? [])]
    return {
      ...s,
      roster: s.roster.map((h) => (s.party.includes(h.id) ? { ...h, hp: 0 } : h)),
      battle: { gauges: ids.map((id) => ({ id, g: 4000 })), queue: [ids[0] ?? ''], busy: 3 },
    }
  }

  it('a wipe in boss mode empties every gauge and clears the queue, then heals in place', () => {
    const engaged = run(createInitialState(1), [
      {
        t: 'boss_engaged',
        bossId: 'wb1',
        name: 'The Promptwyrm',
        glyph: '☠',
        stats: { hp: 630, atk: 14, def: 4, spd: 5 },
      },
    ]).state
    const s = beaten(engaged)
    const r = run(s, [tick])
    expect(r.state.battle).toEqual({ gauges: [], queue: [], busy: 0 })
    expect(r.state.encounter).toEqual(s.encounter)
    expect(r.state.stats.wipes).toBe(0)
    expect(r.effects.some((e) => e.k === 'wipe')).toBe(false)
    for (const id of r.state.party) {
      const hero = r.state.roster.find((h) => h.id === id)
      if (!hero) throw new Error(id)
      expect(hero.hp).toBe(heroStats(r.state, hero).hp)
    }
  })

  it('a wipe outside boss mode resets the battle the same way', () => {
    const s = beaten(
      injectEnemy({ ...createInitialState(1), zone: 2, highestZone: 2 }, 'field_rat'),
    )
    const r = run(s, [tick])
    expect(r.effects).toContainEqual({ k: 'wipe', retreatedTo: 1 })
    expect(r.state.battle).toEqual({ gauges: [], queue: [], busy: 0 })
    expect(r.state.encounter).toBeNull()
  })
})

// Helpers

/** The front enemy at 1 hp and the party ready: the next tick kills it. */
function finishFront(s: GameState): GameState {
  const enc = s.encounter
  const [front, ...rest] = enc?.enemies ?? []
  if (!enc || !front) throw new Error('no enemy')
  return ready({ ...s, encounter: { ...enc, enemies: [{ ...front, hp: 1 }, ...rest] } })
}

function run(state: GameState, events: Event[]): { state: GameState; effects: Effect[] } {
  let s = state
  const effects: Effect[] = []
  for (const e of events) {
    const r = step(s, e)
    s = r.state
    effects.push(...r.effects)
  }
  return { state: s, effects }
}

function times<T>(n: number, value: T): T[] {
  return Array.from({ length: n }, () => value)
}

function injectEnemy(state: GameState, defId: string, kind?: EnemyKind): GameState {
  const def = content.enemies[defId]
  if (!def) throw new Error(`unknown enemy ${defId}`)
  const enemy: Enemy = {
    id: `etest${state.counter}`,
    def: defId,
    kind: kind ?? def.kind,
    hp: def.stats.hp,
    maxHp: def.stats.hp,
  }
  const encounter = state.encounter ?? { enemies: [], queue: [], waveSize: 0, spawnedInWave: 0 }
  return {
    ...state,
    counter: state.counter + 1,
    encounter: { ...encounter, enemies: [...encounter.enemies, enemy] },
  }
}
