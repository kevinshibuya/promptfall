import type { TradeKind } from '@promptfall/sim'
import type { z } from 'zod'
import type {
  AccountDeleted,
  AccountInfo,
  Auth,
  BatchAck,
  Bootstrap,
  BootstrapRefused,
  LinkPoll,
  LinkRefused,
  LinkStart,
  ServerClient,
} from './client'
import type {
  Banned,
  ListingPage,
  ListingQuery,
  MarketResult,
  MyOrders,
  NewOrder,
  Order,
  Unauthorized,
} from './market'
import {
  AccountDeletedResponseSchema,
  AccountResponseSchema,
  BatchAckSchema,
  BoardsResponseSchema,
  BootstrapResponseSchema,
  LinkPollResponseSchema,
  LinkStartResponseSchema,
  ListingPageResponseSchema,
  MarketResultSchema,
  MatchingOrdersResponseSchema,
  MyOrdersResponseSchema,
  WorldResponseSchema,
} from './responses'
import type { Batch } from './schemas'
import { type Boards, type ChatResult, ChatResultSchema, type WorldSnapshot } from './world'

/**
 * The part of an abort signal a fetch reads, typed by its shape: the vendor build compiles with
 * no platform library, and the global signal satisfies it.
 */
export type AbortSignalLike = { readonly aborted: boolean }

export type FetchLike = (
  url: string,
  init: {
    method: string
    headers: Record<string, string>
    body?: string
    /** Aborting it cancels the request. */
    signal?: AbortSignalLike
  },
) => Promise<{ status: number; ok: boolean; text: string }>

type Method = 'GET' | 'POST' | 'DELETE'

/** The route table, base path included. `:id` marks a path segment. */
export const ROUTES = {
  health: { method: 'GET', path: '/v1/health' },
  bootstrap: { method: 'POST', path: '/v1/bootstrap' },
  submit: { method: 'POST', path: '/v1/batches' },
  account: { method: 'GET', path: '/v1/account' },
  deleteAccount: { method: 'DELETE', path: '/v1/account' },
  linkStart: { method: 'POST', path: '/v1/link/github' },
  linkPoll: { method: 'POST', path: '/v1/link/github/poll' },
  browse: { method: 'GET', path: '/v1/listings' },
  list: { method: 'POST', path: '/v1/listings' },
  cancelListing: { method: 'DELETE', path: '/v1/listings/:id' },
  buy: { method: 'POST', path: '/v1/listings/:id/buy' },
  myOrders: { method: 'GET', path: '/v1/orders' },
  placeOrder: { method: 'POST', path: '/v1/orders' },
  cancelOrder: { method: 'DELETE', path: '/v1/orders/:id' },
  matchingOrders: { method: 'GET', path: '/v1/orders/matching' },
  fillOrder: { method: 'POST', path: '/v1/orders/:id/fill' },
  world: { method: 'GET', path: '/v1/world' },
  chat: { method: 'POST', path: '/v1/chat' },
  leaderboards: { method: 'GET', path: '/v1/leaderboards' },
} as const satisfies Record<string, { method: Method; path: string }>

type Route = keyof typeof ROUTES

/** A transport failure; a non-200 carries its `status`, so a 4xx (never going to succeed) can be told from a 5xx. */
function failure(
  name: 'ServerUnreachable' | 'ServerError',
  message: string,
  status?: number,
): Error & { status?: number } {
  const error: Error & { status?: number } = new Error(message)
  error.name = name
  if (status !== undefined) error.status = status
  return error
}

/** `key=value` pairs joined by `&`, undefined values left out. No URLSearchParams: the vendor bundle has no platform globals. */
function queryString(params: Record<string, string | number | undefined>): string {
  const parts: string[] = []
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue
    parts.push(`${key}=${encodeURIComponent(String(value))}`)
  }
  return parts.length > 0 ? `?${parts.join('&')}` : ''
}

/**
 * The ServerClient over HTTP. It never retries: the engine owns retries. Ledger
 * refusals come back as values; transport failures throw `ServerUnreachable`
 * (the fetch threw) or `ServerError` (not 200, or a body failing its schema).
 */
export class HttpClient implements ServerClient {
  private readonly baseUrl: string
  private readonly fetch: FetchLike

  constructor(options: { baseUrl: string; fetch: FetchLike }) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '')
    this.fetch = options.fetch
  }

  private async call<T>(
    route: Route,
    schema: z.ZodType<T>,
    options: {
      auth?: Auth
      id?: string
      body?: unknown
      query?: Record<string, string | number | undefined>
    } = {},
  ): Promise<T> {
    const { method, path } = ROUTES[route]
    const resolved =
      options.id === undefined ? path : path.replace(':id', encodeURIComponent(options.id))
    const url = this.baseUrl + resolved + (options.query ? queryString(options.query) : '')
    const headers: Record<string, string> = {}
    const init: { method: string; headers: Record<string, string>; body?: string } = {
      method,
      headers,
    }
    if (options.body !== undefined) {
      headers['content-type'] = 'application/json'
      init.body = JSON.stringify(options.body)
    }
    if (options.auth) headers.authorization = `Bearer ${options.auth.deviceToken}`
    let response: Awaited<ReturnType<FetchLike>>
    try {
      response = await this.fetch(url, init)
    } catch (error) {
      throw failure('ServerUnreachable', `${method} ${resolved}: ${String(error)}`)
    }
    if (response.status !== 200) {
      throw failure(
        'ServerError',
        `${method} ${resolved}: status ${response.status}`,
        response.status,
      )
    }
    let body: unknown
    try {
      body = JSON.parse(response.text)
    } catch {
      throw failure('ServerError', `${method} ${resolved}: body is not JSON`)
    }
    const parsed = schema.safeParse(body)
    if (!parsed.success) {
      throw failure('ServerError', `${method} ${resolved}: unexpected body`)
    }
    return parsed.data
  }

  bootstrap(input: {
    clientVersion: string
    deviceToken: string | null
  }): Promise<Bootstrap | BootstrapRefused> {
    return this.call('bootstrap', BootstrapResponseSchema, { body: input })
  }

  submit(batch: Batch, auth: Auth): Promise<BatchAck> {
    return this.call('submit', BatchAckSchema, { auth, body: batch })
  }

  account(auth: Auth): Promise<AccountInfo | Unauthorized | Banned> {
    return this.call('account', AccountResponseSchema, { auth })
  }

  deleteAccount(auth: Auth): Promise<AccountDeleted | Unauthorized | Banned> {
    return this.call('deleteAccount', AccountDeletedResponseSchema, { auth })
  }

  linkStart(auth: Auth): Promise<LinkStart | LinkRefused | Unauthorized | Banned> {
    return this.call('linkStart', LinkStartResponseSchema, { auth })
  }

  linkPoll(auth: Auth, code: string): Promise<LinkPoll | Unauthorized | Banned> {
    return this.call('linkPoll', LinkPollResponseSchema, { auth, body: { code } })
  }

  browse(auth: Auth, query: ListingQuery): Promise<ListingPage | Unauthorized | Banned> {
    const { kind, base, cls, minRarity, sort, page } = query
    return this.call('browse', ListingPageResponseSchema, {
      auth,
      query: { kind, base, cls, minRarity, sort, page },
    })
  }

  list(auth: Auth, input: { kind: TradeKind; id: string; price: number }): Promise<MarketResult> {
    return this.call('list', MarketResultSchema, { auth, body: input })
  }

  cancelListing(auth: Auth, listingId: string): Promise<MarketResult> {
    return this.call('cancelListing', MarketResultSchema, { auth, id: listingId })
  }

  buy(auth: Auth, listingId: string): Promise<MarketResult> {
    return this.call('buy', MarketResultSchema, { auth, id: listingId })
  }

  myOrders(auth: Auth): Promise<MyOrders | Unauthorized | Banned> {
    return this.call('myOrders', MyOrdersResponseSchema, { auth })
  }

  placeOrder(auth: Auth, input: NewOrder): Promise<MarketResult> {
    return this.call('placeOrder', MarketResultSchema, { auth, body: input })
  }

  cancelOrder(auth: Auth, orderId: string): Promise<MarketResult> {
    return this.call('cancelOrder', MarketResultSchema, { auth, id: orderId })
  }

  matchingOrders(auth: Auth, itemId: string): Promise<Order[] | Unauthorized | Banned> {
    return this.call('matchingOrders', MatchingOrdersResponseSchema, { auth, query: { itemId } })
  }

  fillOrder(auth: Auth, orderId: string, itemId: string): Promise<MarketResult> {
    return this.call('fillOrder', MarketResultSchema, { auth, id: orderId, body: { itemId } })
  }

  world(auth: Auth, since: number): Promise<WorldSnapshot | Unauthorized | Banned> {
    return this.call('world', WorldResponseSchema, { auth, query: { since } })
  }

  chat(auth: Auth, text: string): Promise<ChatResult> {
    return this.call('chat', ChatResultSchema, { auth, body: { text } })
  }

  leaderboards(auth: Auth): Promise<Boards | Unauthorized | Banned> {
    return this.call('leaderboards', BoardsResponseSchema, { auth })
  }
}
