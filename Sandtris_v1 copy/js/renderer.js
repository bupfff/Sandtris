/* =========================================================================
 * renderer.js
 * -------------------------------------------------------------------------
 * All playfield drawing. Reads a Board and paints it; never mutates state.
 *
 * Two layers:
 *   1. The settled sand is written pixel-for-pixel into a tiny offscreen
 *      buffer (GRID_W x GRID_H) and blitted, nearest-neighbour, to the
 *      backing store — fast and crunchy.
 *   2. The active piece and ghost are drawn on top directly in the backing
 *      store, positioned to the nearest backing pixel. That gives ~40 sub-
 *      steps per block of smooth movement while keeping crisp pixel edges.
 * CSS then scales the canvas to the layout, again pixelated.
 * ========================================================================= */

(function (global) {
  'use strict';

  const Sand = (global.Sand = global.Sand || {});
  const C = Sand.CONFIG;

  const BG = [16, 16, 26];
  const GRID_LINE = 'rgba(255,255,255,0.05)';

  class Renderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.S = 5; // backing-store supersample factor

      canvas.width = C.GRID_W * this.S;
      canvas.height = C.GRID_H * this.S;
      this.ctx.imageSmoothingEnabled = false;

      this.buf = document.createElement('canvas');
      this.buf.width = C.GRID_W;
      this.buf.height = C.GRID_H;
      this.bufCtx = this.buf.getContext('2d');
      this.image = this.bufCtx.createImageData(C.GRID_W, C.GRID_H);
      const d = this.image.data;
      for (let i = 3; i < d.length; i += 4) d[i] = 255;

      this.shake = 0;
    }

    addShake(mag) {
      if (Sand.Settings.get('screenShake')) this.shake = Math.max(this.shake, mag);
    }

    render(board) {
      const ctx = this.ctx;
      const field = board.field;
      const grid = field.grid;
      const mask = field.clearMask;
      const table = Sand.COLOR_TABLE;
      const data = this.image.data;
      const W = C.GRID_W, H = C.GRID_H;
      const n = W * H;

      // Flash pulse for cleared grains.
      const fp = board.flashProgress || 0;
      const pulse = 0.5 + 0.5 * Math.abs(Math.sin(fp * Math.PI * 4));

      // 1. Paint background + settled sand into the buffer.
      for (let i = 0; i < n; i++) {
        const v = grid[i];
        const p = i * 4;
        if (v === 0) {
          data[p] = BG[0]; data[p + 1] = BG[1]; data[p + 2] = BG[2];
        } else if (mask[i]) {
          const base = v * 3;
          data[p] = table[base] + (255 - table[base]) * pulse;
          data[p + 1] = table[base + 1] + (255 - table[base + 1]) * pulse;
          data[p + 2] = table[base + 2] + (255 - table[base + 2]) * pulse;
        } else {
          const base = v * 3;
          data[p] = table[base];
          data[p + 1] = table[base + 1];
          data[p + 2] = table[base + 2];
        }
      }
      this.bufCtx.putImageData(this.image, 0, 0);

      // Screen-shake offset.
      let ox = 0, oy = 0;
      if (this.shake > 0.2) {
        ox = (Math.random() * 2 - 1) * this.shake;
        oy = (Math.random() * 2 - 1) * this.shake;
        this.shake *= 0.85;
      } else {
        this.shake = 0;
      }

      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      ctx.translate(ox, oy);
      ctx.drawImage(this.buf, 0, 0, this.canvas.width, this.canvas.height);

      // 2. Grid overlay.
      if (Sand.Settings.get('showGrid')) {
        ctx.strokeStyle = GRID_LINE;
        ctx.lineWidth = 1;
        const step = C.BLOCK * this.S;
        ctx.beginPath();
        for (let x = 0; x <= this.canvas.width; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, this.canvas.height); }
        for (let y = 0; y <= this.canvas.height; y += step) { ctx.moveTo(0, y); ctx.lineTo(this.canvas.width, y); }
        ctx.stroke();
      }

      // 3. Ghost piece (only while actively playing).
      const piece = board.piece;
      if (piece && Sand.Settings.get('ghostPiece') && board.phase === 'play') {
        const gy = board.ghostTop();
        if (gy !== null) this._drawGhost(ctx, piece, piece.renderXCell, gy);
      }

      // 4. Active piece (solid, beveled, smooth sub-pixel position).
      if (piece) this._drawPiece(ctx, piece);

      // 5. Effect particles.
      const fx = board.effects;
      if (fx.count > 0) {
        const S = this.S;
        const sz = Math.max(2, S - 1);
        for (let i = 0; i < fx.count; i++) {
          const a = Math.max(0, Math.min(1, fx.life[i] / fx.maxLife[i]));
          const col = Sand.SAND_COLORS[fx.color[i]] ? Sand.SAND_COLORS[fx.color[i]].base : [255, 255, 255];
          ctx.globalAlpha = a;
          ctx.fillStyle = 'rgb(' + Math.min(255, col[0] + 70) + ',' +
            Math.min(255, col[1] + 70) + ',' + Math.min(255, col[2] + 70) + ')';
          ctx.fillRect(Math.round(fx.x[i] * S - sz / 2), Math.round(fx.y[i] * S - sz / 2), sz, sz);
        }
        ctx.globalAlpha = 1;
      }

      ctx.restore();
    }

    /* Draw the active piece as beveled solid blocks. */
    _drawPiece(ctx, piece) {
      const S = this.S, B = C.BLOCK;
      const base = Sand.SAND_COLORS[piece.color].base;
      // Rotation "pop": briefly brighten the piece after a rotation.
      const pop = piece.rotPop || 0;
      const r = Math.min(255, base[0] + (255 - base[0]) * 0.45 * pop) | 0;
      const g = Math.min(255, base[1] + (255 - base[1]) * 0.45 * pop) | 0;
      const b = Math.min(255, base[2] + (255 - base[2]) * 0.45 * pop) | 0;

      const edge = S;
      const fill = 'rgb(' + r + ',' + g + ',' + b + ')';
      const light = 'rgba(255,255,255,0.28)';
      const dark = 'rgba(0,0,0,0.30)';
      const cells = piece.filledCells();
      for (let i = 0; i < cells.length; i++) {
        const px = Math.round((piece.renderXCell + cells[i][1] * B) * S);
        const py = Math.round((piece.renderYCell + cells[i][0] * B) * S);
        const bw = B * S;
        ctx.fillStyle = fill;
        ctx.fillRect(px, py, bw, bw);
        ctx.fillStyle = light;
        ctx.fillRect(px, py, bw, edge);
        ctx.fillRect(px, py, edge, bw);
        ctx.fillStyle = dark;
        ctx.fillRect(px, py + bw - edge, bw, edge);
        ctx.fillRect(px + bw - edge, py, edge, bw);
      }
    }

    /* Draw the ghost as a soft translucent outline. */
    _drawGhost(ctx, piece, xCell, topRow) {
      const S = this.S, B = C.BLOCK;
      const base = Sand.SAND_COLORS[piece.color].base;
      const cells = piece.filledCells();
      const bw = B * S;
      const edge = Math.max(2, (S / 1.5) | 0);
      for (let i = 0; i < cells.length; i++) {
        const px = Math.round((xCell + cells[i][1] * B) * S);
        const py = Math.round((topRow + cells[i][0] * B) * S);
        ctx.fillStyle = 'rgba(' + base[0] + ',' + base[1] + ',' + base[2] + ',0.14)';
        ctx.fillRect(px, py, bw, bw);
        ctx.fillStyle = 'rgba(' + base[0] + ',' + base[1] + ',' + base[2] + ',0.5)';
        ctx.fillRect(px, py, bw, edge);
        ctx.fillRect(px, py + bw - edge, bw, edge);
        ctx.fillRect(px, py, edge, bw);
        ctx.fillRect(px + bw - edge, py, edge, bw);
      }
    }

    /* ------------------------------------------------------------------- *
     * Static helper: draw a tetromino centred within (w, h). Used by the UI
     * for the hold slot and next queue.
     * ------------------------------------------------------------------- */
    static drawPreview(ctx, type, w, h) {
      ctx.clearRect(0, 0, w, h);
      if (!type) return;
      const def = Sand.PIECES[type];
      const m = def.matrix;
      let minR = 99, maxR = -1, minC = 99, maxC = -1;
      for (let r = 0; r < m.length; r++) {
        for (let c = 0; c < m[r].length; c++) {
          if (m[r][c]) {
            if (r < minR) minR = r; if (r > maxR) maxR = r;
            if (c < minC) minC = c; if (c > maxC) maxC = c;
          }
        }
      }
      const cols = maxC - minC + 1;
      const rows = maxR - minR + 1;
      const cell = Math.floor(Math.min(w / (cols + 0.6), h / (rows + 0.6)));
      const ox = Math.floor((w - cols * cell) / 2);
      const oy = Math.floor((h - rows * cell) / 2);
      const base = Sand.SAND_COLORS[def.color].base;
      ctx.imageSmoothingEnabled = false;
      for (let r = minR; r <= maxR; r++) {
        for (let c = minC; c <= maxC; c++) {
          if (!m[r][c]) continue;
          const px = ox + (c - minC) * cell;
          const py = oy + (r - minR) * cell;
          ctx.fillStyle = 'rgb(' + base[0] + ',' + base[1] + ',' + base[2] + ')';
          ctx.fillRect(px, py, cell, cell);
          ctx.fillStyle = 'rgba(255,255,255,0.25)';
          ctx.fillRect(px, py, cell, Math.max(1, cell / 6));
          ctx.fillStyle = 'rgba(0,0,0,0.28)';
          ctx.fillRect(px, py + cell - Math.max(1, cell / 6), cell, Math.max(1, cell / 6));
        }
      }
    }
  }

  Sand.Renderer = Renderer;
})(typeof window !== 'undefined' ? window : this);
