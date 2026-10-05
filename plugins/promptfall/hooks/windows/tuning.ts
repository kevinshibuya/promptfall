// The window kit's constants (docs/plans/2026-10-05-ui-pr1-window-band.md, "Window constants").
// Colours and frame geometry come from the Dragon Quest V transcription
// (docs/design/ui-remake/transcription.md); grafts say where they came from.

/** Picture pixels per cell: DQ V's text grid, 8 px advance and 16 px line. */
export const CELL_W = 8
export const CELL_H = 16
/** Upscale of a window picture; 8 × 16 reads crisp in Ghostty at 1 (spike sheet). */
export const WINDOW_SCALE = 1

export const FIELD_RGB = 0x303028
export const BORDER_RGB = 0xf0f0e8
export const TEXT_RGB = 0xf0f0e8
/** Graft: the band's dim text. */
export const DIM_RGB = 0x888880
/** Grill 1.13: a hero under 25% HP, and at 0. */
export const WARN_RGB = 0xf8a030
export const DOWN_RGB = 0xe83830
/** Graft: the Pokémon HP bar; its back is the field lifted one step. */
export const HP_BAR_RGB = 0x58d858
export const BAR_BACK_RGB = 0x484840
/** Graft: the Final Fantasy action gauge, gold when full. */
export const GAUGE_RGB = 0x58a8f8
export const GAUGE_FULL_RGB = 0xf8d038

/** The frame, measured from the content side of a border cell: field, white line, field margin. */
export const PAD_PX = 4
export const BORDER_PX = 2
export const MARGIN_PX = 1
/** A bar's rows inside its 16 px line: level with the glyphs' middle. */
export const BAR_Y = 6
export const BAR_H = 4

/** The strip: border, 3 inner rows, border. */
export const STRIP_ROWS = 5
/** The compact band's rows (grill 1.16); its stage box stays 4 rows. */
export const COMPACT_WINDOW_ROWS = 6
/** A strip or compact band is laid out in at most as many columns as the stage. */
export const STRIP_MAX_COLUMNS = 160
export const ENEMY_COLUMNS = 25
export const PARTY_COLUMNS = 42
export const PURSE_COLUMNS = 13
export const MESSAGE_MIN_COLUMNS = 28

/** Typing: per character, and fast while 2 or more lines wait. */
export const CHAR_MS = 18
export const CHAR_FAST_MS = 6
/** The least time a line holds the bottom row before the next one. */
export const LINE_MIN_MS = 300
export const LOG_KEEP = 40
/** Loop delay while only gauges move. */
export const GAUGE_FRAME_MS = 250
/** The strip Svg's budget; SMIL frames past it are cut from the tail. */
export const STRIP_SVG_MAX_CHARS = 65_536
