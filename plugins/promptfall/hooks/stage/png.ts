// A PNG writer for the stage's pictures: 8-bit RGBA, one IDAT, no filtering. Upscaled pixel art
// repeats every pixel and every row, which deflate turns into long matches: a full-width stage
// frame of 442 KB as base64 RGBA is about 10 KB here.
import { encode } from '../sprites/base64'
import { zlibSync } from '../vendor/fflate.js'

const SIGNATURE = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10)

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

/** The PNG chunk CRC (ISO 3309) over `bytes`. */
export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++)
    c = (CRC_TABLE[(c ^ (bytes[i] ?? 0)) & 0xff] ?? 0) ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length)
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
  out.set(data, 8)
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
  return out
}

/** `width × height` RGBA pixels, row-major, as a whole PNG file. */
export function encodePng(rgba: Uint8Array, width: number, height: number): Uint8Array {
  const stride = width * 4
  // Each scanline is filter type 0 (none) and the row.
  const raw = new Uint8Array((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1)
  }
  const ihdr = new Uint8Array(13)
  const view = new DataView(ihdr.buffer)
  view.setUint32(0, width)
  view.setUint32(4, height)
  ihdr[8] = 8 // bits per channel
  ihdr[9] = 6 // RGBA
  // Level 1: a few ms a frame; level 6 halves the size again for little gain at a few KB.
  const parts = [
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlibSync(raw, { level: 1 })),
    chunk('IEND', new Uint8Array(0)),
  ]
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

/** Base64 through the runtime's `Uint8Array.prototype.toBase64` where it has one. */
export function toBase64(bytes: Uint8Array): string {
  const native = (bytes as Uint8Array & { toBase64?: () => string }).toBase64
  return typeof native === 'function' ? native.call(bytes) : encode(bytes)
}
