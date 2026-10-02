import { compareCodeUnits } from './rng'
import type { GameState } from './types'

export function canonicalJson(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) {
    return `[${value.map((v) => (v === undefined ? 'null' : canonicalJson(v))).join(',')}]`
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    const parts: string[] = []
    for (const key of Object.keys(obj).sort(compareCodeUnits)) {
      const v = obj[key]
      if (v === undefined) continue
      parts.push(`${JSON.stringify(key)}:${canonicalJson(v)}`)
    }
    return `{${parts.join(',')}}`
  }
  return JSON.stringify(value)
}

export function fnv1a32(text: string, offset: number): number {
  let h = offset >>> 0
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h
}

function hex8(n: number): string {
  return n.toString(16).padStart(8, '0')
}

export function hashState(state: GameState): string {
  const json = canonicalJson(state)
  return hex8(fnv1a32(json, 0x811c9dc5)) + hex8(fnv1a32(json, 0x050c5d1f))
}
