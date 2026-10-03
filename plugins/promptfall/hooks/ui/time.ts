/** The last server clock seen: its time, the client's time then, and the virtual speed. */
export type ServerClock = { serverNow: number; clientNow: number; speed: number }

/**
 * Real milliseconds left until a server deadline. The server's clock runs
 * `speed` virtual ms per real ms (the HTTP fake's `--speed`), so a 24-hour
 * cooldown at speed 10 is 2.4 real hours.
 */
export function remainingRealMs(deadline: number, clock: ServerClock, clientNow: number): number {
  const serverNow = clock.serverNow + (clientNow - clock.clientNow) * clock.speed
  return (deadline - serverNow) / clock.speed
}

/** `3d 4h`, `16h`, `45m`, `<1m`. */
export function formatRemaining(ms: number): string {
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return '<1m'
  const hours = Math.floor(minutes / 60)
  if (hours < 1) return `${minutes}m`
  const days = Math.floor(hours / 24)
  if (days < 1) return `${hours}h`
  const rest = hours % 24
  return rest > 0 ? `${days}d ${rest}h` : `${days}d`
}
