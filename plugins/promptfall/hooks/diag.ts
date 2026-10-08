// TEMPORARY diagnostics (fix/play-feel): frame pacing, render cost, bytes sent and layout changes,
// buffered in memory and written as numbered chunk files. Remove before the branch lands.

const DIR =
  '/private/tmp/claude-501/-Users-luizarazzera-keki-dev-personal-projects-tbh-cc-mod/77c92daf-2175-4644-ac16-609296702fc0/scratchpad/pf-trace'
const CHUNK_LINES = 2000

let lines: string[] = []
let chunk = 0
const t0 = Date.now()

/** One trace line: ms since load, a tag, then key=value pairs. */
export function trace(tag: string, fields: Record<string, string | number | boolean>): void {
  const kv = Object.entries(fields)
    .map(([k, v]) => `${k}=${typeof v === 'number' ? Math.round(v * 10) / 10 : v}`)
    .join(' ')
  lines.push(`${Date.now() - t0} ${tag} ${kv}`)
  maybeFlush()
}

/** Size in bytes of what a blit or a tree carries for its picture. */
export function payloadBytes(x: { cells?: string; source?: unknown }): number {
  if (typeof x.cells === 'string') return x.cells.length
  const s = x.source as { rgba?: string } | string | undefined
  if (typeof s === 'string') return s.length
  return s?.rgba?.length ?? 0
}

let writer: ((path: string, text: string) => Promise<void>) | null = null
let lastFlush = 0

export function setTraceWriter(write: (path: string, text: string) => Promise<void>): void {
  writer = write
}

/** Rewrites the current chunk at most every 2 s; starts a new one once it is full. */
function maybeFlush(): void {
  const now = Date.now()
  if (writer === null || now - lastFlush < 2000) return
  lastFlush = now
  const full = lines.length >= CHUNK_LINES
  const text = `${lines.join('\n')}\n`
  const path = `${DIR}/trace-${t0}-${String(chunk).padStart(3, '0')}.log`
  if (full) {
    lines = []
    chunk += 1
  }
  writer(path, text).catch(() => {})
}
