import { Ledger, type LinkApprover } from '@promptfall/ledger'
import { type FetchLike, MemoryKeyValue } from '@promptfall/protocol'
import { describe, expect, it } from 'vitest'
import { githubApprover } from './github'

const DEVICE = 'https://github.com/login/device/code'
const TOKEN = 'https://github.com/login/oauth/access_token'
const USER = 'https://api.github.com/user'

type Call = { url: string; headers: Record<string, string>; body: string | undefined }

/** GitHub as the device flow answers it: one device code, then the token answers in order. */
function mockGitHub(tokenAnswers: unknown[], options: { device?: unknown; status?: number } = {}) {
  const calls: Call[] = []
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, headers: init.headers, body: init.body })
    const json = (status: number, body: unknown) => ({
      status,
      ok: status === 200,
      text: JSON.stringify(body),
    })
    if (url === DEVICE) {
      return json(
        options.status ?? 200,
        options.device ?? {
          device_code: 'device-secret',
          user_code: 'WDJB-MJHT',
          verification_uri: 'https://github.com/login/device',
          expires_in: 900,
          interval: 5,
        },
      )
    }
    if (url === TOKEN) return json(200, tokenAnswers.shift() ?? { error: 'authorization_pending' })
    if (url === USER) return json(200, { login: 'octocat', id: 1 })
    return json(404, { message: 'Not Found' })
  }
  return { fetch, calls }
}

function makeLedger(linkApprover: LinkApprover) {
  const kv = new MemoryKeyValue()
  let n = 0
  const ledger = new Ledger({
    kv,
    now: async () => 1_700_000_000_000,
    minClientVersion: '0.1.0',
    seedSource: () => 3,
    tokenSource: () => `token-${n++}`,
    linkApprover,
  })
  return { ledger, kv }
}

async function player(ledger: Ledger) {
  const boot = await ledger.bootstrap({ clientVersion: '0.1.0', deviceToken: null })
  return { deviceToken: boot.deviceToken }
}

/** Everything the store holds, as text: what a secret must never be part of. */
async function dump(kv: MemoryKeyValue): Promise<string> {
  const values = await Promise.all(kv.keys().map(async (k) => [k, await kv.get(k)]))
  return JSON.stringify(values)
}

describe('the GitHub approver', () => {
  it('the GitHub approver starts a device flow, polls until authorised and stores the login only', async () => {
    const github = mockGitHub([
      { error: 'authorization_pending' },
      { error: 'slow_down', interval: 10 },
      { access_token: 'gho_token-secret', token_type: 'bearer', scope: '' },
    ])
    const { ledger, kv } = makeLedger(
      githubApprover({ clientId: 'Iv1.client', fetch: github.fetch }),
    )
    const auth = await player(ledger)
    const start = await ledger.linkStart(auth)
    expect(start).toEqual({
      code: 'WDJB-MJHT',
      url: 'https://github.com/login/device',
      intervalMs: 5000,
    })
    expect(await ledger.linkPoll(auth, 'WDJB-MJHT')).toEqual({ status: 'pending' })
    expect(await ledger.linkPoll(auth, 'WDJB-MJHT')).toEqual({ status: 'pending' })
    const linked = await ledger.linkPoll(auth, 'WDJB-MJHT')
    if ('reason' in linked || linked.status !== 'linked') throw new Error('expected linked')
    expect(linked.account.linked).toEqual({ provider: 'github', login: 'octocat' })
    expect(linked.account.displayName).toBe('octocat')

    const [device, ...rest] = github.calls
    expect(device?.url).toBe(DEVICE)
    expect(new URLSearchParams(device?.body).get('client_id')).toBe('Iv1.client')
    const token = new URLSearchParams(rest[0]?.body)
    expect(token.get('device_code')).toBe('device-secret')
    expect(token.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:device_code')
    expect(rest.map((c) => c.url)).toEqual([TOKEN, TOKEN, TOKEN, USER])
    expect(rest.at(-1)?.headers.authorization).toBe('Bearer gho_token-secret')

    const stored = await dump(kv)
    expect(stored).toContain('octocat')
    expect(stored).not.toContain('gho_token-secret')
    expect(stored).not.toContain('device-secret')
  })

  it('a declined code ends the link unlinked with its message', async () => {
    const github = mockGitHub([{ error: 'access_denied' }])
    const { ledger } = makeLedger(githubApprover({ clientId: 'Iv1.client', fetch: github.fetch }))
    const auth = await player(ledger)
    await ledger.linkStart(auth)
    expect(await ledger.linkPoll(auth, 'WDJB-MJHT')).toEqual({
      status: 'ended',
      reason: 'denied',
      message: 'The link was declined on GitHub.',
    })
    const info = await ledger.account(auth)
    expect('account' in info && info.account.linked).toBeNull()
  })

  it('an expired code ends the link unlinked with its message', async () => {
    const github = mockGitHub([{ error: 'expired_token' }])
    const { ledger } = makeLedger(githubApprover({ clientId: 'Iv1.client', fetch: github.fetch }))
    const auth = await player(ledger)
    await ledger.linkStart(auth)
    expect(await ledger.linkPoll(auth, 'WDJB-MJHT')).toEqual({
      status: 'ended',
      reason: 'expired',
      message: 'The code expired before it was entered. Link again for a new one.',
    })
  })

  it('GitHub not answering a poll in time ends the link unlinked', async () => {
    const github = mockGitHub([])
    const fetch: FetchLike = (url, init) =>
      url === TOKEN ? new Promise(() => undefined) : github.fetch(url, init)
    const { ledger } = makeLedger(githubApprover({ clientId: 'Iv1.client', fetch, timeoutMs: 20 }))
    const auth = await player(ledger)
    await ledger.linkStart(auth)
    expect(await ledger.linkPoll(auth, 'WDJB-MJHT')).toEqual({
      status: 'ended',
      reason: 'unavailable',
      message: 'GitHub did not answer the link. Link again to retry.',
    })
  })

  it('a start GitHub refuses, or a missing client id, answers a refusal and asks GitHub nothing more', async () => {
    const refusing = mockGitHub([], { device: { error: 'device_flow_disabled' } })
    const a = makeLedger(githubApprover({ clientId: 'Iv1.client', fetch: refusing.fetch }))
    expect(await a.ledger.linkStart(await player(a.ledger))).toEqual({
      refusal: 'link_unavailable',
      message: 'GitHub did not start the link. Try again later.',
    })
    const silent = mockGitHub([])
    const b = makeLedger(githubApprover({ clientId: undefined, fetch: silent.fetch }))
    expect(await b.ledger.linkStart(await player(b.ledger))).toEqual({
      refusal: 'link_unavailable',
      message: 'This server cannot link GitHub accounts: it has no GitHub client id.',
    })
    expect(silent.calls).toEqual([])
  })
})
