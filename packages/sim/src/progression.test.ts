import { describe, expect, it } from 'vitest'
import { content } from './content'
import { createInitialState } from './state'
import { step } from './step'
import type { Effect, Enemy, EnemyKind, Event, GameState } from './types'

const toolCall = { t: 'tool_call' } as const
const turnEnd = { t: 'turn_end' } as const
const tick = { t: 'tick' } as const

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
    // Leave the boss at 1 hp so the next round kills it.
    s = { ...s, encounter: { ...enc, enemies: [{ ...boss, hp: 1 }] } }
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

  it('farm restarts the zone instead of advancing', () => {
    let s: GameState = { ...createInitialState(5), wave: 11, farm: true }
    s = injectEnemy(s, 'bandit_captain')
    const enc = s.encounter
    const boss = enc?.enemies[0]
    if (!enc || !boss) throw new Error('enc')
    s = { ...s, encounter: { ...enc, enemies: [{ ...boss, hp: 1 }] } }
    const r = run(s, [tick])
    expect(r.state.zone).toBe(1)
    expect(r.state.wave).toBe(1)
    expect(r.effects).toContainEqual({ k: 'zone_cleared', zone: 1, advancedTo: 1 })
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

// Helpers

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
