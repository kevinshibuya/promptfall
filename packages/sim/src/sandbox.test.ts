import { describe, expect, it } from 'vitest'
import { content } from './content'
import { hashState } from './hash'
import { vendorValue } from './loot'
import { heroStats } from './progression'
import { createInitialState } from './state'
import { replay, step } from './step'
import type { Effect, GameState, Item, SandboxEvent } from './types'
import { SANDBOX_EVENT_KINDS, SERVER_EVENT_KINDS } from './types'

function rejectedReason(effects: Effect[]): string | undefined {
  const e = effects.find((x) => x.k === 'rejected')
  return e?.k === 'rejected' ? e.reason : undefined
}

function zone(n: number) {
  const z = content.zones[n - 1]
  if (!z) throw new Error(`zone ${n}`)
  return z
}

const s0 = createInitialState(1)
const [knight] = s0.roster
if (!knight) throw new Error('roster')

/** Mid-fight in zone 3: enemies on the field, gauges filling, some kills behind it. */
const fighting: GameState = (() => {
  let s: GameState = { ...s0, zone: 3, highestZone: 3, wave: 4 }
  for (const t of ['tool_call', 'tool_call', 'tick'] as const) s = step(s, { t }).state
  if (!s.encounter || s.encounter.enemies.length === 0) throw new Error('no fight')
  return s
})()

const engaged: GameState = step(fighting, {
  t: 'boss_engaged',
  bossId: 'wb1',
  name: 'The Promptwyrm',
  glyph: '☠',
  stats: { hp: 630, atk: 14, def: 4, spd: 5 },
}).state

function withKnight(s: GameState, patch: Partial<GameState['roster'][number]>): GameState {
  return { ...s, roster: s.roster.map((h) => (h.id === knight?.id ? { ...h, ...patch } : h)) }
}

function filler(n: number): Item[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `f${i}`,
    base: 'oak_staff',
    rarity: 'common',
    tier: 1,
    affixes: [],
    equippedBy: null,
    tradeableAt: null,
  }))
}

function expectEncounterEnded(s: GameState): void {
  expect(s.encounter).toBeNull()
  expect(s.battle).toEqual({ gauges: [], queue: [], busy: 0 })
}

describe('sandbox events', () => {
  it('are six server event kinds', () => {
    expect(SANDBOX_EVENT_KINDS).toHaveLength(6)
    for (const kind of SANDBOX_EVENT_KINDS) expect(SERVER_EVENT_KINDS).toContain(kind)
  })

  describe('sandbox_boss', () => {
    it('a turn boss ends the encounter and spawns on the next tick', () => {
      const r = step(fighting, { t: 'sandbox_boss', zone: 3, boss: 'turn_boss' })
      expect(r.effects).toEqual([])
      expectEncounterEnded(r.state)
      expect(r.state.pendingTurnBoss).toBe(true)
      expect(r.state.zone).toBe(3)
      expect(r.state.wave).toBe(4)
      // No drops, no XP, no gold for the enemies it cleared.
      expect(r.state.gold).toBe(fighting.gold)
      expect(r.state.inventory).toEqual(fighting.inventory)
      expect(r.state.roster.map((h) => h.xp)).toEqual(fighting.roster.map((h) => h.xp))
      expect(r.state.stats).toEqual(fighting.stats)

      const next = step(r.state, { t: 'tick' })
      expect(next.effects).toContainEqual({
        k: 'boss_spawned',
        kind: 'turn_boss',
        def: zone(3).turnBoss,
      })
      expect(next.state.encounter?.enemies.map((e) => e.kind)).toEqual(['turn_boss'])
      expect(next.state.pendingTurnBoss).toBe(false)
    })

    it('a zone boss elsewhere moves the party, clears a stale turn boss and spawns the zone boss', () => {
      const stale = { ...fighting, pendingTurnBoss: true }
      const r = step(stale, { t: 'sandbox_boss', zone: 5, boss: 'zone_boss' })
      expect(r.effects).toEqual([])
      expectEncounterEnded(r.state)
      expect(r.state.zone).toBe(5)
      expect(r.state.highestZone).toBe(5)
      expect(r.state.wave).toBe(11)
      expect(r.state.pendingTurnBoss).toBe(false)

      const next = step(r.state, { t: 'tick' })
      expect(next.effects).toContainEqual({
        k: 'boss_spawned',
        kind: 'zone_boss',
        def: zone(5).boss,
      })
      expect(next.effects.some((e) => e.k === 'boss_spawned' && e.kind === 'turn_boss')).toBe(false)
      expect(next.state.encounter?.enemies.map((e) => e.def)).toEqual([zone(5).boss])
    })

    it('a turn boss elsewhere moves the party to wave 1 of that zone', () => {
      const r = step(fighting, { t: 'sandbox_boss', zone: 2, boss: 'turn_boss' })
      expect(r.state.zone).toBe(2)
      expect(r.state.wave).toBe(1)
      expect(r.state.highestZone).toBe(3)
      const next = step(r.state, { t: 'tick' })
      expect(next.effects).toContainEqual({
        k: 'boss_spawned',
        kind: 'turn_boss',
        def: zone(2).turnBoss,
      })
    })

    it.each([
      [0, 'no_such_zone'],
      [13, 'no_such_zone'],
      [1.5, 'no_such_zone'],
    ])('zone %s is unapplicable with %s', (z, detail) => {
      const r = step(fighting, { t: 'sandbox_boss', zone: z, boss: 'zone_boss' })
      expect(rejectedReason(r.effects)).toBe(`server_event_unapplicable:${detail}`)
      expect(r.state).toBe(fighting)
    })

    it('is unapplicable in boss mode', () => {
      const r = step(engaged, { t: 'sandbox_boss', zone: 3, boss: 'zone_boss' })
      expect(rejectedReason(r.effects)).toBe('server_event_unapplicable:boss_mode')
      expect(r.state).toBe(engaged)
    })
  })

  describe('sandbox_item', () => {
    it('the front hero strikes the front enemy down, and the item is its drop', () => {
      const [hero] = fighting.roster.filter((h) => fighting.party.includes(h.id) && h.hp > 0)
      const [front] = fighting.encounter?.enemies ?? []
      if (!hero || !front) throw new Error('no fight')
      const r = step(fighting, { t: 'sandbox_item', base: 'oak_staff', rarity: 'legendary' })
      const drop = r.effects.find((e) => e.k === 'drop')
      if (drop?.k !== 'drop') throw new Error('no drop')
      expect(r.effects.slice(0, 2)).toEqual([
        { k: 'act', actor: hero.id, action: 'attack', at: 0 },
        { k: 'hit', by: hero.id, target: front.id, amount: front.hp },
      ])
      // One drop, the granted one: the kill's roll does not run.
      expect(r.effects.filter((e) => e.k === 'drop' || e.k === 'drop_vendored')).toEqual([drop])
      expect(r.effects.some((e) => e.k === 'gold')).toBe(true)
      expect(r.state.stats.kills).toBe(fighting.stats.kills + 1)
      expect(r.state.encounter?.enemies.some((e) => e.id === front.id) ?? false).toBe(false)
      const { item } = drop
      expect(item.base).toBe('oak_staff')
      expect(item.rarity).toBe('legendary')
      expect(item.equippedBy).toBeNull()
      expect(item.affixes).toHaveLength(content.rarity.legendary.affixCount)
      expect(new Set(item.affixes.map((a) => a.id)).size).toBe(item.affixes.length)
      for (const affix of item.affixes) {
        const def = content.affixes[affix.id]
        expect(def?.slots).toContain('weapon')
        expect(affix.value).toBeGreaterThanOrEqual(def?.range[0] ?? 0)
        expect(affix.value).toBeLessThanOrEqual(def?.range[1] ?? 0)
      }
      expect(r.state.inventory).toEqual([...fighting.inventory, item])
      expect(r.state.lootLog.at(-1)).toEqual({
        k: 'item',
        itemId: item.id,
        base: 'oak_staff',
        rarity: 'legendary',
        vendoredFor: null,
      })
      const gold = r.effects.find((e) => e.k === 'gold')
      expect(r.state.gold).toBe(fighting.gold + (gold?.k === 'gold' ? gold.amount : 0))
    })

    it('with no enemy on the field, the item drops alone', () => {
      const empty = { ...fighting, encounter: null }
      const r = step(empty, { t: 'sandbox_item', base: 'oak_staff', rarity: 'rare' })
      expect(r.effects.map((e) => e.k)).toEqual(['drop'])
      expect(r.state.stats.kills).toBe(empty.stats.kills)
    })

    it('a zone boss struck down clears its zone, the item its drop', () => {
      let s: GameState = step(fighting, { t: 'sandbox_boss', zone: 3, boss: 'zone_boss' }).state
      while (!s.encounter?.enemies.some((e) => e.kind === 'zone_boss')) {
        s = step(s, { t: 'tick' }).state
      }
      const r = step(s, { t: 'sandbox_item', base: 'oak_staff', rarity: 'epic' })
      const kinds = r.effects.map((e) => e.k)
      expect(kinds).toContain('zone_cleared')
      expect(kinds.filter((k) => k === 'drop')).toHaveLength(1)
      expect(r.state.zone).toBe(4)
    })

    it('vendors the item with a full inventory, as a kill drop does', () => {
      const full = { ...fighting, inventory: filler(fighting.inventoryCap), gold: 100 }
      const r = step(full, { t: 'sandbox_item', base: 'oak_staff', rarity: 'rare' })
      const sold = r.effects.find((e) => e.k === 'drop_vendored')
      if (sold?.k !== 'drop_vendored') throw new Error('not vendored')
      expect(r.effects.filter((e) => e.k === 'drop' || e.k === 'drop_vendored')).toEqual([sold])
      expect(sold.item.base).toBe('oak_staff')
      expect(sold.gold).toBe(vendorValue(sold.item))
      expect(sold.gold).toBeGreaterThan(0)
      const kill = r.effects.find((e) => e.k === 'gold')
      expect(r.state.gold).toBe(100 + sold.gold + (kill?.k === 'gold' ? kill.amount : 0))
      expect(r.state.inventory).toEqual(full.inventory)
      expect(r.state.lootLog.at(-1)).toEqual({
        k: 'item',
        itemId: sold.item.id,
        base: 'oak_staff',
        rarity: 'rare',
        vendoredFor: sold.gold,
      })
    })

    it('applies in boss mode', () => {
      const r = step(engaged, { t: 'sandbox_item', base: 'oak_staff', rarity: 'common' })
      expect(r.effects.map((e) => e.k)).toEqual(['drop'])
      expect(r.state.boss).toEqual(engaged.boss)
    })

    it('an unknown base is unapplicable', () => {
      const r = step(fighting, { t: 'sandbox_item', base: 'nope', rarity: 'rare' })
      expect(rejectedReason(r.effects)).toBe('server_event_unapplicable:unknown_base')
      expect(r.state).toBe(fighting)
    })
  })

  describe('sandbox_level', () => {
    it('from 3 to 6 pushes three level ups in order', () => {
      const s = withKnight(fighting, { level: 3, xp: 200 })
      const r = step(s, { t: 'sandbox_level', heroId: knight.id, level: 6 })
      expect(r.effects).toEqual([
        { k: 'level_up', heroId: knight.id, level: 4 },
        { k: 'level_up', heroId: knight.id, level: 5 },
        { k: 'level_up', heroId: knight.id, level: 6 },
      ])
      const hero = r.state.roster.find((h) => h.id === knight.id)
      expect(hero?.level).toBe(6)
      expect(hero?.xp).toBe(0)
      // Each level adds its max HP gain, as a level earned in play does.
      const before = s.roster.find((h) => h.id === knight.id)
      const gain = hero && before ? heroStats(r.state, hero).hp - heroStats(s, before).hp : 0
      expect(gain).toBeGreaterThan(0)
      expect(hero?.hp).toBe((before?.hp ?? 0) + gain)
    })

    it('stops at the rarity cap, then a further grant is unapplicable', () => {
      const s = withKnight(fighting, { level: 18 })
      const r = step(s, { t: 'sandbox_level', heroId: knight.id, level: 25 })
      expect(r.effects.map((e) => e.k === 'level_up' && e.level)).toEqual([19, 20])
      expect(r.state.roster.find((h) => h.id === knight.id)?.level).toBe(20)

      const again = step(r.state, { t: 'sandbox_level', heroId: knight.id, level: 25 })
      expect(rejectedReason(again.effects)).toBe('server_event_unapplicable:level_cap')
      expect(again.state).toBe(r.state)
    })

    it.each([
      [3, 'level_not_above'],
      [2, 'level_not_above'],
    ])('level %s from 3 is unapplicable with %s', (level, detail) => {
      const s = withKnight(fighting, { level: 3 })
      const r = step(s, { t: 'sandbox_level', heroId: knight.id, level })
      expect(rejectedReason(r.effects)).toBe(`server_event_unapplicable:${detail}`)
      expect(r.state).toBe(s)
    })

    it('an unknown hero is unapplicable', () => {
      const r = step(fighting, { t: 'sandbox_level', heroId: 'hnope', level: 5 })
      expect(rejectedReason(r.effects)).toBe('server_event_unapplicable:unknown_hero')
    })

    it('applies in boss mode', () => {
      const r = step(engaged, { t: 'sandbox_level', heroId: knight.id, level: 3 })
      expect(r.effects.map((e) => e.k)).toEqual(['level_up', 'level_up'])
    })
  })

  describe('sandbox_zone', () => {
    it('moves the party to wave 1 of the zone and ends the encounter', () => {
      const r = step(fighting, { t: 'sandbox_zone', zone: 7 })
      expect(r.effects).toEqual([])
      expect(r.state.zone).toBe(7)
      expect(r.state.wave).toBe(1)
      expect(r.state.highestZone).toBe(7)
      expectEncounterEnded(r.state)
      expect(r.state.gold).toBe(fighting.gold)
      expect(r.state.stats).toEqual(fighting.stats)
    })

    it('going back keeps the highest zone', () => {
      const r = step(fighting, { t: 'sandbox_zone', zone: 1 })
      expect(r.state.zone).toBe(1)
      expect(r.state.highestZone).toBe(3)
    })

    it.each([0, 13, -1, 2.5])('zone %s is unapplicable with no_such_zone', (z) => {
      const r = step(fighting, { t: 'sandbox_zone', zone: z })
      expect(rejectedReason(r.effects)).toBe('server_event_unapplicable:no_such_zone')
      expect(r.state).toBe(fighting)
    })

    it('is unapplicable in boss mode', () => {
      const r = step(engaged, { t: 'sandbox_zone', zone: 2 })
      expect(rejectedReason(r.effects)).toBe('server_event_unapplicable:boss_mode')
    })
  })

  describe('sandbox_recruit', () => {
    it('recruits a hero of that rarity through the recruit path', () => {
      const r = step(fighting, { t: 'sandbox_recruit', rarity: 'epic' })
      const recruited = r.effects.find((e) => e.k === 'hero_recruited')
      if (recruited?.k !== 'hero_recruited') throw new Error('nobody recruited')
      expect(r.effects).toEqual([recruited])
      expect(recruited.via).toBe('sandbox')
      expect(recruited.hero.rarity).toBe('epic')
      expect(recruited.hero.traits).toHaveLength(content.rarity.epic.traitCount)
      expect(r.state.roster).toEqual([...fighting.roster, recruited.hero])
      expect(r.state.lootLog.at(-1)).toEqual({
        k: 'hero',
        heroId: recruited.hero.id,
        template: recruited.hero.template,
        rarity: 'epic',
        via: 'sandbox',
      })
      expect(r.state.gold).toBe(fighting.gold)
      expect(r.state.recruits).toBe(fighting.recruits)
    })

    it('a full roster is unapplicable', () => {
      const s = { ...fighting, rosterCap: fighting.roster.length }
      const r = step(s, { t: 'sandbox_recruit', rarity: 'rare' })
      expect(rejectedReason(r.effects)).toBe('server_event_unapplicable:roster_full')
      expect(r.state).toBe(s)
    })

    it('applies in boss mode', () => {
      const r = step(engaged, { t: 'sandbox_recruit', rarity: 'common' })
      expect(r.effects.map((e) => e.k)).toEqual(['hero_recruited'])
    })
  })

  describe('sandbox_wipe', () => {
    it('wipes the party: the wipe effect, the retreat, the wipe counted', () => {
      const s: GameState = {
        ...fighting,
        pendingTurnBoss: true,
        roster: fighting.roster.map((h) => ({ ...h, hp: 1 })),
      }
      const r = step(s, { t: 'sandbox_wipe' })
      expect(r.effects).toEqual([{ k: 'wipe', retreatedTo: 2 }])
      expect(r.state.zone).toBe(2)
      expect(r.state.wave).toBe(1)
      expect(r.state.stats.wipes).toBe(fighting.stats.wipes + 1)
      expect(r.state.pendingTurnBoss).toBe(false)
      expectEncounterEnded(r.state)
      for (const id of r.state.party) {
        const hero = r.state.roster.find((h) => h.id === id)
        if (!hero) throw new Error(id)
        expect(hero.hp).toBe(heroStats(r.state, hero).hp)
      }
    })

    it('in zone 1 stays in zone 1', () => {
      const r = step(s0, { t: 'sandbox_wipe' })
      expect(r.effects).toEqual([{ k: 'wipe', retreatedTo: 1 }])
      expect(r.state.zone).toBe(1)
    })

    it('is unapplicable in boss mode', () => {
      const r = step(engaged, { t: 'sandbox_wipe' })
      expect(rejectedReason(r.effects)).toBe('server_event_unapplicable:boss_mode')
      expect(r.state).toBe(engaged)
    })
  })

  it('a log carrying every sandbox kind replays to the same hash', () => {
    const events: (SandboxEvent | { t: 'tick' } | { t: 'tool_call' })[] = [
      { t: 'sandbox_zone', zone: 4 },
      { t: 'tool_call' },
      { t: 'sandbox_item', base: 'oak_staff', rarity: 'legendary' },
      { t: 'sandbox_recruit', rarity: 'rare' },
      { t: 'sandbox_level', heroId: knight.id, level: 9 },
      { t: 'sandbox_boss', zone: 4, boss: 'zone_boss' },
      { t: 'tick' },
      { t: 'tick' },
      { t: 'sandbox_wipe' },
      { t: 'sandbox_boss', zone: 2, boss: 'turn_boss' },
      { t: 'tick' },
    ]
    const kinds = new Set(events.map((e) => e.t))
    for (const kind of SANDBOX_EVENT_KINDS) expect(kinds).toContain(kind)
    const a = replay(s0, events)
    const b = replay(s0, events)
    expect(a.effects.some((e) => e.k === 'rejected')).toBe(false)
    expect(hashState(a.state)).toBe(hashState(b.state))
    expect(hashState(JSON.parse(JSON.stringify(a.state)))).toBe(hashState(a.state))
  })
})
