/* =========================================================================
 * game.js
 * -------------------------------------------------------------------------
 * The conductor. One game mode: Endless. Creates and wires every subsystem,
 * owns the state machine (menu / playing / paused / gameover), scoring,
 * gentle level progression, and the requestAnimationFrame loop.
 *
 * The only persisted gameplay value is the highest score.
 * ========================================================================= */

(function (global) {
  'use strict';

  const Sand = (global.Sand = global.Sand || {});
  const C = Sand.CONFIG;

  const Game = {
    state: 'menu', // menu | playing | paused | gameover

    score: 0,
    level: 1,
    lines: 0,
    bestCombo: 0,
    gravityCps: C.GRAVITY_TABLE[1],
    softDrop: false,

    lastTs: 0,
    _loopBound: null,
    _moveSoundAt: 0,

    /* ------------------------------- init ------------------------------ */
    init() {
      this.audio = Sand.Audio;
      this.audio.init();

      this.renderer = new Sand.Renderer(document.getElementById('board'));
      this.board = new Sand.Board(this._makeHooks());

      this.actions = {
        move: (dir) => { if (this.state === 'playing') this.board.moveHorizontal(dir); },
        rotate: (dir) => { if (this.state === 'playing') this.board.rotate(dir); },
        hardDrop: () => { if (this.state === 'playing') this.board.hardDrop(); },
        hold: () => { if (this.state === 'playing') this.board.hold(); },
        pause: () => this.togglePause(),
        softDropChanged: (a) => { this.softDrop = a && this.state === 'playing'; },
      };

      this.input = new Sand.Input(this.actions);
      this.input.attach();

      Sand.UI.init(this);

      const unlock = () => this.audio.unlock();
      global.addEventListener('pointerdown', unlock);
      global.addEventListener('keydown', unlock);

      document.addEventListener('visibilitychange', () => {
        if (document.hidden && this.state === 'playing') this.pause();
      });
      global.addEventListener('blur', () => {
        if (this.state === 'playing') this.pause();
      });

      Sand.UI.show('screen-main');

      this._loopBound = this._loop.bind(this);
      this.lastTs = performance.now();
      requestAnimationFrame(this._loopBound);
    },

    /* --------------------------- board hooks --------------------------- */
    _makeHooks() {
      return {
        onLand: () => {
          this.audio.play('land');
          this.renderer.addShake(1.2);
        },
        onClear: (info) => this._onClear(info),
        onSpawn: () => this._updatePreviews(),
        onTopOut: () => this._finish(),
        onSoftDrop: (cells) => { this.score += cells * C.SOFT_DROP_POINTS; },
        onHardDrop: (cells) => {
          this.score += cells * C.HARD_DROP_POINTS;
          this.audio.play('harddrop');
          this.renderer.addShake(3);
        },
        onMove: () => {
          const now = performance.now();
          if (now - this._moveSoundAt > 55) {
            this.audio.play('move');
            this._moveSoundAt = now;
          }
        },
        onRotate: () => this.audio.play('rotate'),
        onHold: () => { this.audio.play('hold'); this._updatePreviews(); },
      };
    },

    /* --------------------------- scoring ------------------------------- */
    _onClear(info) {
      const grains = info.count;
      const comboFactor = 1 + 0.2 * Math.max(0, info.combo - 1);
      const b2bFactor = info.b2b ? C.B2B_BONUS : 1;
      this.score += Math.round(
        grains * C.CLEAR_BASE_POINTS * this.level * comboFactor * b2bFactor
      );

      this.lines += info.components;
      this.bestCombo = Math.max(this.bestCombo, info.combo);

      this.audio.play('clear');
      if (info.combo > 1) this.audio.play('combo');
      this.renderer.addShake(Math.min(10, 3 + grains / 45));

      let text = '';
      if (info.combo > 1) text = 'COMBO x' + info.combo;
      else if (info.components > 1) text = info.components + 'x CLEAR';
      if (info.b2b) text = (text ? text + '  ' : '') + 'B2B';
      if (text) Sand.UI.showCombo(text);

      this._checkLevel();
    },

    _checkLevel() {
      const target = 1 + Math.floor(this.lines / C.LINES_PER_LEVEL);
      if (target > this.level) {
        this.level = target;
        this._updateGravity();
        this.audio.play('levelup');
        Sand.UI.showCombo('LEVEL ' + this.level);
      }
    },

    _updateGravity() {
      const t = C.GRAVITY_TABLE;
      this.gravityCps = t[Math.min(this.level, t.length - 1)];
    },

    /* ---------------------------- lifecycle ---------------------------- */
    startGame() {
      this.score = 0;
      this.level = 1;
      this.lines = 0;
      this.bestCombo = 0;
      this.softDrop = false;
      this.input.releaseAll();
      this._updateGravity();

      Sand.UI.hidePause();
      Sand.UI.hideGameOver();
      Sand.UI.show('screen-game');
      Sand.UI.resize();

      this.board.reset();
      this._updatePreviews();
      this._syncHud();

      this.state = 'playing';
      this.lastTs = performance.now();
      this.audio.unlock();
      this.audio.startMusic();
    },

    restart() {
      this.audio.stopMusic();
      this.startGame();
    },

    quitToMenu() {
      this.state = 'menu';
      this.softDrop = false;
      this.input.releaseAll();
      this.audio.stopMusic();
      Sand.UI.hidePause();
      Sand.UI.hideGameOver();
      Sand.UI.show('screen-main');
    },

    togglePause() {
      if (this.state === 'playing') this.pause();
      else if (this.state === 'paused') this.resume();
    },
    pause() {
      if (this.state !== 'playing') return;
      this.state = 'paused';
      this.softDrop = false;
      this.input.releaseAll();
      this.audio.stopMusic();
      Sand.UI.showPause();
    },
    resume() {
      if (this.state !== 'paused') return;
      Sand.UI.hidePause();
      this.state = 'playing';
      this.lastTs = performance.now();
      this.audio.startMusic();
      Sand.UI.resize();
    },

    _finish() {
      if (this.state !== 'playing') return;
      this.state = 'gameover';
      this.softDrop = false;
      this.input.releaseAll();
      this.audio.stopMusic();
      this.audio.play('gameover');
      this.renderer.addShake(8);

      const newBest = Sand.HighScore.submit(this.score);
      Sand.UI.showGameOver({
        score: this.score,
        best: Sand.HighScore.value,
        newBest,
      });
    },

    /* ----------------------------- helpers ----------------------------- */
    _updatePreviews() {
      Sand.UI.updateHold(this.board.holdType);
      Sand.UI.updateNext(this.board.previewTypes());
    },
    _syncHud() {
      Sand.UI.updateHud(this);
    },

    /* --------------------------- main loop ----------------------------- */
    _loop(ts) {
      requestAnimationFrame(this._loopBound);

      let dt = (ts - this.lastTs) / 1000;
      this.lastTs = ts;
      if (dt < 0) dt = 0;
      if (dt > 0.05) dt = 0.05; // clamp after tab switches / long frames

      if (this.state === 'playing') {
        this.input.update(dt);
        this.board.update(dt, this.gravityCps, this.softDrop);
        this._syncHud();
      }

      if (this.state !== 'menu') {
        this.renderer.render(this.board);
      }
    },
  };

  Sand.Game = Game;

  function boot() { Game.init(); }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(typeof window !== 'undefined' ? window : this);
