// In-memory cache with TTL for performance optimization
// Avoids repeated DB queries for auth, stock prices, etc.

interface CacheEntry<T> {
  value: T
  expiresAt: number
}

class MemoryCache {
  private cache = new Map<string, CacheEntry<unknown>>()
  private cleanupInterval: NodeJS.Timeout | null = null

  constructor() {
    // Clean expired entries every 60 seconds
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
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + ttlMs,
    })
  }

  delete(key: string): void {
    this.cache.delete(key)
  }

  deleteByPrefix(prefix: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key)
      }
    }
  }

  private cleanup(): void {
    const now = Date.now()
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key)
      }
    }
  }

  clear(): void {
    this.cache.clear()
  }

  get size(): number {
    return this.cache.size
  }
}

// Singleton cache instance
export const cache = new MemoryCache()

// ─── Cache Key Helpers ─────────────────────────────────────────

export const CacheKeys = {
  // Auth: session token → { userId, isActive }
  auth: (token: string) => `auth:${token}`,

  // Stock price: symbol → { currentPrice, change, changePercent, name }
  stockPrice: (symbol: string) => `stock:${symbol.toUpperCase()}`,

  // Future price: underlying → { ltp, change, changePercent }
  futurePrice: (underlying: string) => `future:${underlying.toUpperCase()}`,

  // Option price: underlying+type+strike → { ltp, change, changePercent }
  optionPrice: (underlying: string, optionType: string, strikePrice: number) =>
    `option:${underlying.toUpperCase()}:${optionType}:${strikePrice}`,

  // User balance: userId → { virtualBalance, marginUsed, totalPnl, totalTrades }
  userBalance: (userId: string) => `ubal:${userId}`,

  // Market live data: aggregated indices + stocks
  marketLive: () => 'market:live:data',
}

// ─── TTL Constants ─────────────────────────────────────────────

export const CacheTTL = {
  AUTH: 5 * 60 * 1000,       // 5 minutes (session validity)
  STOCK_PRICE: 300,           // 300ms (ultra-fast real-time market data)
  FUTURE_PRICE: 300,          // 300ms (ultra-fast real-time)
  OPTION_PRICE: 300,          // 300ms (ultra-fast real-time)
  USER_BALANCE: 10 * 1000,   // 10 seconds (after trade, balance changes)
  MARKET_LIVE: 300,          // 300ms (matches 500ms poll interval for sub-ms freshness)
}