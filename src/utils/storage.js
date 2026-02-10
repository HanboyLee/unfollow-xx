/**
 * X Unfollower — Storage Utility
 * Wraps chrome.storage.local with async/await helpers.
 * Includes daily unfollow quota tracking.
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

  // ---- Daily Unfollow Quota ----

  /**
   * Get today's unfollow count.
   * Automatically resets if the stored date is not today.
   */
  async getDailyUnfollowCount() {
    const data = await this.get('dailyUnfollow');
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

    if (!data || data.date !== today) {
      // Reset for new day
      const fresh = { date: today, count: 0 };
      await this.set('dailyUnfollow', fresh);
      return 0;
    }

    return data.count;
  },

  /**
   * Increment today's unfollow count by 1.
   * Returns the new count.
   */
  async incrementDailyUnfollow() {
    const data = await this.get('dailyUnfollow');
    const today = new Date().toISOString().slice(0, 10);

    let record;
    if (!data || data.date !== today) {
      record = { date: today, count: 1 };
    } else {
      record = { date: today, count: data.count + 1 };
    }

    await this.set('dailyUnfollow', record);
    return record.count;
  },

  /**
   * Check if daily limit is reached.
   * @param {number} limit - Max allowed unfollows per day (default 50)
   */
  async isDailyLimitReached(limit = 50) {
    const count = await this.getDailyUnfollowCount();
    return count >= limit;
  },
};

export const DAILY_UNFOLLOW_LIMIT = 50;
