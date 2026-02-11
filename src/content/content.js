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
  // Global API Data Capture
  // ============================================
  // capturedResponses is at module level so it starts capturing
  // API data immediately (before START_SCAN is sent).
  // This is critical for the SPA navigation flow where
  // the fetch interceptor captures data before scanning begins.
  const capturedResponses = [];

  function onMainWorldMessage(event) {
    // Don't check event.source — MAIN world messages may have different source in ISOLATED world
    if (!event.data || event.data.type !== '__X_UNFOLLOWER_API_DATA__') return;
    const payload = event.data.payload;
    console.log('[X Unfollower] 📨 收到postMessage, payload keys:', Object.keys(payload || {}));
    // 深度结构日志，帮助调试 API 结构变化
    try {
      const dataKeys = Object.keys(payload?.data || {});
      const userKeys = Object.keys(payload?.data?.user || {});
      const resultKeys = Object.keys(payload?.data?.user?.result || {});
      console.log('[X Unfollower] 📦 结构: data->', dataKeys, '| user->', userKeys, '| result->', resultKeys);
    } catch (_) {}
    try {
      const extracted = extractUsersFromResponse(payload);
      console.log('[X Unfollower] 🟢 API收到数据, 提取了', extracted.length, '个用户');
      if (extracted.length === 0) {
        console.log('[X Unfollower] ⚠️ 提取0个用户! 原始payload:', JSON.stringify(payload).substring(0, 500));
      }
      extracted.forEach(u => {
        console.log(`[X Unfollower]   API用户: @${u.screenName} | id=${u.id} | followers=${u.followersCount}`);
      });
      capturedResponses.push(...extracted);
    } catch (e) {
      console.log('[X Unfollower] ❌ Error extracting users:', e);
    }
  }
  window.addEventListener('message', onMainWorldMessage);
  console.log('[X Unfollower] ✅ Content script loaded, message listener active');

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

      case 'NAVIGATE_TO_FOLLOWING':
        handleNavigateToFollowing(message.data).then(sendResponse).catch((err) => {
          sendResponse({ ok: false, error: err.message });
        });
        return true;
    }
  });

  // ============================================
  // SPA Navigation to /following
  // ============================================

  /**
   * Click the "Following" tab on the profile page to trigger SPA navigation.
   * This avoids a full page reload, keeping the fetch interceptor intact.
   */
  async function handleNavigateToFollowing({ username }) {
    console.log(`[X Unfollower] 🔀 SPA导航: 查找 /${username}/following 链接...`);
    // Try multiple selectors to find the "Following" link/tab
    const selectors = [
      `a[href="/${username}/following"]`,
      `a[href="/${username}/following"][role="link"]`,
      `a[href="/${username}/following"][role="tab"]`,
      'a[href$="/following"][role="link"]',
      'a[href$="/following"][role="tab"]',
    ];

    let followingLink = null;
    for (const sel of selectors) {
      followingLink = document.querySelector(sel);
      if (followingLink) {
        console.log(`[X Unfollower] ✅ 找到链接 (selector: ${sel})`);
        break;
      }
    }

    if (followingLink) {
      console.log('[X Unfollower] Clicking "Following" tab for SPA navigation');
      followingLink.click();
      return { ok: true };
    }

    // Fallback: use history.pushState + popstate for SPA navigation
    console.log('[X Unfollower] "Following" link not found, using pushState fallback');
    const targetUrl = `/${username}/following`;
    window.history.pushState({}, '', targetUrl);
    window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));

    // Double fallback: if pushState doesn't trigger React Router, use location
    await sleep(500);
    if (!window.location.pathname.includes('/following')) {
      window.location.href = `https://x.com${targetUrl}`;
    }

    return { ok: true };
  }

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

    // capturedResponses and onMainWorldMessage are at module level,
    // so API data captured during SPA navigation is already available.
    console.log(`[X Unfollower] 扫描开始, 已缓存 ${capturedResponses.length} 个API用户`);

    let previousScrollHeight = 0;
    await sleep(2000);  // 等待SPA导航数据加载完成
    processVisibleUsers(users, seenIds);

    for (let i = 0; i < 200; i++) {
      if (shouldStop) break;

      window.scrollTo(0, document.body.scrollHeight);
      await sleep(CONFIG.SCROLL_INTERVAL);

      while (capturedResponses.length > 0) {
        const user = capturedResponses.shift();
        if (user && user.id) {
          // 检查是否已有同 screenName 的不完整数据（DOM 回退）
          const existingIdx = users.findIndex(
            (u) => u.screenName === user.screenName && u.incomplete
          );
          if (existingIdx !== -1) {
            // 用 API 完整数据替换 DOM 不完整数据
            console.log(`[X Unfollower] 🔄 替换DOM数据: @${user.screenName} | followers=${user.followersCount}`);
            users[existingIdx] = user;
            seenIds.add(user.id);
          } else if (!seenIds.has(user.id) && !seenIds.has(user.screenName)) {
            console.log(`[X Unfollower] ➕ 新增API用户: @${user.screenName} | followers=${user.followersCount}`);
            seenIds.add(user.id);
            seenIds.add(user.screenName);
            users.push(user);
          } else {
            console.log(`[X Unfollower] ⏭️ 跳过API用户(已存在): @${user.screenName} | id=${user.id} | seenById=${seenIds.has(user.id)} | seenByName=${seenIds.has(user.screenName)}`);
          }
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

    // Note: message listener stays active at module level for future scans

    // 调试: 统计数据来源
    const apiUsers = users.filter(u => !u.incomplete);
    const domUsers = users.filter(u => u.incomplete);
    console.log('[X Unfollower] ====== 扫描完成统计 ======');
    console.log(`[X Unfollower] 总用户: ${users.length} | API完整: ${apiUsers.length} | DOM不完整: ${domUsers.length}`);
    if (domUsers.length > 0) {
      console.log('[X Unfollower] 缺少粉丝数据的用户:');
      domUsers.forEach(u => console.log(`[X Unfollower]   ❌ @${u.screenName} (id=${u.id})`));
    }
    console.log('[X Unfollower] ========================');

    return users;
  }

  /**
   * Extract user data from X's GraphQL API response.
   * Now includes `isBlueVerified` field.
   */
  function extractUsersFromResponse(data) {
    const users = [];

    try {
      // Try multiple paths to find instructions (X updates API structure frequently)
      const instructions =
        data?.data?.user?.result?.timeline?.timeline?.instructions ||
        data?.data?.user?.result?.timeline_v2?.timeline?.instructions ||
        data?.data?.user?.result?.timeline?.instructions ||
        data?.data?.timeline?.timeline?.instructions ||
        data?.data?.timeline_v2?.timeline?.instructions ||
        [];

      if (instructions.length === 0) {
        console.log('[X Unfollower] ⚠️ 未找到 instructions, data结构:', JSON.stringify(Object.keys(data?.data || {})));
      }

      for (const instruction of instructions) {
        const entries = instruction.entries || instruction.moduleItems || [];
        for (const entry of entries) {
          // Try multiple paths to find user result
          const result =
            entry?.content?.itemContent?.user_results?.result ||
            entry?.content?.itemContent?.user_result?.result ||
            entry?.item?.itemContent?.user_results?.result ||
            entry?.item?.itemContent?.user_result?.result;

          if (result) {
            const legacy = result.legacy || {};
            const core = result.core || {};
            const avatarObj = result.avatar || {};
            const relationship = result.relationship_perspectives || {};
            const profileBio = result.profile_bio || {};

            const followedBy = relationship.followed_by || legacy.followed_by || false;

            // Try multiple avatar paths
            const avatarUrl = (
              avatarObj.image_url ||
              legacy.profile_image_url_https ||
              core.profile_image_url_https ||
              ''
            ).replace('_normal', '_bigger');

            // Try multiple name/screenName paths
            const screenName = core.screen_name || legacy.screen_name || '';
            const name = core.name || legacy.name || '';

            const user = {
              id: result.rest_id || result.id,
              name,
              screenName,
              avatar: avatarUrl,
              followersCount: legacy.followers_count ?? legacy.normal_followers_count ?? 0,
              followingCount: legacy.friends_count ?? 0,
              isFollowingYou: followedBy,
              isBlueVerified: result.is_blue_verified || false,
              statusesCount: legacy.statuses_count ?? 0,
              status: followedBy ? 'mutual' : 'not-following-back',
              description: profileBio.description || legacy.description || '',
            };

            if (user.id && user.screenName) {
              users.push(user);
            } else {
              console.log('[X Unfollower] ⚠️ 跳过无效用户, result keys:', Object.keys(result));
            }
          }
        }
      }
    } catch (e) {
      console.error('[X Unfollower] Error extracting users from response:', e);
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
          followersCount: null,
          followingCount: null,
          statusesCount: null,
          description: '',
          incomplete: true,
        };

        console.log(`[X Unfollower] 🟡 DOM回退添加: @${screenName} (无粉丝数据)`);
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
