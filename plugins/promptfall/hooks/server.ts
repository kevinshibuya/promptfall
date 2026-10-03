import { Ledger } from './vendor/ledger.js'
import { type FetchLike, HttpClient, type KeyValue, type ServerClient } from './vendor/protocol.js'
import { CLIENT_VERSION } from './version'

export const IN_PROCESS = 'in-process'

export type ResolvedServer = {
  client: ServerClient
  /** The store key of this server's device token. */
  tokenKey: string
  label: string
  /** The in-process ledger's host, for its sweep; null for a remote server. */
  host: { sweep(): Promise<void> } | null
}

/**
 * The client for the machine's server setting: null is the in-process ledger
 * over the plugin store; a URL is the HTTP client, with a device token of its own.
 */
export function resolveClient(
  setting: string | null,
  io: { kv: KeyValue; now: () => Promise<number>; fetch: FetchLike },
): ResolvedServer {
  if (setting === null) {
    const ledger = new Ledger({
      kv: io.kv,
      now: io.now,
      speed: 1,
      minClientVersion: CLIENT_VERSION,
      seedSource: () => Number.parseInt(crypto.randomUUID().slice(0, 8), 16),
      tokenSource: () => crypto.randomUUID(),
      linkApprover: async () => ({ login: 'player' }),
    })
    return { client: ledger, tokenKey: 'deviceToken', label: IN_PROCESS, host: ledger.host }
  }
  return {
    client: new HttpClient({ baseUrl: setting, fetch: io.fetch }),
    tokenKey: `token:${setting}`,
    label: setting,
    host: null,
  }
}
