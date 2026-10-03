import type { TradeKind } from '@promptfall/sim'
import type { z } from 'zod'
import type {
  AccountInfo,
  Auth,
  BatchAck,
  Bootstrap,
  LinkPoll,
  LinkStart,
  ServerClient,
} from './client'
import type {
  ListingPage,
  ListingQuery,
  MarketResult,
  MyOrders,
  NewOrder,
  Order,
  Unauthorized,
} from './market'
import {
  AccountResponseSchema,
  BatchAckSchema,
  BootstrapSchema,
  LinkPollResponseSchema,
  LinkStartResponseSchema,
  ListingPageResponseSchema,
  MarketResultSchema,
  MatchingOrdersResponseSchema,
  MyOrdersResponseSchema,
} from './responses'
import type { Batch } from './schemas'

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<{ status: number; ok: boolean; text: string }>

type Method = 'GET' | 'POST' | 'DELETE'

/** The phase 2 route table, base path included. `:id` marks a path segment. */
export const ROUTES = {
  health: { method: 'GET', path: '/v1/health' },
  bootstrap: { method: 'POST', path: '/v1/bootstrap' },
  submit: { method: 'POST', path: '/v1/batches' },
  account: { method: 'GET', path: '/v1/account' },
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
} as const satisfies Record<string, { method: Method; path: string }>

type Route = keyof typeof ROUTES

function failure(name: 'ServerUnreachable' | 'ServerError', message: string): Error {
  const error = new Error(message)
  error.name = name
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
      throw failure('ServerError', `${method} ${resolved}: status ${response.status}`)
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

  bootstrap(input: { clientVersion: string; deviceToken: string | null }): Promise<Bootstrap> {
    return this.call('bootstrap', BootstrapSchema, { body: input })
  }

  submit(batch: Batch, auth: Auth): Promise<BatchAck> {
    return this.call('submit', BatchAckSchema, { auth, body: batch })
  }

  account(auth: Auth): Promise<AccountInfo | Unauthorized> {
    return this.call('account', AccountResponseSchema, { auth })
  }

  linkStart(auth: Auth): Promise<LinkStart | Unauthorized> {
    return this.call('linkStart', LinkStartResponseSchema, { auth })
  }

  linkPoll(auth: Auth, code: string): Promise<LinkPoll | Unauthorized> {
    return this.call('linkPoll', LinkPollResponseSchema, { auth, body: { code } })
  }

  browse(auth: Auth, query: ListingQuery): Promise<ListingPage | Unauthorized> {
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

  myOrders(auth: Auth): Promise<MyOrders | Unauthorized> {
    return this.call('myOrders', MyOrdersResponseSchema, { auth })
  }

  placeOrder(auth: Auth, input: NewOrder): Promise<MarketResult> {
    return this.call('placeOrder', MarketResultSchema, { auth, body: input })
  }

  cancelOrder(auth: Auth, orderId: string): Promise<MarketResult> {
    return this.call('cancelOrder', MarketResultSchema, { auth, id: orderId })
  }

  matchingOrders(auth: Auth, itemId: string): Promise<Order[] | Unauthorized> {
    return this.call('matchingOrders', MatchingOrdersResponseSchema, { auth, query: { itemId } })
  }

  fillOrder(auth: Auth, orderId: string, itemId: string): Promise<MarketResult> {
    return this.call('fillOrder', MarketResultSchema, { auth, id: orderId, body: { itemId } })
  }
}
