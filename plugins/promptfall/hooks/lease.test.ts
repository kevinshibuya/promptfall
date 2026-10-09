import { expect, test } from 'claude-code/testing'
import { acquire, claim, holds, LEASE_TTL_MS, release } from './lease'
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

test('release frees the lease only for its owner', async () => {
  const kv = new MemoryKeyValue()
  expect(await acquire(kv, 'a', 0)).toBe(true)
  await release(kv, 'b')
  expect(await acquire(kv, 'b', 1)).toBe(false)
  await release(kv, 'a')
  expect(await acquire(kv, 'b', 1)).toBe(true)
})

test('a claim overrides a live lease', async () => {
  const kv = new MemoryKeyValue()
  expect(await acquire(kv, 'a', 0)).toBe(true)
  expect(await claim(kv, 'b', 1)).toBe(true)
  expect(await holds(kv, 'b')).toBe(true)
  // The old holder sees the lease gone at its next flush or renewal, and steps back.
  expect(await holds(kv, 'a')).toBe(false)
  expect(await acquire(kv, 'a', 2)).toBe(false)
})
