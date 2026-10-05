import { describe, expect, it } from 'vitest'
import { type Choice, pickAction, type Unit } from './picker'
import { heroStats } from './progression'
import { createInitialState } from './state'
import type { Enemy, GameState, Hero, HeroClass } from './types'

const DRAWS = 1000

function enemy(id: string, def: string, hp: number): Enemy {
  return { id, def, kind: 'wave', hp, maxHp: hp }
}

/** The starting party (knight, black mage, white mage) against three zone 1 enemies. */
function battle(): GameState {
  const s = createInitialState(42)
  s.encounter = {
    enemies: [
      enemy('e1', 'goblin_scout', 50),
      enemy('e2', 'field_rat', 30),
      enemy('e3', 'road_slime', 60),
    ],
    queue: [],
    waveSize: 3,
    spawnedInWave: 3,
  }
  return s
}

function hero(s: GameState, cls: HeroClass): Hero {
  const h = s.roster.find((r) => r.cls === cls)
  if (!h) throw new Error(cls)
  return h
}

/** The choices of one unit over DRAWS different rng positions. */
function choices(s: GameState, unit: (s: GameState) => Unit): (Choice | null)[] {
  const out: (Choice | null)[] = []
  for (let i = 0; i < DRAWS; i++) {
    const draft = structuredClone(s)
    draft.rng = (i * 2654435761 + 17) >>> 0
    out.push(pickAction(draft, unit(draft)))
  }
  return out
}

function share(list: (Choice | null)[], test: (c: Choice | null) => boolean): number {
  return list.filter(test).length / list.length
}

describe('pickAction', () => {
  it('a knight against three enemies picks the front one about 3 times in 5', () => {
    const list = choices(battle(), (s) => ({ side: 'hero', hero: hero(s, 'knight') }))
    expect(list.every((c) => c?.action === 'attack')).toBe(true)
    const front = share(list, (c) => c?.targetId === 'e1')
    expect(front).toBeGreaterThanOrEqual(0.55)
    expect(front).toBeLessThanOrEqual(0.65)
  })

  it('an archer prefers the weakest enemy, 4 to 1', () => {
    const s = battle()
    const archer = hero(s, 'archer')
    s.party = [archer.id, s.party[1], s.party[2]]
    const list = choices(s, (d) => ({ side: 'hero', hero: hero(d, 'archer') }))
    const weakest = share(list, (c) => c?.targetId === 'e2')
    expect(weakest).toBeGreaterThanOrEqual(0.62)
    expect(weakest).toBeLessThanOrEqual(0.72)
  })

  it('the black mage attacks every enemy with no target to choose', () => {
    const list = choices(battle(), (s) => ({ side: 'hero', hero: hero(s, 'black_mage') }))
    for (const c of list) expect(c).toEqual({ action: 'attack_all', targetId: null })
  })

  it('the white mage never heals while every ally is at 50% or more', () => {
    const s = battle()
    for (const h of s.roster) h.hp = Math.ceil(heroStats(s, h).hp / 2)
    const list = choices(s, (d) => ({ side: 'hero', hero: hero(d, 'white_mage') }))
    expect(share(list, (c) => c?.action === 'heal')).toBe(0)
    // She attacks the weakest enemy only.
    expect(list.every((c) => c?.targetId === 'e2')).toBe(true)
  })

  it('the white mage heals the lowest ally 3 times in 4 when it is at 25%', () => {
    const s = battle()
    const knight = hero(s, 'knight')
    knight.hp = Math.floor(heroStats(s, knight).hp / 4)
    const list = choices(s, (d) => ({ side: 'hero', hero: hero(d, 'white_mage') }))
    const heals = list.filter((c) => c?.action === 'heal')
    expect(heals.length / DRAWS).toBeGreaterThanOrEqual(0.7)
    expect(heals.length / DRAWS).toBeLessThanOrEqual(0.8)
    for (const c of heals) expect(c?.targetId).toBe(knight.id)
  })

  it('the white mage never heals when she is the only living hero', () => {
    const s = battle()
    for (const h of s.roster) if (h.cls !== 'white_mage') h.hp = 0
    const mage = hero(s, 'white_mage')
    mage.hp = 1
    const list = choices(s, (d) => ({ side: 'hero', hero: hero(d, 'white_mage') }))
    expect(share(list, (c) => c?.action === 'heal')).toBe(0)
  })

  it('an enemy against a knight and two others targets the knight about 73% of the time', () => {
    const list = choices(battle(), (s) => ({
      side: 'enemy',
      enemy: s.encounter?.enemies[0] as Enemy,
    }))
    const knight = hero(battle(), 'knight')
    const onKnight = share(list, (c) => c?.targetId === knight.id)
    expect(onKnight).toBeGreaterThanOrEqual(0.68)
    expect(onKnight).toBeLessThanOrEqual(0.78)
  })

  it('a hero with no enemy on the field has no choice and draws nothing', () => {
    const s = battle()
    if (s.encounter) s.encounter.enemies = []
    const rng = s.rng
    expect(pickAction(s, { side: 'hero', hero: hero(s, 'knight') })).toBeNull()
    expect(s.rng).toBe(rng)
  })

  it('touches nothing but the rng, and draws once', () => {
    const s = battle()
    hero(s, 'knight').hp = 3
    for (const cls of ['knight', 'black_mage', 'white_mage'] as const) {
      const before = structuredClone(s)
      pickAction(s, { side: 'hero', hero: hero(s, cls) })
      expect(s.rng).not.toBe(before.rng)
      expect({ ...s, rng: 0 }).toEqual({ ...before, rng: 0 })
    }
  })
})
