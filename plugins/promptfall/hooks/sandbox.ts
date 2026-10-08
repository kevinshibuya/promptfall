import type { GameHandle } from './engine'
import { content, RARITIES, type Rarity, type SandboxEvent } from './vendor/sim.js'

export const SANDBOX_OFF = 'Sandbox is off. Start Claude Code with PROMPTFALL_SANDBOX=1.'
export const SANDBOX_PINS_SERVER =
  'The sandbox pins the server: Promptfall plays in-process while PROMPTFALL_SANDBOX=1'
const NOT_PLAYING = 'Promptfall is not playing in this session'

type SandboxVerb = {
  verb: string
  args: string
  help: string
  /** Answers the command's reply. Null: listed in the spec, not built yet. */
  run: ((game: GameHandle, args: string) => Promise<string>) | null
}

/** Authors a `credited` event with reason `sandbox`, then syncs so the gold is in the view. */
async function gold(game: GameHandle, args: string): Promise<string> {
  const n = Number(args)
  if (!/^\d+$/.test(args) || !Number.isSafeInteger(n) || n <= 0)
    return 'Usage: /promptfall sandbox gold <n>'
  const host = game.host()
  const accountId = game.accountId()
  if (!host || !accountId || !game.canApply()) return NOT_PLAYING
  await host.credit(accountId, n, 'sandbox')
  await game.sync()
  await game.settled()
  return `Sandbox: ${n} gold added`
}

/** A name a verb can match: display name and, where it has one, a content id. */
type Named = { name: string; id?: string }

/** A prefix of the display name, of any word in it, or of the id; case-insensitive. */
function matches(query: string, c: Named): boolean {
  const q = query.toLowerCase()
  const name = c.name.toLowerCase()
  return (
    name.startsWith(q) ||
    name.split(/\s+/).some((w) => w.startsWith(q)) ||
    (c.id?.toLowerCase().startsWith(q) ?? false)
  )
}

/** The one candidate `query` names, or the reply: several ask which one, none lists them all. */
function pick<T extends Named>(
  kind: string,
  plural: string,
  query: string,
  all: readonly T[],
): T | string {
  const found = all.filter((c) => matches(query, c))
  if (found.length === 1 && found[0]) return found[0]
  if (found.length > 1) return `Which one: ${found.map((c) => c.name).join(', ')}`
  return `No ${kind} named '${query}'\n${plural}: ${all.map((c) => c.name).join(', ')}`
}

const BOSSES = content.zones.flatMap((z) => [
  {
    id: z.boss,
    name: content.enemies[z.boss]?.name ?? z.boss,
    zone: z.index,
    boss: 'zone_boss' as const,
  },
  {
    id: z.turnBoss,
    name: content.enemies[z.turnBoss]?.name ?? z.turnBoss,
    zone: z.index,
    boss: 'turn_boss' as const,
  },
])
const ITEM_BASES = Object.values(content.itemBases).map((b) => ({ id: b.id, name: b.name }))
const RARITY_NAMES = RARITIES.map((name) => ({ name }))

function isRarity(s: string): s is Rarity {
  return (RARITIES as readonly string[]).includes(s)
}

/** The rarity `query` names, common when absent; otherwise the reply. */
function rarity(query: string | undefined): Rarity | string {
  if (query === undefined) return 'common'
  const found = pick('rarity', 'Rarities', query, RARITY_NAMES)
  return typeof found === 'string' ? found : found.name
}

/** What a refused grant answers, by the outcome's detail; a verb adds its own. */
const REFUSED: Record<string, string> = {
  boss_mode: 'Sandbox: not in boss mode',
  roster_full: 'Sandbox: roster full, nobody recruited',
}

/**
 * Asks the host to author `event`, then syncs so the grant is in the view before the reply.
 * Syncs first too: the ledger judges the grant against the state the player sees, and the
 * grant lands after every tick already played. Null when it applied; otherwise the reply.
 */
async function grant(
  game: GameHandle,
  event: SandboxEvent,
  refused: Record<string, string> = {},
): Promise<string | null> {
  const host = game.host()
  const accountId = game.accountId()
  if (!host || !accountId || !game.canApply()) return NOT_PLAYING
  await game.sync()
  const outcome = await host.sandbox(accountId, event)
  if (outcome.ok) {
    await game.sync()
    await game.settled()
    return null
  }
  if (outcome.reason === 'sandbox_off') return SANDBOX_OFF
  const detail = outcome.detail ?? outcome.reason
  return refused[detail] ?? REFUSED[detail] ?? `Sandbox: nothing changed (${detail})`
}

async function boss(game: GameHandle, args: string): Promise<string> {
  if (!args) return 'Usage: /promptfall sandbox boss <name>'
  const found = pick('boss', 'Bosses', args, BOSSES)
  if (typeof found === 'string') return found
  const refused = await grant(game, { t: 'sandbox_boss', zone: found.zone, boss: found.boss })
  return refused ?? `Sandbox: ${found.name} is next`
}

/** `<base> [rarity]`: the last word is the rarity unless the whole of `args` names a base. */
async function item(game: GameHandle, args: string): Promise<string> {
  const words = args.split(/\s+/).filter(Boolean)
  if (words.length === 0) return 'Usage: /promptfall sandbox item <base> [rarity]'
  const whole = ITEM_BASES.some((b) => matches(args, b))
  const query = whole || words.length === 1 ? args : words.slice(0, -1).join(' ')
  const r = rarity(whole || words.length === 1 ? undefined : words.at(-1))
  const base = pick('item', 'Items', query, ITEM_BASES)
  if (typeof base === 'string') return base
  if (!isRarity(r)) return r
  const before = new Set((await game.view())?.inventory.map((i) => i.id))
  const refused = await grant(game, { t: 'sandbox_item', base: base.id, rarity: r })
  if (refused) return refused
  const added = (await game.view())?.inventory.some((i) => !before.has(i.id)) ?? false
  return added
    ? `Sandbox: ${base.name} (${r}) dropped`
    : `Sandbox: ${base.name} vendored, inventory full`
}

async function level(game: GameHandle, args: string): Promise<string> {
  const words = args.split(/\s+/).filter(Boolean)
  const n = Number(words.at(-1))
  if (words.length < 2 || !Number.isSafeInteger(n) || n < 1)
    return 'Usage: /promptfall sandbox level <hero> <n>'
  const view = await game.view()
  if (!view) return NOT_PLAYING
  const hero = pick('hero', 'Heroes', words.slice(0, -1).join(' '), view.roster)
  if (typeof hero === 'string') return hero
  const cap = isRarity(hero.rarity) ? content.rarity[hero.rarity].levelCap : n
  const capLine = `Sandbox: ${hero.name} is level ${cap}, the ${hero.rarity} cap`
  const refused = await grant(
    game,
    { t: 'sandbox_level', heroId: hero.id, level: n },
    { level_not_above: `Sandbox: ${hero.name} is already level ${hero.level}`, level_cap: capLine },
  )
  if (refused) return refused
  const now = (await game.view())?.roster.find((h) => h.id === hero.id)?.level ?? n
  return n > now && now >= cap ? capLine : `Sandbox: ${hero.name} is level ${now}`
}

async function zone(game: GameHandle, args: string): Promise<string> {
  if (!/^\d+$/.test(args)) return 'Usage: /promptfall sandbox zone <n>'
  const n = Number(args)
  const def = content.zones[n - 1]
  if (!def) return `Sandbox: zones run 1 to ${content.zones.length}`
  const refused = await grant(game, { t: 'sandbox_zone', zone: n })
  return refused ?? `Sandbox: zone ${n}, ${def.name}`
}

async function recruit(game: GameHandle, args: string): Promise<string> {
  const r = rarity(args || undefined)
  if (!isRarity(r)) return r
  const before = new Set((await game.view())?.roster.map((h) => h.id))
  const refused = await grant(game, { t: 'sandbox_recruit', rarity: r })
  if (refused) return refused
  const hero = (await game.view())?.roster.find((h) => !before.has(h.id))
  return `Sandbox: ${hero?.name ?? 'a hero'} (${r}) recruited`
}

async function wipe(game: GameHandle): Promise<string> {
  const refused = await grant(game, { t: 'sandbox_wipe' })
  if (refused) return refused
  return `Sandbox: the party fell, retreating to zone ${(await game.view())?.zone ?? 1}`
}

/** The account reset: books and token go, the lease and the settings stay, a fresh account boots. */
async function reset(game: GameHandle): Promise<string> {
  await game.reset()
  await game.settled()
  return 'Sandbox: the save starts over'
}

/** Every verb of the spec, in its order; `worldboss` is filled in by its own ticket. */
export const SANDBOX_VERBS: readonly SandboxVerb[] = [
  { verb: 'boss', args: '<name>', help: 'make a zone or turn boss the next encounter', run: boss },
  { verb: 'worldboss', args: '[end]', help: 'spawn a world boss now, or settle it', run: null },
  { verb: 'item', args: '<base> [rarity]', help: 'drop an item, common by default', run: item },
  { verb: 'level', args: '<hero> <n>', help: 'raise a hero to a level, up to its cap', run: level },
  { verb: 'gold', args: '<n>', help: 'add gold', run: gold },
  { verb: 'zone', args: '<n>', help: 'move the party to a zone at wave 1', run: zone },
  { verb: 'recruit', args: '[rarity]', help: 'recruit a hero, common by default', run: recruit },
  { verb: 'wipe', args: '', help: 'make the party fall now', run: wipe },
  { verb: 'reset', args: '', help: 'start the sandbox save over', run: reset },
]

function listing(): string {
  const lines = SANDBOX_VERBS.map((v) => {
    const usage = v.args ? `${v.verb} ${v.args}` : v.verb
    return `  ${usage}: ${v.help}${v.run ? '' : ' (not yet)'}`
  })
  return ['Sandbox verbs, /promptfall sandbox <verb>:', ...lines].join('\n')
}

/**
 * `/promptfall sandbox [verb args]`, `rest` being what follows `sandbox`.
 * Every verb but `reset` claims the primary first, as the other gameplay verbs do.
 */
export async function runSandbox(
  rest: string,
  on: boolean,
  game: GameHandle | null,
): Promise<string> {
  if (!on) return SANDBOX_OFF
  if (rest === '') return listing()
  const [name = '', ...words] = rest.split(/\s+/)
  const verb = SANDBOX_VERBS.find((v) => v.verb === name.toLowerCase())
  if (!verb) return `No sandbox verb '${name}'.\n${listing()}`
  if (!verb.run) return `Sandbox: ${verb.verb} is not built yet`
  if (verb.verb !== 'reset') await game?.claim()
  if (!game) return NOT_PLAYING
  return verb.run(game, words.join(' '))
}
