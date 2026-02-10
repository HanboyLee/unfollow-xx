/**
 * X Unfollower — Side Panel Entry Point
 * Handles: search, filters, single unfollow with daily limit.
 */

import './sidepanel.css';
import { showToast, escapeHtml, formatNumber, getBadgeClass, getBadgeText, blueCheckSvg, debounce } from './helpers.js';

const DAILY_LIMIT = 50;

// ============================================
// State
// ============================================

const state = {
  users: [],
  filteredUsers: [],
  whitelist: new Set(),
  currentFilter: 'all',
  searchQuery: '',
  isScanning: false,
  dailyCount: 0,
  limitReached: false,
  unfollowedIds: new Set(),
  pendingUnfollow: null, // user object for confirm modal
};

// ============================================
// DOM
// ============================================

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const DOM = {
  quotaCount: $('#quota-count'),
  quotaFill: $('#quota-fill'),

  statFollowing: $('#stat-following'),
  statNotFollowingBack: $('#stat-not-following-back'),
  statBlueVerified: $('#stat-blue-verified'),
  statWhitelisted: $('#stat-whitelisted'),

  btnScan: $('#btn-scan'),
  scanProgressContainer: $('#scan-progress-container'),
  scanProgressFill: $('#scan-progress-fill'),
  scanProgressText: $('#scan-progress-text'),

  searchSection: $('#search-section'),
  searchInput: $('#search-input'),

  filterSection: $('#filter-section'),
  filterTabs: $$('.filter-tab'),

  userListSection: $('#user-list-section'),
  userList: $('#user-list'),
  emptyState: $('#empty-state'),

  modalOverlay: $('#modal-overlay'),
  modalUser: $('#modal-user'),
  modalCancel: $('#modal-cancel'),
  modalConfirm: $('#modal-confirm'),

  toastContainer: $('#toast-container'),
};

// ============================================
// Init
// ============================================

async function init() {
  await loadWhitelist();
  await loadDailyCount();
  await loadUnfollowedIds();
  bindEvents();

  const cached = await getCachedUsers();
  if (cached && cached.length > 0) {
    state.users = cached;
    onUsersLoaded();
  }
}

function bindEvents() {
  DOM.btnScan.addEventListener('click', startScan);

  // Search
  DOM.searchInput.addEventListener('input', debounce(() => {
    state.searchQuery = DOM.searchInput.value.trim().toLowerCase();
    applyFilter();
  }, 300));

  // Filter tabs
  DOM.filterTabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      DOM.filterTabs.forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      state.currentFilter = tab.dataset.filter;
      applyFilter();
    });
  });

  // Modal
  DOM.modalCancel.addEventListener('click', closeModal);
  DOM.modalOverlay.addEventListener('click', (e) => {
    if (e.target === DOM.modalOverlay) closeModal();
  });
  DOM.modalConfirm.addEventListener('click', confirmUnfollow);

  // Listen for background messages
  chrome.runtime.onMessage.addListener(handleBackgroundMessage);
}

// ============================================
// Daily Quota
// ============================================

async function loadDailyCount() {
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'GET_DAILY_COUNT' });
    if (resp) {
      state.dailyCount = resp.count || 0;
      state.limitReached = state.dailyCount >= DAILY_LIMIT;
      updateQuotaUI();
    }
  } catch (e) { /* ignore */ }
}

function updateQuotaUI() {
  const count = state.dailyCount;
  const pct = Math.min((count / DAILY_LIMIT) * 100, 100);

  DOM.quotaCount.textContent = `${count} / ${DAILY_LIMIT}`;
  DOM.quotaFill.style.width = pct + '%';

  // Color states
  DOM.quotaCount.className = 'quota-count';
  DOM.quotaFill.className = 'progress-fill quota-fill';

  if (count >= DAILY_LIMIT) {
    DOM.quotaCount.classList.add('limit-reached');
    DOM.quotaFill.classList.add('danger');
  } else if (count >= DAILY_LIMIT * 0.8) {
    DOM.quotaCount.classList.add('limit-warning');
    DOM.quotaFill.classList.add('warning');
  }
}

// ============================================
// Scan
// ============================================

async function startScan() {
  if (state.isScanning) return;
  state.isScanning = true;
  DOM.scanProgressContainer.style.display = '';
  DOM.scanProgressFill.style.width = '0%';
  DOM.scanProgressText.textContent = '正在准备扫描...';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || (!tab.url.includes('x.com') && !tab.url.includes('twitter.com'))) {
      showToast(DOM.toastContainer, '请先打开 X (Twitter) 页面', 'error');
      resetScanState();
      return;
    }

    chrome.tabs.sendMessage(tab.id, { type: 'START_SCAN' }, (response) => {
      if (chrome.runtime.lastError) {
        showToast(DOM.toastContainer, '无法连接到页面，请刷新 X 页面后重试', 'error');
        resetScanState();
      }
    });
  } catch (err) {
    showToast(DOM.toastContainer, '扫描失败: ' + err.message, 'error');
    resetScanState();
  }
}

function resetScanState() {
  state.isScanning = false;
  DOM.scanProgressContainer.style.display = 'none';
}

// ============================================
// Single Unfollow
// ============================================

function openUnfollowModal(user) {
  if (state.limitReached) {
    showToast(DOM.toastContainer, `今日已达取关上限 ${DAILY_LIMIT} 次，请明天再试`, 'warning');
    return;
  }

  state.pendingUnfollow = user;

  DOM.modalUser.innerHTML = `
    <img class="modal-user-avatar" src="${user.avatar || ''}"
         onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 36 36%22><rect fill=%22%23202327%22 width=%2236%22 height=%2236%22/></svg>'">
    <div class="modal-user-info">
      <div class="modal-user-name">${escapeHtml(user.name || user.screenName)}${user.isBlueVerified ? ' ' + blueCheckSvg() : ''}</div>
      <div class="modal-user-handle">@${escapeHtml(user.screenName)}</div>
    </div>
  `;

  DOM.modalOverlay.style.display = '';
}

function closeModal() {
  DOM.modalOverlay.style.display = 'none';
  state.pendingUnfollow = null;
}

async function confirmUnfollow() {
  const user = state.pendingUnfollow;
  if (!user) return;

  closeModal();

  // Disable the button immediately
  const btn = document.querySelector(`.btn-unfollow[data-user-id="${user.id}"]`);
  if (btn) {
    btn.disabled = true;
    btn.textContent = '取关中...';
  }

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    const result = await chrome.runtime.sendMessage({
      type: 'UNFOLLOW_ONE',
      data: { user, tabId: tab.id },
    });

    if (result && result.success) {
      state.dailyCount = result.dailyCount;
      state.limitReached = result.limitReached;
      state.unfollowedIds.add(user.id);
      await saveUnfollowedIds();
      updateQuotaUI();

      if (btn) {
        btn.textContent = '已取关';
        btn.classList.add('unfollowed');
      }

      showToast(DOM.toastContainer, `已取消关注 @${user.screenName}`, 'success');

      // If limit reached after this unfollow
      if (result.limitReached) {
        disableAllUnfollowButtons();
        showToast(DOM.toastContainer, `今日已达上限 ${DAILY_LIMIT} 次`, 'warning');
      }
    } else {
      if (btn) {
        btn.disabled = false;
        btn.textContent = '取关';
      }

      if (result?.limitReached) {
        state.limitReached = true;
        updateQuotaUI();
        disableAllUnfollowButtons();
        showToast(DOM.toastContainer, result.error, 'warning');
      } else {
        showToast(DOM.toastContainer, result?.error || '取关失败', 'error');
      }
    }
  } catch (err) {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '取关';
    }
    showToast(DOM.toastContainer, '取关失败: ' + err.message, 'error');
  }
}

function disableAllUnfollowButtons() {
  document.querySelectorAll('.btn-unfollow:not(.unfollowed)').forEach((btn) => {
    btn.disabled = true;
  });
}

// ============================================
// Message Handling
// ============================================

function handleBackgroundMessage(message) {
  switch (message.type) {
    case 'SCAN_PROGRESS': {
      const { loaded, percentage } = message.data;
      DOM.scanProgressFill.style.width = percentage + '%';
      DOM.scanProgressText.textContent = `已扫描 ${loaded} 个用户...`;
      break;
    }
    case 'SCAN_COMPLETE': {
      state.users = message.data.users || [];
      cacheUsers(state.users);
      resetScanState();
      onUsersLoaded();
      showToast(DOM.toastContainer, `扫描完成，共 ${state.users.length} 个关注`, 'success');
      break;
    }
    case 'SCAN_ERROR': {
      resetScanState();
      showToast(DOM.toastContainer, '扫描出错: ' + (message.data?.error || '未知错误'), 'error');
      break;
    }
  }
}

// ============================================
// Data Processing
// ============================================

function onUsersLoaded() {
  updateStats();
  applyFilter();
  DOM.searchSection.style.display = '';
  DOM.filterSection.style.display = '';
  DOM.userListSection.style.display = '';
}

function updateStats() {
  const notFollowingBack = state.users.filter((u) => u.status === 'not-following-back').length;
  const blueVerified = state.users.filter((u) => u.isBlueVerified).length;
  DOM.statFollowing.textContent = formatNumber(state.users.length);
  DOM.statNotFollowingBack.textContent = formatNumber(notFollowingBack);
  DOM.statBlueVerified.textContent = formatNumber(blueVerified);
  DOM.statWhitelisted.textContent = formatNumber(state.whitelist.size);
}

function applyFilter() {
  let list = [...state.users];

  // Category filter
  if (state.currentFilter === 'not-following-back') {
    list = list.filter((u) => u.status === 'not-following-back');
  } else if (state.currentFilter === 'non-blue-v') {
    list = list.filter((u) => !u.isBlueVerified);
  } else if (state.currentFilter === 'mutual') {
    list = list.filter((u) => u.status === 'mutual');
  }

  // Search filter
  if (state.searchQuery) {
    list = list.filter((u) =>
      (u.name || '').toLowerCase().includes(state.searchQuery) ||
      (u.screenName || '').toLowerCase().includes(state.searchQuery)
    );
  }

  state.filteredUsers = list;
  renderUserList();
}

// ============================================
// Rendering
// ============================================

function renderUserList() {
  const users = state.filteredUsers;

  if (users.length === 0) {
    DOM.userList.style.display = 'none';
    DOM.emptyState.style.display = '';
    return;
  }

  DOM.userList.style.display = '';
  DOM.emptyState.style.display = 'none';

  DOM.userList.innerHTML = users
    .map((user, index) => {
      const isWhitelisted = state.whitelist.has(user.id);
      const isUnfollowed = state.unfollowedIds.has(user.id);

      return `
        <div class="user-item" data-id="${user.id}" style="animation-delay: ${Math.min(index * 20, 400)}ms">
          <img class="user-avatar" src="${user.avatar || ''}" alt=""
               onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 40 40%22><rect fill=%22%23202327%22 width=%2240%22 height=%2240%22/></svg>'">
          <div class="user-info">
            <div class="user-name-row">
              <span class="user-name">${escapeHtml(user.name || user.screenName)}</span>
              ${user.isBlueVerified ? blueCheckSvg() : ''}
            </div>
            <div class="user-handle">@${escapeHtml(user.screenName)}</div>
          </div>
          <div class="user-actions">
            <span class="badge ${getBadgeClass(user.status)}">${getBadgeText(user.status)}</span>
            <button class="btn-whitelist ${isWhitelisted ? 'active' : ''}" data-user-id="${user.id}" title="${isWhitelisted ? '移出白名单' : '加入白名单'}">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                <path d="${isWhitelisted
                  ? 'M12 2L3 7v5c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-9-5zm-1 14l-4-4 1.41-1.41L11 13.17l5.59-5.59L18 9l-7 7z'
                  : 'M12 2L3 7v5c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-9-5zm7 10c0 4.52-2.98 8.69-7 9.93C7.98 20.69 5 16.52 5 12V8.3l7-3.89 7 3.89V12z'
                }"/>
              </svg>
            </button>
            <button class="btn-unfollow ${isUnfollowed ? 'unfollowed' : ''}" data-user-id="${user.id}" ${isUnfollowed || state.limitReached ? 'disabled' : ''}>
              ${isUnfollowed ? '已取关' : '取关'}
            </button>
          </div>
        </div>`;
    })
    .join('');

  // Bind events
  DOM.userList.querySelectorAll('.user-item').forEach((el) => {
    const userId = el.dataset.id;
    const user = state.users.find((u) => u.id === userId);

    el.querySelector('.btn-whitelist').addEventListener('click', (e) => {
      e.stopPropagation();
      toggleWhitelist(userId);
    });

    const unfollowBtn = el.querySelector('.btn-unfollow');
    if (unfollowBtn && !unfollowBtn.classList.contains('unfollowed')) {
      unfollowBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (user) openUnfollowModal(user);
      });
    }
  });
}

// ============================================
// Whitelist
// ============================================

async function loadWhitelist() {
  try {
    const result = await chrome.storage.local.get('whitelist');
    if (result.whitelist) state.whitelist = new Set(result.whitelist);
  } catch (e) { /* ignore */ }
}

async function saveWhitelist() {
  try {
    await chrome.storage.local.set({ whitelist: [...state.whitelist] });
  } catch (e) { /* ignore */ }
}

function toggleWhitelist(userId) {
  if (state.whitelist.has(userId)) {
    state.whitelist.delete(userId);
    showToast(DOM.toastContainer, '已移出白名单', 'info');
  } else {
    state.whitelist.add(userId);
    showToast(DOM.toastContainer, '已加入白名单', 'success');
  }
  saveWhitelist();
  updateStats();
  renderUserList();
}

// ============================================
// Unfollowed IDs (persist across sessions)
// ============================================

async function loadUnfollowedIds() {
  try {
    const result = await chrome.storage.local.get('unfollowedIds');
    if (result.unfollowedIds) state.unfollowedIds = new Set(result.unfollowedIds);
  } catch (e) { /* ignore */ }
}

async function saveUnfollowedIds() {
  try {
    await chrome.storage.local.set({ unfollowedIds: [...state.unfollowedIds] });
  } catch (e) { /* ignore */ }
}

// ============================================
// Cache
// ============================================

async function cacheUsers(users) {
  try {
    await chrome.storage.local.set({ cachedUsers: users, cachedAt: Date.now() });
  } catch (e) { /* ignore */ }
}

async function getCachedUsers() {
  try {
    const result = await chrome.storage.local.get(['cachedUsers', 'cachedAt']);
    if (result.cachedUsers && result.cachedAt && (Date.now() - result.cachedAt < 30 * 60 * 1000)) {
      return result.cachedUsers;
    }
  } catch (e) { /* ignore */ }
  return null;
}

// ============================================
// Start
// ============================================

init();
