import { Ledger, type LedgerHost } from './vendor/ledger.js'
import { type FetchLike, HttpClient, type KeyValue, type ServerClient } from './vendor/protocol.js'
import { CLIENT_VERSION } from './version'

export const IN_PROCESS = 'in-process'

export type ResolvedServer = {
  client: ServerClient
  /** The store key of this server's device token. */
  tokenKey: string
  label: string
  /** The in-process ledger's host, for its sweep and the sandbox's grants; null for a remote server. */
  host: LedgerHost | null
  /** The sandbox's in-process ledger: links never approve. */
  sandbox: boolean
}

/**
 * The client for the machine's server setting: null is the in-process ledger
 * over the plugin store; a URL is the HTTP client, with a device token of its own.
 * The sandbox pins the in-process ledger, whatever the setting says.
 */
export function resolveClient(
  setting: string | null,
  io: { kv: KeyValue; now: () => Promise<number>; fetch: FetchLike },
  sandbox = false,
): ResolvedServer {
  if (setting === null || sandbox) {
    const ledger = new Ledger({
      kv: io.kv,
      now: io.now,
      speed: 1,
      minClientVersion: CLIENT_VERSION,
      seedSource: () => Number.parseInt(crypto.randomUUID().slice(0, 8), 16),
      tokenSource: () => crypto.randomUUID(),
      // Nothing a sandbox account holds may reach the market or chat: it never links.
      linkApprover: async () => (sandbox ? null : { login: 'player' }),
      // Chat and the world boss need other players: off on the in-process ledger.
      // The sandbox runs the world boss so boss mode can be seen, and takes the sandbox's grants.
      flags: { 'chat.enabled': false, 'worldboss.enabled': sandbox, 'sandbox.enabled': sandbox },
    })
    return {
      client: ledger,
      tokenKey: 'deviceToken',
      label: IN_PROCESS,
      host: ledger.host,
      sandbox,
    }
  }
  return {
    client: new HttpClient({ baseUrl: setting, fetch: io.fetch }),
    tokenKey: `token:${setting}`,
    label: setting,
    host: null,
    sandbox: false,
  }
}
