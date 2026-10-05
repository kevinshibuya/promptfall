# Phase 4 concept sheets

Concept art from the phase 4 grill, generated with gpt-image-2 through codex-image on
2026-10-04. PR 1 (engine) uses these as placeholder sprites; PR 2 replaces them.

- `nes-sheet.png`: NES style, 4 × 3 grid on magenta. Rows: heroes (knight, black mage,
  white mage, archer), monsters (brute, swift, tank, caster), bosses. Heroes and monsters
  are the chosen style.
- `snes-sheet.png`: SNES style, same grid. Its boss row (treant, bandit captain, wyrm,
  many-eyed horror) is the chosen boss style.
- `slice.py`: cuts a sheet into true-size sprites on the magenta key and quantizes each to
  its palette. `python3 slice.py nes-sheet.png nes 16 6 0` and
  `python3 slice.py snes-sheet.png snes 24 14 0` (bosses fit 48 × 34). A starting point for
  the build step, not the build step.

The black mage, white mage and archer here are the Final Fantasy look-alikes the grill
rules out (record §1.8); they are placeholders only.

The art directions page built from them: https://claude.ai/artifact/1nJaaRAXGsfi53PFnf9nqB
