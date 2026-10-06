import type { GameView, OrdersState, RarityName, WorldState } from '../../types'
import type { GameHandle } from '../engine'
import { validPrice } from '../vendor/ledger.js'
import { content, type Item, vendorValue } from '../vendor/sim.js'
import { listingView, orderView } from '../view'
import { formatGold, type TextFit } from './format'
import { RARITY_COLOR } from './parts'
import { formatRemaining } from './time'
import {
  type After,
  type Els,
  errorText,
  flash,
  gateLine,
  type PickFn,
  refusalText,
  type Updater,
} from './trade'

const NONE = 'none'
/** Preset max prices where the surface has no Input: multiples of the base's vendor value. */
export const PRESETS = [2, 3, 5, 8]

/** Syncs, then loads this account's listings, orders and returns. */
export async function loadOrders(
  game: GameHandle,
  upd: Updater<OrdersState>,
  after: After,
): Promise<void> {
  await upd((s) => ({ ...s, busy: true }))
  try {
    // The read expires what is due; the sync after it brings the returns and refunds home.
    const r = await game.market.myOrders()
    if ('reason' in r) throw new Error('Playing in another session')
    await game.sync()
    await upd((s) => ({
      ...s,
      busy: false,
      mine: {
        listings: r.listings.map(listingView),
        orders: r.orders.map(orderView),
        returns: r.returns,
      },
    }))
  } catch (error) {
    await upd((s) => ({ ...s, busy: false }))
    await flash(upd, after, errorText(error))
  }
}

/** Runs a trade from the Orders tab; a refusal shows in red; then reloads. */
export async function ordersTrade(
  game: GameHandle,
  call: Parameters<GameHandle['trade']>[0],
  upd: Updater<OrdersState>,
  after: After,
): Promise<boolean> {
  let done = false
  try {
    const r = await game.trade(call)
    if (r.ok) done = true
    else await flash(upd, after, refusalText(r.reason))
  } catch (error) {
    await flash(upd, after, errorText(error))
  }
  await loadOrders(game, upd, after)
  return done
}

/**
 * Places the order form: one order at a time (Enter and Place order both submit), and only a
 * whole-number price; the form closes once the order is placed.
 */
export async function placeOrder(
  game: GameHandle,
  current: OrdersState,
  upd: Updater<OrdersState>,
  after: After,
): Promise<void> {
  const form = current.form
  if (current.busy || !form || !/^\d+$/.test(form.maxPrice)) return
  await upd((o) => ({ ...o, busy: true }))
  const input = {
    base: form.base,
    minRarity: form.minRarity,
    affixId: form.affixId,
    maxPrice: Number(form.maxPrice),
  }
  const done = await ordersTrade(game, (c, a) => c.placeOrder(a, input), upd, after)
  if (done) await upd((o) => ({ ...o, form: null }))
}

/** The rare vendor value of a base: what the presets multiply. */
export function baseValue(base: string, rarity: RarityName): number {
  const probe: Item = { id: 'p', base, rarity, affixes: [], equippedBy: null, tradeableAt: null }
  return vendorValue(probe)
}

export type OrdersActions = {
  cancelListing: (id: string) => Promise<void>
  cancelOrder: (id: string) => Promise<void>
  openForm: () => Promise<void>
  closeForm: () => Promise<void>
  setForm: (patch: Partial<NonNullable<OrdersState['form']>>) => Promise<void>
  submit: () => Promise<void>
}

/** The Orders tab: my listings, my buy orders, returns waiting, and the new order form. */
export function ordersBody(
  els: Els,
  pick: PickFn,
  view: GameView,
  world: WorldState | null,
  orders: OrdersState,
  readOnly: boolean,
  remainingMs: (deadline: number) => number,
  actions: OrdersActions,
  fit: TextFit = 'truncate',
) {
  const { Box, Text, Button, Input } = els
  const body = []
  const expires = (at: number) => `expires in ${formatRemaining(remainingMs(at))}`
  if (orders.error) {
    body.push(
      <Text key="orders-error" color="red" wrap={fit}>
        {orders.error}
      </Text>,
    )
  }
  const mine = orders.mine
  if (!mine) {
    body.push(
      <Text key="orders-empty" dimColor>
        {orders.busy ? 'Loading your orders…' : 'Nothing loaded yet.'}
      </Text>,
    )
    return body
  }
  if (mine.returns > 0) {
    body.push(<Text key="orders-returns" color="yellow">{`Returns waiting: ${mine.returns}`}</Text>)
  }
  body.push(
    <Text key="orders-listings-head" bold>
      My listings
    </Text>,
  )
  if (mine.listings.length === 0) {
    body.push(
      <Text key="orders-listings-none" dimColor>
        None.
      </Text>,
    )
  }
  for (const l of mine.listings) {
    body.push(
      <Box
        key={`my-listing-${l.id}`}
        flexDirection="row"
        flexWrap={fit === 'wrap' ? 'wrap' : undefined}
        gap={1}
      >
        <Text color={RARITY_COLOR[l.rarity]} wrap={fit}>{`${l.name} (${l.rarity})`}</Text>
        <Text wrap={fit}>{`${formatGold(l.price)} · ${expires(l.expiresAt)}`}</Text>
        {readOnly ? null : (
          <Button
            key={`cancel-listing-${l.id}`}
            label="cancel"
            onPress={() => actions.cancelListing(l.id)}
          />
        )}
      </Box>,
    )
  }
  body.push(
    <Text key="orders-orders-head" bold>
      My buy orders
    </Text>,
  )
  if (mine.orders.length === 0) {
    body.push(
      <Text key="orders-orders-none" dimColor>
        None.
      </Text>,
    )
  }
  for (const o of mine.orders) {
    const what = `${o.name} ${o.minRarity}+${o.affix ? ` with ${o.affix}` : ''}`
    body.push(
      <Box
        key={`my-order-${o.id}`}
        flexDirection="row"
        flexWrap={fit === 'wrap' ? 'wrap' : undefined}
        gap={1}
      >
        <Text color={RARITY_COLOR[o.minRarity]} wrap={fit}>
          {what}
        </Text>
        <Text wrap={fit}>{`up to ${formatGold(o.maxPrice)} · ${expires(o.expiresAt)}`}</Text>
        {readOnly ? null : (
          <Button
            key={`cancel-order-${o.id}`}
            label="cancel"
            onPress={() => actions.cancelOrder(o.id)}
          />
        )}
      </Box>,
    )
  }
  if (readOnly) return body
  const gate = gateLine(view, world)
  if (gate) {
    body.push(
      <Text key="orders-gate" color="yellow">
        {gate}
      </Text>,
    )
    return body
  }
  const form = orders.form
  if (!form) {
    body.push(
      <Box key="orders-new" flexDirection="row">
        <Button key="order-new" label="New order" onPress={() => actions.openForm()} />
      </Box>,
    )
    return body
  }
  const bases = Object.keys(content.itemBases)
    .sort()
    .map((id) => ({ value: id, label: content.itemBases[id]?.name ?? id }))
  const affixes = Object.keys(content.affixes)
    .sort()
    .map((id) => ({ value: id, label: content.affixes[id]?.name ?? id }))
  const price = /^\d+$/.test(form.maxPrice) ? Number(form.maxPrice) : Number.NaN
  const affixName = form.affixId
    ? (content.affixes[form.affixId]?.name ?? form.affixId)
    : 'any affix'
  body.push(
    <Text key="order-summary" bold wrap={fit}>
      {`New order: ${content.itemBases[form.base]?.name ?? form.base} ${form.minRarity}+ · ${affixName}${validPrice(price) ? ` · up to ${formatGold(price)}` : ''}`}
    </Text>,
  )
  body.push(
    pick('order-base', 'Base', bases, (value) => actions.setForm({ base: value }), form.base),
  )
  body.push(
    pick(
      'order-rarity',
      'Minimum rarity',
      ['rare', 'epic', 'legendary'].map((r) => ({ value: r, label: r })),
      (value) => actions.setForm({ minRarity: value as RarityName }),
      form.minRarity,
    ),
  )
  body.push(
    pick(
      'order-affix',
      'Affix',
      [{ value: NONE, label: 'none' }, ...affixes],
      (value) => actions.setForm({ affixId: value === NONE ? null : value }),
      form.affixId ?? NONE,
    ),
  )
  if (Input) {
    body.push(
      <Input
        key="order-price"
        label="max price"
        placeholder="gold"
        value={form.maxPrice}
        submitLabel="place"
        onInput={(text: string) => void actions.setForm({ maxPrice: text })}
        onSubmit={(text: string) => {
          void actions.setForm({ maxPrice: text }).then(() => actions.submit())
        }}
      />,
    )
  } else {
    const value = baseValue(form.base, form.minRarity)
    body.push(
      <Box key="order-presets" flexDirection="row" gap={1}>
        {PRESETS.map((m) => (
          <Button
            key={`order-preset-${m}`}
            label={formatGold(value * m)}
            onPress={() => actions.setForm({ maxPrice: String(value * m) })}
          />
        ))}
      </Box>,
    )
  }
  body.push(
    <Box key="order-buttons" flexDirection="row" gap={2}>
      {validPrice(price) && !orders.busy ? (
        <Button key="order-place" label="place" onPress={() => actions.submit()} />
      ) : null}
      <Button key="order-cancel" label="cancel" onPress={() => actions.closeForm()} />
    </Box>,
  )
  return body
}
