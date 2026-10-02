import { content } from './content'
import { nextId } from './ids'
import type { GameState, Hero } from './types'
import { SIM_VERSION } from './types'

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
  const starters = ['knight_1', 'black_mage_1', 'white_mage_1', 'archer_1']
  for (const templateId of starters) {
    const template = content.heroTemplates[templateId]
    if (!template) throw new Error(`missing hero template ${templateId}`)
    const r = nextId(state, 'h')
    state = r.state
    roster.push({
      id: r.id,
      template: template.id,
      cls: template.cls,
      epithet: '',
      rarity: 'common',
      traits: [],
      level: 1,
      xp: 0,
      hp: template.base.hp,
      equipment: { weapon: null, armour: null, accessory: null },
    })
  }
  const [k, b, w] = roster
  return { ...state, roster, party: [k?.id ?? '', b?.id ?? '', w?.id ?? ''] }
}
