/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Pepertect V4 — WebSocket + REST Backend Server
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Architecture:
 *   ┌──────────────┐         ┌──────────────────────────────────┐
 *   │  Vercel      │  WS +   │  Render/Railway Server           │
 *   │  (frontend)  │◄───────►│  ┌────────┐  ┌──────────────┐  │
 *   │              │  REST   │  │ Express│  │ WebSocket Srv │  │
 *   │  Static SPA  │         │  │ Router │  │  + Channels   │  │
 *   └──────────────┘         │  └───┬────┘  └──────┬───────┘  │
 *                            │      │              │          │
 *                            │  ┌───┴──────────────┴───────┐  │
 *                            │  │  Background Services     │  │
 *                            │  │  ├─ MarketDataManager     │  │
 *                            │  │  ├─ AutoExitWorker       │  │
 *                            │  │  ├─ OptionChainManager   │  │
 *                            │  │  └─ PositionStreamer     │  │
 *                            │  └──────────────────────────┘  │
 *                            │           │                     │
 *                            │     ┌─────┴─────┐               │
 *                            │     │ PostgreSQL│ (Supabase)    │
 *                            │     └───────────┘               │
 *                            └──────────────────────────────────┘
 *
 * WebSocket Channels:
 *   market          → Indices + stock prices (broadcast to all)
 *   positions       → Per-user position updates (sent to specific user)
 *   oc:SYMBOL::DATE → Option chain data (broadcast to channel subscribers)
 */

import 'dotenv/config'
import http from 'node:http'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import compression from 'compression'
import { WebSocketServer } from 'ws'
import { config, isDev } from './config.js'
import { logger } from './lib/logger.js'
import { PepertectWebSocketServer, type ChannelEvent } from './ws/WebSocketServer.js'
import { getMarketDataManager } from './services/market-data-manager.js'
import { getAutoExitWorker, type ExitEvent } from './services/auto-exit-worker.js'
import { getOptionChainManager } from './services/option-chain-manager.js'
import { getPositionStreamer } from './services/position-streamer.js'
import { db } from './lib/db.js'
import { errorHandler, notFoundHandler } from './lib/error-handler.js'
import { rateLimit } from './lib/rate-limiter.js'

// ─── REST Route Imports ──────────────────────────────────────────────

import { authRoutes } from './http/auth.routes.js'
import { tradeRoutes } from './http/trade.routes.js'
import { marketRoutes } from './http/market.routes.js'
import { optionsRoutes } from './http/options.routes.js'

// ─── Express App ────────────────────────────────────────────────────

const app = express()

// Security & compression
app.use(helmet({ contentSecurityPolicy: false }))
app.use(cors({ origin: config.corsOrigin.split(','), credentials: true }))
app.use(compression())
app.use(express.json({ limit: '1mb' }))

// Request logging (dev only)
if (isDev) {
  app.use((req, _res, next) => {
    logger.debug(`[HTTP] ${req.method} ${req.path}`)
    next()
  })
}

// ─── Health & Debug ─────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: Math.floor(process.uptime()), timestamp: new Date().toISOString() })
})

app.get('/ws-stats', (_req, res) => {
  res.json(wsServer?.getStats() || { error: 'WS not initialized' })
})

// ─── REST API Routes ────────────────────────────────────────────────

app.use('/api/auth', authRoutes)
app.use('/api/trade', tradeRoutes)
app.use('/api', marketRoutes)        // /api/market/*, /api/sectors, /api/indices, /api/stocks/*
app.use('/api', optionsRoutes)       // /api/options/*, /api/futures/*, /api/profile/*, /api/admin/*, etc.

// ─── Error Handling ─────────────────────────────────────────────────

app.use(notFoundHandler)
app.use(errorHandler)

// ─── HTTP + WebSocket Server ────────────────────────────────────────

const server = http.createServer(app)

const wss = new WebSocketServer({ server, path: config.wsPath })
let wsServer: PepertectWebSocketServer | null = null
let positionStreamer: ReturnType<typeof getPositionStreamer> | null = null

// ─── OC Channel Management ──────────────────────────────────────────
// Track which OC channels are being subscribed to.
// Format: "oc:NIFTY::2026-07-07"

const ocChannelUnsubs = new Map<string, () => void>() // channel → unsubscribe fn
const VALID_OC_UNDERLYINGS = new Set(['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'SENSEX'])

function startOCStream(channel: string) {
  // Parse "oc:NIFTY::2026-07-07"
  const parts = channel.split('::')
  if (parts.length !== 2 || !parts[0].startsWith('oc:')) return

  const underlying = parts[0].slice(3).toUpperCase()
  const expiry = parts[1]
  if (!VALID_OC_UNDERLYINGS.has(underlying)) return

  // Already streaming this channel
  if (ocChannelUnsubs.has(channel)) return

  const ocManager = getOptionChainManager()
  const unsub = ocManager.subscribe(underlying, expiry, (update) => {
    // Broadcast OC update to all subscribers of this channel
    wsServer!.broadcast(channel, {
      type: 'oc:update',
      data: update,
    })
  })

  ocChannelUnsubs.set(channel, unsub)
  logger.info(`[OC] Started streaming ${channel}`)
}

function stopOCStream(channel: string) {
  const unsub = ocChannelUnsubs.get(channel)
  if (unsub) {
    unsub()
    ocChannelUnsubs.delete(channel)
    logger.info(`[OC] Stopped streaming ${channel}`)
  }
}

// ─── Position Channel Tracking ──────────────────────────────────────
// Track how many clients per user are subscribed to "positions" channel.

const userPositionSubCount = new Map<string, number>() // userId → subscriber count

// ─── Initialize Services ────────────────────────────────────────────

async function initializeServices() {
  logger.info('Initializing Pepertect V4 server...')

  // 1. Database connection test
  try {
    await db.$connect()
    logger.info('Database connected')
  } catch (err) {
    logger.error('Database connection failed:', err)
    process.exit(1)
  }

  // 2. WebSocket Server
  wsServer = new PepertectWebSocketServer(wss)
  logger.info(`WebSocket server ready on ${config.wsPath}`)

  // 3. Channel subscription hooks — route subscribe events to services
  wsServer.onChannelChange((event: ChannelEvent) => {
    const { action, channel, userId } = event

    // ── Positions channel: start/stop per-user position polling ──
    if (channel === 'positions') {
      if (action === 'subscribe') {
        const count = (userPositionSubCount.get(userId) || 0) + 1
        userPositionSubCount.set(userId, count)
        if (count === 1) {
          // First subscriber for this user — start streaming
          positionStreamer!.addUser(userId)
        }
      } else {
        const count = (userPositionSubCount.get(userId) || 1) - 1
        if (count <= 0) {
          userPositionSubCount.delete(userId)
          positionStreamer!.removeUser(userId)
        } else {
          userPositionSubCount.set(userId, count)
        }
      }
      return
    }

    // ── Option Chain channels: start/stop OC polling ──
    if (channel.startsWith('oc:')) {
      if (action === 'subscribe') {
        // Check if this is the first subscriber
        const stats = wsServer!.getStats()
        const subCount = stats.channels[channel] || 0
        if (subCount <= 1) {
          startOCStream(channel)
        }
      } else {
        // Check if no subscribers remain
        const stats = wsServer!.getStats()
        const subCount = stats.channels[channel] || 0
        if (subCount <= 0) {
          stopOCStream(channel)
        }
      }
    }
  })

  // 4. Market Data Manager — fetches from Yahoo/Upstox, broadcasts to all WS clients
  const mdm = getMarketDataManager()
  await mdm.initialize()
  mdm.onUpdate((update) => {
    // Broadcast indices to all 'market' subscribers
    if (update.indices && Object.keys(update.indices).length > 0) {
      wsServer!.broadcast('market', {
        type: 'market:indices',
        data: update.indices,
      })
    }
    // Broadcast stocks to all 'market' subscribers
    if (update.stocks && Object.keys(update.stocks).length > 0) {
      wsServer!.broadcast('market', {
        type: 'market:stocks',
        data: update.stocks,
      })
    }
  })
  logger.info('MarketDataManager initialized')

  // 5. Auto-Exit Worker — monitors SL/Target, pushes exit events via WS
  const aew = getAutoExitWorker()
  aew.onExit((event: ExitEvent) => {
    // Send position exit event to the specific user
    wsServer!.sendToUser(event.userId, {
      type: 'positions:exit',
      data: {
        positionId: event.positionId,
        symbol: event.symbol,
        segment: event.segment,
        reason: event.reason,
        exitPrice: event.exitPrice,
        pnl: event.pnl,
        tradeDirection: event.tradeDirection,
        timestamp: event.timestamp,
      },
    })
    logger.info(`[AutoExit] ${event.reason} triggered for ${event.symbol} (${event.userId})`)
  })
  aew.ensureRunning()
  logger.info('AutoExitWorker initialized')

  // 6. Position Streamer — polls DB, pushes position updates via WS
  positionStreamer = getPositionStreamer(wsServer)
  logger.info('PositionStreamer initialized')

  // 7. Option Chain Manager — ready for on-demand subscriptions
  // (Does NOT start polling until a client subscribes to an oc: channel)
  logger.info('OptionChainManager ready (on-demand)')

  // 8. Start HTTP server
  server.listen(config.port, () => {
    logger.info('═══════════════════════════════════════════════════')
    logger.info(`  Pepertect V4 Server Running`)
    logger.info(`  REST API:    http://localhost:${config.port}/api`)
    logger.info(`  WebSocket:   ws://localhost:${config.port}${config.wsPath}`)
    logger.info(`  Health:      http://localhost:${config.port}/health`)
    logger.info(`  WS Stats:    http://localhost:${config.port}/ws-stats`)
    logger.info(`  CORS Origin: ${config.corsOrigin}`)
    logger.info(`  Environment: ${config.nodeEnv}`)
    logger.info('═══════════════════════════════════════════════════')
  })
}

// ─── Graceful Shutdown ──────────────────────────────────────────────

async function shutdown(signal: string) {
  logger.info(`Received ${signal}, shutting down gracefully...`)

  // Stop OC streams
  for (const [channel] of ocChannelUnsubs) {
    stopOCStream(channel)
  }

  // Destroy position streamer
  positionStreamer?.destroy()

  // Destroy WebSocket server
  wsServer?.destroy()

  // Disconnect database
  try {
    await db.$disconnect()
    logger.info('Database disconnected')
  } catch {}

  // Close HTTP server
  server.close(() => {
    logger.info('HTTP server closed')
    process.exit(0)
  })

  // Force exit after 10s
  setTimeout(() => process.exit(1), 10_000)
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

// Unhandled rejection protection
process.on('unhandledRejection', (reason) => {
  logger.error('[FATAL] Unhandled rejection:', reason)
})

// ─── Start ─────────────────────────────────────────────────────────

initializeServices().catch((err) => {
  logger.error('Failed to initialize:', err)
  process.exit(1)
})