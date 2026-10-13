import { describe, expect, it } from 'vitest'
import { tavernGuarantees } from './commands'
import { content } from './content'
import { clone } from './draft'
import { generateHero, rollContract } from './heroes'
import { createInitialState } from './state'
import { step } from './step'
import type { Effect, GameState, Rarity } from './types'
import { RARITIES } from './types'

describe('generateHero', () => {
  it('rolls traits by rarity, an epithet, level 1 and full hp', () => {
    for (const rarity of ['common', 'uncommon', 'rare', 'epic', 'legendary'] as const) {
      const s = clone(createInitialState(3))
      const hero = generateHero(s, rarity)
      expect(hero.traits).toHaveLength(content.rarity[rarity].traitCount)
      expect(new Set(hero.traits.map((t) => t.id)).size).toBe(hero.traits.length)
      expect(content.epithets).toContain(hero.epithet)
      expect(hero.level).toBe(1)
      expect(hero.hp).toBeGreaterThan(0)
      expect(content.heroTemplates[hero.template]?.cls).toBe(hero.cls)
    }
  })

  it('gives the starting heroes epithets and keeps rng at the seed', () => {
    const s = createInitialState(21)
    expect(s.rng).toBe(21)
    for (const hero of s.roster) expect(content.epithets).toContain(hero.epithet)
  })
})

describe('rollContract', () => {
  /** The rarity a boss contract rolls at `zone`, from seed `seed`'s rng. */
  function contractAt(zone: number, seed: number): string | undefined {
    const s = clone({ ...createInitialState(seed), zone })
    const effects: Effect[] = []
    rollContract(s, effects)
    const recruited = effects.find((e) => e.k === 'hero_recruited')
    return recruited?.k === 'hero_recruited' ? recruited.hero.rarity : undefined
  }

  it("past tier 1 draws zone 12's rarity weights, as the Odds tab shows", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const at12 = contractAt(12, seed)
      expect(contractAt(13, seed)).toBe(at12)
      expect(contractAt(25, seed)).toBe(at12)
    }
  })

  it('differs from zone 1 at tier 2 for a seed where zone 1 draws a Common', () => {
    const seeds = Array.from({ length: 200 }, (_, i) => i + 1)
    const seed = seeds.find((n) => contractAt(1, n) === 'common' && contractAt(13, n) !== 'common')
    expect(seed).toBeDefined()
  })
})

describe('the tavern guarantee', () => {
  const rank = (r: Rarity) => RARITIES.indexOf(r)

  /** A tavern recruit from this state: the hero's rarity and the counts after it. */
  function hire(state: GameState): { rarity: Rarity; after: GameState } {
    const r = step({ ...state, gold: 100_000 }, { t: 'recruit' })
    const hired = r.effects.find((e) => e.k === 'hero_recruited')
    if (hired?.k !== 'hero_recruited') throw new Error('no recruit')
    return { rarity: hired.hero.rarity, after: r.state }
  }

  function at(seed: number, guarantee: GameState['guarantee']): GameState {
    return { ...createInitialState(seed), guarantee }
  }

  it('starts every count at zero, each guarantee its whole threshold away', () => {
    const s = createInitialState(1)
    expect(s.guarantee).toEqual({ rare: 0, epic: 0, legendary: 0 })
    expect(tavernGuarantees(s)).toEqual(content.tavern.guarantees)
    expect(content.tavern.guarantees).toEqual({ rare: 20, epic: 80, legendary: 400 })
  })

  it('a recruit below Rare raises all three counts', () => {
    const seed = Array.from({ length: 200 }, (_, i) => i + 1).find(
      (n) => rank(hire(at(n, { rare: 0, epic: 0, legendary: 0 })).rarity) < rank('rare'),
    )
    if (seed === undefined) throw new Error('no seed rolls below Rare')
    const { after } = hire(at(seed, { rare: 3, epic: 4, legendary: 5 }))
    expect(after.guarantee).toEqual({ rare: 4, epic: 5, legendary: 6 })
  })

  it('the twentieth recruit with no Rare since the last is at least Rare and resets the Rare count', () => {
    let lifted = 0
    for (let seed = 1; seed <= 60; seed++) {
      const plain = hire(at(seed, { rare: 0, epic: 0, legendary: 0 })).rarity
      const { rarity, after } = hire(at(seed, { rare: 19, epic: 30, legendary: 30 }))
      expect(rank(rarity)).toBeGreaterThanOrEqual(rank('rare'))
      // The roll is the same draw; the floor only lifts it.
      expect(rarity).toBe(rank(plain) >= rank('rare') ? plain : 'rare')
      if (plain !== rarity) lifted += 1
      expect(after.guarantee.rare).toBe(0)
      if (rarity === 'rare') expect(after.guarantee).toEqual({ rare: 0, epic: 31, legendary: 31 })
    }
    expect(lifted).toBeGreaterThan(0)
  })

  it('an Epic resets the Rare and Epic counts and leaves the Legendary count', () => {
    const seed = Array.from({ length: 200 }, (_, i) => i + 1).find(
      (n) => hire(at(n, { rare: 2, epic: 79, legendary: 50 })).rarity === 'epic',
    )
    if (seed === undefined) throw new Error('no seed lands on Epic')
    const { after } = hire(at(seed, { rare: 2, epic: 79, legendary: 50 }))
    expect(after.guarantee).toEqual({ rare: 0, epic: 0, legendary: 51 })
  })

  it('the four hundredth recruit with no Legendary is Legendary and resets every count', () => {
    const { rarity, after } = hire(at(7, { rare: 5, epic: 50, legendary: 399 }))
    expect(rarity).toBe('legendary')
    expect(after.guarantee).toEqual({ rare: 0, epic: 0, legendary: 0 })
  })

  it('a contract and a sandbox recruit leave all three counts alone', () => {
    const counts = { rare: 19, epic: 79, legendary: 399 }
    const sandbox = step(at(1, counts), { t: 'sandbox_recruit', rarity: 'legendary' }).state
    expect(sandbox.guarantee).toEqual(counts)
    const s = clone(at(1, counts))
    const effects: Effect[] = []
    rollContract(s, effects)
    expect(effects.some((e) => e.k === 'hero_recruited')).toBe(true)
    expect(s.guarantee).toEqual(counts)
  })

  it("reads the thresholds from the tavern's content", () => {
    const was = content.tavern.guarantees.rare
    content.tavern.guarantees.rare = 3
    try {
      expect(tavernGuarantees(at(1, { rare: 2, epic: 0, legendary: 0 })).rare).toBe(1)
      const { rarity } = hire(at(1, { rare: 2, epic: 0, legendary: 0 }))
      expect(rank(rarity)).toBeGreaterThanOrEqual(rank('rare'))
    } finally {
      content.tavern.guarantees.rare = was
    }
  })

  it('the remaining count reads 1 on the recruit before a guaranteed one, and never below', () => {
    expect(tavernGuarantees(at(1, { rare: 19, epic: 0, legendary: 0 })).rare).toBe(1)
    expect(tavernGuarantees(at(1, { rare: 18, epic: 79, legendary: 1 }))).toEqual({
      rare: 2,
      epic: 1,
      legendary: 399,
    })
    expect(tavernGuarantees(at(1, { rare: 25, epic: 0, legendary: 0 })).rare).toBe(1)
  })
})
