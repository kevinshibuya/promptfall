import type { FetchLike } from '@promptfall/protocol'

/** Node's global fetch adapted to the protocol's FetchLike. */
export const nodeFetch: FetchLike = async (url, init) => {
  // The signal is typed by shape only; the one a caller passes here is the global AbortSignal.
  const r = await fetch(url, init as RequestInit)
  return { status: r.status, ok: r.ok, text: await r.text() }
}
