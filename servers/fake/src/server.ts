import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Ledger, type LedgerFlag } from '@promptfall/ledger'
import {
  type Auth,
  BatchSchema,
  ChatBodySchema,
  type KeyValue,
  ListingQuerySchema,
  NewListingSchema,
  NewOrderSchema,
  ROUTES,
} from '@promptfall/protocol'
import { SIM_VERSION } from '@promptfall/sim'
import { type ZodType, z } from 'zod'

export type FakeServerOptions = {
  kv: KeyValue
  now: () => Promise<number>
  speed: number
  flags: Record<string, boolean>
  seedSource: () => number
  tokenSource: () => string
  playerName: string
  seed: number
}

export type FakeServer = {
  listen(port: number): Promise<{ port: number; close(): Promise<void> }>
  ledger: Ledger
}

type Request = {
  auth: Auth
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
    minClientVersion: '0.1.0',
    seedSource: options.seedSource,
    tokenSource: options.tokenSource,
    flags: options.flags as Partial<Record<LedgerFlag, boolean>>,
    linkApprover: async () => ({ login: options.playerName }),
  })

  const handlers: Record<keyof typeof ROUTES, Handler> = {
    health: async () => ({
      ok: true,
      simVersion: SIM_VERSION,
      seed: options.seed,
      speed: options.speed,
      now: await options.now(),
    }),
    bootstrap: (r) => ledger.bootstrap(parse(BootstrapBody, r.body)),
    submit: (r) => ledger.submit(parse(BatchSchema, r.body), r.auth),
    account: (r) => ledger.account(r.auth),
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

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Everything, routing included, sits inside the try: one bad request never escapes.
    try {
      const url = new URL(req.url ?? '/', 'http://fake')
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
      const result = await route.handler({ auth: authOf(req), params: route.params, query, body })
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
    listen(port: number) {
      const server = createServer((req, res) => {
        void handle(req, res)
      })
      return new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(port, '127.0.0.1', () => {
          const address = server.address() as AddressInfo
          resolve({
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
