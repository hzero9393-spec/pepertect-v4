import { Request, Response, NextFunction } from 'express'
import { logger } from './logger.js'

export function errorHandler(err: Error, req: Request, res: Response, next: NextFunction) {
  logger.error(`[HTTP] ${req.method} ${req.path}: ${err.message}`)

  // Prisma unique constraint error
  if (err.message.includes('Unique constraint')) {
    return res.status(409).json({ error: 'A record with this value already exists' })
  }

  res.status(500).json({ error: 'Internal server error' })
}

// 404 handler for unmatched routes
export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found` })
}