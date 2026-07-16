/* =========================================================================
 * settings.js
 * -------------------------------------------------------------------------
 * Persistent save data (kept intentionally small):
 *   - Settings   : user options (volumes, movement mode, display toggles)
 *   - HighScore  : the single highest score ever achieved
 *   - KeyBindings: fixed default keyboard controls (no rebinding UI)
 *
 * Per the "simple game" direction, no gameplay statistics are stored.
 * ========================================================================= */

(function (global) {
  'use strict';

  const Sand = (global.Sand = global.Sand || {});
  const Storage = Sand.Storage;

  /* --------------------------------------------------------------------- *
   * Settings
   * --------------------------------------------------------------------- */
  const DEFAULT_SETTINGS = {
    musicVolume: 0.5,
    sfxVolume: 0.7,
    movementMode: 'smooth', // 'smooth' | 'grid'
    ghostPiece: true,
    showGrid: false,
    screenShake: true,
  };

  const Settings = {
    data: Object.assign({}, DEFAULT_SETTINGS, Storage.get('settings', {})),

    get(key) {
      return this.data[key];
    },
    set(key, value) {
      this.data[key] = value;
      this.save();
    },
    reset() {
      this.data = Object.assign({}, DEFAULT_SETTINGS);
      this.save();
    },
    save() {
      Storage.set('settings', this.data);
    },
  };

  /* --------------------------------------------------------------------- *
   * Highest score — the only persisted gameplay data.
   * --------------------------------------------------------------------- */
  const HighScore = {
    value: Storage.get('highscore', 0) || 0,

    /* Record a score; returns true if it is a new best. */
    submit(score) {
      if (score > this.value) {
        this.value = score;
        Storage.set('highscore', score);
        return true;
      }
      return false;
    },
    reset() {
      this.value = 0;
      Storage.set('highscore', 0);
    },
  };

  /* --------------------------------------------------------------------- *
   * Fixed keyboard controls. Values are KeyboardEvent.code strings.
   * --------------------------------------------------------------------- */
  const KeyBindings = {
    keys: {
      moveLeft: 'ArrowLeft',
      moveRight: 'ArrowRight',
      softDrop: 'ArrowDown',
      hardDrop: 'Space',
      rotateCW: 'ArrowUp',
      rotateCCW: 'KeyZ',
      hold: 'KeyC',
      pause: 'Escape',
    },
    /* Return the action bound to a physical key code, or null. */
    actionFor(code) {
      for (const action in this.keys) {
        if (this.keys[action] === code) return action;
      }
      return null;
    },
  };

  /* --------------------------------------------------------------------- *
   * One-time migration / cleanup from the older multi-mode version.
   * - Adopt the best score from the old per-mode high-score store.
   * - Drop obsolete data (statistics, per-mode scores) and unknown settings.
   * --------------------------------------------------------------------- */
  (function migrate() {
    const oldScores = Storage.get('highscores', null);
    if (oldScores && HighScore.value === 0) {
      let best = 0;
      ['classic', 'endless', 'sprint'].forEach((m) => {
        (oldScores[m] || []).forEach((e) => { if (e && e.score > best) best = e.score; });
      });
      if (best > 0) { HighScore.value = best; Storage.set('highscore', best); }
    }
    Storage.remove('highscores');
    Storage.remove('stats');
    Storage.remove('keys');

    // Keep only recognised settings keys, then persist the cleaned object.
    let changed = false;
    Object.keys(Settings.data).forEach((k) => {
      if (!(k in DEFAULT_SETTINGS)) { delete Settings.data[k]; changed = true; }
    });
    if (changed) Settings.save();
  })();

  Sand.Settings = Settings;
  Sand.HighScore = HighScore;
  Sand.KeyBindings = KeyBindings;
})(typeof window !== 'undefined' ? window : this);
