import type { KeyValue } from './vendor/protocol.js'

/** The real save's prefix; the machine's settings sit under it whichever save plays. */
export const PREFIX = 'promptfall:'
/** The sandbox save's prefix: its books, device token and lease. */
export const SANDBOX_PREFIX = 'promptfall-sandbox:'

/** `$.store`'s three calls, as closures written at the hook (the engine forbids passing `$`). */
export type StoreCalls = {
  get: (key: string) => Promise<unknown>
  set: (key: string, value: unknown) => Promise<void>
  delete: (key: string) => Promise<void>
  keys: () => Promise<string[]>
}

/**
 * The fake server's KeyValue over `$.store`, every key under one prefix:
 * `promptfall:` for the real save, `promptfall-sandbox:` for the sandbox.
 * Values pass through as they are; the store keeps JSON.
 */
export class StoreKeyValue implements KeyValue {
  constructor(
    private readonly store: StoreCalls,
    private readonly prefix: string = PREFIX,
  ) {}

  get(key: string): Promise<unknown> {
    return this.store.get(this.prefix + key)
  }

  set(key: string, value: unknown): Promise<void> {
    return this.store.set(this.prefix + key, value)
  }

  delete(key: string): Promise<void> {
    return this.store.delete(this.prefix + key)
  }

  /** The keys under the prefix, the prefix stripped. */
  async keys(): Promise<string[]> {
    const all = await this.store.keys()
    return all.filter((k) => k.startsWith(this.prefix)).map((k) => k.slice(this.prefix.length))
  }
}
