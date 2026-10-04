import { expect, test } from 'claude-code/testing'
import { decode } from '../sprites/base64'
import type { Frame } from './compose'
import { encodeImage, imageBytes } from './image'

const frame: Frame = {
  width: 2,
  height: 1,
  rgba: Uint8ClampedArray.of(1, 2, 3, 255, 0, 0, 0, 0),
}

test('scale 1 round-trips the frame bytes', () => {
  const img = encodeImage(frame, 1)
  expect([img.width, img.height]).toEqual([2, 1])
  expect([...decode(img.rgba)]).toEqual([...frame.rgba])
})

test('scale 2 doubles both dimensions and repeats each pixel 2 × 2', () => {
  const img = encodeImage(frame, 2)
  expect([img.width, img.height]).toEqual([4, 2])
  const px = [...decode(img.rgba)]
  const row = [1, 2, 3, 255, 1, 2, 3, 255, 0, 0, 0, 0, 0, 0, 0, 0]
  expect(px).toEqual([...row, ...row])
})

test('imageBytes is width * height * 4 * scale²', () => {
  expect(imageBytes(frame, 3)).toBe(2 * 1 * 4 * 9)
  expect(imageBytes(frame, 2)).toBe(decode(encodeImage(frame, 2).rgba).length)
})
