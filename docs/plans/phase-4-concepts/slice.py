"""Slice a 4x3 magenta-keyed concept sheet into true-size indexed sprites.

usage: python3 slice.py <sheet.png> <prefix> <grid> <colours> <boss_grid>
Writes <prefix>-<n>.png (RGBA, native pixel size) for the 12 cells, row-major,
plus <prefix>-strip.png, all 12 at 6x for eyeballing.
"""
import sys
from PIL import Image

sheet_path, prefix, grid, colours, boss_grid = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4]), int(sys.argv[5])
GC, GR, START, ALLBOSS = (int(v) for v in (sys.argv[6:10] if len(sys.argv) > 6 else (4, 3, 0, 0)))
sheet = Image.open(sheet_path).convert('RGB')
W, H = sheet.size
cw, ch = W / GC, H / GR


def is_key(p):
    r, g, b = p
    return r > 120 and b > 120 and g < 120 and abs(r - b) < 90 and min(r, b) - g > 60


out = []
for n in range(GC * GR):
    cx, cy = n % GC, n // GC
    cell = sheet.crop((int(cx * cw), int(cy * ch), int((cx + 1) * cw), int((cy + 1) * ch)))
    px = cell.load()
    w, h = cell.size
    xs, ys = [], []
    for y in range(h):
        for x in range(w):
            if not is_key(px[x, y]):
                xs.append(x)
                ys.append(y)
    def main_run(vals, size):
        hit = [0] * size
        for v in vals:
            hit[v] += 1
        runs, start, gap = [], None, 0
        for i in range(size):
            if hit[i] > 1:
                if start is None:
                    start = i
                gap, end = 0, i
            elif start is not None:
                gap += 1
                if gap > 3:
                    runs.append((start, end))
                    start = None
        if start is not None:
            runs.append((start, end))
        return max(runs, key=lambda r: r[1] - r[0])

    y0, y1 = main_run(ys, h)
    keep = [i for i in range(len(xs)) if y0 <= ys[i] <= y1]
    x0, x1 = main_run([xs[i] for i in keep], w)
    box = (x0, y0, x1 + 1, y1 + 1)
    art = cell.crop(box)
    target = boss_grid if cy == 2 else grid
    aw, ah = art.size
    scale = min(48 / aw, 34 / ah) if (cy == 2 or ALLBOSS) else target / max(aw, ah)
    tw, th = max(1, round(aw * scale)), max(1, round(ah * scale))
    # Block-sample: each target pixel takes the centre of its source block.
    small = Image.new('RGBA', (tw, th))
    sp = small.load()
    ap = art.load()
    for y in range(th):
        for x in range(tw):
            p = ap[min(aw - 1, int((x + 0.5) * aw / tw)), min(ah - 1, int((y + 0.5) * ah / th))]
            sp[x, y] = (0, 0, 0, 0) if is_key(p) else (*p, 255)
    opaque = [sp[x, y][:3] for y in range(th) for x in range(tw) if sp[x, y][3]]
    probe = Image.new('RGB', (len(opaque), 1))
    probe.putdata(opaque)
    pal = probe.quantize(colors=colours, method=Image.Quantize.MAXCOVERAGE)
    rgb = small.convert('RGB').quantize(palette=pal, dither=Image.Dither.NONE).convert('RGB')
    alpha = small.getchannel('A')
    final = rgb.convert('RGBA')
    final.putalpha(alpha)
    final.save(f'{prefix}-{n + START}.png')
    out.append(final)

strip = Image.new('RGBA', (sum(o.width * 6 + 12 for o in out), max(o.height for o in out) * 6), (30, 30, 36, 255))
x = 0
for o in out:
    big = o.resize((o.width * 6, o.height * 6), Image.NEAREST)
    strip.paste(big, (x, strip.height - big.height), big)
    x += big.width + 12
strip.save(f'{prefix}-strip.png')
print('ok', [o.size for o in out])
