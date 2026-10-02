import type { Content } from './types'

export const expansions: Content['expansions'] = {
  inventory: { step: 10, max: 90, costs: [500, 1000, 2000, 4000, 8000, 16000] },
  roster: { step: 4, max: 48, costs: [400, 800, 1600, 3200, 6400, 12800] },
}
