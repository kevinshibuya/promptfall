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
