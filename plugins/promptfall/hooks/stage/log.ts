// The combat log the message window types out (grill 1.8, 1.13, 1.16): one line per action, then
// what it caused, in Dragon Quest's words. Lines start no earlier than their action on the stage,
// queue behind each other, and hit lines are dropped only when the queue falls a tick behind. A
// drop's line waits for its reveal, and a zone arrival's and a travel's for the backdrop change:
// held aside until its show time, then takes its place in the queue at that time. The log is also
// the holder for held toasts: a toast with a wait is kept here until its show time and handed out
// once, by `release`.
import type { GameView, Settings } from '../../types'
import { heroNameById, type Toast, type ToastWait } from '../toasts'
import type { Effect, Rarity } from '../vendor/sim.js'
import { tradeName } from '../view'
import { CHAR_FAST_MS, CHAR_MS, LINE_MIN_MS, LOG_KEEP } from '../windows/tuning'
import { zoneHead, zonePhrase, zoneWords } from '../zone-words'
import { groups, type StageEffect, type StageTimeline } from './timeline'
import { RARITY_RGB } from './tuning'

export type LogLine = {
  text: string
  /** The rarity colour for drops; the window's text colour otherwise. */
  rgb?: number
  /** Never skipped: everything but hit and heal lines. */
  key: boolean
  /** Wall ms the line starts typing. */
  at: number
  charMs: number
}

type Known = { name: string; kind: string; hp?: number }

type Said = { text: string; key: boolean; rgb?: number }

/** What a held line or toast waits for: a toast's wait, or a travel's backdrop change. */
type Wait = ToastWait | { travel: number }

/**
 * A held line or toast: what it waits for, and `showAt`, the show time the timeline last answered
 * for it. A chest the timeline no longer holds leaves its entry due then.
 */
type Waiting = { wait: Wait; showAt: number }

/** A drop or vendored line waiting for its item's reveal, an arrival's or a travel's for its zone's. */
type Held = Waiting & { line: Said; cadenceMs: number }

/** A toast waiting for its show time, raised when `release` hands it out. */
type HeldToast = Waiting & { toast: Toast }

/** Enemies the log remembers past their view, so a kill can name them; older ones are dropped. */
const KNOWN_KEEP = 200

const length = (text: string) => Array.from(text).length
const typed = (line: LogLine) => line.at + length(line.text) * line.charMs

function list(amounts: readonly number[]): string {
  if (amounts.length <= 1) return String(amounts[0] ?? '')
  return `${amounts.slice(0, -1).join(', ')} and ${amounts.at(-1)}`
}

function itemName(base: string): string {
  return base === 'contract' ? 'Hero contract' : tradeName('item', base)
}

/** "Rare drop", "Epic drop": the rarity leads when it is the news, as in the toast table. */
function dropWord(rarity: Rarity): string {
  if (rarity !== 'rare' && rarity !== 'epic' && rarity !== 'legendary') return 'Drop'
  return `${rarity.charAt(0).toUpperCase()}${rarity.slice(1)} drop`
}

export class MessageLog {
  private lines: LogLine[] = []
  private held: Held[] = []
  private heldToasts: HeldToast[] = []
  private known = new Map<string, Known>()
  /** The stage's timeline, asked for each held entry's show time whenever the log is read. */
  private timeline: StageTimeline | null = null

  /** Every applied batch, after timeline.onEffects; `starts` is its answer. */
  onEffects(
    effects: readonly StageEffect[],
    starts: readonly number[],
    view: GameView,
    now: number,
    cadenceMs: number,
    timeline: StageTimeline,
  ): void {
    this.timeline = timeline
    // Held lines due by now arrived before this batch: each takes its place at its show time.
    const due = this.due(now)
    this.held = this.held.filter((h) => !due.includes(h))
    let from = 0
    for (const h of due) from = this.insert(this.lines, h.line, h.showAt, h.cadenceMs, from) + 1
    // HP as the log last saw it, before this batch's view: a kill is a hit that empties it.
    const hpBefore = new Map([...this.known].map(([id, k]) => [id, k.hp]))
    for (const k of timeline.known())
      this.remember(k.id, { name: k.name, kind: k.kind, hp: this.known.get(k.id)?.hp })
    for (const h of view.heroes) this.remember(h.id, { name: h.shortName, kind: 'hero' })
    for (const e of view.enemies) this.remember(e.id, { name: e.name, kind: e.kind, hp: e.hp })
    // An enemy spawned and killed inside one tick is in no view: it is a Foe.
    const name = (id: string) => this.known.get(id)?.name ?? 'Foe'
    const live = new Set(view.enemies.map((e) => e.id))
    // A wipe or a retreat clears the encounter: enemies leave the view alive, so only an emptied
    // HP is a kill.
    const wiped = effects.some((e) => e.k === 'wipe' || e.k === 'retreat')
    const hpLeft = new Map(hpBefore)

    const all = groups(effects)
    // The group holding each target's last hit: a kill prints after that action.
    const lastHit = new Map<string, number>()
    for (const [i, g] of all.entries())
      for (const e of g.effects) if (e.k === 'hit') lastHit.set(e.target, i)

    for (const [i, g] of all.entries()) {
      const start = starts[i] ?? now
      const out: Said[] = []
      const hits = g.effects.filter((e): e is Extract<Effect, { k: 'hit' }> => e.k === 'hit')
      // A boss's strike twice (#169): its line at the act, then each hit on the one target.
      const twice = g.act?.action === 'attack_twice'
      if (twice && g.act) out.push({ text: `${name(g.act.actor)} strikes twice!`, key: true })
      if (!twice && hits.length >= 2 && hits.every((h) => h.by === hits[0]?.by)) {
        out.push({
          text: `${name(hits[0]?.by ?? '')} hits ${hits.length} foes for ${list(hits.map((h) => h.amount))}.`,
          key: false,
        })
      } else {
        for (const h of hits)
          out.push({ text: `${name(h.by)} hits ${name(h.target)} for ${h.amount}.`, key: false })
      }
      for (const e of g.effects)
        if (e.k === 'heal') {
          // An enemy's heal is a boss healing itself; a hero's names whom it heals.
          const self = e.by === e.target && this.known.get(e.by)?.kind !== 'hero'
          if (self) out.push({ text: `${name(e.by)} heals itself for ${e.amount}.`, key: true })
          else
            out.push({ text: `${name(e.by)} heals ${name(e.target)} for ${e.amount}.`, key: false })
        }
      for (const h of hits) {
        const hp = hpLeft.get(h.target)
        if (hp !== undefined) hpLeft.set(h.target, hp - h.amount)
      }
      for (const h of hits) {
        const who = this.known.get(h.target)
        if (lastHit.get(h.target) !== i || live.has(h.target) || who?.kind === 'hero') continue
        if (who?.kind === 'world_boss') continue
        const hp = hpLeft.get(h.target)
        if (wiped && (hp === undefined || hp > 0)) continue
        const text = `${who?.name ?? 'Foe'} is defeated!`
        if (out.some((l) => l.text === text)) continue
        out.push({ text, key: true })
      }
      for (const e of g.effects) {
        const line = this.consequence(e, view, name)
        if (!line) continue
        // A drop's line waits for its chest's reveal, an arrival's for the backdrop change; one
        // the timeline has no show time for prints with its action.
        const wait = this.waitOf(e)
        const showAt = wait === null ? null : this.showOf(wait)
        if (wait === null || showAt === null) out.push(line)
        else this.held.push({ line, wait, showAt, cadenceMs })
      }
      for (const l of out) this.schedule(this.lines, l, start, cadenceMs)
    }
    if (this.lines.length > LOG_KEEP) this.lines = this.lines.slice(-LOG_KEEP)
  }

  private consequence(e: StageEffect, view: GameView, name: (id: string) => string): Said | null {
    switch (e.k) {
      case 'drop':
        return {
          text: `${dropWord(e.item.rarity)}: ${itemName(e.item.base)}.`,
          key: true,
          rgb: RARITY_RGB[e.item.rarity],
        }
      case 'drop_vendored':
        return {
          text:
            e.cause === 'full'
              ? `Inventory full: ${itemName(e.item.base)} vendored for ${e.gold}G.`
              : `${itemName(e.item.base)} vendored, ${e.gold}G.`,
          key: true,
        }
      case 'level_up':
        // The toast's lookup, so the log and the toast name one hero the same way.
        return {
          text: `${heroNameById(view, e.heroId) ?? 'A hero'} reached level ${e.level}.`,
          key: true,
        }
      case 'hero_fell':
        return { text: `${name(e.heroId)} falls!`, key: true }
      case 'boss_spawned': {
        const boss = view.enemies.find((x) => x.def === e.def)
        return { text: `${boss?.name ?? e.def} appears!`, key: true }
      }
      case 'zone_cleared': {
        if (e.advancedTo <= e.zone) return { text: `${zoneHead(e.zone)} cleared.`, key: true }
        return { text: `The party reached ${zoneWords(e.advancedTo)}.`, key: true }
      }
      case 'wipe':
        return { text: 'The party fell.', key: true }
      case 'retreat':
        return { text: `The party retreats to ${zonePhrase(e.zone)}.`, key: true }
      case 'traveled':
        return { text: `The party travels to ${zoneWords(e.to)}.`, key: true }
      case 'traded': {
        const t = e.entry
        // Grill 1.16's table has the sale only; purchases and returns print nothing.
        return t.what === 'sold'
          ? { text: `${tradeName(t.kind, t.base)} sold for ${t.gold}G.`, key: true }
          : null
      }
      case 'rewarded': {
        // The log does not name the boss: the sim has left boss mode by the time the reward lands.
        const goods = e.goods
        const what = !goods
          ? ''
          : ` and ${goods.kind === 'item' ? itemName(goods.item.base) : tradeName('hero', goods.hero.template)}`
        if (e.source === 'hunt')
          return { text: `Your share of the hunt: ${e.gold}G${what}.`, key: true }
        return { text: `Your share of the boss: ${e.gold}G${what}.`, key: true }
      }
      // The reactive events (spec #131): one line each, never toasted.
      case 'haste':
        return { text: e.on ? 'The party quickens.' : 'The party slows.', key: true }
      case 'enraged':
        return { text: `Claude stumbles. ${name(e.enemyId)} is enraged!`, key: true }
      case 'camp':
        return e.on === false
          ? { text: 'The party breaks camp.', key: true }
          : { text: 'The party makes camp while Claude gathers its thoughts.', key: true }
      // A boss move's line (#169), never toasted.
      case 'raging':
        return { text: `${name(e.enemyId)}'s rage grows!`, key: true }
      case 'guard':
        return { text: e.on ? 'The party stands guard.' : 'The party lowers its guard.', key: true }
      default:
        return null
    }
  }

  /** Queues `l` at the end of `lines`, starting no earlier than `start`. */
  private schedule(lines: LogLine[], l: Said, start: number, cadenceMs: number): void {
    const prev = lines.at(-1)
    const at = prev ? Math.max(start, prev.at + LINE_MIN_MS, typed(prev)) : start
    // Grill 1.13's safety valve: a hit or heal line more than a tick behind its action is dropped.
    if (!l.key && at > start + cadenceMs) return
    const waiting = lines.filter((x) => typed(x) > start).length
    lines.push({
      text: l.text,
      ...(l.rgb !== undefined ? { rgb: l.rgb } : {}),
      key: l.key,
      at,
      charMs: waiting >= 2 ? CHAR_FAST_MS : CHAR_MS,
    })
  }

  /**
   * Queues `l` at `start` among `lines`, no earlier than index `from`: ahead of the first line
   * queued for later, which moves back with every line after it, each by the queue's rule from the
   * time it had. Lines queued by `start` never move. Answers the index `l` took, so held lines due
   * together keep their show order.
   */
  private insert(
    lines: LogLine[],
    l: Said,
    start: number,
    cadenceMs: number,
    from: number,
  ): number {
    const k = lines.findIndex((x, i) => i >= from && x.at > start)
    const tail = k < 0 ? [] : lines.splice(k)
    this.schedule(lines, l, start, cadenceMs)
    const at = lines.length - 1
    for (const x of tail)
      this.schedule(
        lines,
        { text: x.text, key: x.key, ...(x.rgb !== undefined ? { rgb: x.rgb } : {}) },
        x.at,
        cadenceMs,
      )
    return at
  }

  /**
   * What `e`'s line waits for: a drop's item, an advance's zone cleared, a travel's destination;
   * a farming clear none.
   */
  private waitOf(e: StageEffect): Wait | null {
    if (e.k === 'drop' || e.k === 'drop_vendored') return { item: e.item.id }
    if (e.k === 'traveled') return { travel: e.to }
    return e.k === 'zone_cleared' && e.advancedTo > e.zone ? { zone: e.zone } : null
  }

  /** The show time the timeline answers for `wait`; null when it has none. */
  private showOf(wait: Wait): number | null {
    const t = this.timeline
    if (t === null) return null
    if ('travel' in wait) return t.travelShowAt(wait.travel)
    return 'item' in wait ? t.showAt(wait.item) : t.zoneShowAt(wait.zone)
  }

  /**
   * Each entry's show time read afresh. One the timeline no longer answers keeps its last, but
   * never later than `now`: a chest pruned after it played stays due, and one a resync took away
   * (the enemy revived) is due at once rather than at a reveal that will not come.
   */
  private reread(entries: readonly Waiting[], now: number): void {
    for (const h of entries) h.showAt = this.showOf(h.wait) ?? Math.min(h.showAt, now)
  }

  /** Held lines whose show time has passed by `now`, in show order, each read afresh. */
  private due(now: number): Held[] {
    this.reread(this.held, now)
    return this.held.filter((h) => h.showAt <= now).sort((a, b) => a.showAt - b.showAt)
  }

  /**
   * Holds each toast whose wait has a show time after `now`; answers the rest, to be raised now,
   * in their order. A toast with no wait, or one the timeline knows no show time for, is never held.
   */
  hold(toasts: readonly Toast[], timeline: StageTimeline, now: number): Toast[] {
    this.timeline = timeline
    return toasts.filter((toast) => {
      const showAt = toast.wait ? this.showOf(toast.wait) : null
      if (!toast.wait || showAt === null || showAt <= now) return true
      this.heldToasts.push({ toast, wait: toast.wait, showAt })
      return false
    })
  }

  /**
   * The drain: the held toasts whose show time has passed by `now`, in show order, taken out of
   * the holder so each is handed out once. The only call that releases one; the reads only look.
   * An infinite `now` releases everything held.
   */
  release(now: number): Toast[] {
    this.reread(this.heldToasts, now)
    const due = this.heldToasts.filter((h) => h.showAt <= now).sort((a, b) => a.showAt - b.showAt)
    this.heldToasts = this.heldToasts.filter((h) => !due.includes(h))
    return due.map((h) => h.toast)
  }

  /** The earliest show time after `now` a held toast waits for, read afresh; null for none. */
  nextRelease(now: number): number | null {
    this.reread(this.heldToasts, now)
    const next = this.heldToasts.filter((h) => h.showAt > now).map((h) => h.showAt)
    return next.length === 0 ? null : Math.min(...next)
  }

  /**
   * The lines as they stand at `now`: the queued ones, with each held line due by `now` in its
   * place at its show time, as if it had just arrived. Reading never commits a held line, so a
   * read ahead of time (the desktop's SMIL) leaves the next batch its place.
   */
  private linesAt(now: number): LogLine[] {
    const due = this.due(now)
    if (due.length === 0) return this.lines
    const lines = [...this.lines]
    let from = 0
    for (const h of due) from = this.insert(lines, h.line, h.showAt, h.cadenceMs, from) + 1
    return lines
  }

  /** Lines shown by `now`, oldest first, each revealed to its typed length. */
  shown(
    now: number,
    motion: Settings['motion'],
  ): { text: string; rgb?: number; revealed: number }[] {
    return this.linesAt(now)
      .filter((l) => l.at <= now)
      .map((l) => ({
        text: l.text,
        ...(l.rgb !== undefined ? { rgb: l.rgb } : {}),
        revealed:
          motion === 'still'
            ? length(l.text)
            : Math.min(length(l.text), Math.floor((now - l.at) / l.charMs)),
      }))
  }

  private remember(id: string, k: Known): void {
    this.known.delete(id)
    this.known.set(id, k)
    if (this.known.size > KNOWN_KEEP) {
      const oldest = this.known.keys().next().value
      if (oldest !== undefined) this.known.delete(oldest)
    }
  }

  /** The newest line shown by `now` while it is still typing, and how much of it shows. */
  typing(now: number, motion: Settings['motion']): (LogLine & { revealed: number }) | null {
    if (motion === 'still') return null
    const line = this.linesAt(now)
      .filter((l) => l.at <= now)
      .at(-1)
    if (!line || typed(line) <= now) return null
    return { ...line, revealed: Math.floor((now - line.at) / line.charMs) }
  }

  /** A line is waiting, a line or a toast is held for its show time, or a line is still typing. */
  isBusy(now: number, motion: Settings['motion']): boolean {
    const lines = this.linesAt(now)
    if (this.held.some((h) => h.showAt > now)) return true
    this.reread(this.heldToasts, now)
    if (this.heldToasts.some((h) => h.showAt > now)) return true
    return lines.some((l) => l.at > now || (motion !== 'still' && typed(l) > now))
  }

  /** Lines starting in (now, now + horizonMs], for SMIL; a held line at its show time as known now. */
  upcoming(now: number, horizonMs: number): readonly LogLine[] {
    return this.linesAt(now + horizonMs).filter((l) => l.at > now && l.at <= now + horizonMs)
  }
}
