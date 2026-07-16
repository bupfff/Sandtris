/* =========================================================================
 * audio.js
 * -------------------------------------------------------------------------
 * All sound is synthesised at runtime with the Web Audio API, so there are
 * no binary asset dependencies. Provides short retro SFX blips and a simple
 * looping chiptune. Respects the Music / SFX volume settings.
 *
 * The AudioContext must be created/resumed after a user gesture (browser
 * autoplay policy), so `unlock()` is called on the first input.
 * ========================================================================= */

(function (global) {
  'use strict';

  const Sand = (global.Sand = global.Sand || {});
  const Settings = Sand.Settings;

  const AudioSys = {
    ctx: null,
    masterSfx: null,
    masterMusic: null,
    musicTimer: null,
    musicStep: 0,
    started: false,

    init() {
      const AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) return;
      try {
        this.ctx = new AC();
      } catch (e) {
        this.ctx = null;
        return;
      }
      this.masterSfx = this.ctx.createGain();
      this.masterMusic = this.ctx.createGain();
      this.masterSfx.connect(this.ctx.destination);
      this.masterMusic.connect(this.ctx.destination);
      this.applyVolumes();
    },

    applyVolumes() {
      if (!this.ctx) return;
      this.masterSfx.gain.value = Settings.get('sfxVolume');
      this.masterMusic.gain.value = Settings.get('musicVolume') * 0.35;
    },

    /* Resume the context (called on first user gesture). */
    unlock() {
      if (!this.ctx) this.init();
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume();
      }
    },

    /* Core one-shot tone generator. */
    tone(freq, dur, type, gain, when, target) {
      if (!this.ctx) return;
      const t0 = (when || this.ctx.currentTime);
      const osc = this.ctx.createOscillator();
      const env = this.ctx.createGain();
      osc.type = type || 'square';
      osc.frequency.setValueAtTime(freq, t0);
      env.gain.setValueAtTime(0.0001, t0);
      env.gain.exponentialRampToValueAtTime(gain || 0.3, t0 + 0.008);
      env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(env);
      env.connect(target || this.masterSfx);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    },

    /* Pitch sweep (used for whooshy effects like hard drop). */
    sweep(f0, f1, dur, type, gain) {
      if (!this.ctx) return;
      const t0 = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const env = this.ctx.createGain();
      osc.type = type || 'sawtooth';
      osc.frequency.setValueAtTime(f0, t0);
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
      env.gain.setValueAtTime(0.0001, t0);
      env.gain.exponentialRampToValueAtTime(gain || 0.25, t0 + 0.01);
      env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(env);
      env.connect(this.masterSfx);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    },

    /* Short filtered noise burst (landing / sand). */
    noise(dur, gain) {
      if (!this.ctx) return;
      const t0 = this.ctx.currentTime;
      const frames = Math.floor(this.ctx.sampleRate * dur);
      const buffer = this.ctx.createBuffer(1, frames, this.ctx.sampleRate);
      const chan = buffer.getChannelData(0);
      for (let i = 0; i < frames; i++) {
        chan[i] = (Math.random() * 2 - 1) * (1 - i / frames);
      }
      const src = this.ctx.createBufferSource();
      src.buffer = buffer;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 1400;
      const env = this.ctx.createGain();
      env.gain.value = gain || 0.2;
      src.connect(filter);
      filter.connect(env);
      env.connect(this.masterSfx);
      src.start(t0);
    },

    /* ---- Named SFX ---- */
    play(name) {
      if (!this.ctx) return;
      switch (name) {
        case 'move':      this.tone(220, 0.05, 'square', 0.12); break;
        case 'rotate':    this.tone(330, 0.06, 'square', 0.16); break;
        case 'softdrop':  this.tone(160, 0.03, 'square', 0.08); break;
        case 'harddrop':  this.sweep(600, 90, 0.14, 'sawtooth', 0.22);
                          this.noise(0.09, 0.15); break;
        case 'land':      this.noise(0.12, 0.22); break;
        case 'hold':      this.tone(440, 0.08, 'triangle', 0.18); break;
        case 'clear':     this.arpeggio([523, 659, 784, 1046], 0.07); break;
        case 'combo':     this.arpeggio([659, 880, 1174], 0.06, 0.24); break;
        case 'levelup':   this.arpeggio([392, 523, 659, 784, 1046], 0.08); break;
        case 'gameover':  this.arpeggio([440, 349, 294, 220, 147], 0.14, 0.25, 'sawtooth'); break;
        case 'hover':     this.tone(500, 0.03, 'square', 0.06); break;
        case 'click':     this.tone(700, 0.05, 'square', 0.14); break;
        case 'back':      this.tone(300, 0.06, 'square', 0.12); break;
        default: break;
      }
    },

    arpeggio(freqs, step, gain, type) {
      if (!this.ctx) return;
      const now = this.ctx.currentTime;
      freqs.forEach((f, i) => {
        this.tone(f, step * 1.6, type || 'square', gain || 0.2, now + i * step);
      });
    },

    /* ---- Background music: a simple looping bass + arp sequence ---- */
    MUSIC_BASS: [110, 110, 146, 146, 98, 98, 130, 130],
    MUSIC_ARP: [
      440, 523, 659, 523, 587, 698, 587, 494,
      440, 523, 659, 784, 698, 587, 523, 494,
    ],

    startMusic() {
      if (!this.ctx || this.started) return;
      this.started = true;
      this.musicStep = 0;
      const stepDur = 0.19;
      const schedule = () => {
        if (!this.started) return;
        const s = this.musicStep;
        const now = this.ctx.currentTime;
        // Bass every other step.
        if (s % 2 === 0) {
          this.tone(
            this.MUSIC_BASS[(s / 2) % this.MUSIC_BASS.length] / 2,
            stepDur * 1.8, 'triangle', 0.5, now, this.masterMusic
          );
        }
        // Arp lead.
        this.tone(
          this.MUSIC_ARP[s % this.MUSIC_ARP.length],
          stepDur * 0.9, 'square', 0.16, now, this.masterMusic
        );
        this.musicStep = (s + 1) % 64;
      };
      schedule();
      this.musicTimer = global.setInterval(schedule, stepDur * 1000);
    },

    stopMusic() {
      this.started = false;
      if (this.musicTimer) {
        global.clearInterval(this.musicTimer);
        this.musicTimer = null;
      }
    },
  };

  Sand.Audio = AudioSys;
})(typeof window !== 'undefined' ? window : this);
