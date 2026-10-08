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
}

const TIER_MS = { short: SHORT_MS, long: LONG_MS } as const

const RARE_OR_BETTER = new Set<Rarity>(['rare', 'epic', 'legendary'])

/** The rarity as a toast's first word: "Rare", "Epic". */
function rarityWord(rarity: Rarity): string {
  return rarity.charAt(0).toUpperCase() + rarity.slice(1)
}

/** Reward goods by name: an item by its base, a hero by its template (as a trade names it). */
function goodsName(goods: Goods): string {
  return goods.kind === 'hero'
    ? tradeName('hero', goods.hero.template)
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
  },
  level_up: {
    purpose: 'rare good news',
    tier: 'short',
    cue: 'level_up',
    single: ({ effect, view }: EffectInput) =>
      effect.k === 'level_up'
        ? `${heroNameById(view, effect.heroId) ?? 'A hero'} reached level ${effect.level}`
        : null,
  },
  sold: {
    purpose: 'money moved',
    tier: 'short',
    cue: null,
    single: ({ effect }: EffectInput) =>
      effect.k === 'traded' && effect.entry.what === 'sold'
        ? `${tradeName(effect.entry.kind, effect.entry.base)} sold for ${effect.entry.gold} gold`
        : null,
  },
  bought: {
    purpose: 'money moved',
    tier: 'short',
    cue: null,
    single: ({ effect }: EffectInput) =>
      effect.k === 'traded' && effect.entry.what === 'bought'
        ? `${tradeName(effect.entry.kind, effect.entry.base)} bought for ${effect.entry.gold} gold`
        : null,
  },
  returned: {
    purpose: 'money moved',
    tier: 'short',
    cue: null,
    single: ({ effect }: EffectInput) =>
      effect.k === 'traded' && effect.entry.what === 'returned'
        ? `${tradeName(effect.entry.kind, effect.entry.base)} returned, unsold`
        : null,
  },
  world_boss_down: {
    purpose: 'rare good news',
    tier: 'short',
    cue: null,
    single: (name: string) => `World boss ${name} is down`,
  },
} satisfies Record<ToastRow, Row<never>>

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

function toast(row: ToastRow, text: string): Toast {
  const { tier, cue } = TABLE[row]
  return { row, text, timeoutMs: TIER_MS[tier], cue }
}

/** A roster hero's full name with its epithet, or null when the view has no such hero. */
export function heroNameById(view: GameView | null, heroId: string): string | null {
  return view?.roster.find((h) => h.id === heroId)?.name ?? null
}

/** The toasts a burst raises, one per effect that has a row, in effect order. */
export function toastsFor(effects: Effect[], view: GameView | null, names: ToastNames): Toast[] {
  const toasts: Toast[] = []
  for (const effect of effects) {
    for (const row of EFFECT_ROWS) {
      const text = TABLE[row].single({ effect, view, names })
      if (text !== null) {
        toasts.push(toast(row, text))
        break
      }
    }
  }
  return toasts
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
