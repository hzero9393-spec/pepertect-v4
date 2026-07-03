// ─── Expiry Calendar Service ─────────────────────────────────────────────────
// Provides correct expiry dates for NSE/BSE index options.
// Post-2024 rule: NSE indices expire on TUESDAY, BSE SENSEX on THURSDAY.
// Uses hardcoded 2026 calendar + calculated future dates.

const HOLIDAYS_2026 = new Set([
  '2026-01-15', '2026-01-26', '2026-03-03', '2026-03-26', '2026-03-31',
  '2026-04-03', '2026-04-14', '2026-05-01', '2026-05-28', '2026-06-26',
  '2026-09-14', '2026-10-02', '2026-10-20', '2026-11-10', '2026-11-24',
  '2026-12-25',
])

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

const BANKNIFTY_2026 = [
  '2026-01-27','2026-02-24','2026-03-30','2026-04-28',
  '2026-05-26','2026-06-30','2026-07-28','2026-08-25',
  '2026-09-29','2026-10-27','2026-11-23','2026-12-29',
]

const FINNIFTY_2026 = [
  '2026-01-27','2026-02-24','2026-03-30','2026-04-28',
  '2026-05-26','2026-06-30','2026-07-28','2026-08-25',
  '2026-09-29','2026-10-27','2026-11-23','2026-12-29',
]

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

const CALENDAR_2026: Record<string, string[]> = {
  NIFTY: NIFTY_2026,
  BANKNIFTY: BANKNIFTY_2026,
  FINNIFTY: FINNIFTY_2026,
  SENSEX: SENSEX_2026,
}

function resolveUnderlying(underlying: string): string {
  const upper = underlying.toUpperCase()
  const aliases: Record<string, string> = {
    NIFTY50: 'NIFTY', 'NIFTY 50': 'NIFTY',
    'BANK NIFTY': 'BANKNIFTY', 'FIN NIFTY': 'FINNIFTY',
    'NIFTY FIN SERVICE': 'FINNIFTY', 'NIFTY FINANCIAL SERVICES': 'FINNIFTY',
  }
  return aliases[upper] || upper
}

function formatDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function generateFutureExpiries(underlying: string, startDate: string): string[] {
  const isBSE = underlying === 'SENSEX'
  const targetDay = isBSE ? 4 : 2
  const isWeekly = underlying === 'NIFTY' || isBSE
  const start = new Date(startDate + 'T00:00:00+05:30')
  const results: string[] = []

  if (isWeekly) {
    const d = new Date(start)
    while (d.getDay() !== targetDay) d.setDate(d.getDate() + 1)
    for (let i = 0; i < 15; i++) {
      const dateStr = formatDate(d)
      if (!HOLIDAYS_2026.has(dateStr)) results.push(dateStr)
      d.setDate(d.getDate() + 7)
    }
  }

  const now = new Date()
  for (let m = 0; m < 6; m++) {
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + m + 1, 0)
    while (monthEnd.getDay() !== targetDay) monthEnd.setDate(monthEnd.getDate() - 1)
    const dateStr = formatDate(monthEnd)
    if (dateStr >= startDate && !results.includes(dateStr)) results.push(dateStr)
  }

  return results.sort()
}

export function getExpiryDates(underlying: string): string[] {
  const canonical = resolveUnderlying(underlying)
  const calendar = CALENDAR_2026[canonical]
  if (!calendar) return []

  const today = formatDate(new Date(
    Date.now() + 5.5 * 60 * 60 * 1000 + new Date().getTimezoneOffset() * 60000
  ))
  const valid = calendar.filter(d => d >= today)

  if (valid.length > 0) return valid

  const lastCalDate = calendar[calendar.length - 1]
  return generateFutureExpiries(canonical, lastCalDate)
}