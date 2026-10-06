import type { DialogState, GameView, ItemView, OrderView, SellState, WorldState } from '../../types'
import type { GameHandle } from '../engine'
import { orderView } from '../view'
import { type After, errorText, flash, gateLine, refusalText, type Updater } from './trade'

/** Preset prices where the surface has no Input: multiples of an item's shop value. */
export const ITEM_PRESETS = [2, 3, 5, 8]
export const HERO_PRESETS = [1000, 2500, 6000, 25_000]
const SLOTS = ['weapon', 'armour', 'accessory'] as const

/** Opens the sell panel; an item's matching buy orders load behind it. */
export async function openSell(
  game: GameHandle,
  kind: 'item' | 'hero',
  id: string,
  upd: Updater<DialogState>,
): Promise<void> {
  await upd((d) => ({ ...d, sell: { kind, id, matching: [], price: '', error: null, at: 0 } }))
  if (kind !== 'item') return
  try {
    // A fresh drop reaches the server with the next batch: flush it before asking what matches.
    await game.sync().catch(() => undefined)
    const r = await game.market.matching(id)
    if ('reason' in r) return
    const matching = r.map(orderView)
    await upd((d) => (d.sell?.id === id ? { ...d, sell: { ...d.sell, matching } } : d))
  } catch {
    // Reads fail quietly: the price form still works.
  }
}

/** Runs a sell-side trade; a refusal shows in the panel, a success closes it. */
export async function sellTrade(
  game: GameHandle,
  call: Parameters<GameHandle['trade']>[0],
  upd: Updater<SellState>,
  close: () => Promise<void>,
  after: After,
  remaining: string | undefined,
): Promise<void> {
  try {
    const r = await game.trade(call)
    if (!r.ok) {
      await flash(upd, after, refusalText(r.reason, remaining))
      return
    }
    await close()
    await game.sync()
  } catch (error) {
    await flash(upd, after, errorText(error))
  }
}

/** What the sell flow shows, as the panel and the sell window both decide it. */
export type SellPanel =
  | { kind: 'gone' }
  | { kind: 'gate'; name: string; rarity: string; line: string }
  | { kind: 'cooldown'; name: string; rarity: string; leftMs: number }
  | { kind: 'party'; name: string; rarity: string }
  | { kind: 'unequip'; name: string; rarity: string; heroId: string; slots: Slot[] }
  | {
      kind: 'price'
      name: string
      rarity: string
      item: ItemView | null
      /** An item's matching buy orders; a hero has none. */
      orders: OrderView[] | null
      /** The typed price: NaN while empty or not a whole number. */
      price: number
      presets: number[]
    }

export type Slot = (typeof SLOTS)[number]

/** The first that applies: gone, the market gate, the cooldown, in a party, unequip first, else the orders and the price. */
export function sellState(
  view: GameView,
  world: WorldState | null,
  sell: SellState,
  remainingMs: (deadline: number) => number,
): SellPanel {
  const item = sell.kind === 'item' ? view.inventory.find((i) => i.id === sell.id) : undefined
  const hero = sell.kind === 'hero' ? view.roster.find((h) => h.id === sell.id) : undefined
  if (!item && !hero) return { kind: 'gone' }
  const name = item?.name ?? hero?.name ?? sell.id
  const rarity = item?.rarity ?? hero?.rarity ?? 'common'
  const gate = gateLine(view, world)
  if (gate) return { kind: 'gate', name, rarity, line: gate }
  const tradeableAt = item?.tradeableAt ?? hero?.tradeableAt ?? null
  const left = tradeableAt === null ? 0 : remainingMs(tradeableAt)
  if (left > 0) return { kind: 'cooldown', name, rarity, leftMs: left }
  if (hero) {
    if (hero.inParty || hero.inPendingParty) return { kind: 'party', name, rarity }
    const worn = SLOTS.filter((slot) => hero.equipment[slot] !== null)
    if (worn.length > 0) return { kind: 'unequip', name, rarity, heroId: hero.id, slots: worn }
  }
  return {
    kind: 'price',
    name,
    rarity,
    item: item ?? null,
    orders: item ? sell.matching : null,
    price: /^\d+$/.test(sell.price) ? Number(sell.price) : Number.NaN,
    presets: item ? ITEM_PRESETS.map((m) => m * item.vendorValue) : HERO_PRESETS,
  }
}
