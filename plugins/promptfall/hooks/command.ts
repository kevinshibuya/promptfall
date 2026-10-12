import { atom, type On, read, update } from 'claude-code'
import type { BoardsState, DialogTab, MarketState, Mode, OrdersState, Settings } from '../types'
import { type GameHandle, PAUSED_LINE } from './engine'
import { runSandbox, SANDBOX_PINS_SERVER } from './sandbox'
import { SERVER_KEY, serverReport } from './server'
import {
  BOARDS_DEFAULT,
  DIALOG_DEFAULT,
  MARKET_DEFAULT,
  ORDERS_DEFAULT,
  parseSettings,
  SETTINGS_DEFAULT,
  SETTINGS_KEY,
  settingCommand,
} from './state'
import { PREFIX } from './storage'
import { loadBoards } from './ui/leaderboards'
import { loadMarket } from './ui/market'
import { loadOrders } from './ui/orders'
import { PANE_ROWS } from './windows/tuning'

export const PANE_ID = 'promptfall'

const HINT =
  'inventory|heroes|market|orders|account|odds|chat|leaderboards|off|on|farm|autovendor on|off|server <url>|server local|sound off|quiet|normal|loud|motion full|still|renderer auto|image|raster'

/** The command, its hint naming the sandbox verb only while the sandbox is on. */
export function commandSpec(sandbox: boolean) {
  return {
    name: 'promptfall',
    description:
      'Promptfall: open the game, or off / on / farm / autovendor / server / sound / motion / renderer',
    argumentHint: `[${HINT}${sandbox ? '|sandbox <verb>' : ''}]`,
    immediate: true,
  } as const
}

const TABS: readonly DialogTab[] = [
  'inventory',
  'heroes',
  'market',
  'orders',
  'account',
  'odds',
  'chat',
  'leaderboards',
]

const viewAtom = atom({ plugin: 'promptfall', key: 'view' } as const, null)
const modeAtom = atom({ plugin: 'promptfall', key: 'mode' } as const, 'primary')
const dialogTabAtom = atom({ plugin: 'promptfall', key: 'dialogTab' } as const, 'inventory')
const dialogAtom = atom({ plugin: 'promptfall', key: 'dialog' } as const, DIALOG_DEFAULT)
const marketAtom = atom({ plugin: 'promptfall', key: 'market' } as const, MARKET_DEFAULT)
const ordersAtom = atom({ plugin: 'promptfall', key: 'orders' } as const, ORDERS_DEFAULT)
const boardsAtom = atom({ plugin: 'promptfall', key: 'boards' } as const, BOARDS_DEFAULT)
const settingsAtom = atom({ plugin: 'promptfall', key: 'settings' } as const, SETTINGS_DEFAULT)

const AUTOVENDOR_USAGE = 'Usage: /promptfall autovendor on or /promptfall autovendor off'

const SERVER_USAGE =
  'Usage: /promptfall server, /promptfall server <http(s) URL> or /promptfall server local'

/** `server local` → null; `server <url>` → the URL; anything else → undefined. */
function serverTarget(rest: string): string | null | undefined {
  if (rest.toLowerCase() === 'local') return null
  // One spelling per server: the URL is the setting, the token key and the label.
  const url = rest.replace(/\/+$/, '')
  return /^https?:\/\/\S+$/i.test(url) ? url : undefined
}

export function registerCommand(
  on: On,
  game: () => GameHandle | null,
  sandbox: () => boolean,
): void {
  on('command.run', { command: 'promptfall' }, async ($, e) => {
    const raw = e.args.trim()
    const arg = raw.toLowerCase()
    // The verbs claim the lease themselves, all but `reset`; off, they touch nothing.
    if (arg === 'sandbox' || arg.startsWith('sandbox ')) {
      return { text: await runSandbox(raw.slice('sandbox'.length).trim(), sandbox(), game()) }
    }
    // Typing the command means the player is in this session: it takes the lease.
    if (arg !== 'off') await game()?.claim()

    if (arg === 'off' || arg === 'on') {
      const off = arg === 'off'
      const running = game()
      if (running) await running.setOff(off)
      else await update($, modeAtom, () => (off ? 'off' : 'primary') as Mode)
      return { text: off ? 'Promptfall band is off for this session' : 'Promptfall band is on' }
    }

    // Per machine: the store holds them, the atom mirrors them for the drawings.
    const setting = settingCommand(arg)
    if (setting && 'usage' in setting) return { text: setting.usage }
    if (setting) {
      const key = `promptfall:${SETTINGS_KEY}`
      const next: Settings = { ...parseSettings(await $.store.get(key)), ...setting.patch }
      await $.store.set(key, next)
      await update($, settingsAtom, () => next)
      return { text: setting.text }
    }

    if (arg === 'server' || arg.startsWith('server ')) {
      if (sandbox()) return { text: SANDBOX_PINS_SERVER }
      if (arg === 'server') return { text: serverReport(await $.store.get(PREFIX + SERVER_KEY)) }
      const target = serverTarget(raw.slice('server'.length).trim())
      if (target === undefined) return { text: SERVER_USAGE }
      const running = game()
      if (!running) return { text: 'Promptfall is not playing in this session' }
      const r = await running.switchServer(target)
      return {
        text:
          r.dropped > 0
            ? `Promptfall now plays on ${r.label}; ${r.dropped} unsent events on ${r.old} were dropped`
            : `Promptfall now plays on ${r.label}`,
      }
    }

    if (arg === 'farm') {
      const view = await read($, viewAtom)
      const running = game()
      if (running?.isPaused()) return { text: PAUSED_LINE }
      if (!view || !running?.canApply())
        return { text: 'Promptfall is not playing in this session' }
      running.apply({ t: 'set_farm', on: !view.farm }, await $.clock.now())
      await running.settled()
      return { text: `Promptfall farm is ${view.farm ? 'off' : 'on'}` }
    }

    if (arg === 'autovendor' || arg.startsWith('autovendor ')) {
      const word = arg.slice('autovendor'.length).trim()
      if (word !== 'on' && word !== 'off') return { text: AUTOVENDOR_USAGE }
      const running = game()
      if (running?.isPaused()) return { text: PAUSED_LINE }
      if (!running?.canApply()) return { text: 'Promptfall is not playing in this session' }
      running.apply({ t: 'set_auto_vendor', on: word === 'on' }, await $.clock.now())
      await running.settled()
      return { text: `Promptfall auto-vendor is ${word}` }
    }

    const tab = TABS.find((t) => t === arg) ?? 'inventory'
    await update($, dialogTabAtom, () => tab)
    // The pane opens on the tab's list: a sub-window or a sell flow left open stays behind.
    await update($, dialogAtom, (d) => ({ ...DIALOG_DEFAULT, ...d, menu: null, sell: null }))
    await $.ui.open({
      id: PANE_ID,
      title: 'Promptfall',
      focus: true,
      closeOnEscape: true,
      holdToasts: true,
      rows: PANE_ROWS,
    })
    const running = game()
    const after = (ms: number, fn: () => void) => {
      $.clock.after(ms, fn)
    }
    if (running && tab === 'market') {
      const market: MarketState = (await read($, marketAtom)) ?? MARKET_DEFAULT
      await loadMarket(
        running,
        market.query,
        async (fn) => {
          await update($, marketAtom, (m) => fn(m ?? MARKET_DEFAULT))
        },
        after,
      )
    }
    if (running && tab === 'orders') {
      await loadOrders(
        running,
        async (fn) => {
          await update($, ordersAtom, (o: OrdersState | undefined) => fn(o ?? ORDERS_DEFAULT))
        },
        after,
      )
    }
    if (running && tab === 'leaderboards') {
      await loadBoards(
        running,
        async (fn) => {
          await update($, boardsAtom, (b: BoardsState | undefined) => fn(b ?? BOARDS_DEFAULT))
        },
        after,
      )
    }
    return { text: 'Promptfall opened' }
  })
}
