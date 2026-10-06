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
import { spriteFor } from '../sprites/index'
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
import { content, type PlayerEvent, RARITIES, SIM_VERSION } from '../vendor/sim.js'
import { CLIENT_VERSION } from '../version'
import { PANE_MAX_COLUMNS, PANE_ROWS, PRICE_INPUT_ROWS } from '../windows/tuning'
import { chatBody, postChat } from './chat'
import type { TextFit } from './format'
import { boardsBody, loadBoards } from './leaderboards'
import { confirmBuy, loadMarket, marketBody } from './market'
import { loadOrders, ordersBody, ordersTrade } from './orders'
import { heroesPane } from './pane/heroes'
import type { PaneInput } from './pane/input'
import { inventoryPane } from './pane/inventory'
import {
  type ActionContext,
  forget,
  type PaneDraw,
  paneElement,
  registerPaneHooks,
  remember,
  runAction,
  stepCursor,
  takeRefocus,
  withCursor,
} from './pane/mount'
import type { PaneAction } from './pane/types'
import { sellState } from './sell'
import { ListSprite, listSpriteColumns } from './sprites'
import { formatRemaining, remainingRealMs } from './time'
import type { After, Els, Updater } from './trade'

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

const RENDERER_NEXT: Record<Settings['renderer'], Settings['renderer']> = {
  auto: 'image',
  image: 'raster',
  raster: 'auto',
}

const TABS: { tab: DialogTab; label: string; hotkey: string }[] = [
  { tab: 'inventory', label: 'Inventory', hotkey: 'i' },
  { tab: 'heroes', label: 'Heroes', hotkey: 'h' },
  { tab: 'market', label: 'Market', hotkey: 'm' },
  { tab: 'orders', label: 'Orders', hotkey: 'r' },
  { tab: 'account', label: 'Account', hotkey: 'a' },
  { tab: 'odds', label: 'Odds', hotkey: 'o' },
  { tab: 'chat', label: 'Chat', hotkey: 'c' },
  { tab: 'leaderboards', label: 'Leaderboards', hotkey: 'b' },
]

function percent(weight: number, total: number): string {
  if (total <= 0) return '0%'
  const hundredths = Math.floor((weight * 10000) / total)
  return `${Math.floor(hundredths / 100)}.${String(hundredths % 100).padStart(2, '0')}%`
}

function oddsLine(weights: Record<string, number>): string {
  const total = RARITIES.reduce((sum, r) => sum + (weights[r] ?? 0), 0)
  return RARITIES.map((r) => `${r} ${percent(weights[r] ?? 0, total)}`).join(' · ')
}

export function registerDialog(on: On, game: () => GameHandle | null): void {
  registerPaneHooks(on)
  on('ui.render', { component: 'Pane', requestId: 'promptfall' }, async ($, e) => {
    const table = $.ui.resolve(e)
    const { Box, Text, Button, Link } = table
    const Select = 'Select' in table ? table.Select : undefined
    /** A Select where the surface has one; one Button per option elsewhere (mobile). */
    const pick = (
      key: string,
      label: string,
      options: { value: string; label: string }[],
      onPick: (value: string) => Promise<void>,
      value?: string,
    ) =>
      Select ? (
        <Select
          key={key}
          label={label}
          options={options}
          {...(value !== undefined ? { value } : {})}
          onSelect={(picked: string) => void onPick(picked)}
        />
      ) : (
        <Box key={key} flexDirection="column">
          <Text dimColor>{label}</Text>
          {options.map((o) => (
            <Button key={`${key}-${o.value}`} label={o.label} onPress={() => onPick(o.value)} />
          ))}
        </Box>
      )
    const view: GameView | null = await read($, viewAtom)
    const mode: Mode = (await read($, modeAtom)) ?? 'primary'
    const tab: DialogTab = (await read($, dialogTabAtom)) ?? 'inventory'
    const listRenderer = await read($, rendererAtom)
    const dialog: DialogState = { ...DIALOG_DEFAULT, ...(await read($, dialogAtom)) }
    const notice = await read($, noticeAtom)
    const world: WorldState = (await read($, worldAtom)) ?? WORLD_DEFAULT

    const readOnly = mode === 'secondary' || mode === 'paused' || !game()?.canApply()
    const act = async (event: PlayerEvent) => {
      const running = game()
      if (!running?.canApply()) return
      running.apply(event, await $.clock.now())
      await running.settled()
    }
    const market: MarketState = (await read($, marketAtom)) ?? MARKET_DEFAULT
    const orders: OrdersState = (await read($, ordersAtom)) ?? ORDERS_DEFAULT
    const updMarket: Updater<MarketState> = async (fn) => {
      await update($, marketAtom, (m) => fn(m ?? MARKET_DEFAULT))
    }
    const updOrders: Updater<OrdersState> = async (fn) => {
      await update($, ordersAtom, (o) => fn(o ?? ORDERS_DEFAULT))
    }
    const chat: ChatState = (await read($, chatAtom)) ?? CHAT_DEFAULT
    const boards: BoardsState = (await read($, boardsAtom)) ?? BOARDS_DEFAULT
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
    const els: Els = { Box, Text, Button, Input: 'Input' in table ? table.Input : undefined }
    const clientNow = await $.clock.now()
    const serverClock = game()?.clock() ?? null
    const remainingMs = (deadline: number) =>
      serverClock ? remainingRealMs(deadline, serverClock, clientNow) : deadline - clientNow
    /** Opening the Market or Orders tab syncs and loads it. */
    const openTab = async (next: DialogTab) => {
      await update($, dialogTabAtom, () => next)
      const running = game()
      if (!running) return
      if (next === 'market') await loadMarket(running, market.query, updMarket, after)
      if (next === 'orders') await loadOrders(running, updOrders, after)
      if (next === 'leaderboards') await loadBoards(running, updBoards, after)
    }

    const tabs = (
      // Eight tabs do not fit a pane docked beside the conversation: they wrap.
      <Box key="tabs" flexDirection="row" flexWrap="wrap" columnGap={2}>
        {TABS.map((t) => (
          <Button
            key={`tab-${t.tab}`}
            label={t.label}
            hotkey={t.hotkey}
            plain
            dimColor={t.tab !== tab}
            onPress={() => openTab(t.tab)}
          />
        ))}
      </Box>
    )

    const header = []
    if (readOnly) {
      const why =
        mode === 'secondary'
          ? 'Playing in another session: this view is read-only.'
          : mode === 'paused'
            ? (notice ?? 'Promptfall is paused.')
            : (notice ?? 'Promptfall is not playing in this session.')
      header.push(
        <Box key="read-only" flexDirection="row" gap={1}>
          <Text color="yellow" wrap="truncate">
            {why}
          </Text>
          {mode === 'secondary' ? (
            <Button key="play-here" label="play here" onPress={() => game()?.claim()} />
          ) : null}
        </Box>,
      )
    }
    if (dialog.paneNotice) {
      header.push(
        <Text key="pane-notice" color="red" wrap="truncate">
          {`Refused: ${dialog.paneNotice}`}
        </Text>,
      )
    }

    const server: string = (await read($, serverAtom)) ?? 'in-process'
    const resetRow = (
      <Box key="account-reset" flexDirection="row" gap={2}>
        <Button key="reset" label="Reset this machine's data" onPress={() => game()?.reset()} />
      </Box>
    )

    if (!view) {
      // The Account tab works without a game view: a state from an older version is reset here.
      const body =
        tab === 'account' && game()
          ? [
              <Text key="account-server" wrap="truncate">
                {`Server: ${server}`}
              </Text>,
              <Text key="account-client" wrap="truncate">
                {`Client ${CLIENT_VERSION} · sim v${SIM_VERSION}`}
              </Text>,
              resetRow,
            ]
          : [
              <Text key="not-started" dimColor>
                Promptfall has not started in this session.
              </Text>,
            ]
      return (
        <Box key="dialog" flexDirection="column">
          {tabs}
          {header}
          {body}
        </Box>
      )
    }

    if (tab === 'inventory' || tab === 'heroes') {
      // Inventory and Heroes are drawn as windows (UI PR 2); the other tabs keep today's rows.
      const terminal = e.surface === 'terminal'
      const Input = 'Input' in table ? table.Input : undefined
      const renderer = listRenderer ?? 'unknown'
      const pricing =
        dialog.sell !== null &&
        Input !== undefined &&
        sellState(view, world, dialog.sell, remainingMs).kind === 'price'
      const rows = terminal
        ? Math.min(PANE_ROWS, e.props.scroll.bodyRows - (pricing ? PRICE_INPUT_ROWS : 0))
        : PANE_ROWS
      const input: PaneInput = {
        tab,
        view,
        dialog,
        mode,
        readOnly,
        notice,
        world,
        running: game() !== null,
        columns: Math.min(PANE_MAX_COLUMNS, e.props.bodyColumns),
        rows,
        art: !terminal || renderer === 'image',
        hasInput: Input !== undefined,
        remainingMs,
      }
      const build = tab === 'inventory' ? inventoryPane(input) : heroesPane(input)
      remember(e.requestId, tab, build)
      const requestId = e.requestId
      if (takeRefocus() && build.focus) {
        const key = build.focus
        // Not from inside this drawing: $.ui.focus waits for the drawing that brings the key.
        $.clock.after(0, () => void $.ui.focus({ requestId, key }))
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
              ? view.inventory.find((i) => i.id === sell.id)
              : view.roster.find((h) => h.id === sell.id)
          const at = goods?.tradeableAt ?? null
          return at === null ? undefined : formatRemaining(remainingMs(at))
        },
        focusPrice: async () => {
          await $.ui.focus({ requestId, key: 'price' })
        },
        dialog: async () => ({ ...DIALOG_DEFAULT, ...(await read($, dialogAtom)) }),
      }
      const run = (a: PaneAction) => void runAction(a, ctx)
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
        price: dialog.sell
          ? {
              value: dialog.sell.price,
              onInput: (text) => void updSell((s) => ({ ...s, price: text })),
              onSubmit: (text) => {
                if (/^\d+$/.test(text) && validPrice(Number(text)))
                  run({ t: 'list', price: Number(text) })
                else void updSell((s) => ({ ...s, price: text }))
              },
            }
          : null,
      })
    }
    forget(e.requestId)

    const paneWidth = Math.max(20, e.props.bodyColumns)
    // Terminals cut a row at its cells; the desktop's proportional text wraps instead.
    const fit: TextFit = e.surface === 'terminal' ? 'truncate' : 'wrap'
    const body = []

    const running = game()
    if (tab === 'chat' && running) {
      // Each draw of the Chat tab keeps the world poll fast while it is shown.
      running.chatSeen(clientNow)
      body.push(
        ...chatBody(
          els,
          view,
          world,
          chat,
          {
            setDraft: (text) => updChat((c) => ({ ...c, draft: text })),
            post: async (text) => {
              if (((await read($, chatAtom)) ?? chat).busy) return
              await postChat(running, text, updChat, after)
            },
          },
          fit,
        ),
      )
    } else if (tab === 'leaderboards' && running) {
      body.push(...boardsBody(els, view, world, boards))
    } else if (tab === 'market' && running) {
      body.push(
        ...marketBody(
          els,
          pick,
          view,
          world,
          market,
          readOnly,
          {
            setQuery: (q) => loadMarket(running, q, updMarket, after),
            ask: (id) => updMarket((m) => ({ ...m, confirm: id })),
            confirm: async () =>
              confirmBuy(running, (await read($, marketAtom)) ?? market, updMarket, after),
          },
          paneWidth,
          (l) => {
            const art =
              l.kind === 'item' ? spriteFor('item', l.base ?? '') : spriteFor('hero', l.cls ?? '')
            const element = ListSprite(
              table,
              listRenderer,
              e.surface,
              art,
              l.name,
              `sprite-${l.id}`,
            )
            return {
              element,
              columns: element ? listSpriteColumns(listRenderer, e.surface, art) : 0,
            }
          },
          fit,
        ),
      )
    } else if (tab === 'orders' && running) {
      body.push(
        ...ordersBody(
          els,
          pick,
          view,
          world,
          orders,
          readOnly,
          remainingMs,
          {
            cancelListing: async (id) => {
              await ordersTrade(running, (c, a) => c.cancelListing(a, id), updOrders, after)
            },
            cancelOrder: async (id) => {
              await ordersTrade(running, (c, a) => c.cancelOrder(a, id), updOrders, after)
            },
            openForm: () =>
              updOrders((o) => ({
                ...o,
                form: { base: 'steel_longsword', minRarity: 'rare', affixId: null, maxPrice: '' },
              })),
            closeForm: () => updOrders((o) => ({ ...o, form: null })),
            setForm: (patch) =>
              updOrders((o) => (o.form ? { ...o, form: { ...o.form, ...patch } } : o)),
            submit: async () => {
              const current = (await read($, ordersAtom)) ?? orders
              const form = current.form
              // Enter and `place` both submit: one order at a time.
              if (current.busy || !form || !/^\d+$/.test(form.maxPrice)) return
              await updOrders((o) => ({ ...o, busy: true }))
              const input = {
                base: form.base,
                minRarity: form.minRarity,
                affixId: form.affixId,
                maxPrice: Number(form.maxPrice),
              }
              const done = await ordersTrade(
                running,
                (c, a) => c.placeOrder(a, input),
                updOrders,
                after,
              )
              if (done) await updOrders((o) => ({ ...o, form: null }))
            },
          },
          fit,
        ),
      )
    } else if (tab === 'account') {
      const leaseOwner = await read($, leaseOwnerAtom)
      const prefs: Prefs = (await read($, prefsAtom)) ?? PREFS_DEFAULT
      for (const [k, line] of [
        ['server', `Server: ${server}`],
        ['account', `Account ${view.accountId}`],
        ['client', `Client ${CLIENT_VERSION} · sim v${SIM_VERSION}`],
        ['mode', `Mode ${mode}`],
        ['lease', `Session ${leaseOwner ?? 'none'}`],
        [
          'progress',
          `Highest zone ${view.highestZone} · kills ${view.kills} · wipes ${view.wipes}`,
        ],
      ] as const) {
        body.push(
          <Text key={`account-${k}`} wrap="truncate">
            {line}
          </Text>,
        )
      }
      body.push(
        <Box key="account-actions" flexDirection="row" gap={2}>
          <Button
            key="collapse-band"
            label={prefs.collapsed ? 'expand band' : 'collapse band'}
            onPress={() =>
              update($, prefsAtom, (p) => ({
                ...(p ?? PREFS_DEFAULT),
                collapsed: !prefs.collapsed,
              }))
            }
          />
          <Button key="band-off" label="band off" onPress={() => game()?.setOff(true)} />
        </Box>,
      )
      // Per machine, like the commands: the store holds them, the atom mirrors them.
      // The atom keeps this render subscribed; the store is the truth (another session may write it).
      await read($, settingsAtom)
      const settings: Settings = parseSettings(await $.store.get(`promptfall:${SETTINGS_KEY}`))
      const renderer = await read($, rendererAtom)
      const setSettings = async (patch: Partial<Settings>) => {
        // Merge into the store, not this render's copy: another session may have changed it.
        const next = { ...parseSettings(await $.store.get(`promptfall:${SETTINGS_KEY}`)), ...patch }
        await $.store.set(`promptfall:${SETTINGS_KEY}`, next)
        await update($, settingsAtom, () => next)
      }
      const rendererText =
        settings.renderer === 'auto'
          ? `auto (${renderer})`
          : `${settings.renderer} (from next start)`
      for (const [k, text, hotkey, patch] of [
        ['sound', `Sound: ${settings.sound ? 'on' : 'off'}`, 's', { sound: !settings.sound }],
        [
          'motion',
          `Motion: ${settings.motion}`,
          'n',
          { motion: settings.motion === 'full' ? 'still' : 'full' },
        ],
        [
          'renderer',
          `Renderer: ${rendererText}`,
          'x',
          { renderer: RENDERER_NEXT[settings.renderer] },
        ],
      ] as const) {
        body.push(
          <Box key={`account-${k}`} flexDirection="row" gap={2}>
            <Text wrap="truncate">{text}</Text>
            <Button
              key={`setting-${k}`}
              label="change"
              hotkey={hotkey}
              onPress={() => setSettings(patch as Partial<Settings>)}
            />
          </Box>,
        )
      }
      if (view.account.linked) {
        body.push(
          <Text key="account-linked" color="green" wrap="truncate">
            {`Linked as ${view.account.linked}`}
          </Text>,
        )
      } else if (dialog.link) {
        body.push(
          <Box key="account-link" flexDirection="row" gap={1}>
            <Text wrap="truncate">{`Enter ${dialog.link.code} at`}</Text>
            <Link key="link-url" href={dialog.link.url} label={dialog.link.url} />
          </Box>,
        )
      } else if (!readOnly) {
        body.push(
          <Box key="account-link" flexDirection="row" gap={2}>
            <Button key="link-github" label="Link GitHub" onPress={() => game()?.link()} />
          </Box>,
        )
      }
      body.push(resetRow)
    } else {
      const zone = content.zones[view.zone - 1]
      const tavernTotal = RARITIES.reduce((sum, r) => sum + content.tavern.odds[r], 0)
      const lines: [string, string][] = [
        ['zone', `Drops in zone ${view.zone}: ${zone ? oddsLine(zone.rarityWeights) : '-'}`],
        ['boss', `Boss drops: ${zone ? oddsLine(zone.bossRarityWeights) : '-'}`],
        [
          'tavern',
          `Tavern: ${RARITIES.map((r) => `${r} ${percent(content.tavern.odds[r], tavernTotal)}`).join(' · ')}`,
        ],
      ]
      for (const [k, line] of lines) {
        body.push(
          <Text key={`odds-${k}`} wrap="wrap">
            {line}
          </Text>,
        )
      }
      body.push(
        <Box key="odds-expand" flexDirection="row" gap={2}>
          {readOnly || view.nextInventoryCost === null ? (
            <Text dimColor>{view.nextInventoryCost === null ? 'Inventory at max' : ''}</Text>
          ) : (
            <Button
              key="expand-inventory"
              label={`+${content.expansions.inventory.step} slots ${view.nextInventoryCost}g`}
              onPress={() => act({ t: 'expand_inventory' })}
            />
          )}
          {readOnly || view.nextRosterCost === null ? (
            <Text dimColor>{view.nextRosterCost === null ? 'Roster at max' : ''}</Text>
          ) : (
            <Button
              key="expand-roster"
              label={`+${content.expansions.roster.step} heroes ${view.nextRosterCost}g`}
              onPress={() => act({ t: 'expand_roster' })}
            />
          )}
        </Box>,
      )
    }

    return (
      <Box key="dialog" flexDirection="column">
        {tabs}
        {header}
        {body}
      </Box>
    )
  })
}
