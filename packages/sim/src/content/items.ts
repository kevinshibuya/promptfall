import type { HeroClass, Slot, Stats } from '../types'
import type { ItemBase } from './types'

const K: HeroClass[] = ['knight']
const BM: HeroClass[] = ['black_mage']
const WM: HeroClass[] = ['white_mage']
const AR: HeroClass[] = ['archer']
const MAGES: HeroClass[] = ['black_mage', 'white_mage']
const ALL: HeroClass[] = ['knight', 'black_mage', 'white_mage', 'archer']

function base(
  id: string,
  name: string,
  glyph: string,
  slot: Slot,
  classes: HeroClass[],
  stats: Partial<Stats>,
  minZone: number,
): ItemBase {
  return { id, name, glyph, slot, classes, stats, minZone }
}

const LIST: ItemBase[] = [
  // Knight weapons
  base('iron_sword', 'Iron Sword', '/', 'weapon', K, { atk: 4, def: 1 }, 1),
  base('bronze_axe', 'Bronze Axe', '/', 'weapon', K, { atk: 5 }, 1),
  base('steel_longsword', 'Steel Longsword', '/', 'weapon', K, { atk: 11 }, 4),
  base('mithril_blade', 'Mithril Blade', '/', 'weapon', K, { atk: 23, spd: 1 }, 7),
  base('dragonfang', 'Dragonfang', '/', 'weapon', K, { atk: 42 }, 10),
  // Black Mage weapons
  base('oak_staff', 'Oak Staff', '|', 'weapon', BM, { atk: 5 }, 1),
  base('ember_rod', 'Ember Rod', '|', 'weapon', BM, { atk: 4, spd: 1 }, 1),
  base('rune_staff', 'Rune Staff', '|', 'weapon', BM, { atk: 12 }, 4),
  base('storm_rod', 'Storm Rod', '|', 'weapon', BM, { atk: 24, spd: 1 }, 7),
  base('void_scepter', 'Void Scepter', '|', 'weapon', BM, { atk: 45 }, 10),
  // White Mage weapons
  base('willow_staff', 'Willow Staff', '|', 'weapon', WM, { atk: 4, hp: 4 }, 1),
  base('healers_mace', "Healer's Mace", '!', 'weapon', WM, { atk: 4, def: 1 }, 1),
  base('silver_crook', 'Silver Crook', '|', 'weapon', WM, { atk: 10, hp: 10 }, 4),
  base('sacred_mace', 'Sacred Mace', '!', 'weapon', WM, { atk: 21, def: 4 }, 7),
  base('seraph_staff', 'Seraph Staff', '|', 'weapon', WM, { atk: 38, hp: 40 }, 10),
  // Archer weapons
  base('oak_bow', 'Oak Bow', ')', 'weapon', AR, { atk: 5 }, 1),
  base('short_bow', 'Short Bow', ')', 'weapon', AR, { atk: 4, spd: 1 }, 1),
  base('longbow', 'Longbow', ')', 'weapon', AR, { atk: 12 }, 4),
  base('elven_bow', 'Elven Bow', ')', 'weapon', AR, { atk: 24, spd: 1 }, 7),
  base('starshot_bow', 'Starshot Bow', ')', 'weapon', AR, { atk: 44 }, 10),
  // Heavy armour
  base('chainmail', 'Chainmail', '[', 'armour', K, { def: 3, hp: 8 }, 1),
  base('bronze_plate', 'Bronze Plate', '[', 'armour', K, { def: 4, hp: 6 }, 1),
  base('steel_plate', 'Steel Plate', '[', 'armour', K, { def: 9, hp: 25 }, 4),
  base('mithril_mail', 'Mithril Mail', '[', 'armour', K, { def: 18, hp: 60 }, 7),
  base('dragon_plate', 'Dragon Plate', '[', 'armour', K, { def: 32, hp: 120 }, 10),
  // Robes
  base('cloth_robe', 'Cloth Robe', '(', 'armour', MAGES, { def: 1, hp: 8 }, 1),
  base('silk_robe', 'Silk Robe', '(', 'armour', MAGES, { def: 2, hp: 5, spd: 1 }, 1),
  base('mystic_robe', 'Mystic Robe', '(', 'armour', MAGES, { def: 5, hp: 22 }, 4),
  base('sage_robe', 'Sage Robe', '(', 'armour', MAGES, { def: 11, hp: 50 }, 7),
  base('astral_robe', 'Astral Robe', '(', 'armour', MAGES, { def: 20, hp: 100 }, 10),
  // Light armour
  base('leather_vest', 'Leather Vest', '[', 'armour', AR, { def: 2, hp: 7 }, 1),
  base('hide_coat', 'Hide Coat', '[', 'armour', AR, { def: 3, hp: 5 }, 1),
  base('ranger_garb', 'Ranger Garb', '[', 'armour', AR, { def: 7, hp: 22, spd: 1 }, 4),
  base('shadow_leather', 'Shadow Leather', '[', 'armour', AR, { def: 14, hp: 50 }, 7),
  base('wind_cloak', 'Wind Cloak', '[', 'armour', AR, { def: 25, hp: 100, spd: 1 }, 10),
  // Accessories
  base('copper_ring', 'Copper Ring', '=', 'accessory', ALL, { atk: 1, hp: 4 }, 1),
  base('bone_charm', 'Bone Charm', '"', 'accessory', ALL, { def: 1, hp: 6 }, 1),
  base('silver_amulet', 'Silver Amulet', '"', 'accessory', ALL, { atk: 4, hp: 15 }, 4),
  base('gold_bangle', 'Gold Bangle', '=', 'accessory', ALL, { def: 6, hp: 35, spd: 1 }, 7),
  base('phoenix_pendant', 'Phoenix Pendant', '"', 'accessory', ALL, { atk: 14, hp: 80 }, 10),
]

export const itemBases: Record<string, ItemBase> = Object.fromEntries(LIST.map((b) => [b.id, b]))
