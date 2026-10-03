import type { LedgerFlag } from '@promptfall/ledger'

export const LEDGER_FLAGS: readonly LedgerFlag[] = [
  'market.enabled',
  'chat.enabled',
  'worldboss.enabled',
  'presence.enabled',
  'leaderboards.enabled',
  'maintenance',
]

/** `--flag <name>=<value>` values; throws naming the six flags on anything else. */
export function parseFlags(values: string[]): Partial<Record<LedgerFlag, boolean>> {
  const out: Partial<Record<LedgerFlag, boolean>> = {}
  for (const raw of values) {
    const [name, value, ...rest] = raw.split('=')
    const flag = LEDGER_FLAGS.find((f) => f === name)
    if (!flag || rest.length > 0 || (value !== 'true' && value !== 'false')) {
      throw new Error(
        `--flag wants <name>=true|false with a name among ${LEDGER_FLAGS.join(', ')}; got ${raw}`,
      )
    }
    out[flag] = value === 'true'
  }
  return out
}
