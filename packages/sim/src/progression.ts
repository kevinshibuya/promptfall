import { SPAWN_GAUGE_MAX } from './battle'
import { content, enemyAt, LADDER_END, zoneAt } from './content'
import type { EnemyDef } from './content/types'
import { affixValue, rollDrops, takeDrop } from './loot'
import { nextU32, pickWeighted } from './rng'
import { earn, tallyKill, tallySeen } from './tallies'
import type {
  Effect,
  Encounter,
  Enemy,
  EnemyKind,
  GameState,
  Hero,
  Item,
  Slot,
  Stat,
  Stats,
  WaveArchetype,
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
  // A hero's rarity multiplies its template's base and growth as an item's multiplies its base.
  const heroMult = content.rarity[hero.rarity].statMultBp
  if (template) {
    for (const stat of STATS) {
      const raw = template.base[stat] + template.growth[stat] * (hero.level - 1)
      stats[stat] = Math.floor((raw * heroMult) / 10000)
    }
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
      if (def) stats[def.stat] += affixValue(item, affix)
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

export function applyPendingParty(s: GameState, effects: Effect[]): void {
  if (!s.pendingParty) return
  s.party = [...s.pendingParty]
  s.pendingParty = null
  effects.push({ k: 'party_applied', heroIds: [...s.party] })
}

// ---------------------------------------------------------------------------
// Spawning

/**
 * A wave's encounter counts what the wave has got: `waveSize` is every enemy that joined it, the
 * draw at its open and each tool call's, and `spawnedInWave` how many of them reached the field.
 * An encounter with a `waveSize` of 0 holds no wave: a turn boss alone, or wave 11's.
 */
function openEncounter(s: GameState): Encounter {
  const encounter: Encounter = { enemies: [], queue: [], waveSize: 0, spawnedInWave: 0 }
  s.encounter = encounter
  return encounter
}

function spawnEnemy(s: GameState, encounter: Encounter, defId: string, kind: EnemyKind): void {
  const def = enemyAt(defId, s.zone)
  const hp = def ? def.stats.hp : 1
  const enemy: Enemy = { id: newId(s, 'e'), def: defId, kind, hp, maxHp: hp, enraged: false }
  encounter.enemies.push(enemy)
  tallySeen(s, defId)
  s.battle.gauges.push({ id: enemy.id, g: draw(s, SPAWN_GAUGE_MAX + 1) })
}

/** The zone's wave enemy of the hinted archetype when its list holds one; else a uniform draw. */
function pickWaveEnemy(s: GameState, hint?: WaveArchetype): string {
  const zone = zoneAt(s.zone)?.def
  const hinted = hint
    ? zone?.enemies.find((id) => enemyAt(id, s.zone)?.archetype === hint)
    : undefined
  if (hinted) return hinted
  const weights: Record<string, number> = {}
  for (const id of zone?.enemies ?? []) weights[id] = 1
  return drawWeighted(s, weights)
}

const FIELD_MAX = 3
const QUEUE_MAX = 10

/** Queues a wave enemy unless the queue is full; one that queues counts toward an open wave. */
function enqueue(encounter: Encounter, defId: string, counts: boolean): void {
  if (encounter.queue.length >= QUEUE_MAX) return
  encounter.queue.push({ def: defId, kind: 'wave' })
  if (counts) encounter.waveSize += 1
}

/** Queues a wave's draw: `size` uniform picks from the zone's four, each counting toward it. */
function openWave(s: GameState, encounter: Encounter, size: number): void {
  for (let i = 0; i < size; i++) enqueue(encounter, pickWaveEnemy(s), true)
}

/** Fills every free slot from the queue. */
function refill(s: GameState, encounter: Encounter): void {
  while (encounter.enemies.length < FIELD_MAX) {
    const next = encounter.queue.shift()
    if (!next) break
    spawnEnemy(s, encounter, next.def, next.kind)
    if (encounter.waveSize > 0) encounter.spawnedInWave += 1
  }
}

export function onToolCall(s: GameState, hint?: WaveArchetype): void {
  s.turnToolCalls += 1
  // Boss mode: the call still counts toward the turn boss, and nothing spawns.
  if (s.boss) return
  // Wave 11 is the zone boss's: the call's enemy joins the encounter and counts toward nothing.
  if (s.wave === 11) {
    const encounter = s.encounter ?? openEncounter(s)
    enqueue(encounter, pickWaveEnemy(s, hint), false)
    refill(s, encounter)
    return
  }
  // No wave open, with no encounter or a turn boss alone: the call opens one with its draw. The
  // call's enemy queues first, so a hinted enemy steps on at once.
  const opens = !s.encounter || s.encounter.waveSize === 0
  const size = opens ? 1 + draw(s, 3) : 0
  const encounter = s.encounter ?? openEncounter(s)
  enqueue(encounter, pickWaveEnemy(s, hint), true)
  openWave(s, encounter, size)
  refill(s, encounter)
}

export function onTurnEnd(s: GameState): void {
  if (s.turnToolCalls >= 10) s.pendingTurnBoss = true
  s.turnToolCalls = 0
}

export function onRest(s: GameState): void {
  healParty(s, 5000)
}

/** A tick's backstop: every path that queues or kills refills on its own. */
export function refillFromQueue(s: GameState): void {
  if (s.encounter) refill(s, s.encounter)
}

/** Step 3 of a tick: nothing is alive, so something new arrives. */
export function spawnOnEmptyTick(s: GameState, effects: Effect[]): void {
  const zone = zoneAt(s.zone)?.def
  if (!zone) return
  if (s.pendingTurnBoss) {
    const encounter = s.encounter ?? openEncounter(s)
    spawnEnemy(s, encounter, zone.turnBoss, 'turn_boss')
    s.pendingTurnBoss = false
    effects.push({ k: 'boss_spawned', kind: 'turn_boss', def: zone.turnBoss })
    return
  }
  if (s.wave === 11) {
    const encounter = s.encounter ?? openEncounter(s)
    spawnEnemy(s, encounter, zone.boss, 'zone_boss')
    effects.push({ k: 'boss_spawned', kind: 'zone_boss', def: zone.boss })
    return
  }
  if (s.encounter) {
    refill(s, s.encounter)
    return
  }
  const encounter = openEncounter(s)
  openWave(s, encounter, 1 + draw(s, 3))
  refill(s, encounter)
}

// ---------------------------------------------------------------------------
// Kills, xp, waves, zones, wipes

export function grantXp(s: GameState, hero: Hero, xp: number, effects: Effect[]): void {
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

/** The encounter goes with no drops and no XP, and the battle resets as a wipe resets it. */
export function endEncounter(s: GameState): void {
  s.encounter = null
  s.battle = { gauges: [], queue: [], busy: 0 }
}

export function changeZone(s: GameState, zone: number): void {
  s.zone = zone
  s.wave = 1
  s.zoneWipes = 0
  if (zone > s.highestZone) s.highestZone = zone
}

/**
 * Removes a dead enemy and applies everything its death causes. A `drop` given is what the kill
 * drops in place of its roll.
 */
export function onEnemyKilled(s: GameState, enemy: Enemy, effects: Effect[], drop?: Item): void {
  const encounter = s.encounter
  if (!encounter) return
  encounter.enemies = encounter.enemies.filter((e) => e.id !== enemy.id)
  const def: EnemyDef | undefined = enemyAt(enemy.def, s.zone)
  if (def) {
    for (const hero of livingParty(s)) grantXp(s, hero, def.xp, effects)
    const [min, max] = def.gold
    const gold = min + draw(s, max - min + 1)
    earn(s, gold)
    effects.push({ k: 'gold', amount: gold })
  }
  s.stats.kills += 1
  if (enemy.kind !== 'wave') s.stats.bosses += 1
  tallyKill(s, enemy)
  if (drop) takeDrop(s, drop, effects)
  else if (def) {
    const r = rollDrops(s, def)
    Object.assign(s, r.state)
    effects.push(...r.effects)
  }

  if (enemy.kind === 'zone_boss') {
    const zone = s.zone
    s.encounter = null
    const advance = !s.farm && zone < LADDER_END
    const advancedTo = advance ? zone + 1 : zone
    effects.push({ k: 'zone_cleared', zone, advancedTo })
    changeZone(s, advancedTo)
    applyPendingParty(s, effects)
    // The boss is wave 11: the party taking the field heals and revives as after any wave.
    healParty(s, 1500)
    return
  }

  // The next in the queue takes the free slot before the clear check: a refilled field never
  // clears. A turn boss the wave opened around is checked like a wave monster.
  const current = s.encounter
  if (!current) return
  refill(s, current)
  if (current.enemies.length > 0 || current.queue.length > 0) return
  if (current.waveSize > 0 && current.spawnedInWave >= current.waveSize) {
    healParty(s, 1500)
    effects.push({ k: 'wave_cleared', zone: s.zone, wave: s.wave })
    s.encounter = null
    s.wave = Math.min(11, s.wave + 1)
    return
  }
  if (current.waveSize === 0) s.encounter = null
}

/** A zone's third wipe with no boss kill between them is a retreat. */
export const RETREAT_AT = 3

/** True when the wipe happened. */
export function checkWipe(s: GameState, effects: Effect[]): boolean {
  if (livingParty(s).length > 0) return false
  s.battle = { gauges: [], queue: [], busy: 0 }
  if (s.boss) {
    // Boss mode: the battle resets, the party heals in place. No retreat, no wipe, the
    // encounter and the pending party kept.
    fullHealParty(s)
    return true
  }
  s.encounter = null
  s.pendingTurnBoss = false
  s.stats.wipes += 1
  fullHealParty(s)
  if (s.zoneWipes + 1 < RETREAT_AT) {
    effects.push({ k: 'wipe', zone: s.zone })
    s.wave = 1
    s.zoneWipes += 1
  } else {
    const zone = Math.max(1, s.zone - 1)
    effects.push({ k: 'retreat', zone })
    changeZone(s, zone)
  }
  applyPendingParty(s, effects)
  fullHealParty(s)
  return true
}
