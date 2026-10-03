import type { FetchLike } from '@promptfall/protocol'

/** Node's global fetch adapted to the protocol's FetchLike. */
export const nodeFetch: FetchLike = async (url, init) => {
  const r = await fetch(url, init)
  return { status: r.status, ok: r.ok, text: await r.text() }
}
