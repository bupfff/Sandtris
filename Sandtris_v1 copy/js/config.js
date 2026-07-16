/* =========================================================================
 * config.js
 * -------------------------------------------------------------------------
 * Central configuration for the whole game: board dimensions, tuning
 * constants, the retro colour palette and the tetromino definitions.
 *
 * Everything hangs off a single global namespace object (`Sand`) so that the
 * game can run from a plain `file://` URL without ES module / CORS problems.
 * ========================================================================= */

(function (global) {
  'use strict';

  const Sand = (global.Sand = global.Sand || {});

  /* --------------------------------------------------------------------- *
   * Board geometry
   *
   * The playfield is a fine grid of "sand" cells. A tetromino block is a
   * square of BLOCK x BLOCK sand cells, so a piece decomposes into many
   * individual grains when it locks.
   * --------------------------------------------------------------------- */
  const BLOCK = 8;            // sand cells per tetromino block edge
  const COLS = 10;           // playfield width  in tetromino blocks
  const ROWS = 18;           // playfield height in tetromino blocks

  const GRID_W = COLS * BLOCK; // 80  sand cells wide
  const GRID_H = ROWS * BLOCK; // 144 sand cells tall

  /* --------------------------------------------------------------------- *
   * Sand grain encoding
   *
   * A grid cell stores a single Uint8:
   *    0                    -> empty
   *    1 + colorIndex*SHADES + shade -> occupied grain
   * This lets each grain carry a small brightness variation ("shade") that
   * travels with it, producing a grainy texture without extra memory.
   * --------------------------------------------------------------------- */
  const SHADES = 4;

  /* Base sand colours. Only four colours are used so that same-colour
   * regions form often enough for the signature "connect wall to wall"
   * clears to feel achievable and fun. */
  const SAND_COLORS = [
    { name: 'red',    base: [226, 58, 58] },
    { name: 'yellow', base: [240, 192, 0] },
    { name: 'green',  base: [63, 191, 63] },
    { name: 'blue',   base: [58, 110, 226] },
  ];

  /* Multipliers applied to a base colour to make the four shade variants. */
  const SHADE_FACTORS = [0.78, 0.90, 1.0, 1.12];

  /* --------------------------------------------------------------------- *
   * Tetromino definitions
   *
   * Each piece is defined by its spawn matrix (SRS style, 4x4 for I, 3x3 for
   * the rest). `color` indexes SAND_COLORS. Rotation is computed at runtime.
   * --------------------------------------------------------------------- */
  const PIECES = {
    I: {
      color: 3, // blue
      matrix: [
        [0, 0, 0, 0],
        [1, 1, 1, 1],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
      ],
    },
    J: {
      color: 3, // blue
      matrix: [
        [1, 0, 0],
        [1, 1, 1],
        [0, 0, 0],
      ],
    },
    L: {
      color: 1, // yellow
      matrix: [
        [0, 0, 1],
        [1, 1, 1],
        [0, 0, 0],
      ],
    },
    O: {
      color: 1, // yellow
      matrix: [
        [1, 1],
        [1, 1],
      ],
    },
    S: {
      color: 2, // green
      matrix: [
        [0, 1, 1],
        [1, 1, 0],
        [0, 0, 0],
      ],
    },
    Z: {
      color: 0, // red
      matrix: [
        [1, 1, 0],
        [0, 1, 1],
        [0, 0, 0],
      ],
    },
    T: {
      color: 0, // red
      matrix: [
        [0, 1, 0],
        [1, 1, 1],
        [0, 0, 0],
      ],
    },
  };

  const PIECE_TYPES = ['I', 'J', 'L', 'O', 'S', 'Z', 'T'];

  /* --------------------------------------------------------------------- *
   * SRS wall-kick data (offsets in *blocks*). Applied when a basic rotation
   * fails. Directions are keyed "fromState>toState".
   * --------------------------------------------------------------------- */
  const KICKS_JLSTZ = {
    '0>1': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
    '1>0': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
    '1>2': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
    '2>1': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
    '2>3': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
    '3>2': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
    '3>0': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
    '0>3': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
  };
  const KICKS_I = {
    '0>1': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
    '1>0': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
    '1>2': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
    '2>1': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
    '2>3': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
    '3>2': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
    '3>0': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
    '0>3': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
  };

  /* --------------------------------------------------------------------- *
   * Gameplay tuning
   * --------------------------------------------------------------------- */
  const CONFIG = {
    BLOCK, COLS, ROWS, GRID_W, GRID_H, SHADES,

    // Sand simulation steps per rendered frame. One step per frame gives a
    // slow, watchable crumble (grains fall ~1 cell/frame) instead of a snap.
    SIM_STEPS_PER_FRAME: 1,

    // Piece fall speed in sand-cells per second, per level (index 0 unused).
    // Level clamps into this table; beyond the end it keeps the last value.
    GRAVITY_TABLE: [
      8, 8, 11, 15, 20, 27, 36, 47, 60, 75,
      92, 112, 136, 164, 198, 238,
    ],
    SOFT_DROP_CELLS_PER_SEC: 220, // soft-drop fall speed
    LOCK_DELAY_MS: 280,           // grace period before a grounded piece locks
    LOCK_RESET_MAX: 15,           // max lock-delay resets from moves/rotations

    // Horizontal auto-shift.
    DAS_MS: 125, // delay before auto shift kicks in
    ARR_MS: 22,  // repeat interval once shifting

    // Sand transition. When a piece locks it holds its solid shape for
    // LAND_PAUSE_MS so the player registers it, then crumbles into grains.
    LAND_PAUSE_MS: 3,

    // Line-clear presentation.
    FLASH_MS: 220,          // how long cleared grains flash before deletion

    // Smooth-movement interpolation time constants (ms). The rendered piece
    // eases toward its logical grid position; logic stays exact.
    MOVE_TAU_MS: 42,        // horizontal easing (Smooth movement mode)
    FALL_TAU_MS: 30,        // vertical easing

    // Scoring.
    SOFT_DROP_POINTS: 1,    // per cell soft-dropped
    HARD_DROP_POINTS: 2,    // per cell hard-dropped
    CLEAR_BASE_POINTS: 4,   // points per grain cleared (before multipliers)
    B2B_MIN_GRAINS: 220,    // clear size that counts toward back-to-back
    B2B_BONUS: 1.5,         // multiplier while back-to-back is active
    COMBO_WINDOW_MS: 1600,  // time window to chain clears into a combo

    // Level progression (gentle, for a relaxing ramp).
    LINES_PER_LEVEL: 6,     // clears needed to advance a level
  };

  Sand.CONFIG = CONFIG;
  Sand.SAND_COLORS = SAND_COLORS;
  Sand.SHADE_FACTORS = SHADE_FACTORS;
  Sand.PIECES = PIECES;
  Sand.PIECE_TYPES = PIECE_TYPES;
  Sand.KICKS_JLSTZ = KICKS_JLSTZ;
  Sand.KICKS_I = KICKS_I;

  /* --------------------------------------------------------------------- *
   * Colour lookup table: maps a stored Uint8 grain value -> [r,g,b].
   * Index 0 is empty (unused for drawing). Built once at load.
   * --------------------------------------------------------------------- */
  const COLOR_TABLE = new Uint8Array((1 + SAND_COLORS.length * SHADES) * 3);
  for (let c = 0; c < SAND_COLORS.length; c++) {
    for (let s = 0; s < SHADES; s++) {
      const value = 1 + c * SHADES + s;
      const f = SHADE_FACTORS[s];
      const base = SAND_COLORS[c].base;
      COLOR_TABLE[value * 3 + 0] = Math.min(255, Math.round(base[0] * f));
      COLOR_TABLE[value * 3 + 1] = Math.min(255, Math.round(base[1] * f));
      COLOR_TABLE[value * 3 + 2] = Math.min(255, Math.round(base[2] * f));
    }
  }
  Sand.COLOR_TABLE = COLOR_TABLE;

  /* Encode a colour index + shade into a stored grain value. */
  Sand.encodeGrain = function (colorIndex, shade) {
    return 1 + colorIndex * SHADES + shade;
  };
  /* Decode the colour index (0..N-1) from a stored grain value. */
  Sand.colorOf = function (value) {
    return Math.floor((value - 1) / SHADES);
  };

  /* CSS colour string for a base colour index (used by DOM UI / previews). */
  Sand.cssColor = function (colorIndex) {
    const b = SAND_COLORS[colorIndex].base;
    return 'rgb(' + b[0] + ',' + b[1] + ',' + b[2] + ')';
  };
})(typeof window !== 'undefined' ? window : this);
