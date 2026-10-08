import type { GameView } from '../../types'
import { spriteFor, worldBossKey } from '../sprites/index'
import { ACTION_STEPS, type Effect, STEP_MS, TICK_MS } from '../vendor/sim.js'
import {
  BACKLOG_ROUNDS,
  BOLT_MS,
  BURST_MS,
  DISSOLVE_MS,
  DROP_MS,
  FLASH_MS,
  FOLLOW_MS,
  IDLE_FRAME_MS,
  LUNGE_MS,
  NUMBER_MS,
  NUMBER_RGB_ENEMY,
  NUMBER_RGB_HEAL,
  NUMBER_RGB_HERO,
  SLIDE_MS,
  SPAWN_MS,
  STAGE_BOSS_ROWS,
  STAGE_REST_ROWS,
  STAGE_TURN_BOSS_ROWS,
  WAVE_GAP_MS,
  WINDUP_HOLD_MS,
  WINDUP_MS,
} from './tuning'

/** How an actor attacks: enemies lunge; heroes by class (grill Q20). */
export type AttackShape = 'lunge' | 'lunge_follow' | 'bolt' | 'burst'
export type EffectId = 'fireball' | 'light_burst' | 'arrow'

export type Motion =
  | { kind: 'lunge'; actor: string; from: number; until: number; dir: 1 | -1 }
  | { kind: 'flash'; actor: string; from: number; until: number }
  | { kind: 'windup'; actor: string; from: number; until: number }
  | { kind: 'strike'; actor: string; from: number; until: number; shape: AttackShape }
  | { kind: 'follow'; actor: string; from: number; until: number }
  | { kind: 'hit'; actor: string; from: number; until: number }
  | {
      kind: 'effect'
      actor: string
      target: string
      effect: EffectId
      from: number
      until: number
      shape: 'bolt' | 'burst'
    }
  | { kind: 'number'; actor: string; text: string; rgb: number; from: number; until: number }
  | { kind: 'dissolve'; actor: string; from: number; until: number }
  | { kind: 'spawn'; actor: string; from: number; until: number }
  | { kind: 'drop'; actor: string; item: string; from: number; until: number }

/** An enemy the stage has seen, live or departed, with its stable slot. */
export type Known = { id: string; spriteId: string; kind: string; slot: number; name: string }

const SLOTS = 3

/**
 * The attacker's longest busy span after its held wind-up: the knight's lunge and follow-through,
 * a bolt's wind-up and flight, or a lunge's impact flash. The next action starts once it is over.
 */
export const ACTION_MS =
  WINDUP_HOLD_MS + Math.max(LUNGE_MS + FOLLOW_MS, WINDUP_MS + BOLT_MS, LUNGE_MS / 2 + FLASH_MS)

/** The motions an action starts; dropping a queued action drops these and nothing else. */
const ACTION_KINDS: ReadonlySet<Motion['kind']> = new Set([
  'lunge',
  'windup',
  'strike',
  'follow',
  'hit',
  'flash',
  'effect',
  'number',
])

const SHAPE_OF_CLASS: Readonly<Record<string, AttackShape>> = {
  knight: 'lunge_follow',
  black_mage: 'bolt',
  archer: 'bolt',
  white_mage: 'burst',
}
const EFFECT_OF_CLASS: Readonly<Record<string, EffectId>> = {
  black_mage: 'fireball',
  archer: 'arrow',
  white_mage: 'light_burst',
}

/** Ms from an action's start to its impact, per shape. */
export function impactOf(shape: AttackShape): number {
  if (shape === 'bolt') return WINDUP_MS + BOLT_MS
  if (shape === 'burst') return WINDUP_MS + BURST_MS / 2
  return LUNGE_MS / 2
}

type Act = Extract<Effect, { k: 'act' }>
/** One action's effects; `act` null for effects that came before any act (a delivery, a resync). */
export type Group = { act: Act | null; effects: Effect[] }

/** An action on the timeline: its actor, when it starts, and when its ▶ goes (`acting`). */
export type Action = { actor: string; start: number; until: number }

export function groups(effects: readonly Effect[]): Group[] {
  const out: Group[] = []
  let current: Group = { act: null, effects: [] }
  for (const effect of effects) {
    if (effect.k === 'act') {
      if (current.act || current.effects.length > 0) out.push(current)
      current = { act: effect, effects: [] }
    } else current.effects.push(effect)
  }
  if (current.act || current.effects.length > 0) out.push(current)
  return out
}

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
  /** The heroes on the stage, by id, with their class. */
  private heroes = new Map<string, string>()
  private motions: Motion[] = []
  private observed = false
  /** When the last action on the timeline ends: a later one never starts before it. */
  private actionEnd = Number.NEGATIVE_INFINITY
  /** No newcomer steps on stage before this: a departed enemy's fade and drop, then a pause. */
  private enterAfter = Number.NEGATIVE_INFINITY
  /** Each enemy's place in the line, left to right in slot order, and the slide that took it there. */
  private places = new Map<string, { from: number; to: number; start: number; until: number }>()
  /** Every action still held, in start order, each kept until 2 × its cadence after its start. */
  private actions_: (Action & { keep: number })[] = []

  observe(view: GameView, now: number): void {
    this.motions = this.motions.filter((m) => m.until > now)
    this.actions_ = this.actions_.filter((a) => a.keep > now)
    this.heroes = new Map(view.heroes.map((h) => [h.id, h.cls]))
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
    // A kill plays out before the next enemy enters: its fade, its drop, then a pause.
    for (const id of this.departed) {
      const end = this.motions
        .filter((m) => m.actor === id && (m.kind === 'dissolve' || m.kind === 'drop'))
        .reduce((e, m) => Math.max(e, m.until), Number.NEGATIVE_INFINITY)
      this.enterAfter = Math.max(this.enterAfter, end + WAVE_GAP_MS)
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
      if (this.observed && now < this.enterAfter) continue
      const slot = this.freeSlot(now)
      if (slot === null) continue
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
    this.settlePlaces(now)
  }

  /**
   * Drops every queued action (one not started by `now`) and what it would show; the action under
   * way plays out, and the next one may start where the first queued one would have.
   */
  private dropQueued(now: number): void {
    const queued = this.actions_.filter((a) => a.start > now)
    if (queued.length === 0) return
    const cut = Math.min(...queued.map((a) => a.start))
    this.motions = this.motions.filter((m) => m.from < cut || !ACTION_KINDS.has(m.kind))
    this.actions_ = this.actions_.filter((a) => a.start < cut)
    this.actionEnd = Math.min(this.actionEnd, cut)
  }

  /** Enemies stand side by side: a gap closes with a slide, a newcomer starts in its place. */
  private settlePlaces(now: number): void {
    const order = this.known()
    const ids = new Set(order.map((k) => k.id))
    for (const id of this.places.keys()) if (!ids.has(id)) this.places.delete(id)
    order.forEach((known, place) => {
      const current = this.places.get(known.id)
      if (current === undefined) {
        this.places.set(known.id, { from: place, to: place, start: now, until: now })
      } else if (current.to !== place) {
        const from = this.placeAt(known.id, now)
        this.places.set(known.id, { from, to: place, start: now, until: now + SLIDE_MS })
      }
    })
  }

  /** An enemy's place in the line, fractional while it slides (eased out); its slot if unknown. */
  placeAt(id: string, now: number): number {
    const p = this.places.get(id)
    if (p === undefined) return this.entries.get(id)?.slot ?? 0
    if (now >= p.until) return p.to
    const t = (now - p.start) / (p.until - p.start)
    return p.from + (p.to - p.from) * (1 - (1 - t) * (1 - t))
  }

  /**
   * The lowest slot no entry holds; when all three are held, the slot of the departed entry that
   * ends first among those whose hit has played out (flash, numbers and drop over). Null when every
   * departed holder still has a hit to show: an action can land after the next tick has already
   * brought a newcomer, and evicting would drop that hit, so the newcomer waits a frame or more.
   */
  private freeSlot(now: number): number | null {
    const held = new Set([...this.entries.values()].map((k) => k.slot))
    for (let slot = 0; slot < SLOTS; slot++) if (!held.has(slot)) return slot
    let evict: Known | null = null
    let evictEnd = Number.POSITIVE_INFINITY
    for (const id of this.departed) {
      const showing = this.motions.some(
        (m) =>
          m.actor === id &&
          m.until > now &&
          (m.kind === 'flash' || m.kind === 'number' || m.kind === 'drop'),
      )
      if (showing) continue
      const end = this.motions
        .filter((m) => m.actor === id && (m.kind === 'dissolve' || m.kind === 'drop'))
        .reduce((e, m) => Math.max(e, m.until), 0)
      const known = this.entries.get(id)
      if (known && end < evictEnd) {
        evict = known
        evictEnd = end
      }
    }
    if (evict === null) return this.departed.size > 0 ? null : held.size
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

  /** Enemies lunge; heroes by class: the knight follows through, the mages and the archer cast. */
  shapeOf(actor: string): AttackShape {
    const cls = this.heroes.get(actor)
    return (cls !== undefined ? SHAPE_OF_CLASS[cls] : undefined) ?? 'lunge'
  }

  /**
   * One action at a time: each `act` starts its action at its battle-time offset stretched to the
   * cadence (grill 1.6), never before the previous action is over. The actor winds up and strikes
   * in its shape (the choreography of the frames plan); every hit and heal of the action lands at
   * one impact. Each animation keeps its own speed whatever the cadence.
   */
  onEffects(effects: readonly Effect[], now: number, cadenceMs: number = TICK_MS): number[] {
    // observe prunes too, but nothing observes while the band is hidden or on another tab.
    this.motions = this.motions.filter((m) => m.until > now)
    this.actions_ = this.actions_.filter((a) => a.keep > now)
    const starts: number[] = []
    for (const group of groups(effects)) {
      const offset = group.act ? Math.floor((group.act.at * cadenceMs) / TICK_MS) : 0
      if (this.actionEnd - (now + offset) > BACKLOG_ROUNDS * cadenceMs) this.dropQueued(now)
      const start = Math.max(now + offset, this.actionEnd)
      starts.push(start)
      if (group.act) {
        // The ▶ holds for the action's battle time stretched to the cadence, at least its lunge.
        const span = Math.max(ACTION_MS, Math.floor((ACTION_STEPS * STEP_MS * cadenceMs) / TICK_MS))
        this.actions_.push({
          actor: group.act.actor,
          start,
          until: start + span,
          keep: start + 2 * cadenceMs,
        })
      }
      const act = group.act
      const shape = act ? this.shapeOf(act.actor) : 'lunge'
      let shown = false
      const attacker = act && this.isActor(act.actor) ? act.actor : null
      // An attack holds its wind-up in place first; an effect with no attacker lands unheralded.
      const begin = attacker !== null ? start + WINDUP_HOLD_MS : start
      const impact = begin + impactOf(shape)
      const effectId =
        attacker !== null ? EFFECT_OF_CLASS[this.heroes.get(attacker) ?? ''] : undefined
      if (attacker !== null) {
        const strikeFrom = begin + WINDUP_MS
        this.motions.push({ kind: 'windup', actor: attacker, from: start, until: strikeFrom })
        if (shape === 'lunge' || shape === 'lunge_follow') {
          const dir = this.heroes.has(attacker) ? -1 : 1
          this.motions.push({
            kind: 'lunge',
            actor: attacker,
            from: begin,
            until: begin + LUNGE_MS,
            dir,
          })
          this.motions.push({
            kind: 'strike',
            actor: attacker,
            from: strikeFrom,
            until: begin + LUNGE_MS,
            shape,
          })
          if (shape === 'lunge_follow') {
            this.motions.push({
              kind: 'follow',
              actor: attacker,
              from: begin + LUNGE_MS,
              until: begin + LUNGE_MS + FOLLOW_MS,
            })
          }
        } else {
          const span = shape === 'bolt' ? BOLT_MS : BURST_MS
          this.motions.push({
            kind: 'strike',
            actor: attacker,
            from: strikeFrom,
            until: strikeFrom + span,
            shape,
          })
        }
        shown = true
      }
      /** The bolt or burst of an in-place shape, one per hit or healed target. */
      const effectOn = (target: string): void => {
        if (attacker === null || effectId === undefined) return
        if (shape !== 'bolt' && shape !== 'burst') return
        const from = begin + WINDUP_MS
        this.motions.push({
          kind: 'effect',
          actor: attacker,
          target,
          effect: effectId,
          from,
          until: from + (shape === 'bolt' ? BOLT_MS : BURST_MS),
          shape,
        })
      }
      let last: { target: string; flashEnd: number } | null = null
      for (const effect of group.effects) {
        if (effect.k === 'hit') {
          if (this.isActor(effect.target)) {
            effectOn(effect.target)
            this.motions.push({
              kind: 'hit',
              actor: effect.target,
              from: impact,
              until: impact + FLASH_MS,
            })
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
            shown = true
          }
          last = { target: effect.target, flashEnd: impact + FLASH_MS }
        } else if (effect.k === 'heal') {
          if (!this.isActor(effect.target)) continue
          effectOn(effect.target)
          this.motions.push({
            kind: 'number',
            actor: effect.target,
            text: String(effect.amount),
            rgb: NUMBER_RGB_HEAL,
            from: impact,
            until: impact + NUMBER_MS,
          })
          shown = true
        } else if (effect.k === 'drop' || effect.k === 'drop_vendored') {
          const actor = last?.target ?? this.front()
          if (actor === null || !this.entries.has(actor)) continue
          // The drop pops once its target's fade is over.
          const from = last ? last.flashEnd + DISSOLVE_MS : now
          this.motions.push({
            kind: 'drop',
            actor,
            item: spriteFor('item', effect.item.base).id,
            from,
            until: from + DROP_MS,
          })
        }
      }
      if (shown) this.actionEnd = start + ACTION_MS
    }
    this.actions_.sort((a, b) => a.start - b.start)
    return starts
  }

  /**
   * The hero or enemy whose action is playing: from its start until the next action starts or its
   * `until`, whichever is first.
   */
  acting(now: number): string | null {
    let current: Action | null = null
    for (const a of this.actions_) {
      if (a.start > now) break
      current = a
    }
    return current && now < current.until ? current.actor : null
  }

  /** Wall-clock starts of this actor's actions still held. */
  actionStarts(actor: string): readonly number[] {
    return this.actions_.filter((a) => a.actor === actor).map((a) => a.start)
  }

  /** Every action still held, in start order. */
  actions(): readonly Action[] {
    return this.actions_.map(({ actor, start, until }) => ({ actor, start, until }))
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

  /** Motions not yet over: under way, or starting later (a later action of the tick). */
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
    // Through the pause after a kill too, so the next enemy steps on at its time.
    if (now < this.enterAfter) return true
    if ([...this.places.values()].some((p) => p.until > now)) return true
    return this.motions.some((m) => m.until > now)
  }

  bobbing(now: number): 0 | 1 {
    return bobbingAt(now)
  }
}
