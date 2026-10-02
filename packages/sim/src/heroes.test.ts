import { describe, expect, it } from 'vitest'
import { content } from './content'
import { generateHero } from './heroes'
import { clone } from './progression'
import { createInitialState } from './state'

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
