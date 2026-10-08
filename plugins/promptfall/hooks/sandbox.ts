import type { GameHandle } from './engine'

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

/** The account reset: books and token go, the lease and the settings stay, a fresh account boots. */
async function reset(game: GameHandle): Promise<string> {
  await game.reset()
  await game.settled()
  return 'Sandbox: the save starts over'
}

/** Every verb of the spec, in its order; the later tickets fill in `run`. */
export const SANDBOX_VERBS: readonly SandboxVerb[] = [
  { verb: 'boss', args: '<name>', help: 'make a zone or turn boss the next encounter', run: null },
  { verb: 'worldboss', args: '[end]', help: 'spawn a world boss now, or settle it', run: null },
  { verb: 'item', args: '<base> [rarity]', help: 'drop an item, common by default', run: null },
  { verb: 'level', args: '<hero> <n>', help: 'raise a hero to a level, up to its cap', run: null },
  { verb: 'gold', args: '<n>', help: 'add gold', run: gold },
  { verb: 'zone', args: '<n>', help: 'move the party to a zone at wave 1', run: null },
  { verb: 'recruit', args: '[rarity]', help: 'recruit a hero, common by default', run: null },
  { verb: 'wipe', args: '', help: 'make the party fall now', run: null },
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
