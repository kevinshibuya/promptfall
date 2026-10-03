import type { Content } from './types'

export const tavern: Content['tavern'] = {
  baseCost: 200,
  costGrowthBp: 1500,
  odds: { common: 6000, uncommon: 2800, rare: 950, epic: 200, legendary: 50 },
}
