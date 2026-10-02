import { expect, test } from 'claude-code/testing'
import { acquire, LEASE_TTL_MS } from './lease'
import { MemoryKeyValue } from './vendor/protocol.js'

test('a second owner waits until the lease expires', async () => {
  const kv = new MemoryKeyValue()
  expect(await acquire(kv, 'a', 0)).toBe(true)
  expect(await acquire(kv, 'b', 0)).toBe(false)
  expect(await acquire(kv, 'b', LEASE_TTL_MS - 1)).toBe(false)
  expect(await acquire(kv, 'b', LEASE_TTL_MS)).toBe(true)
  expect(await acquire(kv, 'a', LEASE_TTL_MS)).toBe(false)
})

test('the holder renews', async () => {
  const kv = new MemoryKeyValue()
  expect(await acquire(kv, 'a', 0)).toBe(true)
  expect(await acquire(kv, 'a', 20_000)).toBe(true)
  expect(await acquire(kv, 'b', LEASE_TTL_MS)).toBe(false)
  expect(await acquire(kv, 'b', 20_000 + LEASE_TTL_MS)).toBe(true)
})
