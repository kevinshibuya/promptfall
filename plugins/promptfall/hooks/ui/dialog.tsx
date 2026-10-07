// The pane: all eight tabs drawn as Dragon Quest V windows (UI PR 2 and 3), and the pane before a
// game view exists. Each tab's builder returns a PaneBuild; the mount draws it and runs its actions.
import { atom, type On, read, update } from 'claude-code'
import type {
  BoardsState,
  ChatState,
  DialogState,
  DialogTab,
  GameView,
  MarketState,
  Mode,
  OrdersState,
  Prefs,
  SellState,
  Settings,
  WorldState,
} from '../../types'
import type { GameHandle } from '../engine'
import { PROBE_DELAY_MS } from '../stage/tuning'
import {
  BOARDS_DEFAULT,
  CHAT_DEFAULT,
  DIALOG_DEFAULT,
  MARKET_DEFAULT,
  ORDERS_DEFAULT,
  PREFS_DEFAULT,
  parseSettings,
  SETTINGS_DEFAULT,
  SETTINGS_KEY,
  WORLD_DEFAULT,
} from '../state'
import { validPrice } from '../vendor/ledger.js'
import type { PlayerEvent } from '../vendor/sim.js'
import { FIELD_ROWS, LINK_ROWS, PANE_MAX_COLUMNS, PANE_ROWS } from '../windows/tuning'
import { postChat } from './chat'
import { loadBoards } from './leaderboards'
import { loadMarket } from './market'
import { loadOrders, placeOrder } from './orders'
import { accountPane, noViewPane } from './pane/account'
import { chatPane } from './pane/chat'
import { paneLayout } from './pane/frame'
import { heroesPane } from './pane/heroes'
import type { PaneInput } from './pane/input'
import { inventoryPane } from './pane/inventory'
import { boardsPane } from './pane/leaderboards'
import { marketPane } from './pane/market'
import {
  type ActionContext,
  hiddenRing,
  type PaneDraw,
  paneElement,
  paneWindow,
  placed,
  refocusKey,
  registerPaneHooks,
  remember,
  ringOnInput,
  runAction,
  stepCursor,
  stopsSignature,
  withCursor,
} from './pane/mount'
import { oddsPane } from './pane/odds'
import { ordersPane } from './pane/orders'
import type { PaneAction, PaneBuild } from './pane/types'
import { armProbe, PROBE_B, probeElement, probeVerdict } from './probe'
import { formatRemaining, remainingRealMs } from './time'
import type { After, Updater } from './trade'

const viewAtom = atom({ plugin: 'promptfall', key: 'view' } as const, null)
const modeAtom = atom({ plugin: 'promptfall', key: 'mode' } as const, 'primary')
const dialogTabAtom = atom({ plugin: 'promptfall', key: 'dialogTab' } as const, 'inventory')
const dialogAtom = atom({ plugin: 'promptfall', key: 'dialog' } as const, DIALOG_DEFAULT)
const prefsAtom = atom({ plugin: 'promptfall', key: 'prefs' } as const, PREFS_DEFAULT)
const leaseOwnerAtom = atom({ plugin: 'promptfall', key: 'leaseOwner' } as const, null)
const noticeAtom = atom({ plugin: 'promptfall', key: 'notice' } as const, null)
const serverAtom = atom({ plugin: 'promptfall', key: 'server' } as const, null)
const marketAtom = atom({ plugin: 'promptfall', key: 'market' } as const, MARKET_DEFAULT)
const ordersAtom = atom({ plugin: 'promptfall', key: 'orders' } as const, ORDERS_DEFAULT)
const worldAtom = atom({ plugin: 'promptfall', key: 'world' } as const, WORLD_DEFAULT)
const chatAtom = atom({ plugin: 'promptfall', key: 'chat' } as const, CHAT_DEFAULT)
const boardsAtom = atom({ plugin: 'promptfall', key: 'boards' } as const, BOARDS_DEFAULT)
const settingsAtom = atom({ plugin: 'promptfall', key: 'settings' } as const, SETTINGS_DEFAULT)
const rendererAtom = atom({ plugin: 'promptfall', key: 'renderer' } as const, 'unknown')

/** Each tab's builder. */
const BUILDERS: Record<DialogTab, (input: PaneInput) => PaneBuild> = {
  inventory: inventoryPane,
  heroes: heroesPane,
  market: marketPane,
  orders: ordersPane,
  account: accountPane,
  odds: oddsPane,
  chat: chatPane,
  leaderboards: boardsPane,
}

export function registerDialog(on: On, game: () => GameHandle | null): void {
  registerPaneHooks(on)
  on('ui.render', { component: 'Pane', requestId: 'promptfall' }, async ($, e) => {
    const table = $.ui.resolve(e)
    const view: GameView | null = await read($, viewAtom)
    const mode: Mode = (await read($, modeAtom)) ?? 'primary'
    const tab: DialogTab = (await read($, dialogTabAtom)) ?? 'inventory'
    const renderer = (await read($, rendererAtom)) ?? 'unknown'
    const dialog: DialogState = { ...DIALOG_DEFAULT, ...(await read($, dialogAtom)) }
    const notice = await read($, noticeAtom)
    const world: WorldState = (await read($, worldAtom)) ?? WORLD_DEFAULT
    const market: MarketState = (await read($, marketAtom)) ?? MARKET_DEFAULT
    const orders: OrdersState = (await read($, ordersAtom)) ?? ORDERS_DEFAULT
    const chat: ChatState = (await read($, chatAtom)) ?? CHAT_DEFAULT
    const boards: BoardsState = (await read($, boardsAtom)) ?? BOARDS_DEFAULT
    const server: string = (await read($, serverAtom)) ?? 'in-process'
    const prefs: Prefs = (await read($, prefsAtom)) ?? PREFS_DEFAULT
    const leaseOwner = (await read($, leaseOwnerAtom)) ?? null
    // The atom keeps this render subscribed; the store is the truth (another session may write it).
    await read($, settingsAtom)
    const settings: Settings = parseSettings(await $.store.get(`promptfall:${SETTINGS_KEY}`))

    const readOnly = mode === 'secondary' || mode === 'paused' || !game()?.canApply()
    const act = async (event: PlayerEvent) => {
      const running = game()
      if (!running?.canApply()) return
      running.apply(event, await $.clock.now())
      await running.settled()
    }
    const updMarket: Updater<MarketState> = async (fn) => {
      await update($, marketAtom, (m) => fn(m ?? MARKET_DEFAULT))
    }
    const updOrders: Updater<OrdersState> = async (fn) => {
      await update($, ordersAtom, (o) => fn(o ?? ORDERS_DEFAULT))
    }
    const updChat: Updater<ChatState> = async (fn) => {
      await update($, chatAtom, (c) => fn(c ?? CHAT_DEFAULT))
    }
    const updBoards: Updater<BoardsState> = async (fn) => {
      await update($, boardsAtom, (b) => fn(b ?? BOARDS_DEFAULT))
    }
    const updDialog: Updater<DialogState> = async (fn) => {
      await update($, dialogAtom, (d) => fn(d ?? DIALOG_DEFAULT))
    }
    const updSell: Updater<SellState> = (fn) =>
      updDialog((d) => (d.sell ? { ...d, sell: fn(d.sell) } : d))
    const after: After = (ms, fn) => {
      $.clock.after(ms, fn)
    }
    /** Merges into the store, not a render's copy: another session may have changed it. */
    const setSettings = async (patch: Partial<Settings>) => {
      const next = { ...parseSettings(await $.store.get(`promptfall:${SETTINGS_KEY}`)), ...patch }
      await $.store.set(`promptfall:${SETTINGS_KEY}`, next)
      await update($, settingsAtom, () => next)
    }
    const clientNow = await $.clock.now()
    const serverClock = game()?.clock() ?? null
    const remainingMs = (deadline: number) =>
      serverClock ? remainingRealMs(deadline, serverClock, clientNow) : deadline - clientNow
    /** Opening the Market, Orders or Leaderboards tab syncs and loads it. */
    const openTab = async (next: DialogTab) => {
      await update($, dialogTabAtom, () => next)
      const running = game()
      if (!running) return
      if (next === 'market') await loadMarket(running, market.query, updMarket, after)
      if (next === 'orders') await loadOrders(running, updOrders, after)
      if (next === 'leaderboards') await loadBoards(running, updBoards, after)
    }

    const running = game()
    // Each draw of the Chat tab keeps the world poll fast while it is shown.
    if (view && tab === 'chat' && running) running.chatSeen(clientNow)

    const terminal = e.surface === 'terminal'
    const hasInput = 'Input' in table
    const bodyRows = terminal ? e.props.scroll.bodyRows : PANE_ROWS
    /** The picture's rows: the body less what sits under it, at most PANE_ROWS. */
    const pictureRows = (under: number) => Math.min(PANE_ROWS, bodyRows - under)
    const frame = (rows: number) => ({
      tab,
      dialog,
      mode,
      readOnly,
      notice,
      columns: Math.min(PANE_MAX_COLUMNS, e.props.bodyColumns),
      rows,
    })
    const buildAt = (rows: number, input = hasInput, shortPane = false): PaneBuild =>
      view
        ? BUILDERS[tab]({
            ...frame(rows),
            view,
            world,
            running: running !== null,
            art: !terminal || renderer === 'image',
            hasInput: input,
            ...(shortPane ? { shortPane: true as const } : {}),
            remainingMs,
            market,
            orders,
            chat,
            boards,
            account: { server, leaseOwner, settings, renderer, collapsed: prefs.collapsed },
          })
        : // The Account tab works without a game view: a state from an older version is reset here.
          noViewPane({ ...frame(rows), server, hasGame: running !== null, hasInput: input })
    // On a terminal a field or the Link takes rows under the picture: build again without them.
    let build = buildAt(pictureRows(0))
    if (terminal && build.field) {
      // A field whose row would push the picture under its floor is left out: the picture keeps
      // its rows and the pane builds as a surface without an Input (presets for prices). Else the
      // pane would read "needs more room", and the band would take the rows it freed.
      const room =
        paneLayout(Math.min(PANE_MAX_COLUMNS, e.props.bodyColumns), pictureRows(FIELD_ROWS))
          .kind !== 'small'
      build = room ? buildAt(pictureRows(FIELD_ROWS)) : buildAt(pictureRows(0), false, true)
    } else if (terminal && build.link) build = buildAt(pictureRows(LINK_ROWS))
    remember(e.requestId, tab, build)

    const requestId = e.requestId
    const signature = stopsSignature(build, paneWindow(dialog, tab, orders.form !== null))
    const key = refocusKey(requestId, signature, build, hiddenRing(e.surface))
    if (key !== false) {
      if (key === null) placed(requestId, signature)
      else {
        // Not from inside this drawing: $.ui.focus waits for the drawing that brings the key.
        // Recorded only once it took: a pane without the keyboard tries again next drawing.
        $.clock.after(0, () => {
          void $.ui.focus({ requestId, key }).then(
            (r) => {
              if (r.deny === undefined) placed(requestId, signature)
            },
            () => undefined,
          )
        })
      }
    }
    const ctx: ActionContext = {
      upd: updDialog,
      game,
      act,
      openTab,
      after,
      remaining: (sell) => {
        const goods =
          sell.kind === 'item'
            ? view?.inventory.find((i) => i.id === sell.id)
            : view?.roster.find((h) => h.id === sell.id)
        const at = goods?.tradeableAt ?? null
        return at === null ? undefined : formatRemaining(remainingMs(at))
      },
      focusField: async (key) => {
        const r = await $.ui.focus({ requestId, key })
        if (r.deny === undefined) ringOnInput(requestId, true)
      },
      dialog: async () => ({ ...DIALOG_DEFAULT, ...(await read($, dialogAtom)) }),
      updMarket,
      updOrders,
      market: async () => (await read($, marketAtom)) ?? MARKET_DEFAULT,
      orders: async () => (await read($, ordersAtom)) ?? ORDERS_DEFAULT,
      setSettings,
      setCollapsed: async (collapsed) => {
        await update($, prefsAtom, (p) => ({ ...(p ?? PREFS_DEFAULT), collapsed }))
      },
      tab: async () => (await read($, dialogTabAtom)) ?? 'inventory',
    }
    const run = (a: PaneAction) => void runAction(a, ctx)
    // A docked pane collapses the band, which then never probes: the pane probes too.
    const probe = terminal ? probeElement(table as PaneDraw['els'], renderer) : null
    if (probe && armProbe()) {
      $.clock.after(PROBE_DELAY_MS, () => {
        void (async () => {
          // A blit that throws settles nothing, like any other deny.
          const deny = await $.ui.blit({ requestId, key: 'probe', source: PROBE_B }).then(
            (r) => r.deny,
            (error: unknown) => String(error),
          )
          const verdict = probeVerdict(deny)
          if (verdict) await update($, rendererAtom, () => verdict)
        })()
      })
    }
    return paneElement({
      els: table as PaneDraw['els'],
      surface: e.surface,
      renderer,
      bodyColumns: e.props.bodyColumns,
      build,
      run,
      move: (by) => {
        const stop = stepCursor(build, by)
        if (stop) void updDialog((d) => withCursor(d, tab, stop))
      },
      probe,
      field: {
        onInput: (key, text) => {
          if (key === 'price') void updSell((s) => ({ ...s, price: text }))
          if (key === 'order-price')
            void updOrders((o) => (o.form ? { ...o, form: { ...o.form, maxPrice: text } } : o))
          if (key === 'compose') void updChat((c) => ({ ...c, draft: text }))
        },
        onSubmit: (key, text) => {
          if (key === 'price') {
            if (/^\d+$/.test(text) && validPrice(Number(text)))
              run({ t: 'list', price: Number(text) })
            else void updSell((s) => ({ ...s, price: text }))
            return
          }
          const current = game()
          if (key === 'order-price') {
            void (async () => {
              await updOrders((o) => (o.form ? { ...o, form: { ...o.form, maxPrice: text } } : o))
              if (current)
                await placeOrder(current, (await read($, ordersAtom)) ?? orders, updOrders, after)
            })()
            return
          }
          void (async () => {
            // One post at a time: a double Enter while the first is in flight sends nothing.
            if (!current || ((await read($, chatAtom)) ?? chat).busy) return
            await postChat(current, text, updChat, after)
          })()
        },
      },
    })
  })
}
