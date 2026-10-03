import type { HeroTemplate } from './types'

export const heroTemplates: Record<string, HeroTemplate> = {
  knight_1: {
    id: 'knight_1',
    name: 'Aldric',
    cls: 'knight',
    glyph: '♞',
    base: { hp: 60, atk: 9, def: 6, spd: 4 },
    growth: { hp: 9, atk: 2, def: 2, spd: 0 },
  },
  black_mage_1: {
    id: 'black_mage_1',
    name: 'Morwen',
    cls: 'black_mage',
    glyph: '✶',
    base: { hp: 36, atk: 11, def: 2, spd: 5 },
    growth: { hp: 5, atk: 3, def: 1, spd: 0 },
  },
  white_mage_1: {
    id: 'white_mage_1',
    name: 'Selene',
    cls: 'white_mage',
    glyph: '✚',
    base: { hp: 40, atk: 8, def: 3, spd: 6 },
    growth: { hp: 6, atk: 2, def: 1, spd: 0 },
  },
  archer_1: {
    id: 'archer_1',
    name: 'Kestrel',
    cls: 'archer',
    glyph: '➶',
    base: { hp: 44, atk: 11, def: 3, spd: 7 },
    growth: { hp: 6, atk: 3, def: 1, spd: 0 },
  },
}
