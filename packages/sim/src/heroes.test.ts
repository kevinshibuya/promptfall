import { describe, expect, it } from 'vitest'
import { content } from './content'
import { clone } from './draft'
import { generateHero, rollContract } from './heroes'
import { createInitialState } from './state'
import type { Effect } from './types'

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
