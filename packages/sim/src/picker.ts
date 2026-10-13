import { content } from './content'
import type { Tactic, TargetRule, WeightRule } from './content/types'
import { drawWeighted, heroStats, livingParty } from './progression'
import type { ActionId, Enemy, GameState, Hero, HeroClass } from './types'

export type Unit = { side: 'hero'; hero: Hero } | { side: 'enemy'; enemy: Enemy }
/** targetId null: no target to choose (attack_all). */
export type Choice = { action: ActionId; targetId: string | null }

/** A unit as the rules see it: living, with its HP out of its max. */
type Body = { id: string; hp: number; max: number; cls: HeroClass | null }

function heroBodies(s: GameState): Body[] {
  return livingParty(s).map((h) => ({ id: h.id, hp: h.hp, max: heroStats(s, h).hp, cls: h.cls }))
}

function enemyBodies(s: GameState): Body[] {
  const out: Body[] = []
  for (const e of s.encounter?.enemies ?? [])
    if (e.hp > 0) out.push({ id: e.id, hp: e.hp, max: Math.max(1, e.maxHp), cls: null })
  return out
}

function tacticsOf(unit: Unit): Tactic[] {
  if (unit.side === 'hero') return content.tactics.heroes[unit.hero.cls] ?? []
  if (unit.enemy.kind === 'world_boss') return content.tactics.enemies.world_boss
  const own = content.tactics.byEnemy[unit.enemy.def]
  if (own) return own
  const archetype = content.enemies[unit.enemy.def]?.archetype
  return archetype ? content.tactics.enemies[archetype] : []
}

/** The body with the lowest HP %, first on a tie. Integer cross-multiplication. */
function lowestShare(bodies: Body[]): Body | undefined {
  let best: Body | undefined
  for (const b of bodies) if (!best || b.hp * best.max < best.hp * b.max) best = b
  return best
}

function tacticWeight(rule: WeightRule, allies: Body[], self: Body | undefined): number {
  if (rule.kind === 'fixed') return rule.weight
  const lowest = rule.kind === 'self_need' ? self : lowestShare(allies)
  if (!lowest) return 0
  const d = rule.belowBp - Math.floor((lowest.hp * 10000) / lowest.max)
  if (d <= 0) return 0
  // scale × d² / (belowBp / 2)², kept integer.
  return Math.floor((rule.scale * d * d * 4) / (rule.belowBp * rule.belowBp))
}

function targets(
  rule: TargetRule,
  allies: Body[],
  foes: Body[],
  self: Body | undefined,
): [string | null, number][] {
  switch (rule.kind) {
    case 'none':
      return foes.length > 0 ? [[null, 1]] : []
    case 'front':
      return foes.map((f, i) => [f.id, i === 0 ? rule.front : rule.other])
    case 'weakest': {
      let weakest: Body | undefined
      for (const f of foes) if (!weakest || f.hp < weakest.hp) weakest = f
      return foes.map((f) => [f.id, f === weakest ? rule.weakest : rule.other])
    }
    case 'class':
      return foes.map((f) => [f.id, f.cls === rule.cls ? rule.match : rule.other])
    case 'ally_lowest': {
      const lowest = lowestShare(allies)
      return lowest ? [[lowest.id, 1]] : []
    }
    case 'self':
      return self ? [[self.id, 1]] : []
  }
}

/** Every (action, target) pair the unit's tactics allow, keyed `action:target`, with its weight. */
function pairs(
  s: GameState,
  unit: Unit,
): { weights: Record<string, number>; byKey: Map<string, Choice> } {
  const heroes = heroBodies(s)
  const enemies = enemyBodies(s)
  const allies = unit.side === 'hero' ? heroes : enemies
  const foes = unit.side === 'hero' ? enemies : heroes
  const selfId = unit.side === 'hero' ? unit.hero.id : unit.enemy.id
  const self = allies.find((b) => b.id === selfId)
  const weights: Record<string, number> = {}
  const byKey = new Map<string, Choice>()
  for (const tactic of tacticsOf(unit)) {
    if (tactic.minAllies !== undefined && tactic.minAllies > allies.length) continue
    const w = tacticWeight(tactic.weight, allies, self)
    if (w <= 0) continue
    for (const [targetId, tw] of targets(tactic.target, allies, foes, self)) {
      if (tw <= 0) continue
      const key = `${tactic.action}:${targetId ?? '*'}`
      weights[key] = (weights[key] ?? 0) + w * tw
      byKey.set(key, { action: tactic.action, targetId })
    }
  }
  return { weights, byKey }
}

/**
 * The unit's weight on each action right now, every target's summed: what `pickAction` draws
 * from, for the harness's feel probe. Draws nothing.
 */
export function actionWeights(s: GameState, unit: Unit): Partial<Record<ActionId, number>> {
  const out: Partial<Record<ActionId, number>> = {}
  const { weights, byKey } = pairs(s, unit)
  for (const [key, w] of Object.entries(weights)) {
    const action = byKey.get(key)?.action
    if (action) out[action] = (out[action] ?? 0) + w
  }
  return out
}

/**
 * The unit's (action, target) for this turn: every pair its tactics allow gets a weight, and
 * one seeded draw picks a pair. Null when no pair weighs anything; then nothing is drawn.
 * Touches nothing but `s.rng`.
 */
export function pickAction(s: GameState, unit: Unit): Choice | null {
  const { weights, byKey } = pairs(s, unit)
  if (byKey.size === 0) return null
  return byKey.get(drawWeighted(s, weights)) ?? null
}
