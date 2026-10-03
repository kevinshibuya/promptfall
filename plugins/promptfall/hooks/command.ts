import { atom, type On, read, update } from 'claude-code'
import type { DialogTab, MarketState, Mode, OrdersState } from '../types'
import type { GameHandle } from './engine'
import { MARKET_DEFAULT, ORDERS_DEFAULT } from './state'
import { loadMarket } from './ui/market'
import { loadOrders } from './ui/orders'

export const PANE_ID = 'promptfall'

export const COMMAND = {
  name: 'promptfall',
  description: 'Promptfall: open the game, or off / on / farm / server',
  argumentHint:
    '[inventory|heroes|market|orders|account|odds|off|on|farm|server <url>|server local]',
  immediate: true,
} as const

const TABS: readonly DialogTab[] = ['inventory', 'heroes', 'market', 'orders', 'account', 'odds']

const viewAtom = atom({ plugin: 'promptfall', key: 'view' } as const, null)
const modeAtom = atom({ plugin: 'promptfall', key: 'mode' } as const, 'primary')
const dialogTabAtom = atom({ plugin: 'promptfall', key: 'dialogTab' } as const, 'inventory')
const marketAtom = atom({ plugin: 'promptfall', key: 'market' } as const, MARKET_DEFAULT)
const ordersAtom = atom({ plugin: 'promptfall', key: 'orders' } as const, ORDERS_DEFAULT)

const SERVER_USAGE = 'Usage: /promptfall server <http(s) URL> or /promptfall server local'

/** `server local` → null; `server <url>` → the URL; anything else → undefined. */
function serverTarget(rest: string): string | null | undefined {
  if (rest.toLowerCase() === 'local') return null
  return /^https?:\/\/\S+$/i.test(rest) ? rest : undefined
}

export function registerCommand(on: On, game: () => GameHandle | null): void {
  on('command.run', { command: 'promptfall' }, async ($, e) => {
    const raw = e.args.trim()
    const arg = raw.toLowerCase()
    // Typing the command means the player is in this session: it takes the lease.
    if (arg !== 'off') await game()?.claim()

    if (arg === 'off' || arg === 'on') {
      const off = arg === 'off'
      const running = game()
      if (running) await running.setOff(off)
      else await update($, modeAtom, () => (off ? 'off' : 'primary') as Mode)
      return { text: off ? 'Promptfall band is off for this session' : 'Promptfall band is on' }
    }

    if (arg === 'server' || arg.startsWith('server ')) {
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
      if (!view || !running?.canApply())
        return { text: 'Promptfall is not playing in this session' }
      running.apply({ t: 'set_farm', on: !view.farm }, await $.clock.now())
      await running.settled()
      return { text: `Promptfall farm is ${view.farm ? 'off' : 'on'}` }
    }

    const tab = TABS.find((t) => t === arg) ?? 'inventory'
    await update($, dialogTabAtom, () => tab)
    await $.ui.open({
      id: PANE_ID,
      title: 'Promptfall',
      focus: true,
      closeOnEscape: true,
      holdToasts: true,
      rows: 20,
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
    return { text: 'Promptfall opened' }
  })
}
