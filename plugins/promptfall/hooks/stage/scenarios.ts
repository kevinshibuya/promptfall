// The golden-frame scenarios, shared by golden.test.ts and scripts/stage-goldens.ts.
import type { GameView, WorldState } from '../../types'
import { accountPane, noViewPane } from '../ui/pane/account'
import { chatPane } from '../ui/pane/chat'
import {
  boardsLoaded,
  chatWorld,
  marketPage,
  ordersMine,
  paneInput,
  paneView,
} from '../ui/pane/fixtures'
import { heroesPane } from '../ui/pane/heroes'
import type { PaneInput } from '../ui/pane/input'
import { inventoryPane } from '../ui/pane/inventory'
import { boardsPane } from '../ui/pane/leaderboards'
import { marketPane } from '../ui/pane/market'
import { oddsPane } from '../ui/pane/odds'
import { ordersPane } from '../ui/pane/orders'
import type { PaneBuild } from '../ui/pane/types'
import { type StripInput, stripScene, stripTracks } from '../ui/strip'
import type { Effect } from '../vendor/sim.js'
import { windowFrame } from '../windows/image'
import type { Scene } from '../windows/kit'
import { sceneCells } from '../windows/raster'
import { sceneSvg } from '../windows/svg'
import { CELL_H, CELL_W, WINDOW_SCALE } from '../windows/tuning'
import { composeFrame, type Frame } from './compose'
import { boss, empty, fallen, wave, worldBoss } from './fixtures'
import { GaugeTrack } from './gauges'
import { fnv1a64 } from './hash'
import { encodeImage } from './image'
import type { Box } from './layout'
import { MessageLog } from './log'
import { type StageModel, stageAt } from './model'
import { encodeRaster, rasterPairs } from './raster'
import { renderSvg, svgWithFallback } from './svg'
import { type Motion, StageTimeline } from './timeline'
import { DISSOLVE_MS, DROP_MS, FLASH_MS, HIRES_SCALE, LUNGE_MS, SPAWN_MS } from './tuning'

export const GOLDEN_NOW = 1_000_000
export const SCENARIOS = [
  'rest',
  'boss',
  'compact',
  'dissolve',
  'drop',
  'windup',
  'strike',
  'follow',
  'bolt',
  'burst',
] as const
export type Scenario = (typeof SCENARIOS)[number]
export type Golden = {
  rasterHash: string
  imageHash: string
  svgHash: string
  svgChars: number
  rasterPairs: number
  /** The Image frame of the scale-1.5 model. */
  imageHashHires: string
  /** The scale-1 Svg: the desktop's fall-back past the cap. */
  svgHashLo: string
}
/** `model` at scale 1 (Raster); `hires` at HIRES_SCALE (Image, and the Svg under its cap). */
export type Staged = {
  model: StageModel
  hires: StageModel
  motions: readonly Motion[]
  now: number
}

const NOW = GOLDEN_NOW
const FULL: Box = { columns: 120, rows: 8 }
const item = {
  id: 'i1',
  base: 'iron_sword',
  rarity: 'epic' as const,
  affixes: [],
  equippedBy: null,
  tradeableAt: null,
}
const withoutFront = (): GameView => {
  const v = wave()
  v.enemies = v.enemies.filter((e) => e.id !== 'e1')
  return v
}

/** The scenario's models at scale 1 and at HIRES_SCALE, with its motions at NOW. */
function staged(view: GameView, t: StageTimeline, box: Box, compact = false): Staged {
  const opts = { compact, motion: 'full' as const }
  return {
    model: stageAt(view, t, NOW, box, opts),
    hires: stageAt(view, t, NOW, box, { ...opts, scale: HIRES_SCALE }),
    motions: t.active(NOW),
    now: NOW,
  }
}

/** A killing action on the slot-0 enemy at `t1`, a hit back on a hero 500 ms later, the kill observed right after. */
function killed(t1: number, effects: Effect[], box: Box): Staged {
  const t = new StageTimeline()
  t.observe(wave(), t1 - 1000)
  t.onEffects(effects, t1)
  const after = withoutFront()
  t.observe(after, t1 + 10)
  t.observe(after, NOW)
  return staged(after, t, box)
}

/** `actor` attacked the slot-0 enemy `ms` before NOW. */
function attacking(actor: string, ms: number): Staged {
  const t = new StageTimeline()
  t.observe(wave(), NOW - ms)
  t.onEffects(
    [
      { k: 'act', actor, action: 'attack', at: 0 },
      { k: 'hit', by: actor, target: 'e1', amount: 9 },
    ],
    NOW - ms,
  )
  t.observe(wave(), NOW)
  return staged(wave(), t, FULL)
}

export function stage(name: Scenario): Staged {
  const t = new StageTimeline()
  switch (name) {
    // The knight 60 ms into its action (winding up), at 180 (striking, the enemy hit), at 300
    // (following through); the black mage's fireball and the white mage's burst at 220.
    case 'windup':
      return attacking('h1', 60)
    case 'strike':
      return attacking('h1', 180)
    case 'follow':
      return attacking('h1', 300)
    case 'bolt':
      return attacking('h2', 220)
    case 'burst':
      return attacking('h3', 220)
    case 'rest': {
      t.observe(wave(), NOW)
      return staged(wave(), t, FULL)
    }
    case 'boss': {
      // The boss spawned half a spawn ago.
      t.observe(empty(), NOW - SPAWN_MS)
      t.observe(boss(), NOW - SPAWN_MS / 2)
      t.observe(boss(), NOW)
      const box = { columns: 120, rows: t.rowsAt(boss(), NOW) }
      return staged(boss(), t, box)
    }
    case 'compact': {
      t.observe(wave(), NOW)
      const box = { columns: 52, rows: 4 }
      return staged(wave(), t, box, true)
    }
    case 'dissolve': {
      // The dissolve starts when the kill's flash ends; at NOW it is half done.
      const t1 = NOW - (LUNGE_MS / 2 + FLASH_MS + DISSOLVE_MS / 2)
      return killed(
        t1,
        [
          { k: 'act', actor: 'h1', action: 'attack', at: 0 },
          { k: 'hit', by: 'h1', target: 'e1', amount: 42 },
          { k: 'act', actor: 'e2', action: 'attack', at: 500 },
          { k: 'hit', by: 'e2', target: 'h2', amount: 7 },
        ],
        FULL,
      )
    }
    case 'drop': {
      // The drop pops when the kill's flash ends; at NOW it is half done.
      const t1 = NOW - (LUNGE_MS / 2 + FLASH_MS + DROP_MS / 2)
      return killed(
        t1,
        [
          { k: 'act', actor: 'h1', action: 'attack', at: 0 },
          { k: 'hit', by: 'h1', target: 'e1', amount: 42 },
          { k: 'drop', item },
          { k: 'act', actor: 'e2', action: 'attack', at: 500 },
          { k: 'hit', by: 'e2', target: 'h2', amount: 7 },
        ],
        FULL,
      )
    }
  }
}

export function goldenOf(s: Staged): Golden {
  const cells = encodeRaster(composeFrame(s.model, { numbers: false }), s.model.numbers)
  const image = encodeImage(composeFrame(s.model, { numbers: true }), 1)
  const svg = svgOf(s)
  const hires = encodeImage(composeFrame(s.hires, { numbers: true }), 1)
  return {
    rasterHash: fnv1a64(cells),
    imageHash: fnv1a64(image.rgba),
    svgHash: fnv1a64(svg),
    svgChars: svg.length,
    rasterPairs: rasterPairs(cells),
    imageHashHires: fnv1a64(hires.rgba),
    svgHashLo: fnv1a64(
      renderSvg(s.model, s.motions, { smil: true, now: s.now, width: 960, motion: 'full' }),
    ),
  }
}

/** The desktop's Svg of the scenario: 1.5x, or 1x over the cap. */
export function svgOf(s: Staged): string {
  const opts = { smil: true, now: s.now, width: 960, motion: 'full' as const }
  return svgWithFallback(s.hires, s.model, s.motions, opts)
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
  timeline.observe(view, t0 - 1)
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
        { text: '/ Iron Sword (epic)', rarity: 'epic' },
        { text: '[ Silk Robe (rare)', rarity: 'rare' },
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
  }
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
  'pane-odds',
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
      return accountPane(withDialog({}, { tab: 'account' }))
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
