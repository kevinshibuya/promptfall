// The golden-frame scenarios, shared by golden.test.ts and scripts/stage-goldens.ts.
import type { GameView, WorldState } from '../../types'
import { decode } from '../sprites/base64'
import { WORLD_DEFAULT } from '../state'
import { accountPane, noViewPane } from '../ui/pane/account'
import { chatPane } from '../ui/pane/chat'
import {
  boardsLoaded,
  chatWorld,
  journalLoaded,
  marketPage,
  ordersMine,
  paneInput,
  paneView,
} from '../ui/pane/fixtures'
import { heroesPane } from '../ui/pane/heroes'
import type { PaneInput } from '../ui/pane/input'
import { inventoryPane } from '../ui/pane/inventory'
import { journalPane } from '../ui/pane/journal'
import { boardsPane } from '../ui/pane/leaderboards'
import { marketPane } from '../ui/pane/market'
import { oddsPane } from '../ui/pane/odds'
import { ordersPane } from '../ui/pane/orders'
import type { PaneBuild } from '../ui/pane/types'
import { type StripInput, stripScene, stripTracks } from '../ui/strip'
import type { Effect } from '../vendor/sim.js'
import { windowFrame } from '../windows/image'
import { glyphFor, type Scene } from '../windows/kit'
import { sceneCells } from '../windows/raster'
import { sceneSvg } from '../windows/svg'
import { CELL_H, CELL_W, STRIP_MAX_COLUMNS, WINDOW_SCALE } from '../windows/tuning'
import { composeFrame, type Frame } from './compose'
import { boss, empty, fallen, wave, worldBoss } from './fixtures'
import { GaugeTrack } from './gauges'
import { fnv1a64 } from './hash'
import { encodeImage, pngImage } from './image'
import { type Box, layoutFor } from './layout'
import { MessageLog } from './log'
import { bandCells } from './loop'
import { type StageModel, stageAt } from './model'
import { composeBand, svgFit } from './playfield'
import { CLEAR, encodeRaster, intoCells, rasterPairs } from './raster'
import { stagedState } from './staged'
import { fitSvg, type Rung, stageSvg } from './svg'
import { type Motion, StageTimeline } from './timeline'
import {
  CHEST_FALL_MS,
  CHEST_OPEN_MS,
  CHEST_SIT_MS,
  DESKTOP_COLUMN_PX_CEILING,
  DISSOLVE_MS,
  FLASH_MS,
  FULL_MIN_COLUMNS,
  HASTE_FRAME_MS,
  HUDDLE_MS,
  LEVEL_STAGGER_MS,
  LUNGE_MS,
  REVEAL_RISE_MS,
  SPAWN_MS,
  STAGE_MAX_COLUMNS,
  STAGE_ROWS,
  STEP_OUT_MS,
  TRAVEL_OFF_MS,
  VICTORY_MS,
  WAVE_GAP_MS,
  WINDUP_HOLD_MS,
} from './tuning'

export const GOLDEN_NOW = 1_000_000
export const SCENARIOS = [
  'rest',
  'boss',
  'compact',
  'dissolve',
  'drop',
  'chest',
  'reveal',
  'reveal-legendary',
  'lone-chest',
  'windup',
  'strike',
  'follow',
  'bolt',
  'burst',
  'enemy-strike',
  'boss-strike',
  'step',
  'step-boss',
  'haste',
  'enrage',
  'camp',
  'camp-break',
  'camp-boss',
  'compact-camping',
  'guard',
  'guard-huddle',
  'guard-hit',
  'compact-guard',
  'travel',
  'level-up',
  'victory',
  'boss-kill-travel',
  'boss_move',
  'spawn',
] as const
export type Scenario = (typeof SCENARIOS)[number]
export type Golden = {
  rasterHash: string
  imageHash: string
  svgHash: string
  svgChars: number
  rasterPairs: number
}
/** The scenario's one model, the scene every surface draws: the Raster, the Image and the Svg. */
export type Staged = {
  model: StageModel
  motions: readonly Motion[]
  now: number
}

const NOW = GOLDEN_NOW
const FULL: Box = { columns: 120, rows: STAGE_ROWS }
const item = {
  id: 'i1',
  base: 'iron_sword',
  rarity: 'epic' as const,
  tier: 1,
  affixes: [],
  equippedBy: null,
  tradeableAt: null,
}
/** How far into its hold a `reveal` scenario's item is. */
const REVEAL_HELD_MS = 400
/** The wave with every hero patched: hasted, or guarding. */
const party = (patch: Partial<GameView['heroes'][number]>): GameView => {
  const v = wave()
  v.heroes = v.heroes.map((h) => ({ ...h, ...patch }))
  return v
}
const withoutFront = (): GameView => {
  const v = wave()
  v.enemies = v.enemies.filter((e) => e.id !== 'e1')
  return v
}

/**
 * A scenario's case: its timeline built once from its events and observations, staged at any
 * instant from `from`, the last of them, on. Its golden stages it at `now`.
 */
export type Case = {
  from: number
  now: number
  at: (now: number) => Staged
}

/** The case staging `view` on `t` in `box`, last observed or given its events at `from`. */
function staging(
  view: GameView,
  t: StageTimeline,
  box: Box,
  from: number,
  { compact = false, now = NOW } = {},
): Case {
  return {
    from,
    now,
    at: (at) => ({
      model: stageAt(stagedState(view, WORLD_DEFAULT, t, at), t, at, box, {
        compact,
        motion: 'full',
      }),
      motions: t.active(at),
      now: at,
    }),
  }
}

/** The enemy that steps on after the `spawn` scenario's kill, in the slot-0 enemy's place. */
const NEWCOMER = {
  id: 'e4',
  def: 'hedge_sprite',
  name: 'Hedge Sprite',
  glyph: '?',
  hp: 24,
  maxHp: 24,
  kind: 'wave',
  enraged: false,
}

/**
 * A killing action on the slot-0 enemy at `t1`, a hit back on a hero 500 ms later, the kill
 * observed right after; with `enters`, the next observe at that instant brings the newcomer on.
 */
function killed(t1: number, effects: Effect[], box: Box, enters?: number): Case {
  const t = new StageTimeline()
  t.observe(wave(), t1 - 1000)
  t.onEffects(effects, t1)
  const after = withoutFront()
  t.observe(after, t1 + 10)
  if (enters === undefined) return staging(after, t, box, t1 + 10)
  const next = { ...after, enemies: [...after.enemies, NEWCOMER] }
  t.observe(next, enters)
  return staging(next, t, box, enters)
}

/** `actor` attacked `target` (the slot-0 enemy by default) `ms` before NOW. */
function attacking(actor: string, ms: number, target = 'e1'): Case {
  const t = new StageTimeline()
  t.observe(wave(), NOW - ms)
  t.onEffects(
    [
      { k: 'act', actor, action: 'attack', at: 0 },
      { k: 'hit', by: actor, target, amount: 9 },
    ],
    NOW - ms,
  )
  return staging(wave(), t, FULL, NOW - ms)
}

/** The wave with the knight and the white mage 25 HP down: what a camp's heals restore. */
const hurt = (): GameView => {
  const v = wave()
  v.heroes = v.heroes.map((h) => (h.id === 'h2' ? h : { ...h, hp: h.hp - 25 }))
  return v
}
const CAMP_HEALS = [
  { heroId: 'h1', amount: 25 },
  { heroId: 'h2', amount: 0 },
  { heroId: 'h3', amount: 25 },
]
/** The wave held while the party camps. */
const campingView = (): GameView => ({ ...wave(), camping: true })

/** The scenario staged at its golden instant. */
export function stage(name: Scenario): Staged {
  const c = caseOf(name)
  return c.at(c.now)
}

/** The kill's actions the `dissolve` and `spawn` scenarios play, at `t1`. */
const KILL: Effect[] = [
  { k: 'act', actor: 'h1', action: 'attack', at: 0 },
  { k: 'hit', by: 'h1', target: 'e1', amount: 42 },
  { k: 'act', actor: 'e2', action: 'attack', at: 500 },
  { k: 'hit', by: 'e2', target: 'h2', amount: 7 },
]

export function caseOf(name: Scenario): Case {
  const t = new StageTimeline()
  switch (name) {
    // Each attack holds its wind-up WINDUP_HOLD_MS before it moves; past the hold, the knight
    // 60 ms into its lunge (winding up), at 180 (striking, the enemy hit), at 300 (following
    // through); the black mage's fireball and the white mage's burst at 220.
    case 'windup':
      return attacking('h1', WINDUP_HOLD_MS + 60)
    case 'strike':
      return attacking('h1', WINDUP_HOLD_MS + 180)
    case 'follow':
      return attacking('h1', WINDUP_HOLD_MS + 300)
    case 'bolt':
      return attacking('h2', WINDUP_HOLD_MS + 220)
    case 'burst':
      return attacking('h3', WINDUP_HOLD_MS + 220)
    // The goblin scout 150 ms into its lunge: its strike frame, the knight's hit frame.
    case 'enemy-strike':
      return attacking('e1', WINDUP_HOLD_MS + 150, 'h1')
    // The bandit captain 60 ms into its attack on the knight: its wind-up frame, the lunge out.
    case 'boss-strike': {
      t.observe(boss(), NOW - WINDUP_HOLD_MS - 60)
      t.onEffects(
        [
          { k: 'act', actor: 'e9', action: 'attack', at: 0 },
          { k: 'hit', by: 'e9', target: 'h1', amount: 31 },
        ],
        NOW - WINDUP_HOLD_MS - 60,
      )
      return staging(
        boss(),
        t,
        { columns: 120, rows: t.rowsAt(boss(), NOW) },
        NOW - WINDUP_HOLD_MS - 60,
      )
    }
    // The black mage 30 ms past its step out, still in its hold: stepped toward the enemies in
    // its wind-up frame, its fireball not yet thrown.
    case 'step':
      return attacking('h2', STEP_OUT_MS + 30)
    // The world boss at the same moment of its hold on the knight: the same step as any actor's.
    case 'step-boss': {
      t.observe(worldBoss(), NOW - STEP_OUT_MS - 30)
      t.onEffects(
        [
          { k: 'act', actor: 'e7', action: 'attack', at: 0 },
          { k: 'hit', by: 'e7', target: 'h1', amount: 31 },
        ],
        NOW - STEP_OUT_MS - 30,
      )
      return staging(
        worldBoss(),
        t,
        { columns: 120, rows: t.rowsAt(worldBoss(), NOW) },
        NOW - STEP_OUT_MS - 30,
      )
    }
    case 'rest': {
      t.observe(wave(), NOW)
      return staging(wave(), t, FULL, NOW)
    }
    // The reactive events (spec #131). Haste: every living hero trails its speed lines and bobs
    // twice as fast, a quarter-second in: the heroes in the second half of their bob, the enemies
    // in the first. The white mage has fallen and shows none.
    case 'haste': {
      const v = party({ hasted: true })
      v.heroes = v.heroes.map((h) => (h.id === 'h3' ? { ...h, hp: 0, alive: false } : h))
      t.observe(v, NOW)
      return staging(v, t, FULL, NOW, { now: NOW + HASTE_FRAME_MS })
    }
    // A mishap 40 ms ago enraged the strongest enemy: the bandit captain behind the field rat,
    // mid red flash, then tinted until its next hit.
    case 'enrage': {
      const v = boss()
      v.enemies = [...wave().enemies.filter((e) => e.id === 'e2'), ...v.enemies]
      t.observe(v, NOW - 1000)
      t.onEffects([{ k: 'enraged', enemyId: 'e9' }], NOW - 40)
      t.observe(v, NOW)
      return staging(v, t, { columns: 120, rows: t.rowsAt(v, NOW) }, NOW)
    }
    // Camp made 500 ms ago: the enemies have walked off, the party stands huddled at the fire a
    // hero's width ahead of the knight, the bob stopped, two heroes' heals still rising green.
    case 'camp': {
      t.observe(hurt(), NOW - 1000)
      t.onEffects([{ k: 'camp', on: true, heals: CAMP_HEALS }], NOW - 500)
      t.observe(campingView(), NOW - 500)
      return staging(campingView(), t, FULL, NOW - 500, { now: NOW })
    }
    // Camp broken half a spawn ago: the held enemies halfway back in from the left, the party
    // stepped back to its slots, the fire fading.
    case 'camp-break': {
      t.observe(hurt(), NOW - 6000)
      t.onEffects([{ k: 'camp', on: true, heals: CAMP_HEALS }], NOW - 5000)
      t.observe(campingView(), NOW - 4000)
      t.onEffects([{ k: 'camp', on: false, heals: [] }], NOW - SPAWN_MS / 2)
      t.observe(wave(), NOW - SPAWN_MS / 2)
      return staging(wave(), t, FULL, NOW - SPAWN_MS / 2, { now: NOW })
    }
    // A camp with a world boss engaged, 300 ms ago: the fire mid-field, the boss still standing,
    // the heals rising green; no pause.
    case 'camp-boss': {
      const v = worldBoss()
      const sore = worldBoss()
      sore.heroes = hurt().heroes
      t.observe(sore, NOW - 1000)
      t.onEffects([{ k: 'camp', heals: CAMP_HEALS }], NOW - 300)
      t.observe(v, NOW)
      return staging(v, t, { columns: 120, rows: t.rowsAt(v, NOW) }, NOW)
    }
    // Camping on the compact stage: the compact fire, no enemy.
    case 'compact-camping': {
      t.observe(hurt(), NOW - 1000)
      t.onEffects([{ k: 'camp', on: true, heals: CAMP_HEALS }], NOW - 500)
      t.observe(campingView(), NOW)
      return staging(campingView(), t, { columns: 52, rows: 4 }, NOW, { compact: true })
    }
    // Guard, first drawn on a guarding party: huddled toward the knight with no step, every hero
    // in the stance, the bob stopped, the knight holding the big shield on the enemies' side.
    case 'guard': {
      const v = party({ guarding: true })
      t.observe(v, NOW)
      return staging(v, t, FULL, NOW)
    }
    // Guard coming on, halfway through the huddle: the black mage and the white mage sliding in
    // toward the knight in their idle art.
    case 'guard-huddle': {
      t.observe(wave(), NOW - 1000)
      t.onEffects([{ k: 'guard', on: true }], NOW - HUDDLE_MS / 2)
      const v = party({ guarding: true })
      t.observe(v, NOW - HUDDLE_MS / 2)
      return staging(v, t, FULL, NOW - HUDDLE_MS / 2, { now: NOW })
    }
    // Guard under attack: the goblin scout's lunge at its apex on the knight, the impact. The
    // shield flashes white with the knight's blink, the knight in its hit frame.
    case 'guard-hit': {
      const v = party({ guarding: true })
      const ms = WINDUP_HOLD_MS + LUNGE_MS / 2
      t.observe(v, NOW - ms)
      t.onEffects(
        [
          { k: 'act', actor: 'e1', action: 'attack', at: 0 },
          { k: 'hit', by: 'e1', target: 'h1', amount: 4 },
        ],
        NOW - ms,
      )
      return staging(v, t, FULL, NOW - ms)
    }
    // Guard on the compact stage: the knight in the stance with the 1x shield beside it.
    case 'compact-guard': {
      const v = party({ guarding: true })
      t.observe(v, NOW)
      return staging(v, t, { columns: 52, rows: 4 }, NOW, { compact: true })
    }
    // The stage moments (spec #132). A travel from zone 1 to 3 halfway through the party's step
    // off: the heroes stepped right and half faded, the encounter it left standing on zone 1's
    // backdrop until it changes.
    case 'travel': {
      t.observe(wave(), NOW - 1000)
      t.onEffects([{ k: 'traveled', from: 1, to: 3 }], NOW - TRAVEL_OFF_MS / 2)
      const next = { ...empty(), zone: 3, zoneName: 'Marsh of Sighs', wave: 1 }
      t.observe(next, NOW)
      return staging(next, t, FULL, NOW)
    }
    // Two level-ups in one group, the second a stagger behind the first: the knight's deltas
    // rising in gold, the second hero mid gold flash 40 ms in, its own deltas just off.
    case 'level-up': {
      t.observe(wave(), NOW - 1000)
      t.onEffects(
        [
          { k: 'level_up', heroId: 'h1', level: 6, deltas: { hp: 9, atk: 2, def: 2, spd: 0 } },
          { k: 'level_up', heroId: 'h2', level: 6, deltas: { hp: 6, atk: 1, def: 0, spd: 1 } },
        ],
        NOW - LEVEL_STAGGER_MS - 40,
      )
      return staging(wave(), t, FULL, NOW - LEVEL_STAGGER_MS - 40)
    }
    // The bandit captain fell and dissolved; at NOW the party holds its victory pose, a quarter
    // into the hold, over zone 1's backdrop.
    case 'victory': {
      const t1 = NOW - (WINDUP_HOLD_MS + LUNGE_MS / 2 + FLASH_MS + DISSOLVE_MS + VICTORY_MS / 4)
      t.observe(boss(), t1 - 1000)
      t.onEffects(
        [
          { k: 'act', actor: 'h1', action: 'attack', at: 0 },
          { k: 'hit', by: 'h1', target: 'e9', amount: 500 },
          { k: 'zone_cleared', zone: 1, advancedTo: 2 },
        ],
        t1,
      )
      const next = { ...empty(), zone: 2, zoneName: 'Whisperwood', wave: 1 }
      t.observe(next, t1 + 10)
      return staging(next, t, { columns: 120, rows: t.rowsAt(next, NOW) }, t1 + 10)
    }
    // The bandit captain fell with Push on: past the dissolve and the victory hold, at NOW the
    // party is halfway through its step-off, over zone 1's backdrop until it ends.
    case 'boss-kill-travel': {
      const t1 =
        NOW -
        (WINDUP_HOLD_MS + LUNGE_MS / 2 + FLASH_MS + DISSOLVE_MS + VICTORY_MS + TRAVEL_OFF_MS / 2)
      t.observe(boss(), t1 - 1000)
      t.onEffects(
        [
          { k: 'act', actor: 'h1', action: 'attack', at: 0 },
          { k: 'hit', by: 'h1', target: 'e9', amount: 500 },
          { k: 'zone_cleared', zone: 1, advancedTo: 2 },
        ],
        t1,
      )
      const next = { ...empty(), zone: 2, zoneName: 'Whisperwood', wave: 1 }
      t.observe(next, t1 + 10)
      return staging(next, t, { columns: 120, rows: t.rowsAt(next, NOW) }, t1 + 10)
    }
    // A boss move (#169): the bandit captain's whole-party hit 20 ms past its lunge's one impact,
    // every hero in its hit frame with its number rising.
    case 'boss_move': {
      const t1 = NOW - (WINDUP_HOLD_MS + LUNGE_MS / 2 + 20)
      t.observe(boss(), t1)
      t.onEffects(
        [
          { k: 'act', actor: 'e9', action: 'attack_all', at: 0 },
          { k: 'hit', by: 'e9', target: 'h1', amount: 19 },
          { k: 'hit', by: 'e9', target: 'h2', amount: 24 },
          { k: 'hit', by: 'e9', target: 'h3', amount: 22 },
        ],
        t1,
      )
      return staging(boss(), t, { columns: 120, rows: t.rowsAt(boss(), NOW) }, t1)
    }
    case 'boss': {
      // The boss spawned half a spawn ago.
      t.observe(empty(), NOW - SPAWN_MS)
      t.observe(boss(), NOW - SPAWN_MS / 2)
      const box = { columns: 120, rows: t.rowsAt(boss(), NOW) }
      return staging(boss(), t, box, NOW - SPAWN_MS / 2)
    }
    case 'compact': {
      t.observe(wave(), NOW)
      const box = { columns: 52, rows: 4 }
      return staging(wave(), t, box, NOW, { compact: true })
    }
    case 'dissolve': {
      // The dissolve starts when the kill's flash ends; at NOW it is half done.
      const t1 = NOW - (WINDUP_HOLD_MS + LUNGE_MS / 2 + FLASH_MS + DISSOLVE_MS / 2)
      return killed(t1, KILL, FULL)
    }
    // The goblin scout's kill as `dissolve` plays it: once its fade and the pause after it are
    // over, the next observe brings the hedge sprite on in its place; at NOW it is halfway
    // through its fade in, the field rat and the road slime sliding up the line ahead of it.
    case 'spawn': {
      const enters = NOW - SPAWN_MS / 2
      const t1 = enters - (WINDUP_HOLD_MS + LUNGE_MS / 2 + FLASH_MS + DISSOLVE_MS + WAVE_GAP_MS)
      return killed(t1, KILL, FULL, enters)
    }
    // A sandbox item dropped between spawns: no row to fall from, so its chest fell onto the
    // front slot's empty ground; at NOW it has opened and the sword is halfway up its rise.
    case 'lone-chest': {
      const t0 = NOW - (CHEST_FALL_MS + CHEST_SIT_MS + CHEST_OPEN_MS + REVEAL_RISE_MS / 2)
      t.observe(empty(), t0 - 1000)
      t.onEffects([{ k: 'drop', item }], t0)
      return staging(empty(), t, FULL, t0)
    }
    // The kill's chest lands as its fade ends. At NOW, for `chest`, it sits closed halfway
    // through its sit; for `drop`, it has opened and the sword is halfway up its rise; for
    // `reveal` (a common sword) and `reveal-legendary`, the sword has risen on its glow and holds,
    // REVEAL_HELD_MS into its hold.
    case 'chest':
    case 'drop':
    case 'reveal':
    case 'reveal-legendary': {
      const opened = CHEST_SIT_MS + CHEST_OPEN_MS
      const since =
        name === 'chest'
          ? CHEST_SIT_MS / 2
          : name === 'drop'
            ? opened + REVEAL_RISE_MS / 2
            : opened + REVEAL_RISE_MS + REVEAL_HELD_MS
      const rarity =
        name === 'reveal' ? 'common' : name === 'reveal-legendary' ? 'legendary' : item.rarity
      const t1 = NOW - (WINDUP_HOLD_MS + LUNGE_MS / 2 + FLASH_MS + DISSOLVE_MS + since)
      return killed(
        t1,
        [
          { k: 'act', actor: 'h1', action: 'attack', at: 0 },
          { k: 'hit', by: 'h1', target: 'e1', amount: 42 },
          { k: 'drop', item: { ...item, rarity } },
          { k: 'act', actor: 'e2', action: 'attack', at: 500 },
          { k: 'hit', by: 'e2', target: 'h2', amount: 7 },
        ],
        FULL,
      )
    }
  }
}

/**
 * A staged scenario's encodings, each rendered once: what its golden hashes, and the goldens test's
 * budget and rung checks, read.
 */
export type Renders = {
  /** The desktop's Svg, SMIL on and off, each on the ladder's rung that fits the cap, and that rung. */
  svg: string
  svgFlat: string
  rung: Rung
  rungFlat: Rung
  /** The Raster cells: the model's scene resampled into its box's cells. */
  cells: string
  /** The Image frame. */
  image: Frame
}

export function renders(s: Staged): Renders {
  const at = (smil: boolean) => ({ smil, now: s.now, width: 960, motion: 'full' as const })
  const fit = fitSvg(s.model, s.motions, at(true))
  const fitFlat = fitSvg(s.model, s.motions, at(false))
  return {
    svg: fit.svg,
    svgFlat: fitFlat.svg,
    rung: fit.rung,
    rungFlat: fitFlat.rung,
    cells: rasterCells(s.model),
    image: composeFrame(s.model, { numbers: true }),
  }
}

/** A model's Raster cells: its scene resampled into its box's cells, its numbers as text. */
function rasterCells(model: StageModel): string {
  const { frame, numbers } = intoCells(
    composeFrame(model, { numbers: false }),
    model.numbers,
    model.box,
  )
  return encodeRaster(frame, numbers)
}

export function goldenOf(r: Renders): Golden {
  return {
    rasterHash: fnv1a64(r.cells),
    imageHash: fnv1a64(encodeImage(r.image, 1).rgba),
    svgHash: fnv1a64(r.svg),
    svgChars: r.svg.length,
    rasterPairs: rasterPairs(r.cells),
  }
}

// The window strip's scenarios (UI PR 1, Task 8): the same fixtures, the band's strip under them.
export const STRIP_SCENARIOS = [
  'strip-rest',
  'strip-boss',
  'strip-world-boss',
  'strip-low-hp',
  'strip-compact',
  'strip-loot',
  'strip-world',
  'strip-notice',
  'strip-waiting',
  'strip-camping',
  'strip-compact-camping',
] as const
export type StripScenario = (typeof STRIP_SCENARIOS)[number]
export type StripGolden = {
  imageHash: string
  cellsHash: string
  svgHash: string
  svgChars: number
}

const WORLD: WorldState = {
  snapshot: {
    serverNow: NOW,
    speed: 1,
    online: 13,
    zones: [{ zone: 1, count: 13 }],
    here: ['Bea', 'Kit'],
    boss: null,
    hunt: null,
    chat: [],
    flags: { 'chat.enabled': true, 'presence.enabled': true },
  },
  fetchedAt: NOW,
  stale: false,
  messages: [{ id: 1, name: 'Kit', text: 'anyone farming zone 1?', at: NOW - 5000 }],
  chatMark: 1,
  clock: { serverNow: NOW, clientNow: NOW, speed: 1 },
  committedDealt: null,
}

/** A view, a timeline that has seen it, and a log holding two settled lines and one typing. */
function stripInput(
  view: GameView,
  patch: Partial<StripInput> = {},
  effects: Effect[] = [
    { k: 'act', actor: 'h1', action: 'attack', at: 0 },
    { k: 'hit', by: 'h1', target: view.enemies[0]?.id ?? 'e1', amount: 12 },
    { k: 'act', actor: view.enemies[0]?.id ?? 'e1', action: 'attack', at: 600 },
    { k: 'hit', by: view.enemies[0]?.id ?? 'e1', target: 'h1', amount: 5 },
    { k: 'act', actor: 'h2', action: 'attack', at: 1200 },
    { k: 'hit', by: 'h2', target: view.enemies[0]?.id ?? 'e1', amount: 9 },
  ],
): StripInput {
  const timeline = new StageTimeline()
  const gauges = new GaugeTrack()
  const log = new MessageLog()
  const t0 = NOW - 1300
  // `view` is the tick's end: before it, every actor held the HP the burst's hits took too.
  const taken = new Map<string, number>()
  for (const e of effects)
    if (e.k === 'hit') taken.set(e.target, (taken.get(e.target) ?? 0) + e.amount)
  const hp = <A extends { id: string; hp: number }>(a: A): A => ({
    ...a,
    hp: a.hp + (taken.get(a.id) ?? 0),
  })
  timeline.observe({ ...view, heroes: view.heroes.map(hp), enemies: view.enemies.map(hp) }, t0 - 1)
  const starts = timeline.onEffects(effects, t0, 2000)
  timeline.observe(view, NOW)
  log.onEffects(effects, starts, view, t0, 2000, timeline)
  return {
    view,
    world: WORLD,
    tab: 'party',
    kind: 'full',
    columns: 120,
    now: NOW,
    notice: null,
    scroll: null,
    motion: 'full',
    timeline,
    gauges,
    log,
    ...patch,
  }
}

export function strip(name: StripScenario): StripInput {
  switch (name) {
    case 'strip-rest':
      return stripInput(wave())
    case 'strip-boss':
      return stripInput(boss())
    case 'strip-world-boss': {
      const v = worldBoss()
      const world: WorldState = {
        ...WORLD,
        snapshot: {
          ...(WORLD.snapshot as NonNullable<WorldState['snapshot']>),
          boss: {
            bossId: 'wb1',
            name: 'The Promptwyrm',
            glyph: 'W',
            maxHp: 90000,
            hp: 55800,
            spawnedAt: NOW - 3_600_000,
            endsAt: NOW + 660_000,
            yours: 0,
          },
        },
      }
      return stripInput(v, { world })
    }
    case 'strip-low-hp': {
      const v = fallen()
      v.heroes = v.heroes.map((h) => (h.id === 'h1' ? { ...h, hp: 9 } : h))
      return stripInput(v)
    }
    case 'strip-compact':
      return stripInput(wave(), { kind: 'compact', columns: 110 })
    case 'strip-loot': {
      const v = wave()
      v.loot = [
        { text: '/ Iron Sword (epic)', rarity: 'epic', kind: 'drop', itemId: 'loot1' },
        { text: '[ Silk Robe (rare)', rarity: 'rare', kind: 'drop', itemId: 'loot2' },
      ]
      return stripInput(v, { kind: 'bare', tab: 'loot' })
    }
    case 'strip-world':
      return stripInput(wave(), { kind: 'bare', tab: 'world' })
    case 'strip-notice':
      return stripInput(wave(), {
        kind: 'bare',
        tab: 'loot',
        notice: 'Promptfall: server unreachable, retrying',
      })
    // Three on the field and four queued behind them, in a zone the party has fallen in once.
    case 'strip-waiting':
      return stripInput({ ...wave(), waiting: 4, zoneWipes: 1 })
    // The party camps: the encounter held with two queued behind it, the log's newest line the camp's.
    case 'strip-camping':
      return camping({})
    case 'strip-compact-camping':
      return camping({ kind: 'compact', columns: 110 })
  }
}

/** A camp made after the burst: its heal lands and the log says so, the encounter held. */
function camping(patch: Partial<StripInput>): StripInput {
  const v = { ...wave(), camping: true, waiting: 2 }
  const heals = v.heroes.map((h) => ({ heroId: h.id, amount: 0 }))
  return stripInput(v, patch, [
    { k: 'act', actor: 'h1', action: 'attack', at: 0 },
    { k: 'hit', by: 'h1', target: v.enemies[0]?.id ?? 'e1', amount: 12 },
    { k: 'camp', on: true, heals },
  ])
}

/**
 * The band's line characters the strip's font lacks, as the arms a terminal draws from the cell's
 * middle: left, right, up, down. `▬` is a gauge's bar.
 */
const LINE_ARMS: Readonly<Record<string, readonly [boolean, boolean, boolean, boolean]>> = {
  '─': [true, true, false, false],
  '│': [false, false, true, true],
  '╭': [false, true, false, true],
  '╮': [true, false, false, true],
  '╰': [false, true, true, false],
  '╯': [true, false, true, false],
  '├': [false, true, true, true],
  '┤': [true, false, true, true],
  '┬': [true, true, false, true],
  '┴': [true, true, true, false],
  '┼': [true, true, true, true],
}
const BAR = '▬'

/**
 * Raster cells as the terminal shows them, for eyeballing: each cell CELL_W × CELL_H pixels, a
 * half block its two halves, a line character its arms and a bar its middle rows, any other
 * character its background under its glyph in the strip's font; the terminal's default colour
 * transparent.
 */
export function cellsPicture(cells: string, columns: number): Frame {
  const bytes = decode(cells)
  const words = new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4)
  const rows = words.length / 3 / columns
  const width = columns * CELL_W
  const rgba = new Uint8ClampedArray(width * rows * CELL_H * 4)
  const fill = (x0: number, y0: number, h: number, rgb: number) => {
    if (rgb === CLEAR) return
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + CELL_W; x++) put(x, y, rgb)
    }
  }
  const put = (x: number, y: number, rgb: number) =>
    rgba.set([(rgb >>> 16) & 0xff, (rgb >>> 8) & 0xff, rgb & 0xff, 255], (y * width + x) * 4)
  const half = CELL_H / 2
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < columns; cx++) {
      const w = (cy * columns + cx) * 3
      const [ch, fg, bg] = [words[w] ?? 0x20, words[w + 1] ?? CLEAR, words[w + 2] ?? CLEAR]
      const [x0, y0] = [cx * CELL_W, cy * CELL_H]
      if (ch === 0x2580 || ch === 0x2584) {
        fill(x0, y0, half, ch === 0x2580 ? fg : bg)
        fill(x0, y0 + half, half, ch === 0x2580 ? bg : fg)
        continue
      }
      fill(x0, y0, CELL_H, bg)
      if (ch === 0x20) continue
      const char = String.fromCodePoint(ch)
      const arms = LINE_ARMS[char]
      if (arms || char === BAR) {
        const [mx, my] = [CELL_W / 2, CELL_H / 2]
        for (let gy = 0; gy < CELL_H; gy++) {
          for (let gx = 0; gx < CELL_W; gx++) {
            const on = arms
              ? (gy === my && ((arms[0] && gx <= mx) || (arms[1] && gx >= mx))) ||
                (gx === mx && ((arms[2] && gy <= my) || (arms[3] && gy >= my)))
              : gy >= my - 2 && gy <= my + 1
            if (on) put(x0 + gx, y0 + gy, fg)
          }
        }
        continue
      }
      const glyph = glyphFor(char)
      for (let gy = 0; gy < CELL_H; gy++) {
        for (let gx = 0; gx < CELL_W; gx++) {
          if ((glyph[gy] ?? 0) & (0x80 >> gx)) put(x0 + gx, y0 + gy, fg)
        }
      }
    }
  }
  return { width, height: rows * CELL_H, rgba }
}

/** Every window's picture, composed onto one canvas at its cells (transparent between). */
export function stripPicture(input: StripInput): Frame {
  const { scene } = stripScene(input)
  const width = scene.columns * CELL_W
  const height = scene.rows * CELL_H
  const rgba = new Uint8ClampedArray(width * height * 4)
  for (const win of scene.windows) {
    const f = windowFrame(win)
    for (let y = 0; y < f.height; y++) {
      const from = y * f.width * 4
      rgba.set(f.rgba.subarray(from, from + f.width * 4), (y * width + win.x * CELL_W) * 4)
    }
  }
  return { width, height, rgba }
}

export function stripSvgOf(input: StripInput): string {
  const { scene } = stripScene(input)
  return sceneSvg(scene, stripTracks(input, 3000), { smil: true, width: scene.columns * CELL_W })
}

export function stripGoldenOf(input: StripInput): StripGolden {
  const { scene } = stripScene(input)
  const image = encodeImage(stripPicture(input), WINDOW_SCALE)
  const svg = stripSvgOf(input)
  return {
    imageHash: fnv1a64(image.rgba),
    cellsHash: fnv1a64(sceneCells(scene)),
    svgHash: fnv1a64(svg),
    svgChars: svg.length,
  }
}

// The pane's scenarios (UI PR 2, Task 10): the Inventory and Heroes windows on the pane fixtures.
export const PANE_SCENARIOS = [
  'pane-inventory',
  'pane-inventory-actions',
  'pane-inventory-vendor',
  'pane-inventory-narrow',
  'pane-heroes',
  'pane-heroes-picks',
  'pane-sell',
  'pane-small',
  'pane-market',
  'pane-market-filter',
  'pane-market-buy',
  'pane-market-narrow',
  'pane-orders',
  'pane-orders-form',
  'pane-account',
  'pane-account-link',
  'pane-account-rest-days',
  'pane-odds',
  'pane-journal',
  'pane-journal-zone',
  'pane-chat',
  'pane-leaderboards',
  'pane-short',
  'pane-no-view',
] as const
export type PaneScenario = (typeof PANE_SCENARIOS)[number]
export type PaneGolden = StripGolden

function withDialog(
  patch: Partial<PaneInput['dialog']>,
  input: Partial<PaneInput> = {},
): PaneInput {
  const base = paneInput(input)
  return { ...base, dialog: { ...base.dialog, ...patch } }
}

export function pane(name: PaneScenario): PaneBuild {
  switch (name) {
    case 'pane-inventory':
      return inventoryPane(
        withDialog({ cursor: { inventory: { id: 'i2', index: 1 }, heroes: null } }),
      )
    case 'pane-inventory-actions':
      return inventoryPane(
        withDialog({
          menu: { kind: 'actions', tab: 'inventory', id: 'i2', at: 1 },
          cursor: { inventory: { id: 'i2', index: 1 }, heroes: null },
        }),
      )
    case 'pane-inventory-vendor':
      return inventoryPane(
        withDialog({
          menu: { kind: 'confirm', action: 'vendor', id: 'i2', at: 0 },
          cursor: { inventory: { id: 'i2', index: 1 }, heroes: null },
        }),
      )
    case 'pane-inventory-narrow':
      return inventoryPane(paneInput({ columns: 60 }))
    case 'pane-heroes':
      return heroesPane(paneInput({ tab: 'heroes' }))
    case 'pane-heroes-picks':
      return heroesPane(
        withDialog(
          { partyPick: ['h4', 'h5'], cursor: { inventory: null, heroes: { id: 'h4', index: 3 } } },
          { tab: 'heroes' },
        ),
      )
    case 'pane-sell':
      return inventoryPane(
        withDialog({
          sell: {
            kind: 'item',
            id: 'i2',
            matching: [
              {
                id: 'o1',
                base: 'silk_robe',
                name: 'Silk Robe',
                minRarity: 'rare',
                affix: null,
                maxPrice: 1200,
                expiresAt: 0,
              },
              {
                id: 'o2',
                base: 'silk_robe',
                name: 'Silk Robe',
                minRarity: 'rare',
                affix: null,
                maxPrice: 900,
                expiresAt: 0,
              },
            ],
            price: '1500',
            error: null,
            at: 0,
          },
        }),
      )
    case 'pane-small':
      return inventoryPane(paneInput({ columns: 36 }))
    case 'pane-market':
      return marketPane(market())
    case 'pane-market-filter':
      return marketPane(market({ menu: { kind: 'filter', at: 1 } }))
    case 'pane-market-buy':
      return marketPane(market({ menu: { kind: 'confirm', action: 'buy', id: 'L3', at: 0 } }))
    case 'pane-market-narrow':
      return marketPane(market({}, { columns: 60 }))
    case 'pane-orders':
      return ordersPane(
        withDialog({}, { tab: 'orders', orders: ordersMine(), remainingMs: (d) => d }),
      )
    case 'pane-orders-form':
      return ordersPane(
        withDialog(
          { formAt: 4 },
          {
            tab: 'orders',
            orders: {
              ...ordersMine(),
              form: {
                base: 'steel_longsword',
                minRarity: 'rare',
                affixId: 'keen',
                maxPrice: '1200',
              },
            },
          },
        ),
      )
    case 'pane-account':
      return accountPane(withDialog({}, { tab: 'account', journal: journalLoaded() }))
    case 'pane-account-rest-days':
      return accountPane(
        withDialog(
          {
            menu: { kind: 'rest_days', picked: [2], at: 3 },
            cursor: { account: { id: 'restdays', index: 4 } },
          },
          { tab: 'account', journal: journalLoaded() },
        ),
      )
    case 'pane-account-link':
      return accountPane(
        withDialog(
          {
            link: { code: 'ABCD1234', url: 'https://github.com/login/device' },
            cursor: { account: { id: 'reset', index: 5 } },
          },
          {
            tab: 'account',
            view: { ...paneView(), account: { ...paneView().account, linked: null } },
            journal: journalLoaded(),
          },
        ),
      )
    case 'pane-odds':
      return oddsPane(
        paneInput({
          tab: 'odds',
          view: { ...paneView(), nextInventoryCost: 500, nextRosterCost: 2000 },
        }),
      )
    case 'pane-journal':
    case 'pane-journal-zone':
      return journalPane({
        ...withDialog(
          name === 'pane-journal-zone' ? { menu: { kind: 'journal_zone', zone: 1, at: 6 } } : {},
          {
            tab: 'journal',
            view: {
              ...paneView(),
              zone: 2,
              highestZone: 3,
              tallies: {
                ...paneView().tallies,
                enemies: {
                  road_slime: { seen: 40, defeated: 31 },
                  field_rat: { seen: 12, defeated: 9 },
                },
              },
            },
            remainingMs: (deadline) => deadline - 70_000_000,
          },
        ),
        journal: journalLoaded(),
      })
    case 'pane-chat':
      return chatPane(
        paneInput({
          tab: 'chat',
          view: {
            ...paneView(),
            account: { ...paneView().account, chatOpen: true, server: 'http://fake' },
          },
          world: chatWorld(30),
        }),
      )
    case 'pane-leaderboards':
      return boardsPane(
        paneInput({
          tab: 'leaderboards',
          view: { ...paneView(), account: { ...paneView().account, leaderboardsOpen: true } },
          boards: boardsLoaded(),
        }),
      )
    case 'pane-short':
      return marketPane(market({}, { rows: 14 }))
    case 'pane-no-view': {
      const { tab, dialog, mode, readOnly, notice, columns, rows } = paneInput({ tab: 'account' })
      return noViewPane({
        tab,
        dialog,
        mode,
        readOnly,
        notice,
        columns,
        rows,
        server: 'in-process',
        hasGame: true,
        hasInput: true,
      })
    }
  }
}

/** The Market on the fixture page, listings expiring in 6 days. */
function market(
  patch: Partial<PaneInput['dialog']> = {},
  input: Partial<PaneInput> = {},
): PaneInput {
  return withDialog(patch, { tab: 'market', market: marketPage(), remainingMs: (d) => d, ...input })
}

/** Every window's picture, composed onto one canvas at its cells (transparent between). */
export function scenePicture(scene: Scene): Frame {
  const width = scene.columns * CELL_W
  const height = scene.rows * CELL_H
  const rgba = new Uint8ClampedArray(width * height * 4)
  for (const win of scene.windows) {
    const f = windowFrame(win)
    const top = (win.y ?? 0) * CELL_H
    for (let y = 0; y < f.height; y++) {
      const from = y * f.width * 4
      rgba.set(f.rgba.subarray(from, from + f.width * 4), ((top + y) * width + win.x * CELL_W) * 4)
    }
  }
  return { width, height, rgba }
}

export function paneSvgOf(build: PaneBuild): string {
  return sceneSvg(build.scene, [], { smil: false, width: build.scene.columns * CELL_W })
}

export function paneGoldenOf(build: PaneBuild): PaneGolden {
  const image = encodeImage(scenePicture(build.scene), WINDOW_SCALE)
  const svg = paneSvgOf(build)
  return {
    imageHash: fnv1a64(image.rgba),
    cellsHash: fnv1a64(sceneCells(build.scene)),
    svgHash: fnv1a64(svg),
    svgChars: svg.length,
  }
}

// The band's scenarios (spec #45): the band as one picture, the playfield on the shell; compact's
// small stage beside its window; on Loot and World the playfield is the strip alone.
export const BAND_SCENARIOS = [
  'band-rest',
  'band-wide',
  'band-zoomed',
  'band-zoomed-boss',
  'band-cropped',
  'band-compact',
  'band-compact-wide',
  'band-loot',
  'band-world',
  'band-waiting',
] as const
export type BandScenario = (typeof BAND_SCENARIOS)[number]
export type BandGolden = {
  imageHash: string
  cellsHash: string
  width: number
  height: number
  /** None on Loot and World: the strip's Svg is the whole band there. */
  stageSvgHash?: string
  stageSvgChars?: number
  stripSvgHash: string
  stripSvgChars: number
}
/**
 * What the band composer takes: the band's box, the stage's 1.5x frame (none on Loot and World),
 * the strip's scene; the Raster's band as cells, laid out as play lays it out, in `rasterBox` (the
 * same box, or compact's where the Raster goes compact under its zoom's floor); and the desktop's
 * band at the same size, its stage Svg and strip Svg.
 */
export type BandInput = {
  box: Box
  stage: Frame | null
  strip: Scene
  cells: string
  rasterBox: Box
  svg: { stage: string | null; strip: string }
}

/** `view` on a 160-column stage of `rows`, its strip under it, in a band of `columns` × `maxRows`. */
function bandInput(view: GameView, input: StripInput, columns: number, maxRows: number): BandInput {
  const t = new StageTimeline()
  t.observe(view, NOW)
  const rows = t.rowsAt(view, NOW)
  const layout = layoutFor(rows, { bodyColumns: columns, maxRows }, 'terminal', {
    tab: 'party',
    extra: 0,
    scalable: true,
  })
  if (layout.kind !== 'full') throw new Error(`a ${columns} × ${maxRows} band is not full`)
  const model = stageAt(view, t, NOW, layout.box, {
    compact: false,
    motion: 'full',
  })
  const playfield = Math.min(columns, STAGE_MAX_COLUMNS)
  const box = { columns, rows: layout.bandRows }
  const scene = stripScene({ ...input, columns: playfield }).scene
  return {
    box,
    stage: composeFrame(model, { numbers: true }),
    strip: scene,
    ...rasterBand(view, t, input, columns, maxRows),
    svg: bandSvgs(view, t, input, columns, maxRows),
  }
}

/**
 * The Raster's band at `columns` × `maxRows`, laid out as band.tsx lays it out: the sky cropped,
 * then the scene zoomed out down to the floor, then compact (#230).
 */
function rasterBand(
  view: GameView,
  t: StageTimeline,
  input: StripInput,
  columns: number,
  maxRows: number,
): { cells: string; rasterBox: Box } {
  const layout = layoutFor(t.rowsAt(view, NOW), { bodyColumns: columns, maxRows }, 'terminal', {
    tab: 'party',
    extra: 0,
    minRows: t.minRowsAt(view, NOW),
  })
  if (!layout.box) throw new Error(`a ${columns} × ${maxRows} Raster band has no stage`)
  const compact = layout.kind === 'compact'
  const rasterBox = { columns, rows: layout.bandRows }
  const scene = stripScene({
    ...input,
    kind: compact ? 'compact' : 'full',
    columns: Math.min(columns, compact ? STRIP_MAX_COLUMNS : STAGE_MAX_COLUMNS),
  }).scene
  return { cells: bandCells(view, t, NOW, layout, 'full', rasterBox, scene).cells, rasterBox }
}

/** The desktop's band at `columns` × `maxRows`: its stage Svg and its strip Svg, as band.tsx draws them. */
function bandSvgs(
  view: GameView,
  t: StageTimeline,
  input: StripInput,
  columns: number,
  maxRows: number,
): { stage: string; strip: string } {
  const props = { bodyColumns: columns, maxRows }
  const layout = layoutFor(t.rowsAt(view, NOW), props, 'desktop', { tab: 'party', extra: 0 })
  if (!layout.box) throw new Error('the desktop band has no stage')
  const width = columns * DESKTOP_COLUMN_PX_CEILING
  const strip = { ...input, columns: layout.box.columns }
  const { scene } = stripScene(strip)
  return {
    stage: stageSvg(view, t, NOW, layout.box, {
      smil: true,
      width,
      motion: 'full',
      fit: svgFit(props, layout.box, scene, 0),
    }),
    strip: sceneSvg(scene, stripTracks(strip, 3000), { smil: true, width, band: 'bottom' }),
  }
}

/**
 * Compact at `columns`: the 4-row stage beside its window inside one line on the shell, on the
 * Image and the Raster. The desktop never goes compact (ADR 0004): its Svgs are the band it draws
 * at the same size, the full stage fitted over the strip.
 */
function compactInput(view: GameView, input: StripInput, columns: number, maxRows = 22): BandInput {
  const t = new StageTimeline()
  t.observe(view, NOW)
  const props = { bodyColumns: columns, maxRows }
  const layout = layoutFor(t.rowsAt(view, NOW), props, 'terminal', {
    tab: 'party',
    extra: 0,
    scalable: true,
  })
  if (layout.kind !== 'compact') throw new Error(`a ${columns}-column band is not compact`)
  const box = { columns, rows: layout.bandRows }
  const scene = stripScene({
    ...input,
    kind: 'compact',
    columns: Math.min(columns, STRIP_MAX_COLUMNS),
  }).scene
  const model = stageAt(view, t, NOW, layout.box, { compact: true, motion: 'full' })
  return {
    box,
    stage: composeFrame(model, { numbers: true }),
    strip: scene,
    ...rasterBand(view, t, input, columns, maxRows),
    svg: bandSvgs(view, t, { ...input, kind: 'full' }, columns, box.rows),
  }
}

/** Loot or World at `columns`: the strip alone, the playfield as wide and centred as the Party tab's. */
function bareInput(input: StripInput, columns: number): BandInput {
  const terminal = layoutFor(0, { bodyColumns: columns, maxRows: 22 }, 'terminal', {
    tab: input.tab,
    extra: 0,
  })
  if (terminal.kind !== 'bare') throw new Error(`a ${columns}-column ${input.tab} band is not bare`)
  const box = { columns, rows: terminal.bandRows }
  const scene = stripScene({ ...input, columns: Math.min(columns, STAGE_MAX_COLUMNS) }).scene
  // The desktop lays the strip out at the stage's columns and scales it to the band's width.
  const desktop = {
    ...input,
    columns: Math.min(Math.max(columns, FULL_MIN_COLUMNS), STAGE_MAX_COLUMNS),
  }
  const width = columns * DESKTOP_COLUMN_PX_CEILING
  return {
    box,
    stage: null,
    strip: scene,
    cells: bandCells(input.view, input.timeline, NOW, terminal, 'full', box, scene).cells,
    rasterBox: box,
    svg: {
      stage: null,
      strip: sceneSvg(stripScene(desktop).scene, stripTracks(desktop, 3000), {
        smil: true,
        width,
        band: 'both',
      }),
    },
  }
}

export function band(name: BandScenario): BandInput {
  switch (name) {
    // The playfield fills the band: the line over the stage's outermost pixels.
    case 'band-rest':
      return bandInput(wave(), strip('strip-rest'), 160, 22)
    // Two columns of shell on the left, three on the right, the line in them.
    case 'band-wide':
      return bandInput(wave(), strip('strip-rest'), 165, 22)
    // A boss under a tall prompt: 12 rows, so the Image's widened scene shrinks into the 7 left,
    // and the Raster, under its 8-row floor, goes compact.
    case 'band-zoomed':
      return bandInput(boss(), strip('strip-boss'), 160, 12)
    // A zone boss on a 15-row band: 10 rows left, under its 17, so the Raster zooms the whole
    // scene out into them as the Image does (#230).
    case 'band-zoomed-boss':
      return bandInput(boss(), strip('strip-boss'), 160, 15)
    // A wave on a 13-row band: the Raster crops the sky to the 8 rows left at full size; the Image
    // zooms out.
    case 'band-cropped':
      return bandInput(wave(), strip('strip-rest'), 160, 13)
    // Compact at 110 columns, as strip-compact: the stage's 52 columns, the window's 58.
    case 'band-compact':
      return compactInput(wave(), strip('strip-compact'), 110)
    // Compact under a tall prompt at 170 columns: shell beside the playfield, the window's own right
    // line the line's, no second one in the margin.
    case 'band-compact-wide':
      return compactInput(wave(), strip('strip-compact'), 170, 7)
    // Loot at the Party tab's 160 columns: the line all round, over the windows' outer lines.
    case 'band-loot':
      return bareInput(strip('strip-loot'), 160)
    // World at 165, as band-wide: the playfield centred, the line in the shell beside it.
    case 'band-world':
      return bareInput(strip('strip-world'), 165)
    // Three on the field and four queued, a fall taken: the enemy window's `+4 waiting` footer and
    // the purse's falls row read through the band's bottom line.
    case 'band-waiting':
      return bandInput({ ...wave(), waiting: 4, zoneWipes: 1 }, strip('strip-waiting'), 160, 22)
  }
}

export function bandPicture(input: BandInput): Frame {
  return composeBand(input.box, input.stage, input.strip)
}

/** The band's bitmap, its PNG set in an Svg at twice its size, for eyeballing. */
export function bandSvgOf(input: BandInput): string {
  const pic = bandPicture(input)
  const { png } = pngImage(pic, WINDOW_SCALE)
  const [w, h] = [pic.width, pic.height]
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w * 2}" height="${h * 2}" viewBox="0 0 ${w} ${h}"><image width="${w}" height="${h}" style="image-rendering:pixelated" href="data:image/png;base64,${png}"/></svg>`
}

/** The desktop's two Svgs stacked as the desktop stacks them, the stage over the strip, for eyeballing. */
export function bandDesktopSvgOf(input: BandInput): string {
  if (input.svg.stage === null) return input.svg.strip
  const size = (doc: string) => {
    const m = doc.match(/^<svg [^>]*width="(\d+)" height="(\d+)"/)
    return { w: Number(m?.[1]), h: Number(m?.[2]) }
  }
  const a = size(input.svg.stage)
  const b = size(input.svg.strip)
  const strip = input.svg.strip.replace('<svg ', `<svg y="${a.h}" `)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${a.w}" height="${a.h + b.h}">${input.svg.stage}${strip}</svg>`
}

export function bandGoldenOf(input: BandInput): BandGolden {
  const image = encodeImage(bandPicture(input), WINDOW_SCALE)
  return {
    imageHash: fnv1a64(image.rgba),
    cellsHash: fnv1a64(input.cells),
    width: image.width,
    height: image.height,
    ...(input.svg.stage === null
      ? {}
      : { stageSvgHash: fnv1a64(input.svg.stage), stageSvgChars: input.svg.stage.length }),
    stripSvgHash: fnv1a64(input.svg.strip),
    stripSvgChars: input.svg.strip.length,
  }
}
