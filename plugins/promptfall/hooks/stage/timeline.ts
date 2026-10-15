import type { EnemyView, GameView } from '../../types'
import { spriteFor, worldBossKey } from '../sprites/index'
import {
  ACTION_STEPS,
  type ActionId,
  type Effect,
  type Rarity,
  STEP_MS,
  type Stat,
  TICK_MS,
  zoneAt,
} from '../vendor/sim.js'
import {
  BACKLOG_ROUNDS,
  BOLT_MS,
  BOSS_MIN_ROWS,
  BURST_MS,
  CAMPFIRE_FADE_MS,
  CAMPFIRE_MS,
  CHEST_FALL_MS,
  CHEST_OPEN_MS,
  CHEST_SIT_MS,
  DISSOLVE_MS,
  FLASH_MS,
  FOLLOW_MS,
  HUDDLE_MS,
  IDLE_FRAME_MS,
  LEVEL_NUMBER_MS,
  LEVEL_RGB,
  LEVEL_STAGGER_MS,
  LUNGE_MS,
  NUMBER_MS,
  NUMBER_RGB_ENEMY,
  NUMBER_RGB_HEAL,
  NUMBER_RGB_HERO,
  REVEAL_FADE_MS,
  REVEAL_HOLD_MS,
  REVEAL_RISE_MS,
  SLIDE_MS,
  SPAWN_MS,
  STAGE_MIN_ROWS,
  STAGE_ROWS,
  TRAVEL_OFF_MS,
  TRAVEL_ON_MS,
  TURN_BOSS_MIN_ROWS,
  VICTORY_MS,
  WAVE_GAP_MS,
  WINDUP_HOLD_MS,
  WINDUP_MS,
} from './tuning'

/** How an actor attacks: enemies lunge; heroes by class (grill Q20). */
export type AttackShape = 'lunge' | 'lunge_follow' | 'bolt' | 'burst'
export type EffectId = 'fireball' | 'light_burst' | 'arrow'

export type Motion =
  | { kind: 'step'; actor: string; from: number; until: number; dir: 1 | -1 }
  | { kind: 'lunge'; actor: string; from: number; until: number; dir: 1 | -1 }
  | { kind: 'flash'; actor: string; from: number; until: number }
  /** Enrage's red flash at the mishap: the white flash's mechanism in red. */
  | { kind: 'red_flash'; actor: string; from: number; until: number }
  /** A level-up's gold flash: the white flash's mechanism in gold. */
  | { kind: 'gold_flash'; actor: string; from: number; until: number }
  /**
   * A hero stepping off toward the right and fading, until the backdrop changes; `boss` names the
   * zone boss whose kill the party walks on from, as a travel's step-off names none.
   */
  | { kind: 'travel_off'; actor: string; from: number; until: number; boss?: string }
  /** A hero stepping on from the left, from the backdrop's change. */
  | { kind: 'travel_on'; actor: string; from: number; until: number; boss?: string }
  /** An enemy of the encounter a travel left: it stands until the backdrop changes, then is gone. */
  | { kind: 'leave'; actor: string; from: number; until: number }
  /** A hero's victory pose over the fallen zone boss `boss`, after its dissolve. */
  | { kind: 'victory'; actor: string; boss: string; from: number; until: number }
  /**
   * An enraged enemy's red tint, from the mishap to the show time of its next hit; `until` is
   * infinite while that hit has not come in.
   */
  | { kind: 'enraged'; actor: string; from: number; until: number }
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
  | ({ kind: 'chest'; actor: string } & ChestFields)
  /** A drop with no row to fall from: its chest on the ground of the slot it holds (`slot`). */
  | ({ kind: 'chest'; actor: null; slot: number } & ChestFields)
  /**
   * Camp's campfire, fading over CAMPFIRE_FADE_MS from `fade`: between the lines for CAMPFIRE_MS
   * on a camp with a world boss engaged; at the party while it camps, `fade` and `until` infinite
   * until the camp breaks.
   */
  | {
      kind: 'campfire'
      actor: null
      place: 'between' | 'party'
      from: number
      fade: number
      until: number
    }
  /** An enemy walking off toward its own edge as the party makes camp: the spawn played backward. */
  | { kind: 'camp_leave'; actor: string; from: number; until: number }
  /** A held enemy walking back in as the party breaks camp: the spawn, from its own edge. */
  | { kind: 'camp_return'; actor: string; from: number; until: number }
  /**
   * The party's huddle: `members`, the heroes standing as it began, slide from their slots to
   * their huddle positions (`in`) or back (`out`).
   */
  | HuddleMotion

export type HuddleMotion = {
  kind: 'huddle'
  actor: null
  dir: 'in' | 'out'
  members: readonly string[]
  from: number
  until: number
}

type ChestFields = {
  /** The dropped item's id, its rarity and its sprite's id. */
  itemId: string
  rarity: Rarity
  spriteId: string
  from: number
  until: number
}

export type ChestMotion = Extract<Motion, { kind: 'chest' }>
/** A chest's phases, in order: each a fixed span from its start, the hold's by rarity. */
export type ChestPhase = 'fall' | 'sit' | 'open' | 'rise' | 'hold' | 'fade'

/** Each phase's span in a chest of `rarity`, in order. */
function chestSpans(rarity: Rarity): [ChestPhase, number][] {
  return [
    ['fall', CHEST_FALL_MS],
    ['sit', CHEST_SIT_MS],
    ['open', CHEST_OPEN_MS],
    ['rise', REVEAL_RISE_MS],
    ['hold', REVEAL_HOLD_MS[rarity]],
    ['fade', REVEAL_FADE_MS],
  ]
}

/** A chest's whole span, from the start of its fall to the end of its fade. */
export function chestMs(rarity: Rarity): number {
  return chestSpans(rarity).reduce((total, [, ms]) => total + ms, 0)
}

/** Ms from a chest's start to its reveal's show time: the item fully risen. */
export const CHEST_SHOW_MS = CHEST_FALL_MS + CHEST_SIT_MS + CHEST_OPEN_MS + REVEAL_RISE_MS

/**
 * The chest's phase at `now`, with its start and the progress through it (0 to 1); before the
 * chest starts, its fall at 0; after it ends, its fade at 1.
 */
export function chestPhaseAt(
  m: ChestMotion,
  now: number,
): { phase: ChestPhase; from: number; p: number } {
  let from = m.from
  for (const [phase, ms] of chestSpans(m.rarity)) {
    if (now < from + ms || phase === 'fade') {
      return { phase, from, p: Math.max(0, Math.min(1, (now - from) / ms)) }
    }
    from += ms
  }
  return { phase: 'fade', from, p: 1 }
}

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
  'step',
  'lunge',
  'windup',
  'strike',
  'follow',
  'hit',
  'flash',
  'gold_flash',
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

/** A hero's stat gains over one tick. */
export type Deltas = Partial<Record<Stat, number>>
/**
 * An effect as the engine hands it to the stage: the sim's, a level-up carrying the hero's stat
 * deltas, which the engine computes from the sim's stat function before and after the tick.
 */
export type StageEffect =
  | Exclude<Effect, { k: 'level_up' }>
  | (Extract<Effect, { k: 'level_up' }> & { deltas?: Deltas })

/** The stats a level-up's gold numbers name, in order: HP is the bar's to show. */
const DELTA_STATS: readonly Stat[] = ['atk', 'def', 'spd']

/** "+3 atk  +2 def": each gain the hero made, left out at zero. */
export function deltasText(deltas: Deltas): string {
  return DELTA_STATS.filter((stat) => (deltas[stat] ?? 0) > 0)
    .map((stat) => `+${deltas[stat]} ${stat}`)
    .join('  ')
}

/** Where the stage stands: a zone, its name, a wave. */
export type Scene = { zone: number; zoneName: string; wave: number }

/** A travel on the timeline: where it goes, its show time (the backdrop's change), and its end. */
type Travel = { to: number; show: number; end: number; from: Scene }

type Act = Extract<Effect, { k: 'act' }>
/** One action's effects; `act` null for effects that came before any act (a delivery, a resync). */
export type Group = { act: Act | null; effects: StageEffect[] }

/**
 * An enemy in the line for the staged state: its last view row, the zone and wave it was last
 * seen in, and whether it has left the view.
 */
export type Lined = {
  row: EnemyView
  zone: number
  zoneName: string
  wave: number
  departed: boolean
}

/** A hit's or heal's HP change on `actor`, landing on the stage at `at`. */
export type Landing = { actor: string; delta: number; at: number }

/** An action on the timeline: its actor, when it starts, and when its ▶ goes (`acting`). */
export type Action = { actor: string; start: number; until: number }

export function groups(effects: readonly StageEffect[]): Group[] {
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

/** The idle bob's phase on a clock of `frameMs` frames: floor(now / frameMs) % 2. */
export function bobbingAt(now: number, frameMs: number = IDLE_FRAME_MS): 0 | 1 {
  return Math.floor(now / frameMs) % 2 === 0 ? 0 : 1
}

/**
 * The party stands huddled: while it is guarding or camping. The stage's positions follow it, so
 * a stage first drawn on a huddled party draws it huddled with no motion.
 */
export function huddles(view: GameView): boolean {
  return view.camping || view.heroes.some((h) => h.guarding)
}

/** An enemy's sprite: the world boss's by name, any other by its content id. */
export function enemySpriteId(enemy: { def: string; name: string; kind: string }): string {
  return enemy.kind === 'world_boss'
    ? spriteFor('world_boss', worldBossKey(enemy.name)).id
    : spriteFor('enemy', enemy.def).id
}

/**
 * The stage's memory between frames: which enemy holds which slot, and the motions a round's
 * effects and the enemy list's changes start. No clock of its own: every method takes `now`.
 */
export class StageTimeline {
  /** Every enemy on stage or departing, in arrival order: the line, left to right. */
  private entries = new Map<string, Known>()
  private departed = new Set<string>()
  /** The heroes on the stage, by id, with their class. */
  private heroes = new Map<string, string>()
  private motions: Motion[] = []
  private observed = false
  /** When the last action on the timeline ends: a later one never starts before it. */
  private actionEnd = Number.NEGATIVE_INFINITY
  /**
   * No newcomer steps on stage before any of these: each kill's fade and chest, then a pause; a
   * chest on the empty ground, keyed `ground:<item id>`, its end and then a pause.
   */
  private gaps = new Map<string, number>()
  /** Each enemy's place in the line, left to right in slot order, and the slide that took it there. */
  private places = new Map<string, { from: number; to: number; start: number; until: number }>()
  /** Every action still held, in start order, each kept until 2 × its cadence after its start. */
  private actions_: (Action & { keep: number })[] = []
  /**
   * The HP each actor had at the last observe: the state a burst starts from. After a burst, the
   * HP it leaves once every one of its hits and heals has landed.
   */
  private seenHp = new Map<string, number>()
  /** Each hit's or heal's HP change, kept until it lands on the stage (#20). */
  private landing: Landing[] = []
  /** Each entry's last view row and where it was seen: what its staged row needs once departed. */
  private seen = new Map<string, Omit<Lined, 'departed'>>()
  /** The scene of the last observe: where a travel leaves from. */
  private scene: Scene | null = null
  /** Each travel until its party has stepped on, in start order. */
  private travels: Travel[] = []
  /**
   * The entries a travel left, until an observe sees them gone: a first observe after the step-off
   * has ended still knows them from a kill.
   */
  private leftByTravel = new Set<string>()
  /** The zone bosses whose kill advanced the zone: the party walks on once the hold is over. */
  private walking = new Set<string>()
  /**
   * The heroes standing as the party huddled, held until the huddle breaks: their huddle positions
   * stay fixed, so a hero that falls in it keeps its place and nothing shifts.
   */
  private huddle: readonly string[] | null = null
  /** Why the party huddles, as the last observe or effect left it: a huddle starts and ends with both. */
  private reasons = { guard: false, camp: false }
  /**
   * The enemies off the stage for a camp, from their walk off until their walk back in ends: one
   * that leaves the view meanwhile goes with no dissolve, as it was never on the field.
   */
  private camped = new Set<string>()

  observe(view: GameView, now: number): void {
    this.motions = this.motions.filter((m) => m.until > now)
    this.actions_ = this.actions_.filter((a) => a.keep > now)
    this.travels = this.travels.filter((t) => t.end > now)
    this.scene = { zone: view.zone, zoneName: view.zoneName, wave: view.wave }
    this.heroes = new Map(view.heroes.map((h) => [h.id, h.cls]))
    // A party first seen huddled stands as it is seen.
    if (!huddles(view)) this.huddle = null
    else this.huddle ??= view.heroes.filter((h) => h.alive).map((h) => h.id)
    this.reasons = { guard: view.heroes.some((h) => h.guarding), camp: view.camping }
    // A camp whose break the stage never heard (a resync): its fire goes out as the view stops camping.
    if (!view.camping) {
      this.motions = this.motions.map((m) =>
        m.kind === 'campfire' && !Number.isFinite(m.until)
          ? { ...m, fade: now, until: now + CAMPFIRE_FADE_MS }
          : m,
      )
    }
    // A hero the travel applied with a pending party walks off and on with the rest.
    for (const travel of this.travels) {
      for (const actor of this.heroes.keys()) {
        if (this.motions.some((m) => m.actor === actor && m.kind === 'travel_on')) continue
        const off = travel.show - TRAVEL_OFF_MS
        if (travel.show > now) {
          this.motions.push({ kind: 'travel_off', actor, from: off, until: travel.show })
        }
        this.motions.push({ kind: 'travel_on', actor, from: travel.show, until: travel.end })
      }
    }
    const predicted = this.seenHp
    this.seenHp = new Map([...view.heroes, ...view.enemies].map((a) => [a.id, a.hp]))
    this.landing = this.landing.filter((l) => l.at > now)
    const live = new Set(view.enemies.map((e) => e.id))

    for (const [id, known] of this.entries) {
      if (live.has(id) || this.departed.has(id)) continue
      // Off the stage for the camp, and not listed when it broke: it never walks back in.
      if (this.camped.has(id)) {
        this.forget(id)
        continue
      }
      this.departed.add(id)
      // It leaves with the HP its burst leaves it: 0 for a kill, its last HP when it left alive.
      // The world boss's bar was never its row's.
      const seen = this.seen.get(id)
      const hp = known.kind === 'world_boss' ? 0 : (predicted.get(id) ?? 0)
      if (seen) this.seen.set(id, { ...seen, row: { ...seen.row, hp } })
      // Left by a travel: it stands until the backdrop changes, with no dissolve.
      const leftByTravel = this.leftByTravel.delete(id)
      if (leftByTravel || this.motions.some((m) => m.actor === id && m.kind === 'leave')) {
        this.calm(id, now)
        continue
      }
      // It fades once the last action shown on it is over: its death flash, or its own blow.
      const from = this.lastShownEnd(id, now)
      const faded = from + DISSOLVE_MS
      this.motions.push({ kind: 'dissolve', actor: id, from, until: faded })
      // Gone before its hit: the tint fades with it.
      this.calm(id, from)
      // A zone boss killed: the party holds its victory pose once it has faded.
      if (known.kind === 'zone_boss' && hp <= 0) {
        for (const hero of this.heroes.keys()) {
          this.motions.push({
            kind: 'victory',
            actor: hero,
            boss: id,
            from: faded,
            until: faded + VICTORY_MS,
          })
        }
        if (this.walking.has(id)) this.walk(id)
      }
    }
    // A kill plays out before the next enemy enters: its fade, its chest, then a pause.
    for (const [id, until] of this.gaps) if (until <= now) this.gaps.delete(id)
    for (const id of this.departed) {
      const end = this.heldBy(id).reduce((e, m) => Math.max(e, m.until), Number.NEGATIVE_INFINITY)
      // Once its fade and chest are over and pruned, the pause they set stands.
      if (Number.isFinite(end)) this.gaps.set(id, end + WAVE_GAP_MS)
    }
    // A departed enemy keeps its entry and slot until its dissolve and any chest end.
    for (const id of this.departed) {
      if (this.holds(id, now)) continue
      this.departed.delete(id)
      this.entries.delete(id)
    }
    for (const id of this.walking) if (!this.entries.has(id)) this.walking.delete(id)
    for (const id of this.camped) {
      if (view.camping || this.motions.some((m) => m.actor === id && m.kind === 'camp_return'))
        continue
      this.camped.delete(id)
    }

    for (const enemy of view.enemies) {
      const known = this.entries.get(enemy.id)
      const spriteId = enemySpriteId(enemy)
      if (known && known.spriteId === spriteId && known.kind === enemy.kind) {
        // Back after leaving (a resync can revive an enemy the prediction killed): live again.
        if (this.departed.delete(enemy.id)) {
          this.gaps.delete(enemy.id)
          this.motions = this.motions.filter(
            (m) => !(m.actor === enemy.id && (m.kind === 'dissolve' || m.kind === 'chest')),
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
      this.enter(enemy, now)
    }
    for (const enemy of view.enemies) {
      if (!this.entries.has(enemy.id)) continue
      this.seen.set(enemy.id, {
        row: enemy,
        zone: view.zone,
        zoneName: view.zoneName,
        wave: view.wave,
      })
    }
    for (const id of this.seen.keys()) if (!this.entries.has(id)) this.seen.delete(id)
    // A row no longer enraged whose hit never came in (a resync): its tint ends now.
    for (const enemy of view.enemies) if (!enemy.enraged) this.calm(enemy.id, now)
    this.reconcile(view, now, predicted)
    this.observed = true
    this.settlePlaces(now)
  }

  /**
   * An HP change the stage did not play (a wipe's heal, a wave clear's revive, a rest) is a
   * landing of its own: the view's HP less what the bursts left predicted, landing once the stage
   * has let the tick go. The world boss is left out: its bar is the poll's, not its row's.
   */
  private reconcile(view: GameView, now: number, predicted: Map<string, number>): void {
    let at: number | null = null
    for (const actor of [...view.heroes, ...view.enemies]) {
      if ('kind' in actor && actor.kind === 'world_boss') continue
      const before = predicted.get(actor.id)
      if (before === undefined || before === actor.hp) continue
      at ??= this.settleAt(now)
      this.landing.push({ actor: actor.id, delta: actor.hp - before, at })
    }
  }

  /**
   * When the stage has let the tick go: the action under way over, and every row the tick took
   * off the field faded and its chest played.
   */
  private settleAt(now: number): number {
    let at = Math.max(now, this.actionEnd)
    for (const id of this.departed) for (const m of this.heldBy(id)) at = Math.max(at, m.until)
    return at
  }

  /**
   * When the last action motion shown on this actor ends, its own or one on it, or `now`; a number
   * floats on, and a step back costs no time.
   */
  private lastShownEnd(id: string, now: number): number {
    return this.motions
      .filter(
        (m) =>
          m.actor === id && ACTION_KINDS.has(m.kind) && m.kind !== 'number' && m.kind !== 'step',
      )
      .reduce((end, m) => Math.max(end, m.until), now)
  }

  /**
   * Enters the view's newcomers, with their spawn, and nothing else: no enemy departs and no HP
   * moves, since the view is the tick's end and the kills in its effects have not played. The
   * engine calls it as it hands over a tick's effects, so a monster that entered since the last
   * observe has a place for its first actions before any redraw observes it (the desktop redraws
   * once a round). Before the first observe it does nothing: that observe places the line. Nor
   * while a live entry is missing from the view: that kill's pause is not on the timeline until a
   * redraw departs it, and a newcomer let in now would stand beside a death still to play.
   */
  admit(view: GameView, now: number): void {
    if (!this.observed) return
    const live = new Set(view.enemies.map((e) => e.id))
    for (const id of this.entries.keys()) if (!live.has(id) && !this.departed.has(id)) return
    let entered = false
    for (const enemy of view.enemies) {
      if (this.entries.has(enemy.id) || !this.enter(enemy, now)) continue
      this.seen.set(enemy.id, {
        row: enemy,
        zone: view.zone,
        zoneName: view.zoneName,
        wave: view.wave,
      })
      entered = true
    }
    if (entered) this.settlePlaces(now)
  }

  /**
   * An enemy the timeline does not know steps on at `now` with a spawn, once the last kill's pause
   * is over and a slot is free; true when it did.
   */
  private enter(enemy: EnemyView, now: number): boolean {
    if (this.observed && now < this.enterAfter()) return false
    const slot = this.freeSlot(now)
    if (slot === null) return false
    this.entries.set(enemy.id, {
      id: enemy.id,
      spriteId: enemySpriteId(enemy),
      kind: enemy.kind,
      slot,
      name: enemy.name,
    })
    if (this.observed) {
      this.motions.push({ kind: 'spawn', actor: enemy.id, from: now, until: now + SPAWN_MS })
    }
    return true
  }

  /** When the last kill's pause is over: no newcomer steps on before it. */
  private enterAfter(): number {
    return Math.max(Number.NEGATIVE_INFINITY, ...this.gaps.values())
  }

  /**
   * Drops every queued action (one not started by `now`) and what it would show; the action under
   * way plays out, and the next one may start where the first queued one would have. A departed
   * enemy whose killing blow was dropped fades from its last hit still shown, or now, and its chest
   * lands as that fade ends; the next observe times the pause from there.
   */
  private dropQueued(now: number): void {
    const queued = this.actions_.filter((a) => a.start > now)
    if (queued.length === 0) return
    const cut = Math.min(...queued.map((a) => a.start))
    this.motions = this.motions.filter((m) => m.from < cut || !ACTION_KINDS.has(m.kind))
    this.actions_ = this.actions_.filter((a) => a.start < cut)
    this.actionEnd = Math.min(this.actionEnd, cut)
    // The dropped hits land at once: the bars catch up with the state.
    this.landing = this.landing.filter((l) => l.at < cut)
    for (const id of this.departed) {
      const dissolve = this.motions.find((m) => m.actor === id && m.kind === 'dissolve')
      if (dissolve === undefined) continue
      const from = this.lastShownEnd(id, now)
      if (from >= dissolve.from) continue
      const faded = from + DISSOLVE_MS
      this.motions = this.motions.map((m) => {
        if (m === dissolve) return { ...m, from, until: faded }
        if (m.kind === 'victory' && m.boss === id)
          return { ...m, from: faded, until: faded + VICTORY_MS }
        if (m.actor === id && m.kind === 'chest' && m.from > faded - CHEST_FALL_MS) {
          const from = faded - CHEST_FALL_MS
          return { ...m, from, until: from + chestMs(m.rarity) }
        }
        return m
      })
      if (this.walking.has(id)) this.walk(id)
    }
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

  /** The slots an entry stands in, and those a chest on the empty ground holds until it fades. */
  private heldSlots(now: number): Set<number> {
    const held = new Set([...this.entries.values()].map((k) => k.slot))
    for (const m of this.motions) {
      if (m.kind === 'chest' && m.actor === null && m.until > now) held.add(m.slot)
    }
    return held
  }

  /** Where a chest with no row to fall from lands: the lowest free slot, the front on a full stage. */
  private groundSlot(now: number): number {
    const held = this.heldSlots(now)
    for (let slot = 0; slot < SLOTS; slot++) if (!held.has(slot)) return slot
    return 0
  }

  /**
   * The lowest slot no entry and no chest on the empty ground holds; when all three are held, the slot of the departed entry that
   * ends first among those whose hit has played out (flash, numbers and chest over). Null when every
   * departed holder still has a hit to show: an action can land after the next tick has already
   * brought a newcomer, and evicting would drop that hit, so the newcomer waits a frame or more.
   */
  private freeSlot(now: number): number | null {
    const held = this.heldSlots(now)
    for (let slot = 0; slot < SLOTS; slot++) if (!held.has(slot)) return slot
    let evict: Known | null = null
    let evictEnd = Number.POSITIVE_INFINITY
    for (const id of this.departed) {
      const showing = this.motions.some(
        (m) =>
          m.actor === id &&
          m.until > now &&
          (m.kind === 'flash' || m.kind === 'number' || m.kind === 'chest'),
      )
      if (showing) continue
      const end = this.heldBy(id).reduce((e, m) => Math.max(e, m.until), 0)
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

  /**
   * A departed enemy is held by its dissolve and any chest, by the party's victory pose over it
   * and its step-off when the kill advanced the zone, or until the backdrop changes when a travel
   * left it; not by a number still rising.
   */
  private holds(id: string, now: number): boolean {
    return this.heldBy(id).some((m) => m.until > now)
  }

  /** The motions that hold `id` on the stage once departed. */
  private heldBy(id: string): Motion[] {
    return this.motions.filter((m) =>
      m.kind === 'victory' || m.kind === 'travel_off'
        ? m.boss === id
        : m.actor === id && (m.kind === 'dissolve' || m.kind === 'chest' || m.kind === 'leave'),
    )
  }

  private isActor(id: string): boolean {
    return this.heroes.has(id) || this.entries.has(id)
  }

  /**
   * Enemies lunge, but a boss's heal bursts in place as the white mage's does (#169); heroes by
   * class: the knight follows through, the mages and the archer cast.
   */
  shapeOf(actor: string, action?: ActionId): AttackShape {
    const cls = this.heroes.get(actor)
    if (cls === undefined)
      return action === 'heal' ? (SHAPE_OF_CLASS.white_mage ?? 'burst') : 'lunge'
    return SHAPE_OF_CLASS[cls] ?? 'lunge'
  }

  /**
   * One action at a time: each `act` starts its action at its battle-time offset stretched to the
   * cadence (grill 1.6), never before the previous action is over. The actor winds up and strikes
   * in its shape (the choreography of the frames plan); every hit and heal of the action lands at
   * one impact. Each animation keeps its own speed whatever the cadence. A lone drop's chest falls
   * at `arrivedAt`, the wall time the batch came in, which a delivery's stale `now` is not.
   */
  onEffects(
    effects: readonly StageEffect[],
    now: number,
    cadenceMs: number = TICK_MS,
    arrivedAt: number = now,
  ): number[] {
    // observe prunes too, but nothing observes while the band is hidden or on another tab.
    this.motions = this.motions.filter((m) => m.until > now)
    this.actions_ = this.actions_.filter((a) => a.keep > now)
    this.travels = this.travels.filter((t) => t.end > now)
    const starts: number[] = []
    // The HP each actor holds as the burst plays: what a hit can take, an overkill no more.
    const hp = new Map(this.seenHp)
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
      const shape = act ? this.shapeOf(act.actor, act.action) : 'lunge'
      let shown = false
      const attacker = act && this.isActor(act.actor) ? act.actor : null
      // An attack holds its wind-up in place first; an effect with no attacker lands unheralded.
      const begin = attacker !== null ? start + WINDUP_HOLD_MS : start
      const impact = begin + impactOf(shape)
      // A hero's effect is its class's; an enemy's heal plays the white mage's light burst.
      const effectId =
        attacker === null
          ? undefined
          : EFFECT_OF_CLASS[
              this.heroes.get(attacker) ?? (act?.action === 'heal' ? 'white_mage' : '')
            ]
      if (attacker !== null) {
        const strikeFrom = begin + WINDUP_MS
        // Heroes face the enemies on their left; enemies the party on their right.
        const dir = this.heroes.has(attacker) ? -1 : 1
        // The step: out in the hold, back in the action's tail, so the action is no longer.
        this.motions.push({
          kind: 'step',
          actor: attacker,
          from: start,
          until: start + ACTION_MS,
          dir,
        })
        this.motions.push({ kind: 'windup', actor: attacker, from: start, until: strikeFrom })
        if (shape === 'lunge' || shape === 'lunge_follow') {
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
      // Several level-ups play one after another, in party-slot order.
      const slots = [...this.heroes.keys()]
      const levelling = group.effects
        .flatMap((e) => (e.k === 'level_up' && this.heroes.has(e.heroId) ? [e.heroId] : []))
        .sort((a, b) => slots.indexOf(a) - slots.indexOf(b))
      let last: { target: string; flashEnd: number } | null = null
      // A target's number this action: a second hit on it (a strike twice) adds its own beside it.
      const numbers = new Map<string, Extract<Motion, { kind: 'number' }>>()
      for (const effect of group.effects) {
        if (effect.k === 'hit' || effect.k === 'heal') this.land(effect, impact, hp)
        if (effect.k === 'hit') this.calm(effect.by, impact)
        if (effect.k === 'enraged') {
          this.enrage(effect.enemyId, start)
          continue
        }
        if (effect.k === 'camp') {
          if (effect.on === false) this.breakCamp(start, hp)
          else this.camp(effect.heals, effect.on === true, start, hp)
          continue
        }
        if (effect.k === 'guard') {
          this.huddleFor('guard', effect.on, start, hp)
          continue
        }
        if (effect.k === 'level_up') {
          // With the blow that earned it, or as the tick lands when no action is shown.
          const at = attacker !== null ? impact : start
          this.levelUp(effect, at + levelling.indexOf(effect.heroId) * LEVEL_STAGGER_MS)
          continue
        }
        if (effect.k === 'zone_cleared') {
          // Next zone: after the hold the party walks to the next zone, as a travel does. On a stage
          // never drawn there is no boss row to walk on from.
          const boss = this.zoneBoss(effect.zone)
          if (effect.advancedTo > effect.zone && boss !== undefined) this.walking.add(boss)
          continue
        }
        if (effect.k === 'traveled') {
          this.travel(effect, start)
          continue
        }
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
            const twice = numbers.get(effect.target)
            if (twice) twice.text = `${twice.text} ${effect.amount}`
            else {
              const number: Extract<Motion, { kind: 'number' }> = {
                kind: 'number',
                actor: effect.target,
                text: String(effect.amount),
                rgb: this.heroes.has(effect.target) ? NUMBER_RGB_HERO : NUMBER_RGB_ENEMY,
                from: impact,
                until: impact + NUMBER_MS,
              }
              numbers.set(effect.target, number)
              this.motions.push(number)
            }
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
          const actor = last?.target ?? this.front() ?? this.lastOut()
          const chest = {
            kind: 'chest',
            itemId: effect.item.id,
            rarity: effect.item.rarity,
            spriteId: spriteFor('item', effect.item.base).id,
          } as const
          if (actor === null || !this.entries.has(actor)) {
            // No row to fall from, or its hit's target has left the stage: on a stage the band has
            // drawn, the chest falls when it arrived onto the lowest free slot's ground (the front
            // on an empty stage) and holds the slot, a pause after it, as a kill's does.
            if (!this.observed) continue
            const until = arrivedAt + chestMs(effect.item.rarity)
            const slot = this.groundSlot(arrivedAt)
            this.motions.push({ ...chest, actor: null, slot, from: arrivedAt, until })
            this.gaps.set(`ground:${effect.item.id}`, until + WAVE_GAP_MS)
            continue
          }
          // The chest lands as its target's fade ends; a lone drop's falls when it arrived.
          const from = last ? last.flashEnd + DISSOLVE_MS - CHEST_FALL_MS : arrivedAt
          this.motions.push({ ...chest, actor, from, until: from + chestMs(effect.item.rarity) })
        }
      }
      if (shown) this.actionEnd = start + ACTION_MS
    }
    this.actions_.sort((a, b) => a.start - b.start)
    this.seenHp = hp
    return starts
  }

  /** The hero's gold flash at `at`, and its stat deltas rising as gold numbers. */
  private levelUp(effect: Extract<StageEffect, { k: 'level_up' }>, at: number): void {
    const actor = effect.heroId
    if (!this.heroes.has(actor)) return
    this.motions.push({ kind: 'gold_flash', actor, from: at, until: at + FLASH_MS })
    const text = deltasText(effect.deltas ?? {})
    if (text === '') return
    this.motions.push({
      kind: 'number',
      actor,
      text,
      rgb: LEVEL_RGB,
      from: at,
      until: at + LEVEL_NUMBER_MS,
    })
  }

  /**
   * Places the party's walk after `id`'s kill: the step-off once the victory pose and any chest are
   * over, the backdrop's change as it ends, then the step-on.
   */
  private walk(id: string): void {
    this.motions = this.motions.filter(
      (m) => !((m.kind === 'travel_off' || m.kind === 'travel_on') && m.boss === id),
    )
    const off = this.heldBy(id).reduce((e, m) => Math.max(e, m.until), Number.NEGATIVE_INFINITY)
    if (!Number.isFinite(off)) return
    const show = off + TRAVEL_OFF_MS
    for (const actor of this.heroes.keys()) {
      this.motions.push({ kind: 'travel_off', actor, boss: id, from: off, until: show })
      this.motions.push({
        kind: 'travel_on',
        actor,
        boss: id,
        from: show,
        until: show + TRAVEL_ON_MS,
      })
    }
  }

  /**
   * A travel from `at`: the heroes step off and fade, the backdrop changes (its show time), and
   * they step on. The encounter it ended stands until the backdrop changes, then is gone; no
   * newcomer and no action comes before the party has stepped on. On a stage never drawn it
   * plays nothing and has no show time.
   */
  private travel(effect: Extract<Effect, { k: 'traveled' }>, at: number): void {
    if (!this.observed) return
    const show = at + TRAVEL_OFF_MS
    const end = show + TRAVEL_ON_MS
    for (const actor of this.heroes.keys()) {
      this.motions.push({ kind: 'travel_off', actor, from: at, until: show })
      this.motions.push({ kind: 'travel_on', actor, from: show, until: end })
    }
    for (const id of this.entries.keys()) {
      if (this.departed.has(id)) continue
      // Off the stage for the camp the travel broke: already gone, it never walks back in.
      if (this.camped.has(id)) {
        this.forget(id)
        continue
      }
      this.motions.push({ kind: 'leave', actor: id, from: at, until: show })
      this.leftByTravel.add(id)
    }
    const from =
      this.scene?.zone === effect.from
        ? this.scene
        : {
            zone: effect.from,
            zoneName: zoneAt(effect.from)?.def.name ?? `Zone ${effect.from}`,
            wave: 1,
          }
    this.travels.push({ to: effect.to, show, end, from })
    this.gaps.set(`travel:${show}`, end)
    this.actionEnd = Math.max(this.actionEnd, end)
  }

  /** A red flash on `actor` at `at`, and its tint from then until its next hit lands. */
  private enrage(actor: string, at: number): void {
    if (!this.entries.has(actor) || this.departed.has(actor)) return
    this.motions.push({ kind: 'red_flash', actor, from: at, until: at + FLASH_MS })
    if (this.motions.some((m) => m.kind === 'enraged' && m.actor === actor && m.until > at)) return
    this.motions.push({ kind: 'enraged', actor, from: at, until: Number.POSITIVE_INFINITY })
  }

  /** Ends `actor`'s open tint at `at`: its hit lands, or it leaves. */
  private calm(actor: string, at: number): void {
    this.motions = this.motions.map((m) =>
      m.kind === 'enraged' && m.actor === actor && m.until === Number.POSITIVE_INFINITY
        ? { ...m, until: Math.max(m.from, at) }
        : m,
    )
  }

  /**
   * A camp from `at`: each hero's heal rising green as it lands. Making camp (`pause`), each enemy
   * on the field walks off over the spawn's span, the party huddles and its fire burns until the
   * camp breaks; with a world boss engaged, the fire sits between the lines and fades.
   */
  private camp(
    heals: readonly { heroId: string; amount: number }[],
    pause: boolean,
    at: number,
    hp: Map<string, number>,
  ): void {
    const fade = pause ? Number.POSITIVE_INFINITY : at + CAMPFIRE_MS
    this.motions.push({
      kind: 'campfire',
      actor: null,
      place: pause ? 'party' : 'between',
      from: at,
      fade,
      until: fade + CAMPFIRE_FADE_MS,
    })
    for (const { heroId, amount } of heals) {
      if (amount <= 0 || !this.heroes.has(heroId)) continue
      this.land({ k: 'heal', by: heroId, target: heroId, amount }, at, hp)
      this.motions.push({
        kind: 'number',
        actor: heroId,
        text: String(amount),
        rgb: NUMBER_RGB_HEAL,
        from: at,
        until: at + NUMBER_MS,
      })
    }
    if (!pause) return
    for (const id of this.entries.keys()) {
      if (this.departed.has(id) || this.camped.has(id)) continue
      this.motions.push({ kind: 'camp_leave', actor: id, from: at, until: at + SPAWN_MS })
      this.camped.add(id)
    }
    // After the heal, so a hero it raised huddles with the rest.
    this.huddleFor('camp', true, at, hp)
  }

  /**
   * Breaking camp at `at`: the fire fades, the party steps back, and every enemy still in the line
   * walks back in from its edge. A stage first drawn camping has a fire of the state's to fade.
   */
  private breakCamp(at: number, hp: Map<string, number>): void {
    const wasCamping = this.reasons.camp
    let open = false
    this.motions = this.motions.map((m) => {
      if (m.kind !== 'campfire' || Number.isFinite(m.until)) return m
      open = true
      return { ...m, fade: at, until: at + CAMPFIRE_FADE_MS }
    })
    if (!open && wasCamping && this.observed) {
      this.motions.push({
        kind: 'campfire',
        actor: null,
        place: 'party',
        from: at,
        fade: at,
        until: at + CAMPFIRE_FADE_MS,
      })
    }
    if (wasCamping || this.camped.size > 0) {
      for (const id of this.entries.keys()) {
        if (this.departed.has(id)) continue
        this.motions = this.motions.filter((m) => !(m.actor === id && m.kind === 'camp_leave'))
        this.motions.push({ kind: 'camp_return', actor: id, from: at, until: at + SPAWN_MS })
        this.camped.add(id)
      }
    }
    this.huddleFor('camp', false, at, hp)
  }

  /** The party's huddle turns with its reasons: in as the first comes on, out as the last ends. */
  private huddleFor(
    reason: 'guard' | 'camp',
    on: boolean,
    at: number,
    hp: Map<string, number>,
  ): void {
    const was = this.reasons.guard || this.reasons.camp
    this.reasons[reason] = on
    const is = this.reasons.guard || this.reasons.camp
    if (was !== is) this.huddleStep(is ? 'in' : 'out', at, hp)
    else if (is) this.rejoin(hp)
  }

  /** Drops an entry and everything on the timeline about it, with no motion. */
  private forget(id: string): void {
    this.entries.delete(id)
    this.departed.delete(id)
    this.camped.delete(id)
    this.leftByTravel.delete(id)
    this.walking.delete(id)
    this.gaps.delete(id)
    this.seen.delete(id)
    this.places.delete(id)
    this.motions = this.motions.filter((m) => m.actor !== id)
  }

  /**
   * The party's huddle from `at`: in, the heroes standing as it begins are its members, fixed
   * until it breaks; out, the same members step back. On a stage never drawn it plays nothing: the
   * first observe places the party as the view stands.
   */
  private huddleStep(dir: 'in' | 'out', at: number, hp: Map<string, number>): void {
    if (!this.observed) return
    const standing = [...this.heroes.keys()].filter((id) => (hp.get(id) ?? 0) > 0)
    const members = dir === 'in' ? standing : (this.huddle ?? standing)
    this.huddle = dir === 'in' ? members : null
    // A slide still running at `at` turns back from where it stands: the new one starts as far
    // along as the party is, and the old one goes, so every picture draws one slide.
    const running = this.motions
      .filter((m): m is HuddleMotion => m.kind === 'huddle' && m.from <= at && m.until > at)
      .sort((a, b) => a.from - b.from)
      .at(-1)
    let from = at
    if (running) {
      const p = (at - running.from) / (running.until - running.from)
      const share = running.dir === 'in' ? p : 1 - p
      from = at - (dir === 'in' ? share : 1 - share) * HUDDLE_MS
      this.motions = this.motions.filter((m) => m !== running)
    }
    this.motions.push({
      kind: 'huddle',
      actor: null,
      dir,
      members,
      from,
      until: from + HUDDLE_MS,
    })
  }

  /**
   * Already huddled, a hero the step raised (camp's heal under Guard) joins the huddle at once:
   * the members behind it make room in the same frame.
   */
  private rejoin(hp: Map<string, number>): void {
    const held = this.huddle
    if (held === null) return
    const standing = [...this.heroes.keys()].filter((id) => (hp.get(id) ?? 0) > 0)
    if (standing.every((id) => held.includes(id))) return
    const members = [...this.heroes.keys()].filter(
      (id) => held.includes(id) || standing.includes(id),
    )
    this.huddle = members
    this.motions = this.motions.map((m) =>
      m.kind === 'huddle' && m.dir === 'in' ? { ...m, members } : m,
    )
  }

  /** The members of the huddle the party stands in, fixed as it began; null when none is held. */
  huddled(): readonly string[] | null {
    return this.huddle
  }

  /** Records a hit's or heal's HP change, as far as the actor's HP allows, to land at `at`. */
  private land(
    effect: Extract<Effect, { k: 'hit' } | { k: 'heal' }>,
    at: number,
    hp: Map<string, number>,
  ): void {
    // The world boss never dies in the sim: its row's HP is no cap, and a hit lands whole.
    const before =
      this.entries.get(effect.target)?.kind === 'world_boss' ? undefined : hp.get(effect.target)
    const delta =
      effect.k === 'heal' ? effect.amount : -Math.min(effect.amount, before ?? effect.amount)
    if (before !== undefined) hp.set(effect.target, before + delta)
    this.landing.push({ actor: effect.target, delta, at })
  }

  /**
   * The hits and heals still to land after `now`, in the order they were recorded. The staged
   * state's business (stage/staged.ts): no window reads them.
   */
  pending(now: number): readonly Landing[] {
    return this.landing.filter((l) => l.at > now)
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

  /**
   * The show time of `itemId`'s reveal: the end of its item's rise. Null for an item no chest on
   * the timeline holds.
   */
  showAt(itemId: string): number | null {
    const chest = this.motions.find((m) => m.kind === 'chest' && m.itemId === itemId)
    return chest ? chest.from + CHEST_SHOW_MS : null
  }

  /**
   * The show time of the arrival past `zone`: the moment the row of the zone boss seen in it
   * leaves, as the staged state's zone flips. Departed, that is the end of its dissolve, any chest
   * and the party's victory pose, or of the party's step-off when the kill advanced the zone. Still
   * live (the kill's effects are in and no draw has departed it), it is predicted from the kill:
   * the end of the blow shown on it plus the dissolve and the pose, or its chest's end, whichever
   * is later, plus the step-off when the party walks on. Null with no such row on the timeline.
   */
  zoneShowAt(zone: number): number | null {
    const id = this.zoneBoss(zone)
    if (id === undefined) return null
    const dissolve = this.motions.find((m) => m.actor === id && m.kind === 'dissolve')
    // Predicted, the party's victory pose follows the dissolve.
    let end = dissolve
      ? dissolve.until
      : this.lastShownEnd(id, Number.NEGATIVE_INFINITY) + DISSOLVE_MS + VICTORY_MS
    for (const m of this.heldBy(id)) end = Math.max(end, m.until)
    // Predicted, the step-off follows the pose and the chest.
    const placed = this.motions.some((m) => m.kind === 'travel_off' && m.boss === id)
    if (this.walking.has(id) && !placed) end += TRAVEL_OFF_MS
    return Number.isFinite(end) ? end : null
  }

  /** The zone boss seen in `zone` still on the timeline, if any. */
  private zoneBoss(zone: number): string | undefined {
    return [...this.entries.values()].find(
      (k) => k.kind === 'zone_boss' && this.seen.get(k.id)?.zone === zone,
    )?.id
  }

  /**
   * The show time of the latest travel to `zone` on the timeline: the backdrop's change, as the
   * party has stepped off. Null with no such travel.
   */
  travelShowAt(zone: number): number | null {
    return this.travels.findLast((t) => t.to === zone)?.show ?? null
  }

  /** The show times of the travels on the timeline, in order: when the backdrop changes. */
  travelShows(): readonly number[] {
    return this.travels.map((t) => t.show)
  }

  /** The scene the party is leaving at `now`: the first travel whose backdrop has not changed. */
  travelSceneAt(now: number): Scene | null {
    return this.travels.find((t) => t.show > now)?.from ?? null
  }

  /** How many chests have a show time still to come after `now`. */
  pendingReveals(now: number): number {
    return this.motions.filter((m) => m.kind === 'chest' && m.from + CHEST_SHOW_MS > now).length
  }

  /** Wall-clock starts of this actor's actions still held. */
  actionStarts(actor: string): readonly number[] {
    return this.actions_.filter((a) => a.actor === actor).map((a) => a.start)
  }

  /** Every action still held, in start order. */
  actions(): readonly Action[] {
    return this.actions_.map(({ actor, start, until }) => ({ actor, start, until }))
  }

  /**
   * The departed enemy in the lowest slot, still on the stage for its fade or its chest: where a
   * lone drop falls between a kill and the next enemy's walk-on.
   */
  private lastOut(): string | null {
    let best: Known | null = null
    for (const id of this.departed) {
      const known = this.entries.get(id)
      if (known && (best === null || known.slot < best.slot)) best = known
    }
    return best?.id ?? null
  }

  /** The live enemy in the lowest slot, off the stage for no camp. */
  private front(): string | null {
    let best: Known | null = null
    for (const known of this.entries.values()) {
      if (this.departed.has(known.id) || this.camped.has(known.id)) continue
      if (best === null || known.slot < best.slot) best = known
    }
    return best?.id ?? null
  }

  /** Motions not yet over: under way, or starting later (a later action of the tick). */
  active(now: number): readonly Motion[] {
    return this.motions.filter((m) => m.until > now)
  }

  /** The enemies in line order: by arrival, so a newcomer joins the end and never shoves. */
  known(): readonly Known[] {
    return [...this.entries.values()]
  }

  /**
   * The line in arrival order, departed enemies included while it holds them. The staged
   * state's business (stage/staged.ts): no window reads it.
   */
  lineup(): readonly Lined[] {
    const out: Lined[] = []
    for (const id of this.entries.keys()) {
      const seen = this.seen.get(id)
      if (seen) out.push({ ...seen, departed: this.departed.has(id) })
    }
    return out
  }

  isDeparted(id: string): boolean {
    return this.departed.has(id)
  }

  /** The stage's rows for what is on it: the boss height, every time (ADR 0010). */
  rowsAt(_view: GameView, _now: number): number {
    return STAGE_ROWS
  }

  /**
   * The rows the stage keeps whole when the band is short: the tallest actor on it, a departed
   * one included while its motions hold. Under this the Image zooms out and the Raster goes
   * compact, so no actor is ever cut (ADR 0010).
   */
  minRowsAt(view: GameView, now: number): number {
    const kinds = new Set(view.enemies.map((e) => e.kind))
    for (const id of this.departed) {
      const known = this.entries.get(id)
      if (known && this.holds(id, now)) kinds.add(known.kind)
    }
    if (kinds.has('zone_boss') || kinds.has('world_boss')) return BOSS_MIN_ROWS
    if (kinds.has('turn_boss')) return TURN_BOSS_MIN_ROWS
    return STAGE_MIN_ROWS
  }

  isBusy(now: number): boolean {
    // Through the pause after a kill too, so the next enemy steps on at its time.
    if (now < this.enterAfter()) return true
    if ([...this.places.values()].some((p) => p.until > now)) return true
    // A tint holds still until its hit, whose own motions keep the stage busy; a camp's fire burns
    // with nothing to play until the camp breaks.
    return this.motions.some(
      (m) => m.until > now && m.kind !== 'enraged' && Number.isFinite(m.until),
    )
  }
}
