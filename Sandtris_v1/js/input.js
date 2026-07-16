/* =========================================================================
 * input.js
 * -------------------------------------------------------------------------
 * Unifies keyboard and touch into a single set of game actions and owns the
 * DAS (Delayed Auto Shift) / ARR (Auto Repeat Rate) timing for horizontal
 * movement, so held keys and held on-screen buttons behave identically.
 *
 * The game supplies an `actions` object; input never touches game state
 * directly. Rebinding is handled via a one-shot key-capture mode.
 * ========================================================================= */

(function (global) {
  'use strict';

  const Sand = (global.Sand = global.Sand || {});
  const C = Sand.CONFIG;

  class Input {
    constructor(actions) {
      // actions: { move(dir), rotate(dir), hardDrop(), hold(), pause(),
      //            softDropChanged(active) }
      this.actions = actions;

      this._down = new Set();     // physical key codes currently held
      this.leftHeld = false;
      this.rightHeld = false;
      this.softDropActive = false;

      // DAS/ARR state.
      this.dasDir = 0;            // -1, 0, +1
      this.dasTimer = 0;
      this.charged = false;
      this.arrTimer = 0;

      this._captureCb = null;     // active rebind capture callback

      this._onKeyDown = this._onKeyDown.bind(this);
      this._onKeyUp = this._onKeyUp.bind(this);
    }

    attach() {
      global.addEventListener('keydown', this._onKeyDown, { passive: false });
      global.addEventListener('keyup', this._onKeyUp);
    }
    detach() {
      global.removeEventListener('keydown', this._onKeyDown);
      global.removeEventListener('keyup', this._onKeyUp);
    }

    /* Capture the next key press for rebinding instead of acting on it. */
    captureNextKey(cb) {
      this._captureCb = cb;
    }
    cancelCapture() {
      this._captureCb = null;
    }

    /* ---- keyboard ---- */
    _onKeyDown(e) {
      // Rebind capture takes priority over everything.
      if (this._captureCb) {
        e.preventDefault();
        const cb = this._captureCb;
        this._captureCb = null;
        if (e.code !== 'Escape') cb(e.code);
        else cb(null);
        return;
      }

      const action = Sand.KeyBindings.actionFor(e.code);
      // Prevent page scrolling / space activation for bound game keys.
      if (action) e.preventDefault();
      if (this._down.has(e.code)) return; // ignore OS auto-repeat
      this._down.add(e.code);
      if (!action) return;

      switch (action) {
        case 'moveLeft': this.pressDir(-1); break;
        case 'moveRight': this.pressDir(1); break;
        case 'softDrop': this.setSoftDrop(true); break;
        case 'hardDrop': this.actions.hardDrop(); break;
        case 'rotateCW': this.actions.rotate(1); break;
        case 'rotateCCW': this.actions.rotate(-1); break;
        case 'hold': this.actions.hold(); break;
        case 'pause': this.actions.pause(); break;
        default: break;
      }
    }

    _onKeyUp(e) {
      this._down.delete(e.code);
      const action = Sand.KeyBindings.actionFor(e.code);
      if (!action) return;
      if (action === 'moveLeft') this.releaseDir(-1);
      else if (action === 'moveRight') this.releaseDir(1);
      else if (action === 'softDrop') this.setSoftDrop(false);
    }

    /* ---- shared press/release primitives (keyboard + touch) ---- */
    pressDir(dir) {
      if (dir === -1) this.leftHeld = true;
      else this.rightHeld = true;
      this.actions.move(dir);       // immediate first move
      this.dasDir = dir;
      this.dasTimer = C.DAS_MS;
      this.charged = false;
      this.arrTimer = 0;
    }

    releaseDir(dir) {
      if (dir === -1) this.leftHeld = false;
      else this.rightHeld = false;
      // Hand control to the other direction if it is still held.
      if (this.dasDir === dir) {
        if (dir === -1 && this.rightHeld) this.pressDir(1);
        else if (dir === 1 && this.leftHeld) this.pressDir(-1);
        else { this.dasDir = 0; this.charged = false; }
      }
    }

    setSoftDrop(active) {
      if (this.softDropActive === active) return;
      this.softDropActive = active;
      if (this.actions.softDropChanged) this.actions.softDropChanged(active);
    }

    /* Per-frame update drives auto-repeat. */
    update(dt) {
      if (this.dasDir === 0) return;
      const ms = dt * 1000;
      if (!this.charged) {
        this.dasTimer -= ms;
        if (this.dasTimer <= 0) {
          this.charged = true;
          this.arrTimer = 0;
        }
      }
      if (this.charged) {
        this.arrTimer -= ms;
        // Fire as many repeats as fit this frame (handles very low ARR).
        let guard = 0;
        while (this.arrTimer <= 0 && guard < 30) {
          this.actions.move(this.dasDir);
          this.arrTimer += C.ARR_MS;
          guard++;
        }
      }
    }

    /* Release all held inputs (used on pause / focus loss). */
    releaseAll() {
      this.leftHeld = this.rightHeld = false;
      this.dasDir = 0;
      this.charged = false;
      this.setSoftDrop(false);
      this._down.clear();
    }
  }

  Sand.Input = Input;
})(typeof window !== 'undefined' ? window : this);
