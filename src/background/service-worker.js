/**
 * X Unfollower — Background Service Worker
 * Coordinates between Side Panel and Content Script.
 * Handles single unfollow requests with hourly limit tracking.
 */

import { Storage, HOURLY_UNFOLLOW_LIMIT, HOUR_IN_MS } from '../utils/storage.js';

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

    case 'GET_HOURLY_COUNT':
      Storage.getHourlyUnfollowCount().then(({ count, resetIn }) => {
        sendResponse({ count, limit: HOURLY_UNFOLLOW_LIMIT, resetIn });
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
 * 1. Navigate to the user's PROFILE page (not /following)
 * 2. Inject content script & fetch interceptor on the profile page
 * 3. Tell content script to click the "Following" tab (SPA navigation)
 *    → This triggers a new GraphQL request that our interceptor captures
 * 4. Start scanning
 *
 * This order ensures the fetch interceptor is in place BEFORE
 * X makes the GraphQL request for the following list.
 */
async function handleStartScanTab(tabId, sendResponse) {
  try {
    const tab = await chrome.tabs.get(tabId);
    const url = tab.url || '';

    // Extract username from the current X URL
    const match = url.match(/x\.com\/([a-zA-Z0-9_]+)/);
    if (!match) {
      sendResponse({ ok: false, error: '请先打开 X 的个人页面' });
      return;
    }
    const username = match[1];

    // Step 1: Navigate to PROFILE page (not /following) if not already there
    const profileUrl = `https://x.com/${username}`;
    if (url.includes('/following')) {
      // Already on /following — go back to profile so we can re-enter via SPA navigation
      await chrome.tabs.update(tabId, { url: profileUrl });
      await waitForTabLoad(tabId);
      await new Promise(r => setTimeout(r, 2000));
    } else if (!url.startsWith(profileUrl) || url.includes('/followers') || url.includes('/verified_followers')) {
      // On a different page — navigate to profile
      await chrome.tabs.update(tabId, { url: profileUrl });
      await waitForTabLoad(tabId);
      await new Promise(r => setTimeout(r, 2000));
    }

    // Step 2: Inject content script + fetch interceptor on the PROFILE page
    await ensureContentScript(tabId);
    await injectFetchInterceptor(tabId);

    // Step 3: Tell content script to click "Following" tab for SPA navigation
    // This triggers a new fetch request that our interceptor will capture
    const navResult = await sendMessageToTab(tabId, {
      type: 'NAVIGATE_TO_FOLLOWING',
      data: { username },
    });

    if (navResult && !navResult.ok) {
      sendResponse({ ok: false, error: navResult.error || 'SPA导航失败' });
      return;
    }

    // Step 4: Wait for SPA navigation to complete and data to start loading
    await new Promise(r => setTimeout(r, 2000));

    // Step 5: Start scanning
    const resp = await sendMessageToTab(tabId, { type: 'START_SCAN' });
    sendResponse(resp);
  } catch (err) {
    sendResponse({ ok: false, error: err.message });
  }
}

// ============================================
// Single Unfollow with Hourly Limit
// ============================================

async function handleSingleUnfollow({ user, tabId }, sendResponse) {
  try {
    // Check hourly limit
    const { reached, resetIn } = await Storage.isHourlyLimitReached();
    if (reached) {
      const minutes = Math.ceil(resetIn / 60000);
      sendResponse({
        success: false,
        error: `已达每小时上限 ${HOURLY_UNFOLLOW_LIMIT} 次，请等待 ${minutes} 分钟`,
        limitReached: true,
        resetIn,
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
      const { count, resetIn: newResetIn, limitReached } = await Storage.incrementHourlyUnfollow();

      await Storage.addHistory({
        userId: user.id,
        screenName: user.screenName,
        name: user.name,
        avatar: user.avatar,
      });

      sendResponse({
        success: true,
        hourlyCount: count,
        limit: HOURLY_UNFOLLOW_LIMIT,
        limitReached,
        resetIn: newResetIn,
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
      console.log('[X Unfollower] 🔧 Fetch interceptor injected (fallback from service-worker)');

      const _origFetch = window.fetch;
      window.fetch = function() {
        const args = arguments;
        return _origFetch.apply(this, args).then(function(resp) {
          try {
            const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || '';
            if (url.indexOf('/Following') !== -1 || url.indexOf('/following') !== -1) {
              console.log('[X Unfollower] 🎯 INTERCEPTED Following API (fallback):', url.substring(0, 120));
              resp.clone().json().then(function(data) {
                window.postMessage({ type: '__X_UNFOLLOWER_API_DATA__', payload: data }, '*');
              }).catch(function() {});
            }
          } catch(e) {}
          return resp;
        });
      };
      window.fetch.toString = function() { return _origFetch.toString(); };
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
