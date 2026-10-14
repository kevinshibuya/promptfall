import { describe, expect, it } from 'vitest'
import { fill, GAUGE_FULL } from './battle'
import { enemyStats, hitDamage } from './combat'
import { content, enemyAt, zoneAt } from './content'
import { heroStats } from './progression'
import { heroFill } from './reactive'
import { createInitialState } from './state'
import { step } from './step'
import type { Effect, Enemy, EnemyKind, Event, GameState, Hero, WaveArchetype } from './types'

// The reactive events (spec #131, ADR 0014): each shapes the fight and never the reward.

const tick = { t: 'tick' } as const
const turnStart = { t: 'turn_start' } as const

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
    enraged: false,
  }
  const encounter = state.encounter ?? { enemies: [], queue: [], waveSize: 0, spawnedInWave: 0 }
  return {
    ...state,
    counter: state.counter + 1,
    encounter: { ...encounter, enemies: [...encounter.enemies, enemy] },
  }
}

function hero(s: GameState, i: number): Hero {
  const h = s.roster.find((r) => r.id === s.party[i])
  if (!h) throw new Error(`no party hero ${i}`)
  return h
}

function gauge(s: GameState, id: string): number {
  return s.battle.gauges.find((g) => g.id === id)?.g ?? -1
}

function kinds(effects: Effect[], k: Effect['k']): Effect[] {
  return effects.filter((e) => e.k === k)
}

/** A party facing one tough enemy, every gauge at 0: no hero fills in one tick. */
function facing(defId = 'road_slime'): GameState {
  return injectEnemy(createInitialState(5), defId)
}

describe('Haste', () => {
  it('turn_start turns it on for 90 ticks with one haste effect', () => {
    const r = run(createInitialState(1), [turnStart])
    expect(r.state.hasteTicks).toBe(90)
    expect(r.effects).toEqual([{ k: 'haste', on: true }])
  })

  it('a second turn_start refreshes the countdown with no effect', () => {
    const r = run(createInitialState(1), [turnStart, tick, tick])
    expect(r.state.hasteTicks).toBe(88)
    const again = run(r.state, [turnStart])
    expect(again.state.hasteTicks).toBe(90)
    expect(again.effects).toEqual([])
  })

  it("fills a hero's gauge by 12,500 basis points per step while enemies fill as before", () => {
    const s = facing()
    const plain = run(s, [tick]).state
    const hasted = run(s, [turnStart, tick]).state
    const knight = hero(s, 0)
    const base = fill(heroStats(s, knight).spd)
    const fast = Math.floor((base * 12500) / 10000)
    expect(gauge(plain, knight.id)).toBe(20 * base)
    expect(gauge(hasted, knight.id)).toBe(20 * fast)
    const enemyId = s.encounter?.enemies[0]?.id ?? ''
    expect(gauge(hasted, enemyId)).toBe(gauge(plain, enemyId))
  })

  it('turn_end and rest clear it, each with haste off once', () => {
    for (const end of [{ t: 'turn_end' }, { t: 'rest' }] as const) {
      const on = run(createInitialState(1), [turnStart]).state
      const r = run(on, [end, end])
      expect(r.state.hasteTicks).toBe(0)
      expect(kinds(r.effects, 'haste')).toEqual([{ k: 'haste', on: false }])
    }
  })

  it('the tick that takes the countdown from 1 to 0 ends it with haste off once', () => {
    const on = run(createInitialState(1), [turnStart]).state
    const r89 = run(on, times(89, tick))
    expect(r89.state.hasteTicks).toBe(1)
    expect(kinds(r89.effects, 'haste')).toEqual([])
    const r = run(r89.state, [tick, tick])
    expect(r.state.hasteTicks).toBe(0)
    expect(kinds(r.effects, 'haste')).toEqual([{ k: 'haste', on: false }])
  })

  it('the exported per-step fill agrees with the battle', () => {
    const s = facing()
    const knight = hero(s, 0)
    const base = fill(heroStats(s, knight).spd)
    expect(heroFill(s, knight)).toBe(base)
    const hasted = run(s, [turnStart]).state
    expect(heroFill(hasted, knight)).toBe(Math.floor((base * 12500) / 10000))
    expect(GAUGE_FULL).toBeGreaterThan(20 * heroFill(hasted, knight))
  })
})

const guardOn = { t: 'guard', on: true } as const
const guardOff = { t: 'guard', on: false } as const

/** One enemy a step from acting, the party's gauges at 0: the enemy hits in the tick's first step. */
function enemyReady(defId = 'goblin_scout'): GameState {
  const s = injectEnemy(createInitialState(5), defId)
  const enemyId = s.encounter?.enemies[0]?.id ?? ''
  return { ...s, battle: { gauges: [{ id: enemyId, g: GAUGE_FULL - 1 }], queue: [], busy: 0 } }
}

function hitsOn(effects: Effect[], heroIds: readonly string[]): number[] {
  return effects.flatMap((e) => (e.k === 'hit' && heroIds.includes(e.target) ? [e.amount] : []))
}

describe('Guard', () => {
  it('guard on turns it on for 60 ticks with one guard effect; on while on changes nothing', () => {
    const r = run(createInitialState(1), [guardOn, tick, guardOn])
    expect(r.state.guardTicks).toBe(59)
    expect(kinds(r.effects, 'guard')).toEqual([{ k: 'guard', on: true }])
  })

  it('guard off and rest end it with guard off once; off while off changes nothing', () => {
    expect(run(createInitialState(1), [guardOff]).effects).toEqual([])
    for (const end of [guardOff, { t: 'rest' }] as const) {
      const r = run(createInitialState(1), [guardOn, end, end])
      expect(r.state.guardTicks).toBe(0)
      expect(kinds(r.effects, 'guard')).toEqual([
        { k: 'guard', on: true },
        { k: 'guard', on: false },
      ])
    }
  })

  it('the tick that takes the countdown from 1 to 0 ends it with guard off once', () => {
    const r59 = run(createInitialState(1), [guardOn, ...times(59, tick)])
    expect(r59.state.guardTicks).toBe(1)
    const r = run(r59.state, [tick, tick])
    expect(r.state.guardTicks).toBe(0)
    expect(kinds(r.effects, 'guard')).toEqual([{ k: 'guard', on: false }])
  })

  it('halves the damage a hero takes on the same roll', () => {
    const s = enemyReady()
    const plain = hitsOn(run(s, [tick]).effects, s.party)
    const guarded = hitsOn(run(s, [guardOn, tick]).effects, s.party)
    expect(plain.length).toBeGreaterThan(0)
    expect(guarded).toEqual(plain.map((a) => Math.max(1, Math.floor(a / 2))))
  })

  it('holds hero gauges, even hasted, while the enemy fills and acts', () => {
    const s0 = enemyReady()
    const s: GameState = {
      ...s0,
      battle: {
        ...s0.battle,
        gauges: [...s0.battle.gauges, ...s0.party.map((id) => ({ id, g: 3000 }))],
      },
    }
    const r = run(s, [turnStart, guardOn, tick])
    for (const id of s.party) expect(gauge(r.state, id)).toBe(3000)
    expect(r.effects.some((e) => e.k === 'act' && e.actor === s.encounter?.enemies[0]?.id)).toBe(
      true,
    )
    expect(heroFill(r.state, hero(r.state, 0))).toBe(0)
  })

  it('a queued hero does not act and stays queued while the enemy behind it acts', () => {
    const s0 = enemyReady()
    const knight = hero(s0, 0).id
    const enemyId = s0.encounter?.enemies[0]?.id ?? ''
    const s: GameState = {
      ...s0,
      battle: {
        gauges: [
          { id: knight, g: GAUGE_FULL },
          { id: enemyId, g: GAUGE_FULL - 1 },
        ],
        queue: [knight],
        busy: 0,
      },
    }
    const r = run(s, [guardOn, tick])
    const actors = r.effects.flatMap((e) => (e.k === 'act' ? [e.actor] : []))
    expect(actors).not.toContain(knight)
    expect(actors).toContain(enemyId)
    expect(r.state.battle.queue[0]).toBe(knight)
    // Unguarded, the knight acts first.
    const plain = run(s, [tick]).effects.find((e) => e.k === 'act')
    expect(plain).toMatchObject({ actor: knight })
  })
})

const mishap = { t: 'tool_mishap' } as const

function front(s: GameState): Enemy {
  const e = s.encounter?.enemies[0]
  if (!e) throw new Error('no enemy')
  return e
}

describe('Enrage', () => {
  it('tool_mishap enrages the front enemy with one enraged effect naming it', () => {
    const s = injectEnemy(injectEnemy(createInitialState(1), 'goblin_scout'), 'field_rat')
    const r = run(s, [mishap])
    expect(r.state.encounter?.enemies.map((e) => e.enraged)).toEqual([true, false])
    expect(r.effects).toEqual([{ k: 'enraged', enemyId: front(s).id }])
  })

  it('enrages the engaged world boss', () => {
    const s = step(createInitialState(1), {
      t: 'boss_engaged',
      bossId: 'wb1',
      name: 'The Promptwyrm',
      glyph: '☠',
      stats: { hp: 900, atk: 18, def: 6, spd: 5 },
    }).state
    const r = run(s, [mishap])
    expect(front(r.state)).toMatchObject({ kind: 'world_boss', enraged: true })
    expect(r.effects).toEqual([{ k: 'enraged', enemyId: front(s).id }])
  })

  it('does nothing on an empty field or on an enraged enemy', () => {
    const empty = createInitialState(1)
    expect(run(empty, [mishap])).toEqual({ state: empty, effects: [] })
    const once = run(injectEnemy(empty, 'goblin_scout'), [mishap]).state
    expect(run(once, [mishap])).toEqual({ state: once, effects: [] })
  })

  it('lands its next hit as its atk at 15,000 basis points would on the same roll, then clears', () => {
    const s = enemyReady()
    const plain = hitsOn(run(s, [tick]).effects, s.party)[0]
    const r = run(s, [mishap, tick])
    const enraged = hitsOn(r.effects, s.party)[0]
    if (plain === undefined || enraged === undefined) throw new Error('no hit')
    const target = r.effects.find((e) => e.k === 'hit')
    const victim = s.roster.find((h) => target?.k === 'hit' && h.id === target.target)
    if (!victim) throw new Error('no victim')
    const atk = enemyStats(s, front(s)).atk
    const def = heroStats(s, victim).def
    const rolls = Array.from({ length: 2001 }, (_, i) => 9000 + i).filter(
      (v) =>
        hitDamage(atk, def, v) === plain &&
        hitDamage(Math.floor((atk * 15000) / 10000), def, v) === enraged,
    )
    expect(rolls.length).toBeGreaterThan(0)
    expect(enraged).toBeGreaterThan(plain)
    expect(front(r.state).enraged).toBe(false)
  })
})

describe('Camp', () => {
  /** The Knight down, the Black Mage at 1 HP, the White Mage whole. */
  function wounded(): GameState {
    const s0 = createInitialState(1)
    const roster = s0.roster.map((h, i) =>
      i === 0 ? { ...h, hp: 0 } : i === 1 ? { ...h, hp: 1 } : h,
    )
    return { ...s0, roster }
  }

  it('heals 50% and revives at 50% as a rest does, with a camp effect carrying the amounts', () => {
    const s = wounded()
    const r = run(s, [{ t: 'camp' }])
    const rested = run(s, [{ t: 'rest' }]).state
    expect(r.state.roster).toEqual(rested.roster)
    const [k, b, w] = s.party
    // The Knight's maximum is 60 and the Black Mage's 36; the White Mage is whole.
    expect(r.effects).toEqual([
      {
        k: 'camp',
        heals: [
          { heroId: k, amount: 30 },
          { heroId: b, amount: 18 },
          { heroId: w, amount: 0 },
        ],
      },
    ])
  })

  it('heals in place in boss mode and leaves Haste and Guard on', () => {
    const s = run(wounded(), [
      {
        t: 'boss_engaged',
        bossId: 'wb1',
        name: 'The Promptwyrm',
        glyph: '☠',
        stats: { hp: 900, atk: 18, def: 6, spd: 5 },
      },
      turnStart,
      guardOn,
    ]).state
    const r = run(s, [{ t: 'camp' }])
    expect(r.state.encounter).toEqual(s.encounter)
    expect(r.state.boss).toEqual(s.boss)
    expect(hero(r.state, 0).hp).toBe(30)
    expect(r.state.hasteTicks).toBe(90)
    expect(r.state.guardTicks).toBe(60)
  })
})

describe('spawn by tool kind', () => {
  const call = (hint?: 'swift' | 'brute' | 'caster' | 'tank'): Event =>
    hint ? { t: 'tool_call', hint } : { t: 'tool_call' }

  it("a hinted call spawns the zone's enemy of that archetype, ahead of the wave it opens", () => {
    const s = createInitialState(1)
    const front = (state: GameState, hint: WaveArchetype) =>
      run(state, [call(hint)]).state.encounter?.enemies[0]?.def
    expect(front(s, 'swift')).toBe('field_rat')
    expect(front(s, 'tank')).toBe('road_slime')
    const zone2: GameState = { ...s, zone: 2, highestZone: 2 }
    expect(front(zone2, 'swift')).toBe('bramble_wolf')
    expect(front(zone2, 'caster')).toBe('whisper_wisp')
  })

  it('a hint the wave list lacks draws as an unhinted call does', () => {
    const s = createInitialState(1)
    const odd = { t: 'tool_call', hint: 'boss' } as unknown as Event
    expect(run(s, [odd, odd, odd])).toEqual(run(s, [call(), call(), call()]))
  })

  it('holds the fight at 3 and the queue at 10, every call one of the kind', () => {
    const drawn = (run(createInitialState(1), [call('brute')]).state.encounter?.waveSize ?? 0) - 1
    const s = run(createInitialState(1), times(14, call('brute'))).state
    expect(s.encounter?.enemies).toHaveLength(3)
    expect(s.encounter?.queue).toHaveLength(10)
    expect(s.encounter?.queue.every((q) => q.kind === 'wave')).toBe(true)
    // The first call's enemy, its draw, then each later call's: all of the kind but the draw.
    const all = [...(s.encounter?.enemies ?? []), ...(s.encounter?.queue ?? [])].map((e) => e.def)
    expect(all[0]).toBe('goblin_scout')
    expect(all.slice(1 + drawn)).toEqual(times(12 - drawn, 'goblin_scout'))
  })

  it('spawns nothing in boss mode and changes no boss', () => {
    const s = run(createInitialState(1), [
      {
        t: 'boss_engaged',
        bossId: 'wb1',
        name: 'The Promptwyrm',
        glyph: '☠',
        stats: { hp: 900, atk: 18, def: 6, spd: 5 },
      },
    ]).state
    const r = run(s, [call('tank')])
    expect(r.state.encounter).toEqual(s.encounter)
    expect(r.state.turnToolCalls).toBe(s.turnToolCalls + 1)
  })

  it("leaves the zone boss alone at the boss's wave", () => {
    const s = injectEnemy({ ...createInitialState(1), wave: 11 }, 'bandit_captain')
    const r = run(s, [call('swift')])
    expect(r.state.encounter?.enemies.map((e) => [e.def, e.kind])).toEqual([
      ['bandit_captain', 'zone_boss'],
      ['field_rat', 'wave'],
    ])
    expect(r.state.encounter?.enemies[0]).toEqual(s.encounter?.enemies[0])
  })
})

describe('rewards follow the HP share', () => {
  // Sim 14 paid every wave enemy of zone 10 the zone's base: 65 xp, 3 to 9 gold, a 15% drop.
  // Now each pays the base × its archetype's hp share over the four shares' mean, 10,750, floored.
  const pays = (id: string, zone: number) => {
    const d = enemyAt(id, zone)
    return d && { xp: d.xp, gold: d.gold, dropBp: d.dropBp }
  }

  it("scales a wave enemy's xp, gold and drop chance by its share: a tank ×1.30, a swift ×0.74", () => {
    expect(pays('star_sentinel', 10)).toEqual({ xp: 84, gold: [3, 11], dropBp: 1953 })
    expect(pays('comet_hound', 10)).toEqual({ xp: 48, gold: [2, 6], dropBp: 1116 })
    expect(pays('spire_warden', 10)).toEqual({ xp: 72, gold: [3, 10], dropBp: 1674 })
    expect(pays('astral_seer', 10)).toEqual({ xp: 54, gold: [2, 7], dropBp: 1255 })
  })

  it('keeps reward per point of enemy hp level across the four kinds, past tier 1 too', () => {
    for (const zone of [10, 13]) {
      const wave = (zoneAt(zone)?.def.enemies ?? []).map((id) => enemyAt(id, zone))
      const perHp = wave.map((d) => (d ? d.xp / d.stats.hp : 0))
      const spread = Math.max(...perHp) / Math.min(...perHp)
      expect(spread, `zone ${zone}`).toBeLessThan(1.05)
    }
  })

  it('averages the base over the four kinds, less what the floor drops', () => {
    for (const [zone, base] of [
      [1, 6],
      [10, 65],
      [13, 73],
    ] as const) {
      const xp = (zoneAt(zone)?.def.enemies ?? []).map((id) => enemyAt(id, zone)?.xp ?? 0)
      const mean = xp.reduce((a, b) => a + b, 0) / xp.length
      expect(mean, `zone ${zone}`).toBeLessThanOrEqual(base)
      expect(mean, `zone ${zone}`).toBeGreaterThan(base - 1)
    }
  })

  it('leaves zone bosses and turn bosses as sim 14 paid them', () => {
    expect(pays('fallen_star', 10)).toEqual({ xp: 520, gold: [24, 72], dropBp: 10000 })
    expect(pays('void_manta', 10)).toEqual({ xp: 260, gold: [12, 36], dropBp: 6000 })
    expect(pays('bandit_captain', 13)).toEqual({ xp: 584, gold: [24, 96], dropBp: 10000 })
    expect(pays('wild_boar', 13)).toEqual({ xp: 292, gold: [12, 48], dropBp: 6000 })
  })

  it("a zone 1 tank's kill gives each living hero 7 xp, its base of 6 at ×1.30", () => {
    const s0 = injectEnemy(createInitialState(1), 'road_slime')
    const slime = front(s0)
    const s: GameState = {
      ...s0,
      encounter: s0.encounter && { ...s0.encounter, enemies: [{ ...slime, hp: 1 }] },
      battle: { gauges: [{ id: s0.party[0], g: GAUGE_FULL - 1 }], queue: [], busy: 0 },
    }
    const r = run(s, [tick])
    expect(r.state.stats.kills).toBe(1)
    expect(hero(r.state, 0).xp - hero(s, 0).xp).toBe(7)
  })
})
