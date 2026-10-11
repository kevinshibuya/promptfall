import { type FetchLike, MemoryKeyValue } from '@promptfall/protocol'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createFakeServer } from './server'
import { smokeUrl } from './smoke-url'
import { nodeFetch } from './test-support'

let base = ''
let close: () => Promise<void> = async () => {}

beforeAll(async () => {
  let token = 0
  const server = createFakeServer({
    kv: new MemoryKeyValue(),
    now: async () => Date.now(),
    speed: 1,
    flags: {},
    seedSource: () => 7,
    tokenSource: () => `smoke-token-${++token}`,
    playerName: 'player',
    seed: 1,
  })
  const listening = await server.listen(0)
  base = `http://127.0.0.1:${listening.port}`
  close = listening.close
})

afterAll(() => close())

/** nodeFetch, with one route answering 500. */
function failing(path: string): FetchLike {
  return async (url, init) =>
    new URL(url).pathname === path
      ? { status: 500, ok: false, text: '{"error":"boom"}' }
      : nodeFetch(url, init)
}

describe('smokeUrl', () => {
  it('passes health, a bootstrap, one committed batch and one world poll', async () => {
    const lines: string[] = []
    await smokeUrl(`${base}/`, nodeFetch, (line) => lines.push(line))
    expect(lines).toEqual([
      expect.stringMatching(/^smoke: health ok, sim \d+$/),
      expect.stringMatching(/^smoke: bootstrap ok, account \S+$/),
      'smoke: batch ok, seq 1',
      expect.stringMatching(/^smoke: world ok, \d+ online$/),
    ])
  })

  it.each([
    ['/v1/health', /health/],
    ['/v1/bootstrap', /bootstrap/],
    ['/v1/batches', /batch/],
    ['/v1/world', /world/],
  ])('a failing %s fails the smoke and names the step', async (path, step) => {
    await expect(smokeUrl(base, failing(path), () => {})).rejects.toThrow(step)
  })

  it('an address nobody answers on fails at health', async () => {
    await expect(smokeUrl('http://127.0.0.1:9', nodeFetch, () => {})).rejects.toThrow(/^health: /)
  })
})
