export interface KeyValue {
  get(key: string): Promise<unknown>
  set(key: string, value: unknown): Promise<void>
  delete(key: string): Promise<void>
  /** Optional: persist everything written since the last flush, atomically where the host can. The ledger calls it after every mutating operation. */
  flush?(): Promise<void>
}

/** In-memory KeyValue. Values round-trip through JSON, as they would through a store file. */
export class MemoryKeyValue implements KeyValue {
  private readonly data = new Map<string, string>()

  async get(key: string): Promise<unknown> {
    const raw = this.data.get(key)
    return raw === undefined ? undefined : JSON.parse(raw)
  }

  async set(key: string, value: unknown): Promise<void> {
    this.data.set(key, JSON.stringify(value))
  }

  async delete(key: string): Promise<void> {
    this.data.delete(key)
  }

  keys(): string[] {
    return [...this.data.keys()]
  }
}
