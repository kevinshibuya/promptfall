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

/** A wall clock the test moves by hand. */
function wallClock(start = 1_700_000_000_000) {
  let t = start
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms
    },
  }
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
    const wall = wallClock()
    const { ledger, kv } = makeLedger(
      githubApprover({ clientId: 'Iv1.client', fetch: github.fetch, now: wall.now }),
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
    // The slow_down's 10 s have not passed: pending, and GitHub is not asked.
    expect(await ledger.linkPoll(auth, 'WDJB-MJHT')).toEqual({ status: 'pending' })
    wall.advance(10_000)
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

  it('a slow_down delays the next GitHub call by the new interval and answers pending meanwhile', async () => {
    const github = mockGitHub([
      { error: 'slow_down', interval: 12 },
      { error: 'slow_down' },
      { error: 'slow_down' },
      { error: 'access_denied' },
    ])
    const wall = wallClock()
    const { ledger } = makeLedger(
      githubApprover({ clientId: 'Iv1.client', fetch: github.fetch, now: wall.now }),
    )
    const auth = await player(ledger)
    await ledger.linkStart(auth)
    const tokenCalls = () => github.calls.filter((c) => c.url === TOKEN).length
    const poll = () => ledger.linkPoll(auth, 'WDJB-MJHT')

    // The slow_down carries 12 s: no GitHub call until they pass.
    expect(await poll()).toEqual({ status: 'pending' })
    expect(tokenCalls()).toBe(1)
    wall.advance(11_999)
    expect(await poll()).toEqual({ status: 'pending' })
    expect(tokenCalls()).toBe(1)
    wall.advance(1)
    // A slow_down without an interval adds 5 s to the last one: 17 s.
    expect(await poll()).toEqual({ status: 'pending' })
    expect(tokenCalls()).toBe(2)
    wall.advance(16_999)
    expect(await poll()).toEqual({ status: 'pending' })
    expect(tokenCalls()).toBe(2)
    wall.advance(1)
    // A second one compounds: 22 s.
    expect(await poll()).toEqual({ status: 'pending' })
    expect(tokenCalls()).toBe(3)
    wall.advance(21_999)
    expect(await poll()).toEqual({ status: 'pending' })
    expect(tokenCalls()).toBe(3)
    wall.advance(1)
    expect(await poll()).toMatchObject({ status: 'ended', reason: 'denied' })
    expect(tokenCalls()).toBe(4)
  })

  it('after a slow_down every GitHub call keeps the slower pace', async () => {
    const github = mockGitHub([
      { error: 'slow_down', interval: 10 },
      { error: 'authorization_pending' },
      { error: 'access_denied' },
    ])
    const wall = wallClock()
    const { ledger } = makeLedger(
      githubApprover({ clientId: 'Iv1.client', fetch: github.fetch, now: wall.now }),
    )
    const auth = await player(ledger)
    await ledger.linkStart(auth)
    const tokenCalls = () => github.calls.filter((c) => c.url === TOKEN).length
    const poll = () => ledger.linkPoll(auth, 'WDJB-MJHT')

    await poll()
    wall.advance(10_000)
    expect(await poll()).toEqual({ status: 'pending' })
    expect(tokenCalls()).toBe(2)
    // The plugin polls again 5 s on; GitHub's pace is 10 s now, so it is not asked.
    wall.advance(5_000)
    expect(await poll()).toEqual({ status: 'pending' })
    expect(tokenCalls()).toBe(2)
    wall.advance(5_000)
    expect(await poll()).toMatchObject({ status: 'ended', reason: 'denied' })
    expect(tokenCalls()).toBe(3)
  })

  it("one player's slow_down does not delay another player's poll", async () => {
    const calls: string[] = []
    let devices = 0
    const fetch: FetchLike = async (url, init) => {
      const json = (body: unknown) => ({ status: 200, ok: true, text: JSON.stringify(body) })
      if (url === DEVICE) {
        const n = devices++
        return json({
          device_code: `device-${n}`,
          user_code: `CODE-${n}`,
          verification_uri: 'https://github.com/login/device',
          expires_in: 900,
          interval: 5,
        })
      }
      const device = new URLSearchParams(init.body).get('device_code') ?? ''
      calls.push(device)
      return json(
        device === 'device-0'
          ? { error: 'slow_down', interval: 30 }
          : { error: 'authorization_pending' },
      )
    }
    const wall = wallClock()
    const { ledger } = makeLedger(githubApprover({ clientId: 'Iv1.client', fetch, now: wall.now }))
    const a = await player(ledger)
    const b = await player(ledger)
    await ledger.linkStart(a)
    await ledger.linkStart(b)

    expect(await ledger.linkPoll(a, 'CODE-0')).toEqual({ status: 'pending' })
    expect(await ledger.linkPoll(a, 'CODE-0')).toEqual({ status: 'pending' })
    expect(await ledger.linkPoll(b, 'CODE-1')).toEqual({ status: 'pending' })
    expect(await ledger.linkPoll(b, 'CODE-1')).toEqual({ status: 'pending' })
    expect(calls).toEqual(['device-0', 'device-1', 'device-1'])
  })

  it('a device code past its 15-minute lifetime is no longer held back', async () => {
    const github = mockGitHub([{ error: 'slow_down', interval: 3600 }, { error: 'expired_token' }])
    const wall = wallClock()
    const { ledger } = makeLedger(
      githubApprover({ clientId: 'Iv1.client', fetch: github.fetch, now: wall.now }),
    )
    const auth = await player(ledger)
    await ledger.linkStart(auth)
    const tokenCalls = () => github.calls.filter((c) => c.url === TOKEN).length

    await ledger.linkPoll(auth, 'WDJB-MJHT')
    wall.advance(15 * 60_000)
    expect(await ledger.linkPoll(auth, 'WDJB-MJHT')).toEqual({ status: 'pending' })
    expect(tokenCalls()).toBe(1)
    wall.advance(1)
    expect(await ledger.linkPoll(auth, 'WDJB-MJHT')).toMatchObject({
      status: 'ended',
      reason: 'expired',
    })
    expect(tokenCalls()).toBe(2)
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

  it('a GitHub call that times out is aborted', async () => {
    const github = mockGitHub([])
    const signals: ({ readonly aborted: boolean } | undefined)[] = []
    const fetch: FetchLike = (url, init) => {
      if (url !== TOKEN) return github.fetch(url, init)
      signals.push(init.signal)
      return new Promise(() => undefined)
    }
    const { ledger } = makeLedger(githubApprover({ clientId: 'Iv1.client', fetch, timeoutMs: 20 }))
    const auth = await player(ledger)
    await ledger.linkStart(auth)
    expect(await ledger.linkPoll(auth, 'WDJB-MJHT')).toMatchObject({
      status: 'ended',
      reason: 'unavailable',
    })
    expect(signals).toHaveLength(1)
    expect(signals[0]?.aborted).toBe(true)
    const info = await ledger.account(auth)
    expect('account' in info && info.account.linked).toBeNull()
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
