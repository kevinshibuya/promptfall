import { describe, expect, it } from 'vitest'
import { createInitialState } from '../state'
import { achievementCount, content } from './index'
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

describe('the achievement table', () => {
  const byId = (id: string) => {
    const row = content.achievements.find((a) => a.id === id)
    if (!row) throw new Error(`no achievement ${id}`)
    return row
  }

  it('has unique ids and steps rising from 1, each reason fitting the credit', () => {
    const ids = content.achievements.map((a) => a.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const row of content.achievements) {
      expect(row.steps.length).toBeGreaterThan(0)
      for (let i = 1; i < row.steps.length; i++) {
        expect(row.steps[i]?.at).toBeGreaterThan(row.steps[i - 1]?.at ?? 0)
      }
      expect(`achievement:${row.id}:${row.steps.length}`.length).toBeLessThanOrEqual(64)
    }
  })

  it('pays 100, 400, 1,500 and 5,000 up a ladder and 500 for a one-off', () => {
    expect(byId('kills').steps.map((s) => [s.at, s.gold])).toEqual([
      [100, 100],
      [1000, 400],
      [10_000, 1500],
      [100_000, 5000],
    ])
    expect(byId('turn_bosses').steps.map((s) => s.gold)).toEqual([100, 400, 1500])
    expect(byId('kills').steps[1]?.words).toBe('a thousand kills')
    for (const id of ['first_epic', 'zone_6', 'tier_3', 'clean_boss', 'all_capped']) {
      expect(byId(id).steps).toEqual([expect.objectContaining({ gold: 500 })])
    }
  })

  it('ladders the collection within the bases, and the bestiary up to every zone', () => {
    const last = byId('bases_complete').steps.at(-1)?.at ?? 0
    expect(last).toBe(35)
    expect(last).toBeLessThanOrEqual(Object.keys(content.itemBases).length)
    expect(byId('zones_complete').steps.at(-1)?.at).toBe(content.zones.length)
  })
})

describe('achievementCount', () => {
  const s0 = createInitialState(1)
  const none = { goalsMet: 0, streak: 0 }

  it('reads nothing crossed from a fresh state', () => {
    for (const row of content.achievements) {
      if (row.reads === 'highest_zone' || row.reads === 'tier') continue
      expect([row.id, achievementCount(row.reads, s0, none)]).toEqual([row.id, 0])
    }
    expect(achievementCount('highest_zone', s0, none)).toBe(1)
    expect(achievementCount('tier', s0, none)).toBe(1)
  })

  it('counts a zone whose six enemies all fell, a base held in every rarity, and the journal', () => {
    const zone = content.zones[0]
    if (!zone) throw new Error('no zone')
    const enemies = Object.fromEntries(
      [...zone.enemies, zone.boss, zone.turnBoss].map((id) => [id, { seen: 1, defeated: 1 }]),
    )
    const every = { common: 1, uncommon: 1, rare: 1, epic: 1, legendary: 1 }
    const s = {
      ...s0,
      highestZone: 14,
      tallies: {
        ...s0.tallies,
        enemies,
        collection: { iron_sword: every, steel_longsword: { ...every, legendary: 0 } },
      },
    }
    const journal = { goalsMet: 7, streak: 3 }
    expect(achievementCount('zones_complete', s, journal)).toBe(1)
    expect(achievementCount('bases_complete', s, journal)).toBe(1)
    expect(achievementCount('epic_held', s, journal)).toBe(2)
    expect(achievementCount('legendary_held', s, journal)).toBe(1)
    expect(achievementCount('tier', s, journal)).toBe(2)
    expect(achievementCount('goals_met', s, journal)).toBe(7)
    expect(achievementCount('streak', s, journal)).toBe(3)
  })

  it('counts the classes with a hero at its level cap', () => {
    const capped = s0.roster.map((h) => ({ ...h, level: content.rarity[h.rarity].levelCap }))
    expect(achievementCount('classes_capped', { ...s0, roster: capped }, none)).toBe(4)
    expect(achievementCount('classes_capped', { ...s0, roster: capped.slice(1) }, none)).toBe(3)
  })
})
