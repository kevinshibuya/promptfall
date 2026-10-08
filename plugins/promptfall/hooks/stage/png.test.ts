import { expect, test } from 'claude-code/testing'
import { decode } from '../sprites/base64'
import { unzlibSync } from '../vendor/fflate.js'
import type { Frame } from './compose'
import { encodeImage, pngImage } from './image'
import { crc32 } from './png'

const frame: Frame = {
  width: 2,
  height: 2,
  rgba: Uint8ClampedArray.of(1, 2, 3, 255, 0, 0, 0, 0, 9, 8, 7, 128, 255, 255, 255, 255),
}

type Chunk = { type: string; data: Uint8Array; crcOk: boolean }

function chunks(bytes: Uint8Array): Chunk[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const out: Chunk[] = []
  let at = 8
  while (at < bytes.length) {
    const length = view.getUint32(at)
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8))
    const data = bytes.subarray(at + 8, at + 8 + length)
    const crc = view.getUint32(at + 8 + length)
    out.push({ type, data, crcOk: crc === crc32(bytes.subarray(at + 4, at + 8 + length)) })
    at += 12 + length
  }
  return out
}

test('crc32 matches the PNG reference value for an empty IEND', () => {
  expect(crc32(new TextEncoder().encode('IEND'))).toBe(0xae426082)
})

test('a PNG frame decodes to exactly the upscaled pixels the raw source carries', () => {
  const png = decode(pngImage(frame, 3).png)
  expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
  const all = chunks(png)
  expect(all.map((c) => c.type)).toEqual(['IHDR', 'IDAT', 'IEND'])
  expect(all.every((c) => c.crcOk)).toBe(true)
  const [head, body] = all
  if (!head || !body) throw new Error('missing chunks')
  const ihdr = new DataView(head.data.buffer, head.data.byteOffset, 13)
  // 6 × 6, 8 bits a channel, RGBA, deflate, no filter method extras, no interlace.
  expect([ihdr.getUint32(0), ihdr.getUint32(4)]).toEqual([6, 6])
  expect([...head.data.subarray(8)]).toEqual([8, 6, 0, 0, 0])
  // Each scanline: filter byte 0, then the row as the raw source has it.
  const raw = unzlibSync(body.data)
  const want = decode(encodeImage(frame, 3).rgba)
  const stride = 6 * 4
  for (let y = 0; y < 6; y++) {
    expect(raw[y * (stride + 1)]).toBe(0)
    expect([...raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))]).toEqual([
      ...want.subarray(y * stride, (y + 1) * stride),
    ])
  }
})

test('upscaled pixel art compresses: a 4x frame of flat colour is a small fraction of its raw size', () => {
  const big: Frame = { width: 240, height: 24, rgba: new Uint8ClampedArray(240 * 24 * 4).fill(90) }
  const raw = encodeImage(big, 4).rgba.length
  const png = pngImage(big, 4).png.length
  expect(png * 40).toBeLessThan(raw)
})
