import type { KeyValue } from './vendor/protocol.js'

const PREFIX = 'promptfall:'

/** `$.store`'s three calls, as closures written at the hook (the engine forbids passing `$`). */
export type StoreCalls = {
  get: (key: string) => Promise<unknown>
  set: (key: string, value: unknown) => Promise<void>
  delete: (key: string) => Promise<void>
}

/**
 * The fake server's KeyValue over `$.store`, every key under `promptfall:`.
 * Values pass through as they are; the store keeps JSON.
 */
export class StoreKeyValue implements KeyValue {
  constructor(private readonly store: StoreCalls) {}

  get(key: string): Promise<unknown> {
    return this.store.get(PREFIX + key)
  }

  set(key: string, value: unknown): Promise<void> {
    return this.store.set(PREFIX + key, value)
  }

  delete(key: string): Promise<void> {
    return this.store.delete(PREFIX + key)
  }
}
