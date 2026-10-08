# Notices

## claude-toons

Promptfall's stage borrows three techniques from claude-toons, by Anshu Chimala, under the MIT
license below. None of its art (Clawd) is used.

- The half-block cell packing: two stage pixels per terminal cell, the top as the foreground of
  `▀` and the bottom as its background, `▄` and the terminal's default colour where only one is
  opaque (`hooks/stage/raster.ts`).
- The Bayer alpha rule: a pixel of a fading actor shows where `alpha * 16` exceeds the 4 × 4 Bayer
  matrix at that pixel (`hooks/stage/compose.ts`).
- The blit loop's shape: one keyed element mounted by the render hook and repainted by
  `$.ui.blit` on a timer (`hooks/stage/loop.ts`).

```
MIT License

Copyright (c) 2026 Anshu Chimala

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Misaki font

The window band's text is drawn from glyph bitmaps derived from Misaki Gothic 2nd
(美咲ゴシック第2), by Num Kadoma (`hooks/windows/glyphs.ts`, built by `scripts/font.ts` from
`art/fonts/misaki_gothic_2nd.ttf`). The plugin ships the bitmaps, not the font file.

```
Copyright(C) 2002-2021 Num Kadoma

These fonts are free softwares.
Unlimited permission is granted to use, copy, and distribute it, with or without modification,
either commercially and noncommercially.
THESE FONTS ARE PROVIDED "AS IS" WITHOUT WARRANTY.
```

## fflate

`hooks/vendor/fflate.js` bundles `zlibSync` and `unzlibSync` from fflate 0.8.2, by Arjun Barrett,
under the MIT license below: the deflate inside the PNG frames the stage sends (`hooks/stage/png.ts`).

```
MIT License

Copyright (c) 2023 Arjun Barrett

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
