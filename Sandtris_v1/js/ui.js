/* =========================================================================
 * ui.js
 * -------------------------------------------------------------------------
 * Everything DOM: screen navigation, the in-game HUD, the settings and
 * high-score panels, hold & next previews, combo popups, on-screen touch
 * controls and responsive canvas sizing.
 *
 * Presentation only — UI calls back into the game for state changes and the
 * game calls UI to refresh the HUD.
 * ========================================================================= */

(function (global) {
  'use strict';

  const Sand = (global.Sand = global.Sand || {});
  const C = Sand.CONFIG;
  const $ = (id) => document.getElementById(id);

  const SCREEN_IDS = {
    main: 'screen-main',
    highscore: 'screen-highscore',
    settings: 'screen-settings',
    game: 'screen-game',
  };

  const UI = {
    game: null,
    currentScreen: 'screen-main',

    init(game) {
      this.game = game;
      this._cacheEls();
      this._bindMenus();
      this._bindSettings();
      this._bindTouch();
      this._buildNextList(5);

      if (!Sand.Storage.persistent) {
        $('storage-note').textContent = 'Storage unavailable — progress not saved';
      }
      this.refreshSettings();

      window.addEventListener('resize', () => this.resize());
      window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 200));
    },

    _cacheEls() {
      this.boardCanvas = $('board');
      this.boardArea = document.querySelector('.board-area');
      this.holdCanvas = $('hold-canvas');
      this.nextList = $('next-list');
      this.elScore = $('hud-score');
      this.elLevel = $('hud-level');
      this.elLines = $('hud-lines');
      this.comboPopup = $('combo-popup');
      this.overlayPause = $('overlay-pause');
      this.overlayGameOver = $('overlay-gameover');
      this.holdCanvas.width = 96; this.holdCanvas.height = 74;
    },

    /* ------------------------- navigation ------------------------------ */
    _bindMenus() {
      document.querySelectorAll('[data-nav]').forEach((btn) => {
        btn.addEventListener('click', () => {
          this.game.audio.play(btn.classList.contains('back-btn') ? 'back' : 'click');
          this.navigateTo(btn.dataset.nav);
        });
        this._hoverSound(btn);
      });

      $('btn-play').addEventListener('click', () => { this.game.audio.play('click'); this.game.startGame(); });
      this._hoverSound($('btn-play'));

      $('btn-pause').addEventListener('click', () => this.game.togglePause());
      $('btn-resume').addEventListener('click', () => { this.game.audio.play('click'); this.game.resume(); });
      $('btn-restart').addEventListener('click', () => { this.game.audio.play('click'); this.game.restart(); });
      $('btn-quit').addEventListener('click', () => { this.game.audio.play('back'); this.game.quitToMenu(); });
      $('btn-retry').addEventListener('click', () => { this.game.audio.play('click'); this.game.restart(); });
      $('btn-go-menu').addEventListener('click', () => { this.game.audio.play('back'); this.game.quitToMenu(); });

      $('btn-reset-settings').addEventListener('click', () => {
        Sand.Settings.reset(); this.refreshSettings(); this.game.audio.applyVolumes();
      });
      $('btn-reset-score').addEventListener('click', () => {
        Sand.HighScore.reset(); this.refreshHighScore(); this.game.audio.play('back');
      });
    },

    _hoverSound(btn) {
      btn.addEventListener('mouseenter', () => {
        if (this.game && this.game.audio) this.game.audio.play('hover');
      });
    },

    navigateTo(name) {
      const id = SCREEN_IDS[name] || 'screen-main';
      if (name === 'highscore') this.refreshHighScore();
      if (name === 'settings') this.refreshSettings();
      this.show(id);
    },

    show(id) {
      document.querySelectorAll('.screen').forEach((s) => s.classList.add('hidden'));
      const el = $(id);
      if (el) {
        el.classList.remove('hidden');
        // Restart the enter animation.
        el.classList.remove('screen-in');
        void el.offsetWidth;
        el.classList.add('screen-in');
      }
      this.currentScreen = id;
      if (id === 'screen-game') requestAnimationFrame(() => this.resize());
    },

    /* --------------------------- settings ------------------------------ */
    _bindSettings() {
      const music = $('set-music'), sfx = $('set-sfx');
      music.addEventListener('input', () => {
        Sand.Settings.set('musicVolume', music.value / 100);
        $('val-music').textContent = music.value;
        this.game.audio.applyVolumes();
      });
      sfx.addEventListener('input', () => {
        Sand.Settings.set('sfxVolume', sfx.value / 100);
        $('val-sfx').textContent = sfx.value;
        this.game.audio.applyVolumes();
      });
      sfx.addEventListener('change', () => this.game.audio.play('click'));

      // Movement mode (Smooth <-> Grid).
      $('tgl-movement').addEventListener('click', () => {
        const nv = Sand.Settings.get('movementMode') === 'smooth' ? 'grid' : 'smooth';
        Sand.Settings.set('movementMode', nv);
        this.game.audio.play('click');
        this._applyMovementVisual(nv);
      });

      // On/off toggles.
      document.querySelectorAll('.toggle-row[data-toggle]').forEach((row) => {
        const key = row.dataset.toggle;
        row.querySelector('.pix-toggle').addEventListener('click', () => {
          const nv = !Sand.Settings.get(key);
          Sand.Settings.set(key, nv);
          this.game.audio.play('click');
          this._applyToggleVisual(row, nv);
        });
      });
    },

    _applyToggleVisual(row, val) {
      const btn = row.querySelector('.pix-toggle');
      btn.textContent = val ? 'ON' : 'OFF';
      btn.classList.toggle('on', val);
    },
    _applyMovementVisual(mode) {
      const btn = $('tgl-movement');
      btn.textContent = mode === 'smooth' ? 'SMOOTH' : 'GRID';
    },

    refreshSettings() {
      const S = Sand.Settings;
      $('set-music').value = Math.round(S.get('musicVolume') * 100);
      $('val-music').textContent = Math.round(S.get('musicVolume') * 100);
      $('set-sfx').value = Math.round(S.get('sfxVolume') * 100);
      $('val-sfx').textContent = Math.round(S.get('sfxVolume') * 100);
      this._applyMovementVisual(S.get('movementMode'));
      document.querySelectorAll('.toggle-row[data-toggle]').forEach((row) => {
        this._applyToggleVisual(row, S.get(row.dataset.toggle));
      });
    },

    /* ------------------------- high score ------------------------------ */
    refreshHighScore() {
      $('hs-best').textContent = Sand.HighScore.value.toLocaleString();
    },

    /* ------------------------- previews / HUD -------------------------- */
    _buildNextList(count) {
      this.nextList.innerHTML = '';
      this.nextCanvases = [];
      for (let i = 0; i < count; i++) {
        const cv = document.createElement('canvas');
        cv.width = 96; cv.height = 54;
        this.nextList.appendChild(cv);
        this.nextCanvases.push(cv);
      }
    },

    updateHold(type) {
      const ctx = this.holdCanvas.getContext('2d');
      Sand.Renderer.drawPreview(ctx, type, this.holdCanvas.width, this.holdCanvas.height);
    },
    updateNext(types) {
      for (let i = 0; i < this.nextCanvases.length; i++) {
        const ctx = this.nextCanvases[i].getContext('2d');
        Sand.Renderer.drawPreview(ctx, types[i] || null,
          this.nextCanvases[i].width, this.nextCanvases[i].height);
      }
    },

    updateHud(state) {
      this.elScore.textContent = state.score.toLocaleString();
      this.elLevel.textContent = state.level;
      this.elLines.textContent = state.lines;
    },

    showCombo(text) {
      const el = this.comboPopup;
      el.textContent = text;
      el.classList.remove('show');
      void el.offsetWidth;
      el.classList.add('show');
    },

    /* --------------------------- overlays ------------------------------ */
    showPause() { this._showOverlay(this.overlayPause); },
    hidePause() { this.overlayPause.classList.add('hidden'); },

    showGameOver(data) {
      const rows = [
        ['SCORE', data.score.toLocaleString()],
        ['BEST', data.best.toLocaleString()],
      ];
      $('go-stats').innerHTML = rows.map(([l, v]) =>
        '<div class="go-stat-row"><span>' + l + '</span><span class="gv">' + v + '</span></div>'
      ).join('');
      $('go-newbest').classList.toggle('hidden', !data.newBest);
      this._showOverlay(this.overlayGameOver);
    },
    hideGameOver() { this.overlayGameOver.classList.add('hidden'); },

    _showOverlay(el) {
      el.classList.remove('hidden');
      el.classList.remove('screen-in');
      void el.offsetWidth;
      el.classList.add('screen-in');
    },

    /* --------------------------- touch --------------------------------- */
    _bindTouch() {
      const input = () => this.game.input;
      const act = () => this.game.actions;
      document.querySelectorAll('.tbtn').forEach((btn) => {
        const a = btn.dataset.act;
        const start = (e) => {
          e.preventDefault();
          btn.classList.add('pressed');
          this.game.audio.unlock();
          switch (a) {
            case 'left': input().pressDir(-1); break;
            case 'right': input().pressDir(1); break;
            case 'softdrop': input().setSoftDrop(true); break;
            case 'harddrop': act().hardDrop(); break;
            case 'rotcw': act().rotate(1); break;
            case 'rotccw': act().rotate(-1); break;
            case 'hold': act().hold(); break;
            default: break;
          }
        };
        const end = (e) => {
          if (e) e.preventDefault();
          btn.classList.remove('pressed');
          switch (a) {
            case 'left': input().releaseDir(-1); break;
            case 'right': input().releaseDir(1); break;
            case 'softdrop': input().setSoftDrop(false); break;
            default: break;
          }
        };
        btn.addEventListener('pointerdown', (e) => {
          if (btn.setPointerCapture) { try { btn.setPointerCapture(e.pointerId); } catch (x) {} }
          start(e);
        });
        btn.addEventListener('pointerup', end);
        btn.addEventListener('pointercancel', end);
        btn.addEventListener('lostpointercapture', end);
        btn.addEventListener('contextmenu', (e) => e.preventDefault());
      });
    },

    /* ------------------------ responsive sizing ------------------------ */
    resize() {
      const area = this.boardArea;
      const canvas = this.boardCanvas;
      if (!area) return;
      const aw = area.clientWidth;
      const ah = area.clientHeight;
      if (aw <= 0 || ah <= 0) return;
      const aspect = C.GRID_W / C.GRID_H;
      let w = aw;
      let h = w / aspect;
      if (h > ah) { h = ah; w = h * aspect; }
      canvas.style.width = Math.floor(w) + 'px';
      canvas.style.height = Math.floor(h) + 'px';
    },
  };

  Sand.UI = UI;
})(typeof window !== 'undefined' ? window : this);
