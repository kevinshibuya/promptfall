import { describe, expect, it } from 'vitest'
import { content } from './content'
import type { EnemyDef } from './content/types'
import { clone } from './draft'
import { rollDrops, rollRewardItem, vendorValue } from './loot'
import { createInitialState } from './state'
import { step } from './step'
import type { Effect, GameState, Rarity } from './types'

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

  it('drops in tier 2 at item tier 5, from every base, at zone 12’s rarity weights', () => {
    // Zone 12 already admits every base, so the same draws at zone 13 drop the same item a tier up.
    const bases = new Set<string>()
    for (let seed = 1; seed <= 60; seed++) {
      for (const boss of ['goblin_scout', 'bandit_captain']) {
        const at = (zone: number) => {
          const s = { ...createInitialState(seed), zone }
          const drop = dropMany(s, forced(boss), 1).effects.find((e) => e.k === 'drop')
          if (drop?.k !== 'drop') throw new Error('no drop')
          return drop.item
        }
        const item = at(13)
        expect(item).toEqual({ ...at(12), tier: 5 })
        bases.add(item.base)
      }
    }
    expect(bases.size).toBeGreaterThan(20)
  })

  it('drops in tier 3 at item tier 6, a world boss reward too', () => {
    const s = { ...createInitialState(3), zone: 25 }
    const drop = dropMany(s, forced('road_slime'), 1).effects.find((e) => e.k === 'drop')
    expect(drop?.k === 'drop' && drop.item.tier).toBe(6)
    expect(rollRewardItem(3, 36, ['knight'])?.tier).toBe(6)
    expect(rollRewardItem(3, 13, ['knight'])?.tier).toBe(5)
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

describe('auto-vendor', () => {
  /** The drop a sandbox grant makes of `base` at `rarity`: no enemy is up, so it drops alone. */
  function drop(s: GameState, base: string, rarity: Rarity) {
    const r = step(s, { t: 'sandbox_item', base, rarity })
    const [effect] = r.effects.filter((e) => e.k === 'drop' || e.k === 'drop_vendored')
    if (!effect) throw new Error(`no drop of ${base}`)
    return { state: r.state, effect }
  }

  /** The starting party with the Black Mage holding an Ember Rod: no party hero who wears a staff has the weapon slot empty. */
  function armed(autoVendor: boolean): GameState {
    const s = createInitialState(7)
    const mage = s.party[1]
    const rod = drop(s, 'ember_rod', 'common')
    if (rod.effect.k !== 'drop' || !mage) throw new Error('no rod')
    const worn = step(rod.state, { t: 'equip', heroId: mage, itemId: rod.effect.item.id }).state
    return step(worn, { t: 'set_auto_vendor', on: autoVendor }).state
  }

  it('off keeps every drop', () => {
    const s = armed(false)
    expect(s.autoVendor).toBe(false)
    for (const rarity of ['common', 'uncommon'] as const) {
      const r = drop({ ...s, zone: 12 }, 'oak_staff', rarity)
      expect(r.effect.k).toBe('drop')
      expect(r.state.inventory).toHaveLength(s.inventory.length + 1)
    }
  })

  it('on vendors a Common on pickup for its vendor value, the setting the cause', () => {
    const s = armed(true)
    const r = drop(s, 'oak_staff', 'common')
    if (r.effect.k !== 'drop_vendored') throw new Error(`kept: ${r.effect.k}`)
    expect(r.effect.cause).toBe('setting')
    expect(r.effect.gold).toBe(vendorValue(r.effect.item))
    expect(r.state.gold).toBe(s.gold + r.effect.gold)
    expect(r.state.inventory).toEqual(s.inventory)
    expect(r.state.lootLog.at(-1)).toEqual({
      k: 'item',
      itemId: r.effect.item.id,
      base: 'oak_staff',
      rarity: 'common',
      vendoredFor: r.effect.gold,
    })
  })

  it('keeps a Common a party hero has the slot empty for and could wear', () => {
    const s = createInitialState(7)
    const on = step(s, { t: 'set_auto_vendor', on: true }).state
    // The Black Mage's weapon slot is empty and a staff is hers to wear.
    expect(drop(on, 'oak_staff', 'common').effect.k).toBe('drop')
  })

  it('vendors it when only a hero who cannot wear it, or one out of the party, has the slot empty', () => {
    const s = armed(true)
    // The White Mage's weapon slot is empty, but an Oak Staff is the Black Mage's.
    expect(drop(s, 'oak_staff', 'common').effect.k).toBe('drop_vendored')
    // The Archer's weapon slot is empty, but the Archer is not in the party.
    expect(drop(s, 'oak_bow', 'common').effect.k).toBe('drop_vendored')
  })

  it('keeps an Uncommon at zone 3 and vendors it at zone 4, under the same exception', () => {
    const s = armed(true)
    expect(drop({ ...s, zone: 3 }, 'oak_staff', 'uncommon').effect.k).toBe('drop')
    expect(drop({ ...s, zone: 4 }, 'oak_staff', 'uncommon').effect.k).toBe('drop_vendored')
    const open = step(createInitialState(7), { t: 'set_auto_vendor', on: true }).state
    expect(drop({ ...open, zone: 4 }, 'oak_staff', 'uncommon').effect.k).toBe('drop')
  })

  it('never touches a Rare or better', () => {
    const s = armed(true)
    for (const rarity of ['rare', 'epic', 'legendary'] as const) {
      expect(drop({ ...s, zone: 12 }, 'oak_staff', rarity).effect.k).toBe('drop')
    }
  })

  it('a full inventory vendors with the full inventory the cause, setting on or off', () => {
    for (const on of [false, true]) {
      const s = armed(on)
      const r = drop({ ...s, inventoryCap: s.inventory.length }, 'oak_staff', 'rare')
      if (r.effect.k !== 'drop_vendored') throw new Error('kept')
      expect(r.effect.cause).toBe('full')
    }
  })
})
