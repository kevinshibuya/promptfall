// The pane's mount (docs/plans/2026-10-06-ui-pr2-pane-windows.md, Task 8): draws a PaneBuild on
// each surface, mounts its ring stops as hidden Buttons, runs their actions, and keeps the ▶
// cursor on the focus ring through a `ui.focus` hook.
//
// Rungs (spike sheet, "PR 2 pane spike"): terminals hide one Button per stop in a zero-width Box
// and let Tab and the arrows walk them (a′); the desktop, VS Code and mobile keep the stops
// hidden for their hotkeys and draw a `▲ ▼ ok back` row under the picture (c), since their
// ring moves without telling the plugin.
import type { Elements, On, RenderElement, RenderSurface } from 'claude-code'
import { atom, update } from 'claude-code'
import type {
  DialogState,
  DialogTab,
  MarketState,
  OrdersState,
  PaneMenu,
  PickField,
  SellState,
  Settings,
} from '../../../types'
import type { GameHandle } from '../../engine'
import { DESKTOP_COLUMN_PX, SVG_INTERACTIVE } from '../../stage/tuning'
import { DIALOG_DEFAULT } from '../../state'
import type { PlayerEvent } from '../../vendor/sim.js'
import { windowKey, windowSource } from '../../windows/image'
import type { Tile } from '../../windows/kit'
import { sceneCells } from '../../windows/raster'
import { sceneSvg } from '../../windows/svg'
import { CELL_H, CELL_W } from '../../windows/tuning'
import { confirmBuy, loadMarket } from '../market'
import { ordersTrade, placeOrder } from '../orders'
import { openSell, sellTrade } from '../sell'
import type { After, Updater } from '../trade'
import type { PaneAction, PaneBuild, PaneFieldKey, Stop } from './types'

const dialogAtom = atom({ plugin: 'promptfall', key: 'dialog' } as const, DIALOG_DEFAULT)

export const PANE_ID = 'promptfall'

type Els = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button' | 'Link'> &
  Partial<Pick<Elements['terminal'], 'Input' | 'Image' | 'Raster'>> &
  Partial<Pick<Elements['desktop'], 'Svg'>>

/** The build each pane instance drew last, for the focus hook: its ring order, cursors and tab. */
const last = new Map<string, { build: PaneBuild; tab: DialogTab }>()
/**
 * The stop keys each instance drew last. The engine keeps the ring by position, so when the
 * stops change under it (a menu opens, a tab switches, a recruit or a drop inserts a row) the ring
 * can sit on another row than the ▶: a drawing whose stops differ from the last puts it back.
 */
const lastStops = new Map<string, string>()
/** The instances whose ring sits on a field now. */
const onInput = new Set<string>()
/**
 * The instances whose ring last landed on a field: it outlives the engine stop the ring passes on
 * its way off (Shift+Tab), so the next landing knows it is leaving the field.
 */
const fromField = new Set<string>()
export function remember(requestId: string, tab: DialogTab, build: PaneBuild): void {
  last.set(requestId, { build, tab })
}
/** The pane draws no stops now (another tab, or closed): its next stops count as changed. */
export function forget(requestId: string): void {
  last.delete(requestId)
  lastStops.set(requestId, '')
  onInput.delete(requestId)
  fromField.delete(requestId)
}

/** The ring went onto a field (the person's Tab, or the `field` action's own focus). */
export function ringOnInput(requestId: string, on: boolean): void {
  if (on) {
    onInput.add(requestId)
    fromField.add(requestId)
  } else {
    onInput.delete(requestId)
    fromField.delete(requestId)
  }
}

/**
 * The ring moved onto `element` (undefined: an engine stop). Says whether it is leaving a field.
 * On an engine stop the ring is off the field, but the mark stays for its next landing.
 */
export function ringMoved(requestId: string, element: string | undefined): boolean {
  const leaving = fromField.has(requestId) && element !== undefined && !isFieldKey(element)
  if (element === undefined) onInput.delete(requestId)
  else ringOnInput(requestId, isFieldKey(element))
  return leaving
}
/**
 * What the ring is placed against: the open window (`window`, e.g. `actions:i2`, `reforge:i2`,
 * `sell:i2`) and the stop keys. Two windows with as many items share their `menu:<i>` keys, so the
 * window is part of it.
 */
export function stopsSignature(build: PaneBuild, window: string): string {
  return `${window}#${build.stops.map((s) => s.key).join('|')}`
}

/** The keys a field under the picture can have: the focus hook passes them. */
const FIELD_KEYS: ReadonlySet<string> = new Set<PaneFieldKey>(['price', 'order-price', 'compose'])
export function isFieldKey(element: string | undefined): boolean {
  return element !== undefined && FIELD_KEYS.has(element)
}

/**
 * Where the ring goes back to once the stops changed under it (the engine keeps the ring by
 * position, so a row inserted before a field slides the ring off it): the field it was on, else
 * the ▶; null when there is no ▶ (record it as placed); false when the stops did not change. The
 * first drawing of an instance only records them (its autoFocus places the ring). `placed`
 * records them once the focus took.
 */
export function refocusKey(
  requestId: string,
  signature: string,
  build: PaneBuild,
  /** Terminals: their ring slides by position. Elsewhere a field the ring is on is left alone. */
  fieldRefocus = true,
): string | null | false {
  if (!build.field) ringOnInput(requestId, false)
  const was = lastStops.get(requestId)
  if (was === undefined) {
    lastStops.set(requestId, signature)
    return false
  }
  if (was === signature) return false
  if (onInput.has(requestId) && build.field) return fieldRefocus ? build.field.key : false
  return build.focus
}
export function placed(requestId: string, signature: string): void {
  lastStops.set(requestId, signature)
}

/** What a field's typing and Enter do, by the field's key. */
export type FieldCallbacks = {
  onInput: (key: PaneFieldKey, text: string) => void
  onSubmit: (key: PaneFieldKey, text: string) => void
}

export type PaneDraw = {
  els: Els
  surface: RenderSurface
  renderer: 'unknown' | 'image' | 'raster'
  bodyColumns: number
  build: PaneBuild
  run: (action: PaneAction) => void
  /** Rung (c): moves the ▶ one cursor stop. */
  move: (by: 1 | -1) => void
  field: FieldCallbacks
  /** The renderer probe's Image while the renderer is unknown (terminals), else null. */
  probe: RenderElement | null
}

/** Rung (a′) on terminals, (c) elsewhere (the spike sheet). */
export function hiddenRing(surface: RenderSurface): boolean {
  return surface === 'terminal'
}

export function paneElement(d: PaneDraw): RenderElement {
  const { Box, Button, Input, Link } = d.els
  const { scene } = d.build
  const terminal = d.surface === 'terminal'
  const stops = (
    <Box
      key="stops"
      width={0}
      overflow="hidden"
      {...(terminal ? {} : { position: 'absolute' as const, top: 0, left: 0 })}
    >
      {d.build.stops.map((s) => (
        <Button
          key={s.key}
          label=" "
          plain
          {...(s.hotkey ? { hotkey: s.hotkey } : {})}
          {...(s.key === d.build.focus ? { autoFocus: true as const } : {})}
          onPress={() => d.run(s.action)}
        />
      ))}
      {d.probe}
    </Box>
  )

  let picture: RenderElement | null = null
  if (terminal && d.renderer === 'image' && d.els.Image) {
    const { Image } = d.els
    const byKey = new Map(scene.windows.map((w) => [w.key, w]))
    let gaps = 0
    const draw = (t: Tile): RenderElement | null => {
      if ('win' in t) {
        const w = byKey.get(t.win)
        if (!w) return null
        return (
          <Image
            key={windowKey(w)}
            source={windowSource(w)}
            columns={w.columns}
            rows={w.rows}
            alt={w.alt}
          />
        )
      }
      if ('gap' in t) {
        gaps += 1
        return <Box key={`gap-${gaps}`} width={t.gap.columns} height={t.gap.rows} />
      }
      const kids = 'row' in t ? t.row : t.column
      gaps += 1
      return (
        <Box key={`tiles-${gaps}`} flexDirection={'row' in t ? 'row' : 'column'}>
          {kids.map(draw)}
        </Box>
      )
    }
    picture = draw(scene.tiles)
  } else if (terminal && d.els.Raster) {
    const { Raster } = d.els
    picture = (
      <Raster
        key="pane-cells"
        columns={scene.columns}
        rows={scene.rows}
        cells={sceneCells(scene)}
      />
    )
  } else if (!terminal && d.els.Svg) {
    const { Svg } = d.els
    const width = scene.columns * DESKTOP_COLUMN_PX
    const height = Math.round((width * scene.rows * CELL_H) / (scene.columns * CELL_W))
    picture = (
      <Svg
        key="pane-svg"
        source={sceneSvg(scene, [], { smil: false, width })}
        alt={scene.alt}
        width={width}
        height={height}
        isInteractive={SVG_INTERACTIVE}
      />
    )
  }

  const pad = terminal ? Math.max(0, Math.floor((d.bodyColumns - scene.columns) / 2)) : 0
  const f = d.build.field
  // On a terminal the ring walks the tree in order. With a field, the hidden stops follow it, so a
  // row inserted among them (a chat message arriving) leaves the field's place in the ring alone;
  // before it, the engine's ring would slide off the field onto a Button.
  const stopsAfterField = terminal && f !== null && Input !== undefined
  const row = (
    <Box
      key="pane-picture"
      flexDirection={terminal ? 'row' : 'column'}
      {...(terminal ? { paddingLeft: pad } : { alignItems: 'center' as const })}
    >
      {picture}
      {stopsAfterField ? null : stops}
    </Box>
  )
  const field =
    f && Input ? (
      <Box key="pane-field" flexDirection="row" {...(terminal ? { paddingLeft: pad } : {})}>
        <Input
          key={f.key}
          label={f.label}
          placeholder={f.placeholder}
          value={f.value}
          submitLabel={f.submitLabel}
          onInput={(text: string) => d.field.onInput(f.key, text)}
          onSubmit={(text: string) => d.field.onSubmit(f.key, text)}
        />
        {stopsAfterField ? stops : null}
      </Box>
    ) : null
  const link = d.build.link ? (
    <Box key="pane-link" flexDirection="row" {...(terminal ? { paddingLeft: pad } : {})}>
      <Link key="link-url" href={d.build.link.url} label={d.build.link.url} />
    </Box>
  ) : null
  const rung = hiddenRing(d.surface) ? null : (
    <Box key="pane-rung" flexDirection="row" gap={1}>
      <Button key="rung-up" label="▲" hotkey="k" onPress={() => d.move(-1)} />
      <Button key="rung-down" label="▼" hotkey="j" onPress={() => d.move(1)} />
      <Button
        key="rung-ok"
        label="ok"
        onPress={() => {
          const stop = d.build.stops.find((s) => s.key === d.build.focus)
          if (stop) d.run(stop.action)
        }}
      />
      <Button key="rung-back" label="back" onPress={() => d.run({ t: 'back' })} />
    </Box>
  )
  return (
    <Box key="pane" flexDirection="column">
      {row}
      {field}
      {link}
      {rung}
    </Box>
  )
}

export type FocusMove = { t: 'pass' } | { t: 'keep' } | { t: 'land'; stop: Stop; redirect: boolean }

/**
 * Where a ring move onto `element` should land. A cursor stop lands; a tab, back or claim stop
 * redirects to the next cursor stop in the direction of travel (forward when the target is at
 * most half the ring ahead of `current`); an element the build does not hold (an engine stop,
 * the price Input) passes; a build with no cursor stops keeps the ring where it is.
 */
export function focusMove(
  build: PaneBuild,
  element: string | undefined,
  current: string | null,
): FocusMove {
  if (element === undefined) return { t: 'pass' }
  const stops = build.stops
  const target = stops.findIndex((s) => s.key === element)
  if (target < 0) return { t: 'pass' }
  if (!stops.some((s) => s.cursor)) return { t: 'keep' }
  const stop = stops[target] as Stop
  if (stop.cursor) return { t: 'land', stop, redirect: false }
  const n = stops.length
  const from = current === null ? -1 : stops.findIndex((s) => s.key === current)
  const forward = from < 0 || (((target - from) % n) + n) % n <= n / 2
  for (let k = 1; k <= n; k++) {
    const i = (((forward ? target + k : target - k) % n) + n) % n
    const s = stops[i] as Stop
    if (s.cursor) return { t: 'land', stop: s, redirect: true }
  }
  return { t: 'keep' }
}

/**
 * `focusMove` from the build's ▶, with "Leaving a field": a move off a field onto a tab, back or
 * claim stop lands on the ▶ itself, not on the next row in the direction of travel (Shift+Tab from
 * the chat field would wrap onto the oldest message).
 */
export function focusFrom(
  build: PaneBuild,
  element: string | undefined,
  leaving: boolean,
): FocusMove {
  const move = focusMove(build, element, build.focus)
  const home = build.stops.find((s) => s.key === build.focus)
  return leaving && move.t === 'land' && move.redirect && home ? { ...move, stop: home } : move
}

/**
 * True when a landing moves the ▶: onto another stop, or by a redirect. The ring landing on the ▶
 * itself (an `autoFocus`, a re-focus) says nothing the dialog state does not, and writing it would
 * pin a default: Market's ▶ drawn on Filters before the page loads would stay there after it.
 */
export function writesCursor(build: PaneBuild, move: FocusMove): boolean {
  return move.t === 'land' && (move.redirect || move.stop.key !== build.focus)
}

/**
 * The dialog state with the ▶ on `stop`: a list row's cursor, else the open window's row: the sell
 * window's, a menu's, or on Orders the order form's.
 */
export function withCursor(d: DialogState, tab: DialogTab, stop: Stop): DialogState {
  const index = stop.index ?? 0
  if (stop.key.startsWith('row:')) {
    return { ...d, cursor: { ...d.cursor, [tab]: { id: stop.key.slice(4), index } } }
  }
  if (d.sell) return { ...d, sell: { ...d.sell, at: index } }
  if (d.menu) return { ...d, menu: { ...d.menu, at: index } }
  if (tab === 'orders') return { ...d, formAt: index }
  return d
}

/**
 * The open window as the re-focus signature names it: the sell flow, a menu (`filter`,
 * `pick:<field>`, `confirm:<action>:<id>`, `actions:<id>`, a Journal page), the order form, or the tab.
 */
export function paneWindow(d: DialogState, tab: DialogTab, form: boolean): string {
  const m = d.menu
  if (d.sell) return `sell:${d.sell.id}`
  if (m?.kind === 'filter') return 'filter'
  if (m?.kind === 'pick') return `pick:${m.field}`
  if (m?.kind === 'confirm') return `confirm:${m.action}:${m.id}`
  if (m?.kind === 'journal_zone') return `journal_zone:${m.zone}`
  if (m?.kind === 'journal_collection' || m?.kind === 'journal_achievements') return m.kind
  if (m) return `${m.kind}:${'itemId' in m ? m.itemId : m.id}`
  if (tab === 'orders' && form) return 'form'
  return tab
}

/** Rung (c)'s ▲ and ▼: the cursor stop `by` away from the ▶, wrapping. */
export function stepCursor(build: PaneBuild, by: 1 | -1): Stop | null {
  const cursors = build.stops.filter((s) => s.cursor)
  if (cursors.length === 0) return null
  const at = cursors.findIndex((s) => s.key === build.focus)
  const next = at < 0 ? 0 : (at + by + cursors.length) % cursors.length
  return cursors[next] ?? null
}

/** The dialog state a closed pane leaves: no sub-window, no sell flow. */
export function closed(d: DialogState): DialogState {
  return { ...d, menu: null, sell: null }
}

/** The `ui.focus` hook: the ▶ follows the ring, and the ring skips the non-cursor stops. */
export function registerPaneHooks(on: On): void {
  on('ui.focus', { requestId: PANE_ID }, async ($, e, next) => {
    const l = last.get(e.requestId)
    if (!l) return next(e)
    // Leaving a field puts the ring back on the ▶, past an engine stop too (Shift+Tab).
    const leaving = ringMoved(e.requestId, e.element)
    const move = focusFrom(l.build, e.element, leaving)
    if (move.t === 'pass') return next(e)
    if (move.t === 'keep') return {}
    if (writesCursor(l.build, move))
      await update($, dialogAtom, (d) => withCursor({ ...DIALOG_DEFAULT, ...d }, l.tab, move.stop))
    return next(move.redirect ? { ...e, element: move.stop.key } : e)
  })
  // Escape always closes the pane (the spike: a refused close strands the keyboard). A closed
  // pane opens again at the list, not inside a sub-window.
  on('ui.close', { id: PANE_ID }, async ($, e, next) => {
    await update($, dialogAtom, (d) => closed({ ...DIALOG_DEFAULT, ...d }))
    forget(PANE_ID)
    return next(e)
  })
}

export type ActionContext = {
  upd: Updater<DialogState>
  game: () => GameHandle | null
  act: (event: PlayerEvent) => Promise<void>
  openTab: (tab: DialogTab) => Promise<void>
  after: After
  /** How long until the goods in the sell flow trade, as a refusal says it; undefined when they do. */
  remaining: (sell: SellState) => string | undefined
  /** Puts the ring on a field. */
  focusField: (key: PaneFieldKey) => Promise<void>
  /** The dialog state now, for the actions that read it (party, the sell flow). */
  dialog: () => Promise<DialogState>
  updMarket: Updater<MarketState>
  updOrders: Updater<OrdersState>
  market: () => Promise<MarketState>
  orders: () => Promise<OrdersState>
  setSettings: (patch: Partial<Settings>) => Promise<void>
  setCollapsed: (collapsed: boolean) => Promise<void>
  /** The tab now, for Back on Orders. */
  tab: () => Promise<DialogTab>
}

type ConfirmAction = Extract<PaneMenu, { kind: 'confirm' }>['action']

/**
 * Closes the Yes/No for `action` on `id` and says whether it was open, in one update: a second
 * Yes pressed before the redraw finds it closed and does nothing (no second buy).
 */
async function answered(ctx: ActionContext, action: ConfirmAction, id: string): Promise<boolean> {
  let open = false
  await ctx.upd((d) => {
    const m = d.menu
    open = m?.kind === 'confirm' && m.action === action && m.id === id
    return open ? { ...d, menu: null } : d
  })
  return open
}

/** The Market filter window's row for each filter a pick sets. */
const FILTER_ROW: Partial<Record<PickField, number>> = { base: 2, cls: 2, minRarity: 3 }

/**
 * Back, the first that applies: a Market pick returns to the filter window on its row; an order
 * pick closes, showing the form again; any other menu closes; else the sell flow closes; else, on
 * Orders, an open form closes.
 */
async function back(ctx: ActionContext): Promise<void> {
  const d = await ctx.dialog()
  const m = d.menu
  if (m?.kind === 'pick' && FILTER_ROW[m.field] !== undefined) {
    const filter: PaneMenu = { kind: 'filter', at: FILTER_ROW[m.field] ?? 0 }
    await ctx.upd((s) => ({ ...s, menu: filter }))
    return
  }
  if (m) {
    await ctx.upd((s) => ({ ...s, menu: null }))
    return
  }
  if (d.sell) {
    await ctx.upd((s) => ({ ...s, sell: null }))
    return
  }
  if ((await ctx.tab()) === 'orders' && (await ctx.orders()).form)
    await ctx.updOrders((o) => ({ ...o, form: null }))
}

export async function runAction(a: PaneAction, ctx: ActionContext): Promise<void> {
  await perform(a, ctx)
}

async function perform(a: PaneAction, ctx: ActionContext): Promise<void> {
  switch (a.t) {
    case 'tab':
      // A sell flow belongs to Inventory or Heroes: no other tab draws it, so it closes here.
      await ctx.upd((d) => ({ ...d, menu: null, sell: null }))
      await ctx.openTab(a.tab)
      return
    case 'open':
      await ctx.upd((d) => ({ ...d, menu: a.menu }))
      return
    case 'back':
      await back(ctx)
      return
    case 'event':
      await ctx.act(a.event)
      if (!a.keep) await ctx.upd((d) => ({ ...d, menu: null }))
      return
    case 'party': {
      const d = await ctx.dialog()
      const next = d.partyPick.includes(a.heroId)
        ? d.partyPick.filter((id) => id !== a.heroId)
        : [...d.partyPick, a.heroId]
      const [x, y, z] = next
      if (next.length === 3 && x && y && z) {
        await ctx.upd((s) => ({ ...s, partyPick: [], menu: null }))
        await ctx.act({ t: 'set_party', heroIds: [x, y, z] })
      } else {
        await ctx.upd((s) => ({ ...s, partyPick: next, menu: null }))
      }
      return
    }
    case 'sell': {
      const running = ctx.game()
      if (!running) return
      await ctx.upd((d) => ({ ...d, menu: null }))
      await openSell(running, a.kind, a.id, ctx.upd)
      return
    }
    case 'accept':
    case 'list': {
      const running = ctx.game()
      const sell = (await ctx.dialog()).sell
      if (!running || !sell) return
      const close = () => ctx.upd((d) => ({ ...d, sell: null }))
      const updSell: Updater<NonNullable<DialogState['sell']>> = (fn) =>
        ctx.upd((d) => (d.sell ? { ...d, sell: fn(d.sell) } : d))
      const call: Parameters<GameHandle['trade']>[0] =
        a.t === 'accept'
          ? (client, auth) => client.fillOrder(auth, a.orderId, sell.id)
          : (client, auth) => client.list(auth, { kind: sell.kind, id: sell.id, price: a.price })
      await sellTrade(running, call, updSell, close, ctx.after, ctx.remaining(sell))
      return
    }
    case 'field':
      await ctx.focusField(a.key)
      return
    case 'claim':
      ctx.game()?.claim()
      return
    case 'none':
      return
    case 'query': {
      const running = ctx.game()
      if (!running) return
      // The menu first: a pick never stays open through a slow fetch.
      await ctx.upd((d) => ({ ...d, menu: a.menu, cursor: { ...d.cursor, market: null } }))
      await loadMarket(running, a.query, ctx.updMarket, ctx.after)
      return
    }
    case 'buy': {
      const running = ctx.game()
      if (!running || !(await answered(ctx, 'buy', a.listingId))) return
      await confirmBuy(running, a.listingId, (await ctx.market()).query, ctx.updMarket, ctx.after)
      return
    }
    case 'cancel': {
      const running = ctx.game()
      const action = a.what === 'listing' ? 'cancel-listing' : 'cancel-order'
      if (!running || !(await answered(ctx, action, a.id))) return
      await ordersTrade(
        running,
        a.what === 'listing'
          ? (c, auth) => c.cancelListing(auth, a.id)
          : (c, auth) => c.cancelOrder(auth, a.id),
        ctx.updOrders,
        ctx.after,
      )
      return
    }
    case 'form': {
      // Opening a form puts its ▶ on the first row; a pick changing it keeps the ▶.
      const opening = a.form !== null && (await ctx.orders()).form === null
      await ctx.updOrders((o) => ({ ...o, form: a.form }))
      await ctx.upd((d) => ({ ...d, menu: a.menu, ...(opening ? { formAt: 0 } : {}) }))
      return
    }
    case 'place': {
      const running = ctx.game()
      if (!running) return
      await placeOrder(running, await ctx.orders(), ctx.updOrders, ctx.after)
      return
    }
    case 'setting':
      await ctx.setSettings(a.patch)
      return
    case 'band':
      await ctx.setCollapsed(a.collapsed)
      return
    case 'off':
      ctx.game()?.setOff(true)
      return
    case 'link':
      ctx.game()?.link()
      return
    case 'reset':
      if (await answered(ctx, 'reset', '')) ctx.game()?.reset()
      return
    case 'delete':
      if (await answered(ctx, 'delete', '')) ctx.game()?.deleteAccount()
      return
  }
}
