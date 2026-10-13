import { HIT_ALL_BP, RAGE_BP, SELF_HEAL_BP, STRIKE_TWICE_BP, scaled } from '../battle'
import { enemyStats, hitDamage, NO_VARIANCE_BP } from '../combat'
import { type BossMove, content, enemyAt, LADDER_END, zoneAt } from '../content'
import { actionWeights } from '../picker'
import { heroStats } from '../progression'
import { compareCodeUnits } from '../rng'
import { createInitialState } from '../state'
import type {
  Affix,
  Enemy,
  EnemyKind,
  GameState,
  Hero,
  HeroClass,
  Item,
  Rarity,
  Slot,
} from '../types'
import { REFERENCE_PARTY, type ReferenceRow } from './reference'

/** The feel target: hits the reference Knight survives from one wave enemy, and from the zone boss. */
export const BAND = { wave: [6, 10], boss: [3, 4] } as const

export type ProbeZone = ReferenceRow & {
  /** The running zone number probed; `zone` of the row is its base zone. */
  base: number
  tier: number
  knight: { hp: number; def: number }
  /** Hits survived, from the hardest-hitting wave enemy (min) to the softest (max). */
  knightWaveHits: { min: number; max: number }
  /** The zone boss's move: the band counts its actions, each as the move lands it on the Knight. */
  bossMove: BossMove | null
  knightBossHits: number
  /** Reported, not asserted. */
  knightTurnBossHits: number
  /**
   * Reported, not asserted: the Knight hits a healing boss's heals add to the fight, from the heals
   * its need weight predicts over its under-half HP; 0 for any other move. A heal is no hit.
   */
  healKnightHits: number
}

export type Probe = { tier: number; band: typeof BAND; zones: ProbeZone[] }

const SLOTS: Slot[] = ['weapon', 'armour', 'accessory']

/** The top tier of bases: tiers past it wear its bases, at their own tier. */
const TOP_BASE_TIER = Math.ceil(content.zones.length / 3)

/** A class's base for a slot in a gear tier: the highest stat total, ties to the lower id. */
function gearBase(slot: Slot, gearTier: number, cls: HeroClass): string | null {
  const baseTier = Math.min(gearTier, TOP_BASE_TIER)
  const ids = Object.keys(content.itemBases)
    .sort(compareCodeUnits)
    .filter((id) => {
      const b = content.itemBases[id]
      return (
        b !== undefined &&
        b.slot === slot &&
        b.classes.includes(cls) &&
        Math.ceil(b.minZone / 3) === baseTier
      )
    })
  const total = (id: string) =>
    Object.values(content.itemBases[id]?.stats ?? {}).reduce((n, v) => n + (v ?? 0), 0)
  let best: string | null = null
  for (const id of ids) if (best === null || total(id) > total(best)) best = id
  return best
}

/**
 * The affixes of a reference item: its rarity's count of the slot's affixes in id order, each
 * rolled at `rollBp` of its range. None when the row names no rolls.
 */
function gearAffixes(slot: Slot, rarity: Rarity, rollBp: number | undefined): Affix[] {
  if (rollBp === undefined) return []
  return Object.keys(content.affixes)
    .sort(compareCodeUnits)
    .filter((id) => content.affixes[id]?.slots.includes(slot))
    .slice(0, content.rarity[rarity].affixCount)
    .map((id) => {
      const [min, max] = content.affixes[id]?.range ?? [0, 0]
      return { id, value: min + Math.floor(((max - min) * rollBp) / 10000) }
    })
}

const PARTY: { template: string; cls: HeroClass }[] = [
  { template: 'knight_1', cls: 'knight' },
  { template: 'black_mage_1', cls: 'black_mage' },
  { template: 'white_mage_1', cls: 'white_mage' },
]

/**
 * A state at the row's zone holding the reference party, the Knight first, each hero in its
 * class's reference gear, without traits and at full HP. Its stream is `seed`'s.
 */
export function referenceParty(row: ReferenceRow, seed = 0): GameState {
  const s = createInitialState(seed)
  const roster: Hero[] = []
  const inventory: Item[] = []
  for (const [i, { template, cls }] of PARTY.entries()) {
    const id = `ref_${cls}`
    const hero: Hero = {
      id,
      template,
      cls,
      epithet: '',
      rarity: i === 0 ? row.knightRarity : (row.others?.rarity ?? 'common'),
      traits: [],
      level: i === 0 ? row.level : (row.others?.level ?? row.level),
      xp: 0,
      hp: 1,
      equipment: { weapon: null, armour: null, accessory: null },
      tradeableAt: null,
    }
    for (const slot of SLOTS) {
      const base = gearBase(slot, row.gearTier, cls)
      if (!base) continue
      const item: Item = {
        id: `ref_${cls}_${slot}`,
        base,
        rarity: row.gearRarity,
        tier: row.gearTier,
        affixes: gearAffixes(slot, row.gearRarity, row.rollBp),
        equippedBy: id,
        tradeableAt: null,
      }
      inventory.push(item)
      hero.equipment[slot] = item.id
    }
    roster.push(hero)
  }
  const state: GameState = {
    ...s,
    zone: row.zone,
    highestZone: row.zone,
    roster,
    party: [roster[0]?.id ?? '', roster[1]?.id ?? '', roster[2]?.id ?? ''],
    inventory,
  }
  for (const hero of roster) hero.hp = heroStats(state, hero).hp
  return state
}

/** One action's damage on the Knight from this atk: two 70% hits, a 60% hit, a raging 150% hit, or one hit. */
function actionDamage(atk: number, def: number, move: BossMove | null): number {
  const hit = (bp: number) => hitDamage(Math.floor((atk * bp) / 10000), def, NO_VARIANCE_BP)
  if (move === 'strike_twice') return 2 * hit(STRIKE_TWICE_BP)
  if (move === 'hit_all') return hit(HIT_ALL_BP)
  if (move === 'rage') return hit(RAGE_BP)
  return hit(10000)
}

/** How many actions of this enemy the Knight takes and still stands; a zone boss's as its move lands them. */
function hitsSurvived(
  s: GameState,
  hp: number,
  def: number,
  defId: string,
  kind: EnemyKind,
): number {
  const enemy: Enemy = { id: 'probe_enemy', def: defId, kind, hp: 1, maxHp: 1, enraged: false }
  const move = kind === 'zone_boss' ? (content.enemies[defId]?.move ?? null) : null
  return Math.floor((hp - 1) / actionDamage(enemyStats(s, enemy).atk, def, move))
}

/**
 * The Knight hits a healing boss's heals add: through the boss's HP under half, at each of the
 * Knight's hits the boss's chance to heal (its heal weight over all its weights, the party
 * standing) times its heal, summed and over the Knight's hit, rounded. 0 for any other move.
 */
function healKnightHits(s: GameState, bossId: string): number {
  const def = enemyAt(bossId, s.zone)
  const knight = s.roster[0]
  if (def?.move !== 'heal_self' || !knight) return 0
  const max = def.stats.hp
  const boss: Enemy = {
    id: 'probe_boss',
    def: bossId,
    kind: 'zone_boss',
    hp: max,
    maxHp: max,
    enraged: false,
  }
  const fight: GameState = {
    ...s,
    encounter: { enemies: [boss], queue: [], waveSize: 1, spawnedInWave: 1 },
  }
  const knightHit = hitDamage(heroStats(s, knight).atk, def.stats.def, NO_VARIANCE_BP)
  const heal = scaled(Math.floor((def.stats.atk * SELF_HEAL_BP) / 10000))
  let heals = 0
  for (boss.hp = Math.floor((max - 1) / 2); boss.hp > 0; boss.hp -= knightHit) {
    const w = actionWeights(fight, { side: 'enemy', enemy: boss })
    const total = Object.values(w).reduce((n, v) => n + (v ?? 0), 0)
    if (total > 0) heals += (w.heal ?? 0) / total
  }
  return Math.round((heals * heal) / knightHit)
}

/**
 * The reference Knight against every zone of a tier that has a reference row: all twelve in tier
 * 1, the rows' zones past it. Throws for a tier the ladder does not reach.
 */
export function probe(tier: number): Probe {
  if (!Number.isInteger(tier) || tier < 1) throw new Error(`tier ${tier} is not a tier`)
  const first = (tier - 1) * 12 + 1
  if (first > LADDER_END) {
    throw new Error(`tier ${tier} is past the ladder's end: the ladder ends at zone ${LADDER_END}`)
  }
  const zones: ProbeZone[] = []
  for (const row of REFERENCE_PARTY) {
    const at = zoneAt(row.zone)
    if (!at || at.tier !== tier) continue
    const s = referenceParty(row)
    const knight = s.roster[0]
    if (!knight) continue
    const { hp, def } = heroStats(s, knight)
    const wave = at.def.enemies.map((id) => hitsSurvived(s, hp, def, id, 'wave'))
    zones.push({
      ...row,
      base: at.base,
      tier: at.tier,
      knight: { hp, def },
      knightWaveHits: { min: Math.min(...wave), max: Math.max(...wave) },
      bossMove: content.enemies[at.def.boss]?.move ?? null,
      knightBossHits: hitsSurvived(s, hp, def, at.def.boss, 'zone_boss'),
      knightTurnBossHits: hitsSurvived(s, hp, def, at.def.turnBoss, 'turn_boss'),
      healKnightHits: healKnightHits(s, at.def.boss),
    })
  }
  return { tier, band: BAND, zones }
}

/** One line per zone outside the band; empty when every zone is inside it. */
export function outOfBand(p: Probe): string[] {
  const out: string[] = []
  const [waveLo, waveHi] = p.band.wave
  const [bossLo, bossHi] = p.band.boss
  for (const z of p.zones) {
    const why: string[] = []
    const { min, max } = z.knightWaveHits
    if (min < waveLo || max > waveHi)
      why.push(`wave hits ${min} to ${max}, not ${waveLo} to ${waveHi}`)
    if (z.knightBossHits < bossLo || z.knightBossHits > bossHi) {
      why.push(`boss hits ${z.knightBossHits}, not ${bossLo} to ${bossHi}`)
    }
    if (why.length > 0) out.push(`zone ${z.zone}: ${why.join('; ')}`)
  }
  return out
}
