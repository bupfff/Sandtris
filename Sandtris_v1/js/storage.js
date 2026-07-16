/* =========================================================================
 * storage.js
 * -------------------------------------------------------------------------
 * Thin, defensive wrapper around localStorage. All persistent game data
 * (settings, statistics, high scores) flows through here so the rest of the
 * codebase never touches localStorage directly and never throws if storage
 * is unavailable (private mode, quota, etc.).
 * ========================================================================= */

(function (global) {
  'use strict';

  const Sand = (global.Sand = global.Sand || {});

  const PREFIX = 'sandtris.';
  let memoryFallback = {}; // used when localStorage is unavailable

  function available() {
    try {
      const k = PREFIX + '__test__';
      global.localStorage.setItem(k, '1');
      global.localStorage.removeItem(k);
      return true;
    } catch (e) {
      return false;
    }
  }

  const hasLS = available();

  const Storage = {
    /* Read and JSON-parse a value; returns `fallback` on any problem. */
    get(key, fallback) {
      try {
        const raw = hasLS
          ? global.localStorage.getItem(PREFIX + key)
          : memoryFallback[key];
        if (raw === null || raw === undefined) return fallback;
        return JSON.parse(raw);
      } catch (e) {
        return fallback;
      }
    },

    /* JSON-stringify and store a value. Silently no-ops on failure. */
    set(key, value) {
      try {
        const raw = JSON.stringify(value);
        if (hasLS) global.localStorage.setItem(PREFIX + key, raw);
        else memoryFallback[key] = raw;
        return true;
      } catch (e) {
        return false;
      }
    },

    remove(key) {
      try {
        if (hasLS) global.localStorage.removeItem(PREFIX + key);
        else delete memoryFallback[key];
      } catch (e) {
        /* ignore */
      }
    },

    /* Wipe all sandtris.* keys (used by "reset data"). */
    clearAll() {
      try {
        if (hasLS) {
          const toRemove = [];
          for (let i = 0; i < global.localStorage.length; i++) {
            const k = global.localStorage.key(i);
            if (k && k.indexOf(PREFIX) === 0) toRemove.push(k);
          }
          toRemove.forEach((k) => global.localStorage.removeItem(k));
        } else {
          memoryFallback = {};
        }
      } catch (e) {
        /* ignore */
      }
    },

    persistent: hasLS,
  };

  Sand.Storage = Storage;
})(typeof window !== 'undefined' ? window : this);
