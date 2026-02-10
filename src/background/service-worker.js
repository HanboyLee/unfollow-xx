/**
 * X Unfollower — Background Service Worker
 * Coordinates between Side Panel and Content Script.
 * Handles single unfollow requests with daily limit tracking.
 */

import { Storage, DAILY_UNFOLLOW_LIMIT } from '../utils/storage.js';

// ============================================
// Side Panel Setup
// ============================================

// Open side panel when extension icon is clicked
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

// ============================================
// Message Handling
// ============================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    // ---- From Content Script ----
    case 'SCAN_PROGRESS':
    case 'SCAN_COMPLETE':
    case 'SCAN_ERROR':
      broadcastToSidePanel(message);
      break;

    // ---- From Side Panel ----
    case 'UNFOLLOW_ONE':
      handleSingleUnfollow(message.data, sendResponse);
      return true; // async response

    case 'GET_DAILY_COUNT':
      Storage.getDailyUnfollowCount().then((count) => {
        sendResponse({ count, limit: DAILY_UNFOLLOW_LIMIT });
      });
      return true;

    case 'ENSURE_CONTENT_SCRIPT':
      ensureContentScript(message.data.tabId)
        .then(() => sendResponse({ ok: true }))
        .catch((err) => sendResponse({ ok: false, error: err.message }));
      return true;

    case 'START_SCAN_TAB':
      handleStartScanTab(message.data.tabId, sendResponse);
      return true;

    case 'STOP_SCAN_TAB':
      sendMessageToTab(message.data.tabId, { type: 'STOP_SCAN' })
        .then((resp) => sendResponse(resp))
        .catch((err) => sendResponse({ ok: false, error: err.message }));
      return true;
  }

  sendResponse({ ok: true });
  return true;
});

/**
 * Full scan orchestration:
 * 1. Navigate to /following if needed (via chrome.tabs.update)
 * 2. Wait for page to finish loading
 * 3. Inject content script
 * 4. Inject fetch interceptor into MAIN world
 * 5. Send START_SCAN to content script
 */
async function handleStartScanTab(tabId, sendResponse) {
  try {
    const tab = await chrome.tabs.get(tabId);
    const url = tab.url || '';

    // Navigate to /following if not already there
    if (!url.includes('/following')) {
      // Extract username from the current X URL
      const match = url.match(/x\.com\/([a-zA-Z0-9_]+)/);
      if (!match) {
        sendResponse({ ok: false, error: '请先打开 X 的个人页面' });
        return;
      }
      const username = match[1];
      await chrome.tabs.update(tabId, { url: `https://x.com/${username}/following` });
      // Wait for page load to complete
      await waitForTabLoad(tabId);
      await new Promise(r => setTimeout(r, 1500)); // extra settle time
    }

    // Inject content script (if not already loaded)
    await ensureContentScript(tabId);

    // Inject fetch interceptor into MAIN world (bypasses CSP)
    await injectFetchInterceptor(tabId);

    // Tell content script to start scanning (no navigation needed)
    const resp = await sendMessageToTab(tabId, { type: 'START_SCAN' });
    sendResponse(resp);
  } catch (err) {
    sendResponse({ ok: false, error: err.message });
  }
}

// ============================================
// Single Unfollow with Daily Limit
// ============================================

async function handleSingleUnfollow({ user, tabId }, sendResponse) {
  try {
    // Check daily limit
    const isLimited = await Storage.isDailyLimitReached();
    if (isLimited) {
      sendResponse({
        success: false,
        error: `今日已达上限 ${DAILY_UNFOLLOW_LIMIT} 次，请明天再试`,
        limitReached: true,
      });
      return;
    }

    // Send unfollow command to content script
    const result = await sendToTab(tabId, {
      type: 'UNFOLLOW_USER',
      data: { userId: user.id, screenName: user.screenName },
    });

    if (result && result.success) {
      // Increment counter and record history
      const newCount = await Storage.incrementDailyUnfollow();

      await Storage.addHistory({
        userId: user.id,
        screenName: user.screenName,
        name: user.name,
        avatar: user.avatar,
      });

      sendResponse({
        success: true,
        dailyCount: newCount,
        limit: DAILY_UNFOLLOW_LIMIT,
        limitReached: newCount >= DAILY_UNFOLLOW_LIMIT,
      });
    } else {
      sendResponse({
        success: false,
        error: result?.error || '取关失败',
      });
    }
  } catch (err) {
    sendResponse({
      success: false,
      error: err.message || '取关失败',
    });
  }
}

// ============================================
// Fetch Interceptor (MAIN world)
// ============================================

/**
 * Inject a fetch interceptor into the page's MAIN world.
 * Uses chrome.scripting.executeScript with world: 'MAIN' to bypass CSP.
 * Intercepted X API responses are relayed to the content script via postMessage.
 */
async function injectFetchInterceptor(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: () => {
      if (window.__xUnfollowerFetchHooked) return;
      window.__xUnfollowerFetchHooked = true;
      console.log('[X Unfollower] Fetch interceptor injected into MAIN world');

      // Intercept fetch
      const _origFetch = window.fetch;
      window.fetch = async function(...args) {
        const resp = await _origFetch.apply(this, args);
        try {
          const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');
          if (url.includes('/Following') || url.includes('/graphql/')) {
            if (url.includes('Following')) {
              console.log('[X Unfollower] Intercepted fetch:', url.substring(0, 100));
              resp.clone().json().then(function(data) {
                console.log('[X Unfollower] Sending API data via postMessage');
                window.postMessage({ type: '__X_UNFOLLOWER_API_DATA__', payload: data }, '*');
              }).catch(function(e) {
                console.log('[X Unfollower] Failed to parse response:', e);
              });
            }
          }
        } catch(e) {
          console.log('[X Unfollower] Fetch intercept error:', e);
        }
        return resp;
      };

      // Also intercept XMLHttpRequest in case X uses it
      const _origXHROpen = XMLHttpRequest.prototype.open;
      const _origXHRSend = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.open = function(method, url, ...rest) {
        this.__xUnfollowerUrl = url;
        return _origXHROpen.call(this, method, url, ...rest);
      };
      XMLHttpRequest.prototype.send = function(...args) {
        if (this.__xUnfollowerUrl && this.__xUnfollowerUrl.includes('Following')) {
          console.log('[X Unfollower] Intercepted XHR:', this.__xUnfollowerUrl.substring(0, 100));
          this.addEventListener('load', function() {
            try {
              const data = JSON.parse(this.responseText);
              console.log('[X Unfollower] Sending XHR data via postMessage');
              window.postMessage({ type: '__X_UNFOLLOWER_API_DATA__', payload: data }, '*');
            } catch(e) {}
          });
        }
        return _origXHRSend.apply(this, args);
      };
    },
  });
}

// ============================================
// Helpers
// ============================================

/**
 * Wait for a tab to finish loading after navigation.
 */
function waitForTabLoad(tabId) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve(); // resolve anyway after timeout
    }, 15000);

    function listener(updatedTabId, changeInfo) {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

function broadcastToSidePanel(message) {
  chrome.runtime.sendMessage(message).catch(() => {});
}

/**
 * Ensure the content script is loaded in the tab.
 * If not, inject it programmatically (handles extension reload without page refresh).
 */
async function ensureContentScript(tabId) {
  try {
    const response = await sendMessageToTab(tabId, { type: 'PING' });
    if (response && response.ok) return;
  } catch (e) {
    // Content script not loaded, inject it
  }

  const manifest = chrome.runtime.getManifest();
  const contentScriptFile = manifest.content_scripts?.[0]?.js?.[0];
  if (!contentScriptFile) throw new Error('Content script not found in manifest');

  await chrome.scripting.executeScript({
    target: { tabId },
    files: [contentScriptFile],
  });

  // Wait for script to initialize
  await new Promise((r) => setTimeout(r, 500));
}

/**
 * Send message to tab with auto content script injection.
 */
async function sendToTab(tabId, message) {
  await ensureContentScript(tabId);
  return sendMessageToTab(tabId, message);
}

/**
 * Low-level tab message sender (no injection logic).
 */
function sendMessageToTab(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response);
      }
    });
  });
}
