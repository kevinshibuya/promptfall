import { type CadenceSpec, loadCadence, REFERENCE } from './cadence'
import type { ScenarioOptions } from './scenario'

export const USAGE = `usage: harness [--seed N] [--hours N] [--legendary-at HOURS|off] [--rest-every N]
               [--cadence reference | --cadence fixed [--active BP] [--tool-every S] [--turn S]
                | --cadence-file PATH]
       harness --probe [--assert] [--tier N]`

export type Parsed =
  | { mode: 'run'; options: ScenarioOptions & { cadence: CadenceSpec } }
  | { mode: 'probe'; tier: number; assert: boolean }
  | { mode: 'error'; message: string }

const NUMBERS = ['seed', 'hours', 'rest-every', 'active', 'tool-every', 'turn', 'tier'] as const
const FIXED = ['active', 'tool-every', 'turn'] as const
const PROBE = ['tier', 'assert'] as const
const VALUED = [...NUMBERS, 'legendary-at', 'cadence', 'cadence-file'] as const
const SWITCHES = ['probe', 'assert'] as const

type Valued = (typeof VALUED)[number]

/** The CLI's flags. Every flag is known or refused, so a gate cannot pass on one it ignores. */
export function parseArgs(argv: readonly string[]): Parsed {
  const error = (message: string): Parsed => ({ mode: 'error', message })
  const values = new Map<Valued, string>()
  const switches = new Set<string>()
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? ''
    if (arg === '--') continue
    const name = arg.startsWith('--') ? arg.slice(2) : ''
    if ((SWITCHES as readonly string[]).includes(name)) switches.add(name)
    else if ((VALUED as readonly string[]).includes(name)) {
      const value = argv[i + 1]
      if (value === undefined || value.startsWith('--')) return error(`${arg} needs a value`)
      values.set(name as Valued, value)
      i += 1
    } else return error(`unknown argument ${arg}`)
  }
  const numbers = new Map<string, number>()
  for (const name of NUMBERS) {
    const raw = values.get(name)
    if (raw === undefined) continue
    const n = Number(raw)
    if (!Number.isFinite(n) || n < 0) return error(`--${name} takes a number, not ${raw}`)
    numbers.set(name, n)
  }
  const num = (name: string, fallback: number) => numbers.get(name) ?? fallback

  if (switches.has('probe') || values.has('tier')) {
    const stray = [...values.keys()].find((k) => !(PROBE as readonly string[]).includes(k))
    if (stray) return error(`--${stray} has no meaning with --probe`)
    return { mode: 'probe', tier: num('tier', 1), assert: switches.has('assert') }
  }
  if (switches.has('assert')) return error('--assert asserts the probe: it needs --probe')

  const kind = values.get('cadence') ?? 'reference'
  if (kind !== 'reference' && kind !== 'fixed') return error(`no cadence named ${kind}`)
  if (kind === 'fixed' && values.has('cadence-file')) {
    return error('--cadence fixed and --cadence-file are two cadences: pick one')
  }
  const fixedFlag = FIXED.find((name) => values.has(name))
  if (kind !== 'fixed' && fixedFlag) return error(`--${fixedFlag} needs --cadence fixed`)

  let cadence: CadenceSpec = REFERENCE
  if (kind === 'fixed') {
    cadence = {
      kind: 'fixed',
      activeShareBp: num('active', 6000),
      toolCallEverySec: num('tool-every', 8),
      turnLengthSec: num('turn', 90),
    }
    if (cadence.activeShareBp <= 0 || cadence.toolCallEverySec <= 0 || cadence.turnLengthSec <= 0) {
      return error('--active, --tool-every and --turn must be above 0')
    }
  }
  const file = values.get('cadence-file')
  if (file !== undefined) {
    try {
      cadence = loadCadence(file)
    } catch (e) {
      return error(`--cadence-file ${file}: ${(e as Error).message}`)
    }
  }

  const legendary = values.get('legendary-at')
  let legendaryAtHour: number | null | undefined
  if (legendary === 'off') legendaryAtHour = null
  else if (legendary !== undefined) {
    legendaryAtHour = Number(legendary)
    if (!Number.isFinite(legendaryAtHour) || legendaryAtHour < 0) {
      return error(`--legendary-at takes hours or off, not ${legendary}`)
    }
  }
  return {
    mode: 'run',
    options: {
      seed: num('seed', 7),
      hours: num('hours', 8),
      cadence,
      restEveryTurns: num('rest-every', 1),
      ...(legendaryAtHour === undefined ? {} : { legendaryAtHour }),
    },
  }
}
