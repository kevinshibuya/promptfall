// Hand-built pane inputs for the pane tests and the pane goldens.
import type { GameView, ItemView, RosterHeroView } from '../../../types'
import { wave } from '../../stage/fixtures'
import { DIALOG_DEFAULT } from '../../state'
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
  return {
    ...wave(),
    gold: 1240,
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
    ...patch,
  }
}
