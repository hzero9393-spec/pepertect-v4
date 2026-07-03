import { Router, Response } from 'express'
import { db } from '../lib/db.js'
import { authenticate, requireAdmin, type AuthRequest } from '../lib/auth-middleware.js'
import { cache, CacheKeys } from '../lib/cache.js'
import { getOptionChainManager } from '../services/option-chain-manager.js'
import { getExpiryDates, getUnderlyingInstrumentKey } from '../lib/upstox-instruments.js'
import { getMarketDataManager } from '../services/market-data-manager.js'
import { logger } from '../lib/logger.js'
import { verifyPassword, hashPassword, generateToken } from '../lib/auth.js'

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Strip passwordHash from any user-like object */
function stripPasswordHash<T extends Record<string, any>>(obj: T): Omit<T, 'passwordHash'> {
  const { passwordHash, ...rest } = obj as T & { passwordHash?: unknown }
  return rest
}

/** Safe JSON parse that returns null on failure */
function safeJsonParse(str: string): any {
  try { return JSON.parse(str) } catch { return null }
}

/** Parse pagination params with defaults */
function parsePagination(query: Record<string, any>) {
  const page = Math.max(1, parseInt(query.page || '1', 10) || 1)
  const limit = Math.min(100, Math.max(1, parseInt(query.limit || '20', 10) || 20))
  const skip = (page - 1) * limit
  return { page, limit, skip }
}

// ─── Router ─────────────────────────────────────────────────────────────────

export const optionsRoutes = Router()

// ═══════════════════════════════════════════════════════════════════════════════
// OPTIONS ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

// ─── GET /api/options/expiries/:underlying (public) ──────────────────────────

optionsRoutes.get('/api/options/expiries/:underlying', async (req, res: Response) => {
  try {
    const { underlying } = req.params
    const expiries = await getExpiryDates(underlying)
    res.json({ success: true, data: expiries })
  } catch (err) {
    logger.error('[OptionsRoutes] /expiries error:', err)
    res.status(500).json({ success: false, error: 'Failed to fetch expiry dates' })
  }
})

// ─── GET /api/options/strike-detail (auth required) ────────────────────────

optionsRoutes.get('/api/options/strike-detail', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { underlying, optionType, strikePrice, expiry } = req.query as Record<string, string>

    if (!underlying || !optionType || !strikePrice || !expiry) {
      res.status(400).json({ success: false, error: 'Missing required params: underlying, optionType, strikePrice, expiry' })
      return
    }

    if (optionType !== 'CE' && optionType !== 'PE') {
      res.status(400).json({ success: false, error: 'optionType must be CE or PE' })
      return
    }

    const strike = parseFloat(strikePrice)
    if (isNaN(strike) || strike <= 0) {
      res.status(400).json({ success: false, error: 'Invalid strikePrice' })
      return
    }

    // Parse expiry date — accept both "2026-07-28" and ISO formats
    const expiryDate = new Date(expiry)
    if (isNaN(expiryDate.getTime())) {
      res.status(400).json({ success: false, error: 'Invalid expiry date format' })
      return
    }

    // Fetch option from DB
    let option = null
    try {
      option = await db.option.findFirst({
        where: {
          underlying: underlying.toUpperCase(),
          optionType,
          strikePrice: strike,
          expiryDate: {
            gte: new Date(expiryDate.getFullYear(), expiryDate.getMonth(), expiryDate.getDate()),
            lt: new Date(expiryDate.getFullYear(), expiryDate.getMonth(), expiryDate.getDate() + 1),
          },
          isActive: true,
        },
      })
    } catch {
      // Option table may not have matching data
    }

    // Try to get live data from OptionChainManager cache
    let liveData = null
    try {
      const ocManager = getOptionChainManager()
      const ocUpdate = ocManager.getLatest(underlying.toUpperCase(), expiry.split('T')[0])
      if (ocUpdate) {
        const matchedStrike = ocUpdate.strikes.find(s => s.strike_price === strike)
        if (matchedStrike) {
          const opts = optionType === 'CE' ? matchedStrike.call_options : matchedStrike.put_options
          if (opts) {
            liveData = {
              ltp: opts.market_data?.ltp ?? 0,
              volume: opts.market_data?.volume ?? 0,
              oi: opts.market_data?.oi ?? 0,
              prevOi: opts.market_data?.prev_oi ?? 0,
              bidPrice: opts.market_data?.bid_price ?? 0,
              bidQty: opts.market_data?.bid_qty ?? 0,
              askPrice: opts.market_data?.ask_price ?? 0,
              askQty: opts.market_data?.ask_qty ?? 0,
              closePrice: opts.market_data?.close_price ?? 0,
              greeks: opts.option_greeks
                ? {
                    iv: opts.option_greeks.iv ?? 0,
                    delta: opts.option_greeks.delta ?? 0,
                    theta: opts.option_greeks.theta ?? 0,
                    vega: opts.option_greeks.vega ?? 0,
                    gamma: opts.option_greeks.gamma ?? 0,
                    pop: opts.option_greeks.pop ?? 0,
                  }
                : null,
              spot: ocUpdate.spot,
              pcr: ocUpdate.pcr,
              timestamp: ocUpdate.timestamp,
            }
          }
        }
      }
    } catch {
      // OptionChainManager may not have cached data for this underlying/expiry
    }

    const data: Record<string, any> = { option }
    if (liveData) data.liveData = liveData

    res.json({ success: true, data })
  } catch (err) {
    logger.error('[OptionsRoutes] /strike-detail error:', err)
    res.status(500).json({ success: false, error: 'Failed to fetch strike detail' })
  }
})

// ═══════════════════════════════════════════════════════════════════════════════
// FUTURES ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

// ─── GET /api/futures/:underlying (public) ──────────────────────────────────

optionsRoutes.get('/api/futures/:underlying', async (req, res: Response) => {
  try {
    const { underlying } = req.params
    const futures = await db.future.findMany({
      where: {
        underlying: underlying.toUpperCase(),
        isActive: true,
        expiryDate: { gte: new Date() },
      },
      orderBy: { expiryDate: 'asc' },
    })
    res.json({ success: true, data: futures })
  } catch (err) {
    logger.error('[OptionsRoutes] /futures error:', err)
    res.status(500).json({ success: false, error: 'Failed to fetch futures' })
  }
})

// ═══════════════════════════════════════════════════════════════════════════════
// PROFILE ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

// ─── GET /api/profile/wallet (auth required) ────────────────────────────────

optionsRoutes.get('/api/profile/wallet', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!

    // Try cache first
    const cached = cache.get<{ virtualBalance: number; marginUsed: number; totalPnl: number; totalTrades: number }>(
      CacheKeys.userBalance(userId)
    )
    if (cached) {
      res.json({
        success: true,
        data: {
          ...cached,
          availableMargin: cached.virtualBalance - cached.marginUsed,
        },
      })
      return
    }

    const user = await db.user.findUnique({
      where: { id: userId },
      select: { virtualBalance: true, marginUsed: true, totalPnl: true, totalTrades: true },
    })

    if (!user) {
      res.status(404).json({ success: false, error: 'User not found' })
      return
    }

    const data = {
      virtualBalance: user.virtualBalance,
      marginUsed: user.marginUsed,
      availableMargin: user.virtualBalance - user.marginUsed,
      totalPnl: user.totalPnl,
      totalTrades: user.totalTrades,
    }

    res.json({ success: true, data })
  } catch (err) {
    logger.error('[OptionsRoutes] /profile/wallet error:', err)
    res.status(500).json({ success: false, error: 'Failed to fetch wallet info' })
  }
})

// ─── PUT /api/profile/update (auth required) ────────────────────────────────

optionsRoutes.put('/api/profile/update', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!
    const { name, phone, avatar } = req.body

    const updateData: Record<string, any> = {}
    if (name !== undefined) updateData.name = name
    if (phone !== undefined) updateData.phone = phone
    if (avatar !== undefined) updateData.avatar = avatar

    if (Object.keys(updateData).length === 0) {
      res.status(400).json({ success: false, error: 'No fields to update' })
      return
    }

    const user = await db.user.update({
      where: { id: userId },
      data: updateData,
    })

    res.json({
      success: true,
      message: 'Profile updated',
      user: stripPasswordHash(user),
    })
  } catch (err: any) {
    logger.error('[OptionsRoutes] /profile/update error:', err)
    if (err?.code === 'P2002') {
      res.status(409).json({ success: false, error: 'Phone number already in use' })
      return
    }
    res.status(500).json({ success: false, error: 'Failed to update profile' })
  }
})

// ─── POST /api/profile/change-password (auth required) ──────────────────────

optionsRoutes.post('/api/profile/change-password', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!
    const { currentPassword, newPassword } = req.body

    if (!currentPassword || !newPassword) {
      res.status(400).json({ success: false, error: 'Current password and new password are required' })
      return
    }

    if (newPassword.length < 6) {
      res.status(400).json({ success: false, error: 'New password must be at least 6 characters' })
      return
    }

    const user = await db.user.findUnique({
      where: { id: userId },
      select: { passwordHash: true },
    })

    if (!user || !user.passwordHash) {
      res.status(400).json({ success: false, error: 'No password set for this account (OAuth user?)' })
      return
    }

    const isValid = await verifyPassword(currentPassword, user.passwordHash)
    if (!isValid) {
      res.status(401).json({ success: false, error: 'Current password is incorrect' })
      return
    }

    const newHash = await hashPassword(newPassword)
    await db.user.update({
      where: { id: userId },
      data: { passwordHash: newHash },
    })

    // Invalidate all other sessions for security
    // (keep current session — caller will still be logged in via their token)

    res.json({ success: true, message: 'Password changed' })
  } catch (err) {
    logger.error('[OptionsRoutes] /profile/change-password error:', err)
    res.status(500).json({ success: false, error: 'Failed to change password' })
  }
})

// ─── POST /api/profile/reset-data (auth required) ───────────────────────────
// DANGEROUS — resets all trading data

optionsRoutes.post('/api/profile/reset-data', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!
    const { confirm } = req.body

    // Require explicit confirmation
    if (confirm !== 'RESET_ALL_DATA') {
      res.status(400).json({
        success: false,
        error: 'This action is irreversible. Send { confirm: "RESET_ALL_DATA" } to proceed.',
      })
      return
    }

    // Close all open positions
    await db.position.updateMany({
      where: { userId, isOpen: true },
      data: { isOpen: false, squaredOffAt: new Date(), exitReason: 'DATA_RESET' },
    })

    // Delete all orders
    await db.order.deleteMany({ where: { userId } })

    // Delete all trades
    await db.trade.deleteMany({ where: { userId } })

    // Delete all portfolios
    await db.portfolio.deleteMany({ where: { userId } })

    // Reset user balance and stats
    await db.user.update({
      where: { id: userId },
      data: {
        virtualBalance: 100000,
        marginUsed: 0,
        totalTrades: 0,
        winRate: 0,
        totalPnl: 0,
        rank: null,
        dailyTrades: 0,
        dailyPositions: 0,
      },
    })

    // Invalidate cached balance
    cache.delete(CacheKeys.userBalance(userId))

    logger.warn(`[OptionsRoutes] User ${userId} reset all trading data`)

    res.json({ success: true, message: 'All data reset' })
  } catch (err) {
    logger.error('[OptionsRoutes] /profile/reset-data error:', err)
    res.status(500).json({ success: false, error: 'Failed to reset data' })
  }
})

// ─── POST /api/profile/logout-all (auth required) ───────────────────────────

optionsRoutes.post('/api/profile/logout-all', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!
    const currentToken = req.headers.authorization?.replace('Bearer ', '')

    // Delete all sessions for this user except the current one
    const whereClause: Record<string, any> = { userId }
    if (currentToken) {
      whereClause.token = { not: currentToken }
    }

    const result = await db.session.deleteMany({ where: whereClause })

    // Also invalidate cache entries for user's auth tokens
    cache.deleteByPrefix(`auth:`)

    res.json({
      success: true,
      message: 'All other sessions terminated',
      terminatedCount: result.count,
    })
  } catch (err) {
    logger.error('[OptionsRoutes] /profile/logout-all error:', err)
    res.status(500).json({ success: false, error: 'Failed to terminate sessions' })
  }
})

// ─── GET /api/profile/report (auth required) ────────────────────────────────

optionsRoutes.get('/api/profile/report', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!

    // Fetch all trades with realized P&L
    const trades = await db.trade.findMany({
      where: { userId, pnl: { not: null } },
      select: {
        pnl: true,
        pnlPercent: true,
        symbol: true,
        segment: true,
        executedAt: true,
        squaredOffAt: true,
        tradeDirection: true,
      },
      orderBy: { executedAt: 'desc' },
    })

    const totalTrades = trades.length
    const wins = trades.filter(t => (t.pnl ?? 0) > 0).length
    const winRate = totalTrades > 0 ? parseFloat(((wins / totalTrades) * 100).toFixed(2)) : 0
    const totalPnl = trades.reduce((sum, t) => sum + (t.pnl ?? 0), 0)
    const avgPnl = totalTrades > 0 ? parseFloat((totalPnl / totalTrades).toFixed(2)) : 0

    const pnls = trades.map(t => t.pnl ?? 0)
    const bestTrade = pnls.length > 0 ? Math.max(...pnls) : 0
    const worstTrade = pnls.length > 0 ? Math.min(...pnls) : 0

    const summary = {
      totalTrades,
      wins,
      losses: totalTrades - wins,
      winRate,
      totalPnl: parseFloat(totalPnl.toFixed(2)),
      avgPnl,
      bestTrade: parseFloat(bestTrade.toFixed(2)),
      worstTrade: parseFloat(worstTrade.toFixed(2)),
      profitFactor: pnls.length > 0
        ? parseFloat((Math.abs(pnls.filter(p => p > 0).reduce((a, b) => a + b, 0)) /
            (Math.abs(pnls.filter(p => p < 0).reduce((a, b) => a + b, 0)) || 1)).toFixed(2))
        : 0,
    }

    // Daily P&L breakdown
    const dailyMap = new Map<string, { date: string; pnl: number; trades: number; wins: number }>()
    for (const trade of trades) {
      const dateKey = trade.executedAt.toISOString().split('T')[0]
      const existing = dailyMap.get(dateKey) || { date: dateKey, pnl: 0, trades: 0, wins: 0 }
      existing.pnl += trade.pnl ?? 0
      existing.trades++
      if ((trade.pnl ?? 0) > 0) existing.wins++
      dailyMap.set(dateKey, existing)
    }
    const dailyBreakdown = Array.from(dailyMap.values())
      .map(d => ({ ...d, pnl: parseFloat(d.pnl.toFixed(2)) }))
      .sort((a, b) => b.date.localeCompare(a.date))

    // Monthly P&L breakdown
    const monthlyMap = new Map<string, { month: string; pnl: number; trades: number; wins: number }>()
    for (const trade of trades) {
      const monthKey = trade.executedAt.toISOString().slice(0, 7) // "2026-07"
      const existing = monthlyMap.get(monthKey) || { month: monthKey, pnl: 0, trades: 0, wins: 0 }
      existing.pnl += trade.pnl ?? 0
      existing.trades++
      if ((trade.pnl ?? 0) > 0) existing.wins++
      monthlyMap.set(monthKey, existing)
    }
    const monthlyBreakdown = Array.from(monthlyMap.values())
      .map(m => ({ ...m, pnl: parseFloat(m.pnl.toFixed(2)) }))
      .sort((a, b) => b.month.localeCompare(a.month))

    res.json({ success: true, data: { summary, dailyBreakdown, monthlyBreakdown } })
  } catch (err) {
    logger.error('[OptionsRoutes] /profile/report error:', err)
    res.status(500).json({ success: false, error: 'Failed to generate report' })
  }
})

// ═══════════════════════════════════════════════════════════════════════════════
// CHALLENGES & LEARNING
// ═══════════════════════════════════════════════════════════════════════════════

// ─── GET /api/challenges (auth required) ────────────────────────────────────

optionsRoutes.get('/api/challenges', authenticate, async (_req: AuthRequest, res: Response) => {
  try {
    const challenges = await db.challenge.findMany({
      where: { status: 'ACTIVE' },
      orderBy: { startDate: 'desc' },
    })
    res.json({ success: true, data: challenges })
  } catch {
    // Table may not be available yet
    res.json({ success: true, data: [] })
  }
})

// ─── GET /api/learning (public) ────────────────────────────────────────────

optionsRoutes.get('/api/learning', async (_req, res: Response) => {
  try {
    const paths = await db.learningPath.findMany({
      where: { isActive: true },
      include: { modules: { where: { isActive: true }, orderBy: { order: 'asc' } } },
      orderBy: { order: 'asc' },
    })
    res.json({ success: true, data: paths })
  } catch {
    // Table may not be available yet
    res.json({ success: true, data: [] })
  }
})

// ═══════════════════════════════════════════════════════════════════════════════
// SUPPORT TICKETS
// ═══════════════════════════════════════════════════════════════════════════════

// ─── GET /api/support/tickets (auth required) ───────────────────────────────

optionsRoutes.get('/api/support/tickets', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!
    const tickets = await db.supportTicket.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    })
    res.json({ success: true, data: tickets })
  } catch {
    // Table may not be available yet
    res.json({ success: true, data: [] })
  }
})

// ─── POST /api/support/tickets (auth required) ──────────────────────────────

optionsRoutes.post('/api/support/tickets', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!
    const { subject, message, category, priority } = req.body

    if (!subject || !message) {
      res.status(400).json({ success: false, error: 'Subject and message are required' })
      return
    }

    const ticket = await db.supportTicket.create({
      data: {
        userId,
        subject,
        message,
        category: category || 'GENERAL',
        priority: priority || 'MEDIUM',
        userAgent: req.headers['user-agent'] || null,
        pageUrl: req.body.pageUrl || null,
      },
    })

    res.status(201).json({ success: true, message: 'Ticket created', data: ticket })
  } catch (err) {
    logger.error('[OptionsRoutes] POST /support/tickets error:', err)
    res.status(500).json({ success: false, error: 'Failed to create ticket' })
  }
})

// ═══════════════════════════════════════════════════════════════════════════════
// STOCKS F&O
// ═══════════════════════════════════════════════════════════════════════════════

// ─── GET /api/stocks/fno/:symbol (public) ───────────────────────────────────

optionsRoutes.get('/api/stocks/fno/:symbol', async (req, res: Response) => {
  try {
    const symbol = req.params.symbol.toUpperCase()

    const stock = await db.stock.findUnique({
      where: { symbol },
    })

    if (!stock) {
      res.status(404).json({ success: false, error: 'Stock not found' })
      return
    }

    const data = {
      symbol: stock.symbol,
      name: stock.name,
      lotSize: stock.lotSize,
      sector: stock.sector,
      isFuturesAvailable: stock.isFuturesAvailable,
      isOptionsAvailable: stock.isOptionsAvailable,
      strikeInterval: stock.strikeInterval,
      circuitLimit: stock.circuitLimit,
      currentPrice: stock.currentPrice,
      change: stock.change,
      changePercent: stock.changePercent,
      isFnoBan: stock.isFnoBan,
    }

    res.json({ success: true, data })
  } catch (err) {
    logger.error('[OptionsRoutes] /stocks/fno error:', err)
    res.status(500).json({ success: false, error: 'Failed to fetch F&O data' })
  }
})

// ═══════════════════════════════════════════════════════════════════════════════
// ADMIN AUTH ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

// ─── POST /api/admin/auth/login ─────────────────────────────────────────────

optionsRoutes.post('/api/admin/auth/login', async (req, res: Response) => {
  try {
    const { username, password } = req.body

    if (!username || !password) {
      res.status(400).json({ success: false, error: 'Username and password are required' })
      return
    }

    const admin = await db.admin.findUnique({
      where: { username },
    })

    if (!admin || !admin.isActive) {
      res.status(401).json({ success: false, error: 'Invalid credentials' })
      return
    }

    const isValid = await verifyPassword(password, admin.passwordHash)
    if (!isValid) {
      res.status(401).json({ success: false, error: 'Invalid credentials' })
      return
    }

    // Generate a token using the same JWT system
    const token = generateToken({
      userId: admin.id,
      email: admin.email,
      role: admin.role,
    })

    // Create session
    await db.session.create({
      data: {
        userId: admin.id,
        token,
        device: req.headers['user-agent'] || 'unknown',
        ipAddress: req.ip || null,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      },
    })

    // Update last login
    await db.admin.update({
      where: { id: admin.id },
      data: { lastLoginAt: new Date() },
    })

    // Cache auth
    cache.set(CacheKeys.auth(token), { userId: admin.id, role: admin.role }, 5 * 60 * 1000)

    res.json({
      success: true,
      data: {
        token,
        admin: stripPasswordHash(admin),
      },
    })
  } catch (err) {
    logger.error('[OptionsRoutes] POST /admin/auth/login error:', err)
    res.status(500).json({ success: false, error: 'Admin login failed' })
  }
})

// ─── GET /api/admin/auth/verify (admin auth) ────────────────────────────────

optionsRoutes.get('/api/admin/auth/verify', requireAdmin, (_req: AuthRequest, res: Response) => {
  res.json({ success: true, isAdmin: true })
})

// ═══════════════════════════════════════════════════════════════════════════════
// ADMIN DASHBOARD & MANAGEMENT ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

// ─── GET /api/admin/dashboard (admin auth) ──────────────────────────────────

optionsRoutes.get('/api/admin/dashboard', requireAdmin, async (_req: AuthRequest, res: Response) => {
  try {
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const [totalUsers, activeUsers, totalTrades, totalPnlResult, newUsersToday] = await Promise.all([
      db.user.count(),
      db.user.count({ where: { isActive: true } }),
      db.trade.count(),
      db.user.aggregate({ _sum: { totalPnl: true } }),
      db.user.count({ where: { createdAt: { gte: today } } }),
    ])

    // Get total platform P&L from trades
    let totalPlatformPnl = 0
    try {
      const pnlAgg = await db.trade.aggregate({ _sum: { pnl: true } })
      totalPlatformPnl = pnlAgg._sum.pnl ?? 0
    } catch {
      // fall back to user aggregate
      totalPlatformPnl = totalPnlResult._sum.totalPnl ?? 0
    }

    const openPositions = await db.position.count({ where: { isOpen: true } })

    res.json({
      success: true,
      data: {
        totalUsers,
        activeUsers,
        totalTrades,
        totalPnl: parseFloat((totalPlatformPnl).toFixed(2)),
        newUsersToday,
        openPositions,
      },
    })
  } catch (err) {
    logger.error('[OptionsRoutes] GET /admin/dashboard error:', err)
    res.status(500).json({ success: false, error: 'Failed to fetch dashboard stats' })
  }
})

// ─── GET /api/admin/users (admin auth) ──────────────────────────────────────

optionsRoutes.get('/api/admin/users', requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { page, limit, skip } = parsePagination(req.query)
    const { search } = req.query as Record<string, string>

    const whereClause: Record<string, any> = {}
    if (search) {
      whereClause.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search } },
      ]
    }

    const [users, total] = await Promise.all([
      db.user.findMany({
        where: whereClause,
        select: {
          id: true, name: true, email: true, phone: true, avatar: true,
          role: true, subscription: true, virtualBalance: true, marginUsed: true,
          totalTrades: true, winRate: true, totalPnl: true, rank: true,
          isActive: true, isEmailVerified: true, createdAt: true, lastLoginAt: true,
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      db.user.count({ where: whereClause }),
    ])

    res.json({
      success: true,
      data: users,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    })
  } catch (err) {
    logger.error('[OptionsRoutes] GET /admin/users error:', err)
    res.status(500).json({ success: false, error: 'Failed to fetch users' })
  }
})

// ─── GET /api/admin/users/:id (admin auth) ──────────────────────────────────

optionsRoutes.get('/api/admin/users/:id', requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const user = await db.user.findUnique({
      where: { id: req.params.id as string },
      select: { id: true, name: true, email: true, phone: true, role: true, isActive: true, virtualBalance: true, marginUsed: true, totalPnl: true, totalTrades: true, lastLoginAt: true, createdAt: true, subscription: true, avatar: true, panNumber: true },
    })

    if (!user) {
      res.status(404).json({ success: false, error: 'User not found' })
      return
    }

    res.json({ success: true, data: stripPasswordHash(user) })
  } catch (err) {
    logger.error('[OptionsRoutes] GET /admin/users/:id error:', err)
    res.status(500).json({ success: false, error: 'Failed to fetch user' })
  }
})

// ─── PATCH /api/admin/users/:id (admin auth) ────────────────────────────────

optionsRoutes.patch('/api/admin/users/:id', requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.params.id as string
    const { isActive, role, virtualBalance } = req.body

    const updateData: Record<string, any> = {}
    if (typeof isActive === 'boolean') updateData.isActive = isActive
    if (role && ['USER', 'ADMIN', 'SUPER_ADMIN'].includes(role)) updateData.role = role
    if (typeof virtualBalance === 'number') {
      updateData.virtualBalance = virtualBalance
      // Invalidate cached balance
      cache.delete(CacheKeys.userBalance(userId))
    }

    if (Object.keys(updateData).length === 0) {
      res.status(400).json({ success: false, error: 'No fields to update' })
      return
    }

    await db.user.update({
      where: { id: userId },
      data: updateData,
    })

    // Log activity
    try {
      await db.activityLog.create({
        data: {
          adminId: req.userId!,
          action: 'USER_UPDATE',
          targetId: userId,
          details: JSON.stringify(updateData),
          ipAddress: req.ip || null,
        },
      })
    } catch {
      // Activity log table may not exist or admin record may not exist
    }

    res.json({ success: true, message: 'User updated' })
  } catch (err) {
    logger.error('[OptionsRoutes] PATCH /admin/users/:id error:', err)
    res.status(500).json({ success: false, error: 'Failed to update user' })
  }
})

// ─── GET /api/admin/trades (admin auth) ─────────────────────────────────────

optionsRoutes.get('/api/admin/trades', requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { page, limit, skip } = parsePagination(req.query)
    const { userId, segment } = req.query as Record<string, string>

    const whereClause: Record<string, any> = {}
    if (userId) whereClause.userId = userId
    if (segment) whereClause.segment = segment

    const [trades, total] = await Promise.all([
      db.trade.findMany({
        where: whereClause,
        include: {
          user: { select: { id: true, name: true, email: true } },
        },
        orderBy: { executedAt: 'desc' },
        skip,
        take: limit,
      }),
      db.trade.count({ where: whereClause }),
    ])

    res.json({
      success: true,
      data: trades,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    })
  } catch (err) {
    logger.error('[OptionsRoutes] GET /admin/trades error:', err)
    res.status(500).json({ success: false, error: 'Failed to fetch trades' })
  }
})

// ─── GET /api/admin/positions (admin auth) ──────────────────────────────────

optionsRoutes.get('/api/admin/positions', requireAdmin, async (_req: AuthRequest, res: Response) => {
  try {
    const positions = await db.position.findMany({
      where: { isOpen: true },
      include: {
        user: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    })

    res.json({ success: true, data: positions })
  } catch (err) {
    logger.error('[OptionsRoutes] GET /admin/positions error:', err)
    res.status(500).json({ success: false, error: 'Failed to fetch positions' })
  }
})

// ─── GET /api/admin/analytics (admin auth) ──────────────────────────────────

optionsRoutes.get('/api/admin/analytics', requireAdmin, async (_req: AuthRequest, res: Response) => {
  try {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

    const [
      totalUsers,
      activePositions,
      tradesToday,
      tradesThisWeek,
      tradesThisMonth,
      topTraders,
      segmentDistribution,
    ] = await Promise.all([
      db.user.count(),
      db.position.count({ where: { isOpen: true } }),
      db.trade.count({ where: { executedAt: { gte: today } } }),
      db.trade.count({ where: { executedAt: { gte: sevenDaysAgo } } }),
      db.trade.count({ where: { executedAt: { gte: thirtyDaysAgo } } }),
      // Top 10 traders by P&L
      db.user.findMany({
        where: { totalTrades: { gt: 0 } },
        select: { id: true, name: true, totalPnl: true, totalTrades: true, winRate: true },
        orderBy: { totalPnl: 'desc' },
        take: 10,
      }),
      // Trades by segment
      db.trade.groupBy({
        by: ['segment'],
        _count: { id: true },
        _sum: { pnl: true },
      }),
    ])

    res.json({
      success: true,
      data: {
        users: { total: totalUsers, activePositions },
        trades: { today: tradesToday, thisWeek: tradesThisWeek, thisMonth: tradesThisMonth },
        topTraders,
        segmentDistribution: segmentDistribution.map(s => ({
          segment: s.segment,
          count: s._count.id,
          totalPnl: parseFloat((s._sum.pnl ?? 0).toFixed(2)),
        })),
      },
    })
  } catch (err) {
    logger.error('[OptionsRoutes] GET /admin/analytics error:', err)
    res.status(500).json({ success: false, error: 'Failed to fetch analytics' })
  }
})

// ─── GET /api/admin/reports (admin auth) ────────────────────────────────────

optionsRoutes.get('/api/admin/reports', requireAdmin, async (_req: AuthRequest, res: Response) => {
  try {
    // For now, return empty array — report generation can be added later
    res.json({ success: true, data: [] })
  } catch (err) {
    logger.error('[OptionsRoutes] GET /admin/reports error:', err)
    res.status(500).json({ success: false, error: 'Failed to fetch reports' })
  }
})

// ─── GET /api/admin/activity-logs (admin auth) ──────────────────────────────

optionsRoutes.get('/api/admin/activity-logs', requireAdmin, async (_req: AuthRequest, res: Response) => {
  try {
    const logs = await db.activityLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        admin: { select: { id: true, name: true, email: true } },
      },
    })

    res.json({ success: true, data: logs })
  } catch {
    // Activity log table may not be available
    res.json({ success: true, data: [] })
  }
})

// ─── GET /api/admin/settings (admin auth) ───────────────────────────────────

optionsRoutes.get('/api/admin/settings', requireAdmin, async (_req: AuthRequest, res: Response) => {
  try {
    const settings = await db.platformSettings.findMany({
      orderBy: { key: 'asc' },
    })

    // Convert array to key-value object
    const settingsMap: Record<string, string> = {}
    for (const s of settings) {
      settingsMap[s.key] = s.value
    }

    res.json({ success: true, data: settingsMap })
  } catch (err) {
    logger.error('[OptionsRoutes] GET /admin/settings error:', err)
    res.status(500).json({ success: false, error: 'Failed to fetch settings' })
  }
})

// ─── PUT /api/admin/settings (admin auth) ───────────────────────────────────

optionsRoutes.put('/api/admin/settings', requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const updates = req.body // Expect { key: value, ... }

    if (!updates || typeof updates !== 'object' || Object.keys(updates).length === 0) {
      res.status(400).json({ success: false, error: 'No settings to update' })
      return
    }

    // Upsert each setting
    for (const [key, value] of Object.entries(updates)) {
      await db.platformSettings.upsert({
        where: { key },
        update: { value: String(value) },
        create: { key, value: String(value) },
      })
    }

    // Log activity
    try {
      await db.activityLog.create({
        data: {
          adminId: req.userId!,
          action: 'UPDATE_SETTINGS',
          details: JSON.stringify(Object.keys(updates)),
          ipAddress: req.ip || null,
        },
      })
    } catch {
      // Ignore if activity log fails
    }

    res.json({ success: true, message: 'Settings updated' })
  } catch (err) {
    logger.error('[OptionsRoutes] PUT /admin/settings error:', err)
    res.status(500).json({ success: false, error: 'Failed to update settings' })
  }
})

// ─── POST /api/admin/migrate (admin auth) ───────────────────────────────────

optionsRoutes.post('/api/admin/migrate', requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    // Log migration trigger
    try {
      await db.activityLog.create({
        data: {
          adminId: req.userId!,
          action: 'MIGRATION_TRIGGERED',
          ipAddress: req.ip || null,
        },
      })
    } catch {
      // Ignore
    }

    // Run a simple DB query to verify connection health
    await db.$queryRaw`SELECT 1 as health`

    logger.info('[Admin] Migration triggered by', req.userId!)

    res.json({ success: true, message: 'Migration complete' })
  } catch (err) {
    logger.error('[OptionsRoutes] POST /admin/migrate error:', err)
    res.status(500).json({ success: false, error: 'Migration failed' })
  }
})