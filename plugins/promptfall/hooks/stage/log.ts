// The combat log the message window types out (grill 1.8, 1.13, 1.16): one line per action, then
// what it caused, in Dragon Quest's words. Lines start no earlier than their action on the stage,
// queue behind each other, and hit lines are dropped only when the queue falls a tick behind.
import type { GameView, Settings } from '../../types'
import type { Effect } from '../vendor/sim.js'
import { tradeName } from '../view'
import { CHAR_FAST_MS, CHAR_MS, LINE_MIN_MS, LOG_KEEP } from '../windows/tuning'
import { groups, type StageTimeline } from './timeline'
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

type Known = { name: string; kind: string }

const length = (text: string) => Array.from(text).length
const typed = (line: LogLine) => line.at + length(line.text) * line.charMs

function list(amounts: readonly number[]): string {
  if (amounts.length <= 1) return String(amounts[0] ?? '')
  return `${amounts.slice(0, -1).join(', ')} and ${amounts.at(-1)}`
}

function itemName(base: string): string {
  return base === 'contract' ? 'Hero contract' : tradeName('item', base)
}

export class MessageLog {
  private lines: LogLine[] = []
  private known = new Map<string, Known>()

  /** Every applied batch, after timeline.onEffects; `starts` is its answer. */
  onEffects(
    effects: readonly Effect[],
    starts: readonly number[],
    view: GameView,
    now: number,
    cadenceMs: number,
    timeline: StageTimeline,
  ): void {
    for (const k of timeline.known()) this.known.set(k.id, { name: k.name, kind: k.kind })
    for (const h of view.heroes) this.known.set(h.id, { name: h.shortName, kind: 'hero' })
    for (const e of view.enemies) this.known.set(e.id, { name: e.name, kind: e.kind })
    const name = (id: string) => this.known.get(id)?.name ?? id
    const live = new Set(view.enemies.map((e) => e.id))

    const all = groups(effects)
    // The group holding each target's last hit: a kill prints after that action.
    const lastHit = new Map<string, number>()
    for (const [i, g] of all.entries())
      for (const e of g.effects) if (e.k === 'hit') lastHit.set(e.target, i)

    for (const [i, g] of all.entries()) {
      const start = starts[i] ?? now
      const out: { text: string; key: boolean; rgb?: number }[] = []
      const hits = g.effects.filter((e): e is Extract<Effect, { k: 'hit' }> => e.k === 'hit')
      if (hits.length >= 2 && hits.every((h) => h.by === hits[0]?.by)) {
        out.push({
          text: `${name(hits[0]?.by ?? '')} hits ${hits.length} foes for ${list(hits.map((h) => h.amount))}.`,
          key: false,
        })
      } else {
        for (const h of hits)
          out.push({ text: `${name(h.by)} hits ${name(h.target)} for ${h.amount}.`, key: false })
      }
      for (const e of g.effects)
        if (e.k === 'heal')
          out.push({ text: `${name(e.by)} heals ${name(e.target)} for ${e.amount}.`, key: false })
      for (const h of hits) {
        const who = this.known.get(h.target)
        if (lastHit.get(h.target) !== i || live.has(h.target) || !who || who.kind === 'hero')
          continue
        if (who.kind === 'world_boss') continue
        if (out.some((l) => l.text === `${who.name} is defeated!`)) continue
        out.push({ text: `${who.name} is defeated!`, key: true })
      }
      for (const e of g.effects) {
        const line = this.consequence(e, view, name)
        if (line) out.push(line)
      }
      for (const l of out) this.schedule(l, start, cadenceMs)
    }
    if (this.lines.length > LOG_KEEP) this.lines = this.lines.slice(-LOG_KEEP)
  }

  private consequence(
    e: Effect,
    view: GameView,
    name: (id: string) => string,
  ): { text: string; key: boolean; rgb?: number } | null {
    switch (e.k) {
      case 'drop':
        return {
          text: `Found a ${itemName(e.item.base)}!`,
          key: true,
          rgb: RARITY_RGB[e.item.rarity],
        }
      case 'drop_vendored':
        return { text: `Found a ${itemName(e.item.base)}, sold for ${e.gold}G.`, key: true }
      case 'level_up':
        return { text: `${name(e.heroId)} reached level ${e.level}!`, key: true }
      case 'hero_fell':
        return { text: `${name(e.heroId)} falls!`, key: true }
      case 'boss_spawned': {
        const boss = view.enemies.find((x) => x.def === e.def)
        return { text: `${boss?.name ?? e.def} appears!`, key: true }
      }
      case 'zone_cleared':
        return { text: `Zone ${e.zone} cleared!`, key: true }
      case 'wipe':
        return { text: `The party retreats to zone ${e.retreatedTo}.`, key: true }
      case 'traded': {
        const t = e.entry
        const what = tradeName(t.kind, t.base)
        if (t.what === 'sold') return { text: `Sold ${what} for ${t.gold}G.`, key: true }
        if (t.what === 'bought') return { text: `Bought ${what} for ${t.gold}G.`, key: true }
        return { text: `${what} came back.`, key: true }
      }
      case 'rewarded': {
        const goods = e.goods
        if (!goods) return { text: `Boss reward: ${e.gold}G.`, key: true }
        const what =
          goods.kind === 'item' ? itemName(goods.item.base) : tradeName('hero', goods.hero.template)
        return { text: `Boss reward: ${what} and ${e.gold}G.`, key: true }
      }
      default:
        return null
    }
  }

  private schedule(
    l: { text: string; key: boolean; rgb?: number },
    start: number,
    cadenceMs: number,
  ): void {
    const prev = this.lines.at(-1)
    const at = prev ? Math.max(start, prev.at + LINE_MIN_MS, typed(prev)) : start
    // Grill 1.13's safety valve: a hit or heal line more than a tick behind its action is dropped.
    if (!l.key && at > start + cadenceMs) return
    const waiting = this.lines.filter((x) => typed(x) > start).length
    this.lines.push({
      text: l.text,
      ...(l.rgb !== undefined ? { rgb: l.rgb } : {}),
      key: l.key,
      at,
      charMs: waiting >= 2 ? CHAR_FAST_MS : CHAR_MS,
    })
  }

  /** Lines shown by `now`, oldest first, each revealed to its typed length. */
  shown(
    now: number,
    motion: Settings['motion'],
  ): { text: string; rgb?: number; revealed: number }[] {
    return this.lines
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

  /** A line is waiting, or still typing. */
  isBusy(now: number, motion: Settings['motion']): boolean {
    return this.lines.some((l) => l.at > now || (motion !== 'still' && typed(l) > now))
  }

  /** Lines starting in (now, now + horizonMs], for SMIL. */
  upcoming(now: number, horizonMs: number): readonly LogLine[] {
    return this.lines.filter((l) => l.at > now && l.at <= now + horizonMs)
  }
}
