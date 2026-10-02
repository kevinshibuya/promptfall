import { describe, expect, it } from 'vitest'
import { createInitialState } from './state'
import { step } from './step'
import type { Effect, GameState, Item } from './types'

function rejectedReason(effects: Effect[]): string | undefined {
  const e = effects.find((x) => x.k === 'rejected')
  return e?.k === 'rejected' ? e.reason : undefined
}

function item(id: string, base: string, equippedBy: string | null = null): Item {
  return { id, base, rarity: 'common', affixes: [], equippedBy }
}

const s0 = createInitialState(1)
const [knight, blackMage, whiteMage, archer] = s0.roster
if (!knight || !blackMage || !whiteMage || !archer) throw new Error('roster')

describe('recruit', () => {
  it('is rejected at 0 gold', () => {
    const r = step(s0, { t: 'recruit' })
    expect(rejectedReason(r.effects)).toBe('not_enough_gold')
    expect(r.state).toBe(s0)
  })

  it('costs 200 then 230', () => {
    const a = step({ ...s0, gold: 1000 }, { t: 'recruit' })
    expect(a.state.gold).toBe(800)
    expect(a.state.roster).toHaveLength(5)
    expect(a.state.recruits).toBe(1)
    expect(a.effects.some((e) => e.k === 'hero_recruited')).toBe(true)
    const b = step(a.state, { t: 'recruit' })
    expect(b.state.gold).toBe(570)
  })

  it('is rejected with a full roster', () => {
    const r = step({ ...s0, gold: 1000, rosterCap: 4 }, { t: 'recruit' })
    expect(rejectedReason(r.effects)).toBe('roster_full')
  })
})

describe('dismiss', () => {
  it('refuses the only knight', () => {
    const s: GameState = { ...s0, party: [blackMage.id, whiteMage.id, archer.id] }
    expect(rejectedReason(step(s, { t: 'dismiss', heroId: knight.id }).effects)).toBe(
      'last_of_class',
    )
  })

  it('refuses a hero in the party', () => {
    expect(rejectedReason(step(s0, { t: 'dismiss', heroId: knight.id }).effects)).toBe('in_party')
  })

  it('leaves the dismissed hero items in the inventory, unequipped', () => {
    const second = { ...archer, id: 'hz', equipment: { ...archer.equipment, weapon: 'iA' } }
    const s: GameState = {
      ...s0,
      roster: [...s0.roster, second],
      inventory: [item('iA', 'oak_bow', 'hz')],
    }
    const r = step(s, { t: 'dismiss', heroId: 'hz' })
    expect(r.state.roster.map((h) => h.id)).not.toContain('hz')
    expect(r.state.inventory).toEqual([item('iA', 'oak_bow', null)])
    expect(r.state.gold).toBe(4)
  })
})

describe('equip', () => {
  it('refuses a black mage staff on the knight', () => {
    const s = { ...s0, inventory: [item('iS', 'oak_staff')] }
    expect(rejectedReason(step(s, { t: 'equip', heroId: knight.id, itemId: 'iS' }).effects)).toBe(
      'class_mismatch',
    )
  })

  it('equips over an occupied slot and frees the old item', () => {
    const s = { ...s0, inventory: [item('i1', 'iron_sword'), item('i2', 'bronze_axe')] }
    const a = step(s, { t: 'equip', heroId: knight.id, itemId: 'i1' }).state
    const b = step(a, { t: 'equip', heroId: knight.id, itemId: 'i2' }).state
    expect(b.inventory.find((i) => i.id === 'i1')?.equippedBy).toBeNull()
    expect(b.inventory.find((i) => i.id === 'i2')?.equippedBy).toBe(knight.id)
    expect(b.roster[0]?.equipment.weapon).toBe('i2')
  })

  it('refuses an item equipped by another hero', () => {
    const second = { ...knight, id: 'hk2' }
    const s = {
      ...s0,
      roster: [...s0.roster, second],
      inventory: [item('i1', 'iron_sword', 'hk2')],
    }
    expect(rejectedReason(step(s, { t: 'equip', heroId: knight.id, itemId: 'i1' }).effects)).toBe(
      'already_equipped',
    )
  })
})

describe('vendor, reforge, unequip', () => {
  it('vendor removes the item and pays', () => {
    const s = { ...s0, inventory: [item('i1', 'iron_sword')] }
    const r = step(s, { t: 'vendor', itemId: 'i1' })
    expect(r.state.inventory).toEqual([])
    expect(r.state.gold).toBe(2)
  })

  it('vendor refuses an equipped item', () => {
    const s = { ...s0, inventory: [item('i1', 'iron_sword', knight.id)] }
    expect(rejectedReason(step(s, { t: 'vendor', itemId: 'i1' }).effects)).toBe('item_equipped')
  })

  it('reforge checks the index and the gold', () => {
    const magic: Item = {
      ...item('i1', 'iron_sword'),
      rarity: 'uncommon',
      affixes: [{ id: 'keen', value: 1 }],
    }
    const s = { ...s0, inventory: [magic] }
    expect(rejectedReason(step(s, { t: 'reforge', itemId: 'i1', affixIndex: 1 }).effects)).toBe(
      'bad_affix_index',
    )
    expect(rejectedReason(step(s, { t: 'reforge', itemId: 'i1', affixIndex: 0 }).effects)).toBe(
      'not_enough_gold',
    )
    const r = step({ ...s, gold: 100 }, { t: 'reforge', itemId: 'i1', affixIndex: 0 })
    expect(r.state.gold).toBe(75)
    const value = r.state.inventory[0]?.affixes[0]?.value ?? 0
    expect(value).toBeGreaterThanOrEqual(1)
    expect(value).toBeLessThanOrEqual(4)
  })

  it('unequip refuses an empty slot', () => {
    expect(
      rejectedReason(step(s0, { t: 'unequip', heroId: knight.id, slot: 'weapon' }).effects),
    ).toBe('slot_empty')
  })
})

describe('set_party', () => {
  it('applies at once before the first kill', () => {
    const r = step(s0, { t: 'set_party', heroIds: [knight.id, archer.id, whiteMage.id] })
    expect(r.state.party).toEqual([knight.id, archer.id, whiteMage.id])
    expect(r.state.pendingParty).toBeNull()
  })

  it('only sets pendingParty after the first kill', () => {
    const s = { ...s0, stats: { ...s0.stats, kills: 1 } }
    const r = step(s, { t: 'set_party', heroIds: [knight.id, archer.id, whiteMage.id] })
    expect(r.state.party).toEqual(s0.party)
    expect(r.state.pendingParty).toEqual([knight.id, archer.id, whiteMage.id])
  })

  it('refuses duplicates and unknown heroes', () => {
    expect(
      rejectedReason(
        step(s0, { t: 'set_party', heroIds: [knight.id, knight.id, archer.id] }).effects,
      ),
    ).toBe('duplicate_hero')
    expect(
      rejectedReason(step(s0, { t: 'set_party', heroIds: [knight.id, 'nope', archer.id] }).effects),
    ).toBe('unknown_hero')
  })
})

describe('farm and expansions', () => {
  it('set_farm toggles', () => {
    expect(step(s0, { t: 'set_farm', on: true }).state.farm).toBe(true)
  })

  it('expand_inventory costs the first step and caps at max', () => {
    const r = step({ ...s0, gold: 600 }, { t: 'expand_inventory' })
    expect(r.state.inventoryCap).toBe(40)
    expect(r.state.gold).toBe(100)
    expect(
      rejectedReason(step({ ...s0, inventoryCap: 90 }, { t: 'expand_inventory' }).effects),
    ).toBe('at_max')
    expect(rejectedReason(step(s0, { t: 'expand_roster' }).effects)).toBe('not_enough_gold')
  })
})
