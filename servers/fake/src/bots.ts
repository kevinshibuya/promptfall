import type { LedgerHost } from '@promptfall/ledger'
import type {
  Auth,
  BatchAck,
  KeyValue,
  Listing,
  MarketResult,
  ServerClient,
} from '@promptfall/protocol'
import { Mirror } from '@promptfall/protocol/mirror'
import {
  content,
  type GameState,
  type Item,
  type PlayerEvent,
  RARITIES,
  type Rarity,
  SIM_VERSION,
  vendorValue,
} from '@promptfall/sim'
import {
  ACTION_WEIGHTS,
  BATCH_TICKS_MIN,
  BATCH_TICKS_SPREAD,
  BOT_LINES,
  BOT_NAMES,
  BOT_TICK_MS,
  BUY_UNDER_MULT,
  CHAT_EVERY_TICKS,
  HERO_PRICE,
  LIST_MULT_MIN,
  LIST_MULT_SPREAD,
  ORDER_MULT,
  REST_EVERY_BATCHES,
  STIPEND,
  STIPEND_FLOOR,
  TOOL_CALL_EVERY,
  TURN_END_EVERY_BATCHES,
} from './bot-config'
import { rollBotState } from './bot-seed'

export type BotOptions = {
  /** The HttpClient over the fake's own port. */
  client: ServerClient
  host: Pick<LedgerHost, 'mint' | 'credit'>
  /** Bots remember their accounts under `pf:bot:<i>`, nothing else. */
  kv: KeyValue
  seed: number
  count: number
  speed: number
  /** Runs `fn` once after `ms` real milliseconds. */
  schedule: (ms: number, fn: () => void) => { cancel(): void }
  /** Every act's outcome, one line each: `bot <name> <action> ok` or `bot <name> <action> <reason>`. */
  log?: (line: string) => void
}

export type Bots = { stop(): void; tick(): Promise<void> }

type Bot = {
  name: string
  accountId: string
  auth: Auth
  random: () => number
  /** The bot's whole client state. */
  mirror: Mirror
  chatMark: number
  acts: number
  batches: number
  ticks: number
}

type Action = keyof typeof ACTION_WEIGHTS
type Saved = { accountId: string; deviceToken: string }

const botKey = (i: number) => `pf:bot:${i}`
const PAGES = 5
const FILL_TRIES = 3

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

function tradeableItems(state: GameState, now: number): Item[] {
  return state.inventory.filter(
    (it) => rarePlus(it.rarity) && it.equippedBy === null && cooled(it.tradeableAt, now),
  )
}

/**
 * Seeded bots that play through the public API like a player: each act polls
 * the world (the heartbeat), commits a batch from its mirror, then trades or
 * chats over HTTP. Only `mint` and `credit` are host privileges. One bot acts
 * per tick, round robin, so each acts once per BOT_TICK_MS virtual ms.
 */
export function startBots(options: BotOptions): Bots {
  const log = options.log ?? (() => undefined)
  const { client } = options
  const bots: Bot[] = []
  let turn = 0
  let timer: { cancel(): void } | null = null
  let stopped = false

  async function mint(i: number, name: string): Promise<Saved> {
    const saved = await options.host.mint({
      state: rollBotState(options.seed, i),
      name,
      linked: true,
    })
    // Not flushed here: a flush outside the ledger's mutex could write another
    // operation's half-done state. The next ledger write carries it to disk.
    await options.kv.set(botKey(i), saved)
    return saved
  }

  const boot = (saved: Saved) =>
    client.bootstrap({ clientVersion: '0.1.0', deviceToken: saved.deviceToken })

  const ready = (async () => {
    for (let i = 0; i < options.count; i++) {
      const name = BOT_NAMES[i % BOT_NAMES.length] ?? `Bot ${i}`
      let saved = (await options.kv.get(botKey(i))) as Saved | undefined
      if (!saved) saved = await mint(i, name)
      let b = await boot(saved)
      // A saved bot behind the sim version, or a token the store no longer knows, is minted again.
      if (b.state.v !== SIM_VERSION || b.account.accountId !== saved.accountId) {
        saved = await mint(i, name)
        b = await boot(saved)
      }
      bots.push({
        name,
        accountId: saved.accountId,
        auth: { deviceToken: saved.deviceToken },
        random: xorshift((options.seed * 0x45d9f3b) ^ (i + 1)),
        mirror: new Mirror(b),
        chatMark: 0,
        acts: 0,
        batches: 0,
        ticks: 0,
      })
    }
  })()

  /** One batch of idle play: ticks, a tool call every few, a rest and a turn end now and then. */
  function playEvents(bot: Bot): PlayerEvent[] {
    bot.batches += 1
    const events: PlayerEvent[] = []
    if (bot.batches % REST_EVERY_BATCHES === 0) events.push({ t: 'rest' })
    const n = BATCH_TICKS_MIN + roll(bot.random, BATCH_TICKS_SPREAD)
    for (let k = 0; k < n; k++) {
      bot.ticks += 1
      if (bot.ticks % TOOL_CALL_EVERY === 0) events.push({ t: 'tool_call' })
      events.push({ t: 'tick' })
    }
    if (bot.batches % TURN_END_EVERY_BATCHES === 0) events.push({ t: 'turn_end' })
    return events
  }

  /** Applies an answer to the mirror; true when the batch committed. */
  function apply(bot: Bot, events: PlayerEvent[], ack: BatchAck): boolean {
    if (ack.ok) {
      bot.mirror.commit(events)
      bot.mirror.receive(ack.delivery)
      return true
    }
    if (ack.reason === 'cursor_behind') {
      bot.mirror.receive(ack.delivery)
      return false
    }
    if ('state' in ack) bot.mirror.adopt(ack)
    return false
  }

  /**
   * The mirror applies `boss_engaged` from a `cursor_behind` answer like any
   * delivery, so a bot in boss mode fights the world boss through its batches.
   */
  async function play(bot: Bot): Promise<void> {
    const events = playEvents(bot)
    let ack = await client.submit(bot.mirror.batch(events), bot.auth)
    apply(bot, events, ack)
    if (!ack.ok && ack.reason === 'cursor_behind') {
      ack = await client.submit(bot.mirror.batch(events), bot.auth)
      apply(bot, events, ack)
    }
    log(`bot ${bot.name} batch ${ack.ok ? 'ok' : ack.reason}`)
  }

  /** Logs a market answer and folds its delivery into the mirror. */
  function settled(bot: Bot, action: string, r: MarketResult): void {
    if (r.ok) bot.mirror.receive(r.delivery)
    log(`bot ${bot.name} ${action} ${r.ok ? 'ok' : r.reason}`)
  }

  async function trade(bot: Bot, now: number): Promise<void> {
    const state = bot.mirror.local
    const action = draw(bot.random)
    const say = (what: string) => log(`bot ${bot.name} ${action} ${what}`)
    if (action === 'list') {
      const heroes = state.roster.filter(
        (h) =>
          rarePlus(h.rarity) &&
          !state.party.includes(h.id) &&
          !state.pendingParty?.includes(h.id) &&
          Object.values(h.equipment).every((e) => e === null) &&
          cooled(h.tradeableAt, now),
      )
      const pool = [
        ...tradeableItems(state, now).map((item) => ({ kind: 'item' as const, id: item.id, item })),
        ...heroes.map((hero) => ({ kind: 'hero' as const, id: hero.id, hero })),
      ]
      const pick = pool[roll(bot.random, pool.length)]
      if (!pick) return say('nothing_to_list')
      const price =
        pick.kind === 'item'
          ? vendorValue(pick.item) * (LIST_MULT_MIN + roll(bot.random, LIST_MULT_SPREAD))
          : HERO_PRICE[pick.hero.rarity]
      return settled(
        bot,
        action,
        await client.list(bot.auth, { kind: pick.kind, id: pick.id, price }),
      )
    }
    if (action === 'buy') {
      const cheap = await cheapestBuy(bot, state)
      if (!cheap) return say('nothing_worth_buying')
      return settled(bot, action, await client.buy(bot.auth, cheap.id))
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
      if (state.gold < maxPrice) return say('not_enough_gold')
      return settled(
        bot,
        action,
        await client.placeOrder(bot.auth, { base, minRarity: 'rare', affixId: null, maxPrice }),
      )
    }
    if (action === 'fill') {
      for (const item of tradeableItems(state, now).slice(0, FILL_TRIES)) {
        const orders = await client.matchingOrders(bot.auth, item.id)
        if ('reason' in orders) return say(orders.reason)
        const first = orders[0]
        if (first) return settled(bot, action, await client.fillOrder(bot.auth, first.id, item.id))
      }
      return say('no_match')
    }
    const mine = await client.myOrders(bot.auth)
    if ('reason' in mine) return say(mine.reason)
    const oldest = [...mine.listings].sort((a, b) => a.createdAt - b.createdAt)[0]
    if (!oldest) return say('nothing_to_cancel')
    return settled(bot, action, await client.cancelListing(bot.auth, oldest.id))
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
        const r = await client.browse(bot.auth, { kind, sort: 'price', page })
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

  async function act(bot: Bot): Promise<void> {
    bot.acts += 1
    // 1. The heartbeat; the chat tail only moves the mark.
    const world = await client.world(bot.auth, bot.chatMark)
    if ('reason' in world) return log(`bot ${bot.name} world ${world.reason}`)
    bot.chatMark = world.chat.at(-1)?.id ?? bot.chatMark
    // 2. A batch of play.
    await play(bot)
    // 3. The stipend: the `credited` event reaches the mirror in the next answer.
    if (bot.mirror.local.gold < STIPEND_FLOOR) {
      await options.host.credit(bot.accountId, STIPEND, 'bot_stipend')
    }
    // 4. Chat on its own cadence, then one market action.
    if (bot.acts % CHAT_EVERY_TICKS === 0) {
      const line = BOT_LINES[roll(bot.random, BOT_LINES.length)] ?? 'hello'
      const r = await client.chat(bot.auth, line)
      log(`bot ${bot.name} chat ${r.ok ? 'ok' : r.reason}`)
    }
    await trade(bot, world.serverNow)
  }

  async function tick(): Promise<void> {
    await ready
    const bot = bots[turn % Math.max(1, bots.length)]
    turn += 1
    if (!bot) return
    try {
      await act(bot)
    } catch (error) {
      // The next act retries from the mirror as it is: a lost ack is answered duplicate or seq_mismatch.
      log(`bot ${bot.name} error ${String(error)}`)
    }
  }

  const interval = BOT_TICK_MS / Math.max(1, options.count) / options.speed
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
