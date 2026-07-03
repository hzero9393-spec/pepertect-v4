import { Request, Response, NextFunction } from 'express'

interface RateLimitEntry {
  count: number
  resetAt: number
}

const store = new Map<string, RateLimitEntry>()

// Cleanup every 60s
setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of store) {
    if (now > entry.resetAt) store.delete(key)
  }
}, 60_000)

export function rateLimit(windowMs: number = 60_000, maxRequests: number = 100) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = req.ip || 'unknown'
    const now = Date.now()

    let entry = store.get(key)
    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + windowMs }
      store.set(key, entry)
    }

    entry.count++

    res.setHeader('X-RateLimit-Limit', maxRequests)
    res.setHeader('X-RateLimit-Remaining', Math.max(0, maxRequests - entry.count))

    if (entry.count > maxRequests) {
      return res.status(429).json({ error: 'Too many requests. Please try again later.' })
    }

    next()
  }
}