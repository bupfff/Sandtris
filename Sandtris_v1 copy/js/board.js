/* =========================================================================
 * board.js
 * -------------------------------------------------------------------------
 * The in-play field logic. Owns the SandField, the active falling piece, the
 * hold slot and the next-piece queue.
 *
 * Lifecycle (redesigned for feel):
 *
 *   play  --lock-->  landing (hold solid shape ~90ms)  --> stamp grains +
 *   spawn next piece immediately.  The just-stamped grains then crumble in
 *   the background while the player already controls the next piece.
 *
 * The sand simulation and clear detection run *continuously* every frame, so
 * the collapse is watchable and never gates the next piece (no sluggish
 * "wait for settle" pause). Clears flash, then delete, then the sand above
 * cascades. Board raises events through `hooks`; game.js owns scoring/rules.
 * ========================================================================= */

(function (global) {
  'use strict';

  const Sand = (global.Sand = global.Sand || {});
  const C = Sand.CONFIG;
  const NOOP = function () {};

  class Board {
    constructor(hooks) {
      this.field = new Sand.SandField();
      this.effects = new Sand.EffectParticles(600);
      this.hooks = Object.assign(
        {
          onLand: NOOP,     // (piece)  piece locked; solid shape now showing
          onClear: NOOP,    // (info)   a clear happened -> score it
          onSpawn: NOOP,    // (piece)
          onTopOut: NOOP,   // ()
          onSoftDrop: NOOP, // (cells)
          onHardDrop: NOOP, // (cells)
          onMove: NOOP,     // ()
          onRotate: NOOP,   // ()
          onHold: NOOP,     // ()
        },
        hooks || {}
      );

      this.bag = null;
      this.piece = null;
      this.holdType = null;
      this.canHold = true;

      this.phase = 'idle'; // idle | play | landing

      // Piece dynamics.
      this._fallAcc = 0;
      this.lockTimer = -1;
      this.lockResets = 0;
      this.landTimer = 0;

      // Continuous clear / combo bookkeeping.
      this.combo = 0;
      this.comboTimer = 0;
      this.b2bActive = false;
      this.flashActive = false;
      this.flashTimer = 0;
      this.flashProgress = 0;
      this._detectCounter = 0;
    }

    /* Begin a fresh game. */
    reset() {
      this.field.reset();
      this.effects.clear();
      this.bag = new Sand.Bag(5);
      this.holdType = null;
      this.canHold = true;
      this.combo = 0;
      this.comboTimer = 0;
      this.b2bActive = false;
      this.flashActive = false;
      this.flashProgress = 0;
      this.piece = null;
      this._spawn();
    }

    /* ------------------------------------------------------------------- *
     * Collision test for a hypothetical placement.
     * ------------------------------------------------------------------- */
    collides(matrix, gridX, topCellY) {
      const B = C.BLOCK;
      const g = this.field.grid;
      const W = this.field.w, H = this.field.h;
      for (let r = 0; r < matrix.length; r++) {
        for (let c = 0; c < matrix[r].length; c++) {
          if (!matrix[r][c]) continue;
          const x0 = (gridX + c) * B;
          const y0 = topCellY + r * B;
          if (x0 < 0 || x0 + B > W || y0 < 0 || y0 + B > H) return true;
          for (let yy = 0; yy < B; yy++) {
            const base = (y0 + yy) * W + x0;
            for (let xx = 0; xx < B; xx++) {
              if (g[base + xx] !== 0) return true;
            }
          }
        }
      }
      return false;
    }

    _canMoveDown() {
      return !this.collides(this.piece.matrix, this.piece.gridX, this.piece.pixelY + 1);
    }

    /* ------------------------------------------------------------------- *
     * Player actions (only during the 'play' phase).
     * ------------------------------------------------------------------- */
    moveHorizontal(dir) {
      if (this.phase !== 'play' || !this.piece) return false;
      const nx = this.piece.gridX + dir;
      if (this.collides(this.piece.matrix, nx, this.piece.pixelY)) return false;
      this.piece.gridX = nx;
      this._onManipulate();
      this.hooks.onMove();
      return true;
    }

    rotate(dir) {
      if (this.phase !== 'play' || !this.piece) return false;
      if (this.piece.type === 'O') return false;
      const newMatrix = this.piece.rotatedMatrix(dir);
      const { to, offsets } = this.piece.kicksFor(dir);
      for (let i = 0; i < offsets.length; i++) {
        const kx = offsets[i][0];
        const ky = offsets[i][1];
        const nx = this.piece.gridX + kx;
        const ny = this.piece.pixelY - ky * C.BLOCK;
        if (!this.collides(newMatrix, nx, ny)) {
          this.piece.matrix = newMatrix;
          this.piece.rotation = to;
          this.piece.gridX = nx;
          this.piece.pixelY = ny;
          this.piece.rotPop = 1; // trigger the rotation "pop" animation
          this._onManipulate();
          this.hooks.onRotate();
          return true;
        }
      }
      return false;
    }

    hardDrop() {
      if (this.phase !== 'play' || !this.piece) return;
      let cells = 0;
      while (this._canMoveDown()) { this.piece.pixelY += 1; cells++; }
      if (cells > 0) this.hooks.onHardDrop(cells);
      // Snap the visual down instantly; the impact is sold by dust + shake.
      this.piece.renderYCell = this.piece.pixelY;
      this._spawnDust();
      this._startLanding();
    }

    hold() {
      if (this.phase !== 'play' || !this.piece || !this.canHold) return;
      const current = this.piece.type;
      if (this.holdType) {
        const swap = this.holdType;
        this.holdType = current;
        this._spawn(swap);
      } else {
        this.holdType = current;
        this._spawn();
      }
      this.canHold = false;
      this.hooks.onHold();
    }

    _onManipulate() {
      if (this.lockTimer >= 0 && this.lockResets < C.LOCK_RESET_MAX) {
        this.lockTimer = C.LOCK_DELAY_MS;
        this.lockResets++;
      }
    }

    /* ------------------------------------------------------------------- *
     * Main update.
     * ------------------------------------------------------------------- */
    update(dt, gravityCps, softDrop) {
      // 1. Sand simulation runs every frame (continuous background crumble).
      for (let i = 0; i < C.SIM_STEPS_PER_FRAME; i++) {
        Sand.Physics.step(this.field);
      }

      // 2. Active-piece phase logic.
      if (this.phase === 'play') this._updatePlay(dt, gravityCps, softDrop);
      else if (this.phase === 'landing') this._updateLanding(dt);

      // 3. Smooth visual interpolation of the active piece.
      if (this.piece) this._updatePieceVisual(dt);

      // 4. Continuous line-clear detection + flash lifecycle.
      this._updateClears(dt);

      // 5. Combo window decay.
      if (this.comboTimer > 0) {
        this.comboTimer -= dt * 1000;
        if (this.comboTimer <= 0) this.combo = 0;
      }

      // 6. Decorative particles.
      this.effects.update(dt);
    }

    _updatePlay(dt, gravityCps, softDrop) {
      const piece = this.piece;
      if (!piece) return;

      const cps = softDrop
        ? Math.max(gravityCps, C.SOFT_DROP_CELLS_PER_SEC)
        : gravityCps;
      this._fallAcc += cps * dt;

      let softCells = 0;
      while (this._fallAcc >= 1) {
        if (this._canMoveDown()) {
          piece.pixelY += 1;
          this._fallAcc -= 1;
          if (softDrop) softCells++;
        } else {
          this._fallAcc = 0;
          break;
        }
      }
      if (softCells > 0) this.hooks.onSoftDrop(softCells);

      // Lock delay.
      const grounded = !this._canMoveDown();
      if (grounded) {
        if (this.lockTimer < 0) this.lockTimer = C.LOCK_DELAY_MS;
        else {
          this.lockTimer -= dt * 1000;
          if (this.lockTimer <= 0) this._startLanding();
        }
      } else {
        this.lockTimer = -1;
      }
    }

    /* Piece has locked: hold its solid shape briefly before it crumbles. */
    _startLanding() {
      this.phase = 'landing';
      this.landTimer = C.LAND_PAUSE_MS;
      this.lockTimer = -1;
      this._fallAcc = 0;
      this.hooks.onLand(this.piece);
    }

    _updateLanding(dt) {
      this.landTimer -= dt * 1000;
      if (this.landTimer <= 0) this._stampAndSpawn();
    }

    /* Convert the landed piece into sand grains, then spawn the next piece
     * immediately so play never stalls while the grains settle. */
    _stampAndSpawn() {
      const piece = this.piece;
      const B = C.BLOCK;
      const cells = piece.filledCells();
      for (let i = 0; i < cells.length; i++) {
        const r = cells[i][0], c = cells[i][1];
        this.field.stampBlock((piece.gridX + c) * B, piece.pixelY + r * B, piece.color, 1);
      }
      this.piece = null;
      this._spawn();
    }

    /* --------------------------- interpolation ------------------------- */
    _updatePieceVisual(dt) {
      const p = this.piece;
      const targetX = p.gridX * C.BLOCK;
      const targetY = p.pixelY;

      if (Sand.Settings.get('movementMode') === 'grid') {
        p.renderXCell = targetX;
        p.renderYCell = targetY;
      } else {
        const ms = dt * 1000;
        const kx = 1 - Math.exp(-ms / C.MOVE_TAU_MS);
        const ky = 1 - Math.exp(-ms / C.FALL_TAU_MS);
        p.renderXCell += (targetX - p.renderXCell) * kx;
        p.renderYCell += (targetY - p.renderYCell) * ky;
        if (Math.abs(targetX - p.renderXCell) < 0.05) p.renderXCell = targetX;
        if (Math.abs(targetY - p.renderYCell) < 0.05) p.renderYCell = targetY;
      }

      if (p.rotPop > 0) {
        p.rotPop -= (dt * 1000) / 130;
        if (p.rotPop < 0) p.rotPop = 0;
      }
    }

    /* ----------------------------- clears ------------------------------ */
    _updateClears(dt) {
      if (this.flashActive) {
        this.flashTimer -= dt * 1000;
        this.flashProgress = 1 - Math.max(0, this.flashTimer / C.FLASH_MS);
        if (this.flashTimer <= 0) this._commitFlash();
        return;
      }
      // Throttle detection to a few times a second (cheap and avoids
      // clearing mid-cascade too eagerly).
      if (++this._detectCounter < 3) return;
      this._detectCounter = 0;

      const info = this.field.detectClears();
      if (info) this._beginFlash(info);
    }

    _beginFlash(info) {
      this.combo++;
      this.comboTimer = C.COMBO_WINDOW_MS;

      const big = info.count >= C.B2B_MIN_GRAINS;
      info.b2b = big && this.b2bActive;
      info.combo = this.combo;
      this.b2bActive = big;

      let dom = 0, best = -1;
      for (let i = 0; i < info.colorCounts.length; i++) {
        if (info.colorCounts[i] > best) { best = info.colorCounts[i]; dom = i; }
      }
      info.dominantColor = dom;

      this.hooks.onClear(info);

      this.flashActive = true;
      this.flashTimer = C.FLASH_MS;
      this.flashProgress = 0;
    }

    _commitFlash() {
      // Sparkle burst along the cleared band, then delete the grains.
      const list = this.field.pendingClear;
      const step = Math.max(1, (list.length / 70) | 0);
      for (let i = 0; i < list.length; i += step) {
        const ci = list[i];
        const px = ci % this.field.w;
        const py = (ci / this.field.w) | 0;
        const cv = this.field.grid[ci];
        const col = cv ? Sand.colorOf(cv) : 0;
        this.effects.spawn(px, py, col, 1, 1.5, 60);
      }
      this.field.commitClears();
      this.flashActive = false;
      this.flashProgress = 0;
    }

    /* Dust puff at the base of a hard-dropped piece. */
    _spawnDust() {
      const p = this.piece;
      if (!p) return;
      const B = C.BLOCK;
      // Find, per column, the lowest filled cell to emit dust from.
      const b = p.bounds();
      for (let c = b.minC; c <= b.maxC; c++) {
        let lowest = -1;
        for (let r = 0; r < p.matrix.length; r++) if (p.matrix[r][c]) lowest = r;
        if (lowest < 0) continue;
        const x = (p.gridX + c) * B + B / 2;
        const y = p.pixelY + (lowest + 1) * B;
        this.effects.spawn(x, y, p.color, 3, B, 45);
      }
    }

    /* Spawn a new piece (or a specific type, for hold swaps). */
    _spawn(forcedType) {
      const type = forcedType || this.bag.next();
      const piece = new Sand.Piece(type);
      if (this.collides(piece.matrix, piece.gridX, piece.pixelY)) {
        // No room to place the new piece: game over.
        this.piece = piece;
        piece.snapRender();
        this.phase = 'idle';
        this.hooks.onTopOut();
        return;
      }
      this.piece = piece;
      piece.snapRender();
      piece.rotPop = 0.7; // subtle flash-in on spawn
      this.lockTimer = -1;
      this.lockResets = 0;
      this._fallAcc = 0;
      if (!forcedType) this.canHold = true;
      this.phase = 'play';
      this.hooks.onSpawn(piece);
    }

    /* Landing row (sand-cell top) for the ghost piece, or null. */
    ghostTop() {
      if (!this.piece) return null;
      let y = this.piece.pixelY;
      while (!this.collides(this.piece.matrix, this.piece.gridX, y + 1)) y++;
      return y;
    }

    previewTypes() {
      return this.bag ? this.bag.preview() : [];
    }
  }

  Sand.Board = Board;
})(typeof window !== 'undefined' ? window : this);
