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
})
