import type { DialogState, GameView, SellState } from '../../types'
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

const ITEM_PRESETS = [2, 3, 5, 8]
const HERO_PRESETS = [1000, 2500, 6000, 25_000]
const SLOTS = ['weapon', 'armour', 'accessory'] as const

/** Opens the sell panel; an item's matching buy orders load behind it. */
export async function openSell(
  game: GameHandle,
  kind: 'item' | 'hero',
  id: string,
  upd: Updater<DialogState>,
): Promise<void> {
  await upd((d) => ({ ...d, sell: { kind, id, matching: [], price: '', error: null } }))
  if (kind !== 'item') return
  try {
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

/** The sell panel: matching orders first, then the price form with the fee and the net. */
export function sellBody(
  els: Els,
  view: GameView,
  sell: SellState,
  remainingMs: (deadline: number) => number,
  actions: SellActions,
) {
  const { Box, Text, Button, Input } = els
  const body = []
  const item = sell.kind === 'item' ? view.inventory.find((i) => i.id === sell.id) : undefined
  const hero = sell.kind === 'hero' ? view.roster.find((h) => h.id === sell.id) : undefined
  const close = <Button key="sell-close" label="close" onPress={() => actions.close()} />
  if (!item && !hero) {
    body.push(
      <Box key="sell-gone" flexDirection="row" gap={2}>
        <Text dimColor>It is no longer yours.</Text>
        {close}
      </Box>,
    )
    return body
  }
  const name = item?.name ?? hero?.name ?? sell.id
  const rarity = item?.rarity ?? hero?.rarity ?? 'common'
  body.push(
    <Box key="sell-head" flexDirection="row" gap={2}>
      <Text bold color={RARITY_COLOR[rarity]} wrap="truncate">{`Sell ${name} (${rarity})`}</Text>
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
  const gate = gateLine(view)
  if (gate) {
    body.push(
      <Text key="sell-gate" color="yellow">
        {gate}
      </Text>,
    )
    return body
  }
  const tradeableAt = item?.tradeableAt ?? hero?.tradeableAt ?? null
  const left = tradeableAt === null ? 0 : remainingMs(tradeableAt)
  if (left > 0) {
    body.push(<Text key="sell-cooldown">{`Tradeable in ${formatRemaining(left)}`}</Text>)
    return body
  }
  if (hero) {
    if (hero.inParty || hero.inPendingParty) {
      body.push(<Text key="sell-party">in party</Text>)
      return body
    }
    const worn = SLOTS.filter((slot) => hero.equipment[slot] !== null)
    if (worn.length > 0) {
      body.push(
        <Box key="sell-unequip" flexDirection="row" gap={1}>
          <Text>unequip first</Text>
          {worn.map((slot) => (
            <Button
              key={`sell-unequip-${slot}`}
              label={`unequip ${slot}`}
              onPress={() => actions.unequip(hero.id, slot)}
            />
          ))}
        </Box>,
      )
      return body
    }
  }
  if (item) {
    body.push(
      <Text key="sell-matching" bold>
        Matching orders
      </Text>,
    )
    if (sell.matching.length === 0) {
      body.push(
        <Text key="sell-matching-none" dimColor>
          No buy orders match.
        </Text>,
      )
    }
    for (const order of sell.matching) {
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
  const price = /^\d+$/.test(sell.price) ? Number(sell.price) : Number.NaN
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
    const presets = item ? ITEM_PRESETS.map((m) => m * item.vendorValue) : HERO_PRESETS
    body.push(
      <Box key="sell-presets" flexDirection="row" gap={1}>
        {presets.map((p) => (
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
