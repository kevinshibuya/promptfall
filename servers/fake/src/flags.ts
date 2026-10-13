import { type LedgerFlag, PLAYER_NAME_MAX } from '@promptfall/ledger'

export const LEDGER_FLAGS: readonly LedgerFlag[] = [
  'market.enabled',
  'chat.enabled',
  'worldboss.enabled',
  'presence.enabled',
  'leaderboards.enabled',
  'hunt.enabled',
  'maintenance',
  'sandbox.enabled',
]

/** `--flag <name>=<value>` values; throws naming the flags on anything else. */
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

/** `--player-name`, the login every link approves as: 1 to 64 characters, as the wire takes it. */
export function parsePlayerName(raw: string): string {
  if (raw.length < 1 || raw.length > PLAYER_NAME_MAX) {
    throw new Error(`--player-name wants 1 to ${PLAYER_NAME_MAX} characters; got ${raw.length}`)
  }
  return raw
}
