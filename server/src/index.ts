/**
 * Pepertect V4 — WebSocket + REST Backend Server
 *
 * Architecture:
 * - Express server for REST API
 * - WebSocket server for real-time data (market, positions, OC)
 * - Background services: MarketDataManager, AutoExitWorker, OptionChainManager
 * - Single process handles all users (no per-user serverless functions)
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
import { PepertectWebSocketServer } from './ws/WebSocketServer.js'
import { getMarketDataManager } from './services/market-data-manager.js'
import { getAutoExitWorker, type ExitEvent } from './services/auto-exit-worker.js'
import { db } from './lib/db.js'

// ─── Express App ──────────────────────────────────────────────────────

const app = express()

app.use(helmet({ contentSecurityPolicy: false }))
app.use(cors({ origin: config.corsOrigin.split(','), credentials: true }))
app.use(compression())
app.use(express.json())

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() })
})

// WS stats (debug)
app.get('/ws-stats', (req, res) => {
  res.json(wsServer?.getStats() || { error: 'WS not initialized' })
})

// ─── REST API Routes ──────────────────────────────────────────────────
// (Routes will be added incrementally — WS is the priority)

// Auth routes placeholder
app.post('/api/auth/login', async (req, res) => {
  // TODO: implement
  res.status(501).json({ success: false, error: 'API routes to be migrated' })
})

app.get('/api/auth/me', async (req, res) => {
  // TODO: implement
  res.status(501).json({ success: false, error: 'API routes to be migrated' })
})

// ─── HTTP + WebSocket Server ──────────────────────────────────────────

const server = http.createServer(app)

const wss = new WebSocketServer({ server, path: config.wsPath })
let wsServer: PepertectWebSocketServer | null = null

// ─── Initialize Services ─────────────────────────────────────────────

async function initializeServices() {
  logger.info('Initializing services...')

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

  // 3. Market Data Manager — fetches from Upstox/Yahoo, broadcasts to all WS clients
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

  // 4. Auto-Exit Worker — monitors SL/Target, pushes exit events via WS
  const aew = getAutoExitWorker()
  aew.onExit((event: ExitEvent) => {
    // Send position update to the specific user
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

  // 5. Start HTTP server
  server.listen(config.port, () => {
    logger.info(`Server running on port ${config.port}`)
    logger.info(`WebSocket endpoint: ws://localhost:${config.port}${config.wsPath}`)
    logger.info(`CORS origin: ${config.corsOrigin}`)
    logger.info(`Environment: ${config.nodeEnv}`)
  })
}

// ─── Graceful Shutdown ────────────────────────────────────────────────

async function shutdown(signal: string) {
  logger.info(`Received ${signal}, shutting down gracefully...`)

  wsServer?.destroy()

  try {
    await db.$disconnect()
    logger.info('Database disconnected')
  } catch {}

  server.close(() => {
    logger.info('HTTP server closed')
    process.exit(0)
  })

  setTimeout(() => process.exit(1), 10_000)
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

// ─── Start ───────────────────────────────────────────────────────────

initializeServices().catch((err) => {
  logger.error('Failed to initialize:', err)
  process.exit(1)
})