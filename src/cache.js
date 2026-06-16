/**
 * Lightweight in-memory TTL cache.
 *
 * Design goals:
 *  - Zero dependencies, pure JS
 *  - O(1) get / set
 *  - Passive expiry (entries are evicted on read, not via a background timer)
 *    → safe for low-memory environments
 */

class TTLCache {
  /** @param {number} defaultTTLms  Default time-to-live in milliseconds */
  constructor(defaultTTLms = 5_000) {
    this.defaultTTL = defaultTTLms;
    /** @type {Map<string, { value: any, expiresAt: number }>} */
    this._store = new Map();
  }

  /**
   * Store a value under `key` for `ttlMs` milliseconds.
   * @param {string} key
   * @param {any}    value
   * @param {number} [ttlMs]
   */
  set(key, value, ttlMs = this.defaultTTL) {
    this._store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  /**
   * Retrieve a cached value, or `undefined` if missing / expired.
   * @param {string} key
   * @returns {any | undefined}
   */
  get(key) {
    const entry = this._store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this._store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  /** @param {string} key */
  delete(key) {
    this._store.delete(key);
  }

  /** Remove all expired entries — call periodically if you want proactive GC. */
  purgeExpired() {
    const now = Date.now();
    for (const [key, entry] of this._store) {
      if (now > entry.expiresAt) this._store.delete(key);
    }
  }

  get size() {
    return this._store.size;
  }
}

export default TTLCache;
