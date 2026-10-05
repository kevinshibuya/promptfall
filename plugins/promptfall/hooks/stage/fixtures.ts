// Hand-built game views for the stage tests and scripts/stage-goldens.ts.
import type { EnemyView, GameView, HeroView } from '../../types'

function hero(
  id: string,
  name: string,
  cls: string,
  level: number,
  rarity: string,
  gauge: { gauge: number; queued: boolean; alive?: boolean },
): HeroView {
  const alive = gauge.alive ?? true
  return {
    id,
    name,
    cls,
    glyph: '@',
    level,
    hp: alive ? 50 : 0,
    maxHp: 50,
    alive,
    rarity,
    gauge: gauge.gauge,
    queued: gauge.queued,
    gaugePerStep: 250,
  }
}

function enemy(
  id: string,
  def: string,
  name: string,
  hp: number,
  maxHp: number,
  kind = 'wave',
): EnemyView {
  return { id, def, name, glyph: '?', hp, maxHp, kind }
}

export const HEROES: readonly HeroView[] = [
  hero('h1', 'Aldric', 'knight', 5, 'common', { gauge: 6700, queued: false }),
  hero('h2', 'Mira', 'black_mage', 4, 'rare', { gauge: 10000, queued: true }),
  hero('h3', 'Tomas', 'white_mage', 5, 'legendary', { gauge: 2000, queued: false }),
]

function view(enemies: EnemyView[], zone = 1, wave = 2): GameView {
  return {
    heroes: HEROES.map((h) => ({ ...h })),
    enemies,
    zone,
    zoneName: 'Greenmeadow Road',
    wave,
    gold: 0,
    farm: false,
    lastDrop: null,
    loot: [],
    highestZone: zone,
    kills: 0,
    wipes: 0,
    inventory: [],
    inventoryCap: 20,
    roster: [],
    rosterCap: 6,
    tavernPrice: 0,
    nextInventoryCost: null,
    nextRosterCost: null,
    accountId: 'a1',
    firstRun: false,
    account: {
      linked: null,
      server: 'in-process',
      marketOpen: false,
      chatOpen: false,
      presenceOpen: false,
      leaderboardsOpen: false,
      bossOpen: false,
      returns: 0,
    },
    boss: null,
  }
}

/** Zone 1, wave 2: three heroes against Goblin Scout, Field Rat and Road Slime. */
export function wave(): GameView {
  return view([
    enemy('e1', 'goblin_scout', 'Goblin Scout', 42, 60),
    enemy('e2', 'field_rat', 'Field Rat', 10, 20),
    enemy('e3', 'road_slime', 'Road Slime', 30, 90),
  ])
}

export function boss(): GameView {
  return view([enemy('e9', 'bandit_captain', 'Bandit Captain', 500, 630, 'zone_boss')], 1, 11)
}

export function turnBoss(): GameView {
  return view([enemy('e8', 'wild_boar', 'Wild Boar', 200, 270, 'turn_boss')])
}

export function worldBoss(): GameView {
  return {
    ...view([enemy('e7', 'world_boss', 'The Promptwyrm', 630, 630, 'world_boss')]),
    boss: { bossId: 'wb1', name: 'The Promptwyrm', glyph: '☠', dealt: 0 },
  }
}

export function empty(): GameView {
  return view([])
}

/** A party with a fallen hero, for the gauge tests: Tomas is down, his gauge empty. */
export function fallen(): GameView {
  const v = wave()
  v.heroes = v.heroes.map((h) =>
    h.id === 'h3' ? { ...h, hp: 0, alive: false, gauge: 0, queued: false } : h,
  )
  return v
}
