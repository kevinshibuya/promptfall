import type { HeroClass, Rarity, Slot } from '../types'
import { RARITIES } from '../types'
import type { Content, Tactic } from './types'

const CLASSES: HeroClass[] = ['knight', 'black_mage', 'white_mage', 'archer']
const SLOTS: Slot[] = ['weapon', 'armour', 'accessory']
const STARTER_TEMPLATES = ['archer_1', 'black_mage_1', 'knight_1', 'white_mage_1']
const RARITY_COUNTS = [0, 1, 2, 3, 4]
const LEVEL_CAPS = [20, 30, 40, 45, 50]
const STAT_MULTS = [10000, 11000, 12000, 13500, 15000]

const ARCHETYPES = ['brute', 'swift', 'tank', 'caster', 'boss', 'turn_boss', 'world_boss'] as const

function isWeight(n: unknown): boolean {
  return typeof n === 'number' && Number.isInteger(n) && n >= 0
}

function checkTactics(problems: string[], where: string, list: Tactic[] | undefined): void {
  if (!list || list.length === 0) {
    problems.push(`${where}: needs at least one tactic`)
    return
  }
  list.forEach((tactic, i) => {
    const at = `${where} tactic ${i} (${tactic.action})`
    const w = tactic.weight
    const weights = w.kind === 'fixed' ? [w.weight] : [w.belowBp, w.scale]
    const t = tactic.target
    if (t.kind === 'front') weights.push(t.front, t.other)
    if (t.kind === 'weakest') weights.push(t.weakest, t.other)
    if (t.kind === 'class') weights.push(t.match, t.other)
    if (tactic.minAllies !== undefined) weights.push(tactic.minAllies)
    if (!weights.every(isWeight)) problems.push(`${at}: weights must be non-negative integers`)
    if (w.kind === 'ally_need' && w.belowBp < 2) problems.push(`${at}: belowBp must be at least 2`)
  })
}

function checkWeights(problems: string[], where: string, weights: Record<Rarity, number>): void {
  for (const r of RARITIES) {
    const w = weights[r]
    if (typeof w !== 'number' || !Number.isInteger(w) || w <= 0) {
      problems.push(`${where}: weight for ${r} must be a positive integer`)
    }
  }
}

export function validateContent(content: Content): string[] {
  const problems: string[] = []

  // Zones
  if (content.zones.length !== 12) problems.push(`zones: expected 12, got ${content.zones.length}`)
  content.zones.forEach((zone, i) => {
    const where = `zone ${zone.index} (${zone.name})`
    if (zone.index !== i + 1) problems.push(`${where}: index should be ${i + 1}`)
    if (zone.enemies.length < 4) problems.push(`${where}: needs at least 4 wave enemies`)
    for (const id of zone.enemies) {
      const def = content.enemies[id]
      if (!def) problems.push(`${where}: enemy '${id}' does not exist`)
      else if (def.kind !== 'wave') problems.push(`${where}: enemy '${id}' is not a wave enemy`)
    }
    const boss = content.enemies[zone.boss]
    if (!boss) problems.push(`${where}: boss '${zone.boss}' does not exist`)
    else if (boss.kind !== 'zone_boss')
      problems.push(`${where}: boss '${zone.boss}' is not a zone boss`)
    const turnBoss = content.enemies[zone.turnBoss]
    if (!turnBoss) problems.push(`${where}: turn boss '${zone.turnBoss}' does not exist`)
    else if (turnBoss.kind !== 'turn_boss') {
      problems.push(`${where}: turn boss '${zone.turnBoss}' is not a turn boss`)
    }
    checkWeights(problems, `${where} rarityWeights`, zone.rarityWeights)
    checkWeights(problems, `${where} bossRarityWeights`, zone.bossRarityWeights)
  })

  // Enemies
  for (const [key, def] of Object.entries(content.enemies)) {
    const where = `enemy '${key}'`
    if (def.id !== key) problems.push(`${where}: id mismatch '${def.id}'`)
    if (def.zone < 1 || def.zone > 12) problems.push(`${where}: zone ${def.zone} out of range`)
    if (def.stats.hp < 1 || def.stats.atk < 1) problems.push(`${where}: hp and atk must be >= 1`)
    if (def.gold[0] > def.gold[1]) problems.push(`${where}: gold range min > max`)
    if (def.dropBp < 0 || def.dropBp > 10000) problems.push(`${where}: dropBp out of range`)
    if (def.contractBp < 0 || def.contractBp > 10000) {
      problems.push(`${where}: contractBp out of range`)
    }
  }

  // Item bases
  for (const [key, b] of Object.entries(content.itemBases)) {
    if (b.id !== key) problems.push(`item base '${key}': id mismatch '${b.id}'`)
    if (b.classes.length === 0) problems.push(`item base '${key}': admits no class`)
    for (const c of b.classes) {
      if (!CLASSES.includes(c)) problems.push(`item base '${key}': unknown class '${c}'`)
    }
    if (!SLOTS.includes(b.slot)) problems.push(`item base '${key}': unknown slot '${b.slot}'`)
  }
  for (const cls of CLASSES) {
    for (const slot of SLOTS) {
      const count = Object.values(content.itemBases).filter(
        (b) => b.slot === slot && b.minZone === 1 && b.classes.includes(cls),
      ).length
      if (count < 2) problems.push(`item bases: ${cls} has ${count} zone 1 ${slot} bases, needs 2`)
      for (const unlock of [4, 7, 10]) {
        const has = Object.values(content.itemBases).some(
          (b) => b.slot === slot && b.minZone === unlock && b.classes.includes(cls),
        )
        if (!has) problems.push(`item bases: ${cls} has no ${slot} unlocking at zone ${unlock}`)
      }
    }
  }

  // Affixes
  for (const [key, a] of Object.entries(content.affixes)) {
    if (a.id !== key) problems.push(`affix '${key}': id mismatch '${a.id}'`)
    if (a.range[0] > a.range[1]) problems.push(`affix '${key}': range min > max`)
  }
  for (const slot of SLOTS) {
    const count = Object.values(content.affixes).filter((a) => a.slots.includes(slot)).length
    if (count < 8) problems.push(`affixes: ${slot} has ${count}, needs 8`)
  }

  // Heroes
  const templateIds = Object.keys(content.heroTemplates).sort()
  if (templateIds.join(',') !== STARTER_TEMPLATES.join(',')) {
    problems.push(`hero templates: expected ${STARTER_TEMPLATES.join(', ')}`)
  }
  for (const [key, t] of Object.entries(content.heroTemplates)) {
    if (t.id !== key) problems.push(`hero template '${key}': id mismatch '${t.id}'`)
    if (!CLASSES.includes(t.cls)) problems.push(`hero template '${key}': unknown class`)
    if (t.base.hp < 1) problems.push(`hero template '${key}': base hp must be >= 1`)
  }

  // Tactics
  for (const cls of CLASSES) checkTactics(problems, `tactics ${cls}`, content.tactics.heroes[cls])
  for (const a of ARCHETYPES) checkTactics(problems, `tactics ${a}`, content.tactics.enemies[a])

  // Traits and epithets
  if (Object.keys(content.traits).length < 6) problems.push('traits: needs at least 6')
  for (const [key, t] of Object.entries(content.traits)) {
    if (t.id !== key) problems.push(`trait '${key}': id mismatch '${t.id}'`)
    if (t.rangeBp[0] > t.rangeBp[1]) problems.push(`trait '${key}': range min > max`)
  }
  if (content.epithets.length < 40) problems.push('epithets: needs at least 40')

  // Rarity rules
  RARITIES.forEach((r, i) => {
    const rule = content.rarity[r]
    if (rule.affixCount !== RARITY_COUNTS[i]) problems.push(`rarity ${r}: affixCount`)
    if (rule.traitCount !== RARITY_COUNTS[i]) problems.push(`rarity ${r}: traitCount`)
    if (rule.levelCap !== LEVEL_CAPS[i]) problems.push(`rarity ${r}: levelCap`)
    if (rule.statMultBp !== STAT_MULTS[i]) problems.push(`rarity ${r}: statMultBp`)
  })

  // Tavern
  checkWeights(problems, 'tavern odds', content.tavern.odds)
  const oddsTotal = RARITIES.reduce((sum, r) => sum + content.tavern.odds[r], 0)
  if (oddsTotal !== 10000) problems.push(`tavern odds: sum ${oddsTotal}, expected 10000`)
  if (content.tavern.odds.legendary > 100) problems.push('tavern odds: legendary above 100')

  // Expansions
  const inv = content.expansions.inventory
  if (inv.costs.length !== (inv.max - 30) / inv.step) {
    problems.push('expansions: inventory costs length does not match (max - 30) / step')
  }
  const ros = content.expansions.roster
  if (ros.costs.length !== (ros.max - 24) / ros.step) {
    problems.push('expansions: roster costs length does not match (max - 24) / step')
  }

  return problems
}
