import { createHash, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import {
  approveAs,
  Ledger,
  type LedgerFlag,
  PLAYER_NAME_MAX,
  SETTABLE_FLAGS,
  type SettableFlag,
} from '@promptfall/ledger'
import {
  type Auth,
  BatchSchema,
  type BootstrapRefused,
  ChatBodySchema,
  type FetchLike,
  type KeyValue,
  ListingQuerySchema,
  MIN_CLIENT_VERSION,
  NewListingSchema,
  NewOrderSchema,
  ROUTES,
} from '@promptfall/protocol'
import { SIM_VERSION } from '@promptfall/sim'
import { type ZodType, z } from 'zod'
import { githubApprover } from './github'
import { MINTS_PER_HOUR, MintCap } from './mint-cap'
import { nodeFetch } from './node-fetch'

export type FakeServerOptions = {
  kv: KeyValue
  now: () => Promise<number>
  speed: number
  flags: Record<string, boolean>
  seedSource: () => number
  tokenSource: () => string
  playerName: string
  seed: number
  /** The access log: one line per request, method, path, status and milliseconds. */
  log?: (line: string) => void
  /** Who approves a link: `fake` approves the first poll as `playerName`; `github` runs GitHub's device flow. Default `fake`. */
  link?: 'fake' | 'github'
  /** The GitHub OAuth app's client id; a `github` host without one refuses link starts. */
  githubClientId?: string | undefined
  /** How a `github` host reaches GitHub. Default Node's fetch. */
  githubFetch?: FetchLike
  /** Operator notes from the GitHub approver, never a code or a token. */
  githubLog?: (line: string) => void
  /** The bearer token of the admin routes; a host without one has no admin routes. */
  adminToken?: string | undefined
  /** One line per admin call: its time, action, target and outcome, never the token. */
  adminLog?: (line: string) => void
  /** Accounts one client address may mint per hour of the server's clock. Default 5. */
  mintsPerHour?: number
}

export type FakeServer = {
  /** Binds `host`, loopback unless told otherwise; a container passes 0.0.0.0. */
  listen(
    port: number,
    host?: string,
  ): Promise<{ host: string; port: number; close(): Promise<void> }>
  ledger: Ledger
}

type Request = {
  auth: Auth
  /** The client's address: the last hop of `x-forwarded-for`, else the connection's. */
  address: string
  params: Record<string, string>
  query: Record<string, string>
  body: unknown
}

type Handler = (req: Request) => Promise<unknown>

/** A body or query that failed its schema: answered 400. */
class SchemaError extends Error {
  constructor(readonly issues: unknown[]) {
    super('schema')
  }
}

const MAX_BODY = 1_000_000

const BootstrapBody = z.object({
  clientVersion: z.string().max(32),
  deviceToken: z.string().min(1).max(128).nullable(),
})
const CodeBody = z.object({ code: z.string().min(1).max(32) })
const ItemIdBody = z.object({ itemId: z.string().min(1).max(64) })

const rateLimited: BootstrapRefused = {
  refusal: 'rate_limited',
  message: 'Too many new accounts from this address. Promptfall will try again later.',
}

/** What an admin route did: its answer, and the target and outcome its log line names. */
type AdminDone = { target: string; answer: unknown; status?: number; outcome?: string }

/** An admin route: what it does with a body. */
type AdminRoute = {
  method: 'POST'
  path: string
  action: string
  run(body: unknown): Promise<AdminDone>
}

/** `POST /v1/admin/ban`'s body: the account and the reason its player reads, on one line. */
const BanBody = z.object({
  // One token: it is the log line's target.
  accountId: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[^\s\p{Cc}]+$/u),
  reason: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .refine((r) => !/\p{Cc}/u.test(r), 'the reason is one line of text'),
})

/** `POST /v1/admin/unban`'s body: the GitHub login, one token, in any case. */
const UnbanBody = z.object({
  login: z
    .string()
    .min(1)
    .max(PLAYER_NAME_MAX)
    .regex(/^[^\s\p{Cc}]+$/u),
})

/** `POST /v1/admin/flags`'s body: settable flags to booleans, at least one. */
function flagsBody(body: unknown): Partial<Record<SettableFlag, boolean>> {
  if (typeof body !== 'object' || body === null || Array.isArray(body))
    throw new SchemaError([{ message: 'flags want an object of flag names to true or false' }])
  const entries = Object.entries(body)
  if (entries.length === 0) throw new SchemaError([{ message: 'flags want at least one flag' }])
  const out: Partial<Record<SettableFlag, boolean>> = {}
  for (const [name, value] of entries) {
    if (name === 'sandbox.enabled')
      throw new SchemaError([{ message: 'sandbox.enabled is refused on the admin route' }])
    const flag = SETTABLE_FLAGS.find((f) => f === name)
    if (!flag || typeof value !== 'boolean') {
      throw new SchemaError([
        { message: `flags want true or false for ${SETTABLE_FLAGS.join(', ')}; got ${name}` },
      ])
    }
    out[flag] = value
  }
  return out
}

/** Equal tokens, compared in time that does not depend on where they differ. */
function sameToken(a: string, b: string): boolean {
  const digest = (s: string) => createHash('sha256').update(s).digest()
  return timingSafeEqual(digest(a), digest(b))
}

/**
 * The client's address. Behind Caddy the last hop of `x-forwarded-for` is the address Caddy saw;
 * a client can forge the hops before it, never that one.
 */
function addressOf(req: IncomingMessage): string {
  const forwarded = req.headers['x-forwarded-for']
  const header = Array.isArray(forwarded) ? forwarded[forwarded.length - 1] : forwarded
  const last = header?.split(',').pop()?.trim()
  return last || req.socket.remoteAddress || 'unknown'
}

function parse<T>(schema: ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value)
  if (!r.success) throw new SchemaError(r.error.issues)
  return r.data
}

/** `GET /v1/listings` query strings: numbers where the schema wants them, absent keys left out. */
function listingQuery(query: Record<string, string>): unknown {
  const out: Record<string, unknown> = {}
  for (const key of ['kind', 'base', 'cls', 'minRarity', 'sort'] as const) {
    if (query[key] !== undefined) out[key] = query[key]
  }
  const page = query.page
  out.page = page !== undefined && /^\d+$/.test(page) ? Number(page) : page
  return out
}

/** `GET /v1/world`'s chat mark: absent is 0, digits are the number, anything else is 400. */
function sinceOf(query: Record<string, string>): number {
  const since = query.since
  if (since === undefined) return 0
  if (!/^\d+$/.test(since))
    throw new SchemaError([{ message: 'since wants a non-negative integer' }])
  return Number(since)
}

function authOf(req: IncomingMessage): Auth {
  const header = req.headers.authorization ?? ''
  const match = /^Bearer (.+)$/.exec(header)
  return { deviceToken: match?.[1] ?? '' }
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buf = chunk as Buffer
    size += buf.length
    if (size > MAX_BODY) throw new SchemaError([{ message: 'body too large' }])
    chunks.push(buf)
  }
  if (size === 0) return undefined
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new SchemaError([{ message: 'body is not JSON' }])
  }
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(text),
  })
  res.end(text)
}

/** Matches `/v1/listings/:id/buy` against a path; segments decoded. */
function match(pattern: string, path: string): Record<string, string> | null {
  const a = pattern.split('/')
  const b = path.split('/')
  if (a.length !== b.length) return null
  const params: Record<string, string> = {}
  for (let i = 0; i < a.length; i++) {
    const p = a[i] ?? ''
    const v = b[i] ?? ''
    if (p.startsWith(':')) {
      if (v === '') return null
      try {
        params[p.slice(1)] = decodeURIComponent(v)
      } catch {
        // An undecodable segment names no resource: answered as an unknown route.
        return null
      }
    } else if (p !== v) {
      return null
    }
  }
  return params
}

export function createFakeServer(options: FakeServerOptions): FakeServer {
  const ledger = new Ledger({
    kv: options.kv,
    now: options.now,
    speed: options.speed,
    minClientVersion: MIN_CLIENT_VERSION,
    seedSource: options.seedSource,
    tokenSource: options.tokenSource,
    flags: options.flags as Partial<Record<LedgerFlag, boolean>>,
    linkApprover:
      options.link === 'github'
        ? githubApprover({
            clientId: options.githubClientId,
            fetch: options.githubFetch ?? nodeFetch,
            log: options.githubLog,
          })
        : approveAs(options.playerName),
  })

  const mintCap = new MintCap(options.mintsPerHour ?? MINTS_PER_HOUR)

  const handlers: Record<keyof typeof ROUTES, Handler> = {
    health: async () => ({
      ok: true,
      simVersion: SIM_VERSION,
      seed: options.seed,
      speed: options.speed,
      now: await options.now(),
    }),
    bootstrap: async (r) => {
      const input = parse(BootstrapBody, r.body)
      // Only a null token mints, so the cap takes from nothing else; the ledger stays address-blind.
      if (input.deviceToken !== null) return ledger.bootstrap(input)
      if (!mintCap.take(r.address, await options.now())) return rateLimited
      return ledger.bootstrap(input)
    },
    submit: (r) => ledger.submit(parse(BatchSchema, r.body), r.auth),
    account: (r) => ledger.account(r.auth),
    deleteAccount: (r) => ledger.deleteAccount(r.auth),
    linkStart: (r) => ledger.linkStart(r.auth),
    linkPoll: (r) => ledger.linkPoll(r.auth, parse(CodeBody, r.body).code),
    browse: (r) => ledger.browse(r.auth, parse(ListingQuerySchema, listingQuery(r.query))),
    list: (r) => ledger.list(r.auth, parse(NewListingSchema, r.body)),
    cancelListing: (r) => ledger.cancelListing(r.auth, r.params.id ?? ''),
    buy: (r) => ledger.buy(r.auth, r.params.id ?? ''),
    myOrders: (r) => ledger.myOrders(r.auth),
    placeOrder: (r) => ledger.placeOrder(r.auth, parse(NewOrderSchema, r.body)),
    cancelOrder: (r) => ledger.cancelOrder(r.auth, r.params.id ?? ''),
    matchingOrders: (r) => ledger.matchingOrders(r.auth, parse(ItemIdBody, r.query).itemId),
    fillOrder: (r) => ledger.fillOrder(r.auth, r.params.id ?? '', parse(ItemIdBody, r.body).itemId),
    world: (r) => ledger.world(r.auth, sinceOf(r.query)),
    chat: (r) => ledger.chat(r.auth, parse(ChatBodySchema, r.body).text),
    leaderboards: (r) => ledger.leaderboards(r.auth),
  }

  const table = (Object.keys(ROUTES) as (keyof typeof ROUTES)[]).map((name) => ({
    ...ROUTES[name],
    handler: handlers[name],
  }))

  const adminToken = options.adminToken
  const adminRoutes: AdminRoute[] = adminToken
    ? [
        {
          method: 'POST',
          path: '/v1/admin/flags',
          action: 'flags',
          run: async (body) => {
            const flags = flagsBody(body)
            const target = Object.entries(flags)
              .map(([name, value]) => `${name}=${value}`)
              .join(',')
            return { target, answer: { flags: await ledger.host.setFlags(flags) } }
          },
        },
        {
          method: 'POST',
          path: '/v1/admin/ban',
          action: 'ban',
          run: async (body) => {
            const { accountId, reason } = parse(BanBody, body)
            const banned = await ledger.host.ban(accountId, reason)
            if (!banned) {
              return {
                target: accountId,
                answer: { error: 'account' },
                status: 404,
                outcome: 'unknown',
              }
            }
            return { target: accountId, answer: { accountId, banned } }
          },
        },
        {
          method: 'POST',
          path: '/v1/admin/unban',
          action: 'unban',
          run: async (body) => {
            const { login } = parse(UnbanBody, body)
            const unbanned = await ledger.host.unban(login)
            if (!unbanned) {
              return {
                target: login.toLowerCase(),
                answer: { error: 'login' },
                status: 404,
                outcome: 'unknown',
              }
            }
            return { target: unbanned.login, answer: unbanned }
          },
        },
      ]
    : []

  /** An admin call: the admin token, then the route; one log line whatever the outcome. */
  async function admin(
    route: AdminRoute,
    req: IncomingMessage,
    res: ServerResponse,
    token: string,
  ): Promise<void> {
    const write = (target: string, outcome: string) =>
      options.adminLog?.(`admin ${new Date().toISOString()} ${route.action} ${target} ${outcome}`)
    if (!sameToken(authOf(req).deviceToken, token)) {
      req.resume()
      write('-', 'unauthorized')
      send(res, 401, { error: 'unauthorized' })
      return
    }
    let done: AdminDone
    try {
      done = await route.run(await readBody(req))
    } catch (error) {
      write('-', error instanceof SchemaError ? 'refused' : 'failed')
      throw error
    }
    write(done.target, done.outcome ?? 'ok')
    send(res, done.status ?? 200, done.answer)
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const log = options.log
    if (log) {
      // The path without its query, and never a header or a body: no token reaches the log.
      const started = performance.now()
      const path = (req.url ?? '/').split('?')[0]
      res.once('finish', () => {
        log(`${req.method} ${path} ${res.statusCode} ${Math.round(performance.now() - started)}ms`)
      })
    }
    // Everything, routing included, sits inside the try: one bad request never escapes.
    try {
      const url = new URL(req.url ?? '/', 'http://fake')
      const adminRoute = adminRoutes.find((r) => r.method === req.method && r.path === url.pathname)
      if (adminRoute && adminToken) {
        await admin(adminRoute, req, res, adminToken)
        return
      }
      let route: { handler: Handler; params: Record<string, string> } | null = null
      for (const entry of table) {
        if (entry.method !== req.method) continue
        const params = match(entry.path, url.pathname)
        if (params) {
          route = { handler: entry.handler, params }
          break
        }
      }
      if (!route) {
        // Drain the body so the connection can be reused.
        req.resume()
        send(res, 404, { error: 'route' })
        return
      }
      const body = await readBody(req)
      const query: Record<string, string> = {}
      for (const [key, value] of url.searchParams) query[key] = value
      const result = await route.handler({
        auth: authOf(req),
        address: addressOf(req),
        params: route.params,
        query,
        body,
      })
      send(res, 200, result)
    } catch (error) {
      if (error instanceof SchemaError) send(res, 400, { error: 'schema', issues: error.issues })
      else if (error instanceof z.ZodError)
        send(res, 400, { error: 'schema', issues: error.issues })
      else {
        console.error('promptfall fake: internal error', error)
        send(res, 500, { error: 'internal' })
      }
    }
  }

  return {
    ledger,
    listen(port: number, host = '127.0.0.1') {
      const server = createServer((req, res) => {
        void handle(req, res)
      })
      return new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(port, host, () => {
          const address = server.address() as AddressInfo
          resolve({
            host: address.address,
            port: address.port,
            close: () =>
              new Promise<void>((done, fail) => {
                server.close((err) => (err ? fail(err) : done()))
                server.closeAllConnections()
              }),
          })
        })
      })
    },
  }
}
