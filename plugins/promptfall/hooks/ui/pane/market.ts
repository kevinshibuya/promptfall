// The Market tab as windows (docs/plans/2026-10-06-ui-pr3-remaining-tabs.md, "Market"): the
// listings with their filter and page rows, the ▶ row's detail, the filter window and its picks,
// and the buy Yes/No.
import type {
  HeroClassName,
  ListingView,
  MarketQuery,
  PaneMenu,
  PickField,
  RarityName,
} from '../../../types'
import { spriteFor } from '../../sprites/index'
import { RARITY_RGB } from '../../stage/tuning'
import { content } from '../../vendor/sim.js'
import type { Line, Span } from '../../windows/kit'
import { DIM_RGB, MARKET_PER_PAGE, MOVE_HELP, TEXT_RGB, WARN_RGB } from '../../windows/tuning'
import { CLASS_LABEL, clip } from '../format'
import { wrap } from '../strip'
import { formatRemaining } from '../time'
import { gateLine } from '../trade'
import { cursorRow, hotkeySpans, type MenuItem } from './frame'
import type { MessageLine, PaneInput } from './input'
import { capital, gold, listInner, rowSpans } from './inventory'
import { type ListRow, type ListSpec, listPane } from './list'
import type { PaneAction, PaneBuild } from './types'

const SELLER_CELLS = 10
const PRICE_CELLS = 10
/** Under this inner width the seller column goes. */
const SELLER_MIN_INNER = 40
const ANY = 'any'
const MIN_RARITIES: readonly RarityName[] = ['rare', 'epic', 'legendary']

type MarketFilter = 'base' | 'cls' | 'minRarity'

/** The query with one filter set, or cleared by `any`; back to page 0. */
export function withFilter(q: MarketQuery, key: MarketFilter, value: string): MarketQuery {
  const next: MarketQuery = { ...q, page: 0 }
  delete next[key]
  if (value !== ANY) (next as Record<string, unknown>)[key] = value
  return next
}

/** The other kind: base and class drop, the minimum rarity stays (as today). */
function flipKind(q: MarketQuery): MarketQuery {
  return {
    kind: q.kind === 'item' ? 'hero' : 'item',
    sort: q.sort,
    page: 0,
    ...(q.minRarity ? { minRarity: q.minRarity } : {}),
  }
}

const baseName = (id: string) => content.itemBases[id]?.name ?? id
const sortWord = (q: MarketQuery) => (q.sort === 'price' ? 'cheapest' : 'newest')
const kindWord = (q: MarketQuery) => (q.kind === 'item' ? 'items' : 'heroes')

/** The search as the title says it: `items, Iron Sword, rare+, cheapest`. */
export function searchText(q: MarketQuery): string {
  const parts = [kindWord(q)]
  if (q.kind === 'item' && q.base) parts.push(baseName(q.base))
  if (q.kind === 'hero' && q.cls) parts.push(CLASS_LABEL[q.cls] ?? q.cls)
  if (q.minRarity) parts.push(`${q.minRarity}+`)
  parts.push(sortWord(q))
  return parts.join(', ')
}

/** The pick window's options for a filter: `any` first, then the values (sorted by id for bases). */
function pickOptions(field: MarketFilter): { value: string; label: string }[] {
  const any = { value: ANY, label: 'any' }
  if (field === 'base') {
    return [
      any,
      ...Object.keys(content.itemBases)
        .sort()
        .map((id) => ({ value: id, label: baseName(id) })),
    ]
  }
  if (field === 'cls') {
    return [any, ...Object.keys(CLASS_LABEL).map((c) => ({ value: c, label: CLASS_LABEL[c] ?? c }))]
  }
  return [any, ...MIN_RARITIES.map((r) => ({ value: r, label: r }))]
}

const current = (q: MarketQuery, field: MarketFilter): string => q[field] ?? ANY
const pickAt = (q: MarketQuery, field: MarketFilter) =>
  Math.max(
    0,
    pickOptions(field).findIndex((o) => o.value === current(q, field)),
  )
/** The filter window's row for a filter. */
const FILTER_ROW: Record<MarketFilter, number> = { base: 2, cls: 2, minRarity: 3 }
const PICK_QUESTION: Record<MarketFilter, string> = {
  base: 'Show which base?',
  cls: 'Show which class?',
  minRarity: 'Show which rarity at least?',
}
const PICK_HEADER: Record<MarketFilter, string> = {
  base: 'Base',
  cls: 'Class',
  minRarity: 'Rarity',
}
const isMarketFilter = (f: PickField): f is MarketFilter =>
  f === 'base' || f === 'cls' || f === 'minRarity'

type Command = MenuItem & { action: PaneAction }

function filterItems(q: MarketQuery): Command[] {
  const filter = (at: number): PaneMenu => ({ kind: 'filter', at })
  const pick = (field: MarketFilter): PaneAction => ({
    t: 'open',
    menu: { kind: 'pick', field, at: pickAt(q, field) },
  })
  const label = (field: MarketFilter) =>
    pickOptions(field).find((o) => o.value === current(q, field))?.label ?? ANY
  const byKind: MarketFilter = q.kind === 'item' ? 'base' : 'cls'
  return [
    { label: `Kind: ${kindWord(q)}`, action: { t: 'query', query: flipKind(q), menu: filter(0) } },
    {
      label: `Sort: ${sortWord(q)}`,
      action: {
        t: 'query',
        query: { ...q, sort: q.sort === 'price' ? 'newest' : 'price', page: 0 },
        menu: filter(1),
      },
    },
    { label: `${PICK_HEADER[byKind]}: ${label(byKind)}`, action: pick(byKind) },
    {
      label: `Rarity: ${q.minRarity ? `${q.minRarity}+` : ANY}`,
      action: pick('minRarity'),
    },
  ]
}

function pickItems(q: MarketQuery, field: MarketFilter): Command[] {
  return pickOptions(field).map((o) => ({
    label: o.label,
    action: {
      t: 'query',
      query: withFilter(q, field, o.value),
      menu: { kind: 'filter', at: FILTER_ROW[field] },
    },
  }))
}

const text = (t: string, rgb?: number): Line => ({
  spans: [{ gap: 1 }, { text: t, ...(rgb !== undefined ? { rgb } : {}) }],
})

/** `Rare weapon` or `Rare Knight`. */
function kindLine(l: ListingView): string {
  const what =
    l.kind === 'item'
      ? (content.itemBases[l.base ?? '']?.slot ?? 'item')
      : (CLASS_LABEL[l.cls ?? ''] ?? l.cls ?? 'hero')
  return `${capital(l.rarity)} ${what}`
}

function listingDetail(input: PaneInput, l: ListingView, inner: number): Line[] {
  const mine = l.sellerId === input.view.accountId
  return [
    {
      spans: [{ gap: 1 }, { text: clip(l.name, inner - 1), rgb: RARITY_RGB[l.rarity] ?? TEXT_RGB }],
      rule: true,
    },
    text(kindLine(l)),
    ...wrap(l.detail, inner - 1).map((t) => text(t)),
    { spans: [] },
    text(clip(mine ? 'Your listing' : `Seller ${l.sellerName}`, inner - 1)),
    text(`Price ${gold(l.price)}`),
    text(`Expires in ${formatRemaining(input.remainingMs(l.expiresAt))}`),
  ]
}

function pageLine(input: PaneInput): string {
  const page = input.market.page
  if (!page) return ''
  const pages = Math.max(1, Math.ceil(page.total / MARKET_PER_PAGE))
  return `Page ${input.market.query.page + 1} of ${pages} · ${page.total} listings`
}

function searchDetail(input: PaneInput): Line[] {
  const q = input.market.query
  const byKind =
    q.kind === 'item'
      ? `Base    ${q.base ? baseName(q.base) : ANY}`
      : `Class   ${q.cls ? (CLASS_LABEL[q.cls] ?? q.cls) : ANY}`
  return [
    { spans: [{ gap: 1 }, { text: 'Search' }], rule: true },
    text(`Kind    ${kindWord(q)}`),
    text(`Sort    ${sortWord(q)}`),
    text(byKind),
    text(`Rarity  ${q.minRarity ? `${q.minRarity}+` : ANY}`),
    { spans: [] },
    text(pageLine(input)),
  ]
}

export function marketPane(input: PaneInput): PaneBuild {
  const { view, market, dialog } = input
  const q = market.query
  const inner = listInner(input)
  const gate = gateLine(view, input.world)
  const art = input.art ? ({ gap: 2 } as Span) : null
  const control = (key: string, label: Span[], action: PaneAction, alt: string, hotkey?: string) =>
    ({
      key: `row:${key}`,
      ...(hotkey ? { hotkey } : {}),
      spans: rowSpans(inner, art, label, []),
      action,
      alt,
    }) satisfies ListRow

  const rows: ListRow[] = [
    control(
      'filters',
      hotkeySpans('Filters', 'f'),
      { t: 'open', menu: { kind: 'filter', at: 0 } },
      'Filters',
      'f',
    ),
  ]
  const page = market.page
  if (q.page > 0 && page) {
    rows.push(
      control(
        'prev',
        [{ text: 'Previous page' }],
        { t: 'query', query: { ...q, page: q.page - 1 }, menu: null },
        'Previous page',
      ),
    )
  }
  if (!page) {
    rows.push({
      spans: [{ text: market.busy ? 'Loading the market…' : 'Nothing loaded yet.', rgb: DIM_RGB }],
      alt: market.busy ? 'Loading the market' : 'Nothing loaded yet',
    })
  } else if (page.listings.length === 0) {
    rows.push({ spans: [{ text: 'No listings match.', rgb: DIM_RGB }], alt: 'No listings match' })
  }
  for (const l of page?.listings ?? []) {
    const mine = l.sellerId === view.accountId
    const seller = mine ? 'yours' : l.sellerName
    const columns = [
      ...(inner >= SELLER_MIN_INNER ? [{ text: seller, cells: SELLER_CELLS, rgb: DIM_RGB }] : []),
      { text: gold(l.price), cells: PRICE_CELLS },
    ]
    const sprite =
      l.kind === 'item' ? spriteFor('item', l.base ?? '') : spriteFor('hero', l.cls ?? '')
    rows.push({
      key: `row:${l.id}`,
      spans: rowSpans(
        inner,
        input.art ? { art: sprite.full } : null,
        { text: l.name, rgb: RARITY_RGB[l.rarity] ?? TEXT_RGB },
        columns,
      ),
      action:
        mine || input.readOnly || gate
          ? { t: 'none' }
          : { t: 'open', menu: { kind: 'confirm', action: 'buy', id: l.id, at: 0 } },
      alt: `${l.name}, ${l.rarity}, ${seller}, ${gold(l.price)}`,
    })
  }
  if (page && (q.page + 1) * MARKET_PER_PAGE < page.total) {
    rows.push(
      control(
        'next',
        [{ text: 'Next page' }],
        { t: 'query', query: { ...q, page: q.page + 1 }, menu: null },
        'Next page',
      ),
    )
  }

  const keyed = rows.flatMap((r) => (r.key ? [r.key.slice(4)] : []))
  const firstListing = keyed.findIndex((id) => id !== 'filters' && id !== 'prev' && id !== 'next')
  const saved = dialog.cursor.market ?? null
  const cursor = saved ? cursorRow(saved, keyed) : Math.max(0, firstListing)
  const onId = keyed[cursor]
  const onListing = page?.listings.find((l) => l.id === onId)

  const second = market.busy ? 'Loading the market…' : pageLine(input) ? `${pageLine(input)}.` : ''
  let state: [MessageLine, MessageLine]
  if (gate) state = [[{ text: gate, rgb: WARN_RGB }], 'Browsing still works.']
  else if (onListing?.sellerId === view.accountId) state = ['This listing is yours.', MOVE_HELP]
  else if (onListing) state = [`Enter: buy. ${MOVE_HELP}`, second]
  else if (onId === 'next') state = ['Enter: next page.', second]
  else if (onId === 'prev') state = ['Enter: previous page.', second]
  else state = ['Enter: change the search.', second]

  const spec: ListSpec = {
    title: [{ text: clip(`Market: ${searchText(q)} · ${gold(view.gold)}`, inner) }],
    altTitle: `Market: ${searchText(q)}, ${gold(view.gold)}`,
    rows,
    empty: 'Nothing loaded yet.',
    cursor,
    detail: onListing ? (w) => listingDetail(input, onListing, w) : () => searchDetail(input),
    menu: null,
    yesNo: null,
    panel: null,
    error: market.error,
    state,
    field: null,
    link: null,
  }

  const menu = dialog.menu
  if (menu?.kind === 'filter') {
    spec.menu = { header: [{ text: 'Filters' }], items: filterItems(q), at: menu.at }
    spec.state = ['Change the search.', 'q: back.']
  } else if (menu?.kind === 'pick' && isMarketFilter(menu.field)) {
    spec.menu = {
      header: [{ text: PICK_HEADER[menu.field] }],
      items: pickItems(q, menu.field),
      at: menu.at,
    }
    spec.state = [PICK_QUESTION[menu.field], 'q: back.']
  } else if (menu?.kind === 'confirm' && menu.action === 'buy' && !input.readOnly) {
    const l = page?.listings.find((x) => x.id === menu.id)
    if (l) {
      spec.yesNo = { at: menu.at, yes: { t: 'buy', listingId: l.id } }
      spec.state = [`Buy ${l.name} for ${gold(l.price)}?`, '']
      spec.detail = (w) => listingDetail(input, l, w)
    }
  }
  return listPane(input, spec)
}
