import type { DialogState, GameView, ItemView, OrderView, SellState, WorldState } from '../../types'
import type { GameHandle } from '../engine'
import { listingFee, saleNet, validPrice } from '../vendor/ledger.js'
import { orderView } from '../view'
import { formatGold } from './format'
import { RARITY_COLOR } from './parts'
import { formatRemaining } from './time'
import {
  type After,
  type Els,
  errorText,
  flash,
  gateLine,
  refusalText,
  type Updater,
} from './trade'

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

export type SellActions = {
  close: () => Promise<void>
  setPrice: (text: string) => Promise<void>
  list: (price: number) => Promise<void>
  accept: (orderId: string, price: number) => Promise<void>
  unequip: (heroId: string, slot: (typeof SLOTS)[number]) => Promise<void>
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

/** The sell panel: matching orders first, then the price form with the fee and the net. */
export function sellBody(
  els: Els,
  view: GameView,
  world: WorldState | null,
  sell: SellState,
  remainingMs: (deadline: number) => number,
  actions: SellActions,
) {
  const { Box, Text, Button, Input } = els
  const body = []
  const panel = sellState(view, world, sell, remainingMs)
  const close = <Button key="sell-close" label="close" onPress={() => actions.close()} />
  if (panel.kind === 'gone') {
    body.push(
      <Box key="sell-gone" flexDirection="row" gap={2}>
        <Text dimColor>It is no longer yours.</Text>
        {close}
      </Box>,
    )
    return body
  }
  body.push(
    <Box key="sell-head" flexDirection="row" gap={2}>
      <Text bold color={RARITY_COLOR[panel.rarity]} wrap="truncate">
        {`Sell ${panel.name} (${panel.rarity})`}
      </Text>
      {close}
    </Box>,
  )
  if (sell.error) {
    body.push(
      <Text key="sell-error" color="red" wrap="truncate">
        {sell.error}
      </Text>,
    )
  }
  if (panel.kind === 'gate') {
    body.push(
      <Text key="sell-gate" color="yellow">
        {panel.line}
      </Text>,
    )
    return body
  }
  if (panel.kind === 'cooldown') {
    body.push(<Text key="sell-cooldown">{`Tradeable in ${formatRemaining(panel.leftMs)}`}</Text>)
    return body
  }
  if (panel.kind === 'party') {
    body.push(<Text key="sell-party">in party</Text>)
    return body
  }
  if (panel.kind === 'unequip') {
    body.push(
      <Box key="sell-unequip" flexDirection="row" gap={1}>
        <Text>unequip first</Text>
        {panel.slots.map((slot) => (
          <Button
            key={`sell-unequip-${slot}`}
            label={`unequip ${slot}`}
            onPress={() => actions.unequip(panel.heroId, slot)}
          />
        ))}
      </Box>,
    )
    return body
  }
  if (panel.orders) {
    body.push(
      <Text key="sell-matching" bold>
        Matching orders
      </Text>,
    )
    if (panel.orders.length === 0) {
      body.push(
        <Text key="sell-matching-none" dimColor>
          No buy orders match.
        </Text>,
      )
    }
    for (const order of panel.orders) {
      body.push(
        <Box key={`sell-order-${order.id}`} flexDirection="row" gap={1} paddingLeft={2}>
          <Button
            key={`accept-${order.id}`}
            label={`accept ${formatGold(order.maxPrice)}, you get ${formatGold(saleNet(order.maxPrice))}`}
            onPress={() => actions.accept(order.id, order.maxPrice)}
          />
        </Box>,
      )
    }
  }
  const price = panel.price
  body.push(
    <Text key="sell-list-head" bold>
      List for
    </Text>,
  )
  if (Input) {
    body.push(
      <Input
        key="sell-price"
        label="price"
        placeholder="gold"
        value={sell.price}
        submitLabel="list"
        onInput={(text: string) => void actions.setPrice(text)}
        onSubmit={(text: string) => {
          if (/^\d+$/.test(text) && validPrice(Number(text))) void actions.list(Number(text))
          else void actions.setPrice(text)
        }}
      />,
    )
  } else {
    body.push(
      <Box key="sell-presets" flexDirection="row" gap={1}>
        {panel.presets.map((p) => (
          <Button
            key={`sell-preset-${p}`}
            label={formatGold(p)}
            onPress={() => actions.setPrice(String(p))}
          />
        ))}
      </Box>,
    )
  }
  if (validPrice(price)) {
    body.push(
      <Box key="sell-quote" flexDirection="row" gap={2}>
        <Text>{`fee ${formatGold(listingFee(price))} · you get ${formatGold(saleNet(price))}`}</Text>
        <Button key="sell-list" label="list" onPress={() => actions.list(price)} />
      </Box>,
    )
  } else if (sell.price !== '') {
    body.push(
      <Text key="sell-bad" dimColor>
        A price from 1 to 1,000,000 gold
      </Text>,
    )
  }
  return body
}
