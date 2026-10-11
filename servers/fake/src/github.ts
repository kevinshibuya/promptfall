import type { LinkApprover } from '@promptfall/ledger'
import type { FetchLike, LinkRefused } from '@promptfall/protocol'
import { z } from 'zod'

const DEVICE_URL = 'https://github.com/login/device/code'
const TOKEN_URL = 'https://github.com/login/oauth/access_token'
const USER_URL = 'https://api.github.com/user'
const GRANT = 'urn:ietf:params:oauth:grant-type:device_code'

const NO_CLIENT_ID = 'This server cannot link GitHub accounts: it has no GitHub client id.'
const NOT_STARTED = 'GitHub did not start the link. Try again later.'
const DENIED = 'The link was declined on GitHub.'
const EXPIRED = 'The code expired before it was entered. Link again for a new one.'
const UNAVAILABLE = 'GitHub did not answer the link. Link again to retry.'

/** What each `slow_down` adds to the interval when its answer carries none. */
const SLOW_DOWN_MS = 5_000
/** GitHub's interval for a device code it does not name one for. */
const DEFAULT_INTERVAL_MS = 5_000
/** A device code's lifetime on GitHub: no pace is kept for one older than this. */
const DEVICE_CODE_LIFETIME_MS = 15 * 60_000

const DeviceCode = z.object({
  device_code: z.string().min(1),
  user_code: z.string().min(1).max(32),
  verification_uri: z.string().url(),
  interval: z.number().int().positive(),
})
const TokenAnswer = z.union([
  z.object({ access_token: z.string().min(1) }),
  z.object({ error: z.string(), interval: z.number().positive().optional() }),
])
const User = z.object({ login: z.string().min(1).max(64) })

export type GitHubOptions = {
  /** The OAuth app's client id; without one every link start is refused. */
  clientId: string | undefined
  fetch: FetchLike
  /** A GitHub call that has not answered by then is aborted and counts as no answer. Default 10 s. */
  timeoutMs?: number
  /** Operator notes: GitHub's error codes, never a code or a token. */
  log?: ((line: string) => void) | undefined
  /** Wall time in ms for `slow_down`. Default the system clock, never the server's virtual clock. */
  now?: () => number
}

/**
 * One device code's pace: the interval GitHub holds it to, and when it may next be asked. A code
 * GitHub never slowed has no not-before: the plugin's own polls keep its pace.
 */
type Pace = { startedAt: number; intervalMs: number; notBefore: number | null }

/**
 * GitHub's device flow as a link approver. The start asks GitHub for a device code; a poll
 * exchanges it for an access token, reads the login with it and drops the token there.
 */
export function githubApprover(options: GitHubOptions): LinkApprover {
  const { clientId, fetch } = options
  const timeoutMs = options.timeoutMs ?? 10_000
  const log = options.log ?? (() => undefined)
  const now = options.now ?? Date.now
  const paces = new Map<string, Pace>()
  const refused = (message: string): LinkRefused => ({ refusal: 'link_unavailable', message })
  const unavailable = { status: 'ended', reason: 'unavailable', message: UNAVAILABLE } as const

  /** An abandoned or replaced flow never gets a final answer: its pace ends with its code. */
  function forgetExpired() {
    const oldest = now() - DEVICE_CODE_LIFETIME_MS
    for (const [deviceCode, pace] of paces) if (pace.startedAt < oldest) paces.delete(deviceCode)
  }

  async function call(url: string, init: Parameters<FetchLike>[1]): Promise<unknown> {
    const abort = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    // The race still ends the call when a fetch ignores its signal.
    const late = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        abort.abort()
        reject(new Error(`no answer in ${timeoutMs} ms`))
      }, timeoutMs)
    })
    try {
      const response = await Promise.race([fetch(url, { ...init, signal: abort.signal }), late])
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return JSON.parse(response.text)
    } finally {
      clearTimeout(timer)
    }
  }

  const form = (fields: Record<string, string>) => ({
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(fields).toString(),
  })

  /** One round of the token exchange, and the login read when GitHub hands a token. */
  async function exchange(
    clientId: string,
    deviceCode: string,
    pace: Pace | undefined,
  ): ReturnType<LinkApprover['poll']> {
    let token: string
    try {
      const answer = TokenAnswer.parse(
        await call(
          TOKEN_URL,
          form({ client_id: clientId, device_code: deviceCode, grant_type: GRANT }),
        ),
      )
      if ('error' in answer) {
        switch (answer.error) {
          case 'authorization_pending':
            // Once slowed, every call keeps the slower pace, not only the first one after it.
            if (pace?.notBefore != null) pace.notBefore = now() + pace.intervalMs
            return { status: 'pending' }
          case 'slow_down': {
            const intervalMs =
              answer.interval !== undefined
                ? answer.interval * 1000
                : (pace?.intervalMs ?? DEFAULT_INTERVAL_MS) + SLOW_DOWN_MS
            paces.set(deviceCode, {
              startedAt: pace?.startedAt ?? now(),
              intervalMs,
              notBefore: now() + intervalMs,
            })
            return { status: 'pending' }
          }
          case 'access_denied':
            return { status: 'ended', reason: 'denied', message: DENIED }
          case 'expired_token':
            return { status: 'ended', reason: 'expired', message: EXPIRED }
          default:
            log(`github: token: ${answer.error}`)
            return unavailable
        }
      }
      token = answer.access_token
    } catch (error) {
      log(`github: token: ${(error as Error).message}`)
      return unavailable
    }
    try {
      const user = User.parse(
        await call(USER_URL, {
          method: 'GET',
          headers: {
            accept: 'application/vnd.github+json',
            authorization: `Bearer ${token}`,
            'user-agent': 'promptfall',
            'x-github-api-version': '2022-11-28',
          },
        }),
      )
      // The token goes out of scope here: only the login leaves this function.
      return { status: 'approved', login: user.login }
    } catch (error) {
      log(`github: user: ${(error as Error).message}`)
      return unavailable
    }
  }

  return {
    async start() {
      if (!clientId) return refused(NO_CLIENT_ID)
      forgetExpired()
      let answer: unknown
      try {
        answer = await call(DEVICE_URL, form({ client_id: clientId }))
      } catch (error) {
        log(`github: device code: ${(error as Error).message}`)
        return refused(NOT_STARTED)
      }
      const device = DeviceCode.safeParse(answer)
      if (!device.success) {
        log(`github: device code: ${errorOf(answer)}`)
        return refused(NOT_STARTED)
      }
      paces.set(device.data.device_code, {
        startedAt: now(),
        intervalMs: device.data.interval * 1000,
        notBefore: null,
      })
      return {
        code: device.data.user_code,
        url: device.data.verification_uri,
        intervalMs: device.data.interval * 1000,
        deviceCode: device.data.device_code,
      }
    },

    async poll(deviceCode) {
      if (!clientId) return unavailable
      forgetExpired()
      const pace = paces.get(deviceCode)
      // GitHub asked for a slower pace: answer for it rather than be told off again.
      if (pace?.notBefore != null && now() < pace.notBefore) return { status: 'pending' }
      const answer = await exchange(clientId, deviceCode, pace)
      if (answer.status !== 'pending') paces.delete(deviceCode)
      return answer
    },
  }
}

function errorOf(answer: unknown): string {
  const error = (answer as { error?: unknown } | null)?.error
  return typeof error === 'string' ? error : 'an answer without a device code'
}
