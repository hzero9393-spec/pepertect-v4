// ─── Expiry Calendar Service ─────────────────────────────────────────────────
// Provides correct expiry dates for NSE/BSE index options.
// Post-2024 rule: NSE indices expire on TUESDAY, BSE SENSEX on THURSDAY.
// Uses hardcoded 2026 calendar (with holiday shifts) + calculated future dates.
// Falls back to Upstox option/contract API if calendar yields nothing.

import { NSE_INDEX_INSTRUMENT_MAP } from './upstox-api'

const CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours

// ─── Types ────────────────────────────────────────────────────────────────

interface ExpiryCache {
  expiries: Record<string, string[]>
  fetchedAt: number
}

// ─── In-Memory Cache ──────────────────────────────────────────────────────

let expiryCache: ExpiryCache | null = null

// ─── Underlying → Instrument Key Mapping ────────────────────────────────────

const UNDERLYING_INSTRUMENT_KEYS: Record<string, string> = {
  NIFTY: NSE_INDEX_INSTRUMENT_MAP.NIFTY || 'NSE_INDEX|Nifty 50',
  BANKNIFTY: NSE_INDEX_INSTRUMENT_MAP.BANKNIFTY || 'NSE_INDEX|Nifty Bank',
  FINNIFTY: NSE_INDEX_INSTRUMENT_MAP.FINNIFTY || 'NSE_INDEX|Nifty Fin Service',
  SENSEX: NSE_INDEX_INSTRUMENT_MAP.SENSEX || 'BSE_INDEX|SENSEX',
}

// ─── 2026 Holiday Calendar ────────────────────────────────────────────────
// Dates on which NSE/BSE are closed. Expiry shifts to previous trading day.

const HOLIDAYS_2026 = new Set([
  '2026-01-15', // Municipal Corp Election
  '2026-01-26', // Republic Day
  '2026-03-03', // Holi
  '2026-03-26', // Shri Ram Navami
  '2026-03-31', // Shri Mahavir Jayanti
  '2026-04-03', // Good Friday
  '2026-04-14', // Dr. Baba Saheb Ambedkar Jayanti
  '2026-05-01', // Maharashtra Day
  '2026-05-28', // Bakri Eid
  '2026-06-26', // Muharram
  '2026-09-14', // Ganesh Chaturthi
  '2026-10-02', // Mahatma Gandhi Jayanti
  '2026-10-20', // Dussehra
  '2026-11-10', // Diwali-Balipratipada
  '2026-11-24', // Guru Nanak Jayanti
  '2026-12-25', // Christmas
])

// ─── Hardcoded 2026 Expiry Calendar ───────────────────────────────────────
// Based on official exchange rules. Includes holiday shifts.

// NIFTY 50 weekly + monthly expiries (all on Tuesday)
const NIFTY_2026 = [
  '2026-01-06','2026-01-13','2026-01-20','2026-01-27',
  '2026-02-03','2026-02-10','2026-02-17','2026-02-24',
  '2026-03-02','2026-03-10','2026-03-17','2026-03-24','2026-03-30',
  '2026-04-07','2026-04-13','2026-04-21','2026-04-28',
  '2026-05-05','2026-05-12','2026-05-19','2026-05-26',
  '2026-06-02','2026-06-09','2026-06-16','2026-06-23','2026-06-30',
  '2026-07-07','2026-07-14','2026-07-21','2026-07-28',
  '2026-08-04','2026-08-11','2026-08-18','2026-08-25',
  '2026-09-01','2026-09-08','2026-09-15','2026-09-22','2026-09-29',
  '2026-10-06','2026-10-13','2026-10-19','2026-10-27',
  '2026-11-03','2026-11-09','2026-11-17','2026-11-23',
  '2026-12-01','2026-12-08','2026-12-15','2026-12-22','2026-12-29',
]

// BANKNIFTY monthly only (last Tuesday of each month)
const BANKNIFTY_2026 = [
  '2026-01-27','2026-02-24','2026-03-30','2026-04-28',
  '2026-05-26','2026-06-30','2026-07-28','2026-08-25',
  '2026-09-29','2026-10-27','2026-11-23','2026-12-29',
]

// FINNIFTY monthly only (last Tuesday of each month)
const FINNIFTY_2026 = [
  '2026-01-27','2026-02-24','2026-03-30','2026-04-28',
  '2026-05-26','2026-06-30','2026-07-28','2026-08-25',
  '2026-09-29','2026-10-27','2026-11-23','2026-12-29',
]

// SENSEX weekly + monthly (all on Thursday)
const SENSEX_2026 = [
  '2026-01-01','2026-01-08','2026-01-14','2026-01-22','2026-01-29',
  '2026-02-05','2026-02-12','2026-02-19','2026-02-26',
  '2026-03-05','2026-03-12','2026-03-19','2026-03-25',
  '2026-04-02','2026-04-09','2026-04-16','2026-04-23','2026-04-30',
  '2026-05-07','2026-05-14','2026-05-21','2026-05-27',
  '2026-06-04','2026-06-11','2026-06-18','2026-06-25',
  '2026-07-02','2026-07-09','2026-07-16','2026-07-23','2026-07-30',
  '2026-08-06','2026-08-13','2026-08-20','2026-08-27',
  '2026-09-03','2026-09-10','2026-09-17','2026-09-24',
  '2026-10-01','2026-10-08','2026-10-15','2026-10-22','2026-10-29',
  '2026-11-05','2026-11-12','2026-11-19','2026-11-26',
  '2026-12-03','2026-12-10','2026-12-17','2026-12-24','2026-12-31',
]

// Calendar lookup: underlying → 2026 dates
const CALENDAR_2026: Record<string, string[]> = {
  NIFTY: NIFTY_2026,
  BANKNIFTY: BANKNIFTY_2026,
  FINNIFTY: FINNIFTY_2026,
  SENSEX: SENSEX_2026,
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function resolveUnderlying(underlying: string): string {
  const upper = underlying.toUpperCase()
  const aliases: Record<string, string> = {
    NIFTY50: 'NIFTY',
    'NIFTY 50': 'NIFTY',
    BANKNIFTY: 'BANKNIFTY',
    'BANK NIFTY': 'BANKNIFTY',
    FINNIFTY: 'FINNIFTY',
    'FIN NIFTY': 'FINNIFTY',
    'NIFTY FIN SERVICE': 'FINNIFTY',
    'NIFTY FINANCIAL SERVICES': 'FINNIFTY',
    SENSEX: 'SENSEX',
  }
  return aliases[upper] || upper
}

/**
 * Generate future expiry dates beyond the hardcoded calendar.
 * NSE indices: every Tuesday / last Tuesday of month
 * BSE SENSEX: every Thursday / last Thursday of month
 */
function generateFutureExpiries(underlying: string, startDate: string): string[] {
  const isBSE = underlying === 'SENSEX'
  const targetDay = isBSE ? 4 : 2 // Thursday=4, Tuesday=2
  const isWeekly = underlying === 'NIFTY' || isBSE // NIFTY and SENSEX have weekly
  const start = new Date(startDate + 'T00:00:00+05:30')
  const results: string[] = []

  // Generate weekly expiries for next 3 months
  if (isWeekly) {
    const d = new Date(start)
    // Find the first target day on or after startDate
    while (d.getDay() !== targetDay) d.setDate(d.getDate() + 1)
    for (let i = 0; i < 15; i++) {
      const dateStr = formatDate(d)
      if (!HOLIDAYS_2026.has(dateStr)) {
        results.push(dateStr)
      }
      d.setDate(d.getDate() + 7)
    }
  }

  // Generate monthly expiries (last target-day of each month) for next 6 months
  const now = new Date()
  for (let m = 0; m < 6; m++) {
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + m + 1, 0)
    while (monthEnd.getDay() !== targetDay) {
      monthEnd.setDate(monthEnd.getDate() - 1)
    }
    const dateStr = formatDate(monthEnd)
    if (dateStr >= startDate && !results.includes(dateStr)) {
      results.push(dateStr)
    }
  }

  return results.sort()
}

function formatDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function todayStr(): string {
  return formatDate(new Date())
}

// ─── Calendar-based Expiry Lookup ─────────────────────────────────────────

function getCalendarExpiries(underlying: string): string[] {
  const calendar = CALENDAR_2026[underlying]
  if (!calendar) return []

  const today = todayStr()
  const valid = calendar.filter(d => d >= today)

  // If we still have dates from calendar, return them
  if (valid.length > 0) {
    return valid
  }

  // Calendar exhausted, generate future dates
  const lastCalDate = calendar[calendar.length - 1]
  const future = generateFutureExpiries(underlying, lastCalDate)
  return future
}

// ─── Fallback: Upstox option/contract API ─────────────────────────────────

async function fetchExpiriesFromAPI(instrumentKey: string): Promise<string[]> {
  const token = process.env.UPSTOX_ACCESS_TOKEN
  if (!token) return []

  try {
    const res = await fetch(
      `https://api.upstox.com/v2/option/contract?instrument_key=${encodeURIComponent(instrumentKey)}`,
      {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(10000),
      }
    )
    if (!res.ok) return []

    const json = await res.json()
    const data: Array<{ expiry: string }> = json?.data || []
    return [...new Set(data.map(d => d.expiry))].sort()
  } catch {
    return []
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Returns sorted expiry dates for a given underlying.
 * Strategy: Calendar-first (instant) → API fallback (slow).
 */
export async function getExpiryDates(underlying: string): Promise<string[]> {
  const canonical = resolveUnderlying(underlying)

  // Check cache first
  if (expiryCache && Date.now() - expiryCache.fetchedAt < CACHE_TTL_MS) {
    const cached = expiryCache.expiries[canonical]
    if (cached && cached.length > 0) {
      return cached
    }
  }

  // 1. Try calendar (instant, no API call)
  const calendarExpiries = getCalendarExpiries(canonical)
  if (calendarExpiries.length > 0) {
    if (!expiryCache) expiryCache = { expiries: {}, fetchedAt: Date.now() }
    expiryCache.expiries[canonical] = calendarExpiries
    return calendarExpiries
  }

  // 2. Fallback: fetch from Upstox API
  const instrumentKey = UNDERLYING_INSTRUMENT_KEYS[canonical]
  if (!instrumentKey) return []

  try {
    const apiExpiries = await fetchExpiriesFromAPI(instrumentKey)
    if (apiExpiries.length > 0) {
      if (!expiryCache) expiryCache = { expiries: {}, fetchedAt: Date.now() }
      expiryCache.expiries[canonical] = apiExpiries
      return apiExpiries
    }
  } catch (err) {
    console.warn(`[ExpiryCalendar] API fallback failed for ${canonical}:`, err)
  }

  // Return stale cache if available
  return expiryCache?.expiries[canonical] || []
}

/**
 * Forces a refresh of the expiry cache.
 */
export function invalidateInstrumentsCache(): void {
  expiryCache = null
}

/**
 * Returns the instrument key for a given underlying.
 */
export function getUnderlyingInstrumentKey(underlying: string): string | null {
  const canonical = resolveUnderlying(underlying)
  return UNDERLYING_INSTRUMENT_KEYS[canonical] || null
}