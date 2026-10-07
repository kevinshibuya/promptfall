// Scratch prototype from the PR 2 grill (2026-10-07), kept as the reference for the slicer task
// (grill Q18). Not part of the build and not type-checked; its imports point at this repo's
// scripts/ by absolute path. Recovers each cell's native pixel grid from the outline's run length,
// then shrinks by an outline-aware majority vote.
// Prototype: recover each cell's native pixel grid, then shrink by outline-aware majority vote.
// tsx native.ts sheet.png outdir COLSxROWS row WxH colours names
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { blank, medianCut, nearest, readPng, writePng, type Rgba } from '/Users/luizarazzera/keki/dev/personal_projects/tbh-cc-mod/scripts/png'
import { isKey, mainRun } from '/Users/luizarazzera/keki/dev/personal_projects/tbh-cc-mod/scripts/slice-sheet'
const [sheetP, out, grid, rowS, size, colS, namesS] = process.argv.slice(2)
const [cols, rows] = grid!.split('x').map(Number) as [number, number]
const [TW, TH] = size!.split('x').map(Number) as [number, number]
const NC = +colS!, names = namesS!.split(','), row = +rowS!
mkdirSync(out!, { recursive: true })
const sheet = readPng(sheetP!)
const T = -1
const px = (img: Rgba, x: number, y: number) => { const i = (y * img.width + x) * 4; const d = img.data; return isKey(d[i]!, d[i+1]!, d[i+2]!) || d[i+3]! < 128 ? T : (d[i]! << 16) | (d[i+1]! << 8) | d[i+2]! }
const diff = (a: number, b: number) => { if (a === T || b === T) return a !== b; const dr = (a>>16)-(b>>16), dg = ((a>>8)&255)-((b>>8)&255), db = (a&255)-(b&255); return dr*dr+dg*dg+db*db > 40*40 }
const dark = (c: number) => c !== T && (c>>16) < 50 && ((c>>8)&255) < 50 && (c&255) < 50
function bestGrid(tr: number[]): { b: number; o: number } {
  let res: { b: number; o: number; s: number }[] = []
  for (let b = 4; b <= 40; b += 0.05) {
    let best = { b, o: 0, s: 0 }
    for (let o = 0; o < b; o += 0.25) {
      let hit = 0
      for (const t of tr) { const r = ((t - o) % b + b) % b; if (Math.min(r, b - r) <= 1.01) hit++ }
      if (hit / tr.length > best.s) best = { b, o, s: hit / tr.length }
    }
    res.push(best)
  }
  const top = Math.max(...res.map((r) => r.s))
  // the largest block size scoring near the best: halves of the true size score as well
  return res.filter((r) => r.s >= top * 0.97).reduce((a, r) => (r.b > a.b ? r : a))
}
for (let c = 0; c < cols; c++) {
  const cw = Math.floor(sheet.width / cols), ch = Math.floor(sheet.height / rows)
  const x0 = c * cw, y0 = row * ch
  const xs: number[] = [], ys: number[] = []
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) if (px(sheet, x0 + x, y0 + y) !== T) { xs.push(x); ys.push(y) }
  const [bx0, bx1] = mainRun(xs, cw), [by0, by1] = mainRun(ys, ch)
  const trX: number[] = [], trY: number[] = []
  for (let y = by0; y <= by1; y += 2) for (let x = bx0; x <= bx1 + 1; x++) if (diff(px(sheet, x0+x-1, y0+y), px(sheet, x0+x, y0+y))) trX.push(x)
  for (let x = bx0; x <= bx1; x += 2) for (let y = by0; y <= by1 + 1; y++) if (diff(px(sheet, x0+x, y0+y-1), px(sheet, x0+x, y0+y))) trY.push(y)
  const runs = new Map<number, number>()
  for (let y = by0; y <= by1; y += 2) { let run = 0; for (let x = bx0; x <= bx1 + 1; x++) { const v = px(sheet, x0 + x, y0 + y); if (dark(v)) run++; else { if (run >= 4) runs.set(run, (runs.get(run) ?? 0) + 1); run = 0 } } }
  // the outline is one art pixel: the commonest dark run, refined by its neighbours
  const m0 = [...runs].reduce((a, e) => (e[1] > a[1] ? e : a))[0]
  let num = 0, den = 0
  for (let d = -1; d <= 1; d++) { const n = runs.get(m0 + d) ?? 0; num += (m0 + d) * n; den += n }
  const b = num / den
  const off = (tr: number[]) => { let best = 0, bs = -1; for (let o = 0; o < b; o += 0.25) { let h = 0; for (const t of tr) { const r = ((t - o) % b + b) % b; if (Math.min(r, b - r) <= 1.5) h++ } if (h > bs) { bs = h; best = o } } return best }
  const gx = { o: off(trX) }, gy = { o: off(trY) }
  // native grid: blocks from the first grid line at or before the bbox
  const sx = gx.o + Math.floor((bx0 - gx.o) / b) * b, sy = gy.o + Math.floor((by0 - gy.o) / b) * b
  const NW = Math.ceil((bx1 + 1 - sx) / b), NH = Math.ceil((by1 + 1 - sy) / b)
  const nat: number[] = []
  for (let j = 0; j < NH; j++) for (let i = 0; i < NW; i++) {
    const m = new Map<number, number>()
    for (let v = 0.3; v <= 0.71; v += 0.1) for (let u = 0.3; u <= 0.71; u += 0.1) {
      const x = Math.floor(sx + (i + u) * b), y = Math.floor(sy + (j + v) * b)
      const k = x >= 0 && y >= 0 && x < cw && y < ch ? px(sheet, x0 + x, y0 + y) : T
      m.set(k, (m.get(k) ?? 0) + 1)
    }
    nat.push([...m].reduce((a, e) => (e[1] > a[1] ? e : a))[0])
  }
  // trim empty native rows/cols
  let l = NW, r = -1, t = NH, bt = -1
  nat.forEach((v, k) => { if (v !== T) { const i = k % NW, j = (k / NW) | 0; l = Math.min(l, i); r = Math.max(r, i); t = Math.min(t, j); bt = Math.max(bt, j) } })
  const W0 = r - l + 1, H0 = bt - t + 1
  const s = Math.min(1, TW / W0, TH / H0)
  const W = Math.max(1, Math.round(W0 * s)), H = Math.max(1, Math.round(H0 * s))
  const small: number[] = []
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const ia = l + Math.floor((i * W0) / W), ib = l + Math.max(Math.floor(((i + 1) * W0) / W), Math.floor((i * W0) / W) + 1)
    const ja = t + Math.floor((j * H0) / H), jb = t + Math.max(Math.floor(((j + 1) * H0) / H), Math.floor((j * H0) / H) + 1)
    const m = new Map<number, number>(); let n = 0, tr = 0, dk = 0
    for (let y = ja; y < jb; y++) for (let x = ia; x < ib; x++) { const v = nat[y * NW + x]!; n++; if (v === T) tr++; else { if (dark(v)) dk++; m.set(v, (m.get(v) ?? 0) + 1) } }
    if (tr * 2 > n) { small.push(T); continue }
    const op = n - tr
    small.push(dk * 3 >= op ? 0 : [...m].filter((e) => !dark(e[0])).reduce((a, e) => (e[1] > a[1] ? e : a), [0, -1])[0])
  }
  const counts = new Map<number, number>()
  for (const v of small) if (v !== T && v !== 0) counts.set(v, (counts.get(v) ?? 0) + 1)
  const pal = [0, ...medianCut(counts, NC - 1)]
  const img = blank(W, H)
  small.forEach((v, k) => { if (v === T) return; const q = v === 0 ? 0 : nearest(v, pal); img.data.set([q >> 16, (q >> 8) & 255, q & 255, 255], k * 4) })
  writePng(join(out!, `${names[c]}.png`), img)
  console.log(`${names[c]} block ${b.toFixed(2)} native ${W0}x${H0} -> ${W}x${H}`)
}
