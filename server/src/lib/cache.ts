// ─── In-memory Cache with TTL ──────────────────────────────────────────────
// Same as frontend cache but standalone (no Next.js dependency)

interface CacheEntry<T> {
  value: T
  expiresAt: number
}

class MemoryCache {
  private cache = new Map<string, CacheEntry<unknown>>()
  private cleanupInterval: NodeJS.Timeout | null = null

  constructor() {
    this.cleanupInterval = setInterval(() => this.cleanup(), 60000)
  }

  get<T>(key: string): T | null {
    const entry = this.cache.get(key)
    if (!entry) return null
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key)
      return null
    }
    return entry.value as T
  }

  set<T>(key: string, value: T, ttlMs: number): void {
    this.cache.set(key, { value, expiresAt: Date.now() + ttlMs })
  }

  delete(key: string): void {
    this.cache.delete(key)
  }

  deleteByPrefix(prefix: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) this.cache.delete(key)
    }
  }

  private cleanup(): void {
    const now = Date.now()
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) this.cache.delete(key)
    }
  }

  clear(): void {
    this.cache.clear()
  }

  get size(): number {
    return this.cache.size
  }
}

export const cache = new MemoryCache()

export const CacheKeys = {
  auth: (token: string) => `auth:${token}`,
  stockPrice: (symbol: string) => `stock:${symbol.toUpperCase()}`,
  futurePrice: (underlying: string) => `future:${underlying.toUpperCase()}`,
  optionPrice: (underlying: string, optionType: string, strikePrice: number) =>
    `option:${underlying.toUpperCase()}:${optionType}:${strikePrice}`,
  userBalance: (userId: string) => `ubal:${userId}`,
  marketLive: () => 'market:live:data',
}

export const CacheTTL = {
  AUTH: 5 * 60 * 1000,
  STOCK_PRICE: 300,
  FUTURE_PRICE: 300,
  OPTION_PRICE: 300,
  USER_BALANCE: 10 * 1000,
  MARKET_LIVE: 300,
}