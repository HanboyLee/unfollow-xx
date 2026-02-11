/**
 * X Unfollower — Fetch Interceptor (MAIN World)
 * Declared in manifest.json with world:"MAIN" and run_at:"document_start"
 * to capture ALL Following API responses before X even makes the requests.
 *
 * Communication: MAIN world → ISOLATED world via window.postMessage
 */
(() => {
  'use strict';
  if (window.__xUnfollowerFetchHooked) return;
  window.__xUnfollowerFetchHooked = true;

  console.log('[X Unfollower] 🔧 Fetch interceptor MAIN world injected at', new Date().toISOString());

  const _origFetch = window.fetch;

  // Use regular function (not async) to preserve fetch prototype behavior
  window.fetch = function () {
    const args = arguments;
    return _origFetch.apply(this, args).then(function (resp) {
      try {
        const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || '';
        // Match Following-related GraphQL requests (case-insensitive check)
        if (url.indexOf('/Following') !== -1 || url.indexOf('/following') !== -1) {
          console.log('[X Unfollower] 🎯 INTERCEPTED Following API:', url.substring(0, 120));
          resp.clone().json().then(function (data) {
            console.log('[X Unfollower] 📤 Posting API data to content script, keys:', Object.keys(data || {}));
            window.postMessage({ type: '__X_UNFOLLOWER_API_DATA__', payload: data }, '*');
          }).catch(function (e) {
            console.log('[X Unfollower] ⚠️ Failed to parse response JSON:', e.message);
          });
        }
      } catch (e) {
        console.log('[X Unfollower] ⚠️ Fetch intercept error:', e.message);
      }
      return resp;
    });
  };

  // Preserve toString to avoid detection
  window.fetch.toString = function () { return _origFetch.toString(); };

  // Also intercept XMLHttpRequest
  var _origXHROpen = XMLHttpRequest.prototype.open;
  var _origXHRSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__xUrl = url;
    return _origXHROpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function () {
    if (this.__xUrl && (this.__xUrl.indexOf('/Following') !== -1 || this.__xUrl.indexOf('/following') !== -1)) {
      console.log('[X Unfollower] 🎯 INTERCEPTED XHR Following API:', this.__xUrl.substring(0, 120));
      this.addEventListener('load', function () {
        try {
          var data = JSON.parse(this.responseText);
          console.log('[X Unfollower] 📤 Posting XHR API data, keys:', Object.keys(data || {}));
          window.postMessage({ type: '__X_UNFOLLOWER_API_DATA__', payload: data }, '*');
        } catch (e) {
          console.log('[X Unfollower] ⚠️ XHR parse error:', e.message);
        }
      });
    }
    return _origXHRSend.apply(this, arguments);
  };
})();
