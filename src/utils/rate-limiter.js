/**
 * X Unfollower — Rate Limiter
 * Provides random delays and pause/resume capability to avoid anti-automation detection.
 */

export class RateLimiter {
  constructor(options = {}) {
    this.minDelay = options.minDelay || 1000;  // 1s
    this.maxDelay = options.maxDelay || 3000;  // 3s
    this.batchSize = options.batchSize || 50;
    this.batchPause = options.batchPause || 60000; // 60s
    this.count = 0;
    this.isPaused = false;
    this._resolveResume = null;
  }

  /**
   * Wait for a random delay between min and max.
   * If paused, waits until resumed.
   */
  async wait() {
    if (this.isPaused) {
      await new Promise((resolve) => {
        this._resolveResume = resolve;
      });
    }

    this.count++;

    // Batch pause: after every `batchSize` operations, take a longer break
    if (this.count > 0 && this.count % this.batchSize === 0) {
      await this._sleep(this.batchPause);
      return;
    }

    const delay = this.minDelay + Math.random() * (this.maxDelay - this.minDelay);
    await this._sleep(delay);
  }

  pause() {
    this.isPaused = true;
  }

  resume() {
    this.isPaused = false;
    if (this._resolveResume) {
      this._resolveResume();
      this._resolveResume = null;
    }
  }

  reset() {
    this.count = 0;
    this.isPaused = false;
    if (this._resolveResume) {
      this._resolveResume();
      this._resolveResume = null;
    }
  }

  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
