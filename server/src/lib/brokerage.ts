// ─── Brokerage Calculator ───────────────────────────────────────────────────

export function calculateBrokerage(totalValue: number): number {
  const brokeragePercent = parseFloat(process.env.BROKERAGE_PERCENT || '0.0005')
  const minBrokerage = parseFloat(process.env.MIN_BROKERAGE || '20')
  const maxBrokerage = parseFloat(process.env.MAX_BROKERAGE || '500')
  const calculated = totalValue * brokeragePercent
  return Math.max(minBrokerage, Math.min(maxBrokerage, Math.round(calculated * 100) / 100))
}