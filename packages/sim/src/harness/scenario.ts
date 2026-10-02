import { content } from '../content'
import { createInitialState } from '../state'
import { step } from '../step'
import type { Effect, Event, GameState, Item, Rarity } from '../types'

export type ScenarioOptions = {
  seed: number
  hours: number
  activeShareBp: number
  toolCallEverySec: number
  turnLengthSec: number
  restEveryTurns: number
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
  levels: number[]
  dropsByRarity: Record<Rarity, number>
  roundsPerKillZone1: number
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
    if (stat === 'atk' || stat === 'def') score += affix.value
  }
  return score
}

/** The harness player's one habit: wear any drop that beats what a matching hero wears. */
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

export function runScenario(options: ScenarioOptions): ScenarioReport {
  let state = createInitialState(options.seed)
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
    levels: [],
    dropsByRarity: { common: 0, uncommon: 0, rare: 0, epic: 0, legendary: 0 },
    roundsPerKillZone1: 0,
  }
  let zone1Rounds = 0
  let zone1Kills = 0

  const apply = (event: Event): void => {
    const before = state
    const r = step(state, event)
    state = r.state
    if (before.zone === 1) {
      zone1Rounds += state.tick - before.tick
      zone1Kills += state.stats.kills - before.stats.kills
    }
    if (event.t === 'tick') report.ticks += 1
    if (event.t === 'tool_call') report.toolCalls += 1
    for (const effect of r.effects) onEffect(effect)
  }

  const onEffect = (effect: Effect): void => {
    if (effect.k === 'boss_spawned' && effect.kind === 'turn_boss') report.turnBosses += 1
    if (effect.k === 'drop' || effect.k === 'drop_vendored') {
      report.dropsByRarity[effect.item.rarity] += 1
    }
    if (effect.k === 'drop') {
      const equip = equipUpgrades(state, effect.item)
      if (equip) apply(equip)
    }
  }

  const total = options.hours * 3600
  const turn = options.turnLengthSec
  const idle = Math.floor((turn * (10000 - options.activeShareBp)) / options.activeShareBp)
  let elapsed = 0
  let turns = 0
  while (elapsed < total) {
    if (options.restEveryTurns > 0 && turns % options.restEveryTurns === 0) apply({ t: 'rest' })
    for (let t = 0; t < turn && elapsed < total; t++, elapsed++) {
      if (t > 0 && t % options.toolCallEverySec === 0) apply({ t: 'tool_call' })
      if (t % 2 === 0) apply({ t: 'tick' })
    }
    apply({ t: 'turn_end' })
    turns += 1
    for (let t = 0; t < idle && elapsed < total; t++, elapsed++) {
      if (t % 5 === 0) apply({ t: 'tick' })
    }
  }

  report.zone = state.zone
  report.wave = state.wave
  report.highestZone = state.highestZone
  report.wipes = state.stats.wipes
  report.kills = state.stats.kills
  report.gold = state.gold
  report.levels = state.party.map((id) => state.roster.find((h) => h.id === id)?.level ?? 0)
  report.roundsPerKillZone1 = zone1Kills > 0 ? Math.floor(zone1Rounds / zone1Kills) : 0
  return report
}

