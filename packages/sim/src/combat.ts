import { content } from './content'
import { checkWipe, draw, drawBp, heroStats, livingParty, onEnemyKilled } from './progression'
import type { Effect, Enemy, GameState, Hero, Stats } from './types'

type Actor = { side: 'hero'; id: string; spd: number } | { side: 'enemy'; id: string; spd: number }

function damage(s: GameState, atk: number, def: number): number {
  const v = 9000 + draw(s, 2001)
  return Math.max(1, Math.floor((atk * v) / 10000) - Math.floor(def / 2))
}

const NO_STATS: Stats = { hp: 1, atk: 1, def: 0, spd: 0 }

function zoneBossStats(zone: number): Stats {
  return content.enemies[content.zones[zone - 1]?.boss ?? '']?.stats ?? NO_STATS
}

/**
 * The world boss at the party's zone: the carried (zone 1 baseline) atk and
 * def scaled by this zone's boss over zone 1's, so it hits as hard as the
 * party's own zone boss. Integer math only.
 */
export function scaledBossStats(s: GameState): Stats {
  const carried = s.boss?.stats ?? NO_STATS
  const z1 = zoneBossStats(1)
  const zb = zoneBossStats(s.zone)
  return {
    hp: carried.hp,
    atk: Math.floor((carried.atk * zb.atk) / Math.max(1, z1.atk)),
    def: Math.floor((carried.def * zb.def) / Math.max(1, z1.def)),
    spd: carried.spd + Math.floor(s.zone / 3),
  }
}

function enemyStats(s: GameState, enemy: Enemy): Stats {
  if (enemy.kind === 'world_boss') return scaledBossStats(s)
  return content.enemies[enemy.def]?.stats ?? NO_STATS
}

function lowestHpEnemy(enemies: Enemy[]): Enemy | undefined {
  let best: Enemy | undefined
  for (const e of enemies) if (!best || e.hp < best.hp) best = e
  return best
}

function hitEnemy(s: GameState, enemy: Enemy, amount: number, effects: Effect[]): void {
  // The world boss never dies here: the server tallies what the party dealt.
  if (enemy.kind === 'world_boss') {
    if (s.boss) s.boss.dealt += amount
    return
  }
  enemy.hp = Math.max(0, enemy.hp - amount)
  if (enemy.hp === 0) onEnemyKilled(s, enemy, effects)
}

type Round = { healed: boolean }

function heroAct(s: GameState, hero: Hero, effects: Effect[], round: Round): void {
  const encounter = s.encounter
  if (!encounter || encounter.enemies.length === 0) return
  const stats = heroStats(s, hero)
  switch (hero.cls) {
    case 'knight': {
      const target = encounter.enemies[0]
      if (target) hitEnemy(s, target, damage(s, stats.atk, enemyStats(s, target).def), effects)
      return
    }
    case 'black_mage': {
      const atk = Math.floor((stats.atk * 6000) / 10000)
      for (const target of [...encounter.enemies]) {
        // A kill earlier in the sweep may have closed the encounter (zone boss).
        if (!s.encounter?.enemies.includes(target)) continue
        hitEnemy(s, target, damage(s, atk, enemyStats(s, target).def), effects)
      }
      return
    }
    case 'white_mage': {
      // Alone, she fights: healing only herself could outlast the enemy forever.
      const living = livingParty(s)
      let lowest: Hero | undefined
      let lowestMax = 1
      for (const h of living.length > 1 ? living : []) {
        const max = heroStats(s, h).hp
        if (!lowest || h.hp < lowest.hp) {
          lowest = h
          lowestMax = max
        }
      }
      // One heal per round: a second healer attacks, or healers could stall forever.
      if (!round.healed && lowest && lowest.hp * 10000 < lowestMax * 7000) {
        round.healed = true
        lowest.hp = Math.min(lowestMax, lowest.hp + Math.floor((stats.atk * 8000) / 10000))
        return
      }
      const target = lowestHpEnemy(encounter.enemies)
      if (target) hitEnemy(s, target, damage(s, stats.atk, enemyStats(s, target).def), effects)
      return
    }
    case 'archer': {
      const target = lowestHpEnemy(encounter.enemies)
      if (!target) return
      let amount = damage(s, stats.atk, enemyStats(s, target).def)
      if (drawBp(s) < 2000) amount *= 2
      hitEnemy(s, target, amount, effects)
      return
    }
  }
}

function enemyAct(s: GameState, enemy: Enemy, effects: Effect[]): void {
  const living = livingParty(s)
  if (living.length === 0) return
  const knights = living.filter((h) => h.cls === 'knight')
  let target: Hero | undefined
  if (knights.length > 0 && drawBp(s) < 6000) target = knights[draw(s, knights.length)]
  else target = living[draw(s, living.length)]
  if (!target) return
  const stats = enemyStats(s, enemy)
  const amount = damage(s, stats.atk, heroStats(s, target).def)
  target.hp = Math.max(0, target.hp - amount)
  if (target.hp === 0) effects.push({ k: 'hero_fell', heroId: target.id })
}

/** One combat round on a draft state. Ends early on a wipe or when no enemy is left. */
export function resolveRound(s: GameState, effects: Effect[]): void {
  s.tick += 1
  if (checkWipe(s, effects)) return
  const encounter = s.encounter
  if (!encounter) return
  const actors: Actor[] = []
  for (const hero of livingParty(s))
    actors.push({ side: 'hero', id: hero.id, spd: heroStats(s, hero).spd })
  for (const enemy of encounter.enemies) {
    actors.push({ side: 'enemy', id: enemy.id, spd: enemyStats(s, enemy).spd })
  }
  actors.sort((a, b) => b.spd - a.spd)
  const round: Round = { healed: false }

  for (const actor of actors) {
    const current = s.encounter
    if (!current || current.enemies.length === 0) return
    if (actor.side === 'hero') {
      const hero = s.roster.find((h) => h.id === actor.id)
      if (!hero || hero.hp <= 0 || !s.party.includes(hero.id)) continue
      heroAct(s, hero, effects, round)
    } else {
      const enemy = current.enemies.find((e) => e.id === actor.id)
      if (!enemy || enemy.hp <= 0) continue
      enemyAct(s, enemy, effects)
      if (checkWipe(s, effects)) return
    }
  }
}
