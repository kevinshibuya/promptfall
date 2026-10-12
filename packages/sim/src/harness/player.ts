import { FILL_K } from '../battle'
import { nextExpansionCost, tavernPrice } from '../commands'
import { content } from '../content'
import { reforgeCost } from '../loot'
import { heroStats } from '../progression'
import type { Effect, Event, GameState, Hero, HeroClass, Item, Slot, Stats } from '../types'

// The dedicated player (#151): the harness's model of a player who works the game. One habit per
// decision, each a plain rule a tester can read: score, wear, spend, pick the party, dispose.

/** Where the player sits: the state it reads and the one way it acts. */
export type Seat = {
  readonly state: GameState
  play(event: Event): Effect[]
}

/** The defence at which a hit lands half: mitigation is 100 / (100 + def). */
const MITIGATION_K = 100
const SLOTS: readonly Slot[] = ['weapon', 'armour', 'accessory']
const EPSILON = 1e-9

/**
 * Habit 1, a hero's worth in a fight, from the combat formulas: the damage it deals is its atk times
 * the turns it takes, which fill at spd + FILL_K; the hits it survives are its hp times
 * (100 + def) / 100. Worth is the log of their product, so a point of each stat is worth its share
 * of that term: 1/atk, 1/(spd + 10), 1/hp and 1/(100 + def). An item scores what it adds to its
 * wearer's worth, every stat of it: base, rarity and affixes at their tier-scaled read values.
 */
export function worth(stats: Stats): number {
  return (
    Math.log(Math.max(1, stats.atk)) +
    Math.log(Math.max(1, stats.spd + FILL_K)) +
    Math.log(Math.max(1, stats.hp)) +
    Math.log(MITIGATION_K + Math.max(0, stats.def))
  )
}

/** The hero's stats with the slot holding this item, or empty when null. */
function statsWith(state: GameState, hero: Hero, slot: Slot, itemId: string | null): Stats {
  return heroStats(state, { ...hero, equipment: { ...hero.equipment, [slot]: itemId } })
}

/** What wearing the item adds to the hero's worth: below zero when it is a downgrade. */
export function gain(state: GameState, hero: Hero, item: Item): number {
  const base = content.itemBases[item.base]
  if (!base?.classes.includes(hero.cls)) return Number.NEGATIVE_INFINITY
  if (hero.equipment[base.slot] === item.id) return 0
  return worth(statsWith(state, hero, base.slot, item.id)) - worth(heroStats(state, hero))
}

/** The party the player chose: the pending one while it waits for the next wave 1. */
export function chosenParty(state: GameState): readonly string[] {
  return state.pendingParty ?? state.party
}

function heroesIn(state: GameState, ids: readonly string[]): Hero[] {
  return ids.flatMap((id) => state.roster.filter((h) => h.id === id))
}

function bench(state: GameState): Hero[] {
  const party = chosenParty(state)
  return state.roster.filter((h) => !party.includes(h.id))
}

/** Habit 2's choice: the hero the item raises most, party first; null when it raises none. */
export function bestWearer(state: GameState, item: Item, skip: ReadonlySet<string>): Hero | null {
  for (const group of [heroesIn(state, chosenParty(state)), bench(state)]) {
    let best: Hero | null = null
    let most = EPSILON
    for (const hero of group) {
      if (skip.has(hero.id)) continue
      const g = gain(state, hero, item)
      if (g > most) {
        best = hero
        most = g
      }
    }
    if (best) return best
  }
  return null
}

/**
 * Habit 2, at a drop: wear the item on the hero it raises most, party first. The item it displaces
 * moves on to the next hero it beats, and so on, each hero once; the last one is left unworn.
 * Returns whether the item was worn.
 */
export function wear(seat: Seat, itemId: string): boolean {
  const touched = new Set<string>()
  let next: string | null = itemId
  let worn = false
  while (next !== null) {
    const id: string = next
    const item = seat.state.inventory.find((i) => i.id === id)
    const base = item ? content.itemBases[item.base] : undefined
    if (!item || !base || item.equippedBy !== null) return worn
    const hero = bestWearer(seat.state, item, touched)
    if (!hero) return worn
    const displaced = hero.equipment[base.slot]
    seat.play({ t: 'equip', heroId: hero.id, itemId: id })
    if (id === itemId) worn = true
    touched.add(hero.id)
    next = displaced
  }
  return worn
}

/**
 * Habit 4's measure: a hero's worth at its level in the best gear it could wear, slot by slot from
 * the whole inventory, as if nobody else wore it.
 */
export function potential(state: GameState, hero: Hero): number {
  let h: Hero = { ...hero, equipment: { weapon: null, armour: null, accessory: null } }
  for (const slot of SLOTS) {
    let bestId: string | null = null
    let best = worth(heroStats(state, h))
    for (const item of state.inventory) {
      const base = content.itemBases[item.base]
      if (base?.slot !== slot || !base.classes.includes(h.cls)) continue
      const w = worth(statsWith(state, h, slot, item.id))
      if (w > best + EPSILON) {
        best = w
        bestId = item.id
      }
    }
    h = { ...h, equipment: { ...h.equipment, [slot]: bestId } }
  }
  return worth(heroStats(state, h))
}

export type Spending = {
  recruits: number
  dismissals: number
  expansions: number
  reforges: number
  partyChanges: number
}

export function noSpending(): Spending {
  return { recruits: 0, dismissals: 0, expansions: 0, reforges: 0, partyChanges: 0 }
}

function accepted(effects: Effect[]): boolean {
  return !effects.some((e) => e.k === 'rejected')
}

/**
 * Habit 3's first spend: recruit while the roster has room and gold allows. A full roster whose
 * bench is no better than the party's worst hero dismisses its weakest bench hero to make room.
 */
function recruitAll(seat: Seat, spent: Spending): void {
  for (;;) {
    const s = seat.state
    if (s.gold < tavernPrice(s)) return
    if (s.roster.length >= s.rosterCap) {
      const worst = Math.min(...heroesIn(s, chosenParty(s)).map((h) => potential(s, h)))
      const benched = bench(s).map((hero) => ({ hero, score: potential(s, hero) }))
      if (benched.length === 0 || benched.some((b) => b.score > worst)) return
      benched.sort((a, b) => a.score - b.score)
      const out = benched.find((b) => accepted(seat.play({ t: 'dismiss', heroId: b.hero.id })))
      if (!out) return
      spent.dismissals += 1
      if (seat.state.gold < tavernPrice(seat.state)) return
    }
    if (!accepted(seat.play({ t: 'recruit' }))) return
    spent.recruits += 1
  }
}

/** Habit 3's second spend: one expansion when the inventory is full. */
function expandWhenFull(seat: Seat, spent: Spending): void {
  const s = seat.state
  if (s.inventory.length < s.inventoryCap) return
  const cost = nextExpansionCost(s, 'inventory')
  if (cost === null || s.gold < cost) return
  if (accepted(seat.play({ t: 'expand_inventory' }))) spent.expansions += 1
}

/** The index of the affix that rolled lowest in its range; -1 when the item has none. */
export function weakestAffix(item: Item): number {
  let index = -1
  let lowest = Number.POSITIVE_INFINITY
  item.affixes.forEach((affix, i) => {
    const def = content.affixes[affix.id]
    if (!def) return
    const [min, max] = def.range
    const share = max > min ? (affix.value - min) / (max - min) : 1
    if (share < lowest) {
      lowest = share
      index = i
    }
  })
  return index
}

/**
 * Habit 3's third spend: each item the party wears, once a turn end, rerolls its weakest affix
 * when the reforge costs under a tenth of the gold held.
 */
export function reforgeWorn(seat: Seat, spent: Spending): void {
  for (const id of chosenParty(seat.state)) {
    for (const slot of SLOTS) {
      const s = seat.state
      const itemId = s.roster.find((h) => h.id === id)?.equipment[slot]
      const item = itemId ? s.inventory.find((i) => i.id === itemId) : undefined
      if (!item) continue
      const affixIndex = weakestAffix(item)
      if (affixIndex < 0 || reforgeCost(item) * 10 >= s.gold) continue
      if (accepted(seat.play({ t: 'reforge', itemId: item.id, affixIndex }))) spent.reforges += 1
    }
  }
}

/** Habit 3, gold at a turn's end, in this order while gold allows: recruit, expand, reforge. */
export function spendGold(seat: Seat, spent: Spending): void {
  recruitAll(seat, spent)
  expandWhenFull(seat, spent)
  reforgeWorn(seat, spent)
}

/**
 * Habit 4's choice: one hero a class, the composition the probe, the starting party and the
 * reference rows assume. The lead Knight (`first` when the harness names one, its granted
 * Legendary), then the Black Mage and the White Mage, each the best of its class by potential.
 * Raw stats score neither a heal nor a sweep, so a party ranked on them alone fields Knights.
 */
export function bestParty(
  state: GameState,
  first: string | null = null,
): [string, string, string] | null {
  const scored = state.roster
    .map((hero) => ({ hero, score: potential(state, hero) }))
    .sort((a, b) => b.score - a.score)
  const best = (cls: HeroClass) => scored.find((x) => x.hero.cls === cls)?.hero.id
  const named = scored.find((x) => x.hero.id === first && x.hero.cls === 'knight')?.hero.id
  const lead = named ?? best('knight')
  const black = best('black_mage')
  const white = best('white_mage')
  if (!lead || !black || !white) return null
  return [lead, black, white]
}

/**
 * Habit 4, after a recruit: the best party, `set_party` only when it changes, then each of its
 * heroes in order takes the best gear it could wear, off the bench's backs if need be.
 */
export function pickParty(seat: Seat, spent: Spending, first: string | null = null): void {
  const party = bestParty(seat.state, first)
  const now = chosenParty(seat.state)
  if (!party) return
  const same = party[0] === now[0] && party.slice(1).every((id) => now.slice(1).includes(id))
  if (same) return
  if (!accepted(seat.play({ t: 'set_party', heroIds: party }))) return
  spent.partyChanges += 1
  const taken = new Set<string>()
  for (const id of party) {
    for (const slot of SLOTS) {
      const s = seat.state
      const hero = s.roster.find((h) => h.id === id)
      if (!hero) continue
      let best = hero.equipment[slot]
      let most = worth(heroStats(s, hero))
      for (const item of s.inventory) {
        const base = content.itemBases[item.base]
        if (base?.slot !== slot || !base.classes.includes(hero.cls) || taken.has(item.id)) continue
        if (item.equippedBy !== null && item.equippedBy !== id && party.includes(item.equippedBy))
          continue
        const w = worth(statsWith(s, hero, slot, item.id))
        if (w > most + EPSILON) {
          most = w
          best = item.id
        }
      }
      if (best === null) continue
      taken.add(best)
      if (best === hero.equipment[slot]) continue
      const item = s.inventory.find((i) => i.id === best)
      if (item?.equippedBy) seat.play({ t: 'unequip', heroId: item.equippedBy, slot })
      seat.play({ t: 'equip', heroId: id, itemId: best })
    }
  }
}

/**
 * Habit 5, disposal at a turn's end: each unworn item goes to a hero it raises, as at a drop, and
 * is vendored when none would wear it. Returns how many it vendored.
 */
export function dispose(seat: Seat): number {
  let vendored = 0
  for (const item of [...seat.state.inventory]) {
    const now = seat.state.inventory.find((i) => i.id === item.id)
    if (!now || now.equippedBy !== null) continue
    if (wear(seat, item.id)) continue
    if (accepted(seat.play({ t: 'vendor', itemId: item.id }))) vendored += 1
  }
  return vendored
}

/**
 * The dedicated player at a turn's end. It disposes first, so a full inventory is full of worn
 * gear; spends its gold; picks the party after a recruit, its own or a boss contract's
 * (`recruited`); and disposes of what the new party let go. Returns how many items it vendored.
 */
export function atTurnEnd(
  seat: Seat,
  spent: Spending,
  options: { recruited?: boolean; first?: string | null } = {},
): number {
  let vendored = dispose(seat)
  const before = spent.recruits
  spendGold(seat, spent)
  if (options.recruited || spent.recruits > before) pickParty(seat, spent, options.first ?? null)
  vendored += dispose(seat)
  return vendored
}
