import { Request, Response, NextFunction } from 'express'
import { verifyToken, type JwtPayload } from './auth.js'
import { db } from './db.js'
import { cache, CacheKeys, CacheTTL } from './cache.js'

export interface AuthRequest extends Request {
  userId?: string
  userRole?: string
  token?: string
}

// Middleware that verifies JWT + checks session in DB + caches result
export async function authenticate(req: AuthRequest, res: Response, next: NextFunction) {
  // 1. Get token from Authorization: Bearer <token> header
  const authHeader = req.headers.authorization
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token) return res.status(401).json({ error: 'No token provided. Please login.' })

  // 2. Check cache
  const cached = cache.get<{ userId: string; isActive: boolean }>(CacheKeys.auth(token))
  if (cached && cached.isActive) {
    req.userId = cached.userId
    req.token = token
    return next()
  }

  // 3. Verify JWT
  const payload = verifyToken(token)
  if (!payload) return res.status(401).json({ error: 'Invalid or expired token' })

  // 4. Check session in DB
  try {
    const session = await db.session.findUnique({ where: { token } })
    if (!session || session.expiresAt < new Date()) {
      cache.delete(CacheKeys.auth(token))
      return res.status(401).json({ error: 'Session expired. Please login again.' })
    }
  } catch {
    return res.status(500).json({ error: 'Auth check failed' })
  }

  // 5. Check user is active
  try {
    const user = await db.user.findUnique({ where: { id: payload.userId }, select: { id: true, isActive: true, role: true } })
    if (!user || !user.isActive) {
      cache.delete(CacheKeys.auth(token))
      return res.status(401).json({ error: 'User not found or deactivated' })
    }
    req.userId = payload.userId
    req.userRole = user.role
    req.token = token
    cache.set(CacheKeys.auth(token), { userId: payload.userId, isActive: true }, CacheTTL.AUTH)
    next()
  } catch {
    return res.status(500).json({ error: 'Auth check failed' })
  }
}

// Optional admin-only middleware
export function requireAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  if (req.userRole !== 'ADMIN') return res.status(403).json({ error: 'Admin access required' })
  next()
}