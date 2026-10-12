import { enemyStats, hitDamage, NO_VARIANCE_BP } from '../combat'
import { content, LADDER_END, zoneAt } from '../content'
import { baseTier } from '../loot'
import { heroStats } from '../progression'
import { compareCodeUnits } from '../rng'
import { createInitialState } from '../state'
import type { Enemy, EnemyKind, GameState, Hero, Item, Slot } from '../types'
import { type ReferenceRow, referenceRow } from './reference'

/** The feel target: hits the reference Knight survives from one wave enemy, and from the zone boss. */
export const BAND = { wave: [6, 10], boss: [3, 4] } as const

export type ProbeZone = ReferenceRow & {
  /** The running zone number probed; `zone` of the row is its base zone. */
  base: number
  tier: number
  knight: { hp: number; def: number }
  /** Hits survived, from the hardest-hitting wave enemy (min) to the softest (max). */
  knightWaveHits: { min: number; max: number }
  knightBossHits: number
  /** Reported, not asserted. */
  knightTurnBossHits: number
}

export type Probe = { tier: number; band: typeof BAND; zones: ProbeZone[] }

const SLOTS: Slot[] = ['weapon', 'armour', 'accessory']

/** The Knight's base for a slot in a gear tier: the highest stat total, ties to the lower id. */
function gearBase(slot: Slot, gearTier: number): string | null {
  const ids = Object.keys(content.itemBases)
    .sort(compareCodeUnits)
    .filter((id) => {
      const b = content.itemBases[id]
      return (
        b !== undefined &&
        b.slot === slot &&
        b.classes.includes('knight') &&
        Math.ceil(b.minZone / 3) === gearTier
      )
    })
  const total = (id: string) =>
    Object.values(content.itemBases[id]?.stats ?? {}).reduce((n, v) => n + (v ?? 0), 0)
  let best: string | null = null
  for (const id of ids) if (best === null || total(id) > total(best)) best = id
  return best
}

/** A scratch state at the zone holding only the reference Knight, in its reference gear, no affixes. */
function referenceKnight(zone: number, row: ReferenceRow): { s: GameState; knight: Hero } {
  const s = createInitialState(0)
  const knight: Hero = {
    id: 'probe_knight',
    template: 'knight_1',
    cls: 'knight',
    epithet: '',
    rarity: row.knightRarity,
    traits: [],
    level: row.level,
    xp: 0,
    hp: 1,
    equipment: { weapon: null, armour: null, accessory: null },
    tradeableAt: null,
  }
  const inventory: Item[] = []
  for (const slot of SLOTS) {
    const base = gearBase(slot, row.gearTier)
    if (!base) continue
    const item: Item = {
      id: `probe_${slot}`,
      base,
      rarity: row.gearRarity,
      tier: baseTier(base),
      affixes: [],
      equippedBy: knight.id,
      tradeableAt: null,
    }
    inventory.push(item)
    knight.equipment[slot] = item.id
  }
  s.zone = zone
  s.roster = [knight]
  s.inventory = inventory
  return { s, knight }
}

/** How many hits of this enemy the Knight takes and still stands. */
function hitsSurvived(
  s: GameState,
  hp: number,
  def: number,
  defId: string,
  kind: EnemyKind,
): number {
  const enemy: Enemy = { id: 'probe_enemy', def: defId, kind, hp: 1, maxHp: 1 }
  const hit = hitDamage(enemyStats(s, enemy).atk, def, NO_VARIANCE_BP)
  return Math.floor((hp - 1) / hit)
}

/** The reference Knight against every zone of a tier. Throws for a tier the ladder does not reach. */
export function probe(tier: number): Probe {
  if (!Number.isInteger(tier) || tier < 1) throw new Error(`tier ${tier} is not a tier`)
  const first = (tier - 1) * 12 + 1
  if (first > LADDER_END) {
    throw new Error(`tier ${tier} is past the ladder's end: the ladder ends at zone ${LADDER_END}`)
  }
  const zones: ProbeZone[] = []
  for (let zone = first; zone < first + 12; zone++) {
    const at = zoneAt(zone)
    if (!at) continue
    const row = referenceRow(at.base)
    const { s, knight } = referenceKnight(zone, row)
    const { hp, def } = heroStats(s, knight)
    const wave = at.def.enemies.map((id) => hitsSurvived(s, hp, def, id, 'wave'))
    zones.push({
      ...row,
      zone,
      base: at.base,
      tier: at.tier,
      knight: { hp, def },
      knightWaveHits: { min: Math.min(...wave), max: Math.max(...wave) },
      knightBossHits: hitsSurvived(s, hp, def, at.def.boss, 'zone_boss'),
      knightTurnBossHits: hitsSurvived(s, hp, def, at.def.turnBoss, 'turn_boss'),
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
