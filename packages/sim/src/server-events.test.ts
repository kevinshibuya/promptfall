import { describe, expect, it } from 'vitest'
import { createInitialState } from './state'
import { replay, step } from './step'
import type { Effect, GameState, Hero, Item, LootEntry, ServerEvent } from './types'
import { SERVER_EVENT_KINDS } from './types'

function rejectedReason(effects: Effect[]): string | undefined {
  const e = effects.find((x) => x.k === 'rejected')
  return e?.k === 'rejected' ? e.reason : undefined
}

function traded(effects: Effect[]): Extract<LootEntry, { k: 'trade' }> | undefined {
  const e = effects.find((x) => x.k === 'traded')
  return e?.k === 'traded' ? e.entry : undefined
}

function lastLog(s: GameState): LootEntry | undefined {
  return s.lootLog[s.lootLog.length - 1]
}

function rare(id: string, equippedBy: string | null = null): Item {
  return {
    id,
    base: 'steel_longsword',
    rarity: 'rare',
    tier: 2,
    affixes: [{ id: 'brutal', value: 5 }],
    equippedBy,
    tradeableAt: null,
  }
}

const s0 = createInitialState(1)
const [knight, blackMage, whiteMage, archer] = s0.roster
if (!knight || !blackMage || !whiteMage || !archer) throw new Error('roster')

/** A spare hero out of the party, at level 7 with some XP and hurt. */
const veteran: Hero = {
  ...archer,
  id: 'hvet',
  rarity: 'epic',
  level: 7,
  xp: 40,
  hp: 9,
  equipment: { weapon: null, armour: null, accessory: null },
  tradeableAt: null,
}

const rich: GameState = {
  ...s0,
  gold: 1000,
  inventory: [rare('iA'), rare('iB', knight.id)],
  roster: [
    { ...knight, equipment: { ...knight.equipment, weapon: 'iB' } },
    blackMage,
    whiteMage,
    archer,
    veteran,
  ],
}

describe('server events', () => {
  it('covers eighteen kinds', () => {
    expect(SERVER_EVENT_KINDS).toHaveLength(18)
  })

  describe('listed', () => {
    it('removes an item and charges the fee, with no loot entry', () => {
      const r = step(rich, { t: 'listed', listingId: 'L1', kind: 'item', id: 'iA', fee: 4 })
      expect(rejectedReason(r.effects)).toBeUndefined()
      expect(r.state.inventory.map((i) => i.id)).toEqual(['iB'])
      expect(r.state.gold).toBe(996)
      expect(r.state.lootLog).toEqual(rich.lootLog)
    })

    it('removes a bare hero out of the party', () => {
      const r = step(rich, { t: 'listed', listingId: 'L1', kind: 'hero', id: 'hvet', fee: 2 })
      expect(rejectedReason(r.effects)).toBeUndefined()
      expect(r.state.roster.map((h) => h.id)).not.toContain('hvet')
      expect(r.state.gold).toBe(998)
    })

    it.each([
      [{ kind: 'item', id: 'inope', fee: 1 }, 'unknown_item'],
      [{ kind: 'item', id: 'iB', fee: 1 }, 'equipped'],
      [{ kind: 'item', id: 'iA', fee: 1001 }, 'not_enough_gold'],
      [{ kind: 'hero', id: 'hnope', fee: 1 }, 'unknown_hero'],
      [{ kind: 'hero', id: knight.id, fee: 1 }, 'in_party'],
      [{ kind: 'hero', id: 'hvet', fee: 1001 }, 'not_enough_gold'],
    ] as const)('rejects %o with %s', (input, detail) => {
      const r = step(rich, { t: 'listed', listingId: 'L1', ...input })
      expect(rejectedReason(r.effects)).toBe(`server_event_unapplicable:${detail}`)
      expect(r.state).toBe(rich)
    })

    it('rejects a hero in the pending party', () => {
      const s = {
        ...rich,
        pendingParty: ['hvet', blackMage.id, whiteMage.id] as [string, string, string],
      }
      const r = step(s, { t: 'listed', listingId: 'L1', kind: 'hero', id: 'hvet', fee: 1 })
      expect(rejectedReason(r.effects)).toBe('server_event_unapplicable:in_party')
    })

    it('rejects a hero wearing something', () => {
      const s: GameState = {
        ...rich,
        inventory: [rare('iA', 'hvet')],
        roster: rich.roster.map((h) =>
          h.id === 'hvet' ? { ...h, equipment: { ...h.equipment, weapon: 'iA' } } : h,
        ),
      }
      const r = step(s, { t: 'listed', listingId: 'L1', kind: 'hero', id: 'hvet', fee: 1 })
      expect(rejectedReason(r.effects)).toBe('server_event_unapplicable:equipped')
    })
  })

  describe('returned', () => {
    it('puts an item back as carried and logs it', () => {
      const r = step(rich, {
        t: 'returned',
        listingId: 'L1',
        goods: { kind: 'item', item: rare('iC') },
      })
      expect(r.state.inventory.find((i) => i.id === 'iC')).toEqual(rare('iC'))
      expect(r.state.gold).toBe(1000)
      const entry = {
        k: 'trade',
        what: 'returned',
        kind: 'item',
        base: 'steel_longsword',
        rarity: 'rare',
        gold: 0,
      }
      expect(lastLog(r.state)).toEqual(entry)
      expect(traded(r.effects)).toEqual(entry)
    })

    it('keeps a returned hero at its level, XP and HP', () => {
      const listed = step(rich, {
        t: 'listed',
        listingId: 'L1',
        kind: 'hero',
        id: 'hvet',
        fee: 1,
      }).state
      const r = step(listed, {
        t: 'returned',
        listingId: 'L1',
        goods: { kind: 'hero', hero: veteran },
      })
      const back = r.state.roster.find((h) => h.id === 'hvet')
      expect(back).toEqual(veteran)
      expect(back?.level).toBe(7)
      expect(back?.xp).toBe(40)
      expect(back?.hp).toBe(9)
      expect(lastLog(r.state)).toEqual({
        k: 'trade',
        what: 'returned',
        kind: 'hero',
        base: veteran.template,
        rarity: 'epic',
        gold: 0,
      })
    })

    it('rejects with a full inventory or roster', () => {
      const a = step(
        { ...rich, inventoryCap: 2 },
        { t: 'returned', listingId: 'L1', goods: { kind: 'item', item: rare('iC') } },
      )
      expect(rejectedReason(a.effects)).toBe('server_event_unapplicable:inventory_full')
      const b = step(
        { ...rich, rosterCap: 5 },
        { t: 'returned', listingId: 'L1', goods: { kind: 'hero', hero: { ...veteran, id: 'hx' } } },
      )
      expect(rejectedReason(b.effects)).toBe('server_event_unapplicable:roster_full')
    })
  })

  describe('sold', () => {
    it('pays the net and logs the sale', () => {
      const r = step(rich, {
        t: 'sold',
        listingId: 'L1',
        kind: 'item',
        base: 'steel_longsword',
        rarity: 'rare',
        price: 100,
        net: 95,
      })
      expect(r.state.gold).toBe(1095)
      const entry = {
        k: 'trade',
        what: 'sold',
        kind: 'item',
        base: 'steel_longsword',
        rarity: 'rare',
        gold: 95,
      }
      expect(lastLog(r.state)).toEqual(entry)
      expect(traded(r.effects)).toEqual(entry)
    })
  })

  describe('bought', () => {
    it('charges the price and inserts the goods unchanged', () => {
      const item = { ...rare('t5'), tradeableAt: 86_400_000 }
      const r = step(rich, {
        t: 'bought',
        listingId: 'L1',
        goods: { kind: 'item', item },
        price: 300,
      })
      expect(r.state.gold).toBe(700)
      expect(r.state.inventory.find((i) => i.id === 't5')).toEqual(item)
      expect(r.state.counter).toBe(rich.counter)
      expect(r.state.rng).toBe(rich.rng)
      const entry = {
        k: 'trade',
        what: 'bought',
        kind: 'item',
        base: 'steel_longsword',
        rarity: 'rare',
        gold: 300,
      }
      expect(lastLog(r.state)).toEqual(entry)
      expect(traded(r.effects)).toEqual(entry)
    })

    it('stores a bought hero exactly as carried', () => {
      const hero: Hero = { ...veteran, id: 't6', level: 1, xp: 0, hp: 3, tradeableAt: 5 }
      const r = step(rich, {
        t: 'bought',
        listingId: 'L1',
        goods: { kind: 'hero', hero },
        price: 50,
      })
      expect(r.state.roster.find((h) => h.id === 't6')).toEqual(hero)
      expect(r.state.gold).toBe(950)
    })

    it('rejects without the gold or the slot', () => {
      const goods = { kind: 'item', item: rare('t5') } as const
      const a = step(rich, { t: 'bought', listingId: 'L1', goods, price: 1001 })
      expect(rejectedReason(a.effects)).toBe('server_event_unapplicable:not_enough_gold')
      const b = step(
        { ...rich, inventoryCap: 2 },
        { t: 'bought', listingId: 'L1', goods, price: 1 },
      )
      expect(rejectedReason(b.effects)).toBe('server_event_unapplicable:inventory_full')
      const c = step(
        { ...rich, rosterCap: 5 },
        { t: 'bought', listingId: 'L1', goods: { kind: 'hero', hero: veteran }, price: 1 },
      )
      expect(rejectedReason(c.effects)).toBe('server_event_unapplicable:roster_full')
    })
  })

  describe('orders', () => {
    it('order_placed takes the escrow; order_refunded gives it back', () => {
      const a = step(rich, { t: 'order_placed', orderId: 'O1', escrow: 400 })
      expect(a.state.gold).toBe(600)
      expect(a.state.lootLog).toEqual(rich.lootLog)
      const b = step(a.state, { t: 'order_refunded', orderId: 'O1', escrow: 400 })
      expect(b.state.gold).toBe(1000)
    })

    it('order_placed rejects without the gold', () => {
      const r = step(rich, { t: 'order_placed', orderId: 'O1', escrow: 1001 })
      expect(rejectedReason(r.effects)).toBe('server_event_unapplicable:not_enough_gold')
    })

    it('order_filled inserts the item and logs a purchase without charging', () => {
      const item = rare('t7')
      const r = step(rich, { t: 'order_filled', orderId: 'O1', item, price: 250 })
      expect(r.state.gold).toBe(1000)
      expect(r.state.inventory.find((i) => i.id === 't7')).toEqual(item)
      const entry = {
        k: 'trade',
        what: 'bought',
        kind: 'item',
        base: 'steel_longsword',
        rarity: 'rare',
        gold: 250,
      }
      expect(lastLog(r.state)).toEqual(entry)
      expect(traded(r.effects)).toEqual(entry)
    })

    it('order_filled rejects with a full inventory', () => {
      const r = step(
        { ...rich, inventoryCap: 2 },
        { t: 'order_filled', orderId: 'O1', item: rare('t7'), price: 1 },
      )
      expect(rejectedReason(r.effects)).toBe('server_event_unapplicable:inventory_full')
    })

    it('order_sold removes the item and pays the net', () => {
      const r = step(rich, {
        t: 'order_sold',
        orderId: 'O1',
        itemId: 'iA',
        base: 'steel_longsword',
        rarity: 'rare',
        price: 200,
        net: 190,
      })
      expect(r.state.inventory.map((i) => i.id)).toEqual(['iB'])
      expect(r.state.gold).toBe(1190)
      const entry = {
        k: 'trade',
        what: 'sold',
        kind: 'item',
        base: 'steel_longsword',
        rarity: 'rare',
        gold: 190,
      }
      expect(lastLog(r.state)).toEqual(entry)
      expect(traded(r.effects)).toEqual(entry)
    })

    it('order_sold rejects an unknown or equipped item', () => {
      const base = {
        t: 'order_sold',
        orderId: 'O1',
        base: 'steel_longsword',
        rarity: 'rare',
        price: 1,
        net: 1,
      } as const
      const a = step(rich, { ...base, itemId: 'inope' })
      expect(rejectedReason(a.effects)).toBe('server_event_unapplicable:unknown_item')
      const b = step(rich, { ...base, itemId: 'iB' })
      expect(rejectedReason(b.effects)).toBe('server_event_unapplicable:equipped')
    })
  })

  describe('credited', () => {
    it('adds gold with a gold effect', () => {
      const r = step(rich, { t: 'credited', gold: 1000, reason: 'bot_stipend' })
      expect(r.state.gold).toBe(2000)
      expect(r.effects).toEqual([{ k: 'gold', amount: 1000, reason: 'bot_stipend' }])
      expect(r.state.lootLog).toEqual(rich.lootLog)
    })

    it("carries the event's reason on the gold effect, so a toast can tell an achievement from a goal", () => {
      for (const reason of ['achievement:kills:2', 'goal:20374', 'bot_stipend']) {
        const r = step(rich, { t: 'credited', gold: 5, reason })
        expect(r.effects).toEqual([{ k: 'gold', amount: 5, reason }])
      }
    })
  })

  describe('rewarded', () => {
    it('without a source applies as a boss reward and its effect says so', () => {
      const r = step(rich, { t: 'rewarded', bossId: 'wb1', goods: null, gold: 45 })
      expect(r.effects).toEqual([
        { k: 'rewarded', bossId: 'wb1', goods: null, gold: 45, source: 'boss' },
      ])
    })

    it('with a source carries it on the effect', () => {
      for (const source of ['boss', 'hunt'] as const) {
        const r = step(rich, { t: 'rewarded', bossId: 'hunt1', goods: null, gold: 45, source })
        expect(r.effects).toEqual([
          { k: 'rewarded', bossId: 'hunt1', goods: null, gold: 45, source },
        ])
        expect(r.state.gold).toBe(rich.gold + 45)
      }
    })
  })

  it('a sequence of server events replays deterministically', () => {
    const events: ServerEvent[] = [
      { t: 'credited', gold: 50, reason: 'test' },
      { t: 'listed', listingId: 'L1', kind: 'item', id: 'iA', fee: 2 },
      {
        t: 'sold',
        listingId: 'L1',
        kind: 'item',
        base: 'steel_longsword',
        rarity: 'rare',
        price: 40,
        net: 38,
      },
      { t: 'bought', listingId: 'L2', goods: { kind: 'item', item: rare('t1') }, price: 30 },
    ]
    const a = replay(rich, events)
    const b = replay(rich, events)
    expect(a.state).toEqual(b.state)
    expect(a.state.gold).toBe(1000 + 50 - 2 + 38 - 30)
    expect(a.effects.some((e) => e.k === 'rejected')).toBe(false)
  })
})
