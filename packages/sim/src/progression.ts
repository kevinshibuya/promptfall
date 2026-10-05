import { SPAWN_GAUGE_MAX } from './battle'
import { content } from './content'
import type { EnemyDef } from './content/types'
import { rollDrops } from './loot'
import { nextU32, pickWeighted } from './rng'
import type {
  Effect,
  Encounter,
  Enemy,
  EnemyKind,
  GameState,
  Hero,
  Slot,
  Stat,
  Stats,
} from './types'

/** A value in [0, n), advancing the draft's rng in place. Same stream as `roll`. */
export function draw(s: GameState, n: number): number {
  const { s: next, u } = nextU32(s.rng)
  s.rng = next
  return u % Math.max(1, Math.floor(n))
}

export function drawBp(s: GameState): number {
  return draw(s, 10000)
}

export function drawWeighted<K extends string>(s: GameState, weights: Record<K, number>): K {
  const r = pickWeighted(s, weights)
  s.rng = r.state.rng
  return r.value
}

export function newId(s: GameState, prefix: 'h' | 'i' | 'e'): string {
  const id = prefix + s.counter.toString(36)
  s.counter += 1
  return id
}

// ---------------------------------------------------------------------------
// Stats

const STATS: Stat[] = ['hp', 'atk', 'def', 'spd']
const SLOTS: Slot[] = ['weapon', 'armour', 'accessory']

export function heroStats(state: GameState, hero: Hero): Stats {
  const template = content.heroTemplates[hero.template]
  const stats: Stats = { hp: 1, atk: 0, def: 0, spd: 0 }
  if (template) {
    for (const stat of STATS)
      stats[stat] = template.base[stat] + template.growth[stat] * (hero.level - 1)
  }
  for (const slot of SLOTS) {
    const itemId = hero.equipment[slot]
    if (!itemId) continue
    const item = state.inventory.find((i) => i.id === itemId)
    if (!item) continue
    const base = content.itemBases[item.base]
    const mult = content.rarity[item.rarity].statMultBp
    if (base) {
      for (const stat of STATS) {
        const v = base.stats[stat]
        if (v) stats[stat] += Math.floor((v * mult) / 10000)
      }
    }
    for (const affix of item.affixes) {
      const def = content.affixes[affix.id]
      if (def) stats[def.stat] += affix.value
    }
  }
  // Trait bonuses are computed from the pre-trait totals so their order does not matter.
  const pre = { ...stats }
  for (const trait of hero.traits) {
    const def = content.traits[trait.id]
    if (def) stats[def.stat] += Math.floor((pre[def.stat] * trait.valueBp) / 10000)
  }
  stats.hp = Math.max(1, stats.hp)
  return stats
}

export function clampHp(s: GameState, hero: Hero): void {
  hero.hp = Math.max(0, Math.min(hero.hp, heroStats(s, hero).hp))
}

// ---------------------------------------------------------------------------
// Party

export function findHero(s: GameState, id: string): Hero | undefined {
  return s.roster.find((h) => h.id === id)
}

export function partyHeroes(s: GameState): Hero[] {
  const out: Hero[] = []
  for (const id of s.party) {
    const hero = findHero(s, id)
    if (hero) out.push(hero)
  }
  return out
}

export function livingParty(s: GameState): Hero[] {
  return partyHeroes(s).filter((h) => h.hp > 0)
}

function healParty(s: GameState, bp: number): void {
  for (const hero of partyHeroes(s)) {
    const max = heroStats(s, hero).hp
    const amount = Math.max(1, Math.floor((max * bp) / 10000))
    hero.hp = hero.hp > 0 ? Math.min(max, hero.hp + amount) : amount
  }
}

function fullHealParty(s: GameState): void {
  for (const hero of partyHeroes(s)) hero.hp = heroStats(s, hero).hp
}

function applyPendingParty(s: GameState, effects: Effect[]): void {
  if (!s.pendingParty) return
  s.party = [...s.pendingParty]
  s.pendingParty = null
  effects.push({ k: 'party_applied', heroIds: [...s.party] })
}

// ---------------------------------------------------------------------------
// Spawning

function openEncounter(s: GameState, waveSize: number): Encounter {
  const encounter: Encounter = { enemies: [], queue: [], waveSize, spawnedInWave: 0 }
  s.encounter = encounter
  return encounter
}

function spawnEnemy(s: GameState, encounter: Encounter, defId: string, kind: EnemyKind): void {
  const def = content.enemies[defId]
  const hp = def ? def.stats.hp : 1
  const enemy: Enemy = { id: newId(s, 'e'), def: defId, kind, hp, maxHp: hp }
  encounter.enemies.push(enemy)
  s.battle.gauges.push({ id: enemy.id, g: draw(s, SPAWN_GAUGE_MAX + 1) })
}

function pickWaveEnemy(s: GameState): string {
  const zone = content.zones[s.zone - 1]
  const weights: Record<string, number> = {}
  for (const id of zone?.enemies ?? []) weights[id] = 1
  return drawWeighted(s, weights)
}

export function onToolCall(s: GameState): void {
  s.turnToolCalls += 1
  // Boss mode: the call still counts toward the turn boss, and nothing spawns.
  if (s.boss) return
  const encounter = s.encounter ?? openEncounter(s, 1 + draw(s, 3))
  const defId = pickWaveEnemy(s)
  if (encounter.enemies.length < 3) spawnEnemy(s, encounter, defId, 'wave')
  else if (encounter.queue.length < 10) encounter.queue.push({ def: defId, kind: 'wave' })
}

export function onTurnEnd(s: GameState): void {
  if (s.turnToolCalls >= 10) s.pendingTurnBoss = true
  s.turnToolCalls = 0
}

export function onRest(s: GameState): void {
  healParty(s, 3000)
}

export function refillFromQueue(s: GameState): void {
  const encounter = s.encounter
  if (!encounter) return
  while (encounter.enemies.length < 3) {
    const next = encounter.queue.shift()
    if (!next) break
    spawnEnemy(s, encounter, next.def, next.kind)
  }
}

/** Step 3 of a tick: nothing is alive, so something new arrives. */
export function spawnOnEmptyTick(s: GameState, effects: Effect[]): void {
  const zone = content.zones[s.zone - 1]
  if (!zone) return
  if (s.pendingTurnBoss) {
    const encounter = s.encounter ?? openEncounter(s, 0)
    spawnEnemy(s, encounter, zone.turnBoss, 'turn_boss')
    s.pendingTurnBoss = false
    effects.push({ k: 'boss_spawned', kind: 'turn_boss', def: zone.turnBoss })
    return
  }
  if (s.wave === 11) {
    const encounter = s.encounter ?? openEncounter(s, 0)
    spawnEnemy(s, encounter, zone.boss, 'zone_boss')
    effects.push({ k: 'boss_spawned', kind: 'zone_boss', def: zone.boss })
    return
  }
  const encounter = s.encounter ?? openEncounter(s, 1 + draw(s, 3))
  spawnEnemy(s, encounter, pickWaveEnemy(s), 'wave')
  encounter.spawnedInWave += 1
}

// ---------------------------------------------------------------------------
// Kills, xp, waves, zones, wipes

function grantXp(s: GameState, hero: Hero, xp: number, effects: Effect[]): void {
  const cap = content.rarity[hero.rarity].levelCap
  if (hero.level >= cap) {
    hero.xp = 0
    return
  }
  hero.xp += xp
  while (hero.level < cap && hero.xp >= content.xpToNext(hero.level)) {
    const before = heroStats(s, hero).hp
    hero.xp -= content.xpToNext(hero.level)
    hero.level += 1
    const after = heroStats(s, hero).hp
    if (hero.hp > 0) hero.hp = Math.min(after, hero.hp + Math.max(0, after - before))
    effects.push({ k: 'level_up', heroId: hero.id, level: hero.level })
  }
  if (hero.level >= cap) hero.xp = 0
}

function changeZone(s: GameState, zone: number): void {
  s.zone = zone
  s.wave = 1
  if (zone > s.highestZone) s.highestZone = zone
}

/** Removes a dead enemy and applies everything its death causes. */
export function onEnemyKilled(s: GameState, enemy: Enemy, effects: Effect[]): void {
  const encounter = s.encounter
  if (!encounter) return
  encounter.enemies = encounter.enemies.filter((e) => e.id !== enemy.id)
  const def: EnemyDef | undefined = content.enemies[enemy.def]
  if (def) {
    for (const hero of livingParty(s)) grantXp(s, hero, def.xp, effects)
    const [min, max] = def.gold
    const gold = min + draw(s, max - min + 1)
    s.gold += gold
    effects.push({ k: 'gold', amount: gold })
  }
  s.stats.kills += 1
  if (enemy.kind !== 'wave') s.stats.bosses += 1
  if (def) {
    const r = rollDrops(s, def)
    Object.assign(s, r.state)
    effects.push(...r.effects)
  }

  if (enemy.kind === 'zone_boss') {
    const zone = s.zone
    s.encounter = null
    const advance = !s.farm && zone < 12
    const advancedTo = advance ? zone + 1 : zone
    effects.push({ k: 'zone_cleared', zone, advancedTo })
    changeZone(s, advancedTo)
    applyPendingParty(s, effects)
    // The boss is wave 11: the party taking the field heals and revives as after any wave.
    healParty(s, 1500)
    return
  }

  const current = s.encounter
  if (!current || current.enemies.length > 0 || current.queue.length > 0) return
  if (enemy.kind === 'turn_boss') {
    s.encounter = null
    return
  }
  if (current.waveSize > 0 && current.spawnedInWave >= current.waveSize) {
    healParty(s, 1500)
    effects.push({ k: 'wave_cleared', zone: s.zone, wave: s.wave })
    s.encounter = null
    s.wave = Math.min(11, s.wave + 1)
    return
  }
  if (current.waveSize === 0) s.encounter = null
}

/** True when the wipe happened. */
export function checkWipe(s: GameState, effects: Effect[]): boolean {
  if (livingParty(s).length > 0) return false
  if (s.boss) {
    // Boss mode: healed in place. No retreat, no wipe, the encounter and the pending party kept.
    fullHealParty(s)
    return true
  }
  const retreatedTo = Math.max(1, s.zone - 1)
  effects.push({ k: 'wipe', retreatedTo })
  s.battle = { gauges: [], queue: [], busy: 0 }
  s.encounter = null
  s.pendingTurnBoss = false
  s.stats.wipes += 1
  fullHealParty(s)
  changeZone(s, retreatedTo)
  applyPendingParty(s, effects)
  fullHealParty(s)
  return true
}
