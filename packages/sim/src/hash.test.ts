import { describe, expect, it } from 'vitest'
import { canonicalJson, fnv1a32, hashState } from './hash'
import { createInitialState } from './state'

describe('canonicalJson', () => {
  it('sorts nested keys and drops undefined', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { z: 1, y: null }], c: undefined } })).toBe(
      '{"a":{"d":[3,{"y":null,"z":1}]},"b":1}',
    )
  })

  it('sorts keys by UTF-16 code unit order', () => {
    expect(canonicalJson({ a: 1, B: 2, _: 3 })).toBe('{"B":2,"_":3,"a":1}')
  })
})

describe('hashState', () => {
  it('is 16 lowercase hex chars', () => {
    expect(hashState(createInitialState(1))).toMatch(/^[0-9a-f]{16}$/)
  })

  it('differs when one field differs', () => {
    const a = createInitialState(1)
    const b = { ...a, gold: 1 }
    expect(hashState(a)).not.toBe(hashState(b))
  })

  it('survives a JSON round trip', () => {
    const a = createInitialState(77)
    expect(hashState(JSON.parse(JSON.stringify(a)))).toBe(hashState(a))
  })

  it('uses two fnv1a32 offsets', () => {
    const text = canonicalJson(createInitialState(1))
    const expected =
      fnv1a32(text, 0x811c9dc5).toString(16).padStart(8, '0') +
      fnv1a32(text, 0x050c5d1f).toString(16).padStart(8, '0')
    expect(hashState(createInitialState(1))).toBe(expected)
  })
})
