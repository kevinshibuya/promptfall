// Writes the four placeholder cues PR 1 ships: 160 ms square waves with a linear fade-out, 16-bit
// mono at 22,050 Hz. PR 2 replaces them with the CC0 picks. `tsx scripts/placeholder-cues.ts`.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const RATE = 22_050
const MS = 160
const AMPLITUDE = 0.35
const CUES: Record<string, number> = { drop: 440, legendary: 660, level_up: 880, boss: 220 }

function wav(hz: number): Buffer {
  const samples = Math.round((RATE * MS) / 1000)
  const data = Buffer.alloc(samples * 2)
  for (let i = 0; i < samples; i++) {
    const square = Math.floor((2 * i * hz) / RATE) % 2 === 0 ? 1 : -1
    const fade = 1 - i / samples
    data.writeInt16LE(Math.round(square * fade * AMPLITUDE * 32767), i * 2)
  }
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16) // PCM chunk size
  header.writeUInt16LE(1, 20) // PCM
  header.writeUInt16LE(1, 22) // mono
  header.writeUInt32LE(RATE, 24)
  header.writeUInt32LE(RATE * 2, 28) // byte rate
  header.writeUInt16LE(2, 32) // block align
  header.writeUInt16LE(16, 34) // bits per sample
  header.write('data', 36)
  header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data])
}

const out = join(import.meta.dirname, '../plugins/promptfall/cues')
mkdirSync(out, { recursive: true })
for (const [cue, hz] of Object.entries(CUES)) {
  const bytes = wav(hz)
  writeFileSync(join(out, `${cue}.wav`), bytes)
  console.log(`cues/${cue}.wav ${hz} Hz ${bytes.length} bytes`)
}
