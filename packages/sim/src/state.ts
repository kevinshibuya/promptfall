import { nextId } from './ids'
import type { GameState, Hero, HeroClass } from './types'
import { SIM_VERSION } from './types'

// Placeholder until the content tables land; same (template, cls) pairs as content.heroTemplates.
const STARTERS: { template: string; cls: HeroClass; hp: number }[] = [
  { template: 'knight_1', cls: 'knight', hp: 60 },
  { template: 'black_mage_1', cls: 'black_mage', hp: 36 },
  { template: 'white_mage_1', cls: 'white_mage', hp: 40 },
  { template: 'archer_1', cls: 'archer', hp: 44 },
]

export function createInitialState(seed: number): GameState {
  let state: GameState = {
    v: SIM_VERSION,
    seed: seed >>> 0,
    rng: seed >>> 0,
    counter: 0,
    tick: 0,
    gold: 0,
    zone: 1,
    wave: 1,
    farm: false,
    highestZone: 1,
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
    lootLog: [],
    stats: { kills: 0, bosses: 0, wipes: 0 },
  }
  const roster: Hero[] = []
  for (const starter of STARTERS) {
    const r = nextId(state, 'h')
    state = r.state
    roster.push({
      id: r.id,
      template: starter.template,
      cls: starter.cls,
      epithet: '',
      rarity: 'common',
      traits: [],
      level: 1,
      xp: 0,
      hp: starter.hp,
      equipment: { weapon: null, armour: null, accessory: null },
    })
  }
  const [k, b, w] = roster
  return { ...state, roster, party: [k?.id ?? '', b?.id ?? '', w?.id ?? ''] }
}
