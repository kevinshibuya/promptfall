import { content, zoneAt } from '../content'
import { clone } from '../draft'
import { generateHero } from '../heroes'
import { affixValue } from '../loot'
import { heroStats, livingParty } from '../progression'
import { createInitialState } from '../state'
import { step } from '../step'
import type { Effect, Event, GameState, Hero, HeroClass, Item, Rarity } from '../types'
import { type CadenceSpec, REFERENCE, turnSource } from './cadence'
import { LEGENDARY_AT_HOUR, referenceRow } from './reference'

export type ScenarioOptions = {
  seed: number
  hours: number
  /** The reference cadence when absent. */
  cadence?: CadenceSpec
  /** A rest on every Nth prompt; 1 when absent. */
  restEveryTurns?: number
  /** The live hour a Legendary Knight takes the Knight's place; LEGENDARY_AT_HOUR when absent, never when null. */
  legendaryAtHour?: number | null
}

export type ZoneTimeline = {
  zone: number
  firstReachedHour: number
  /** The live hour its zone boss first fell; null while it has not. */
  firstClearedHour: number | null
  /** Every wipe in it, its retreats included. */
  wipes: number
  /** Its wipes that were retreats: each third with no boss kill between. */
  retreats: number
}

export type LevelAt = { level: number; hour: number }

export type LegendaryTimeline = {
  grantedHour: number
  /** The zone the party was in at the grant, whose reference level it was granted at. */
  zone: number
  level: number
  /** Each level it gained after the grant. */
  levels: LevelAt[]
  /** The live hour it reached its cap of 50; null while it has not. */
  capHour: number | null
}

export type ScenarioReport = {
  ticks: number
  toolCalls: number
  turnBosses: number
  zone: number
  wave: number
  highestZone: number
  wipes: number
  kills: number
  gold: number
  party: { cls: HeroClass; rarity: Rarity; level: number }[]
  dropsByRarity: Record<Rarity, number>
  drops: {
    /** Drops that went into the inventory. */
    taken: number
    /** Drops the sim vendored because the inventory was full. */
    vendoredFull: number
    /** Unworn items the player vendored at a turn's end. */
    vendoredAtTurnEnd: number
  }
  upgrades: {
    equipped: number
    /** Equipped after more drops were taken than the starting inventory holds. */
    pastFullInventory: number
  }
  roundsPerKillZone1: number
  /** Party hero actions ÷ (combat ticks × living party heroes at each tick's start). */
  heroActsPerCombatTick: number
  /** Longest action queue seen at the end of a tick. */
  maxQueue: number
  cadence: {
    name: string
    /** Turns started: each begins with a prompt. */
    prompts: number
    promptsPerHour: number
    /** Seconds inside turns ÷ live seconds. */
    inTurnShare: number
  }
  zones: ZoneTimeline[]
  /** Each level a party hero first held, and the live hour. */
  levels: LevelAt[]
  legendary: LegendaryTimeline | null
}

/** atk + def an item adds to its wearer. */
function itemScore(item: Item): number {
  const base = content.itemBases[item.base]
  if (!base) return 0
  const mult = content.rarity[item.rarity].statMultBp
  let score =
    Math.floor(((base.stats.atk ?? 0) * mult) / 10000) +
    Math.floor(((base.stats.def ?? 0) * mult) / 10000)
  for (const affix of item.affixes) {
    const stat = content.affixes[affix.id]?.stat
    if (stat === 'atk' || stat === 'def') score += affixValue(item, affix)
  }
  return score
}

/** The harness player's one habit at a drop: wear it when it beats what a matching hero wears. */
function equipUpgrades(state: GameState, item: Item): Event | null {
  const base = content.itemBases[item.base]
  if (!base) return null
  const score = itemScore(item)
  const heroes = [
    ...state.party.flatMap((id) => state.roster.filter((h) => h.id === id)),
    ...state.roster.filter((h) => !state.party.includes(h.id)),
  ]
  for (const hero of heroes) {
    if (!base.classes.includes(hero.cls)) continue
    const currentId = hero.equipment[base.slot]
    const current = currentId ? state.inventory.find((i) => i.id === currentId) : undefined
    if (!current || itemScore(current) < score) {
      return { t: 'equip', heroId: hero.id, itemId: item.id }
    }
  }
  return null
}

/**
 * A Legendary Knight in the party's first slot in place of the Common Knight, wearing its gear,
 * at full HP. Its traits come from a stream of the seed's own, so the game's rng is untouched.
 */
function grantLegendary(state: GameState, level: number): { state: GameState; hero: Hero } {
  const s = clone(state)
  const scratch = clone(state)
  scratch.rng = (state.seed ^ 0x1e6e9d00) >>> 0
  const hero = generateHero(scratch, 'legendary', 'knight_1')
  hero.id = `h${s.counter.toString(36)}`
  s.counter += 1
  hero.level = Math.min(level, content.rarity.legendary.levelCap)
  const knight = s.roster.find((h) => h.id === s.party[0])
  if (knight) {
    hero.equipment = { ...knight.equipment }
    knight.equipment = { weapon: null, armour: null, accessory: null }
    for (const item of s.inventory) if (item.equippedBy === knight.id) item.equippedBy = hero.id
  }
  s.roster.push(hero)
  hero.hp = heroStats(s, hero).hp
  s.party = [hero.id, s.party[1], s.party[2]]
  if (s.pendingParty) s.pendingParty = [hero.id, s.pendingParty[1], s.pendingParty[2]]
  return { state: s, hero }
}

export function runScenario(options: ScenarioOptions): ScenarioReport {
  const cadence = options.cadence ?? REFERENCE
  const restEvery = options.restEveryTurns ?? 1
  const legendaryAt =
    options.legendaryAtHour === undefined ? LEGENDARY_AT_HOUR : options.legendaryAtHour
  let state = createInitialState(options.seed)
  const startingInventoryCap = state.inventoryCap
  const report: ScenarioReport = {
    ticks: 0,
    toolCalls: 0,
    turnBosses: 0,
    zone: 1,
    wave: 1,
    highestZone: 1,
    wipes: 0,
    kills: 0,
    gold: 0,
    party: [],
    dropsByRarity: { common: 0, uncommon: 0, rare: 0, epic: 0, legendary: 0 },
    drops: { taken: 0, vendoredFull: 0, vendoredAtTurnEnd: 0 },
    upgrades: { equipped: 0, pastFullInventory: 0 },
    roundsPerKillZone1: 0,
    heroActsPerCombatTick: 0,
    maxQueue: 0,
    cadence: {
      name: cadence.kind === 'fixed' ? 'fixed' : cadence.name,
      prompts: 0,
      promptsPerHour: 0,
      inTurnShare: 0,
    },
    zones: [],
    levels: [],
    legendary: null,
  }
  let heroActs = 0
  let heroTicks = 0
  let zone1Rounds = 0
  let zone1Kills = 0
  let elapsed = 0
  let inTurn = 0
  let legendaryId: string | null = null

  const hour = (): number => Math.round(elapsed / 36) / 100
  const zoneLine = (zone: number): ZoneTimeline => {
    let line = report.zones.find((z) => z.zone === zone)
    if (!line) {
      line = { zone, firstReachedHour: hour(), firstClearedHour: null, wipes: 0, retreats: 0 }
      report.zones.push(line)
    }
    return line
  }
  const noteLevels = (): void => {
    const top = Math.max(
      ...state.party.map((id) => state.roster.find((h) => h.id === id)?.level ?? 1),
    )
    while (report.levels.length < top)
      report.levels.push({ level: report.levels.length + 1, hour: hour() })
  }

  const apply = (event: Event): void => {
    const before = state
    const r = step(state, event)
    state = r.state
    if (before.zone === 1) {
      zone1Rounds += state.tick - before.tick
      zone1Kills += state.stats.kills - before.stats.kills
    }
    if (event.t === 'tick') report.ticks += 1
    // A combat tick is one that ran the battle loop: only those count in state.tick.
    if (state.tick > before.tick) {
      heroTicks += livingParty(before).length
      for (const e of r.effects) if (e.k === 'act' && before.party.includes(e.actor)) heroActs += 1
    }
    report.maxQueue = Math.max(report.maxQueue, state.battle.queue.length)
    if (event.t === 'tool_call') report.toolCalls += 1
    if (event.t === 'equip' && !r.effects.some((e) => e.k === 'rejected')) {
      report.upgrades.equipped += 1
      if (report.drops.taken > startingInventoryCap) report.upgrades.pastFullInventory += 1
    }
    for (const effect of r.effects) onEffect(effect, before)
    zoneLine(state.zone)
  }

  const onEffect = (effect: Effect, before: GameState): void => {
    switch (effect.k) {
      case 'boss_spawned':
        if (effect.kind === 'turn_boss') report.turnBosses += 1
        return
      case 'drop_vendored':
        report.dropsByRarity[effect.item.rarity] += 1
        report.drops.vendoredFull += 1
        return
      case 'drop': {
        report.dropsByRarity[effect.item.rarity] += 1
        report.drops.taken += 1
        const equip = equipUpgrades(state, effect.item)
        if (equip) apply(equip)
        return
      }
      case 'zone_cleared': {
        const line = zoneLine(effect.zone)
        if (line.firstClearedHour === null) line.firstClearedHour = hour()
        return
      }
      case 'wipe':
        zoneLine(before.zone).wipes += 1
        return
      case 'retreat': {
        const line = zoneLine(before.zone)
        line.wipes += 1
        line.retreats += 1
        return
      }
      case 'level_up': {
        noteLevels()
        const l = report.legendary
        if (l && effect.heroId === legendaryId) {
          l.levels.push({ level: effect.level, hour: hour() })
          if (effect.level >= content.rarity.legendary.levelCap) l.capHour = hour()
        }
        return
      }
    }
  }

  const maybeGrant = (): void => {
    if (legendaryAt === null || legendaryId !== null || elapsed < legendaryAt * 3600) return
    const zone = zoneAt(state.zone)
    const level = referenceRow(zone?.base ?? 1).level
    const granted = grantLegendary(state, level)
    state = granted.state
    legendaryId = granted.hero.id
    report.legendary = {
      grantedHour: hour(),
      zone: state.zone,
      level: granted.hero.level,
      levels: [],
      capHour: null,
    }
    noteLevels()
  }

  /** The player's disposal at a turn's end: every item no hero wears is vendored. */
  const vendorUnworn = (): void => {
    for (const item of state.inventory) {
      if (item.equippedBy !== null) continue
      apply({ t: 'vendor', itemId: item.id })
      report.drops.vendoredAtTurnEnd += 1
    }
  }

  zoneLine(1)
  noteLevels()
  const nextTurn = turnSource(cadence, options.seed)
  const total = options.hours * 3600
  while (elapsed < total) {
    const turn = nextTurn()
    if (restEvery > 0 && report.cadence.prompts % restEvery === 0) apply({ t: 'rest' })
    report.cadence.prompts += 1
    let call = 0
    for (let t = 0; t < turn.lengthSec && elapsed < total; t++, elapsed++, inTurn++) {
      maybeGrant()
      for (; call < turn.calls.length && (turn.calls[call] ?? 0) <= t; call++) {
        apply({ t: 'tool_call' })
      }
      if (t % 2 === 0) apply({ t: 'tick' })
    }
    apply({ t: 'turn_end' })
    vendorUnworn()
    for (let t = 0; t < turn.idleSec && elapsed < total; t++, elapsed++) {
      maybeGrant()
      if (t % 5 === 0) apply({ t: 'tick' })
    }
  }

  report.zone = state.zone
  report.wave = state.wave
  report.highestZone = state.highestZone
  report.wipes = state.stats.wipes
  report.kills = state.stats.kills
  report.gold = state.gold
  report.party = state.party.flatMap((id) =>
    state.roster
      .filter((h) => h.id === id)
      .map((h) => ({ cls: h.cls, rarity: h.rarity, level: h.level })),
  )
  report.zones.sort((a, b) => a.zone - b.zone)
  report.heroActsPerCombatTick =
    heroTicks > 0 ? Math.round((heroActs / heroTicks) * 1000) / 1000 : 0
  report.roundsPerKillZone1 = zone1Kills > 0 ? Math.floor(zone1Rounds / zone1Kills) : 0
  report.cadence.promptsPerHour =
    elapsed > 0 ? Math.round((report.cadence.prompts * 360000) / elapsed) / 100 : 0
  report.cadence.inTurnShare = elapsed > 0 ? Math.round((inTurn * 1000) / elapsed) / 1000 : 0
  return report
}
