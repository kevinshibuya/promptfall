import type { Ledger } from '@promptfall/ledger'
import type { Auth, KeyValue, Listing } from '@promptfall/protocol'
import {
  content,
  type GameState,
  type Item,
  RARITIES,
  type Rarity,
  replay,
  vendorValue,
} from '@promptfall/sim'
import {
  ACTION_WEIGHTS,
  BOT_NAMES,
  BOT_TICK_MS,
  BUY_UNDER_MULT,
  HERO_PRICE,
  LIST_MULT_MIN,
  LIST_MULT_SPREAD,
  ORDER_MULT,
  STIPEND,
  STIPEND_FLOOR,
} from './bot-config'
import { rollBotState } from './bot-seed'

export type BotOptions = {
  ledger: Ledger
  /** The store behind the ledger: bots remember their accounts under `pf:bot:<i>`, nothing else. */
  kv: KeyValue
  seed: number
  count: number
  speed: number
  /** Runs `fn` once after `ms` real milliseconds. */
  schedule: (ms: number, fn: () => void) => { cancel(): void }
  /** Refusals and errors, at debug level. */
  log?: (line: string) => void
}

export type Bots = { stop(): void; tick(): Promise<void> }

type Bot = { name: string; accountId: string; auth: Auth; random: () => number }

type Action = keyof typeof ACTION_WEIGHTS

const botKey = (i: number) => `pf:bot:${i}`
const PAGES = 5

/** xorshift32, seeded per bot: the fake is not the sim, but a run must repeat for a seed. */
function xorshift(seed: number): () => number {
  let x = seed >>> 0 || 0x9e3779b9
  return () => {
    x ^= x << 13
    x >>>= 0
    x ^= x >>> 17
    x ^= x << 5
    x >>>= 0
    return x / 0x1_0000_0000
  }
}

function roll(random: () => number, n: number): number {
  return Math.floor(random() * n)
}

function rarePlus(rarity: Rarity): boolean {
  return RARITIES.indexOf(rarity) >= RARITIES.indexOf('rare')
}

function draw(random: () => number): Action {
  const entries = Object.entries(ACTION_WEIGHTS) as [Action, number][]
  const total = entries.reduce((sum, [, w]) => sum + w, 0)
  let r = roll(random, total)
  for (const [action, weight] of entries) {
    if (r < weight) return action
    r -= weight
  }
  return 'list'
}

function cooled(tradeableAt: number | null, now: number): boolean {
  return tradeableAt === null || tradeableAt <= now
}

/**
 * Seeded bots that list, buy, order and cancel through the ledger's public
 * methods and its host privileges (mint, credit, settle). One bot acts per
 * tick, round robin.
 */
export function startBots(options: BotOptions): Bots {
  const log = options.log ?? (() => undefined)
  const bots: Bot[] = []
  let turn = 0
  let timer: { cancel(): void } | null = null
  let stopped = false

  const ready = (async () => {
    for (let i = 0; i < options.count; i++) {
      const name = BOT_NAMES[i % BOT_NAMES.length] ?? `Bot ${i}`
      let saved = (await options.kv.get(botKey(i))) as
        | { accountId: string; deviceToken: string }
        | undefined
      if (!saved) {
        saved = await options.ledger.host.mint({
          state: rollBotState(options.seed, i),
          name,
          linked: true,
        })
        await options.kv.set(botKey(i), saved)
        await options.kv.flush?.()
      }
      bots.push({
        name,
        accountId: saved.accountId,
        auth: { deviceToken: saved.deviceToken },
        random: xorshift((options.seed * 0x45d9f3b) ^ (i + 1)),
      })
    }
  })()

  async function effective(bot: Bot): Promise<{ state: GameState; now: number }> {
    const boot = await options.ledger.bootstrap({
      clientVersion: '0.1.0',
      deviceToken: bot.auth.deviceToken,
    })
    await options.ledger.host.settle(bot.accountId)
    return {
      state: replay(
        boot.state,
        boot.delivery.events.map((e) => e.event),
      ).state,
      now: boot.config.serverNow,
    }
  }

  async function act(bot: Bot): Promise<void> {
    let { state, now } = await effective(bot)
    if (state.gold < STIPEND_FLOOR) {
      await options.ledger.host.credit(bot.accountId, STIPEND, 'bot_stipend')
      state = { ...state, gold: state.gold + STIPEND }
    }
    const action = draw(bot.random)
    const say = (what: string) => log(`bot ${bot.name} ${action}: ${what}`)
    if (action === 'list') {
      const items = state.inventory.filter(
        (it) => rarePlus(it.rarity) && it.equippedBy === null && cooled(it.tradeableAt, now),
      )
      const heroes = state.roster.filter(
        (h) =>
          rarePlus(h.rarity) &&
          !state.party.includes(h.id) &&
          !state.pendingParty?.includes(h.id) &&
          Object.values(h.equipment).every((e) => e === null) &&
          cooled(h.tradeableAt, now),
      )
      const pool = [
        ...items.map((item) => ({ kind: 'item' as const, id: item.id, item })),
        ...heroes.map((hero) => ({ kind: 'hero' as const, id: hero.id, hero })),
      ]
      const pick = pool[roll(bot.random, pool.length)]
      if (!pick) return say('nothing to list')
      const price =
        pick.kind === 'item'
          ? vendorValue(pick.item) * (LIST_MULT_MIN + roll(bot.random, LIST_MULT_SPREAD))
          : HERO_PRICE[pick.hero.rarity]
      const r = await options.ledger.list(bot.auth, { kind: pick.kind, id: pick.id, price })
      if (!r.ok) say(r.reason)
      return
    }
    if (action === 'buy') {
      const cheap = await cheapestBuy(bot, state)
      if (!cheap) return say('nothing worth buying')
      const r = await options.ledger.buy(bot.auth, cheap.id)
      if (!r.ok) say(r.reason)
      return
    }
    if (action === 'order') {
      const bases = Object.keys(content.itemBases).sort()
      const base = bases[roll(bot.random, bases.length)]
      if (!base) return
      const probe: Item = {
        id: 'probe',
        base,
        rarity: 'rare',
        affixes: [],
        equippedBy: null,
        tradeableAt: null,
      }
      const maxPrice = vendorValue(probe) * ORDER_MULT
      if (state.gold < maxPrice) return say('not enough gold')
      const r = await options.ledger.placeOrder(bot.auth, {
        base,
        minRarity: 'rare',
        affixId: null,
        maxPrice,
      })
      if (!r.ok) say(r.reason)
      return
    }
    const mine = await options.ledger.myOrders(bot.auth)
    if ('reason' in mine) return say(mine.reason)
    const oldest = [...mine.listings].sort((a, b) => a.createdAt - b.createdAt)[0]
    if (!oldest) return say('nothing to cancel')
    const r = await options.ledger.cancelListing(bot.auth, oldest.id)
    if (!r.ok) say(r.reason)
  }

  /** The cheapest listing not its own that it can afford and that is under its price ceiling. */
  async function cheapestBuy(bot: Bot, state: GameState): Promise<Listing | null> {
    const ceiling = (l: Listing) =>
      l.goods.kind === 'item'
        ? vendorValue(l.goods.item) * BUY_UNDER_MULT
        : HERO_PRICE[l.goods.hero.rarity] + 1
    let best: Listing | null = null
    for (const kind of ['item', 'hero'] as const) {
      for (let page = 0; page < PAGES; page++) {
        const r = await options.ledger.browse(bot.auth, { kind, sort: 'price', page })
        if ('reason' in r) return null
        for (const l of r.listings) {
          if (l.sellerId === bot.accountId || l.price > state.gold || l.price >= ceiling(l))
            continue
          if (!best || l.price < best.price) best = l
        }
        if ((page + 1) * 10 >= r.total) break
      }
    }
    return best
  }

  async function tick(): Promise<void> {
    await ready
    const bot = bots[turn % Math.max(1, bots.length)]
    turn += 1
    if (!bot) return
    try {
      await act(bot)
    } catch (error) {
      log(`bot ${bot.name}: ${String(error)}`)
    }
  }

  const interval = BOT_TICK_MS / options.speed
  const loop = () => {
    if (stopped) return
    timer = options.schedule(interval, () => {
      void tick().finally(loop)
    })
  }
  loop()

  return {
    tick,
    stop() {
      stopped = true
      timer?.cancel()
    },
  }
}
