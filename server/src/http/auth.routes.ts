import { Router, Request, Response } from 'express'
import { db } from '../lib/db.js'
import { hashPassword, verifyPassword, generateToken, verifyToken } from '../lib/auth.js'
import { cache, CacheKeys } from '../lib/cache.js'
import { parseUserAgent } from '../lib/ua-parser.js'
import { getLocationFromIP } from '../lib/geo-location.js'
import { authenticate, type AuthRequest } from '../lib/auth-middleware.js'
import { rateLimit } from '../lib/rate-limiter.js'
import { logger } from '../lib/logger.js'

export const authRoutes = Router()

// Helper: strip passwordHash from user object
function stripPasswordHash(user: Record<string, unknown>) {
  const { passwordHash: _, ...safe } = user
  return safe
}

// ─── POST /login ────────────────────────────────────────────────
authRoutes.post(
  '/login',
  rateLimit(60_000, 10),
  async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body

      if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' })
      }

      const user = await db.user.findUnique({ where: { email } })

      if (!user) {
        return res.status(401).json({ error: 'Invalid email or password' })
      }

      if (!user.isActive) {
        return res.status(403).json({ error: 'Your account has been deactivated. Please contact support.' })
      }

      if (!user.passwordHash) {
        return res.status(401).json({ error: 'This account uses Google Sign-In. Please sign in with Google.' })
      }

      const isValid = await verifyPassword(password, user.passwordHash)
      if (!isValid) {
        return res.status(401).json({ error: 'Invalid email or password' })
      }

      const token = generateToken({ userId: user.id, email: user.email, role: user.role })

      const userAgent = (req.headers['user-agent'] as string)?.substring(0, 255) || 'Unknown'
      const parsedUA = parseUserAgent(userAgent)
      const ipAddress = (req.headers['x-forwarded-for'] as string) || req.ip || null
      const location = await getLocationFromIP(ipAddress)

      const expiresAt = new Date()
      expiresAt.setDate(expiresAt.getDate() + 7)

      await db.session.create({
        data: {
          userId: user.id,
          token,
          device: userAgent,
          ipAddress,
          browser: parsedUA.browser,
          os: parsedUA.os,
          deviceType: parsedUA.deviceType,
          location,
          expiresAt,
        },
      })

      await db.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
      })

      logger.info(`[Auth] User logged in: ${user.email}`)

      return res.json({
        message: 'Login successful! Welcome back! 🚀',
        user: stripPasswordHash(user),
        token,
      })
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      logger.error('[Auth] Login error:', msg)
      return res.status(500).json({ error: 'Something went wrong. Please try again.' })
    }
  },
)

// ─── POST /register ─────────────────────────────────────────────
authRoutes.post(
  '/register',
  rateLimit(60_000, 5),
  async (req: Request, res: Response) => {
    try {
      const { name, email, phone, password } = req.body

      if (!name || !email || !password) {
        return res.status(400).json({ error: 'Name, email, and password are required' })
      }

      if (name.length < 2) {
        return res.status(400).json({ error: 'Name must be at least 2 characters' })
      }

      if (password.length < 6) {
        return res.status(400).json({ error: 'Password must be at least 6 characters' })
      }

      const existingEmail = await db.user.findUnique({ where: { email } })
      if (existingEmail) {
        return res.status(409).json({ error: 'An account with this email already exists' })
      }

      if (phone) {
        const existingPhone = await db.user.findUnique({ where: { phone } })
        if (existingPhone) {
          return res.status(409).json({ error: 'An account with this phone number already exists' })
        }
      }

      const passwordHash = await hashPassword(password)

      const user = await db.user.create({
        data: {
          name,
          email,
          phone: phone || null,
          passwordHash,
          virtualBalance: 100000,
          role: 'USER',
          subscription: 'FREE',
        },
      })

      const token = generateToken({ userId: user.id, email: user.email, role: user.role })

      const userAgent = (req.headers['user-agent'] as string)?.substring(0, 255) || 'Unknown'
      const parsedUA = parseUserAgent(userAgent)
      const ipAddress = (req.headers['x-forwarded-for'] as string) || req.ip || null
      const location = await getLocationFromIP(ipAddress)

      const expiresAt = new Date()
      expiresAt.setDate(expiresAt.getDate() + 7)

      await db.session.create({
        data: {
          userId: user.id,
          token,
          device: userAgent,
          ipAddress,
          browser: parsedUA.browser,
          os: parsedUA.os,
          deviceType: parsedUA.deviceType,
          location,
          expiresAt,
        },
      })

      logger.info(`[Auth] New user registered: ${user.email}`)

      return res.status(201).json({
        message: 'Account created successfully! Welcome to Pepertect! 🎉',
        user: stripPasswordHash(user),
        token,
      })
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      logger.error('[Auth] Register error:', msg)
      return res.status(500).json({ error: 'Something went wrong. Please try again.' })
    }
  },
)

// ─── GET /me ────────────────────────────────────────────────────
authRoutes.get('/me', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const user = await db.user.findUnique({
      where: { id: req.userId },
    })

    if (!user || !user.isActive) {
      return res.status(401).json({ error: 'User not found or deactivated' })
    }

    // Sync marginUsed from actual open SELL positions to prevent stale data
    const realMargin = await db.position.aggregate({
      where: { userId: req.userId, isOpen: true, tradeDirection: 'SELL' },
      _sum: { marginUsed: true },
    })
    const realMarginUsed = realMargin._sum.marginUsed || 0
    if (realMarginUsed !== (user.marginUsed || 0)) {
      await db.user.update({
        where: { id: req.userId },
        data: { marginUsed: realMarginUsed },
      })
      user.marginUsed = realMarginUsed
    }

    return res.json({ user: stripPasswordHash(user) })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    logger.error('[Auth] /me error:', msg)
    return res.status(500).json({ error: 'Something went wrong' })
  }
})

// ─── POST /logout ───────────────────────────────────────────────
authRoutes.post('/logout', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    if (req.token) {
      await db.session.deleteMany({ where: { token: req.token } }).catch(() => {})
      cache.delete(CacheKeys.auth(req.token))
    }

    logger.info(`[Auth] User logged out: ${req.userId}`)

    return res.json({ message: 'Logged out successfully' })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    logger.error('[Auth] Logout error:', msg)
    return res.status(500).json({ error: 'Something went wrong' })
  }
})

// ─── GET /sessions ──────────────────────────────────────────────
authRoutes.get('/sessions', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const sessions = await db.session.findMany({
      where: {
        userId: req.userId,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    })

    const formatted = sessions.map((session) => ({
      id: session.id,
      token: session.token,
      browser: session.browser || 'Unknown',
      os: session.os || 'Unknown',
      deviceType: session.deviceType || 'Desktop',
      location: session.location || null,
      ipAddress: session.ipAddress || null,
      device: session.device,
      isCurrent: session.token === req.token,
      createdAt: session.createdAt.toISOString(),
      expiresAt: session.expiresAt.toISOString(),
    }))

    return res.json({ sessions: formatted })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    logger.error('[Auth] Get sessions error:', msg)
    return res.status(500).json({ error: 'Failed to fetch sessions' })
  }
})

// ─── DELETE /sessions/:id ───────────────────────────────────────
authRoutes.delete('/sessions/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const sessionId = req.params.id as string

    const session = await db.session.findUnique({ where: { id: sessionId } })

    if (!session) {
      return res.status(404).json({ error: 'Session not found' })
    }

    if (session.userId !== req.userId) {
      return res.status(403).json({ error: 'Unauthorized' })
    }

    if (session.token === req.token) {
      return res.status(400).json({ error: 'Cannot logout current session. Use /api/auth/logout instead.' })
    }

    await db.session.delete({ where: { id: sessionId as string } })

    return res.json({ message: 'Session revoked' })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    logger.error('[Auth] Delete session error:', msg)
    return res.status(500).json({ error: 'Failed to logout device' })
  }
})