import { describe, expect, it } from 'vitest'
import { clone } from '../draft'
import { createInitialState } from '../state'
import { step } from '../step'
import type { Affix, GameState, Hero, Item, Rarity } from '../types'
import { atTurnEnd, noSpending, reforgeWorn, type Seat, wear } from './player'
import { runScenario } from './scenario'

// The dedicated player's five habits (#151), each shown happening on a state built for it.

function seatAt(start: GameState): Seat & { state: GameState } {
  const seat = {
    state: start,
    play(event: Parameters<Seat['play']>[0]) {
      const r = step(seat.state, event)
      seat.state = r.state
      return r.effects
    },
  }
  return seat
}

let made = 0
/** An item put straight into the inventory, unworn: the drop's own path is the sim's. */
function give(seat: { state: GameState }, base: string, rarity: Rarity, affixes: Affix[] = []) {
  const item: Item = {
    id: `t${made++}`,
    base,
    rarity,
    tier: 1,
    affixes,
    equippedBy: null,
    tradeableAt: null,
  }
  seat.state = { ...seat.state, inventory: [...seat.state.inventory, item] }
  return item.id
}

function hero(s: GameState, id: string): Hero {
  const h = s.roster.find((x) => x.id === id)
  if (!h) throw new Error(`no hero ${id}`)
  return h
}

/** A second Knight on the bench, a copy of the first with nothing worn. */
function benchKnight(seat: { state: GameState }): string {
  const s = clone(seat.state)
  const knight = hero(s, s.party[0])
  s.roster.push({ ...knight, id: 'hk', equipment: { weapon: null, armour: null, accessory: null } })
  seat.state = s
  return 'hk'
}

function gold(seat: Seat & { state: GameState }, amount: number): void {
  seat.play({ t: 'credited', gold: amount - seat.state.gold, reason: 'test' })
}

describe('habit 1 and 2: scoring every stat, wearing a drop where it raises the score most', () => {
  it('an HP-heavy item beats a smaller attack bump', () => {
    const seat = seatAt(createInitialState(1))
    const knight = seat.state.party[0]
    // Two Uncommon Iron Swords on the level-1 Knight (60 hp, 13 atk with the sword): Keen's 1 atk is
    // a fourteenth more damage, Lifebound's 15 hp a quarter more hits survived. Scored on atk + def
    // alone, Keen won.
    const atk = give(seat, 'iron_sword', 'uncommon', [{ id: 'keen', value: 1 }])
    const hp = give(seat, 'iron_sword', 'uncommon', [{ id: 'lifebound', value: 15 }])
    wear(seat, atk)
    expect(hero(seat.state, knight).equipment.weapon).toBe(atk)
    wear(seat, hp)
    expect(hero(seat.state, knight).equipment.weapon).toBe(hp)
  })

  it('wears a drop on the party first; the item it displaces moves to the next hero it beats', () => {
    const seat = seatAt(createInitialState(1))
    const knight = seat.state.party[0]
    const bench = benchKnight(seat)
    const old = give(seat, 'iron_sword', 'common')
    wear(seat, old)
    expect(hero(seat.state, knight).equipment.weapon).toBe(old)
    const better = give(seat, 'bronze_axe', 'rare')
    wear(seat, better)
    expect(hero(seat.state, knight).equipment.weapon).toBe(better)
    expect(hero(seat.state, bench).equipment.weapon).toBe(old)
  })

  it('leaves a drop unworn when it raises no hero', () => {
    const seat = seatAt(createInitialState(1))
    const knight = seat.state.party[0]
    const good = give(seat, 'bronze_axe', 'rare')
    wear(seat, good)
    const worse = give(seat, 'iron_sword', 'common')
    expect(wear(seat, worse)).toBe(false)
    expect(hero(seat.state, knight).equipment.weapon).toBe(good)
    expect(seat.state.inventory.find((i) => i.id === worse)?.equippedBy).toBeNull()
  })
})

describe('habit 3: gold at a turn’s end, recruit, expand, reforge', () => {
  it('a recruit spends gold and reshapes the party', () => {
    const seat = seatAt(createInitialState(1))
    const starters = seat.state.roster.map((h) => h.id)
    gold(seat, 3000)
    const spent = noSpending()
    atTurnEnd(seat, spent)
    expect(spent.recruits).toBe(9)
    // 200 G a recruit, 30 G more each time: nine cost 2880 G.
    expect(seat.state.gold).toBe(120)
    expect(seat.state.roster).toHaveLength(13)
    expect(spent.partyChanges).toBe(1)
    expect(seat.state.party.some((id) => !starters.includes(id))).toBe(true)
    expect(hero(seat.state, seat.state.party[0]).cls).toBe('knight')
  })

  it('a full roster whose bench is no better than the party dismisses its weakest to recruit', () => {
    const seat = seatAt(createInitialState(1))
    const s = clone(seat.state)
    const knight = hero(s, s.party[0])
    // The bench: the Archer and twenty Knights, Commons at level 1; the party three levels above.
    for (const id of s.party) hero(s, id).level = 4
    for (let i = 0; s.roster.length < s.rosterCap; i++) {
      s.roster.push({ ...knight, id: `hb${i}`, level: 1, hp: 1 })
    }
    seat.state = s
    gold(seat, 200)
    const spent = noSpending()
    atTurnEnd(seat, spent)
    expect(spent).toMatchObject({ dismissals: 1, recruits: 1 })
    expect(seat.state.roster).toHaveLength(seat.state.rosterCap)
  })

  it('expands the inventory when it is full of worn gear', () => {
    const seat = seatAt(createInitialState(1))
    const s = clone(seat.state)
    const knight = hero(s, s.party[0])
    for (let i = 0; i < 9; i++) {
      s.roster.push({
        ...knight,
        id: `hb${i}`,
        equipment: { weapon: null, armour: null, accessory: null },
      })
    }
    seat.state = s
    const bases = ['iron_sword', 'chainmail', 'copper_ring']
    for (let i = 0; seat.state.inventory.length < seat.state.inventoryCap; i++) {
      wear(seat, give(seat, bases[i % 3] ?? 'iron_sword', 'common'))
    }
    expect(seat.state.inventory.every((i) => i.equippedBy !== null)).toBe(true)
    // Room for the roster's eleven recruits first (200 to 500 G, 3850 G in all), then the 500 G.
    gold(seat, 4350)
    const spent = noSpending()
    atTurnEnd(seat, spent)
    expect(spent.recruits).toBe(11)
    expect(spent.expansions).toBe(1)
    expect(seat.state.inventoryCap).toBe(40)
    expect(seat.state.gold).toBe(0)
  })

  it('reforges a worn item’s weakest affix only when it costs under a tenth of the gold held', () => {
    const seat = seatAt(createInitialState(1))
    const knight = seat.state.party[0]
    // A Rare tier-1 sword: a reforge costs 60 G. Keen rolled 2 of 1–2, Vicious 3 of 3–7.
    const sword = give(seat, 'iron_sword', 'rare', [
      { id: 'keen', value: 2 },
      { id: 'vicious', value: 3 },
    ])
    seat.play({ t: 'equip', heroId: knight, itemId: sword })
    gold(seat, 600)
    const spent = noSpending()
    reforgeWorn(seat, spent)
    expect(spent.reforges).toBe(0)
    expect(seat.state.gold).toBe(600)
    gold(seat, 601)
    const rolled = seat.state.rng
    reforgeWorn(seat, spent)
    expect(spent.reforges).toBe(1)
    expect(seat.state.gold).toBe(541)
    expect(seat.state.rng).not.toBe(rolled)
    // The weakest is Vicious, at the floor of its range; Keen at its top is untouched.
    expect(seat.state.inventory.find((i) => i.id === sword)?.affixes[0]).toEqual({
      id: 'keen',
      value: 2,
    })
  })
})

describe('habit 5: disposal at a turn’s end', () => {
  it('vendors an unworn item nobody wants and keeps one somebody would wear', () => {
    const seat = seatAt(createInitialState(1))
    const knight = seat.state.party[0]
    const good = give(seat, 'bronze_axe', 'rare')
    seat.play({ t: 'equip', heroId: knight, itemId: good })
    const junk = give(seat, 'iron_sword', 'common')
    const ring = give(seat, 'copper_ring', 'common')
    const spent = noSpending()
    expect(atTurnEnd(seat, spent)).toBe(1)
    expect(seat.state.inventory.map((i) => i.id)).not.toContain(junk)
    // An Iron Sword's vendor value: 2 G a zone, minimum zone 1.
    expect(seat.state.gold).toBe(2)
    expect(seat.state.inventory.find((i) => i.id === ring)?.equippedBy).not.toBeNull()
  })
})

describe('the dedicated player in a run', () => {
  it('spends its gold on recruits and reforges and changes its party', () => {
    const r = runScenario({ seed: 7, hours: 8 })
    expect(r.spending.recruits).toBeGreaterThan(0)
    expect(r.spending.reforges).toBeGreaterThan(0)
    expect(r.drops.vendoredAtTurnEnd).toBeGreaterThan(0)
  })

  it('keeps the lazy player behind an option, which never spends', () => {
    const r = runScenario({ seed: 7, hours: 2, player: 'lazy' })
    expect(r.spending).toEqual(noSpending())
  })
})
