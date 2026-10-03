import type { TraitDef } from './types'

export const traits: Record<string, TraitDef> = {
  stalwart: { id: 'stalwart', name: 'Stalwart', stat: 'hp', rangeBp: [500, 1500] },
  hale: { id: 'hale', name: 'Hale', stat: 'hp', rangeBp: [1000, 2500] },
  fierce: { id: 'fierce', name: 'Fierce', stat: 'atk', rangeBp: [500, 1500] },
  berserker: { id: 'berserker', name: 'Berserker', stat: 'atk', rangeBp: [1000, 2500] },
  ironhide: { id: 'ironhide', name: 'Ironhide', stat: 'def', rangeBp: [500, 1500] },
  warded: { id: 'warded', name: 'Warded', stat: 'def', rangeBp: [1000, 2500] },
  fleet: { id: 'fleet', name: 'Fleet', stat: 'spd', rangeBp: [1000, 2500] },
  quickened: { id: 'quickened', name: 'Quickened', stat: 'spd', rangeBp: [2000, 4000] },
}
