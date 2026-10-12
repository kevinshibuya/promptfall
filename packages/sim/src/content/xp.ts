/**
 * The xp a hero needs to go from each level to the next, levels 1 to 50: round(60 × L^1.7),
 * computed offline so the sim never raises a float to a power. To reach levels 10, 20, 30 and 50
 * takes about 10k, 68k, 207k and 836k xp in all.
 */
export const XP_TO_NEXT: readonly number[] = [
  60, 195, 388, 633, 926, 1_262, 1_640, 2_058, 2_514, 3_007, 3_536, 4_100, 4_697, 5_328, 5_991,
  6_686, 7_412, 8_168, 8_954, 9_770, 10_615, 11_489, 12_390, 13_320, 14_277, 15_262, 16_273, 17_311,
  18_375, 19_465, 20_581, 21_722, 22_889, 24_080, 25_297, 26_538, 27_803, 29_093, 30_406, 31_743,
  33_104, 34_489, 35_896, 37_327, 38_780, 40_257, 41_756, 43_277, 44_821, 46_387,
]

/** The table's entry for a level; past its end, its last entry. */
export function xpToNext(level: number): number {
  return XP_TO_NEXT[Math.min(Math.max(level, 1), XP_TO_NEXT.length) - 1] ?? 0
}
