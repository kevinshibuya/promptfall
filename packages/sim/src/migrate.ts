import { content } from './content'
import { clone } from './draft'
import { clampHp } from './progression'
import type { GameState, Goods, Item } from './types'
import { SIM_VERSION } from './types'

// Saves migrate (ADR 0013): a stored state walks one step per version up to the current one.

/** A stored state of any version, in the shape its version had. */
export type VersionedState = { v: number } & Record<string, unknown>

export type Migration = {
  /** Rewrites a state of the step's version into the next one's shape. Pure on shape: it never reads the current rules. */
  state: (state: VersionedState) => VersionedState
  /**
   * Rewrites goods held outside the state: the ledger's market book, returns and server-event
   * log. Absent, the identity: a step names one only when an item or hero changed shape.
   */
  goods?: (goods: Goods) => Goods
}

/** One step per version, keyed by the version a step takes a state from. */
export type MigrationChain = Readonly<Record<number, Migration>>

export const MIGRATIONS: MigrationChain = {
  // 5 → 6: ratio mitigation, gentler enemy growth and the flatter xp curve. Stats are derived, so
  // every hero keeps its level and starts it again at 0 xp, a hero the ledger holds too; nothing
  // changes shape.
  5: {
    state: (s) => ({
      ...s,
      roster: (s.roster as Record<string, unknown>[]).map((h) => ({ ...h, xp: 0 })),
    }),
    goods: (g) => (g.kind === 'hero' ? { kind: 'hero', hero: { ...g.hero, xp: 0 } } : g),
  },
  // 6 → 7: a hero's rarity multiplies its base stats and growth. Stats are derived and the xp curve
  // is unchanged, so nothing changes shape and the xp is kept; the rule applies at read.
  6: { state: (s) => s },
  // 7 → 8: an item carries its tier, from its base. The flat roll is what an affix stores and the
  // tier scales it at read, so no roll changes; the items held outside the state gain it too.
  7: {
    state: (s) => ({ ...s, inventory: (s.inventory as Item[]).map(withBaseTier) }),
    goods: (g) => (g.kind === 'item' ? { kind: 'item', item: withBaseTier(g.item) } : g),
  },
  // 8 → 9: a wipe restarts the zone and the third is a retreat; rests heal 50%. The state gains
  // the count of wipes in its zone, at zero: no save remembers them, and zero only defers a retreat.
  8: { state: (s) => ({ ...s, zoneWipes: 0 }) },
  // 9 → 10: the auto-vendor setting. The state gains its flag, off: a save never sells a drop its
  // player did not ask to sell.
  9: { state: (s) => ({ ...s, autoVendor: false }) },
  // 10 → 11: zone 12's boss opens tier 2, and the ladder runs to zone 36. `zone` stays one running
  // number and every tier's numbers are derived from it, so nothing changes shape.
  10: { state: (s) => s },
  // 11 → 12: the arc retuned for the dedicated harness player (#151). Only content constants moved,
  // and every enemy's numbers are derived from them, so nothing changes shape.
  11: { state: (s) => s },
  // 12 → 13: boss contracts past tier 1 roll the tier's odds, and tier 2 ramps from zone 12 with no
  // step at its door (#152). Rules and content moved, and nothing changes shape.
  12: { state: (s) => s },
}

/** The 7 → 8 rule, frozen: a base's minimum zone 1 to 3 is tier 1, 10 to 12 tier 4. */
function withBaseTier(item: Item): Item {
  const minZone = content.itemBases[item.base]?.minZone ?? 1
  return { ...item, tier: Math.max(1, Math.ceil(minZone / 3)) }
}

export type MigrateOptions = { chain?: MigrationChain; to?: number }

export type MigrateRefusal =
  | { ok: false; reason: 'ahead'; from: number; to: number }
  /** `at` is the first version the chain has no step for. */
  | { ok: false; reason: 'gap'; from: number; to: number; at: number }

export type MigrateResult =
  | { ok: true; state: GameState; from: number; steps: number }
  | MigrateRefusal

function walk(from: number, to: number, chain: MigrationChain): Migration[] | MigrateRefusal {
  if (!Number.isInteger(from)) return { ok: false, reason: 'gap', from, to, at: from }
  if (from > to) return { ok: false, reason: 'ahead', from, to }
  const steps: Migration[] = []
  for (let v = from; v < to; v++) {
    const step = chain[v]
    if (!step) return { ok: false, reason: 'gap', from, to, at: v }
    steps.push(step)
  }
  return steps
}

/** Runs once at the chain's end, on the current rules. */
function finish(s: GameState): GameState {
  // The clear: outside boss mode no enemy fights on with the old rules' stats; the next tick spawns.
  if (!s.boss) {
    s.encounter = null
    s.battle = { gauges: [], queue: [], busy: 0 }
  }
  // The clamp: a hero stores no old maximum, so no share can be kept. It never heals, never kills.
  for (const hero of s.roster) clampHp(s, hero)
  return s
}

export function migrate(state: VersionedState, options: MigrateOptions = {}): MigrateResult {
  const { chain = MIGRATIONS, to = SIM_VERSION } = options
  const from = state.v
  const steps = walk(from, to, chain)
  if (!Array.isArray(steps)) return steps
  if (steps.length === 0) return { ok: true, state: state as unknown as GameState, from, steps: 0 }
  let current = clone(state)
  for (const [i, step] of steps.entries()) current = { ...step.state(current), v: from + i + 1 }
  return { ok: true, state: finish(current as unknown as GameState), from, steps: steps.length }
}

/** Walks goods stored at version `from` through each step's goods rule, as `migrate` walks a state. */
export function migrateGoods(
  goods: Goods,
  from: number,
  options: MigrateOptions = {},
): { ok: true; goods: Goods } | MigrateRefusal {
  const { chain = MIGRATIONS, to = SIM_VERSION } = options
  const steps = walk(from, to, chain)
  if (!Array.isArray(steps)) return steps
  let current = goods
  for (const step of steps) current = step.goods ? step.goods(clone(current)) : current
  return { ok: true, goods: current }
}
