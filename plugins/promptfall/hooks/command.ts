import { atom, type On, read, update } from 'claude-code'
import type { DialogTab, Mode } from '../types'
import type { GameHandle } from './engine'

export const PANE_ID = 'promptfall'

export const COMMAND = {
  name: 'promptfall',
  description: 'Promptfall: open the game, or off / on / farm',
  argumentHint: '[inventory|heroes|account|odds|off|on|farm]',
  immediate: true,
} as const

const TABS: readonly DialogTab[] = ['inventory', 'heroes', 'account', 'odds']

const viewAtom = atom({ plugin: 'promptfall', key: 'view' } as const, null)
const modeAtom = atom({ plugin: 'promptfall', key: 'mode' } as const, 'primary')
const dialogTabAtom = atom({ plugin: 'promptfall', key: 'dialogTab' } as const, 'inventory')

export function registerCommand(on: On, game: () => GameHandle | null): void {
  on('command.run', { command: 'promptfall' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    // Typing the command means the player is in this session: it takes the lease.
    if (arg !== 'off') await game()?.claim()

    if (arg === 'off' || arg === 'on') {
      const off = arg === 'off'
      const running = game()
      if (running) await running.setOff(off)
      else await update($, modeAtom, () => (off ? 'off' : 'primary') as Mode)
      return { text: off ? 'Promptfall band is off for this session' : 'Promptfall band is on' }
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
    return { text: 'Promptfall opened' }
  })
}
