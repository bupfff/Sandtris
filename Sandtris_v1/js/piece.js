/* =========================================================================
 * piece.js
 * -------------------------------------------------------------------------
 * Tetromino model and the 7-bag randomiser.
 *
 * Coordinate model (important):
 *   - A piece is a small matrix of blocks (1 = filled).
 *   - `gridX`  is the piece's left column measured in BLOCKS (integer).
 *   - `pixelY` is the piece's top edge measured in SAND CELLS (float), which
 *     lets the piece fall smoothly, sub-block, before it locks.
 *
 *   A filled matrix cell (r, c) therefore occupies the BLOCK x BLOCK region
 *   whose top-left sand cell is:
 *        x = (gridX + c) * BLOCK
 *        y = floor(pixelY) + r * BLOCK
 * ========================================================================= */

(function (global) {
  'use strict';

  const Sand = (global.Sand = global.Sand || {});
  const C = Sand.CONFIG;

  /* Deep-clone a matrix. */
  function cloneMatrix(m) {
    return m.map((row) => row.slice());
  }

  /* Rotate a square matrix. dir = 1 clockwise, -1 counter-clockwise. */
  function rotate(matrix, dir) {
    const n = matrix.length;
    const out = [];
    for (let r = 0; r < n; r++) out.push(new Array(n).fill(0));
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (dir === 1) out[c][n - 1 - r] = matrix[r][c];
        else out[n - 1 - c][r] = matrix[r][c];
      }
    }
    return out;
  }

  class Piece {
    constructor(type) {
      const def = Sand.PIECES[type];
      this.type = type;
      this.color = def.color;
      this.matrix = cloneMatrix(def.matrix);
      this.rotation = 0; // 0,1,2,3
      // Centre horizontally on spawn.
      const n = this.matrix.length;
      this.gridX = Math.floor((C.COLS - n) / 2);
      this.pixelY = 0;
      this.size = n;

      // Rendered position (in sand cells) for smooth movement. These ease
      // toward the logical position each frame; gameplay uses gridX/pixelY.
      this.renderXCell = this.gridX * C.BLOCK;
      this.renderYCell = this.pixelY;
      this.rotPop = 0; // 0..1 rotation "pop" animation timer
    }

    /* Snap the rendered position straight to the logical position. */
    snapRender() {
      this.renderXCell = this.gridX * C.BLOCK;
      this.renderYCell = this.pixelY;
    }

    /* List of filled [row, col] cells in the current matrix. */
    filledCells() {
      const cells = [];
      const m = this.matrix;
      for (let r = 0; r < m.length; r++) {
        for (let c = 0; c < m[r].length; c++) {
          if (m[r][c]) cells.push([r, c]);
        }
      }
      return cells;
    }

    /* The matrix this piece would have after rotating by dir. */
    rotatedMatrix(dir) {
      return rotate(this.matrix, dir);
    }

    /* Kick table entries for a rotation from this.rotation by dir. */
    kicksFor(dir) {
      const from = this.rotation;
      const to = (from + (dir === 1 ? 1 : 3)) % 4;
      const key = from + '>' + to;
      const table = this.type === 'I' ? Sand.KICKS_I : Sand.KICKS_JLSTZ;
      return { to, offsets: table[key] || [[0, 0]] };
    }

    /* Bounding rows/cols of filled cells (used for tidy ghost/preview draw). */
    bounds() {
      let minR = 99, maxR = -1, minC = 99, maxC = -1;
      const m = this.matrix;
      for (let r = 0; r < m.length; r++) {
        for (let c = 0; c < m[r].length; c++) {
          if (m[r][c]) {
            if (r < minR) minR = r;
            if (r > maxR) maxR = r;
            if (c < minC) minC = c;
            if (c > maxC) maxC = c;
          }
        }
      }
      return { minR, maxR, minC, maxC };
    }
  }

  /* --------------------------------------------------------------------- *
   * 7-bag randomiser: every 7 spawns contains each tetromino exactly once,
   * in random order. Keeps a look-ahead queue for the "next" preview.
   * --------------------------------------------------------------------- */
  class Bag {
    constructor(previewCount) {
      this.previewCount = previewCount || 5;
      this.bag = [];
      this.queue = [];
      while (this.queue.length < this.previewCount + 1) {
        this.queue.push(this._draw());
      }
    }

    _refill() {
      const types = Sand.PIECE_TYPES.slice();
      // Fisher-Yates shuffle.
      for (let i = types.length - 1; i > 0; i--) {
        const j = (Math.random() * (i + 1)) | 0;
        const t = types[i]; types[i] = types[j]; types[j] = t;
      }
      this.bag = types;
    }

    _draw() {
      if (this.bag.length === 0) this._refill();
      return this.bag.pop();
    }

    /* Pop the next piece type and top the queue back up. */
    next() {
      const type = this.queue.shift();
      this.queue.push(this._draw());
      return type;
    }

    /* Upcoming piece types for the preview UI. */
    preview() {
      return this.queue.slice(0, this.previewCount);
    }
  }

  Sand.Piece = Piece;
  Sand.Bag = Bag;
})(typeof window !== 'undefined' ? window : this);
