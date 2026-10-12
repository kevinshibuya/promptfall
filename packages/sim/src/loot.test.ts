import { describe, expect, it } from 'vitest'
import { content } from './content'
import type { EnemyDef } from './content/types'
import { clone } from './draft'
import { rollDrops } from './loot'
import { createInitialState } from './state'
import type { Effect, GameState } from './types'

function forced(defId: string): EnemyDef {
  const def = content.enemies[defId]
  if (!def) throw new Error(defId)
  return { ...def, dropBp: 10000, contractBp: 0 }
}

function dropMany(
  state: GameState,
  def: EnemyDef,
  n: number,
): { state: GameState; effects: Effect[] } {
  const s = clone(state)
  const effects: Effect[] = []
  for (let i = 0; i < n; i++) effects.push(...rollDrops(s, def).effects)
  return { state: s, effects }
}

describe('rollDrops', () => {
  it('a forced drop matches its rarity and admits a party class', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const s = createInitialState(seed)
      const r = dropMany(s, forced('goblin_scout'), 1)
      const drop = r.effects.find((e) => e.k === 'drop')
      if (drop?.k !== 'drop') throw new Error('no drop')
      const { item } = drop
      expect(item.affixes).toHaveLength(content.rarity[item.rarity].affixCount)
      expect(new Set(item.affixes.map((a) => a.id)).size).toBe(item.affixes.length)
      const base = content.itemBases[item.base]
      expect(base?.minZone).toBeLessThanOrEqual(1)
      const partyClasses = s.party.map((id) => s.roster.find((h) => h.id === id)?.cls)
      expect(base?.classes.some((c) => partyClasses.includes(c))).toBe(true)
      for (const affix of item.affixes) {
        const def = content.affixes[affix.id]
        expect(def?.slots).toContain(base?.slot)
        expect(affix.value).toBeGreaterThanOrEqual(def?.range[0] ?? 0)
        expect(affix.value).toBeLessThanOrEqual(def?.range[1] ?? 0)
      }
      expect(item.equippedBy).toBeNull()
      expect(r.state.inventory).toHaveLength(1)
      expect(r.state.lootLog).toHaveLength(1)
    }
  })

  it('a full inventory auto-vendors and the log keeps 50 entries', () => {
    const s = createInitialState(9)
    const r = dropMany(s, forced('goblin_scout'), 31)
    const kinds = r.effects.map((e) => e.k)
    expect(kinds.filter((k) => k === 'drop')).toHaveLength(30)
    expect(kinds[30]).toBe('drop_vendored')
    expect(r.state.inventory).toHaveLength(30)
    const last = r.state.lootLog[r.state.lootLog.length - 1]
    expect(last?.k === 'item' && last.vendoredFor).toBeGreaterThan(0)
    const r60 = dropMany(s, forced('goblin_scout'), 60)
    expect(r60.state.lootLog).toHaveLength(50)
  })

  it('equipped items occupy inventory slots', () => {
    const s = createInitialState(4)
    const first = dropMany(s, forced('goblin_scout'), 2)
    const [a, b] = first.state.inventory
    if (!a || !b) throw new Error('items')
    const owner = first.state.roster[0]?.id ?? ''
    const worn: GameState = {
      ...first.state,
      inventory: first.state.inventory.map((i) => ({ ...i, equippedBy: owner })),
    }
    const r = dropMany(worn, forced('goblin_scout'), 29)
    expect(r.effects.filter((e) => e.k === 'drop')).toHaveLength(28)
    expect(r.effects.filter((e) => e.k === 'drop_vendored')).toHaveLength(1)
  })

  it("a dropped item carries its base's tier: minimum zone 1 to 3 is tier 1, up to 10 to 12 at 4", () => {
    const tierOf = (minZone: number) => Math.ceil(minZone / 3)
    const seen = new Set<number>()
    for (let seed = 1; seed <= 60; seed++) {
      const s = { ...createInitialState(seed), zone: 12 }
      const drop = dropMany(s, forced('goblin_scout'), 1).effects.find((e) => e.k === 'drop')
      if (drop?.k !== 'drop') throw new Error('no drop')
      const minZone = content.itemBases[drop.item.base]?.minZone ?? 0
      expect(drop.item.tier, drop.item.base).toBe(tierOf(minZone))
      seen.add(drop.item.tier)
      for (const affix of drop.item.affixes) {
        const [min, max] = content.affixes[affix.id]?.range ?? [0, 0]
        expect(affix.value).toBeGreaterThanOrEqual(min)
        expect(affix.value).toBeLessThanOrEqual(max)
      }
    }
    expect([...seen].sort()).toEqual([1, 2, 3, 4])
  })

  it('contracts recruit a hero from a boss', () => {
    const s = createInitialState(2)
    const def = { ...forced('bandit_captain'), contractBp: 10000 }
    const r = dropMany(s, def, 1)
    const recruited = r.effects.find((e) => e.k === 'hero_recruited')
    expect(recruited?.k === 'hero_recruited' && recruited.via).toBe('contract')
    expect(r.state.roster).toHaveLength(5)
  })
})
