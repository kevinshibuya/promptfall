// Writes the eight sound cues into plugins/promptfall/cues/ (spec §10, "The generator"): mono,
// 16-bit, 22,050 Hz, in the Final Fantasy register, a pulse lead over a triangle bass, one tempo
// base and a short envelope on every note. Every value is an integer, every division is floored
// or truncated, the noise is a xorshift of the script's own and the pitches are a hard-coded
// table, so no transcendental function runs and the bytes are the same on every machine and Node
// version: `pnpm cues:check` fails CI when the committed clips are stale.
//
// No doubled asterisk appears in this file, comments included: the ticket's Verify greps for it.
//
// tsx scripts/cues.ts
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CUE_ASSET, type Cue } from '../plugins/promptfall/hooks/cues'

export const SAMPLE_RATE = 22_050
// Every clip's peak: about half of full scale, so the loud step at gain 1.0 does not clip.
export const PEAK = 16_384
// The tempo base: a tick is 1/30 s, three ticks a step of 100 ms, a sixteenth at 150 bpm.
const TICK = 735
// The release after a note's gate, and the envelope's full level.
const RELEASE = 2 * TICK
const ENV = 1024
// A phase accumulator wraps at the sample rate in centihertz: a note adds its pitch each sample.
const PHASE = SAMPLE_RATE * 100

// Equal-tempered pitches in centihertz from C2 to C7, A4 = 440 Hz, rounded once and written here
// because a twelfth root of two is irrational.
// biome-ignore format: twelve notes to a row, one octave each
const PITCH = [
  6541, 6930, 7342, 7778, 8241, 8731, 9250, 9800, 10383, 11000, 11654, 12347,
  13081, 13859, 14683, 15556, 16481, 17461, 18500, 19600, 20765, 22000, 23308, 24694,
  26163, 27718, 29366, 31113, 32963, 34923, 36999, 39200, 41530, 44000, 46616, 49388,
  52325, 55437, 58733, 62225, 65926, 69846, 73999, 78399, 83061, 88000, 93233, 98777,
  104650, 110873, 117466, 124451, 131851, 139691, 147998, 156798, 166122, 176000, 186466, 197553,
  209300,
]
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

// The table index of a note name such as 'C5' or 'F#3'.
function pitchIndex(name: string): number {
  const m = /^([A-G]#?)([2-7])$/.exec(name)
  const step = NAMES.indexOf(m?.[1] ?? '')
  if (!m || step < 0) throw new Error(`no pitch ${name}`)
  const i = (Number(m[2]) - 2) * 12 + step
  if (i >= PITCH.length) throw new Error(`no pitch ${name}`)
  return i
}

// lead: a 25% pulse; chime: a 12.5% pulse that rings down; bass: the NES's 4-bit triangle;
// noise: a xorshift held for `hold` samples, short and falling.
type Voice = 'lead' | 'chime' | 'bass' | 'noise'

type Note = {
  voice: Voice
  pitch: string
  at: number // ticks
  len: number // ticks of gate
  // The last legendary note: an arpeggio of root, fifth and octave, one per 1/60 s.
  shimmer?: boolean
}

const AMP: Record<Voice, number> = { lead: 6000, chime: 6000, bass: 7000, noise: 5000 }
// Attack and decay in samples, and the level the decay settles at; 0 decay holds full level.
const SHAPE: Record<Voice, { attack: number; decay: number; sustain: number }> = {
  lead: { attack: 44, decay: 3 * TICK, sustain: 640 },
  chime: { attack: 22, decay: 6 * TICK, sustain: 0 },
  bass: { attack: 44, decay: 0, sustain: ENV },
  noise: { attack: 0, decay: 3 * TICK, sustain: 0 },
}
// Samples a noise value is held: a longer hold is a lower, coarser hit.
const NOISE_HOLD = 6

const n = (voice: Voice, pitch: string, at: number, len: number, shimmer = false): Note => ({
  voice,
  pitch,
  at,
  len,
  ...(shimmer ? { shimmer } : {}),
})

// The brief of spec §10, one score per cue, in ticks of 1/30 s.
export const SCORES: Record<Cue, Note[]> = {
  // Two notes rising, a blip.
  drop: [n('lead', 'B5', 0, 2), n('lead', 'E6', 3, 4), n('bass', 'E3', 0, 6)],
  // Four notes rising with a shimmer on the last.
  legendary: [
    n('lead', 'C5', 0, 2),
    n('lead', 'E5', 3, 2),
    n('lead', 'G5', 6, 2),
    n('lead', 'C6', 9, 9, true),
    n('bass', 'C3', 0, 18),
  ],
  // A three-note fanfare, the last held.
  level_up: [
    n('lead', 'E5', 0, 2),
    n('lead', 'G5', 3, 2),
    n('lead', 'C6', 6, 12),
    n('bass', 'G2', 0, 6),
    n('bass', 'C3', 6, 12),
  ],
  // Two low notes falling with a noise hit.
  boss: [
    n('lead', 'C4', 0, 5),
    n('lead', 'F#3', 6, 9),
    n('bass', 'C2', 0, 5),
    n('bass', 'F#2', 6, 9),
    n('noise', 'C2', 0, 4),
  ],
  // A four-note cadence that resolves: the dominant's seventh falling to the tonic.
  zone_cleared: [
    n('lead', 'F5', 0, 2),
    n('lead', 'D5', 3, 2),
    n('lead', 'B4', 6, 2),
    n('lead', 'C5', 9, 9),
    n('bass', 'G2', 0, 9),
    n('bass', 'C3', 9, 9),
  ],
  // A knock and one bright note.
  recruit: [
    n('noise', 'C2', 0, 1),
    n('bass', 'A2', 0, 1),
    n('lead', 'E6', 3, 8),
    n('bass', 'A3', 3, 8),
  ],
  // Two chime notes, the second higher.
  goal: [
    n('chime', 'G5', 0, 6),
    n('chime', 'C6', 6, 9),
    n('bass', 'E3', 0, 6),
    n('bass', 'C3', 6, 9),
  ],
  // Two notes falling, minor: E to C over A.
  retreat: [n('lead', 'E5', 0, 5), n('lead', 'C5', 6, 12), n('bass', 'A2', 0, 18)],
}

// The envelope's level, 0 to ENV, `t` samples into a note whose gate is `gate` samples.
function envelope(voice: Voice, t: number, gate: number): number {
  const { attack, decay, sustain } = SHAPE[voice]
  const held = (u: number): number => {
    if (u < attack) return Math.floor((ENV * u) / attack)
    if (u < attack + decay) return ENV - Math.floor(((ENV - sustain) * (u - attack)) / decay)
    return sustain
  }
  if (t < gate) return held(t)
  const after = t - gate
  return after >= RELEASE ? 0 : Math.floor((held(gate) * (RELEASE - after)) / RELEASE)
}

// The next state of a xorshift32 generator.
function xorshift(x: number): number {
  let y = x ^ (x << 13)
  y ^= y >>> 17
  y ^= y << 5
  return y >>> 0
}

// One note's samples, its envelope applied, before the mix.
function render(note: Note, seed: number): Int32Array {
  const gate = note.len * TICK
  const out = new Int32Array(gate + RELEASE)
  const amp = AMP[note.voice]
  const root = pitchIndex(note.pitch)
  let phase = 0
  let noise = seed
  for (let t = 0; t < out.length; t++) {
    const arp = note.shimmer ? [0, 7, 12][Math.floor((t * 60) / SAMPLE_RATE) % 3] : 0
    const step = PITCH[root + (arp ?? 0)] ?? 0
    let wave: number
    if (note.voice === 'noise') {
      if (t % NOISE_HOLD === 0) noise = xorshift(noise)
      wave = noise & 1 ? amp : -amp
    } else if (note.voice === 'bass') {
      // 32 steps a period: 15 down to 0, then 0 up to 15, centred on zero.
      const i = Math.floor((phase * 32) / PHASE)
      const level = i < 16 ? 15 - i : i - 16
      wave = Math.trunc(((2 * level - 15) * amp) / 15)
    } else {
      const eighths = note.voice === 'chime' ? 1 : 2
      wave = phase * 8 < PHASE * eighths ? amp : -amp
    }
    out[t] = Math.trunc((wave * envelope(note.voice, t, gate)) / ENV)
    phase += step
    if (phase >= PHASE) phase -= PHASE
  }
  return out
}

// A cue's samples: its notes mixed, then scaled so the loudest sample sits at PEAK.
export function synth(score: Note[]): Int16Array {
  const length = Math.max(...score.map((note) => (note.at + note.len) * TICK + RELEASE))
  const mix = new Int32Array(length)
  for (const [i, note] of score.entries()) {
    const samples = render(note, 0x9e3779b9 ^ (i + 1))
    const start = note.at * TICK
    for (let t = 0; t < samples.length; t++)
      mix[start + t] = (mix[start + t] ?? 0) + (samples[t] ?? 0)
  }
  let loudest = 1
  for (const s of mix) loudest = Math.max(loudest, Math.abs(s))
  return Int16Array.from(mix, (s) => Math.round((s * PEAK) / loudest))
}

// A canonical 44-byte PCM WAV around `samples`.
export function wav(samples: Int16Array): Buffer {
  const bytes = samples.length * 2
  const buf = Buffer.alloc(44 + bytes)
  buf.write('RIFF', 0, 'ascii')
  buf.writeUInt32LE(36 + bytes, 4)
  buf.write('WAVEfmt ', 8, 'ascii')
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20) // PCM
  buf.writeUInt16LE(1, 22) // mono
  buf.writeUInt32LE(SAMPLE_RATE, 24)
  buf.writeUInt32LE(SAMPLE_RATE * 2, 28)
  buf.writeUInt16LE(2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36, 'ascii')
  buf.writeUInt32LE(bytes, 40)
  for (const [i, s] of samples.entries()) buf.writeInt16LE(s, 44 + i * 2)
  return buf
}

// Every cue's file, as the plugin's cues folder holds it.
export function buildCues(): Record<Cue, Buffer> {
  const out = {} as Record<Cue, Buffer>
  for (const cue of Object.keys(SCORES) as Cue[]) out[cue] = wav(synth(SCORES[cue]))
  return out
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const plugin = join(import.meta.dirname, '../plugins/promptfall')
  for (const [cue, bytes] of Object.entries(buildCues())) {
    const path = join(plugin, CUE_ASSET[cue as Cue])
    writeFileSync(path, bytes)
    console.log(`${path}: ${Math.round(((bytes.length - 44) * 500) / SAMPLE_RATE)} ms`)
  }
}
