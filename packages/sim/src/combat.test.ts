import { describe, expect, it } from 'vitest'
import {
  ACTION_STEPS,
  fill,
  GAUGE_FULL,
  POWER_BP,
  SPAWN_GAUGE_MAX,
  STEP_MS,
  scaled,
} from './battle'
import { scaledBossStats } from './combat'
import { content } from './content'
import { heroStats, livingParty } from './progression'
import { createInitialState } from './state'
import { step } from './step'
import type { Effect, Enemy, EnemyKind, Event, GameState, Item, Stats } from './types'

describe('combat', () => {
  it('kills at least one enemy and grants gold within 40 ticks from the initial state', () => {
    const r = run(createInitialState(7), times(40, { t: 'tick' } as const))
    expect(r.state.stats.kills).toBeGreaterThanOrEqual(1)
    expect(r.state.gold).toBeGreaterThan(0)
    expect(r.effects.some((e) => e.k === 'gold')).toBe(true)
    expect(r.state.tick).toBeGreaterThan(0)
  })

  it('a zone 12 boss wipes a level 1 party at zone 3 and retreats to zone 2 at full hp', () => {
    let s: GameState = { ...createInitialState(3), zone: 3, highestZone: 3, wave: 4 }
    s = injectEnemy(s, 'unwritten_one')
    const r = run(s, times(50, { t: 'tick' } as const))
    const wipe = r.effects.find((e) => e.k === 'wipe')
    expect(wipe).toEqual({ k: 'wipe', retreatedTo: 2 })
    // Stop at the wipe: replay up to it.
    let t = s
    for (let i = 0; i < 50; i++) {
      const step = run(t, [{ t: 'tick' }])
      t = step.state
      if (step.effects.some((e) => e.k === 'wipe')) break
    }
    expect(t.zone).toBe(2)
    expect(t.wave).toBe(1)
    expect(t.encounter).toBeNull()
    expect(t.stats.wipes).toBe(1)
    for (const id of t.party) {
      const hero = t.roster.find((h) => h.id === id)
      if (!hero) throw new Error('missing hero')
      expect(hero.hp).toBe(heroStats(t, hero).hp)
    }
  })

  it('a white mage left alone attacks instead of healing herself', () => {
    // Seen live: Knight and Black Mage down, two Goblin Scouts, the White Mage
    // in a Healer's Mace healing herself as fast as they hurt her. Nobody
    // attacked, and the fight never ended.
    const s0 = createInitialState(12)
    const mage = s0.roster.find((h) => h.cls === 'white_mage')
    if (!mage) throw new Error('mage')
    const roster = s0.roster.map((h) =>
      h.cls === 'knight' || h.cls === 'black_mage'
        ? { ...h, hp: 0 }
        : h.id === mage.id
          ? { ...h, hp: 14, equipment: { ...h.equipment, weapon: 'imace' } }
          : h,
    )
    const mace: Item = {
      id: 'imace',
      base: 'healers_mace',
      rarity: 'common',
      affixes: [],
      equippedBy: mage.id,
      tradeableAt: null,
    }
    let s: GameState = injectEnemy(
      injectEnemy({ ...s0, roster, inventory: [mace] }, 'goblin_scout'),
      'goblin_scout',
    )
    const enc = s.encounter
    const [a, b] = enc?.enemies ?? []
    if (!enc || !a || !b) throw new Error('enc')
    s = {
      ...s,
      encounter: {
        ...enc,
        enemies: [
          { ...a, hp: 61 },
          { ...b, hp: 65 },
        ],
      },
    }
    const r = run(s, times(30, { t: 'tick' } as const))
    const wiped = r.effects.some((e) => e.k === 'wipe')
    const hurt = r.effects.length > 0 && (r.state.encounter?.enemies ?? []).some((e) => e.hp < 61)
    expect(wiped || hurt || r.state.stats.kills > 0).toBe(true)
  })

  it('two or three White Mages still fight', () => {
    // Before the one-heal rule (now gone, grill 1.8), three level 5 White Mages on seed 1 went
    // 1155 rounds without a kill. Heal now waits for an ally below 50%.
    for (const n of [2, 3]) {
      const s0 = createInitialState(1)
      const wm = s0.roster.find((h) => h.cls === 'white_mage')
      const knight = s0.roster.find((h) => h.cls === 'knight')
      if (!wm || !knight) throw new Error('roster')
      const extra = ['hw2', 'hw3'].map((id) => ({ ...wm, id, level: 5 }))
      const roster = [
        ...s0.roster.map((h) => ({ ...h, level: 5, hp: h.id === knight.id && n === 2 ? 0 : h.hp })),
        ...extra,
      ]
      const party: [string, string, string] =
        n === 3 ? [wm.id, 'hw2', 'hw3'] : [wm.id, 'hw2', knight.id]
      let s: GameState = { ...s0, roster, party }
      let since = 0
      let worst = 0
      for (let i = 0; i < 2000; i++) {
        const r = step(s, { t: 'tick' })
        s = r.state
        const progress = r.effects.some((e) => e.k === 'gold' || e.k === 'wipe') || !s.encounter
        since = progress ? 0 : since + 1
        worst = Math.max(worst, since)
      }
      expect({ n, worst: worst < 200 }).toEqual({ n, worst: true })
    }
  })

  it('heroStats adds a rare weapon at 12000 bp plus its affixes', () => {
    const s0 = createInitialState(1)
    const knight = s0.roster[0]
    if (!knight) throw new Error('no knight')
    const item: Item = {
      id: 'iX',
      base: 'steel_longsword',
      rarity: 'rare',
      affixes: [
        { id: 'brutal', value: 5 },
        { id: 'swift', value: 2 },
      ],
      equippedBy: knight.id,
      tradeableAt: null,
    }
    const equipped = { ...knight, equipment: { ...knight.equipment, weapon: 'iX' } }
    const s: GameState = {
      ...s0,
      inventory: [item],
      roster: [equipped, ...s0.roster.slice(1)],
    }
    const before = heroStats(s0, knight)
    const after = heroStats(s, equipped)
    const baseAtk = content.itemBases.steel_longsword?.stats.atk ?? 0
    expect(after.atk).toBe(before.atk + Math.floor((baseAtk * 12000) / 10000) + 5)
    expect(after.spd).toBe(before.spd + 2)
    expect(after.def).toBe(before.def)
  })
})

describe('the battle loop', () => {
  type Act = Extract<Effect, { k: 'act' }>
  type Hit = Extract<Effect, { k: 'hit' }>
  const acts = (effects: Effect[]): Act[] => effects.filter((e): e is Act => e.k === 'act')
  const hits = (effects: Effect[]): Hit[] => effects.filter((e): e is Hit => e.k === 'hit')

  it('a tick has at most 4 actions, 500 ms apart or more, on 100 ms steps', () => {
    let s = createInitialState(9)
    let seen = 0
    for (let i = 0; i < 400; i++) {
      const r = step(s, { t: 'tick' })
      s = r.state
      const list = acts(r.effects)
      seen += list.length
      expect(list.length).toBeLessThanOrEqual(4)
      list.forEach((a, j) => {
        expect(a.at % STEP_MS).toBe(0)
        expect(a.at).toBeGreaterThanOrEqual(0)
        expect(a.at).toBeLessThanOrEqual(1900)
        const prev = list[j - 1]
        if (prev) expect(a.at - prev.at).toBeGreaterThanOrEqual(ACTION_STEPS * STEP_MS)
      })
    }
    expect(seen).toBeGreaterThan(100)
  })

  it("an action's hits and heals are its actor's, up to the next act", () => {
    let s = createInitialState(11)
    let sweeps = 0
    for (let i = 0; i < 400; i++) {
      // A tool call every third tick puts several enemies on the field.
      if (i % 3 === 0) s = step(s, { t: 'tool_call' }).state
      const party = new Set(s.party)
      const r = step(s, { t: 'tick' })
      s = r.state
      let act: Act | null = null
      let targets: string[] = []
      for (const e of r.effects) {
        if (e.k === 'act') {
          act = e
          targets = []
        }
        if (e.k === 'hit' || e.k === 'heal') expect(e.by).toBe(act?.actor)
        // Heroes hit enemies and heal heroes; enemies hit heroes.
        if (e.k === 'hit') expect(party.has(e.target)).toBe(!party.has(e.by))
        if (e.k === 'heal') expect([party.has(e.by), party.has(e.target)]).toEqual([true, true])
        if (e.k === 'hit' && act?.action === 'attack_all') {
          // The black mage's sweep hits each enemy once.
          expect(targets).not.toContain(e.target)
          targets.push(e.target)
          if (targets.length === 2) sweeps += 1
        }
      }
    }
    expect(sweeps).toBeGreaterThan(0)
  })

  it('a faster hero acts more often, but less than twice as often', () => {
    const s0 = engaged({ hp: 100000, atk: 1, def: 0, spd: 0 })
    const fast = s0.roster.find((h) => h.cls === 'black_mage')
    const slow = s0.roster.find((h) => h.cls === 'knight')
    if (!fast || !slow) throw new Error('roster')
    const base = Object.values(content.itemBases).find(
      (b) => b.slot === 'accessory' && b.classes.includes('black_mage') && !b.stats.spd,
    )
    if (!base) throw new Error('no accessory')
    const item: Item = {
      id: 'ifast',
      base: base.id,
      rarity: 'common',
      affixes: [{ id: 'swift', value: 9 - heroStats(s0, fast).spd }],
      equippedBy: fast.id,
      tradeableAt: null,
    }
    let s: GameState = {
      ...s0,
      inventory: [item],
      roster: s0.roster.map((h) =>
        h.id === fast.id
          ? { ...h, hp: 99999, equipment: { ...h.equipment, accessory: 'ifast' } }
          : { ...h, hp: 99999 },
      ),
    }
    const fastHero = s.roster.find((h) => h.id === fast.id)
    if (!fastHero) throw new Error('fast')
    expect(heroStats(s, fastHero).spd).toBe(9)
    expect(heroStats(s, slow).spd).toBe(4)
    const count = new Map<string, number>()
    for (let i = 0; i < 50; i++) {
      const r = step(s, { t: 'tick' })
      s = r.state
      for (const a of acts(r.effects)) count.set(a.actor, (count.get(a.actor) ?? 0) + 1)
    }
    const f = count.get(fast.id) ?? 0
    const w = count.get(slow.id) ?? 0
    expect(f).toBeGreaterThan(w)
    expect(f).toBeLessThan(2 * w)
  })

  it('two units that fill in the same step act in overflow order', () => {
    const s0 = injectEnemy(createInitialState(5), 'road_slime')
    const [knight, mage] = livingParty(s0)
    const enemy = s0.encounter?.enemies[0]
    if (!knight || !mage || !enemy) throw new Error('setup')
    // The knight fills more slowly but overflows more: it acts first.
    const s: GameState = {
      ...s0,
      battle: {
        gauges: [
          { id: knight.id, g: GAUGE_FULL - 1 },
          { id: mage.id, g: GAUGE_FULL - fill(heroStats(s0, mage).spd) + 1 },
          { id: enemy.id, g: 0 },
        ],
        queue: [],
        busy: 0,
      },
    }
    const list = acts(step(s, { t: 'tick' }).effects)
    expect(list.slice(0, 2).map((a) => [a.actor, a.at])).toEqual([
      [knight.id, 0],
      [mage.id, ACTION_STEPS * STEP_MS],
    ])
  })

  it('the white mage heals with a heal effect and no hit', () => {
    for (let seed = 1; seed < 50; seed++) {
      const s0 = injectEnemy(createInitialState(seed), 'road_slime')
      const mage = s0.roster.find((h) => h.cls === 'white_mage')
      const knight = s0.roster.find((h) => h.cls === 'knight')
      if (!mage || !knight) throw new Error('roster')
      const max = heroStats(s0, knight).hp
      const s: GameState = {
        ...s0,
        roster: s0.roster.map((h) => (h.id === knight.id ? { ...h, hp: Math.floor(max / 10) } : h)),
        battle: { gauges: [{ id: mage.id, g: GAUGE_FULL - 1 }], queue: [], busy: 0 },
      }
      const r = step(s, { t: 'tick' })
      const first = r.effects.findIndex((e) => e.k === 'act' && e.actor === mage.id)
      const act = r.effects[first]
      if (act?.k !== 'act' || act.action !== 'heal') continue
      const next = r.effects.findIndex((e, i) => i > first && e.k === 'act')
      const own = r.effects.slice(first + 1, next < 0 ? undefined : next)
      expect(own).toHaveLength(1)
      expect(own[0]).toMatchObject({ k: 'heal', by: mage.id, target: knight.id })
      const healed = r.state.roster.find((h) => h.id === knight.id)
      expect(own[0]?.k === 'heal' && own[0].amount).toBeGreaterThan(0)
      expect(healed?.hp).toBeGreaterThan(Math.floor(max / 10))
      return
    }
    throw new Error('no heal in 50 seeds')
  })

  it('a wipe empties the battle; a rest leaves it; a spawned enemy starts at 0 to 50%', () => {
    let s: GameState = { ...createInitialState(3), zone: 3, highestZone: 3, wave: 4 }
    s = injectEnemy(s, 'unwritten_one')
    let wiped: GameState | null = null
    for (let i = 0; i < 50 && !wiped; i++) {
      const r = step(s, { t: 'tick' })
      s = r.state
      if (r.effects.some((e) => e.k === 'wipe')) wiped = s
      else if (i === 2) {
        const rested = step(s, { t: 'rest' }).state
        expect(rested.battle).toEqual(s.battle)
        expect(s.battle.gauges.length).toBeGreaterThan(0)
      }
    }
    expect(wiped?.battle).toEqual({ gauges: [], queue: [], busy: 0 })

    for (let seed = 1; seed < 30; seed++) {
      const spawned = step(createInitialState(seed), { t: 'tool_call' }).state
      const id = spawned.encounter?.enemies[0]?.id
      const g = spawned.battle.gauges.find((e) => e.id === id)?.g ?? -1
      expect(g).toBeGreaterThanOrEqual(0)
      expect(g).toBeLessThanOrEqual(SPAWN_GAUGE_MAX)
    }
  })

  it('a fallen hero leaves the queue with an empty gauge', () => {
    let s = injectEnemy(createInitialState(4), 'unwritten_one')
    for (let i = 0; i < 50; i++) {
      const r = step(s, { t: 'tick' })
      s = r.state
      const fell = r.effects.find((e) => e.k === 'hero_fell')
      if (fell?.k !== 'hero_fell' || r.effects.some((e) => e.k === 'wipe')) continue
      expect(s.battle.queue).not.toContain(fell.heroId)
      expect(s.battle.gauges.find((e) => e.id === fell.heroId)?.g ?? 0).toBe(0)
      return
    }
    throw new Error('nobody fell')
  })

  it('a world-boss hit reports its amount while the boss hp stays put', () => {
    const s = engaged({ hp: 630, atk: 14, def: 4, spd: 5 })
    const boss = s.encounter?.enemies[0]
    if (!boss) throw new Error('no boss')
    const r = run(s, times(3, { t: 'tick' } as const))
    const onBoss = hits(r.effects).filter((h) => h.target === boss.id)
    expect(onBoss.length).toBeGreaterThan(0)
    const dealt = onBoss.reduce((sum, h) => sum + h.amount, 0)
    expect(r.state.boss?.dealt).toBe((s.boss?.dealt ?? 0) + dealt)
    expect(r.state.encounter?.enemies[0]?.hp).toBe(boss.hp)
    expect(scaledBossStats(s).atk).toBeGreaterThan(0)
  })

  it('an engaged world boss gets a gauge of 0 to 50%; disengaging drops it', () => {
    const s = engaged({ hp: 630, atk: 14, def: 4, spd: 5 })
    const id = s.encounter?.enemies[0]?.id ?? ''
    const g = s.battle.gauges.find((e) => e.id === id)?.g ?? -1
    expect(g).toBeGreaterThanOrEqual(0)
    expect(g).toBeLessThanOrEqual(SPAWN_GAUGE_MAX)
    const off = step(
      { ...s, battle: { ...s.battle, queue: [id] } },
      {
        t: 'boss_disengaged',
        bossId: 'wb1',
      },
    ).state
    expect(off.battle.gauges.some((e) => e.id === id)).toBe(false)
    expect(off.battle.queue).toEqual([])
  })

  it('a kill that ends the fight at step 0 leaves nobody busy by the end of the tick', () => {
    const s0 = injectEnemy(createInitialState(5), 'road_slime')
    const enc = s0.encounter
    const enemy = enc?.enemies[0]
    const knight = s0.roster.find((h) => h.cls === 'knight')
    if (!enc || !enemy || !knight) throw new Error('setup')
    const s: GameState = {
      ...s0,
      encounter: { ...enc, enemies: [{ ...enemy, hp: 1 }] },
      battle: { gauges: [{ id: knight.id, g: GAUGE_FULL - 1 }], queue: [], busy: 0 },
    }
    const r = step(s, { t: 'tick' })
    expect(acts(r.effects)[0]).toMatchObject({ actor: knight.id, at: 0 })
    expect(r.state.encounter?.enemies ?? []).toEqual([])
    expect(r.state.battle.busy).toBe(0)
  })

  it('a spawn-only tick leaves nobody busy', () => {
    const s: GameState = { ...createInitialState(5), battle: { gauges: [], queue: [], busy: 3 } }
    const r = step(s, { t: 'tick' })
    expect(r.state.encounter?.enemies.length).toBe(1)
    expect(r.state.battle.busy).toBe(0)
  })

  it("a kill's drop follows the hit that killed its enemy", () => {
    for (let seed = 1; seed < 400; seed++) {
      const s0 = injectEnemy(createInitialState(seed), 'goblin_scout')
      const enc = s0.encounter
      const enemy = enc?.enemies[0]
      const knight = s0.roster.find((h) => h.cls === 'knight')
      if (!enc || !enemy || !knight) throw new Error('enc')
      const s: GameState = {
        ...s0,
        encounter: { ...enc, enemies: [{ ...enemy, hp: 1 }] },
        battle: { gauges: [{ id: knight.id, g: GAUGE_FULL - 1 }], queue: [], busy: 0 },
      }
      const r = run(s, [{ t: 'tick' }])
      const at = r.effects.findIndex((e) => e.k === 'drop' || e.k === 'drop_vendored')
      if (at < 0) continue
      const before = hits(r.effects.slice(0, at))
      expect(before.at(-1)?.target).toBe(enemy.id)
      return
    }
    throw new Error('no drop in 400 seeds')
  })
})

describe('mitigation', () => {
  type Hit = Extract<Effect, { k: 'hit' }>
  const hits = (effects: Effect[]): Hit[] => effects.filter((e): e is Hit => e.k === 'hit')

  /** The Knight's hits on a world boss of this defence, the Knight's atk raised to 1000 by an affix. */
  function knightHits(def: number): number[] {
    const s0 = engaged({ hp: 100000, atk: 1, def, spd: 0 })
    const knight = s0.roster.find((h) => h.cls === 'knight')
    if (!knight) throw new Error('roster')
    const atk = heroStats(s0, knight).atk
    const ring: Item = {
      id: 'iatk',
      base: 'copper_ring',
      rarity: 'common',
      affixes: [{ id: 'mighty', value: 1000 - atk - 1 }],
      equippedBy: knight.id,
      tradeableAt: null,
    }
    let s: GameState = {
      ...s0,
      inventory: [ring],
      roster: s0.roster.map((h) =>
        h.id === knight.id ? { ...h, equipment: { ...h.equipment, accessory: 'iatk' } } : h,
      ),
    }
    const armed = s.roster.find((h) => h.id === knight.id)
    if (!armed) throw new Error('knight')
    expect(heroStats(s, armed).atk).toBe(1000)
    const out: number[] = []
    for (let i = 0; i < 60; i++) {
      const r = step(s, { t: 'tick' })
      s = r.state
      for (const h of hits(r.effects)) if (h.by === knight.id) out.push(h.amount)
    }
    expect(out.length).toBeGreaterThan(10)
    return out
  }

  it('a hit against a defence of 0 lands the whole attack, ±10%, doubled by power', () => {
    for (const amount of knightHits(0)) {
      expect(amount).toBeGreaterThanOrEqual(2 * 900)
      expect(amount).toBeLessThanOrEqual(2 * 1100)
    }
  })

  it('a hit against a defence of 100 lands half the attack, ±10%, doubled by power', () => {
    const amounts = knightHits(100)
    for (const amount of amounts) {
      expect(amount).toBeGreaterThanOrEqual(2 * 450)
      expect(amount).toBeLessThanOrEqual(2 * 550)
    }
    // The variance still spreads the hits: not every hit lands the same.
    expect(new Set(amounts).size).toBeGreaterThan(1)
  })

  it('a hit never lands below 1 before the power doubling, whatever the defence', () => {
    // An atk-1 world boss on heroes with defence above 0: every hit rounds to its floor of 1.
    let s = engaged({ hp: 100000, atk: 1, def: 0, spd: 20 })
    const boss = s.encounter?.enemies[0]?.id
    const amounts: number[] = []
    for (let i = 0; i < 20; i++) {
      const r = step(s, { t: 'tick' })
      s = r.state
      for (const h of hits(r.effects)) if (h.by === boss) amounts.push(h.amount)
    }
    expect(amounts.length).toBeGreaterThan(0)
    expect(new Set(amounts)).toEqual(new Set([scaled(1)]))
  })
})

describe('power scaling', () => {
  it('stays integer and at least 1 for any power', () => {
    expect(scaled(8, 21000)).toBe(16)
    for (const power of [POWER_BP, 21000, 13333, 9999]) {
      for (let raw = 1; raw <= 200; raw++) {
        const v = scaled(raw, power)
        expect(Number.isInteger(v)).toBe(true)
        expect(v).toBeGreaterThanOrEqual(1)
      }
    }
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

function engaged(stats: Stats): GameState {
  return step(createInitialState(1), {
    t: 'boss_engaged',
    bossId: 'wb1',
    name: 'The Promptwyrm',
    glyph: '☠',
    stats,
  }).state
}
