/**
 * injected.js — runs in the PAGE context before Unity initialises.
 *
 * Wraps AudioContext so that when Unity calls BufferSourceNode.start()
 * on a buffer > 10 s (the music track), we record the zero point and
 * begin posting TIME messages to the content script via postMessage.
 *
 * Handles seek/restart: Unity creates a new node and calls start() again
 * with a new offset — we re-anchor on every such call.
 * Handles pause: AudioContext.suspend() freezes currentTime automatically.
 */
(function () {
  'use strict';

  const Orig = window.AudioContext || window.webkitAudioContext;
  if (!Orig) return;

  let musicCtx     = null;
  let musicStartAt = null;

  function patch(ctx) {
    const _cbs = ctx.createBufferSource.bind(ctx);
    ctx.createBufferSource = function () {
      const node = _cbs();
      const _start = node.start.bind(node);
      node.start = function (when = 0, offset = 0, duration) {
        if (node.buffer && node.buffer.duration > 10) {
          musicCtx     = ctx;
          musicStartAt = ctx.currentTime - offset;
          console.log('[BSOverlay] Music start detected, t=0 anchored at ctx.currentTime', musicStartAt.toFixed(3));
        }
        return duration !== undefined ? _start(when, offset, duration) : _start(when, offset);
      };
      return node;
    };
  }

  function Patched(...args) {
    const ctx = new Orig(...args);
    patch(ctx);
    return ctx;
  }
  Patched.prototype = Orig.prototype;
  window.AudioContext = window.webkitAudioContext = Patched;

  function pump() {
    if (musicCtx !== null && musicStartAt !== null) {
      document.dispatchEvent(new CustomEvent('__bso_time', {
        detail: Math.max(0, musicCtx.currentTime - musicStartAt),
      }));
    }
    requestAnimationFrame(pump);
  }
  requestAnimationFrame(pump);
})();
