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
      ensureContentScript(message.data.tabId)
        .then(() => sendMessageToTab(message.data.tabId, { type: 'START_SCAN' }))
        .then((resp) => sendResponse(resp))
        .catch((err) => sendResponse({ ok: false, error: err.message }));
      return true;
  }

  sendResponse({ ok: true });
  return true;
});

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
// Helpers
// ============================================

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
