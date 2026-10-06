// The Orders tab as windows (docs/plans/2026-10-06-ui-pr3-remaining-tabs.md, "Orders"): your
// listings and buy orders under their headings, the ▶ row's detail, the cancel Yes/No, and the new
// buy order form in the detail window's place, with its base, rarity and affix picks.
import type { ListingView, OrdersState, OrderView, PickField, RarityName } from '../../../types'
import { RARITY_RGB } from '../../stage/tuning'
import { validPrice } from '../../vendor/ledger.js'
import { content } from '../../vendor/sim.js'
import type { Line } from '../../windows/kit'
import { DIM_RGB, MOVE_HELP, TEXT_RGB, WARN_RGB } from '../../windows/tuning'
import { clip } from '../format'
import { baseValue, PRESETS } from '../orders'
import { wrap } from '../strip'
import { formatRemaining } from '../time'
import { gateLine } from '../trade'
import { cursorRow, type MenuItem, menuWindow, type Rect } from './frame'
import type { MessageLine, PaneInput } from './input'
import { capital, gold, listInner, rowSpans } from './inventory'
import { type ListRow, type ListSpec, listPane, type PanelBuild } from './list'
import { kindLine } from './market'
import type { PaneAction, PaneBuild, PaneField, Stop } from './types'

type Form = NonNullable<OrdersState['form']>
type Command = MenuItem & { action: PaneAction }
type OrderPick = 'orderBase' | 'orderRarity' | 'orderAffix'

const PRICE_CELLS = 10
const MAX_CELLS = 11
const ANY = 'any'
const MIN_RARITIES: readonly RarityName[] = ['rare', 'epic', 'legendary']
/** Today's new order: a rare Steel Longsword, any affix, no price yet. */
export const NEW_ORDER: Form = {
  base: 'steel_longsword',
  minRarity: 'rare',
  affixId: null,
  maxPrice: '',
}

const baseName = (id: string) => content.itemBases[id]?.name ?? id
const affixName = (id: string) => content.affixes[id]?.name ?? id
const priceOf = (form: Form) => (/^\d+$/.test(form.maxPrice) ? Number(form.maxPrice) : Number.NaN)
const isOrderPick = (f: PickField): f is OrderPick =>
  f === 'orderBase' || f === 'orderRarity' || f === 'orderAffix'

const text = (t: string, inner: number, rgb?: number): Line => ({
  spans: [{ gap: 1 }, { text: clip(t, inner - 1), ...(rgb !== undefined ? { rgb } : {}) }],
})
const head = (t: string, inner: number, rgb = TEXT_RGB): Line => ({
  spans: [{ gap: 1 }, { text: clip(t, inner - 1), rgb }],
  rule: true,
})

function listingDetail(input: PaneInput, l: ListingView, inner: number): Line[] {
  return [
    head(l.name, inner, RARITY_RGB[l.rarity] ?? TEXT_RGB),
    text(kindLine(l), inner),
    ...wrap(l.detail, inner - 1).map((t) => text(t, inner)),
    { spans: [] },
    text(`Listed for ${gold(l.price)}`, inner),
    text(`Expires in ${formatRemaining(input.remainingMs(l.expiresAt))}`, inner),
  ]
}

function orderDetail(input: PaneInput, o: OrderView, inner: number): Line[] {
  return [
    head('Buy order', inner),
    text(o.name, inner),
    text(`${capital(o.minRarity)} or better`, inner),
    text(o.affix ? `With ${o.affix}` : 'Any affix', inner),
    text(`Up to ${gold(o.maxPrice)}, held`, inner),
    text(`Expires in ${formatRemaining(input.remainingMs(o.expiresAt))}`, inner),
  ]
}

function newOrderDetail(inner: number): Line[] {
  return [
    head('New buy order', inner),
    ...wrap('Gold is held until the order fills or you cancel it.', inner - 1).map((t) =>
      text(t, inner),
    ),
  ]
}

/** The pick's options: bases by name (sorted by id), the rarities, `any` then the affixes. */
function pickOptions(field: OrderPick): { value: string | null; label: string }[] {
  if (field === 'orderBase') {
    return Object.keys(content.itemBases)
      .sort()
      .map((id) => ({ value: id, label: baseName(id) }))
  }
  if (field === 'orderRarity') return MIN_RARITIES.map((r) => ({ value: r, label: r }))
  return [
    { value: null, label: ANY },
    ...Object.keys(content.affixes)
      .sort()
      .map((id) => ({ value: id, label: affixName(id) })),
  ]
}
const currentOf = (form: Form, field: OrderPick): string | null =>
  field === 'orderBase' ? form.base : field === 'orderRarity' ? form.minRarity : form.affixId
const pickAt = (form: Form, field: OrderPick) =>
  Math.max(
    0,
    pickOptions(field).findIndex((o) => o.value === currentOf(form, field)),
  )
const PICK_HEADER: Record<OrderPick, string> = {
  orderBase: 'Base',
  orderRarity: 'Rarity',
  orderAffix: 'Affix',
}
const PICK_QUESTION: Record<OrderPick, string> = {
  orderBase: 'Which base?',
  orderRarity: 'Which rarity at least?',
  orderAffix: 'Which affix?',
}

function pickItems(form: Form, field: OrderPick): Command[] {
  return pickOptions(field).map((o) => {
    const patch: Partial<Form> =
      field === 'orderBase'
        ? { base: o.value ?? form.base }
        : field === 'orderRarity'
          ? { minRarity: (o.value as RarityName | null) ?? form.minRarity }
          : { affixId: o.value }
    return { label: o.label, action: { t: 'form', form: { ...form, ...patch }, menu: null } }
  })
}

/** The form's items: the three picks, the price (a field, or presets), then Place order. */
function formItems(input: PaneInput, form: Form): Command[] {
  const pick = (field: OrderPick): PaneAction => ({
    t: 'open',
    menu: { kind: 'pick', field, at: pickAt(form, field) },
  })
  const price = priceOf(form)
  const items: Command[] = [
    { label: `Base: ${baseName(form.base)}`, action: pick('orderBase') },
    { label: `Rarity: ${form.minRarity}+`, action: pick('orderRarity') },
    { label: `Affix: ${form.affixId ? affixName(form.affixId) : ANY}`, action: pick('orderAffix') },
  ]
  if (input.hasInput) {
    items.push({
      label: validPrice(price) ? `Price: ${gold(price)}` : 'Set a price',
      action: { t: 'field', key: 'order-price' },
    })
  } else {
    const value = baseValue(form.base, form.minRarity)
    for (const m of PRESETS) {
      items.push({
        label: gold(value * m),
        action: { t: 'form', form: { ...form, maxPrice: String(value * m) }, menu: null },
      })
    }
  }
  const ready = validPrice(price) && !input.orders.busy
  items.push(
    ready
      ? { label: 'Place order', action: { t: 'place' } }
      : { label: 'Place order', rgb: DIM_RGB, action: { t: 'none' } },
  )
  return items
}

function formState(form: Form): [MessageLine, MessageLine] {
  const price = priceOf(form)
  const affix = form.affixId ? `with ${affixName(form.affixId)}` : 'any affix'
  if (validPrice(price)) {
    return [
      `Buy order: ${baseName(form.base)} ${form.minRarity}+, ${affix}, up to ${gold(price)}.`,
      'q: back.',
    ]
  }
  if (form.maxPrice !== '') return ['A price from 1 to 1,000,000 gold', 'q: back.']
  return ['Pick what to buy, then a price.', 'q: back.']
}

/** The order form, a panel in the detail window's place; its ▶ is `dialog.formAt`. */
function formPanel(input: PaneInput, form: Form, rect: Rect): PanelBuild {
  const items = formItems(input, form)
  const at = Math.max(0, Math.min(items.length - 1, input.dialog.formAt))
  const win = menuWindow({
    key: 'form',
    ...rect,
    header: [{ text: 'New buy order' }],
    items,
    at,
  })
  const stops: Stop[] = items.map((item, i) => ({
    key: `menu:${i}`,
    action: item.action,
    cursor: true,
    index: i,
  }))
  const field: PaneField | null = input.hasInput
    ? {
        key: 'order-price',
        label: 'max price',
        placeholder: 'gold',
        value: form.maxPrice,
        submitLabel: 'place',
      }
    : null
  return { win, stops, at, state: formState(form), field }
}

export function ordersPane(input: PaneInput): PaneBuild {
  const { view, orders, dialog } = input
  const inner = listInner(input)
  const gate = gateLine(view, input.world)
  const mine = orders.mine
  const rows: ListRow[] = []
  const none = (): ListRow => ({ spans: [{ text: 'None.', rgb: DIM_RGB }], alt: 'None' })
  const heading = (t: string): ListRow => ({ spans: [{ text: t }], rule: true, alt: t })
  if (!mine) {
    const t = orders.busy ? 'Loading your orders…' : 'Nothing loaded yet.'
    rows.push({ spans: [{ text: t, rgb: DIM_RGB }], alt: t })
  } else {
    if (mine.returns > 0) {
      const t = `Returns waiting: ${mine.returns}`
      rows.push({ spans: [{ text: t, rgb: WARN_RGB }], alt: t })
    }
    rows.push(heading('My listings'))
    if (mine.listings.length === 0) rows.push(none())
    for (const l of mine.listings) {
      rows.push({
        key: `row:l-${l.id}`,
        spans: rowSpans(inner, null, { text: l.name, rgb: RARITY_RGB[l.rarity] ?? TEXT_RGB }, [
          { text: gold(l.price), cells: PRICE_CELLS },
        ]),
        action: input.readOnly
          ? { t: 'none' }
          : { t: 'open', menu: { kind: 'confirm', action: 'cancel-listing', id: l.id, at: 0 } },
        alt: `${l.name}, ${l.rarity}, listed for ${gold(l.price)}`,
      })
    }
    rows.push(heading('My buy orders'))
    if (mine.orders.length === 0) rows.push(none())
    for (const o of mine.orders) {
      rows.push({
        key: `row:o-${o.id}`,
        spans: rowSpans(
          inner,
          null,
          { text: `${o.name} ${o.minRarity}+`, rgb: RARITY_RGB[o.minRarity] ?? TEXT_RGB },
          [{ text: `≤${gold(o.maxPrice)}`, cells: MAX_CELLS }],
        ),
        action: input.readOnly
          ? { t: 'none' }
          : { t: 'open', menu: { kind: 'confirm', action: 'cancel-order', id: o.id, at: 0 } },
        alt: `Buy order: ${o.name} ${o.minRarity} or better, up to ${gold(o.maxPrice)}`,
      })
    }
    if (!input.readOnly && !gate) {
      rows.push({
        key: 'row:new',
        spans: rowSpans(inner, null, { text: 'New buy order' }, []),
        action: { t: 'form', form: NEW_ORDER, menu: null },
        alt: 'New buy order',
      })
    }
  }

  const ids = rows.flatMap((r) => (r.key ? [r.key.slice(4)] : []))
  const cursor = cursorRow(dialog.cursor.orders ?? null, ids)
  const onId = ids[cursor] ?? null
  const listing = mine?.listings.find((l) => `l-${l.id}` === onId)
  const order = mine?.orders.find((o) => `o-${o.id}` === onId)
  const detail = listing
    ? (w: number) => listingDetail(input, listing, w)
    : order
      ? (w: number) => orderDetail(input, order, w)
      : onId === 'new'
        ? newOrderDetail
        : null

  const returnsLine = mine && mine.returns > 0 ? 'Returned goods wait for a free slot.' : ''
  let state: [MessageLine, MessageLine]
  if (gate) state = [[{ text: gate, rgb: WARN_RGB }], '']
  else if (listing || order) state = [`Enter: cancel it. ${MOVE_HELP}`, returnsLine]
  else if (onId === 'new') state = ['Enter: place a buy order.', returnsLine]
  else state = ['', returnsLine]

  const spec: ListSpec = {
    title: [{ text: `Orders · ${gold(view.gold)}` }],
    altTitle: `Orders, ${gold(view.gold)}`,
    rows,
    empty: 'Nothing loaded yet.',
    cursor,
    detail,
    menu: null,
    yesNo: null,
    panel: null,
    error: orders.error,
    state,
    field: null,
    link: null,
  }

  const form = orders.form
  const formShown = form !== null && !input.readOnly && !gate
  const menu = input.readOnly ? null : dialog.menu
  if (formShown) {
    spec.panel = (rect) => formPanel(input, form, rect)
    if (menu?.kind === 'pick' && isOrderPick(menu.field)) {
      spec.menu = {
        header: [{ text: PICK_HEADER[menu.field] }],
        items: pickItems(form, menu.field),
        at: menu.at,
        wholeColumn: true,
      }
      spec.state = [PICK_QUESTION[menu.field], 'q: back.']
    }
  } else if (menu?.kind === 'confirm' && menu.action === 'cancel-listing') {
    const l = mine?.listings.find((x) => x.id === menu.id)
    if (l) {
      spec.yesNo = { at: menu.at, yes: { t: 'cancel', what: 'listing', id: l.id } }
      spec.state = [`Cancel the listing of ${l.name}? The fee is kept.`, '']
      spec.detail = (w) => listingDetail(input, l, w)
    }
  } else if (menu?.kind === 'confirm' && menu.action === 'cancel-order') {
    const o = mine?.orders.find((x) => x.id === menu.id)
    if (o) {
      spec.yesNo = { at: menu.at, yes: { t: 'cancel', what: 'order', id: o.id } }
      spec.state = [`Cancel the buy order? ${gold(o.maxPrice)} comes back.`, '']
      spec.detail = (w) => orderDetail(input, o, w)
    }
  }
  return listPane(input, spec)
}
