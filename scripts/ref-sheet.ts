// The reference composite for a frames sheet: each listed sprite's shipped 1.5x art, scaled up
// nearest-neighbour and standing in its own cell on magenta, so the image model reads "column n
// of the reference" as "column n of the sheet".
//
// tsx scripts/ref-sheet.ts <out.png> --columns <n> --cell <w>x<h> --scale <k> <kind/name|blank>,…
//   [--art <dir>]
import { join } from 'node:path'
import { readPng, writePng } from './png'

export type RefSheetOptions = {
  columns: number
  cell: { width: number; height: number }
  scale: number
  /** `kind/name` per cell, or `blank` for an empty one */
  entries: string[]
  /** The art root holding `sprites-hires/` */
  art: string
}

const MAGENTA = [0xff, 0x00, 0xff, 0xff] as const
/** Screen pixels of magenta between a sprite's lowest opaque row and its cell's floor. */
const FLOOR_GAP = 24

export function refSheet(out: string, opts: RefSheetOptions): void {
  const { columns, cell, scale, entries, art } = opts
  if (entries.length > columns) throw new Error(`${entries.length} entries for ${columns} columns`)
  const width = columns * cell.width
  const height = cell.height
  const data = new Uint8Array(width * height * 4)
  for (let i = 0; i < data.length; i += 4) data.set(MAGENTA, i)
  entries.forEach((entry, col) => {
    if (entry === 'blank') return
    const src = readPng(join(art, 'sprites-hires', `${entry}.png`))
    let bottom = -1
    for (let y = 0; y < src.height; y++) {
      for (let x = 0; x < src.width; x++) {
        if ((src.data[(y * src.width + x) * 4 + 3] ?? 0) > 0) bottom = y
      }
    }
    if (bottom < 0) throw new Error(`${entry}: no opaque pixel`)
    const w = src.width * scale
    if (w > cell.width || (bottom + 1) * scale + FLOOR_GAP > cell.height) {
      throw new Error(`${entry}: ${src.width} × ${bottom + 1} at ${scale}x does not fit the cell`)
    }
    const left = col * cell.width + Math.floor((cell.width - w) / 2)
    const top = cell.height - FLOOR_GAP - (bottom + 1) * scale
    for (let y = 0; y <= bottom * scale + scale - 1; y++) {
      const ty = top + y
      if (ty < 0) continue
      for (let x = 0; x < w; x++) {
        const si = (Math.floor(y / scale) * src.width + Math.floor(x / scale)) * 4
        if ((src.data[si + 3] ?? 0) === 0) continue
        data.set(
          [src.data[si] ?? 0, src.data[si + 1] ?? 0, src.data[si + 2] ?? 0, 255],
          (ty * width + left + x) * 4,
        )
      }
    }
  })
  writePng(out, { width, height, data })
}

function parseArgs(argv: string[]): { out: string; opts: RefSheetOptions } {
  const flag = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`)
    return i >= 0 ? argv[i + 1] : undefined
  }
  const flagged = new Set(['--columns', '--cell', '--scale', '--art'])
  const positional = argv.filter((a, i) => !a.startsWith('--') && !flagged.has(argv[i - 1] ?? ''))
  const [out, list] = positional
  const cell = /^(\d+)x(\d+)$/.exec(flag('cell') ?? '')
  const columns = Number(flag('columns'))
  const scale = Number(flag('scale'))
  if (!out || !list || !cell || !(columns > 0) || !(scale > 0)) {
    throw new Error(
      'usage: tsx scripts/ref-sheet.ts <out.png> --columns <n> --cell <w>x<h> --scale <k> <kind/name|blank>,… [--art <dir>]',
    )
  }
  return {
    out,
    opts: {
      columns,
      cell: { width: Number(cell[1]), height: Number(cell[2]) },
      scale,
      entries: list.split(','),
      art: flag('art') ?? 'art',
    },
  }
}

function main(): void {
  const { out, opts } = parseArgs(process.argv.slice(2))
  refSheet(out, opts)
  console.log(out)
}

if (import.meta.url === `file://${process.argv[1]}`) main()
