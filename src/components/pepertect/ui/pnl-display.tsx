'use client'

import { cn } from '@/lib/utils'
import { formatINR, formatPercent } from '@/lib/format'

interface PnLDisplayProps {
  value: number
  percent?: number
  showSign?: boolean
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

/**
 * Groww-style P&L display component
 * Shows profit in green with + sign, loss in red with - sign
 * Uses tabular-nums for stable digit widths
 */
export function PnLDisplay({ value, percent, showSign = true, size = 'md', className }: PnLDisplayProps) {
  const colorClass = value > 0 ? 'text-[#00B386]' : value < 0 ? 'text-[#EB5B3C]' : 'text-gray-500'
  
  const sizeClasses = {
    sm: 'text-xs font-semibold',
    md: 'text-sm font-semibold',
    lg: 'text-base font-semibold',
  }

  return (
    <span className={cn('font-tabular price-transition', sizeClasses[size], colorClass, className)}>
      {showSign && value > 0 ? '+' : ''}
      {formatINR(value)}
      {percent !== undefined && (
        <span className="ml-1 opacity-80">({formatPercent(percent)})</span>
      )}
    </span>
  )
}

interface PnLPillProps {
  value: number
  percent?: number
  className?: string
}

export function PnLPill({ value, percent, className }: PnLPillProps) {
  const pillClass = value > 0 ? 'pill-profit' : value < 0 ? 'pill-loss' : 'bg-gray-100 text-gray-500'
  
  return (
    <span className={cn('groww-pill font-tabular', pillClass, className)}>
      {value > 0 ? '+' : value < 0 ? '-' : ''}
      {formatINR(value)}
      {percent !== undefined && (
        <span className="ml-0.5">({formatPercent(percent)})</span>
      )}
    </span>
  )
}

interface PriceDisplayProps {
  value: number
  size?: 'sm' | 'md' | 'lg' | 'xl'
  change?: number
  changePercent?: number
  className?: string
}

export function PriceDisplay({ value, size = 'md', change, changePercent, className }: PriceDisplayProps) {
  const sizeClasses = {
    sm: 'text-sm font-medium',
    md: 'text-base font-semibold',
    lg: 'text-lg font-semibold',
    xl: 'text-xl font-semibold',
  }

  return (
    <div className={cn('flex items-baseline gap-2', className)}>
      <span className={cn('font-tabular', sizeClasses[size])}>
        {formatINR(value)}
      </span>
      {change !== undefined && changePercent !== undefined && (
        <PnLPill value={change} percent={changePercent} />
      )}
    </div>
  )
}
