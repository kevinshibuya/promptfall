import {
  type GameState,
  type Goods,
  type Hero,
  heroStats,
  type Item,
  RARITIES,
  type Rarity,
} from '@promptfall/sim'

export const DAY_MS = 86_400_000
export const WEEK_MS = 604_800_000
export const COOLDOWN_MS = DAY_MS
export const EXPIRY_MS = WEEK_MS
export const MIN_PRICE = 1
export const MAX_PRICE = 1_000_000

/** The listing fee, kept on cancel and expiry: 2%, at least 1 gold. */
export function listingFee(price: number): number {
  return Math.max(1, Math.floor((price * 200) / 10000))
}

/** The sale fee on listings and order fills: 5%, rounded down. */
export function saleFee(price: number): number {
  return Math.floor((price * 500) / 10000)
}

/** What the seller receives. */
export function saleNet(price: number): number {
  return price - saleFee(price)
}

export function validPrice(price: number): boolean {
  return Number.isInteger(price) && price >= MIN_PRICE && price <= MAX_PRICE
}

/** Rare and above trade. */
export function tradeableRarity(rarity: Rarity): boolean {
  return RARITIES.indexOf(rarity) >= RARITIES.indexOf('rare')
}

export function atLeast(rarity: Rarity, min: Rarity): boolean {
  return RARITIES.indexOf(rarity) >= RARITIES.indexOf(min)
}

/** The goods' base for logs and filters: the item base, or the hero template. */
export function goodsBase(goods: Goods): string {
  return goods.kind === 'item' ? goods.item.base : goods.hero.template
}

export function goodsRarity(goods: Goods): Rarity {
  return goods.kind === 'item' ? goods.item.rarity : goods.hero.rarity
}

export function goodsId(goods: Goods): string {
  return goods.kind === 'item' ? goods.item.id : goods.hero.id
}

/**
 * Goods changing owner: a fresh `t` id unless they already carry one, the
 * cooldown from `now`, and a hero reset to level 1, no XP, full level-1 HP,
 * nothing worn. A returned listing never comes through here.
 */
export async function transfer(
  goods: Goods,
  now: number,
  nextId: () => Promise<string>,
  receiver: GameState,
): Promise<Goods> {
  const tradeableAt = now + COOLDOWN_MS
  if (goods.kind === 'item') {
    const id = goods.item.id.startsWith('t') ? goods.item.id : await nextId()
    const item: Item = { ...goods.item, id, equippedBy: null, tradeableAt }
    return { kind: 'item', item }
  }
  const id = goods.hero.id.startsWith('t') ? goods.hero.id : await nextId()
  const hero: Hero = {
    ...goods.hero,
    id,
    level: 1,
    xp: 0,
    equipment: { weapon: null, armour: null, accessory: null },
    tradeableAt,
  }
  hero.hp = heroStats(receiver, hero).hp
  return { kind: 'hero', hero }
}
