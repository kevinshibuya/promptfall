import { atom, type On, read, update } from 'claude-code'
import type {
  DialogState,
  DialogTab,
  GameView,
  MarketState,
  Mode,
  OrdersState,
  Prefs,
  SellState,
} from '../../types'
import type { GameHandle } from '../engine'
import { DIALOG_DEFAULT, MARKET_DEFAULT, ORDERS_DEFAULT, PREFS_DEFAULT } from '../state'
import { content, type PlayerEvent, RARITIES, SIM_VERSION } from '../vendor/sim.js'
import { CLIENT_VERSION } from '../version'
import { CLASS_LABEL, formatGold } from './format'
import { confirmBuy, loadMarket, marketBody } from './market'
import { loadOrders, ordersBody, ordersTrade } from './orders'
import { RARITY_COLOR } from './parts'
import { openSell, sellBody, sellTrade } from './sell'
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

const TRADEABLE = new Set(['rare', 'epic', 'legendary'])

const TABS: { tab: DialogTab; label: string; hotkey: string }[] = [
  { tab: 'inventory', label: 'Inventory', hotkey: 'i' },
  { tab: 'heroes', label: 'Heroes', hotkey: 'h' },
  { tab: 'market', label: 'Market', hotkey: 'm' },
  { tab: 'orders', label: 'Orders', hotkey: 'r' },
  { tab: 'account', label: 'Account', hotkey: 'a' },
  { tab: 'odds', label: 'Odds', hotkey: 'o' },
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
    const dialog: DialogState = (await read($, dialogAtom)) ?? DIALOG_DEFAULT
    const notice = await read($, noticeAtom)

    const readOnly = mode === 'secondary' || mode === 'paused' || !game()?.canApply()
    const act = async (event: PlayerEvent) => {
      const running = game()
      if (!running?.canApply()) return
      running.apply(event, await $.clock.now())
      await running.settled()
    }
    const setDialog = (patch: Partial<DialogState>) =>
      update($, dialogAtom, (d) => ({ ...(d ?? DIALOG_DEFAULT), ...patch }))
    const market: MarketState = (await read($, marketAtom)) ?? MARKET_DEFAULT
    const orders: OrdersState = (await read($, ordersAtom)) ?? ORDERS_DEFAULT
    const updMarket: Updater<MarketState> = async (fn) => {
      await update($, marketAtom, (m) => fn(m ?? MARKET_DEFAULT))
    }
    const updOrders: Updater<OrdersState> = async (fn) => {
      await update($, ordersAtom, (o) => fn(o ?? ORDERS_DEFAULT))
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
    }

    const tabs = (
      <Box key="tabs" flexDirection="row" gap={2}>
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

    const heroNameById = new Map(view.roster.map((h) => [h.id, h.name]))
    const body = []

    const running = game()
    if ((tab === 'inventory' || tab === 'heroes') && dialog.sell && running) {
      const sell = dialog.sell
      const close = () => updDialog((d) => ({ ...d, sell: null }))
      const goods =
        sell.kind === 'item'
          ? view.inventory.find((i) => i.id === sell.id)
          : view.roster.find((h) => h.id === sell.id)
      const tradeableAt = goods?.tradeableAt ?? null
      const remaining = tradeableAt === null ? undefined : formatRemaining(remainingMs(tradeableAt))
      body.push(
        ...sellBody(els, view, sell, remainingMs, {
          close,
          setPrice: (text) => updSell((s) => ({ ...s, price: text })),
          list: (price) =>
            sellTrade(
              running,
              (client, auth) => client.list(auth, { kind: sell.kind, id: sell.id, price }),
              updSell,
              close,
              after,
              remaining,
            ),
          accept: (orderId) =>
            sellTrade(
              running,
              (client, auth) => client.fillOrder(auth, orderId, sell.id),
              updSell,
              close,
              after,
              remaining,
            ),
          unequip: (heroId, slot) => act({ t: 'unequip', heroId, slot }),
        }),
      )
    } else if (tab === 'market' && running) {
      body.push(
        ...marketBody(els, pick, view, market, readOnly, {
          setQuery: (q) => loadMarket(running, q, updMarket, after),
          ask: (id) => updMarket((m) => ({ ...m, confirm: id })),
          confirm: async () =>
            confirmBuy(running, (await read($, marketAtom)) ?? market, updMarket, after),
        }),
      )
    } else if (tab === 'orders' && running) {
      body.push(
        ...ordersBody(els, pick, view, orders, readOnly, remainingMs, {
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
            const form = ((await read($, ordersAtom)) ?? orders).form
            if (!form || !/^\d+$/.test(form.maxPrice)) return
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
        }),
      )
    } else if (tab === 'inventory') {
      body.push(
        <Text key="inv-head" bold>
          {`Inventory ${view.inventory.length}/${view.inventoryCap} · ${formatGold(view.gold)}`}
        </Text>,
      )
      if (view.inventory.length === 0)
        body.push(
          <Text key="inv-empty" dimColor>
            Nothing yet.
          </Text>,
        )
      for (const item of view.inventory) {
        const wearer = item.equippedBy ? heroNameById.get(item.equippedBy) : null
        // Two rows per item, so a docked pane never truncates a button.
        body.push(
          <Box key={`item-${item.id}`} flexDirection="column">
            <Box key={`item-name-${item.id}`} flexDirection="row" gap={1}>
              <Text
                color={RARITY_COLOR[item.rarity]}
                dimColor={item.rarity === 'common'}
                wrap="truncate"
              >
                {`${item.glyph} ${item.name} (${item.rarity}, ${item.slot})`}
              </Text>
              {item.affixes.length > 0 ? (
                <Text dimColor wrap="truncate">
                  {item.affixes.join(', ')}
                </Text>
              ) : null}
            </Box>
            <Box key={`item-actions-${item.id}`} flexDirection="row" gap={1} paddingLeft={2}>
              {wearer ? <Text color="cyan" wrap="truncate">{`[${wearer}]`}</Text> : null}
              {readOnly || item.equippedBy ? null : (
                <Button
                  key={`equip-${item.id}`}
                  label="equip"
                  onPress={() =>
                    setDialog({
                      itemPick: dialog.itemPick === `equip:${item.id}` ? null : `equip:${item.id}`,
                    })
                  }
                />
              )}
              {readOnly || !item.equippedBy ? null : (
                <Button
                  key={`unequip-${item.id}`}
                  label="unequip"
                  onPress={() => {
                    const heroId = item.equippedBy
                    const slot = item.slot
                    if (
                      heroId &&
                      (slot === 'weapon' || slot === 'armour' || slot === 'accessory')
                    ) {
                      return act({ t: 'unequip', heroId, slot })
                    }
                  }}
                />
              )}
              {readOnly || item.equippedBy ? null : (
                <Button
                  key={`vendor-${item.id}`}
                  label={`vendor ${item.vendorValue}g`}
                  onPress={() => act({ t: 'vendor', itemId: item.id })}
                />
              )}
              {readOnly || item.equippedBy || !TRADEABLE.has(item.rarity) || !running ? null : (
                <Button
                  key={`sell-${item.id}`}
                  label="sell"
                  onPress={() => openSell(running, 'item', item.id, updDialog)}
                />
              )}
              {readOnly || item.affixes.length === 0 ? null : (
                <Button
                  key={`reforge-${item.id}`}
                  label={`reforge ${item.reforgeCost}g`}
                  onPress={() =>
                    setDialog({
                      itemPick:
                        dialog.itemPick === `reforge:${item.id}` ? null : `reforge:${item.id}`,
                    })
                  }
                />
              )}
            </Box>
          </Box>,
        )
        if (!readOnly && dialog.itemPick === `equip:${item.id}`) {
          const options = view.roster
            .filter((h) => item.classes.includes(h.cls))
            .map((h) => ({ value: h.id, label: `${h.name} (${CLASS_LABEL[h.cls] ?? h.cls})` }))
          body.push(
            options.length > 0 ? (
              pick(`equip-to-${item.id}`, 'Equip on', options, async (heroId) => {
                await setDialog({ itemPick: null })
                await act({ t: 'equip', heroId, itemId: item.id })
              })
            ) : (
              <Text key={`equip-none-${item.id}`} dimColor>
                No hero of a class that can wear it.
              </Text>
            ),
          )
        }
        if (!readOnly && dialog.itemPick === `reforge:${item.id}`) {
          body.push(
            pick(
              `reforge-pick-${item.id}`,
              `Reforge which affix (${item.reforgeCost}g)`,
              item.affixes.map((label, i) => ({ value: String(i), label })),
              async (value) => {
                await setDialog({ itemPick: null })
                await act({ t: 'reforge', itemId: item.id, affixIndex: Number.parseInt(value, 10) })
              },
            ),
          )
        }
      }
    } else if (tab === 'heroes') {
      body.push(
        <Box key="heroes-head" flexDirection="row" gap={2}>
          <Text
            bold
          >{`Roster ${view.roster.length}/${view.rosterCap} · ${formatGold(view.gold)}`}</Text>
          {readOnly ? null : (
            <Button
              key="recruit"
              label={`Recruit ${view.tavernPrice}g`}
              onPress={() => act({ t: 'recruit' })}
            />
          )}
        </Box>,
      )
      if (dialog.partyPick.length > 0) {
        body.push(
          <Text key="party-pick" dimColor>
            {`New party: ${dialog.partyPick.map((id) => heroNameById.get(id) ?? id).join(', ')} (pick ${3 - dialog.partyPick.length} more)`}
          </Text>,
        )
      }
      for (const hero of view.roster) {
        const picked = dialog.partyPick.includes(hero.id)
        const marker = hero.inParty ? '[party]' : hero.inPendingParty ? '[next zone]' : ''
        body.push(
          <Box key={`hero-${hero.id}`} flexDirection="row" gap={1}>
            <Text color={RARITY_COLOR[hero.rarity]} wrap="truncate">
              {`${hero.glyph} ${hero.name} · ${CLASS_LABEL[hero.cls] ?? hero.cls} L${hero.level} (${hero.rarity})`}
            </Text>
            {hero.traits.length > 0 ? (
              <Text dimColor wrap="truncate">
                {hero.traits.join(', ')}
              </Text>
            ) : null}
            {marker ? <Text color="cyan">{marker}</Text> : null}
            {readOnly || !TRADEABLE.has(hero.rarity) || !running ? null : (
              <Button
                key={`sell-${hero.id}`}
                label="sell"
                onPress={() => openSell(running, 'hero', hero.id, updDialog)}
              />
            )}
            {readOnly ? null : (
              <Button
                key={`party-${hero.id}`}
                label={picked ? 'picked' : 'party'}
                onPress={async () => {
                  const next = picked
                    ? dialog.partyPick.filter((id) => id !== hero.id)
                    : [...dialog.partyPick, hero.id]
                  const [a, b, c] = next
                  if (next.length === 3 && a && b && c) {
                    await setDialog({ partyPick: [] })
                    await act({ t: 'set_party', heroIds: [a, b, c] })
                  } else {
                    await setDialog({ partyPick: next })
                  }
                }}
              />
            )}
            {readOnly || hero.inParty || hero.inPendingParty ? null : (
              <Button
                key={`dismiss-${hero.id}`}
                label="dismiss"
                onPress={() => act({ t: 'dismiss', heroId: hero.id })}
              />
            )}
          </Box>,
        )
      }
      body.push(
        <Text key="heroes-help" dimColor>
          A new party takes the field at the next zone change.
        </Text>,
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
