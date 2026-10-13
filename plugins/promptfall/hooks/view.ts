import type {
  AccountView,
  EnemyView,
  GameView,
  HeroView,
  ItemView,
  ListingView,
  LootView,
  OrderView,
  RosterHeroView,
  WorldState,
} from '../types'
import type { Account, Listing, Order, ServerConfig } from './vendor/protocol.js'
import {
  affixValue,
  content,
  type GameState,
  heroFill,
  heroStats,
  type Item,
  type LootEntry,
  reforgeCost,
  zoneAt,
} from './vendor/sim.js'

const LOOT_LINES = 12

export function heroName(template: string, epithet: string): string {
  const name = content.heroTemplates[template]?.name ?? template
  return epithet ? `${name} ${epithet}` : name
}

export function vendorValue(item: Pick<Item, 'base' | 'rarity'>): number {
  const minZone = content.itemBases[item.base]?.minZone ?? 1
  return content.rarity[item.rarity].vendorGoldPerZone * minZone
}

export function tavernPrice(state: GameState): number {
  const { baseCost, costGrowthBp } = content.tavern
  return Math.floor((baseCost * (10000 + costGrowthBp * state.recruits)) / 10000)
}

function expansionCost(
  cap: number,
  start: number,
  rule: { step: number; max: number; costs: number[] },
): number | null {
  if (cap >= rule.max) return null
  return rule.costs[Math.floor((cap - start) / rule.step)] ?? null
}

/** The name a trade shows: the item base's, or the hero template's. */
export function tradeName(kind: 'item' | 'hero', base: string): string {
  return kind === 'hero'
    ? (content.heroTemplates[base]?.name ?? base)
    : (content.itemBases[base]?.name ?? base)
}

function affixLine(item: Item): string {
  return item.affixes
    .map((a) => `${content.affixes[a.id]?.name ?? a.id} +${affixValue(item, a)}`)
    .join(', ')
}

export function listingView(listing: Listing): ListingView {
  const g = listing.goods
  const common = {
    id: listing.id,
    kind: g.kind,
    sellerId: listing.sellerId,
    sellerName: listing.sellerName,
    price: listing.price,
    expiresAt: listing.expiresAt,
  }
  if (g.kind === 'item') {
    return {
      ...common,
      base: g.item.base,
      cls: null,
      name: tradeName('item', g.item.base),
      rarity: g.item.rarity,
      detail: affixLine(g.item) || 'no affixes',
    }
  }
  const traits = g.hero.traits.map((t) => content.traits[t.id]?.name ?? t.id).join(', ')
  return {
    ...common,
    base: null,
    cls: g.hero.cls,
    name: heroName(g.hero.template, g.hero.epithet),
    rarity: g.hero.rarity,
    detail: [g.hero.cls, traits].filter(Boolean).join(' · '),
  }
}

export function orderView(order: Order): OrderView {
  return {
    id: order.id,
    base: order.base,
    name: tradeName('item', order.base),
    minRarity: order.minRarity,
    affix: order.affixId ? (content.affixes[order.affixId]?.name ?? order.affixId) : null,
    maxPrice: order.maxPrice,
    expiresAt: order.expiresAt,
  }
}

function lootLine(entry: LootEntry): LootView {
  if (entry.k === 'hero') {
    const glyph = content.heroTemplates[entry.template]?.glyph ?? '@'
    const name = content.heroTemplates[entry.template]?.name ?? entry.template
    return {
      text: `${glyph} ${name} joined (${entry.rarity})`,
      rarity: entry.rarity,
      kind: 'market',
      itemId: null,
    }
  }
  if (entry.k === 'reward') {
    const name = content.itemBases[entry.base]?.name ?? entry.base
    return {
      text: `boss reward ${name} (+${entry.gold}g)`,
      rarity: entry.rarity,
      kind: 'market',
      itemId: null,
    }
  }
  if (entry.k === 'trade') {
    const name = tradeName(entry.kind, entry.base)
    const text =
      entry.what === 'returned' ? `${name} returned` : `${entry.what} ${name} for ${entry.gold}g`
    return { text, rarity: entry.rarity, kind: 'market', itemId: null }
  }
  const base = content.itemBases[entry.base]
  const name = entry.base === 'contract' ? 'Hero contract' : (base?.name ?? entry.base)
  if (entry.vendoredFor !== null) {
    return {
      text: `${name} sold for ${entry.vendoredFor}g`,
      rarity: entry.rarity,
      // A hero contract a full roster sells never had a chest: nothing waits for it.
      kind: entry.base === 'contract' ? 'market' : 'vendored',
      itemId: entry.itemId,
    }
  }
  return {
    text: `${base?.glyph ?? '?'} ${name} (${entry.rarity})`,
    rarity: entry.rarity,
    kind: 'drop',
    itemId: entry.itemId,
  }
}

function itemView(item: Item): ItemView {
  const base = content.itemBases[item.base]
  return {
    id: item.id,
    base: item.base,
    name: base?.name ?? item.base,
    glyph: base?.glyph ?? '?',
    slot: base?.slot ?? 'weapon',
    rarity: item.rarity,
    affixes: item.affixes.map((a) => {
      const def = content.affixes[a.id]
      return def ? `${def.name} +${affixValue(item, a)} ${def.stat}` : a.id
    }),
    equippedBy: item.equippedBy,
    classes: base?.classes ?? [],
    vendorValue: vendorValue(item),
    reforgeCost: reforgeCost(item),
    tradeableAt: item.tradeableAt,
  }
}

/** Everything the band and the dialog draw, derived from the state alone. */
/** The dialog's account line: the GitHub login, the server, whether the market is open, returns waiting. */
export function toAccountView(
  account: Account | null,
  config: ServerConfig | null,
  server: string,
  returns: number,
  sandbox = false,
): AccountView {
  return {
    linked: account?.linked?.login ?? null,
    server,
    marketOpen: config?.flags['market.enabled'] ?? true,
    chatOpen: config?.flags['chat.enabled'] ?? true,
    presenceOpen: config?.flags['presence.enabled'] ?? true,
    leaderboardsOpen: config?.flags['leaderboards.enabled'] ?? true,
    bossOpen: config?.flags['worldboss.enabled'] ?? true,
    returns,
    sandbox,
  }
}

export type Gates = {
  chatOpen: boolean
  presenceOpen: boolean
  leaderboardsOpen: boolean
  bossOpen: boolean
  marketOpen: boolean
}

/**
 * What is open: the latest world snapshot's flags once there is one, the
 * bootstrap config before, so a restarted server's flags reach every surface
 * within one poll.
 */
export function gates(world: WorldState | null, account: AccountView): Gates {
  const flags = world?.snapshot?.flags
  const open = (name: string, fallback: boolean) =>
    flags ? (flags[name] ?? fallback) !== false : fallback
  return {
    chatOpen: open('chat.enabled', account.chatOpen),
    presenceOpen: open('presence.enabled', account.presenceOpen),
    leaderboardsOpen: open('leaderboards.enabled', account.leaderboardsOpen),
    bossOpen: open('worldboss.enabled', account.bossOpen),
    marketOpen: open('market.enabled', account.marketOpen),
  }
}

export function toGameView(
  state: GameState,
  accountId: string,
  firstRun: boolean,
  account: AccountView,
): GameView {
  const heroes: HeroView[] = []
  // An older version's state has no battle; the band shows its reset notice over empty gauges.
  const battle = state.battle ?? { gauges: [], queue: [], busy: 0 }
  for (const id of state.party) {
    const hero = state.roster.find((h) => h.id === id)
    if (!hero) continue
    const stats = heroStats(state, hero)
    heroes.push({
      id: hero.id,
      name: heroName(hero.template, hero.epithet),
      shortName: content.heroTemplates[hero.template]?.name ?? hero.template,
      cls: hero.cls,
      glyph: content.heroTemplates[hero.template]?.glyph ?? '@',
      level: hero.level,
      hp: hero.hp,
      maxHp: stats.hp,
      alive: hero.hp > 0,
      rarity: hero.rarity,
      gauge: battle.gauges.find((g) => g.id === hero.id)?.g ?? 0,
      queued: battle.queue.includes(hero.id),
      gaugePerStep: heroFill(state, hero),
      hasted: (state.hasteTicks ?? 0) > 0,
      guarding: (state.guardTicks ?? 0) > 0,
    })
  }
  const enemies: EnemyView[] = (state.encounter?.enemies ?? []).map((e) => {
    // The world boss has no content entry: its name and glyph travel with boss_engaged.
    if (e.kind === 'world_boss' && state.boss) {
      return {
        id: e.id,
        def: 'world_boss',
        name: state.boss.name,
        glyph: state.boss.glyph,
        hp: e.hp,
        maxHp: e.maxHp,
        kind: e.kind,
        enraged: e.enraged === true,
      }
    }
    const def = content.enemies[e.def]
    return {
      id: e.id,
      def: e.def,
      name: def?.name ?? e.def,
      glyph: def?.glyph ?? '?',
      hp: e.hp,
      maxHp: e.maxHp,
      kind: e.kind,
      enraged: e.enraged === true,
    }
  })
  const loot = state.lootLog.slice(-LOOT_LINES).map(lootLine)
  const roster: RosterHeroView[] = state.roster.map((hero) => ({
    id: hero.id,
    name: heroName(hero.template, hero.epithet),
    cls: hero.cls,
    glyph: content.heroTemplates[hero.template]?.glyph ?? '@',
    rarity: hero.rarity,
    level: hero.level,
    traits: hero.traits.map((t) => {
      const def = content.traits[t.id]
      return def ? `${def.name} +${Math.floor(t.valueBp / 100)}% ${def.stat}` : t.id
    }),
    inParty: state.party.includes(hero.id),
    inPendingParty: state.pendingParty?.includes(hero.id) ?? false,
    tradeableAt: hero.tradeableAt,
    equipment: { ...hero.equipment },
  }))
  return {
    heroes,
    enemies,
    zone: state.zone,
    zoneName: zoneAt(state.zone)?.def.name ?? `Zone ${state.zone}`,
    wave: state.wave,
    gold: state.gold,
    farm: state.farm,
    autoVendor: state.autoVendor,
    lastDrop: loot[loot.length - 1] ?? null,
    loot,
    highestZone: state.highestZone,
    kills: state.stats.kills,
    wipes: state.stats.wipes,
    inventory: state.inventory.map(itemView),
    inventoryCap: state.inventoryCap,
    roster,
    rosterCap: state.rosterCap,
    tavernPrice: tavernPrice(state),
    nextInventoryCost: expansionCost(state.inventoryCap, 30, content.expansions.inventory),
    nextRosterCost: expansionCost(state.rosterCap, 24, content.expansions.roster),
    accountId,
    firstRun,
    account,
    boss: state.boss
      ? {
          bossId: state.boss.bossId,
          name: state.boss.name,
          glyph: state.boss.glyph,
          dealt: state.boss.dealt,
        }
      : null,
  }
}
