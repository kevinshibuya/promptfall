import type { On } from 'claude-code'
import { expect } from 'claude-code/testing'
import type { GameView } from '../../types'
import { test } from '../testing'
import { Ledger } from '../vendor/ledger.js'
import { MemoryKeyValue } from '../vendor/protocol.js'
import { harness } from './harness'

const URL_A = 'http://127.0.0.1:1'
const LEASE = 'promptfall:lease'

/** A remote server over the vendored ledger whose bootstraps wait while `hold` is set, until `release()`. */
function hanging(on: On) {
  const ledger = new Ledger({
    kv: new MemoryKeyValue(),
    now: async () => 1_000_000,
    minClientVersion: '0.1.0',
    seedSource: () => 777,
    tokenSource: () => crypto.randomUUID(),
    linkApprover: async () => ({ login: 'remote-player' }),
  })
  const net = { hold: false, held: 0, release: (() => undefined) as () => void }
  let gate = Promise.resolve()
  on('http.fetch', async (_$, e) => {
    const path = e.url.replace(/^https?:\/\/[^/]+/, '').split('?')[0] ?? ''
    const method = e.init?.method ?? 'GET'
    const auth = { deviceToken: (e.init?.headers?.authorization ?? '').replace(/^Bearer /, '') }
    const body = e.init?.body ? JSON.parse(e.init.body) : undefined
    const ok = (result: unknown) => ({
      value: { status: 200, ok: true, headers: {}, text: JSON.stringify(result) },
    })
    if (method === 'POST' && path === '/v1/bootstrap') {
      if (net.hold) {
        net.held += 1
        gate = new Promise<void>((resolve) => {
          net.release = resolve
        })
      }
      await gate
      return ok(await ledger.bootstrap(body))
    }
    if (method === 'POST' && path === '/v1/batches') return ok(await ledger.submit(body, auth))
    if (method === 'GET' && path === '/v1/account') return ok(await ledger.account(auth))
    return { value: { status: 404, ok: false, headers: {}, text: '{"error":"route"}' } }
  })
  return net
}

test('a prompt in a secondary session claims the lease without waiting for the promotion', async ($, on) => {
  const { data, states, clock } = harness(on, {
    'promptfall:server': URL_A,
    [LEASE]: { owner: 'other-tab', until: 9_999_999_999_999 },
  })
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  const net = hanging(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  expect(states.get('mode')).toBe('secondary')
  // The server stops answering bootstraps: the promotion's start hangs on it.
  net.hold = true
  let through = false
  const submitted = $.prompt
    .submit({ text: 'hi', wait: false, origin: { kind: 'composer' } })
    .then(() => {
      through = true
    })
  await clock.settle()
  // The prompt went through with the lease taken and the bootstrap still in flight.
  expect(through).toBe(true)
  expect(net.held).toBe(1)
  expect((data.get(LEASE) as { owner: string }).owner).toBe(states.get('leaseOwner'))
  // The promotion lands when the server answers, and the band follows: the engine plays.
  net.hold = false
  net.release()
  await submitted
  await clock.settle()
  expect(states.get('mode')).toBe('primary')
  const before = JSON.stringify(states.get('view'))
  await clock.advance(5_000)
  expect(JSON.stringify(states.get('view'))).not.toBe(before)
  expect((states.get('view') as GameView).account.server).toBe(URL_A)
})
