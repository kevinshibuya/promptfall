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

const DeviceCode = z.object({
  device_code: z.string().min(1),
  user_code: z.string().min(1).max(32),
  verification_uri: z.string().url(),
  interval: z.number().int().positive(),
})
const TokenAnswer = z.union([
  z.object({ access_token: z.string().min(1) }),
  z.object({ error: z.string() }),
])
const User = z.object({ login: z.string().min(1).max(64) })

export type GitHubOptions = {
  /** The OAuth app's client id; without one every link start is refused. */
  clientId: string | undefined
  fetch: FetchLike
  /** A GitHub call that has not answered by then counts as no answer. Default 10 s. */
  timeoutMs?: number
  /** Operator notes: GitHub's error codes, never a code or a token. */
  log?: ((line: string) => void) | undefined
}

/**
 * GitHub's device flow as a link approver. The start asks GitHub for a device code; a poll
 * exchanges it for an access token, reads the login with it and drops the token there.
 */
export function githubApprover(options: GitHubOptions): LinkApprover {
  const { clientId, fetch } = options
  const timeoutMs = options.timeoutMs ?? 10_000
  const log = options.log ?? (() => undefined)
  const refused = (message: string): LinkRefused => ({ refusal: 'link_unavailable', message })
  const unavailable = { status: 'ended', reason: 'unavailable', message: UNAVAILABLE } as const

  async function call(url: string, init: Parameters<FetchLike>[1]): Promise<unknown> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const late = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`no answer in ${timeoutMs} ms`)), timeoutMs)
    })
    try {
      const response = await Promise.race([fetch(url, init), late])
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

  return {
    async start() {
      if (!clientId) return refused(NO_CLIENT_ID)
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
      return {
        code: device.data.user_code,
        url: device.data.verification_uri,
        intervalMs: device.data.interval * 1000,
        deviceCode: device.data.device_code,
      }
    },

    async poll(deviceCode) {
      if (!clientId) return unavailable
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
            case 'slow_down':
              return { status: 'pending' }
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
    },
  }
}

function errorOf(answer: unknown): string {
  const error = (answer as { error?: unknown } | null)?.error
  return typeof error === 'string' ? error : 'an answer without a device code'
}
