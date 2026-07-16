/* =========================================================================
 * physics.js
 * -------------------------------------------------------------------------
 * The falling-sand simulation. This is the behavioural half of the sand
 * system (SandField in particles.js is the data half).
 *
 * Each grain tries to move, in priority order:
 *     1. straight down
 *     2. down + one side   (down-left / down-right)
 * The left/right preference is randomised so the pile has no directional
 * bias. A grain only ever descends, so the simulation always converges.
 *
 * Grains are processed bottom row first so that a grain moves at most once
 * per step (it falls into an already-processed row).
 * ========================================================================= */

(function (global) {
  'use strict';

  const Sand = (global.Sand = global.Sand || {});

  const Physics = {
    /* Advance the sand one simulation step. Returns the number of grains that
     * moved, which the game loop uses to know when the field has settled. */
    step(field) {
      const g = field.grid;
      const mask = field.clearMask; // grains flagged for a clear are frozen
      const w = field.w;
      const h = field.h;
      let moved = 0;

      // Randomise horizontal scan direction each step (anti-bias).
      const leftToRight = Math.random() < 0.5;

      for (let y = h - 2; y >= 0; y--) {
        const rowBase = y * w;
        const belowBase = rowBase + w;

        if (leftToRight) {
          for (let x = 0; x < w; x++) {
            if (mask[rowBase + x]) continue; // frozen while flashing
            if (Physics._tryFall(g, w, h, x, y, rowBase, belowBase)) moved++;
          }
        } else {
          for (let x = w - 1; x >= 0; x--) {
            if (mask[rowBase + x]) continue;
            if (Physics._tryFall(g, w, h, x, y, rowBase, belowBase)) moved++;
          }
        }
      }
      return moved;
    },

    /* Attempt to move a single grain down. Returns true if it moved. */
    _tryFall(g, w, h, x, y, rowBase, belowBase) {
      const here = rowBase + x;
      const value = g[here];
      if (value === 0) return false;

      // 1. Straight down.
      const down = belowBase + x;
      if (g[down] === 0) {
        g[down] = value;
        g[here] = 0;
        return true;
      }

      // 2. Diagonals, with a per-grain randomised preference so piles are
      //    symmetric on average (satisfies "randomise left/right priority").
      const preferLeft = Math.random() < 0.5;
      const canLeft = x > 0 && g[belowBase + x - 1] === 0 && g[rowBase + x - 1] === 0;
      const canRight = x < w - 1 && g[belowBase + x + 1] === 0 && g[rowBase + x + 1] === 0;

      if (preferLeft) {
        if (canLeft) {
          g[belowBase + x - 1] = value; g[here] = 0; return true;
        }
        if (canRight) {
          g[belowBase + x + 1] = value; g[here] = 0; return true;
        }
      } else {
        if (canRight) {
          g[belowBase + x + 1] = value; g[here] = 0; return true;
        }
        if (canLeft) {
          g[belowBase + x - 1] = value; g[here] = 0; return true;
        }
      }
      return false;
    },
  };

  Sand.Physics = Physics;
})(typeof window !== 'undefined' ? window : this);
