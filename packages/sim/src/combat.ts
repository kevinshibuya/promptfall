import {
  ACTION_STEPS,
  ENRAGE_BP,
  fill,
  GAUGE_FULL,
  GUARD_DAMAGE_BP,
  HIT_ALL_BP,
  RAGE_BP,
  SELF_HEAL_BP,
  STEP_MS,
  STRIKE_TWICE_BP,
  scaled,
  TICK_MS,
} from './battle'
import { type BossMove, content, enemyAt, zoneAt } from './content'
import { type Choice, pickAction, type Unit } from './picker'
import {
  checkWipe,
  draw,
  drawBp,
  findHero,
  heroStats,
  livingParty,
  onEnemyKilled,
} from './progression'
import { heroFill } from './reactive'
import type { Effect, Enemy, GameState, Hero, Stats } from './types'

const STEPS = TICK_MS / STEP_MS

/** The variance roll that changes nothing: the middle of a hit's ±10%. */
export const NO_VARIANCE_BP = 10000

/** The share of an attack a defence lets through, in basis points: 100 / (100 + def), floored. */
function mitigationBp(def: number): number {
  return Math.floor(1000000 / (100 + Math.max(0, def)))
}

/**
 * One hit of this attack on this defence, before the Archer's double: the attack scaled by the
 * mitigation and the variance roll, both in basis points, floored, at least 1, then the power
 * scaling. Integer math only. The harness's feel probe calls it at NO_VARIANCE_BP, so a formula
 * change here moves the probe too.
 */
export function hitDamage(atk: number, def: number, varianceBp: number): number {
  return scaled(Math.max(1, Math.floor((atk * mitigationBp(def) * varianceBp) / 100000000)))
}

function damage(s: GameState, atk: number, def: number): number {
  return hitDamage(atk, def, 9000 + draw(s, 2001))
}

const NO_STATS: Stats = { hp: 1, atk: 1, def: 0, spd: 0 }

/** A zone's boss's stats, its atk before its move's multiplier: the world boss has no move. */
function zoneBossStats(zone: number): Stats {
  const def = enemyAt(zoneAt(zone)?.def.boss ?? '', zone)
  return def ? { ...def.stats, atk: def.baseAtk ?? def.stats.atk } : NO_STATS
}

/**
 * The world boss at the party's zone: the carried (zone 1 baseline) atk and
 * def scaled by this zone's boss over zone 1's, so it hits as hard as the
 * party's own zone boss, its tier's included; its speed gains what that boss's
 * gains over zone 1's. Integer math only.
 */
export function scaledBossStats(s: GameState): Stats {
  const carried = s.boss?.stats ?? NO_STATS
  const z1 = zoneBossStats(1)
  const zb = zoneBossStats(s.zone)
  return {
    hp: carried.hp,
    atk: Math.floor((carried.atk * zb.atk) / Math.max(1, z1.atk)),
    def: Math.floor((carried.def * zb.def) / Math.max(1, z1.def)),
    spd: carried.spd + zb.spd - z1.spd,
  }
}

export function enemyStats(s: GameState, enemy: Enemy): Stats {
  if (enemy.kind === 'world_boss') return scaledBossStats(s)
  return enemyAt(enemy.def, s.zone)?.stats ?? NO_STATS
}

/** A zone boss's move, its base zone's in every tier; none for any other enemy. */
function moveOf(enemy: Enemy): BossMove | undefined {
  return enemy.kind === 'zone_boss' ? content.enemies[enemy.def]?.move : undefined
}

/** Under half its HP, read at the hit: no flag and no state. */
function underHalf(enemy: Enemy): boolean {
  return enemy.hp * 2 < enemy.maxHp
}

function hitEnemy(s: GameState, by: string, enemy: Enemy, amount: number, effects: Effect[]): void {
  effects.push({ k: 'hit', by, target: enemy.id, amount })
  // The world boss never dies here: the server tallies what the party dealt.
  if (enemy.kind === 'world_boss') {
    if (s.boss) s.boss.dealt += amount
    return
  }
  const wasUnder = underHalf(enemy)
  enemy.hp = Math.max(0, enemy.hp - amount)
  if (enemy.hp === 0) onEnemyKilled(s, enemy, effects)
  else if (!wasUnder && underHalf(enemy) && moveOf(enemy) === 'rage') {
    effects.push({ k: 'raging', enemyId: enemy.id })
  }
}

function gaugeOf(s: GameState, id: string): { id: string; g: number } {
  let entry = s.battle.gauges.find((e) => e.id === id)
  if (!entry) {
    entry = { id, g: 0 }
    s.battle.gauges.push(entry)
  }
  return entry
}

/** A fallen hero's gauge stops and empties, and it leaves the queue. */
function fall(s: GameState, hero: Hero, effects: Effect[]): void {
  effects.push({ k: 'hero_fell', heroId: hero.id })
  gaugeOf(s, hero.id).g = 0
  s.battle.queue = s.battle.queue.filter((id) => id !== hero.id)
}

function heroAction(s: GameState, hero: Hero, choice: Choice, effects: Effect[]): void {
  const encounter = s.encounter
  const stats = heroStats(s, hero)
  switch (choice.action) {
    case 'attack': {
      const target = encounter?.enemies.find((e) => e.id === choice.targetId)
      if (!target) return
      let amount = damage(s, stats.atk, enemyStats(s, target).def)
      if (hero.cls === 'archer' && drawBp(s) < 2000) amount *= 2
      hitEnemy(s, hero.id, target, amount, effects)
      return
    }
    case 'attack_all': {
      const atk = Math.floor((stats.atk * 6000) / 10000)
      for (const target of [...(encounter?.enemies ?? [])]) {
        // A kill earlier in the sweep may have closed the encounter (zone boss).
        if (!s.encounter?.enemies.includes(target)) continue
        hitEnemy(s, hero.id, target, damage(s, atk, enemyStats(s, target).def), effects)
      }
      return
    }
    case 'heal': {
      const target = findHero(s, choice.targetId ?? '')
      if (!target || target.hp <= 0) return
      const max = heroStats(s, target).hp
      const amount = Math.min(
        Math.max(0, max - target.hp),
        scaled(Math.floor((stats.atk * 8000) / 10000)),
      )
      if (amount <= 0) return
      target.hp += amount
      effects.push({ k: 'heal', by: hero.id, target: target.id, amount })
      return
    }
  }
}

/**
 * One enemy hit on one hero, from `shareBp` of its atk: a raging boss under half scales it by
 * RAGE_BP, and an enraged enemy's next hit by ENRAGE_BP, both on one hit, then the enrage passes.
 */
function hitHero(
  s: GameState,
  enemy: Enemy,
  target: Hero,
  shareBp: number,
  effects: Effect[],
): void {
  let atk = Math.floor((enemyStats(s, enemy).atk * shareBp) / 10000)
  if (moveOf(enemy) === 'rage' && underHalf(enemy)) atk = Math.floor((atk * RAGE_BP) / 10000)
  if (enemy.enraged) atk = Math.floor((atk * ENRAGE_BP) / 10000)
  enemy.enraged = false
  let amount = damage(s, atk, heroStats(s, target).def)
  if (s.guardTicks > 0) amount = Math.max(1, Math.floor((amount * GUARD_DAMAGE_BP) / 10000))
  target.hp = Math.max(0, target.hp - amount)
  effects.push({ k: 'hit', by: enemy.id, target: target.id, amount })
  if (target.hp === 0) fall(s, target, effects)
}

function enemyAction(s: GameState, enemy: Enemy, choice: Choice, effects: Effect[]): void {
  switch (choice.action) {
    case 'attack': {
      const target = findHero(s, choice.targetId ?? '')
      if (!target || target.hp <= 0) return
      hitHero(s, enemy, target, 10000, effects)
      return
    }
    case 'attack_twice': {
      const target = findHero(s, choice.targetId ?? '')
      for (let i = 0; i < 2 && target && target.hp > 0; i++)
        hitHero(s, enemy, target, STRIKE_TWICE_BP, effects)
      return
    }
    case 'attack_all': {
      for (const target of livingParty(s)) hitHero(s, enemy, target, HIT_ALL_BP, effects)
      return
    }
    case 'heal': {
      const amount = Math.min(
        Math.max(0, enemy.maxHp - enemy.hp),
        scaled(Math.floor((enemyStats(s, enemy).atk * SELF_HEAL_BP) / 10000)),
      )
      if (amount <= 0) return
      enemy.hp += amount
      effects.push({ k: 'heal', by: enemy.id, target: enemy.id, amount })
      return
    }
  }
}

/** The living unit with this id on the field, or undefined. */
function unitOf(s: GameState, id: string): Unit | undefined {
  const hero = livingParty(s).find((h) => h.id === id)
  if (hero) return { side: 'hero', hero }
  const enemy = s.encounter?.enemies.find((e) => e.id === id && e.hp > 0)
  return enemy ? { side: 'enemy', enemy } : undefined
}

/** Drops gauges and queue entries of units no longer on the field; adds a 0 gauge for any newcomer. */
function syncGauges(s: GameState): void {
  const onField = new Set<string>()
  for (const h of livingParty(s)) onField.add(h.id)
  for (const e of s.encounter?.enemies ?? []) onField.add(e.id)
  s.battle.gauges = s.battle.gauges.filter((e) => onField.has(e.id))
  s.battle.queue = s.battle.queue.filter((id) => onField.has(id))
  for (const id of onField) gaugeOf(s, id)
}

/**
 * One tick of battle time on a draft state: TICK_MS in STEP_MS steps. Gauges fill by speed;
 * full units queue in the order they filled; the head acts when no action is running.
 * Ends early on a wipe or when no enemy is left.
 */
export function advanceBattle(s: GameState, effects: Effect[]): void {
  s.tick += 1
  if (checkWipe(s, effects)) return
  syncGauges(s)
  const battle = s.battle
  // Speed does not change inside a tick: no equip, and level ups add no spd.
  const perStep = new Map<string, number>()
  const fillOf = (unit: Unit): number => {
    const id = unit.side === 'hero' ? unit.hero.id : unit.enemy.id
    let f = perStep.get(id)
    if (f === undefined) {
      f = unit.side === 'hero' ? heroFill(s, unit.hero) : fill(enemyStats(s, unit.enemy).spd)
      perStep.set(id, f)
    }
    return f
  }

  for (let step = 0; step < STEPS; step++) {
    const encounter = s.encounter
    if (!encounter || encounter.enemies.length === 0) {
      // Time still passes with nobody to fight.
      battle.busy = Math.max(0, battle.busy - (STEPS - step))
      return
    }

    // 1. Fill. Units that fill this step queue by overflow, heroes first, then field order.
    const units: Unit[] = [
      ...livingParty(s).map((hero): Unit => ({ side: 'hero', hero })),
      ...encounter.enemies.filter((e) => e.hp > 0).map((enemy): Unit => ({ side: 'enemy', enemy })),
    ]
    const filled: { id: string; over: number; order: number }[] = []
    units.forEach((unit, order) => {
      const id = unit.side === 'hero' ? unit.hero.id : unit.enemy.id
      if (battle.queue.includes(id)) return
      const entry = gaugeOf(s, id)
      entry.g += fillOf(unit)
      if (entry.g >= GAUGE_FULL) {
        filled.push({ id, over: entry.g - GAUGE_FULL, order })
        entry.g = GAUGE_FULL
      }
    })
    filled.sort((a, b) => b.over - a.over || a.order - b.order)
    for (const f of filled) battle.queue.push(f.id)

    // 2. The running action goes on.
    if (battle.busy > 0) battle.busy -= 1

    // 3. Nobody acting: the queue head acts. Guarding heroes hold their place and the first
    // enemy behind them acts.
    while (battle.busy === 0 && battle.queue.length > 0) {
      const at = s.guardTicks > 0 ? battle.queue.findIndex((q) => unitOf(s, q)?.side !== 'hero') : 0
      if (at < 0) break
      const [id = ''] = battle.queue.splice(at, 1)
      const unit = unitOf(s, id)
      if (!unit) continue
      gaugeOf(s, id).g = 0
      const choice = pickAction(s, unit)
      if (!choice) continue
      effects.push({ k: 'act', actor: id, action: choice.action, at: step * STEP_MS })
      battle.busy = ACTION_STEPS
      if (unit.side === 'hero') heroAction(s, unit.hero, choice, effects)
      else {
        enemyAction(s, unit.enemy, choice, effects)
        if (checkWipe(s, effects)) return
      }
    }
  }
}
