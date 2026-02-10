/**
 * X Unfollower — Content Script
 * Injected into X (Twitter) pages.
 * Handles: scanning following list, unfollowing users.
 */

(() => {
  'use strict';

  // Prevent duplicate injection when programmatically re-injected
  if (window.__xUnfollowerLoaded) return;
  window.__xUnfollowerLoaded = true;

  const CONFIG = {
    SCROLL_INTERVAL: 1500,
    MAX_SCROLL_RETRIES: 5,
  };

  let isScanning = false;
  let shouldStop = false;

  // ============================================
  // Message Handling
  // ============================================

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.type) {
      case 'PING':
        sendResponse({ ok: true });
        return;

      case 'START_SCAN':
        handleStartScan(sendResponse);
        return true;

      case 'STOP_SCAN':
        shouldStop = true;
        sendResponse({ ok: true });
        return;

      case 'UNFOLLOW_USER':
        handleUnfollowUser(message.data).then(sendResponse).catch((err) => {
          sendResponse({ success: false, error: err.message });
        });
        return true;
    }
  });

  // ============================================
  // Scan
  // ============================================

  async function handleStartScan(sendResponse) {
    if (isScanning) {
      sendResponse({ ok: false, error: 'Already scanning' });
      return;
    }

    isScanning = true;
    shouldStop = false;
    sendResponse({ ok: true });

    try {
      // Navigation and fetch interceptor injection are handled by the background.
      // We just need to scan the current page.
      const users = await scanByScrolling();

      chrome.runtime.sendMessage({
        type: 'SCAN_COMPLETE',
        data: { users },
      });
    } catch (err) {
      chrome.runtime.sendMessage({
        type: 'SCAN_ERROR',
        data: { error: err.message },
      });
    } finally {
      isScanning = false;
    }
  }

  // ============================================
  // Username Detection
  // ============================================

  function getCurrentUsername() {
    const navLinks = document.querySelectorAll('a[role="link"][href^="/"]');
    for (const link of navLinks) {
      const href = link.getAttribute('href');
      if (href && href.match(/^\/[a-zA-Z0-9_]+$/) && link.querySelector('img[src*="profile_images"]')) {
        return href.slice(1);
      }
    }

    const profileLink = document.querySelector('a[data-testid="AppTabBar_Profile_Link"]');
    if (profileLink) {
      const href = profileLink.getAttribute('href');
      if (href) return href.slice(1);
    }

    const match = window.location.pathname.match(/^\/([a-zA-Z0-9_]+)\/following/);
    if (match) return match[1];

    return null;
  }

  // ============================================
  // Scan: Fetch Intercept + Scroll
  // ============================================

  async function scanByScrolling() {
    const users = [];
    const seenIds = new Set();
    let noNewDataCount = 0;
    const capturedResponses = [];

    // Listen for API data from the MAIN world fetch interceptor
    // (injected by the background service worker via chrome.scripting.executeScript)
    function onMainWorldMessage(event) {
      if (event.source !== window || event.data?.type !== '__X_UNFOLLOWER_API_DATA__') return;
      try {
        const extracted = extractUsersFromResponse(event.data.payload);
        console.log('[X Unfollower] Received API data, extracted', extracted.length, 'users');
        capturedResponses.push(...extracted);
      } catch (e) {
        console.log('[X Unfollower] Error extracting users:', e);
      }
    }
    window.addEventListener('message', onMainWorldMessage);

    let previousScrollHeight = 0;
    await sleep(2000);
    processVisibleUsers(users, seenIds);

    for (let i = 0; i < 200; i++) {
      if (shouldStop) break;

      window.scrollTo(0, document.body.scrollHeight);
      await sleep(CONFIG.SCROLL_INTERVAL);

      while (capturedResponses.length > 0) {
        const user = capturedResponses.shift();
        if (user && user.id && !seenIds.has(user.id)) {
          seenIds.add(user.id);
          users.push(user);
        }
      }

      processVisibleUsers(users, seenIds);

      chrome.runtime.sendMessage({
        type: 'SCAN_PROGRESS',
        data: {
          loaded: users.length,
          total: null,
          percentage: Math.min(95, users.length > 0 ? Math.round((i / 200) * 100) : 0),
        },
      });

      const currentScrollHeight = document.body.scrollHeight;
      if (currentScrollHeight === previousScrollHeight) {
        noNewDataCount++;
        if (noNewDataCount >= CONFIG.MAX_SCROLL_RETRIES) break;
      } else {
        noNewDataCount = 0;
      }
      previousScrollHeight = currentScrollHeight;
    }

    // Clean up
    window.removeEventListener('message', onMainWorldMessage);

    return users;
  }

  /**
   * Extract user data from X's GraphQL API response.
   * Now includes `isBlueVerified` field.
   */
  function extractUsersFromResponse(data) {
    const users = [];

    try {
      const instructions =
        data?.data?.user?.result?.timeline?.timeline?.instructions ||
        data?.data?.user?.result?.timeline_v2?.timeline?.instructions ||
        [];

      for (const instruction of instructions) {
        const entries = instruction.entries || [];
        for (const entry of entries) {
          const result =
            entry?.content?.itemContent?.user_results?.result ||
            entry?.content?.itemContent?.user_result?.result;

          if (result) {
            const legacy = result.legacy || {};
            const core = result.core || {};
            const avatarObj = result.avatar || {};
            const relationship = result.relationship_perspectives || {};
            const profileBio = result.profile_bio || {};

            const followedBy = relationship.followed_by || false;
            const avatarUrl = (avatarObj.image_url || '').replace('_normal', '_bigger');

            const user = {
              id: result.rest_id || result.id,
              name: core.name || '',
              screenName: core.screen_name || '',
              avatar: avatarUrl,
              followersCount: legacy.followers_count || 0,
              followingCount: legacy.friends_count || 0,
              isFollowingYou: followedBy,
              isBlueVerified: result.is_blue_verified || false,
              statusesCount: legacy.statuses_count || 0,
              status: followedBy ? 'mutual' : 'not-following-back',
              description: profileBio.description || legacy.description || '',
            };

            if (user.id) users.push(user);
          }
        }
      }
    } catch (e) {
      console.error('Error extracting users from response:', e);
    }

    return users;
  }

  /**
   * Fallback: Parse visible user cards from DOM.
   * Detects Blue V from the verified badge SVG.
   */
  function processVisibleUsers(users, seenIds) {
    const userCells = document.querySelectorAll('[data-testid="UserCell"]');

    userCells.forEach((cell) => {
      try {
        const linkEl = cell.querySelector('a[role="link"]');
        if (!linkEl) return;

        const href = linkEl.getAttribute('href') || '';
        const screenName = href.replace('/', '');
        if (!screenName || seenIds.has(screenName)) return;

        const nameEl = cell.querySelector('a[role="link"] > div > div > span');
        const name = nameEl?.textContent || screenName;

        const avatarEl = cell.querySelector('img[src*="profile_images"]');
        const avatar = avatarEl?.src?.replace('_normal', '_bigger') || '';

        const followsYouEl = cell.querySelector('[data-testid="userFollowIndicator"]');
        const isFollowingYou = !!followsYouEl;

        // Detect Blue Verified badge (SVG with specific path or aria-label)
        const verifiedBadge = cell.querySelector('svg[data-testid="icon-verified"]') ||
                              cell.querySelector('[aria-label="Verified"]') ||
                              cell.querySelector('[aria-label="已认证"]');
        const isBlueVerified = !!verifiedBadge;

        const user = {
          id: screenName,
          name,
          screenName,
          avatar,
          isFollowingYou,
          isBlueVerified,
          status: isFollowingYou ? 'mutual' : 'not-following-back',
        };

        seenIds.add(screenName);
        users.push(user);
      } catch (e) { /* ignore */ }
    });
  }

  // ============================================
  // Unfollow
  // ============================================

  async function handleUnfollowUser({ userId, screenName }) {
    // Try API method first (most reliable)
    try {
      const result = await unfollowViaAPI(userId, screenName);
      if (result) return { success: true };
    } catch (e) {
      console.log('API unfollow failed, trying DOM method:', e);
    }

    // Try DOM method: first check current page, then navigate to profile
    try {
      await unfollowViaDOM(screenName);
      return { success: true };
    } catch (e) {
      console.log('DOM unfollow on current page failed, trying profile page:', e);
    }

    // Last resort: navigate to user profile and click unfollow there
    try {
      await unfollowViaProfile(screenName);
      return { success: true };
    } catch (e) {
      throw new Error(`无法取消关注 @${screenName}: ${e.message}`);
    }
  }

  async function unfollowViaAPI(userId, screenName) {
    const ct0 = getCookie('ct0');
    if (!ct0) throw new Error('Missing csrf token');

    const bearerToken = 'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';

    // Detect if userId is numeric or a screen name
    const isNumericId = /^\d+$/.test(userId);
    const body = isNumericId
      ? `user_id=${userId}`
      : `screen_name=${screenName || userId}`;

    const response = await fetch('https://x.com/i/api/1.1/friendships/destroy.json', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Bearer ${bearerToken}`,
        'X-Csrf-Token': ct0,
        'X-Twitter-Auth-Type': 'OAuth2Session',
        'X-Twitter-Active-User': 'yes',
      },
      credentials: 'include',
      body,
    });

    if (!response.ok) throw new Error(`API error: ${response.status}`);
    return true;
  }

  /**
   * Try to find and click the unfollow button in the currently visible user cells.
   */
  async function unfollowViaDOM(screenName) {
    const userCells = document.querySelectorAll('[data-testid="UserCell"]');

    for (const cell of userCells) {
      const linkEl = cell.querySelector(`a[href="/${screenName}"]`);
      if (!linkEl) continue;

      if (await clickUnfollowButton(cell)) return;
    }

    throw new Error('User cell not found on current page');
  }

  /**
   * Navigate to user's profile page and click the "Following" button to unfollow.
   */
  async function unfollowViaProfile(screenName) {
    const previousUrl = window.location.href;

    // Navigate to user profile
    window.location.href = `https://x.com/${screenName}`;
    await sleep(3000);

    // Look for the "Following" button on the profile page
    const maxRetries = 5;
    for (let i = 0; i < maxRetries; i++) {
      const followingBtn =
        document.querySelector(`[data-testid="placementTracking"] [data-testid="${screenName}-unfollow"]`) ||
        document.querySelector('[data-testid="placementTracking"]') ||
        document.querySelector('button[aria-label*="Following"]') ||
        document.querySelector('button[aria-label*="关注中"]') ||
        document.querySelector('button[aria-label*="正在关注"]');

      if (followingBtn) {
        followingBtn.click();
        await sleep(800);

        // Click confirm button in the dialog
        const confirmBtn = document.querySelector('[data-testid="confirmationSheetConfirm"]');
        if (confirmBtn) {
          confirmBtn.click();
          await sleep(500);

          // Navigate back
          try { window.location.href = previousUrl; } catch (_) {}
          return;
        }
      }

      await sleep(1000);
    }

    // Navigate back even if failed
    try { window.location.href = previousUrl; } catch (_) {}
    throw new Error('Could not find unfollow button on profile page');
  }

  /**
   * Click the unfollow button inside a user cell element and confirm.
   */
  async function clickUnfollowButton(cell) {
    const followingBtn = cell.querySelector('[data-testid$="-unfollow"]') ||
                         cell.querySelector('button[aria-label*="Following"]') ||
                         cell.querySelector('button[aria-label*="关注中"]') ||
                         cell.querySelector('button[aria-label*="正在跟隨"]') ||
                         cell.querySelector('button[data-testid="placementTracking"] div[dir="ltr"]');

    if (followingBtn) {
      followingBtn.click();
      await sleep(500);

      const confirmBtn = document.querySelector('[data-testid="confirmationSheetConfirm"]');
      if (confirmBtn) {
        confirmBtn.click();
        await sleep(300);
        return true;
      }
    }

    return false;
  }

  // ============================================
  // Helpers
  // ============================================

  function getCookie(name) {
    const match = document.cookie.match(new RegExp(`(^| )${name}=([^;]+)`));
    return match ? match[2] : null;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
})();
