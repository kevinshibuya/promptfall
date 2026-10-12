import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CUE_ASSET } from '../plugins/promptfall/hooks/cues'
import { buildCues, PEAK, SAMPLE_RATE } from './cues'

const PLUGIN = join(import.meta.dirname, '../plugins/promptfall')
const DIR = join(PLUGIN, 'cues')

/** The fields of a canonical 44-byte PCM WAV header, and its samples. */
function parseWav(buf: Buffer) {
  expect(buf.toString('ascii', 0, 4)).toBe('RIFF')
  expect(buf.readUInt32LE(4)).toBe(buf.length - 8)
  expect(buf.toString('ascii', 8, 16)).toBe('WAVEfmt ')
  expect(buf.toString('ascii', 36, 40)).toBe('data')
  const bytes = buf.readUInt32LE(40)
  expect(bytes).toBe(buf.length - 44)
  const samples = Array.from({ length: bytes / 2 }, (_, i) => buf.readInt16LE(44 + i * 2))
  return {
    format: buf.readUInt16LE(20),
    channels: buf.readUInt16LE(22),
    rate: buf.readUInt32LE(24),
    bits: buf.readUInt16LE(34),
    samples,
  }
}

describe('cues', () => {
  it('the folder holds exactly the cues the plugin knows', () => {
    expect(readdirSync(DIR).sort()).toEqual(
      Object.values(CUE_ASSET)
        .map((asset) => asset.replace(/^cues\//, ''))
        .sort(),
    )
    expect(Object.keys(buildCues()).sort()).toEqual(Object.keys(CUE_ASSET).sort())
  })

  it.each(Object.entries(CUE_ASSET))(
    '%s is mono 16-bit at 22,050 Hz, 150 to 900 ms, peaking near the target',
    (_, asset) => {
      const wav = parseWav(readFileSync(join(PLUGIN, asset)))
      expect(wav).toMatchObject({ format: 1, channels: 1, rate: 22_050, bits: 16 })
      const ms = (wav.samples.length * 1000) / SAMPLE_RATE
      expect(ms).toBeGreaterThanOrEqual(150)
      expect(ms).toBeLessThanOrEqual(900)
      const peak = Math.max(...wav.samples.map(Math.abs))
      expect(peak).toBeGreaterThanOrEqual(PEAK * 0.95)
      expect(peak).toBeLessThanOrEqual(PEAK * 1.05)
      // About half of full scale, so the loud step at gain 1.0 does not clip.
      expect(PEAK).toBeGreaterThan(32_767 * 0.4)
      expect(PEAK).toBeLessThan(32_767 * 0.6)
    },
  )

  it('two runs yield the same bytes, and the committed clips are what the script writes (pnpm cues:check)', () => {
    const a = buildCues()
    const b = buildCues()
    for (const [cue, asset] of Object.entries(CUE_ASSET)) {
      const bytes = a[cue as keyof typeof a]
      expect(bytes.equals(b[cue as keyof typeof b]), cue).toBe(true)
      expect(bytes.equals(readFileSync(join(PLUGIN, asset))), cue).toBe(true)
    }
  })
})
