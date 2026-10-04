import type { GameView } from '../../types'
import { spriteFor, worldBossKey } from '../sprites/index'
import type { Effect } from '../vendor/sim.js'
import {
  DISSOLVE_MS,
  DROP_MS,
  FLASH_MS,
  HIT_STAGGER_MS,
  IDLE_FRAME_MS,
  LUNGE_MS,
  NUMBER_MS,
  NUMBER_RGB_ENEMY,
  NUMBER_RGB_HERO,
  SPAWN_MS,
  STAGE_BOSS_ROWS,
  STAGE_REST_ROWS,
  STAGE_TURN_BOSS_ROWS,
} from './tuning'

export type Motion =
  | { kind: 'lunge'; actor: string; from: number; until: number; dir: 1 | -1 }
  | { kind: 'flash'; actor: string; from: number; until: number }
  | { kind: 'number'; actor: string; text: string; rgb: number; from: number; until: number }
  | { kind: 'dissolve'; actor: string; from: number; until: number }
  | { kind: 'spawn'; actor: string; from: number; until: number }
  | { kind: 'drop'; actor: string; item: string; from: number; until: number }

/** An enemy the stage has seen, live or departed, with its stable slot. */
export type Known = { id: string; spriteId: string; kind: string; slot: number; name: string }

const SLOTS = 3

/** The idle bob's phase: floor(now / IDLE_FRAME_MS) % 2. */
export function bobbingAt(now: number): 0 | 1 {
  return Math.floor(now / IDLE_FRAME_MS) % 2 === 0 ? 0 : 1
}

function enemySpriteId(enemy: { def: string; name: string; kind: string }): string {
  return enemy.kind === 'world_boss'
    ? spriteFor('world_boss', worldBossKey(enemy.name)).id
    : spriteFor('enemy', enemy.def).id
}

/**
 * The stage's memory between frames: which enemy holds which slot, and the motions a round's
 * effects and the enemy list's changes start. No clock of its own: every method takes `now`.
 */
export class StageTimeline {
  private entries = new Map<string, Known>()
  private departed = new Set<string>()
  private heroes = new Set<string>()
  private motions: Motion[] = []
  private observed = false

  observe(view: GameView, now: number): void {
    this.motions = this.motions.filter((m) => m.until > now)
    this.heroes = new Set(view.heroes.map((h) => h.id))
    const live = new Set(view.enemies.map((e) => e.id))

    for (const [id, known] of this.entries) {
      if (live.has(id) || this.departed.has(id)) continue
      this.departed.add(id)
      const lastFlash = this.motions
        .filter((m) => m.kind === 'flash' && m.actor === known.id)
        .reduce((end, m) => Math.max(end, m.until), now)
      this.motions.push({
        kind: 'dissolve',
        actor: id,
        from: lastFlash,
        until: lastFlash + DISSOLVE_MS,
      })
    }
    // A departed enemy keeps its entry and slot until its dissolve and any drop end.
    for (const id of this.departed) {
      if (this.holds(id, now)) continue
      this.departed.delete(id)
      this.entries.delete(id)
    }

    for (const enemy of view.enemies) {
      const known = this.entries.get(enemy.id)
      const spriteId = enemySpriteId(enemy)
      if (known && known.spriteId === spriteId && known.kind === enemy.kind) {
        // Back after leaving (a resync can revive an enemy the prediction killed): live again.
        if (this.departed.delete(enemy.id)) {
          this.motions = this.motions.filter(
            (m) => !(m.actor === enemy.id && (m.kind === 'dissolve' || m.kind === 'drop')),
          )
        }
        continue
      }
      if (known) {
        // The id came back as another enemy (a primary's prediction replayed under boss_engaged
        // can hand the boss the id its predicted slime had): a new actor in the same slot.
        this.departed.delete(enemy.id)
        this.motions = this.motions.filter((m) => m.actor !== enemy.id)
        this.entries.set(enemy.id, { ...known, spriteId, kind: enemy.kind, name: enemy.name })
        if (this.observed) {
          this.motions.push({ kind: 'spawn', actor: enemy.id, from: now, until: now + SPAWN_MS })
        }
        continue
      }
      const slot = this.freeSlot()
      this.entries.set(enemy.id, {
        id: enemy.id,
        spriteId,
        kind: enemy.kind,
        slot,
        name: enemy.name,
      })
      if (this.observed) {
        this.motions.push({ kind: 'spawn', actor: enemy.id, from: now, until: now + SPAWN_MS })
      }
    }
    this.observed = true
  }

  /** The lowest slot no entry holds; when all three are held, the slot of the departed entry that ends first. */
  private freeSlot(): number {
    const held = new Set([...this.entries.values()].map((k) => k.slot))
    for (let slot = 0; slot < SLOTS; slot++) if (!held.has(slot)) return slot
    let evict: Known | null = null
    let evictEnd = Number.POSITIVE_INFINITY
    for (const id of this.departed) {
      const end = this.motions
        .filter((m) => m.actor === id && (m.kind === 'dissolve' || m.kind === 'drop'))
        .reduce((e, m) => Math.max(e, m.until), 0)
      const known = this.entries.get(id)
      if (known && end < evictEnd) {
        evict = known
        evictEnd = end
      }
    }
    if (evict === null) return held.size
    this.entries.delete(evict.id)
    this.departed.delete(evict.id)
    this.motions = this.motions.filter((m) => m.actor !== evict.id)
    return evict.slot
  }

  /** A departed enemy is held by its dissolve and any drop, not by a number still rising. */
  private holds(id: string, now: number): boolean {
    return this.motions.some(
      (m) => m.actor === id && m.until > now && (m.kind === 'dissolve' || m.kind === 'drop'),
    )
  }

  private isActor(id: string): boolean {
    return this.heroes.has(id) || this.entries.has(id)
  }

  onEffects(effects: readonly Effect[], now: number): void {
    let hits = 0
    let last: { target: string; flashEnd: number } | null = null
    for (const effect of effects) {
      if (effect.k === 'hit') {
        const start = now + hits * HIT_STAGGER_MS
        hits += 1
        const impact = start + LUNGE_MS / 2
        if (this.isActor(effect.by)) {
          const dir = this.heroes.has(effect.by) ? -1 : 1
          this.motions.push({
            kind: 'lunge',
            actor: effect.by,
            from: start,
            until: start + LUNGE_MS,
            dir,
          })
        }
        if (this.isActor(effect.target)) {
          this.motions.push({
            kind: 'flash',
            actor: effect.target,
            from: impact,
            until: impact + FLASH_MS,
          })
          this.motions.push({
            kind: 'number',
            actor: effect.target,
            text: String(effect.amount),
            rgb: this.heroes.has(effect.target) ? NUMBER_RGB_HERO : NUMBER_RGB_ENEMY,
            from: impact,
            until: impact + NUMBER_MS,
          })
        }
        last = { target: effect.target, flashEnd: impact + FLASH_MS }
      } else if (effect.k === 'drop' || effect.k === 'drop_vendored') {
        const actor = last?.target ?? this.front()
        if (actor === null || !this.entries.has(actor)) continue
        const from = last?.flashEnd ?? now
        this.motions.push({
          kind: 'drop',
          actor,
          item: spriteFor('item', effect.item.base).id,
          from,
          until: from + DROP_MS,
        })
      }
    }
  }

  /** The live enemy in the lowest slot. */
  private front(): string | null {
    let best: Known | null = null
    for (const known of this.entries.values()) {
      if (this.departed.has(known.id)) continue
      if (best === null || known.slot < best.slot) best = known
    }
    return best?.id ?? null
  }

  /** Motions not yet over: under way, or starting later (a staggered hit). */
  active(now: number): readonly Motion[] {
    return this.motions.filter((m) => m.until > now)
  }

  known(): readonly Known[] {
    return [...this.entries.values()].sort((a, b) => a.slot - b.slot)
  }

  isDeparted(id: string): boolean {
    return this.departed.has(id)
  }

  rowsAt(view: GameView, now: number): number {
    const kinds = new Set(view.enemies.map((e) => e.kind))
    for (const id of this.departed) {
      const known = this.entries.get(id)
      if (known && this.holds(id, now)) kinds.add(known.kind)
    }
    if (kinds.has('zone_boss') || kinds.has('world_boss')) return STAGE_BOSS_ROWS
    if (kinds.has('turn_boss')) return STAGE_TURN_BOSS_ROWS
    return STAGE_REST_ROWS
  }

  isBusy(now: number): boolean {
    return this.motions.some((m) => m.until > now)
  }

  bobbing(now: number): 0 | 1 {
    return bobbingAt(now)
  }
}
