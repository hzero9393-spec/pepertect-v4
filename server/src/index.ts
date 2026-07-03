/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Pepertect V4 — WebSocket Server Entry Point
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Express + WebSocket server for real-time market data streaming.
 * Designed for deployment on Render/Railway (persistent Node.js process).
 *
 * Endpoints:
 *   GET  /api/health          — Health check
 *   GET  /api/market/status   — Market open/close status
 *   GET  /api/sectors         — Sector data (5min cache)
 *   GET  /api/market/holidays — Market holidays
 *   GET  /api/user/balance    — User balance (auth required)
 *   GET  /api/options/expiries — Option expiry dates
 *   WS   /ws                  — WebSocket connection (auth required)
 */

import 'dotenv/config'
import express from 'express'
import { createServer } from 'http'
import { WebSocketServer } from 'ws'
import cors from 'cors'
import apiRoutes from './api/routes'
import { WebSocketManager } from './ws/wsManager'

const PORT = parseInt(process.env.PORT || '3000', 10)

// ─── Express App ──────────────────────────────────────────────────────

const app = express()
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}))
app.use(express.json())

// REST API routes
app.use('/api', apiRoutes)

// ─── HTTP Server + WebSocket ──────────────────────────────────────────

const server = createServer(app)

const wss = new WebSocketServer({
  server,
  path: '/ws',
  maxPayload: 1024 * 1024, // 1MB max message size
})

// ─── Initialize WebSocket Manager ─────────────────────────────────────

const wsManager = new WebSocketManager(wss)

// Wire services together
const marketService = (wsManager as any).marketService
const autoExitService = (wsManager as any).autoExitService
const positionsService = (wsManager as any).positionsService

if (autoExitService && marketService) {
  autoExitService.setMarketService(marketService)
}
if (positionsService && marketService) {
  positionsService.setServices(marketService, (wsManager as any).optionChainService)
}

// ─── Stats endpoint ───────────────────────────────────────────────────

app.get('/api/ws-stats', (_req, res) => {
  res.json({ success: true, data: wsManager.getStats() })
})

// ─── Graceful Shutdown ────────────────────────────────────────────────

async function shutdown(signal: string) {
  console.log(`\n[${signal}] Shutting down gracefully...`)
  await wsManager.shutdown()
  server.close(() => {
    console.log('Server closed')
    process.exit(0)
  })
  // Force exit after 10s
  setTimeout(() => process.exit(1), 10000)
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

// ─── Start Server ─────────────────────────────────────────────────────

server.listen(PORT, () => {
  console.log('════════════════════════════════════════════════════════')
  console.log(`  Pepertect V4 WebSocket Server`)
  console.log(`  REST API:  http://localhost:${PORT}/api`)
  console.log(`  WebSocket: ws://localhost:${PORT}/ws`)
  console.log(`  Env:       ${process.env.NODE_ENV || 'development'}`)
  console.log('════════════════════════════════════════════════════════')
})