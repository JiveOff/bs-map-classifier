/**
 * platform.js — runtime URL resolution for both extension and userscript contexts.
 *
 * For the hookScript (module-level, must run at document_start), content.js
 * uses the __PLATFORM__ build define to switch between src= and textContent=.
 *
 * For all other resource fetches (ONNX model, meta) which are called at
 * runtime (inside async functions), we check window.__bso_getURL_override
 * first (set by userscript_entry.js before any user code runs).
 */

export function getURL(name) {
  // Userscript entry point sets this override before content.js functions execute
  if (typeof window !== 'undefined' && typeof window.__bso_getURL_override === 'function') {
    return window.__bso_getURL_override(name);
  }
  // Extension context
  if (typeof chrome !== 'undefined' && chrome?.runtime?.getURL) {
    return chrome.runtime.getURL(name);
  }
  // Should never be reached in practice
  return name;
}
