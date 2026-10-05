// Hand-built game views for the stage tests and scripts/stage-goldens.ts.
import type { EnemyView, GameView, HeroView } from '../../types'

function hero(id: string, name: string, cls: string, level: number, rarity: string): HeroView {
  return { id, name, cls, glyph: '@', level, hp: 50, maxHp: 50, alive: true, rarity }
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
  hero('h1', 'Aldric', 'knight', 5, 'common'),
  hero('h2', 'Mira', 'black_mage', 4, 'rare'),
  hero('h3', 'Tomas', 'white_mage', 5, 'legendary'),
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
