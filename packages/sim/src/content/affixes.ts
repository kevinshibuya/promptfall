import type { Slot } from '../types'
import type { AffixDef } from './types'

const W: Slot[] = ['weapon']
const A: Slot[] = ['armour']
const X: Slot[] = ['accessory']
const WX: Slot[] = ['weapon', 'accessory']
const AX: Slot[] = ['armour', 'accessory']
const ALL: Slot[] = ['weapon', 'armour', 'accessory']

const LIST: AffixDef[] = [
  { id: 'keen', name: 'Keen', slots: WX, stat: 'atk', range: [1, 4] },
  { id: 'brutal', name: 'Brutal', slots: W, stat: 'atk', range: [3, 8] },
  { id: 'vicious', name: 'Vicious', slots: W, stat: 'atk', range: [6, 14] },
  { id: 'tempered', name: 'Tempered', slots: W, stat: 'def', range: [1, 4] },
  { id: 'swift', name: 'Swift', slots: ALL, stat: 'spd', range: [1, 2] },
  { id: 'hasty', name: 'Hasty', slots: WX, stat: 'spd', range: [2, 3] },
  { id: 'vital', name: 'Vital', slots: ALL, stat: 'hp', range: [5, 20] },
  { id: 'hearty', name: 'Hearty', slots: AX, stat: 'hp', range: [15, 45] },
  { id: 'sturdy', name: 'Sturdy', slots: AX, stat: 'def', range: [1, 4] },
  { id: 'warded', name: 'Warded', slots: A, stat: 'def', range: [3, 9] },
  { id: 'bulwark', name: 'Bulwark', slots: A, stat: 'def', range: [6, 14] },
  { id: 'nimble', name: 'Nimble', slots: A, stat: 'spd', range: [1, 2] },
  { id: 'thorned', name: 'Thorned', slots: A, stat: 'atk', range: [1, 4] },
  { id: 'lucky', name: 'Lucky', slots: X, stat: 'spd', range: [1, 3] },
  { id: 'mighty', name: 'Mighty', slots: X, stat: 'atk', range: [3, 9] },
  { id: 'guardian', name: 'Guardian', slots: X, stat: 'def', range: [3, 9] },
  { id: 'lifebound', name: 'Lifebound', slots: W, stat: 'hp', range: [10, 30] },
]

export const affixes: Record<string, AffixDef> = Object.fromEntries(LIST.map((a) => [a.id, a]))
