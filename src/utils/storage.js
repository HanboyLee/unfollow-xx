/**
 * X Unfollower — Storage Utility
 * Wraps chrome.storage.local with async/await helpers.
 * Includes hourly unfollow quota tracking with sliding window.
 */

export const Storage = {
  async get(key) {
    const result = await chrome.storage.local.get(key);
    return result[key];
  },

  async set(key, value) {
    await chrome.storage.local.set({ [key]: value });
  },

  async getMultiple(keys) {
    return await chrome.storage.local.get(keys);
  },

  async remove(key) {
    await chrome.storage.local.remove(key);
  },

  // ---- History ----

  async addHistory(entry) {
    const history = (await this.get('unfollowHistory')) || [];
    history.unshift({
      ...entry,
      timestamp: Date.now(),
    });
    if (history.length > 500) history.length = 500;
    await this.set('unfollowHistory', history);
  },

  async getHistory() {
    return (await this.get('unfollowHistory')) || [];
  },

  // ---- Hourly Unfollow Quota (Sliding Window) ----

  /**
   * Get current hour's unfollow count with sliding window.
   * Returns { count, windowStart, resetIn }.
   * Automatically resets if the window has expired (1 hour passed).
   */
  async getHourlyUnfollowCount() {
    const data = await this.get('hourlyUnfollow');
    const now = Date.now();

    if (!data || (now - data.windowStart >= HOUR_IN_MS)) {
      // Window expired or doesn't exist - reset
      const fresh = { windowStart: now, count: 0 };
      await this.set('hourlyUnfollow', fresh);
      return { count: 0, windowStart: now, resetIn: HOUR_IN_MS };
    }

    const resetIn = HOUR_IN_MS - (now - data.windowStart);
    return { count: data.count, windowStart: data.windowStart, resetIn };
  },

  /**
   * Increment the hourly unfollow count by 1.
   * Returns { count, windowStart, resetIn, limitReached }.
   */
  async incrementHourlyUnfollow() {
    const data = await this.get('hourlyUnfollow');
    const now = Date.now();

    let record;
    let resetIn;

    if (!data || (now - data.windowStart >= HOUR_IN_MS)) {
      // Window expired - start fresh
      record = { windowStart: now, count: 1 };
      resetIn = HOUR_IN_MS;
    } else {
      // Continue in current window
      record = { windowStart: data.windowStart, count: data.count + 1 };
      resetIn = HOUR_IN_MS - (now - data.windowStart);
    }

    await this.set('hourlyUnfollow', record);
    return {
      count: record.count,
      windowStart: record.windowStart,
      resetIn,
      limitReached: record.count >= HOURLY_UNFOLLOW_LIMIT,
    };
  },

  /**
   * Check if hourly limit is reached.
   * Returns { reached, resetIn }.
   * @param {number} limit - Max allowed unfollows per hour (default 100)
   */
  async isHourlyLimitReached(limit = HOURLY_UNFOLLOW_LIMIT) {
    const { count, resetIn } = await this.getHourlyUnfollowCount();
    return { reached: count >= limit, resetIn };
  },
};

export const HOURLY_UNFOLLOW_LIMIT = 100;
export const HOUR_IN_MS = 60 * 60 * 1000;
