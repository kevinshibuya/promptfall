import { describe, expect, it } from 'vitest'
import { content } from './index'
import { validateContent } from './validate'

describe('validateContent', () => {
  it('finds no problems in the shipped content', () => {
    expect(validateContent(content)).toEqual([])
  })

  it('names the zone and the id of a missing enemy', () => {
    const [first, ...rest] = content.zones
    if (!first) throw new Error('no zones')
    const broken = {
      ...content,
      zones: [{ ...first, enemies: ['ghost_enemy', ...first.enemies.slice(1)] }, ...rest],
    }
    const problems = validateContent(broken)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('zone 1')
    expect(problems[0]).toContain('ghost_enemy')
  })

  it('names a hero class with no tactic and a negative weight', () => {
    const broken = {
      ...content,
      tactics: {
        ...content.tactics,
        heroes: {
          ...content.tactics.heroes,
          archer: [],
          knight: [
            {
              action: 'attack' as const,
              weight: { kind: 'fixed' as const, weight: -1 },
              target: { kind: 'none' as const },
            },
          ],
        },
      },
    }
    const problems = validateContent(broken)
    expect(problems).toHaveLength(2)
    expect(problems.some((p) => p.includes('archer') && p.includes('at least one tactic'))).toBe(
      true,
    )
    expect(problems.some((p) => p.includes('knight') && p.includes('non-negative'))).toBe(true)
  })
})
