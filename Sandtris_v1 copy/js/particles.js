/* =========================================================================
 * particles.js
 * -------------------------------------------------------------------------
 * Two things live here:
 *
 *   SandField      - the grid of sand grains that is the heart of the game.
 *                    Stores occupancy/colour, stamps locked pieces into
 *                    grains, and detects the signature "same colour spans
 *                    from the left wall to the right wall" clears.
 *
 *   EffectParticles- lightweight, purely-visual particles (sparkle bursts on
 *                    clears / hard drops). They do not interact with sand.
 *
 * The falling-sand *simulation* (gravity) lives separately in physics.js so
 * that data (this file) and behaviour (physics) stay decoupled.
 * ========================================================================= */

(function (global) {
  'use strict';

  const Sand = (global.Sand = global.Sand || {});
  const C = Sand.CONFIG;

  /* ===================================================================== *
   * SandField
   * ===================================================================== */
  class SandField {
    constructor() {
      this.w = C.GRID_W;
      this.h = C.GRID_H;
      this.grid = new Uint8Array(this.w * this.h);   // 0 empty else grain value
      this.clearMask = new Uint8Array(this.w * this.h); // 1 = flashing for clear

      // Flood-fill scratch buffers (reused between detections).
      this._visitedGen = new Int32Array(this.w * this.h);
      this._gen = 0;
      this._stack = new Int32Array(this.w * this.h);
      this._component = new Int32Array(this.w * this.h);

      this.pendingClear = [];   // indices awaiting deletion after flash
      this.pendingBounds = null;
    }

    idx(x, y) {
      return y * this.w + x;
    }
    inBounds(x, y) {
      return x >= 0 && x < this.w && y >= 0 && y < this.h;
    }
    isEmpty(x, y) {
      return this.grid[y * this.w + x] === 0;
    }

    reset() {
      this.grid.fill(0);
      this.clearMask.fill(0);
      this.pendingClear.length = 0;
      this.pendingBounds = null;
    }

    /* Fill a BLOCK x BLOCK region with grains of the given colour. `density`
     * (0..1) is the probability each grain is placed, letting the particle
     * density setting thin out the sand. */
    stampBlock(cellX, cellY, colorIndex, density) {
      const B = C.BLOCK;
      for (let dy = 0; dy < B; dy++) {
        const y = cellY + dy;
        if (y < 0 || y >= this.h) continue;
        for (let dx = 0; dx < B; dx++) {
          const x = cellX + dx;
          if (x < 0 || x >= this.w) continue;
          if (density < 1 && Math.random() > density) continue;
          const shade = (Math.random() * C.SHADES) | 0;
          this.grid[y * this.w + x] = Sand.encodeGrain(colorIndex, shade);
        }
      }
    }

    /* Highest occupied row (smallest y). Returns h if the field is empty. */
    highestOccupiedRow() {
      const g = this.grid;
      for (let y = 0; y < this.h; y++) {
        const base = y * this.w;
        for (let x = 0; x < this.w; x++) {
          if (g[base + x] !== 0) return y;
        }
      }
      return this.h;
    }

    countGrains() {
      const g = this.grid;
      let n = 0;
      for (let i = 0; i < g.length; i++) if (g[i] !== 0) n++;
      return n;
    }

    /* ------------------------------------------------------------------- *
     * Clear detection.
     *
     * A clear happens when a connected region (4-directional) of grains that
     * all share the same base colour touches BOTH the left wall (x = 0) and
     * the right wall (x = w-1). Every such spanning region is flagged.
     *
     * This does NOT delete grains; it fills `clearMask` (for the flash) and
     * records `pendingClear`. Call commitClears() after the flash to delete.
     *
     * Returns null if nothing spans, otherwise:
     *   { count, components, bounds:{minX,minY,maxX,maxY,cx,cy}, colorCounts }
     * ------------------------------------------------------------------- */
    detectClears() {
      const g = this.grid;
      const w = this.w, h = this.h;
      this._gen++;
      const gen = this._gen;
      const visited = this._visitedGen;
      const stack = this._stack;
      const comp = this._component;

      const cleared = this.pendingClear;
      cleared.length = 0;
      let components = 0;
      let minX = w, minY = h, maxX = -1, maxY = -1;
      let sumX = 0, sumY = 0;
      const colorCounts = [0, 0, 0, 0];

      // Seed from every occupied cell on the left column.
      for (let y = 0; y < h; y++) {
        const seed = y * w; // x = 0
        if (g[seed] === 0 || visited[seed] === gen) continue;

        const color = Sand.colorOf(g[seed]);
        let sp = 0;
        let compLen = 0;
        let touchesRight = false;

        visited[seed] = gen;
        stack[sp++] = seed;

        while (sp > 0) {
          const cur = stack[--sp];
          comp[compLen++] = cur;
          const cx = cur % w;
          if (cx === w - 1) touchesRight = true;

          // 4-neighbours of the same colour.
          // left
          if (cx > 0) {
            const n = cur - 1;
            if (g[n] !== 0 && visited[n] !== gen && Sand.colorOf(g[n]) === color) {
              visited[n] = gen; stack[sp++] = n;
            }
          }
          // right
          if (cx < w - 1) {
            const n = cur + 1;
            if (g[n] !== 0 && visited[n] !== gen && Sand.colorOf(g[n]) === color) {
              visited[n] = gen; stack[sp++] = n;
            }
          }
          // up
          if (cur >= w) {
            const n = cur - w;
            if (g[n] !== 0 && visited[n] !== gen && Sand.colorOf(g[n]) === color) {
              visited[n] = gen; stack[sp++] = n;
            }
          }
          // down
          if (cur < w * (h - 1)) {
            const n = cur + w;
            if (g[n] !== 0 && visited[n] !== gen && Sand.colorOf(g[n]) === color) {
              visited[n] = gen; stack[sp++] = n;
            }
          }
        }

        if (touchesRight) {
          components++;
          colorCounts[color] += compLen;
          for (let i = 0; i < compLen; i++) {
            const ci = comp[i];
            this.clearMask[ci] = 1;
            cleared.push(ci);
            const px = ci % w, py = (ci / w) | 0;
            if (px < minX) minX = px;
            if (px > maxX) maxX = px;
            if (py < minY) minY = py;
            if (py > maxY) maxY = py;
            sumX += px; sumY += py;
          }
        }
      }

      if (components === 0) {
        this.pendingBounds = null;
        return null;
      }

      const n = cleared.length;
      this.pendingBounds = {
        minX, minY, maxX, maxY,
        cx: sumX / n, cy: sumY / n,
      };
      return {
        count: n,
        components,
        bounds: this.pendingBounds,
        colorCounts,
      };
    }

    /* Delete the grains recorded by the last detectClears() and clear the
     * flash mask. Sand above will fall on subsequent simulation steps. */
    commitClears() {
      const cleared = this.pendingClear;
      for (let i = 0; i < cleared.length; i++) {
        const ci = cleared[i];
        this.grid[ci] = 0;
        this.clearMask[ci] = 0;
      }
      cleared.length = 0;
      this.pendingBounds = null;
    }
  }

  /* ===================================================================== *
   * EffectParticles - decorative sparkles (pooled to avoid allocations).
   * ===================================================================== */
  class EffectParticles {
    constructor(max) {
      this.max = max || 400;
      this.count = 0;
      // Structure-of-arrays for cache-friendliness and no per-particle GC.
      this.x = new Float32Array(this.max);
      this.y = new Float32Array(this.max);
      this.vx = new Float32Array(this.max);
      this.vy = new Float32Array(this.max);
      this.life = new Float32Array(this.max);
      this.maxLife = new Float32Array(this.max);
      this.color = new Uint8Array(this.max); // base colour index, 255 = white
    }

    /* Spawn `n` particles from a point given in sand-cell coordinates. */
    spawn(x, y, colorIndex, n, spread, speed) {
      spread = spread || 3;
      speed = speed || 40;
      for (let i = 0; i < n && this.count < this.max; i++) {
        const k = this.count++;
        const a = Math.random() * Math.PI * 2;
        const sp = speed * (0.3 + Math.random() * 0.7);
        this.x[k] = x + (Math.random() - 0.5) * spread;
        this.y[k] = y + (Math.random() - 0.5) * spread;
        this.vx[k] = Math.cos(a) * sp;
        this.vy[k] = Math.sin(a) * sp - 20;
        this.maxLife[k] = 0.4 + Math.random() * 0.5;
        this.life[k] = this.maxLife[k];
        this.color[k] = colorIndex;
      }
    }

    update(dt) {
      let i = 0;
      while (i < this.count) {
        this.life[i] -= dt;
        if (this.life[i] <= 0) {
          // Swap-remove with the last live particle.
          const last = --this.count;
          this.x[i] = this.x[last];
          this.y[i] = this.y[last];
          this.vx[i] = this.vx[last];
          this.vy[i] = this.vy[last];
          this.life[i] = this.life[last];
          this.maxLife[i] = this.maxLife[last];
          this.color[i] = this.color[last];
          continue;
        }
        this.vy[i] += 120 * dt; // gravity
        this.x[i] += this.vx[i] * dt;
        this.y[i] += this.vy[i] * dt;
        i++;
      }
    }

    clear() {
      this.count = 0;
    }
  }

  Sand.SandField = SandField;
  Sand.EffectParticles = EffectParticles;
})(typeof window !== 'undefined' ? window : this);
