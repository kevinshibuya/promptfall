// Writes the migration fixtures of the current sim version: `pnpm --filter @promptfall/sim fixture`.
// A bump runs it before the bump lands, since a version-N state can only be made by version N.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { GOLDEN_SEED, goldenEvents } from './golden'
import { heroStats } from './progression'
import { createInitialState } from './state'
import { replay, step } from './step'
import type { Effect, Event, GameState, HeroClass, Rarity, Slot } from './types'
import { SIM_VERSION } from './types'

const DEEP_SEED = 20261011
/**
 * Where the deep fixture's Epic and Rare take their wounds: deep enough to touch them, shallow
 * enough not to wipe. Zone 5 until version 8, whose tiered affixes made the kits outgrow it; zone 8
 * until version 12, whose thinner enemies died before they wounded both.
 */
const WOUND_ZONE = 9

/** Tier-4 weapons and tier-3 armour by class; the accessory is tier 4 for everyone. */
const KIT: Record<HeroClass, Record<Slot, string>> = {
  knight: { weapon: 'dragonfang', armour: 'mithril_mail', accessory: 'phoenix_pendant' },
  black_mage: { weapon: 'void_scepter', armour: 'sage_robe', accessory: 'phoenix_pendant' },
  white_mage: { weapon: 'seraph_staff', armour: 'sage_robe', accessory: 'phoenix_pendant' },
  archer: { weapon: 'starshot_bow', armour: 'shadow_leather', accessory: 'phoenix_pendant' },
}
const KIT_RARITY: Record<Slot, Rarity> = { weapon: 'epic', armour: 'rare', accessory: 'legendary' }
/** Bases the inventory is filled with past the kits: tier 3 and tier 4. */
const FILL: string[] = ['mithril_blade', 'storm_rod', 'gold_bangle', 'dragon_plate', 'wind_cloak']

class Script {
  state: GameState
  constructor(seed: number) {
    this.state = createInitialState(seed)
  }
  run(event: Event): Effect[] {
    const r = step(this.state, event)
    const rejected = r.effects.find((e) => e.k === 'rejected')
    if (rejected?.k === 'rejected') throw new Error(`${event.t} rejected: ${rejected.reason}`)
    this.state = r.state
    return r.effects
  }
  recruit(rarity: Rarity): string {
    const hero = this.run({ t: 'sandbox_recruit', rarity }).find((e) => e.k === 'hero_recruited')
    if (hero?.k !== 'hero_recruited') throw new Error('no recruit')
    return hero.hero.id
  }
  item(base: string, rarity: Rarity): string {
    const drop = this.run({ t: 'sandbox_item', base, rarity }).find(
      (e) => e.k === 'drop' && e.item.base === base,
    )
    if (drop?.k !== 'drop') throw new Error(`no drop of ${base}`)
    return drop.item.id
  }
}

function hurt(s: GameState, heroId: string): boolean {
  const hero = s.roster.find((h) => h.id === heroId)
  return hero !== undefined && hero.hp > 0 && hero.hp < heroStats(s, hero).hp
}

/** Zone 10, an Epic and a Rare wounded in tiered kit, a full inventory, gold, a world boss engaged. */
function deepFixture(): GameState {
  const script = new Script(DEEP_SEED)
  const knight = script.state.party[0]
  const epic = script.recruit('epic')
  const rare = script.recruit('rare')
  script.run({ t: 'sandbox_level', heroId: epic, level: 35 })
  script.run({ t: 'sandbox_level', heroId: rare, level: 25 })
  for (const heroId of [epic, rare]) {
    const hero = script.state.roster.find((h) => h.id === heroId)
    if (!hero) throw new Error(`no hero ${heroId}`)
    for (const slot of ['weapon', 'armour', 'accessory'] as const) {
      const itemId = script.item(KIT[hero.cls][slot], KIT_RARITY[slot])
      script.run({ t: 'equip', heroId, itemId })
    }
  }
  script.run({ t: 'set_party', heroIds: [knight, epic, rare] })
  script.run({ t: 'credited', gold: 12345, reason: 'fixture' })
  // The kits raised their maximum HP: rests fill it. Zone 10 wipes any party the game can make
  // today, so the wounds come from a shallower zone, and the sandbox moves the party on without a heal.
  for (let i = 0; i < 4; i++) script.run({ t: 'rest' })
  script.run({ t: 'sandbox_zone', zone: WOUND_ZONE })
  for (let i = 0; i < 200 && !(hurt(script.state, epic) && hurt(script.state, rare)); i++) {
    script.run({ t: 'tool_call' })
    script.run({ t: 'tick' })
  }
  if (!hurt(script.state, epic) || !hurt(script.state, rare) || script.state.zone !== WOUND_ZONE) {
    throw new Error(`the fight in zone ${WOUND_ZONE} did not wound the Epic and the Rare`)
  }
  script.run({ t: 'sandbox_zone', zone: 10 })
  for (let i = 0; script.state.inventory.length < script.state.inventoryCap; i++) {
    script.item(FILL[i % FILL.length] ?? 'mithril_blade', 'rare')
  }
  script.run({
    t: 'boss_engaged',
    bossId: 'wbdeep',
    name: 'Deep Wyrm',
    glyph: '☠',
    stats: { hp: 900, atk: 18, def: 6, spd: 5 },
  })
  return script.state
}

function goldenFixture(): GameState {
  return replay(createInitialState(GOLDEN_SEED), goldenEvents()).state
}

const dir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')
mkdirSync(dir, { recursive: true })
for (const [name, state] of [
  [`v${SIM_VERSION}.json`, goldenFixture()],
  [`v${SIM_VERSION}-deep.json`, deepFixture()],
] as const) {
  writeFileSync(join(dir, name), `${JSON.stringify(state, null, 2)}\n`)
  console.log(
    `${name}: zone ${state.zone}, ${state.roster.length} heroes, ${state.inventory.length} items`,
  )
}
