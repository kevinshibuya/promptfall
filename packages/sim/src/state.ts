import { generateHero } from './heroes'
import { emptyTallies } from './tallies'
import type { GameState } from './types'
import { SIM_VERSION } from './types'

export function createInitialState(seed: number): GameState {
  const state: GameState = {
    v: SIM_VERSION,
    seed: seed >>> 0,
    rng: seed >>> 0,
    counter: 0,
    tick: 0,
    gold: 0,
    zone: 1,
    wave: 1,
    farm: false,
    autoVendor: false,
    highestZone: 1,
    zoneWipes: 0,
    roster: [],
    party: ['', '', ''],
    pendingParty: null,
    inventory: [],
    inventoryCap: 30,
    rosterCap: 24,
    recruits: 0,
    turnToolCalls: 0,
    encounter: null,
    pendingTurnBoss: false,
    hasteTicks: 0,
    guardTicks: 0,
    camp: false,
    lootLog: [],
    stats: { kills: 0, bosses: 0, wipes: 0 },
    tallies: emptyTallies(),
    guarantee: { rare: 0, epic: 0, legendary: 0 },
    boss: null,
    battle: { gauges: [], queue: [], busy: 0 },
  }
  // Starters draw their epithets from the seed's stream; rng is reset to the seed after.
  const roster = ['knight_1', 'black_mage_1', 'white_mage_1', 'archer_1'].map((id) =>
    generateHero(state, 'common', id),
  )
  state.roster = roster
  state.rng = state.seed
  const [k, b, w] = roster
  return { ...state, roster, party: [k?.id ?? '', b?.id ?? '', w?.id ?? ''] }
}
