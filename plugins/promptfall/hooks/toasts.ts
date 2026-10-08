import type { GameView } from '../types'
import type { Cue } from './cues'
import { content, type Effect, type Goods, type Rarity } from './vendor/sim.js'
import { heroName, tradeName } from './view'

/** The everyday tier: the host's default, passed explicitly so a host change cannot move it. */
export const SHORT_MS = 4000
/** The weighty tier. */
export const LONG_MS = 8000

/** One row of spec §10's toast table. */
export type ToastRow =
  | 'legendary_drop'
  | 'recruit'
  | 'reward'
  | 'wipe'
  | 'world_boss_appeared'
  | 'revoked'
  | 'zone_arrival'
  | 'rare_drop'
  | 'vendored'
  | 'level_up'
  | 'sold'
  | 'bought'
  | 'returned'
  | 'world_boss_down'

/** A toast the primary raises: its row, its sentence, its tier's duration and its cue. */
export type Toast = {
  row: ToastRow
  text: string
  timeoutMs: typeof SHORT_MS | typeof LONG_MS
  cue: Cue | null
}

/** Names a burst's effects do not carry. */
export type ToastNames = { bossName: (bossId: string) => string | null }

/** What an effect row formats from: the effect, the view for hero names, the boss names. */
type EffectInput = { effect: Effect; view: GameView | null; names: ToastNames }

type Row<Input> = {
  purpose: 'rare good news' | 'wants a decision' | 'money moved'
  tier: 'short' | 'long'
  cue: Cue | null
  /** The row's single form, or null when the input is not this row's. */
  single: (input: Input) => string | null
  /** The folded form of two or more of the row's inputs in one burst; absent: the row never folds. */
  fold?: (inputs: Input[]) => string
  /** Splits the row's inputs into groups that fold apart, in stacking order. */
  split?: (inputs: Input[]) => Input[][]
}

const TIER_MS = { short: SHORT_MS, long: LONG_MS } as const

const RARE_OR_BETTER = new Set<Rarity>(['rare', 'epic', 'legendary'])

/** The rarity as a toast's first word: "Rare", "Epic". */
function rarityWord(rarity: Rarity): string {
  return rarity.charAt(0).toUpperCase() + rarity.slice(1)
}

/** "Aldric", "Aldric and Morwen", "Aldric, Morwen and Selene". */
function andList(names: string[]): string {
  const last = names.at(-1) ?? ''
  return names.length < 2 ? last : `${names.slice(0, -1).join(', ')} and ${last}`
}

/** A fold's name list: up to three names, then "and N more". */
function namesUpToThree(names: string[]): string {
  return names.length <= 3
    ? names.join(', ')
    : `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`
}

/** The gold an effect moved: a vendoring's, or a trade's. */
function goldOf(effect: Effect): number {
  if (effect.k === 'drop_vendored') return effect.gold
  return effect.k === 'traded' ? effect.entry.gold : 0
}

const goldSum = (inputs: EffectInput[]) => inputs.reduce((sum, i) => sum + goldOf(i.effect), 0)

function dropName(effect: Effect): string {
  return effect.k === 'drop' ? tradeName('item', effect.item.base) : ''
}

/**
 * Level-ups folded: each hero once at the highest level it reached, in effect order; one
 * sentence when all reached the same level, else one clause per hero.
 */
function foldLevels(inputs: EffectInput[]): string {
  const levels = new Map<string, number>()
  for (const { effect } of inputs) {
    if (effect.k !== 'level_up') continue
    levels.set(effect.heroId, Math.max(levels.get(effect.heroId) ?? 0, effect.level))
  }
  const view = inputs[0]?.view ?? null
  const heroes = [...levels].map(([id, level]) => ({
    name: heroNameById(view, id) ?? 'A hero',
    level,
  }))
  const first = heroes[0]
  if (heroes.every((h) => h.level === first?.level)) {
    return `${andList(heroes.map((h) => h.name))} reached level ${first?.level ?? 0}`
  }
  return heroes
    .map((h, i) => (i === 0 ? `${h.name} reached level ${h.level}` : `${h.name} level ${h.level}`))
    .join(', ')
}

/** Reward goods by name: an item by its base, a hero by its full name with the epithet. */
function goodsName(goods: Goods): string {
  return goods.kind === 'hero'
    ? heroName(goods.hero.template, goods.hero.epithet)
    : tradeName('item', goods.item.base)
}

/** Spec §10's table, row for row and in its order. */
const TABLE = {
  legendary_drop: {
    purpose: 'rare good news',
    tier: 'long',
    cue: 'legendary',
    single: ({ effect }: EffectInput) =>
      effect.k === 'drop' && effect.item.rarity === 'legendary'
        ? `Legendary drop: ${tradeName('item', effect.item.base)}`
        : null,
  },
  recruit: {
    purpose: 'rare good news',
    tier: 'long',
    cue: null,
    single: ({ effect }: EffectInput) =>
      effect.k === 'hero_recruited'
        ? `${rarityWord(effect.hero.rarity)} recruit: ${heroName(effect.hero.template, effect.hero.epithet)}`
        : null,
  },
  reward: {
    purpose: 'rare good news',
    tier: 'long',
    cue: null,
    single: ({ effect, names }: EffectInput) => {
      if (effect.k !== 'rewarded') return null
      const boss = names.bossName(effect.bossId) ?? 'the world boss'
      const goods = effect.goods ? ` and ${goodsName(effect.goods)}` : ''
      return `Your share of ${boss}: ${effect.gold} gold${goods}`
    },
  },
  wipe: {
    purpose: 'wants a decision',
    tier: 'long',
    cue: null,
    single: ({ effect }: EffectInput) =>
      effect.k === 'wipe' ? `The party fell, retreating to zone ${effect.retreatedTo}` : null,
  },
  world_boss_appeared: {
    purpose: 'rare good news',
    tier: 'long',
    cue: 'boss',
    single: (name: string) => `World boss ${name} has appeared`,
  },
  revoked: {
    purpose: 'wants a decision',
    tier: 'long',
    cue: null,
    single: (names: (string | null)[]) => {
      if (names.length === 0) return null
      if (names.length > 1) return `The server revoked ${names.length} items`
      return `The server revoked ${names[0] ?? 'an item'}`
    },
  },
  zone_arrival: {
    purpose: 'wants a decision',
    tier: 'short',
    cue: null,
    single: ({ effect }: EffectInput) => {
      // A farming clear stays in its zone: only an advance is an arrival.
      if (effect.k !== 'zone_cleared' || effect.advancedTo <= effect.zone) return null
      const name = content.zones[effect.advancedTo - 1]?.name
      return `The party reached zone ${effect.advancedTo}${name ? `, ${name}` : ''}`
    },
  },
  rare_drop: {
    purpose: 'rare good news',
    tier: 'short',
    cue: 'drop',
    single: ({ effect }: EffectInput) =>
      effect.k === 'drop' && (effect.item.rarity === 'rare' || effect.item.rarity === 'epic')
        ? `${rarityWord(effect.item.rarity)} drop: ${tradeName('item', effect.item.base)}`
        : null,
    // Epic outranks rare within the row, so its fold stacks first.
    split: (inputs: EffectInput[]) =>
      (['epic', 'rare'] as const).map((rarity) =>
        inputs.filter(({ effect }) => effect.k === 'drop' && effect.item.rarity === rarity),
      ),
    fold: (inputs: EffectInput[]) => {
      const rarity = inputs[0]?.effect.k === 'drop' ? inputs[0].effect.item.rarity : 'rare'
      const names = inputs.map((i) => dropName(i.effect))
      return `${inputs.length} ${rarity} drops: ${namesUpToThree(names)}`
    },
  },
  vendored: {
    purpose: 'wants a decision',
    tier: 'short',
    cue: null,
    // Rare or better: a full inventory vendors every drop, and only the loss of a keeper is news.
    single: ({ effect }: EffectInput) =>
      effect.k === 'drop_vendored' && RARE_OR_BETTER.has(effect.item.rarity)
        ? `Inventory full: ${tradeName('item', effect.item.base)} vendored for ${effect.gold} gold`
        : null,
    fold: (inputs: EffectInput[]) =>
      `Inventory full: ${inputs.length} items vendored for ${goldSum(inputs)} gold`,
  },
  level_up: {
    purpose: 'rare good news',
    tier: 'short',
    cue: 'level_up',
    single: ({ effect, view }: EffectInput) =>
      effect.k === 'level_up'
        ? `${heroNameById(view, effect.heroId) ?? 'A hero'} reached level ${effect.level}`
        : null,
    fold: foldLevels,
  },
  sold: {
    purpose: 'money moved',
    tier: 'short',
    cue: null,
    single: ({ effect }: EffectInput) =>
      effect.k === 'traded' && effect.entry.what === 'sold'
        ? `${tradeName(effect.entry.kind, effect.entry.base)} sold for ${effect.entry.gold} gold`
        : null,
    fold: (inputs: EffectInput[]) => `${inputs.length} items sold for ${goldSum(inputs)} gold`,
  },
  bought: {
    purpose: 'money moved',
    tier: 'short',
    cue: null,
    single: ({ effect }: EffectInput) =>
      effect.k === 'traded' && effect.entry.what === 'bought'
        ? `${tradeName(effect.entry.kind, effect.entry.base)} bought for ${effect.entry.gold} gold`
        : null,
    fold: (inputs: EffectInput[]) => `${inputs.length} items bought for ${goldSum(inputs)} gold`,
  },
  returned: {
    purpose: 'money moved',
    tier: 'short',
    cue: null,
    single: ({ effect }: EffectInput) =>
      effect.k === 'traded' && effect.entry.what === 'returned'
        ? `${tradeName(effect.entry.kind, effect.entry.base)} returned, unsold`
        : null,
    fold: (inputs: EffectInput[]) => `${inputs.length} items returned, unsold`,
  },
  world_boss_down: {
    purpose: 'rare good news',
    tier: 'short',
    cue: null,
    single: (name: string) => `World boss ${name} is down`,
  },
} satisfies Record<ToastRow, Row<EffectInput> | Row<string> | Row<(string | null)[]>>

/** The rows an effect raises, in the table's order. */
const EFFECT_ROWS = [
  'legendary_drop',
  'recruit',
  'reward',
  'wipe',
  'zone_arrival',
  'rare_drop',
  'vendored',
  'level_up',
  'sold',
  'bought',
  'returned',
] as const

type EffectRow = (typeof EFFECT_ROWS)[number]

function toast(row: ToastRow, text: string): Toast {
  const { tier, cue } = TABLE[row]
  return { row, text, timeoutMs: TIER_MS[tier], cue }
}

/** A roster hero's full name with its epithet, or null when the view has no such hero. */
export function heroNameById(view: GameView | null, heroId: string): string | null {
  return view?.roster.find((h) => h.id === heroId)?.name ?? null
}

/**
 * The toasts a burst raises, in the table's order. Effects group by row: a row that folds
 * gives one toast per group (a group of one in its single form), a row that never folds one
 * toast per effect. Nothing is held across bursts.
 */
export function toastsFor(effects: Effect[], view: GameView | null, names: ToastNames): Toast[] {
  const byRow = new Map<EffectRow, EffectInput[]>()
  for (const effect of effects) {
    const input = { effect, view, names }
    const row = EFFECT_ROWS.find((r) => TABLE[r].single(input) !== null)
    if (row) byRow.set(row, [...(byRow.get(row) ?? []), input])
  }
  return EFFECT_ROWS.flatMap((row) => {
    const entry: Row<EffectInput> = TABLE[row]
    const inputs = byRow.get(row) ?? []
    return (entry.split?.(inputs) ?? [inputs]).flatMap((group) =>
      entry.fold && group.length > 1
        ? [toast(row, entry.fold(group))]
        : group.map((input) => toast(row, entry.single(input) ?? '')),
    )
  })
}

/** The world boss transition's toast: its appearing, or its going down. */
export function worldToast(kind: 'appeared' | 'down', name: string): Toast {
  const row = kind === 'appeared' ? 'world_boss_appeared' : 'world_boss_down'
  return toast(row, TABLE[row].single(name))
}

/** The toast for items a batch ack revoked, named while their names are known; null for none. */
export function revokedToast(names: (string | null)[]): Toast | null {
  const text = TABLE.revoked.single(names)
  return text === null ? null : toast('revoked', text)
}
