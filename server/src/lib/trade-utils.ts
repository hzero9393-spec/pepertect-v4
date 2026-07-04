import { db } from './db.js'
import { config } from '../config.js'

/**
 * Calculate brokerage for Indian stock market paper trading.
 * Uses config values for brokerage settings.
 * Default: 0.05% of total value, min ₹20, max ₹500
 */
export function calculateBrokerage(totalValue: number): number {
  const calculated = totalValue * config.brokeragePercent
  return Math.max(config.minBrokerage, Math.min(config.maxBrokerage, Math.round(calculated * 100) / 100))
}

/**
 * Check if the Indian stock market is currently open.
 * Returns market status info or null if check fails.
 */
export async function checkMarketStatus(): Promise<{
  isOpen: boolean
  status: 'OPEN' | 'CLOSED' | 'PRE-OPEN' | 'POST-CLOSE'
  message: string
}> {
  try {
    // Get current IST time
    const now = new Date()
    const istOffset = 5.5 * 60 * 60 * 1000
    const istNow = new Date(now.getTime() + istOffset + now.getTimezoneOffset() * 60000)

    const hours = istNow.getHours()
    const minutes = istNow.getMinutes()
    const day = istNow.getDay()
    const timeInMinutes = hours * 60 + minutes

    // Weekend check
    if (day === 0 || day === 6) {
      return {
        isOpen: false,
        status: 'CLOSED',
        message: day === 0 ? 'Market closed - Sunday' : 'Market closed - Saturday',
      }
    }

    // Check for market holidays
    const todayStr = istNow.toISOString().split('T')[0]
    const holiday = await db.marketHoliday.findFirst({
      where: { date: new Date(todayStr) },
    })

    if (holiday && !holiday.isMuhurat) {
      return {
        isOpen: false,
        status: 'CLOSED',
        message: `Market closed - ${holiday.name}`,
      }
    }

    // Normal trading hours: 9:15 - 15:30 IST
    if (timeInMinutes >= 555 && timeInMinutes < 930) {
      return {
        isOpen: true,
        status: 'OPEN',
        message: 'Market is open (9:15 - 15:30 IST)',
      }
    }

    // Pre-open: 9:00 - 9:15 IST
    if (timeInMinutes >= 540 && timeInMinutes < 555) {
      return {
        isOpen: false,
        status: 'PRE-OPEN',
        message: 'Pre-open session (9:00 - 9:15 IST). Trading starts at 9:15 IST.',
      }
    }

    // After market hours
    return {
      isOpen: false,
      status: 'CLOSED',
      message: timeInMinutes < 540
        ? 'Market opens at 9:00 IST (Pre-open session)'
        : 'Market closed for the day',
    }
  } catch (error) {
    console.error('[Market Status Check] Error:', error)
    // If check fails, allow trading (fail-open for demo mode)
    return {
      isOpen: true,
      status: 'OPEN',
      message: 'Market status check unavailable - trading allowed',
    }
  }
}

/**
 * Validate order quantity against max allowed volume.
 */
export function validateOrderQuantity(quantity: number): string | null {
  if (quantity <= 0 || !Number.isInteger(quantity)) {
    return 'Quantity must be a positive integer.'
  }

  if (quantity > config.maxOrderVolume) {
    return `Quantity exceeds maximum allowed (${config.maxOrderVolume}).`
  }

  return null // valid
}

/**
 * Get margin percentage for a segment from config.
 */
export function getMarginPercent(segment: string): number {
  if (segment === 'FUTURES') {
    return config.futuresMarginPercent
  }
  if (segment === 'OPTIONS') {
    return config.optionsShortMarginPercent
  }
  return 100 // EQUITY - full amount
}