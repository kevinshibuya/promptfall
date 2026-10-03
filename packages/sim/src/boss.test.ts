import { describe, expect, it } from 'vitest'
import { scaledBossStats } from './combat'
import { content } from './content'
import { rollRewardItem } from './loot'
import { heroStats, partyHeroes } from './progression'
import { createInitialState } from './state'
import { replay, step } from './step'
import type { Event, GameState, Item, ServerEvent, Stats } from './types'

const tick = { t: 'tick' } as const
const toolCall = { t: 'tool_call' } as const
const STATS: Stats = { hp: 630, atk: 14, def: 4, spd: 5 }
const engage: ServerEvent = {
  t: 'boss_engaged',
  bossId: 'wb1',
  name: 'The Promptwyrm',
  glyph: '☠',
  stats: STATS,
}

const times = <T>(n: number, e: T): T[] => Array.from({ length: n }, () => e)
const run = (s: GameState, events: Event[]) => replay(s, events)

function rejection(s: GameState, e: Event): string | undefined {
  const r = step(s, e)
  const effect = r.effects.find((x) => x.k === 'rejected')
  return effect?.k === 'rejected' ? effect.reason : undefined
}

function engaged(seed = 1): GameState {
  return run(createInitialState(seed), [engage]).state
}

const sword = (id: string): Item => ({
  id,
  base: 'steel_longsword',
  rarity: 'rare',
  affixes: [],
  equippedBy: null,
  tradeableAt: null,
})

describe('boss mode', () => {
  it('boss_engaged replaces the encounter and the queue with one world boss, keeping the turn boss', () => {
    let s = run(createInitialState(1), times(6, toolCall)).state
    expect(s.encounter?.enemies).toHaveLength(3)
    expect(s.encounter?.queue.length).toBeGreaterThan(0)
    s = { ...s, pendingTurnBoss: true }
    const r = step(s, engage)
    expect(r.effects).toEqual([])
    const enemies = r.state.encounter?.enemies ?? []
    expect(enemies).toHaveLength(1)
    expect(enemies[0]).toMatchObject({ def: 'world_boss', kind: 'world_boss', hp: 630, maxHp: 630 })
    expect(r.state.encounter?.queue).toEqual([])
    expect(r.state.pendingTurnBoss).toBe(true)
    expect(r.state.turnToolCalls).toBe(6)
    expect(r.state.boss).toEqual({
      bossId: 'wb1',
      name: 'The Promptwyrm',
      glyph: '☠',
      stats: STATS,
      dealt: 0,
    })
    expect(content.enemies.world_boss).toBeUndefined()
  })

  it('a second boss_engaged is already_engaged', () => {
    expect(rejection(engaged(), engage)).toBe('server_event_unapplicable:already_engaged')
  })

  it('ticks raise dealt and change no xp, gold, kills or inventory; the boss never loses hp', () => {
    const s = engaged()
    const after = run(s, times(20, tick)).state
    expect(after.boss?.dealt).toBeGreaterThan(0)
    expect(after.gold).toBe(s.gold)
    expect(after.stats.kills).toBe(s.stats.kills)
    expect(after.inventory).toEqual(s.inventory)
    expect(after.roster.map((h) => h.xp)).toEqual(s.roster.map((h) => h.xp))
    const boss = after.encounter?.enemies[0]
    expect(boss?.hp).toBe(boss?.maxHp)
  })

  it('a tool call spawns nothing and still counts toward the turn boss', () => {
    const s = engaged()
    const after = step(s, toolCall).state
    expect(after.encounter).toEqual(s.encounter)
    expect(after.turnToolCalls).toBe(s.turnToolCalls + 1)
  })

  it('a beaten party is healed in place: no retreat, no wipe, the encounter and the pending party kept', () => {
    const base = engaged()
    const pending: [string, string, string] = [
      base.roster[0]?.id ?? '',
      base.roster[3]?.id ?? '',
      base.roster[2]?.id ?? '',
    ]
    const s: GameState = {
      ...base,
      zone: 3,
      highestZone: 3,
      pendingParty: pending,
      pendingTurnBoss: true,
      roster: base.roster.map((h) => (base.party.includes(h.id) ? { ...h, hp: 0 } : h)),
    }
    const r = step(s, tick)
    expect(r.effects.some((e) => e.k === 'wipe')).toBe(false)
    expect(r.state.zone).toBe(3)
    expect(r.state.stats.wipes).toBe(s.stats.wipes)
    expect(r.state.encounter).toEqual(s.encounter)
    expect(r.state.pendingParty).toEqual(pending)
    expect(r.state.pendingTurnBoss).toBe(true)
    for (const hero of partyHeroes(r.state)) expect(hero.hp).toBe(heroStats(r.state, hero).hp)
  })

  it('rest heals and revives a fallen hero at 30%', () => {
    const base = engaged()
    const fallen = base.party[0]
    const s: GameState = {
      ...base,
      roster: base.roster.map((h) => (h.id === fallen ? { ...h, hp: 0 } : h)),
    }
    const after = step(s, { t: 'rest' }).state
    const hero = after.roster.find((h) => h.id === fallen)
    if (!hero) throw new Error('no hero')
    expect(hero.hp).toBe(Math.max(1, Math.floor((heroStats(after, hero).hp * 3000) / 10000)))
  })

  it('boss_disengaged clears the encounter, and the next tick spawns as usual', () => {
    const s = step(engaged(), { t: 'boss_disengaged', bossId: 'wb1' }).state
    expect(s.encounter).toBeNull()
    expect(s.boss).toBeNull()
    const next = step(s, tick).state
    expect(next.encounter?.enemies[0]?.kind).toBe('wave')
    const pending = step({ ...s, pendingTurnBoss: true }, tick).state
    expect(pending.encounter?.enemies[0]?.kind).toBe('turn_boss')
  })

  it('boss_disengaged with another id is not_engaged', () => {
    expect(rejection(engaged(), { t: 'boss_disengaged', bossId: 'wb2' })).toBe(
      'server_event_unapplicable:not_engaged',
    )
    expect(rejection(createInitialState(1), { t: 'boss_disengaged', bossId: 'wb1' })).toBe(
      'server_event_unapplicable:not_engaged',
    )
  })

  it('rewarded inserts the item, adds the gold, logs the reward and emits rewarded', () => {
    const s = createInitialState(1)
    const event: ServerEvent = {
      t: 'rewarded',
      bossId: 'wb1',
      goods: { kind: 'item', item: sword('r0') },
      gold: 45,
    }
    const r = step(s, event)
    expect(r.state.inventory.map((i) => i.id)).toContain('r0')
    expect(r.state.gold).toBe(s.gold + 45)
    expect(r.state.lootLog.at(-1)).toEqual({
      k: 'reward',
      base: 'steel_longsword',
      rarity: 'rare',
      gold: 45,
    })
    expect(r.effects).toEqual([
      { k: 'rewarded', bossId: 'wb1', goods: { kind: 'item', item: sword('r0') }, gold: 45 },
    ])
    const goldOnly = step(s, { t: 'rewarded', bossId: 'wb1', goods: null, gold: 45 })
    expect(goldOnly.state.gold).toBe(s.gold + 45)
    expect(goldOnly.state.lootLog).toEqual(s.lootLog)
    expect(goldOnly.effects).toEqual([{ k: 'rewarded', bossId: 'wb1', goods: null, gold: 45 }])
  })

  it('rewarded into a full inventory is inventory_full', () => {
    const base = createInitialState(1)
    const s = { ...base, inventory: times(base.inventoryCap, 0).map((_, i) => sword(`f${i}`)) }
    expect(
      rejection(s, {
        t: 'rewarded',
        bossId: 'wb1',
        goods: { kind: 'item', item: sword('r0') },
        gold: 45,
      }),
    ).toBe('server_event_unapplicable:inventory_full')
  })
})

describe('scaledBossStats', () => {
  const zoneBoss = (zone: number) => {
    const id = content.zones[zone - 1]?.boss ?? ''
    const stats = content.enemies[id]?.stats
    if (!stats) throw new Error(`no boss for zone ${zone}`)
    return stats
  }

  it('at zone 1 is the carried stats plus the spd offset', () => {
    expect(scaledBossStats(engaged())).toEqual({ ...STATS, spd: STATS.spd + Math.floor(1 / 3) })
  })

  it("at zone 5 scales atk and def by the zone boss's ratio to zone 1's", () => {
    const s = { ...engaged(), zone: 5 }
    const z1 = zoneBoss(1)
    const z5 = zoneBoss(5)
    expect(scaledBossStats(s)).toEqual({
      hp: STATS.hp,
      atk: Math.floor((STATS.atk * z5.atk) / z1.atk),
      def: Math.floor((STATS.def * z5.def) / z1.def),
      spd: STATS.spd + Math.floor(5 / 3),
    })
    expect(z1).toMatchObject({ atk: 14, def: 4 })
    expect(z5).toMatchObject({ atk: 72, def: 16 })
  })
})

describe('rollRewardItem', () => {
  it('rolls a base of the zone a party class can wear, with no id, the same for the same seed', () => {
    const classes = ['knight', 'black_mage', 'white_mage'] as const
    const item = rollRewardItem(7, 3, classes)
    if (!item) throw new Error('no item')
    const base = content.itemBases[item.base]
    expect(base?.minZone).toBeLessThanOrEqual(3)
    expect(base?.classes.some((c) => (classes as readonly string[]).includes(c))).toBe(true)
    expect(item.id).toBe('')
    expect(item.tradeableAt).toBeNull()
    expect(item.equippedBy).toBeNull()
    expect(rollRewardItem(7, 3, classes)).toEqual(item)
  })
})
