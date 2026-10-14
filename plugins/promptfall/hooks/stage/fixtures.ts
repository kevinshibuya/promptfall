// Hand-built game views for the stage tests and scripts/stage-goldens.ts.
import type { EnemyView, GameView, HeroView } from '../../types'
import { encode } from '../sprites/base64'
import type { SpriteArt } from '../sprites/types'
import { type Pose, type StageActor, type StageModel, samePoses } from './model'
import type { Motion } from './timeline'

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
    shortName: name,
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
    hasted: false,
    guarding: false,
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
  return { id, def, name, glyph: '?', hp, maxHp, kind, enraged: false }
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
    waiting: 0,
    gold: 0,
    farm: false,
    autoVendor: false,
    lastDrop: null,
    loot: [],
    highestZone: zone,
    kills: 0,
    wipes: 0,
    zoneWipes: 0,
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
      huntOpen: false,
      returns: 0,
      sandbox: false,
    },
    boss: null,
    tallies: {
      enemies: {},
      collection: {},
      zoneBosses: 0,
      cleanZoneBosses: 0,
      turnBosses: 0,
      drops: { common: 0, uncommon: 0, rare: 0, epic: 0, legendary: 0 },
      recruits: { common: 0, uncommon: 0, rare: 0, epic: 0, legendary: 0 },
      reforges: 0,
      goldEarned: 0,
    },
    guarantees: { rare: 20, epic: 80, legendary: 400 },
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

/** 16 distinct colours from a seed, index 0 transparent. */
function dithered(width: number, height: number, seed: number): SpriteArt {
  const px = new Uint8Array(width * height).map((_, i) => {
    const x = i % width
    const y = Math.floor(i / width)
    return ((x + 3 * y) % 16) + 1
  })
  const palette = [
    0,
    ...Array.from({ length: 16 }, (_, c) => (seed * 0x0b1d3f + c * 0x0f0f0f) & 0xffffff),
  ]
  return { width, height, palette, pixels: encode(px) }
}

function checkered(width: number, height: number, a: number, b: number): SpriteArt {
  const px = new Uint8Array(width * height).map(
    (_, i) => 1 + (((i % width) + Math.floor(i / width)) % 2),
  )
  return { width, height, palette: [0, a, b], pixels: encode(px) }
}

function placed(
  key: string,
  art: SpriteArt,
  x: number,
  y: number,
  flipX: boolean,
  alpha = 1,
  poses: Partial<Record<Pose, SpriteArt>> = {},
  pose: Pose = 'idle',
): StageActor {
  const all = samePoses(art)
  for (const [p, a] of Object.entries(poses) as [Pose, SpriteArt][]) {
    all[p] = { art: a, palette: a.palette, raritySlot: null, dx: 0 }
  }
  return {
    key,
    spriteId: `adversarial:${key}`,
    art: all[pose].art,
    palette: all[pose].palette,
    x,
    y,
    flipX,
    alpha,
    fallen: false,
    flashing: false,
    raritySlot: null,
    pose,
    poses: all,
  }
}

/**
 * ADR 0006's fuller legal frame at `scale`: a 48 × 34 (72 × 51) boss and four 16 × 16 (24 × 24)
 * enemies dithered with index (x + 3y) % 16 + 1, two of the enemies dissolving, three checker
 * heroes with distinct palettes, a chest and its item. `acting`: the boss 60 ms into a lunge action with its
 * wind-up and strike as dithered frames of its own, the first hero taking the hit.
 */
export function fullerFrame(
  scale: 1 | 1.5,
  acting: boolean,
  now: number,
): { model: StageModel; motions: Motion[] } {
  const k = (v: number) => Math.round(v * scale)
  const boss = dithered(k(48), k(34), 1)
  const frames = acting && scale !== 1
  const actors = [
    placed(
      'e0',
      boss,
      k(4),
      0,
      false,
      1,
      frames ? { windup: dithered(k(48), k(34), 7), strike: dithered(k(48), k(34), 8) } : {},
      frames ? 'windup' : 'idle',
    ),
    ...[0, 1, 2, 3].map((i) =>
      placed(
        `e${i + 1}`,
        dithered(k(16), k(16), i + 2),
        k(56) + i * k(18),
        k(34) - k(16),
        false,
        i < 2 ? 0.5 : 1,
      ),
    ),
    ...[0, 1, 2].map((i) =>
      placed(
        `h${i + 1}`,
        checkered(k(16), k(16), 0x400000 + i * 0x101010, 0x00c000 + i * 0x000a0a),
        k(140) - i * k(18),
        k(34) - k(16),
        true,
      ),
    ),
  ]
  const motions: Motion[] = [
    { kind: 'dissolve', actor: 'e1', from: now - 100, until: now + 320 },
    { kind: 'dissolve', actor: 'e2', from: now - 100, until: now + 320 },
    {
      kind: 'chest',
      actor: 'e1',
      itemId: 'i1',
      rarity: 'common',
      spriteId: 'item:iron_sword',
      from: now - 100,
      until: now + 2300,
    },
  ]
  if (acting) {
    motions.push(
      { kind: 'lunge', actor: 'e0', from: now - 60, until: now + 180, dir: 1 },
      { kind: 'windup', actor: 'e0', from: now - 60, until: now + 60 },
      { kind: 'strike', actor: 'e0', from: now + 60, until: now + 180, shape: 'lunge' },
      { kind: 'hit', actor: 'h1', from: now + 60, until: now + 220 },
      { kind: 'flash', actor: 'h1', from: now + 60, until: now + 220 },
      {
        kind: 'number',
        actor: 'h1',
        text: '-999',
        rgb: 0xff5050,
        from: now + 60,
        until: now + 760,
      },
    )
  }
  return {
    model: {
      box: { columns: 160, rows: 17 },
      ground: 0x5a8c3a,
      backdrop: null,
      actors,
      numbers: [],
      glows: [{ x: k(68), y: k(18), r: k(12), rgb: 0xf0c040, alpha: 0.5 }],
      chests: [
        {
          spriteId: 'adversarial:chest',
          art: checkered(k(16), k(16), 0x604020, 0xf0c040),
          x: k(60),
          y: k(18),
          alpha: 1,
          phase: 'hold',
        },
      ],
      drops: [
        {
          spriteId: 'adversarial:drop',
          art: checkered(k(16), k(16), 0x808080, 0x0000ff),
          x: k(60),
          y: k(10),
          alpha: 1,
        },
      ],
      effects: [],
      alt: 'fuller',
      scale,
    },
    motions,
  }
}
