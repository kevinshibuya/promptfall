import type { GameView, MarketQuery, MarketState, WorldState } from '../../types'
import type { GameHandle } from '../engine'
import { content } from '../vendor/sim.js'
import { listingView } from '../view'
import { CLASS_LABEL, formatGold } from './format'
import { RARITY_COLOR } from './parts'
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

const PER_PAGE = 10
const ANY = 'any'

/** Syncs, then browses with `query`; any change of filter comes here with page 0. */
export async function loadMarket(
  game: GameHandle,
  query: MarketQuery,
  upd: Updater<MarketState>,
  after: After,
): Promise<void> {
  await upd((s) => ({ ...s, query, busy: true, confirm: null }))
  try {
    // The read expires what is due; the sync after it brings the returns and refunds home.
    const r = await game.market.browse(query)
    if ('reason' in r) throw new Error('Playing in another session')
    await game.sync()
    await upd((s) => ({
      ...s,
      busy: false,
      page: { listings: r.listings.map(listingView), page: r.page, total: r.total },
    }))
  } catch (error) {
    await upd((s) => ({ ...s, busy: false }))
    await flash(upd, after, errorText(error))
  }
}

/** Buys the listing waiting for confirmation, then syncs and refetches. */
export async function confirmBuy(
  game: GameHandle,
  market: MarketState,
  upd: Updater<MarketState>,
  after: After,
): Promise<void> {
  const id = market.confirm
  if (!id) return
  await upd((s) => ({ ...s, confirm: null, busy: true }))
  try {
    const r = await game.trade((client, auth) => client.buy(auth, id))
    if (!r.ok) await flash(upd, after, refusalText(r.reason))
  } catch (error) {
    await flash(upd, after, errorText(error))
  }
  await loadMarket(game, market.query, upd, after)
}

/** The query with one filter set, or cleared by `any`; back to page 0. */
function withFilter(q: MarketQuery, key: 'base' | 'cls' | 'minRarity', value: string): MarketQuery {
  const next: MarketQuery = { ...q, page: 0 }
  delete next[key]
  if (value !== ANY) (next as Record<string, unknown>)[key] = value
  return next
}

export type MarketActions = {
  /** Any filter change comes with page 0; the dialog refetches. */
  setQuery: (next: MarketQuery) => Promise<void>
  ask: (listingId: string | null) => Promise<void>
  confirm: () => Promise<void>
}

/** The Market tab: filters, ten listings, paging, and the buy confirmation. */
export function marketBody(
  els: Els,
  pick: PickFn,
  view: GameView,
  world: WorldState | null,
  market: MarketState,
  readOnly: boolean,
  actions: MarketActions,
) {
  const { Box, Text, Button } = els
  const q = market.query
  const body = []
  const gate = gateLine(view, world)
  body.push(
    <Box key="market-filters" flexDirection="row" gap={2}>
      <Button
        key="market-kind"
        label={q.kind === 'item' ? 'items' : 'heroes'}
        onPress={() =>
          actions.setQuery({
            kind: q.kind === 'item' ? 'hero' : 'item',
            sort: q.sort,
            page: 0,
            ...(q.minRarity ? { minRarity: q.minRarity } : {}),
          })
        }
      />
      <Button
        key="market-sort"
        label={q.sort === 'price' ? 'cheapest' : 'newest'}
        onPress={() =>
          actions.setQuery({ ...q, sort: q.sort === 'price' ? 'newest' : 'price', page: 0 })
        }
      />
      <Text dimColor>{market.busy ? 'loading…' : formatGold(view.gold)}</Text>
    </Box>,
  )
  if (q.kind === 'item') {
    const bases = Object.keys(content.itemBases)
      .sort()
      .map((id) => ({ value: id, label: content.itemBases[id]?.name ?? id }))
    body.push(
      pick(
        'market-base',
        'Base',
        [{ value: ANY, label: 'any' }, ...bases],
        (value) => actions.setQuery(withFilter(q, 'base', value)),
        q.base ?? ANY,
      ),
    )
  } else {
    const classes = Object.keys(CLASS_LABEL).map((c) => ({ value: c, label: CLASS_LABEL[c] ?? c }))
    body.push(
      pick(
        'market-cls',
        'Class',
        [{ value: ANY, label: 'any' }, ...classes],
        (value) => actions.setQuery(withFilter(q, 'cls', value)),
        q.cls ?? ANY,
      ),
    )
  }
  body.push(
    pick(
      'market-rarity',
      'Minimum rarity',
      [ANY, 'rare', 'epic', 'legendary'].map((r) => ({ value: r, label: r })),
      (value) => actions.setQuery(withFilter(q, 'minRarity', value)),
      q.minRarity ?? ANY,
    ),
  )
  if (gate)
    body.push(
      <Text key="market-gate" color="yellow">
        {gate}
      </Text>,
    )
  if (market.error) {
    body.push(
      <Text key="market-error" color="red" wrap="truncate">
        {market.error}
      </Text>,
    )
  }
  const confirming = market.page?.listings.find((l) => l.id === market.confirm)
  if (confirming) {
    body.push(
      <Box key="market-confirm" flexDirection="row" gap={2}>
        <Text bold>{`Buy ${confirming.name} for ${formatGold(confirming.price)}?`}</Text>
        <Button key="buy-confirm" label="confirm" hotkey="y" onPress={() => actions.confirm()} />
        <Button key="buy-cancel" label="cancel" hotkey="n" onPress={() => actions.ask(null)} />
      </Box>,
    )
  }
  const page = market.page
  if (!page) {
    body.push(
      <Text key="market-empty" dimColor>
        {market.busy ? 'Loading the market…' : 'Nothing loaded yet.'}
      </Text>,
    )
    return body
  }
  if (page.listings.length === 0) {
    body.push(
      <Text key="market-none" dimColor>
        No listings match.
      </Text>,
    )
  }
  for (const l of page.listings) {
    const mine = l.sellerId === view.accountId
    body.push(
      <Box key={`listing-${l.id}`} flexDirection="column">
        <Box key={`listing-name-${l.id}`} flexDirection="row" gap={1}>
          <Text color={RARITY_COLOR[l.rarity]} wrap="truncate">{`${l.name} (${l.rarity})`}</Text>
          <Text dimColor wrap="truncate">
            {l.detail}
          </Text>
        </Box>
        <Box key={`listing-meta-${l.id}`} flexDirection="row" gap={1} paddingLeft={2}>
          <Text wrap="truncate">{`${l.sellerName} · ${formatGold(l.price)}`}</Text>
          {mine ? (
            <Text dimColor>yours</Text>
          ) : readOnly || gate ? null : (
            <Button key={`buy-${l.id}`} label="buy" onPress={() => actions.ask(l.id)} />
          )}
        </Box>
      </Box>,
    )
  }
  const pages = Math.max(1, Math.ceil(page.total / PER_PAGE))
  body.push(
    <Box key="market-pages" flexDirection="row" gap={2}>
      {q.page > 0 ? (
        <Button
          key="market-prev"
          label="prev"
          onPress={() => actions.setQuery({ ...q, page: q.page - 1 })}
        />
      ) : null}
      <Text dimColor>{`page ${q.page + 1}/${pages} · ${page.total} listings`}</Text>
      {q.page + 1 < pages ? (
        <Button
          key="market-next"
          label="next"
          onPress={() => actions.setQuery({ ...q, page: q.page + 1 })}
        />
      ) : null}
    </Box>,
  )
  return body
}
