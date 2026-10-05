// The golden-frame scenarios, shared by golden.test.ts and scripts/stage-goldens.ts.
import type { GameView } from '../../types'
import type { Effect } from '../vendor/sim.js'
import { composeFrame } from './compose'
import { boss, empty, wave } from './fixtures'
import { fnv1a64 } from './hash'
import { encodeImage } from './image'
import type { Box } from './layout'
import { type StageModel, stageAt } from './model'
import { encodeRaster, rasterPairs } from './raster'
import { renderSvg } from './svg'
import { type Motion, StageTimeline } from './timeline'
import { DISSOLVE_MS, DROP_MS, FLASH_MS, LUNGE_MS, SPAWN_MS } from './tuning'

export const GOLDEN_NOW = 1_000_000
export const SCENARIOS = ['rest', 'boss', 'compact', 'dissolve', 'drop'] as const
export type Scenario = (typeof SCENARIOS)[number]
export type Golden = {
  rasterHash: string
  imageHash: string
  svgHash: string
  svgChars: number
  rasterPairs: number
}
export type Staged = { model: StageModel; motions: readonly Motion[]; now: number }

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

/** A killing hit on the slot-0 enemy at `t1`, a hit back on a hero, the kill observed right after. */
function killed(t1: number, effects: Effect[], box: Box): Staged {
  const t = new StageTimeline()
  t.observe(wave(), t1 - 1000)
  t.onEffects(effects, t1)
  const after = withoutFront()
  t.observe(after, t1 + 10)
  t.observe(after, NOW)
  return {
    model: stageAt(after, t, NOW, box, { compact: false, motion: 'full' }),
    motions: t.active(NOW),
    now: NOW,
  }
}

export function stage(name: Scenario): Staged {
  const t = new StageTimeline()
  switch (name) {
    case 'rest': {
      t.observe(wave(), NOW)
      return {
        model: stageAt(wave(), t, NOW, FULL, { compact: false, motion: 'full' }),
        motions: t.active(NOW),
        now: NOW,
      }
    }
    case 'boss': {
      // The boss spawned half a spawn ago.
      t.observe(empty(), NOW - SPAWN_MS)
      t.observe(boss(), NOW - SPAWN_MS / 2)
      t.observe(boss(), NOW)
      const box = { columns: 120, rows: t.rowsAt(boss(), NOW) }
      return {
        model: stageAt(boss(), t, NOW, box, { compact: false, motion: 'full' }),
        motions: t.active(NOW),
        now: NOW,
      }
    }
    case 'compact': {
      t.observe(wave(), NOW)
      const box = { columns: 52, rows: 4 }
      return {
        model: stageAt(wave(), t, NOW, box, { compact: true, motion: 'full' }),
        motions: t.active(NOW),
        now: NOW,
      }
    }
    case 'dissolve': {
      // The dissolve starts when the kill's flash ends; at NOW it is half done.
      const t1 = NOW - (LUNGE_MS / 2 + FLASH_MS + DISSOLVE_MS / 2)
      return killed(
        t1,
        [
          { k: 'hit', by: 'h1', target: 'e1', amount: 42 },
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
          { k: 'hit', by: 'h1', target: 'e1', amount: 42 },
          { k: 'drop', item },
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
  const svg = renderSvg(s.model, s.motions, { smil: true, now: s.now, width: 960, motion: 'full' })
  return {
    rasterHash: fnv1a64(cells),
    imageHash: fnv1a64(image.rgba),
    svgHash: fnv1a64(svg),
    svgChars: svg.length,
    rasterPairs: rasterPairs(cells),
  }
}

export function svgOf(s: Staged): string {
  return renderSvg(s.model, s.motions, { smil: true, now: s.now, width: 960, motion: 'full' })
}
