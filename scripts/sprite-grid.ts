// A sprite as editable text, for hand cleanup: a legend (`<char> #rrggbb`, `0` is black, `.` is
// transparent and never listed), a blank line, then one character per pixel.
//
// tsx scripts/sprite-grid.ts <in.png>                 prints the grid
// tsx scripts/sprite-grid.ts --png <in.txt> <out.png> writes the PNG
import { readFileSync } from 'node:fs'
import { blank, hex, parseHex, type Rgba, readPng, rgbOf, writePng } from './png'

const CHARS = '123456789abcdefghijklmnopqrstuvwxyz'

export function toGrid(img: Rgba): string {
  const colours = new Set<number>()
  for (let i = 0; i < img.data.length; i += 4) {
    if (img.data[i + 3] !== 0) colours.add(rgbOf(img.data, i))
  }
  const others = [...colours].filter((c) => c !== 0).sort((a, b) => a - b)
  if (others.length > CHARS.length) throw new Error(`${others.length + 1} colours: too many`)
  const charOf = new Map<number, string>(others.map((c, k) => [c, CHARS[k] ?? '?']))
  if (colours.has(0)) charOf.set(0, '0')
  const legend = [...charOf]
    .sort((a, b) => a[1].localeCompare(b[1]))
    .map(([c, ch]) => `${ch} ${hex(c)}`)
  const rows: string[] = []
  for (let y = 0; y < img.height; y++) {
    let row = ''
    for (let x = 0; x < img.width; x++) {
      const i = (y * img.width + x) * 4
      row += img.data[i + 3] === 0 ? '.' : charOf.get(rgbOf(img.data, i))
    }
    rows.push(row)
  }
  return `${[...legend, '', ...rows].join('\n')}\n`
}

export function fromGrid(text: string): Rgba {
  const lines = text.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  const colourOf = new Map<string, number>()
  let k = 0
  for (; k < lines.length && lines[k] !== ''; k++) {
    const m = /^(\S) (#[0-9a-fA-F]{6})$/.exec(lines[k] ?? '')
    if (!m || m[1] === '.') throw new Error(`line ${k + 1}: not a legend entry: ${lines[k]}`)
    colourOf.set(m[1] as string, parseHex(m[2] as string))
  }
  const rows = lines.slice(k + 1)
  const first = k + 2
  const width = rows[0]?.length ?? 0
  const img = blank(width, rows.length)
  rows.forEach((row, y) => {
    if (row.length !== width) {
      throw new Error(`line ${first + y}: ${row.length} pixels, expected ${width}`)
    }
    ;[...row].forEach((ch, x) => {
      if (ch === '.') return
      const c = colourOf.get(ch)
      if (c === undefined) throw new Error(`line ${first + y}: "${ch}" is not in the legend`)
      img.data.set([c >> 16, (c >> 8) & 0xff, c & 0xff, 255], (y * width + x) * 4)
    })
  })
  return img
}

function main(): void {
  const args = process.argv.slice(2)
  if (args[0] === '--png' && args[1] && args[2]) {
    writePng(args[2], fromGrid(readFileSync(args[1], 'utf8')))
    return
  }
  if (args.length === 1 && args[0]) {
    process.stdout.write(toGrid(readPng(args[0])))
    return
  }
  throw new Error('usage: tsx scripts/sprite-grid.ts <in.png> | --png <in.txt> <out.png>')
}

if (import.meta.url === `file://${process.argv[1]}`) main()
