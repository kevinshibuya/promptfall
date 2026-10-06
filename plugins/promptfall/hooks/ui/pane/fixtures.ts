// Hand-built pane inputs for the pane tests and the pane goldens.
import type {
  BoardsState,
  ChatMessage,
  GameView,
  ItemView,
  ListingView,
  MarketState,
  OrdersState,
  RosterHeroView,
  WorldState,
} from '../../../types'
import { wave } from '../../stage/fixtures'
import {
  BOARDS_DEFAULT,
  CHAT_DEFAULT,
  DIALOG_DEFAULT,
  MARKET_DEFAULT,
  ORDERS_DEFAULT,
  SETTINGS_DEFAULT,
  WORLD_DEFAULT,
} from '../../state'
import type { PaneInput } from './input'

export function item(id: string, patch: Partial<ItemView> = {}): ItemView {
  return {
    id,
    base: 'iron_sword',
    name: 'Iron Sword',
    glyph: '/',
    slot: 'weapon',
    rarity: 'common',
    affixes: [],
    equippedBy: null,
    classes: ['knight'],
    vendorValue: 12,
    reforgeCost: 30,
    tradeableAt: null,
    ...patch,
  }
}

export function rosterHero(id: string, patch: Partial<RosterHeroView> = {}): RosterHeroView {
  return {
    id,
    name: 'Aldric',
    cls: 'knight',
    glyph: 'K',
    rarity: 'common',
    level: 4,
    traits: [],
    inParty: false,
    inPendingParty: false,
    tradeableAt: null,
    equipment: { weapon: null, armour: null, accessory: null },
    ...patch,
  }
}

/**
 * Three items (a worn common weapon, a rare armour with two affixes, an epic accessory) and a
 * roster of five: Aldric, Mira, Tomas in the party, Lyra and Bram on the bench.
 */
export function paneView(): GameView {
  const base = wave()
  return {
    ...base,
    gold: 1240,
    account: { ...base.account, linked: 'kevin', marketOpen: true },
    inventory: [
      item('i1', { equippedBy: 'h1' }),
      item('i2', {
        base: 'silk_robe',
        name: 'Silk Robe',
        glyph: '[',
        slot: 'armour',
        rarity: 'rare',
        affixes: ['+3 Defence', '+5% Speed'],
        classes: ['black_mage', 'white_mage'],
        vendorValue: 120,
      }),
      item('i3', {
        base: 'jade_ring',
        name: 'Jade Ring',
        glyph: 'o',
        slot: 'accessory',
        rarity: 'epic',
        affixes: ['+4 Magic'],
        classes: ['knight', 'black_mage', 'white_mage', 'archer'],
        vendorValue: 300,
      }),
    ],
    inventoryCap: 20,
    roster: [
      rosterHero('h1', {
        inParty: true,
        traits: ['Brave', 'Swift'],
        equipment: { weapon: 'i1', armour: null, accessory: null },
      }),
      rosterHero('h2', { name: 'Mira', cls: 'black_mage', rarity: 'rare', inParty: true }),
      rosterHero('h3', { name: 'Tomas', cls: 'white_mage', rarity: 'legendary', inParty: true }),
      rosterHero('h4', { name: 'Lyra', cls: 'archer', rarity: 'rare', level: 2 }),
      rosterHero('h5', { name: 'Bram', cls: 'knight', level: 1 }),
    ],
    rosterCap: 6,
    tavernPrice: 120,
  }
}

export function paneInput(patch: Partial<PaneInput> = {}): PaneInput {
  return {
    tab: 'inventory',
    view: paneView(),
    dialog: DIALOG_DEFAULT,
    mode: 'primary',
    readOnly: false,
    notice: null,
    world: null,
    running: true,
    columns: 120,
    rows: 24,
    art: true,
    hasInput: true,
    remainingMs: () => 0,
    market: MARKET_DEFAULT,
    orders: ORDERS_DEFAULT,
    chat: CHAT_DEFAULT,
    boards: BOARDS_DEFAULT,
    account: {
      server: 'in-process',
      leaseOwner: null,
      settings: SETTINGS_DEFAULT,
      renderer: 'image',
      collapsed: false,
    },
    ...patch,
  }
}

export function listing(id: string, patch: Partial<ListingView> = {}): ListingView {
  return {
    id,
    kind: 'item',
    name: 'Steel Longsword',
    rarity: 'rare',
    detail: 'Keen +2, Swift +1',
    sellerId: 'seller-1',
    sellerName: 'mira',
    price: 1200,
    expiresAt: 6 * 86_400_000,
    base: 'steel_longsword',
    cls: null,
    ...patch,
  }
}

/** A loaded first page of 23: a rare sword by seller-1, an epic hero of yours (`a1`), a legendary ring. */
export function marketPage(): MarketState {
  return {
    ...MARKET_DEFAULT,
    page: {
      listings: [
        listing('L1'),
        listing('L2', {
          kind: 'hero',
          name: 'Sela the Bold',
          rarity: 'epic',
          detail: 'archer · Brave',
          sellerId: 'a1',
          sellerName: 'kevin',
          price: 4800,
          base: null,
          cls: 'archer',
        }),
        listing('L3', {
          name: 'Phoenix Pendant',
          rarity: 'legendary',
          detail: 'Vital +4',
          sellerName: 'tomas',
          price: 25_000,
          base: 'phoenix_pendant',
        }),
      ],
      page: 0,
      total: 23,
    },
  }
}

/** Two of your listings, one buy order with an affix, and two returns waiting. */
export function ordersMine(): OrdersState {
  return {
    ...ORDERS_DEFAULT,
    mine: {
      listings: [
        listing('L4', {
          name: 'Silk Robe',
          detail: 'Ward +3',
          sellerId: 'a1',
          sellerName: 'kevin',
          price: 900,
          base: 'silk_robe',
        }),
        listing('L5', {
          name: 'Jade Ring',
          rarity: 'epic',
          detail: 'Vital +4',
          sellerId: 'a1',
          sellerName: 'kevin',
          price: 2400,
          base: 'copper_ring',
        }),
      ],
      orders: [
        {
          id: 'O1',
          base: 'steel_longsword',
          name: 'Steel Longsword',
          minRarity: 'rare',
          affix: 'Vicious',
          maxPrice: 1200,
          expiresAt: 6 * 86_400_000,
        },
      ],
      returns: 2,
    },
  }
}

/** `n` chat messages, ids 1 to n, oldest first. */
export function chatWorld(n: number): WorldState {
  const names = ['mira', 'tomas', 'kevin', 'lyra']
  const messages: ChatMessage[] = Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    name: names[i % names.length] ?? 'mira',
    text: `message ${i + 1}`,
    at: i * 1000,
  }))
  return { ...WORLD_DEFAULT, messages }
}

/** Both boards, 20 rows each; `a1` (you) third on highest zone and first on damage. */
export function boardsLoaded(): BoardsState {
  const row = (i: number, value: number) => ({
    accountId: i === 2 ? 'a1' : `p${i}`,
    name: i === 2 ? 'kevin' : `player${i}`,
    value,
  })
  return {
    boards: {
      highestZone: Array.from({ length: 20 }, (_, i) => row(i, 12 - Math.floor(i / 3))),
      damage: Array.from({ length: 20 }, (_, i) => ({
        ...row(i === 0 ? 2 : i === 2 ? 0 : i, 90_000 - i * 1000),
      })),
      weekStart: 0,
    },
    busy: false,
    error: null,
  }
}
