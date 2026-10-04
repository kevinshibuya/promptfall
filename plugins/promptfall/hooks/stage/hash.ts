/** UTF-8 bytes of a string, without TextEncoder (the stage modules use no platform global). */
function utf8(s: string): Uint8Array {
  const out: number[] = []
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0
    if (c < 0x80) out.push(c)
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f))
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f))
    else {
      out.push(
        0xf0 | (c >> 18),
        0x80 | ((c >> 12) & 0x3f),
        0x80 | ((c >> 6) & 0x3f),
        0x80 | (c & 0x3f),
      )
    }
  }
  return Uint8Array.from(out)
}

/** FNV-1a, 64 bits, as 16 hex chars; four 16-bit limbs keep the arithmetic exact. */
export function fnv1a64(input: Uint8Array | string): string {
  const bytes = typeof input === 'string' ? utf8(input) : input
  // 0xcbf29ce484222325, low limb first.
  let h0 = 0x2325
  let h1 = 0x8422
  let h2 = 0x9ce4
  let h3 = 0xcbf2
  for (let i = 0; i < bytes.length; i++) {
    h0 ^= bytes[i] ?? 0
    // × 0x100000001b3: the low limb 0x01b3 and 0x0100 at limb 2.
    const r0 = h0 * 0x1b3
    const r1 = h1 * 0x1b3
    const r2 = h2 * 0x1b3 + h0 * 0x100
    const r3 = h3 * 0x1b3 + h1 * 0x100
    h0 = r0 & 0xffff
    const c1 = r1 + Math.floor(r0 / 0x10000)
    h1 = c1 & 0xffff
    const c2 = r2 + Math.floor(c1 / 0x10000)
    h2 = c2 & 0xffff
    h3 = (r3 + Math.floor(c2 / 0x10000)) & 0xffff
  }
  return [h3, h2, h1, h0].map((limb) => limb.toString(16).padStart(4, '0')).join('')
}
