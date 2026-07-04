'use client'

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useAuthStore } from '@/lib/auth-store'
import { useAppStore } from '@/lib/store'
import { formatINR, formatINRWhole, formatPrice } from '@/lib/format'
import { useTradeSuccess } from '@/components/pepertect/trade-success-popup'
import { TradeConfirmModal, TradeConfirmData } from '@/components/pepertect/ui/trade-confirm-modal'
import { StrikeOverviewDrawer } from '@/components/pepertect/ui/strike-overview-drawer'
import { X, Minus, Plus, ChevronDown, TrendingUp, TrendingDown, Activity, BarChart3, Zap, ArrowUpDown, Target } from 'lucide-react'
import { MarketDataSocket } from '@/hooks/use-market-data'
import type { WsOptionChainUpdate } from '@/hooks/use-market-data'

// ─── Types ──────────────────────────────────────────────────────────────────

interface OCStrike {
  strike_price: number
  underlying_spot_price: number
  call_options: {
    instrument_key: string
    market_data: {
      ltp: number; volume: number; oi: number; close_price: number
      bid_price: number; bid_qty: number; ask_price: number; ask_qty: number; prev_oi: number
    }
    option_greeks: { iv: number; delta: number; theta: number; vega: number; gamma: number; pop: number }
  }
  put_options: {
    instrument_key: string
    market_data: {
      ltp: number; volume: number; oi: number; close_price: number
      bid_price: number; bid_qty: number; ask_price: number; ask_qty: number; prev_oi: number
    }
    option_greeks: { iv: number; delta: number; theta: number; vega: number; gamma: number; pop: number }
  }
}

interface OCUpdate {
  underlying: string
  spot: number
  pcr: number
  expiry: string
  strikes: OCStrike[]
  timestamp: number
  totalCallOI: number
  totalPutOI: number
  maxPainStrike: number
}

type Underlying = 'NIFTY' | 'BANKNIFTY' | 'FINNIFTY' | 'SENSEX'
type ViewMode = 'LTP' | 'OI'

const INDICES: { key: Underlying; label: string; lotSize: number }[] = [
  { key: 'NIFTY', label: 'NIFTY 50', lotSize: 65 },
  { key: 'BANKNIFTY', label: 'BANKNIFTY', lotSize: 30 },
  { key: 'FINNIFTY', label: 'FINNIFTY', lotSize: 60 },
  { key: 'SENSEX', label: 'SENSEX', lotSize: 15 },
]

// ─── Helpers ────────────────────────────────────────────────────────────────

function fmtExpiry(d: string) {
  const dt = new Date(d + 'T00:00:00+05:30')
  return dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
}

function fmtOI(n: number): string {
  if (n >= 10000000) return (n / 10000000).toFixed(2) + 'Cr'
  if (n >= 100000) return (n / 100000).toFixed(2) + 'L'
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K'
  return String(n)
}

function fmtLtp(n: number): string {
  if (n <= 0) return '-'
  if (n < 10) return n.toFixed(2)
  return n.toFixed(1)
}

function fmtChg(ltp: number, close: number): { text: string; up: boolean | null } {
  if (ltp <= 0 || close <= 0) return { text: '-', up: null }
  const chg = ltp - close
  const pct = (chg / close) * 100
  const sign = chg >= 0 ? '+' : ''
  return { text: `${sign}${pct.toFixed(1)}%`, up: chg >= 0 }
}

function fmtSpread(ce: number, pe: number): number {
  return Math.abs(ce - pe)
}

// ─── Trade Panel State ─────────────────────────────────────────────────────

interface TradeState {
  open: boolean
  side: 'BUY' | 'SELL'
  optionType: 'CE' | 'PE'
  strike: number
  ltp: number
  lots: number
  orderType: 'MARKET' | 'LIMIT'
  productType: 'INTRADAY' | 'DELIVERY'
  limitPrice: string
  stopLoss: string
  target: string
}

const defaultTrade: TradeState = {
  open: false, side: 'BUY', optionType: 'CE', strike: 0, ltp: 0,
  lots: 1, orderType: 'MARKET', productType: 'INTRADAY', limitPrice: '',
  stopLoss: '', target: '',
}

// ─── Professional Color System ──────────────────────────────────────────────

const C = {
  bg: '#0a0e17',
  surface: '#111827',
  surfaceAlt: '#1a2236',
  surfaceHover: '#1e2a42',
  cardBg: '#151d2e',
  text: '#e8eaed',
  textSec: '#9aa5b4',
  textMuted: '#6b7a8d',
  border: '#1e293b',
  borderLight: '#1a2332',
  borderAccent: '#2a3650',
  green: '#22c55e',
  greenBright: '#4ade80',
  greenBg: 'rgba(34,197,94,0.08)',
  greenBgStrong: 'rgba(34,197,94,0.15)',
  red: '#ef4444',
  redBright: '#f87171',
  redBg: 'rgba(239,68,68,0.08)',
  redBgStrong: 'rgba(239,68,68,0.15)',
  primary: '#00D09C',
  primaryBg: 'rgba(0,208,156,0.1)',
  primaryDim: 'rgba(0,208,156,0.06)',
  atmBg: 'rgba(0,208,156,0.07)',
  atmBorder: 'rgba(0,208,156,0.3)',
  headerBg: '#0d1320',
  spotBadge: '#1e3a5f',
  spotBadgeBorder: '#2563eb',
  greenDim: 'rgba(34,197,94,0.03)',
  redDim: 'rgba(239,68,68,0.03)',
  gold: '#fbbf24',
  blue: '#3b82f6',
  purple: '#a78bfa',
}

// ─── Main Component ─────────────────────────────────────────────────────────

export function OptionChainPage() {
  const [index, setIndex] = useState<Underlying>('NIFTY')
  const [expiries, setExpiries] = useState<string[]>([])
  const [expiry, setExpiry] = useState('')
  const [data, setData] = useState<OCUpdate | null>(null)
  const [live, setLive] = useState(false)
  const [loading, setLoading] = useState(true)
  const [ocError, setOcError] = useState<'upstox_token' | 'timeout' | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('LTP')
  const tableBodyRef = useRef<HTMLDivElement>(null)
  const scrollTargetRef = useRef<string>('')

  const [trade, setTrade] = useState<TradeState>(defaultTrade)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmData, setConfirmData] = useState<TradeConfirmData | null>(null)

  // Strike overview state
  const [strikeOverview, setStrikeOverview] = useState<{
    underlying: string
    strike: number
    optionType: 'CE' | 'PE'
    instrumentKey: string
  } | null>(null)

  const token = useAuthStore(s => s.token)
  const userData = useAuthStore(s => s.user)
  const setUser = useAuthStore(s => s.setUser)
  const bumpTradeSignal = useAppStore(s => s.bumpTradeSignal)
  const { showTradeSuccess } = useTradeSuccess()

  const lotSize = INDICES.find(i => i.key === index)?.lotSize || 50
  const availableMargin = userData ? (userData.virtualBalance - (userData.marginUsed || 0)) : 0

  // Fetch expiries
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setData(null)
    setExpiry('')

    fetch(`/api/options/expiries/${index}`)
      .then(r => r.json())
      .then(json => {
        if (cancelled) return
        const all: string[] = json?.data?.expiries || []
        const today = new Date().toISOString().split('T')[0]
        const upcoming = all.filter(e => e >= today)
        const list = upcoming.slice(0, 4)
        setExpiries(list)
        if (list.length > 0) setExpiry(list[0])
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
  }, [index])

  // Option chain via WebSocket
  useEffect(() => {
    if (!expiry) return

    // Reset data for clean state on expiry/index change
    setData(null)
    setLive(false)

    const manager = MarketDataSocket.getInstance()
    manager.connect()

    // Subscribe to options channel via WS
    manager.subscribeOptionChain(index, expiry)

    // Listen for updates
    const unsub = manager.onOptionChainUpdate(index, (update: WsOptionChainUpdate) => {
      if (update.underlying !== index) return
      if (expiry && update.expiry !== expiry) return

      // Transform WS format to component format
      const transformedStrikes = update.chain.map(s => ({
        strike_price: s.strikePrice,
        underlying_spot_price: update.spot,
        call_options: {
          instrument_key: '',
          market_data: {
            ltp: s.ce?.ltp ?? 0,
            volume: s.ce?.volume ?? 0,
            oi: s.ce?.oi ?? 0,
            close_price: (s.ce?.ltp ?? 0) - (s.ce?.change ?? 0),
            bid_price: s.ce?.bidPrice ?? 0,
            bid_qty: 0,
            ask_price: s.ce?.askPrice ?? 0,
            ask_qty: 0,
            prev_oi: (s.ce?.oi ?? 0) - (s.ce?.oiChange ?? 0),
          },
          option_greeks: {
            iv: s.ce?.iv ?? 0,
            delta: s.ce?.delta ?? 0,
            theta: 0, vega: 0, gamma: 0, pop: 0,
          },
        },
        put_options: {
          instrument_key: '',
          market_data: {
            ltp: s.pe?.ltp ?? 0,
            volume: s.pe?.volume ?? 0,
            oi: s.pe?.oi ?? 0,
            close_price: (s.pe?.ltp ?? 0) - (s.pe?.change ?? 0),
            bid_price: s.pe?.bidPrice ?? 0,
            bid_qty: 0,
            ask_price: s.pe?.askPrice ?? 0,
            ask_qty: 0,
            prev_oi: (s.pe?.oi ?? 0) - (s.pe?.oiChange ?? 0),
          },
          option_greeks: {
            iv: s.pe?.iv ?? 0,
            delta: s.pe?.delta ?? 0,
            theta: 0, vega: 0, gamma: 0, pop: 0,
          },
        },
      }))

      setData({
        underlying: update.underlying,
        spot: update.spot,
        pcr: update.pcr,
        expiry: update.expiry,
        strikes: transformedStrikes,
        timestamp: update.timestamp,
        totalCallOI: 0,
        totalPutOI: 0,
        maxPainStrike: update.maxPain,
      } as any)
      setOcError(null)
      setLoading(false)
      setLive(true)
    })

    // Keep the initial REST fetch as fallback (one-time, no interval)
    setLoading(true)
    fetch(`/api/options/chain?underlying=${index}&expiry=${expiry}`)
      .then(res => res.json())
      .then(json => {
        if (json?.success && json?.data?.strikes?.length > 0) {
          setData(json.data)
          setOcError(null)
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))

    return () => {
      unsub()
      manager.unsubscribeOptionChain(index, expiry)
      setLive(false)
    }
  }, [index, expiry])

  // Auto-scroll to ATM strike when data loads (fires on every index/expiry change)
  useEffect(() => {
    if (!data || !tableBodyRef.current) return
    const targetKey = `${index}-${expiry}-${data.spot}`
    if (scrollTargetRef.current === targetKey) return
    scrollTargetRef.current = targetKey

    requestAnimationFrame(() => {
      const el = tableBodyRef.current?.querySelector('[data-atm="true"]') as HTMLElement | null
      if (el) {
        const container = tableBodyRef.current!
        const containerRect = container.getBoundingClientRect()
        const elRect = el.getBoundingClientRect()
        const scrollOffset = el.offsetTop - container.offsetTop - (containerRect.height / 2) + (elRect.height / 2)
        container.scrollTo({ top: Math.max(0, scrollOffset), behavior: 'smooth' })
      }
    })
  }, [data?.strikes?.length, index, expiry])

  // Filter strikes around spot
  const strikes = useMemo(() => {
    if (!data?.strikes?.length) return []
    return data.strikes.filter(s => Math.abs(s.strike_price - data.spot) <= 2000)
  }, [data?.strikes, data?.spot])

  // ATM strike
  const atm = useMemo(() => {
    if (!data?.strikes?.length || !data.spot) return 0
    let best = data.strikes[0].strike_price
    let minD = Math.abs(best - data.spot)
    for (const s of data.strikes) {
      const d = Math.abs(s.strike_price - data.spot)
      if (d < minD) { minD = d; best = s.strike_price }
    }
    return best
  }, [data?.strikes, data?.spot])

  // Spot change
  const spotChange = useMemo(() => {
    if (!data) return null
    const first = strikes[0]
    if (!first?.call_options?.market_data) return null
    return data.spot - first.call_options.market_data.close_price
  }, [data, strikes])

  // Max OI for bar calculation
  const maxOI = useMemo(() => {
    let m = 0
    for (const s of strikes) {
      const ceOI = s.call_options?.market_data?.oi || 0
      const peOI = s.put_options?.market_data?.oi || 0
      m = Math.max(m, ceOI, peOI)
    }
    return m || 1
  }, [strikes])

  // Spread at ATM
  const atmSpread = useMemo(() => {
    if (!data) return 0
    const atmStrike = data.strikes.find(s => s.strike_price === atm)
    if (!atmStrike) return 0
    const ceLtp = atmStrike.call_options?.market_data?.ltp || 0
    const peLtp = atmStrike.put_options?.market_data?.ltp || 0
    return ceLtp + peLtp
  }, [data, atm])

  // ── Trade Logic ──

  const openTrade = useCallback((optionType: 'CE' | 'PE', strike: number, ltp: number, side: 'BUY' | 'SELL') => {
    setTrade({
      ...defaultTrade,
      open: true,
      side,
      optionType,
      strike,
      ltp: ltp > 0 ? ltp : 0,
    })
  }, [])

  const totalQty = trade.lots * lotSize
  const fillPrice = trade.orderType === 'LIMIT' && trade.limitPrice
    ? parseFloat(trade.limitPrice) || 0
    : trade.ltp
  const totalValue = totalQty * fillPrice
  const brokerage = totalValue > 0 ? Math.max(20, Math.min(500, totalValue * 0.0005)) : 0

  const handleConfirm = useCallback(async () => {
    if (!token || fillPrice <= 0) return

    // Refresh user data to get latest marginUsed before showing confirm
    let freshAvailable = availableMargin
    try {
      const meRes = await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } })
      if (meRes.ok) {
        const meData = await meRes.json()
        if (meData.user) {
          setUser(meData.user)
          freshAvailable = meData.user.virtualBalance - (meData.user.marginUsed || 0)
        }
      }
    } catch {}

    setConfirmData({
      symbol: index,
      direction: trade.side,
      segment: 'OPTIONS',
      productType: trade.productType,
      orderType: trade.orderType,
      quantity: totalQty,
      price: fillPrice,
      totalValue: Math.round(totalValue * 100) / 100,
      brokerage: Math.round(brokerage * 100) / 100,
      availableBalance: freshAvailable,
      optionType: trade.optionType,
      strikePrice: trade.strike,
      lots: trade.lots,
      lotSize,
      expiryDate: expiry,
    })
    setConfirmOpen(true)
  }, [token, trade, fillPrice, totalQty, totalValue, brokerage, lotSize, index, expiry, availableMargin, setUser])

  const executeTrade = useCallback(async () => {
    if (!token) return { success: false, error: 'Not logged in' }

    const body: Record<string, unknown> = {
      symbol: index,
      direction: trade.side,
      orderType: trade.orderType,
      segment: 'OPTIONS',
      productType: trade.productType,
      quantity: totalQty,
      optionType: trade.optionType,
      strikePrice: trade.strike,
      lots: trade.lots,
      lotSize,
      expiryDate: expiry,
      ltp: trade.ltp,
    }

    if (trade.orderType === 'LIMIT' && trade.limitPrice) {
      body.price = parseFloat(trade.limitPrice)
    }

    // Pass SL/Target to backend
    if (trade.stopLoss) body.stopLoss = parseFloat(trade.stopLoss)
    if (trade.target) body.target = parseFloat(trade.target)

    try {
      const res = await fetch('/api/trade/place', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      const resData = await res.json()

      if (res.ok && resData.success) {
        showTradeSuccess({
          symbol: `${index} ${trade.strike} ${trade.optionType}`,
          type: trade.side,
          qty: totalQty,
          price: fillPrice,
          time: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }).toUpperCase(),
          orderId: resData.order?.id?.slice(-8).toUpperCase() || 'N/A',
          segment: 'OPTIONS',
          optionType: trade.optionType,
          strikePrice: trade.strike,
          totalValue: resData.order?.totalValue,
          brokerage: resData.order?.brokerage,
        })
        bumpTradeSignal()
        if (resData.balance !== undefined && userData) {
          setUser({ ...userData, virtualBalance: resData.balance, totalPnl: resData.totalPnl ?? userData.totalPnl })
          fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } })
            .then(r => r.ok ? r.json() : null)
            .then(d => { if (d?.user) setUser(d.user) })
            .catch(() => {})
        }
        if ((trade.stopLoss || trade.target) && token && resData.order?.id) {
          const slBody: Record<string, unknown> = { stopLoss: null, target: null }
          if (trade.stopLoss) slBody.stopLoss = parseFloat(trade.stopLoss)
          if (trade.target) slBody.target = parseFloat(trade.target)
          fetch('/api/trade/sl-set', {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ positionId: resData.positionId, ...slBody }),
          }).catch(() => {})
        }
        setTrade(defaultTrade)
        return { success: true }
      } else {
        return { success: false, error: resData.error || 'Trade failed' }
      }
    } catch {
      return { success: false, error: 'Network error' }
    }
  }, [token, trade, fillPrice, totalQty, lotSize, index, expiry, showTradeSuccess, userData, setUser])

  const isLTP = viewMode === 'LTP'

  // ── Column definitions for grid ──
  // LTP mode:  CE_LTP | CE_CHG | STRIKE | SPREAD | PE_CHG | PE_LTP
  // OI mode:   CE_OI  | CE_OICHG | STRIKE | SPREAD | PE_OICHG | PE_OI

  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 92px)', background: C.bg }}>

      {/* ═══ INDEX TABS ═══ */}
      <div className="shrink-0" style={{ background: C.headerBg, borderBottom: `1px solid ${C.border}` }}>
        <div className="flex items-center px-3 pt-2 pb-0 gap-1">
          {INDICES.map(ind => (
            <button
              key={ind.key}
              onClick={() => setIndex(ind.key)}
              className="relative px-4 py-2.5 text-[12px] font-semibold tracking-wide transition-all duration-200 rounded-t-lg"
              style={{
                color: index === ind.key ? C.primary : C.textMuted,
                background: index === ind.key ? C.surface : 'transparent',
              }}
            >
              {ind.label}
              {index === ind.key && (
                <span
                  className="absolute bottom-0 left-2 right-2 h-[2.5px] rounded-t-full"
                  style={{ background: `linear-gradient(90deg, ${C.primary}, ${C.greenBright})` }}
                />
              )}
            </button>
          ))}
          <div className="ml-auto pr-1 flex items-center gap-2">
            {live && (
              <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold tracking-wider" style={{ background: C.primaryBg, color: C.primary }}>
                <span className="w-1.5 h-1.5 rounded-full animate-live-pulse" style={{ background: C.primary, boxShadow: `0 0 6px ${C.primary}` }} />
                LIVE
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ═══ MARKET INFO BAR ═══ */}
      {data && (
        <div
          className="shrink-0 px-3 py-2 flex items-center gap-2 overflow-x-auto no-scrollbar"
          style={{ background: C.surface, borderBottom: `1px solid ${C.border}` }}
        >
          {/* Spot Price */}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg" style={{ background: C.surfaceAlt }}>
            <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: C.textMuted }}>Spot</span>
            <span className="text-[14px] font-bold" style={{ color: C.text, fontVariantNumeric: 'tabular-nums' }}>
              {formatPrice(data.spot)}
            </span>
            {spotChange !== null && spotChange !== 0 && (
              <span className="flex items-center gap-0.5 text-[11px] font-semibold px-1.5 py-0.5 rounded" style={{ color: spotChange > 0 ? C.green : C.red, background: spotChange > 0 ? C.greenBg : C.redBg }}>
                {spotChange > 0 ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}
                {spotChange > 0 ? '+' : ''}{formatPrice(Math.abs(spotChange))}
              </span>
            )}
          </div>

          {/* PCR */}
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg" style={{ background: C.surfaceAlt }}>
            <Activity className="size-3.5" style={{ color: C.textMuted }} />
            <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: C.textMuted }}>PCR</span>
            <span className="text-[12px] font-bold" style={{ color: data.pcr > 1 ? C.green : data.pcr < 0.8 ? C.red : C.text, fontVariantNumeric: 'tabular-nums' }}>
              {data.pcr > 0 ? data.pcr.toFixed(2) : '-'}
            </span>
          </div>

          {/* Max Pain */}
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg" style={{ background: C.surfaceAlt }}>
            <Target className="size-3.5" style={{ color: C.gold }} />
            <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: C.textMuted }}>Max Pain</span>
            <span className="text-[12px] font-bold" style={{ color: C.gold, fontVariantNumeric: 'tabular-nums' }}>
              {data.maxPainStrike > 0 ? formatINRWhole(data.maxPainStrike) : '-'}
            </span>
          </div>

          {/* ATM Straddle */}
          {atmSpread > 0 && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg" style={{ background: C.surfaceAlt }}>
              <ArrowUpDown className="size-3.5" style={{ color: C.purple }} />
              <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: C.textMuted }}>Straddle</span>
              <span className="text-[12px] font-bold" style={{ color: C.purple, fontVariantNumeric: 'tabular-nums' }}>
                {atmSpread.toFixed(1)}
              </span>
            </div>
          )}

          {/* Lot Size */}
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg ml-auto" style={{ background: C.surfaceAlt }}>
            <BarChart3 className="size-3.5" style={{ color: C.textMuted }} />
            <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: C.textMuted }}>Lot</span>
            <span className="text-[12px] font-bold" style={{ color: C.text }}>{lotSize}</span>
          </div>
        </div>
      )}

      {/* ═══ EXPIRY BAR + VIEW TOGGLE ═══ */}
      <div className="shrink-0 flex items-center" style={{ background: C.surface, borderBottom: `1px solid ${C.border}` }}>
        <div className="flex items-center overflow-x-auto no-scrollbar px-3 py-1.5 gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider mr-1" style={{ color: C.textMuted }}>Expiry</span>
          {expiries.map(e => (
            <button
              key={e}
              onClick={() => setExpiry(e)}
              className="px-3 py-1.5 text-[11px] font-semibold rounded-md transition-all duration-200 whitespace-nowrap"
              style={{
                color: expiry === e ? C.text : C.textMuted,
                background: expiry === e ? C.primaryBg : 'transparent',
                border: expiry === e ? `1px solid rgba(0,208,156,0.3)` : '1px solid transparent',
              }}
            >
              {fmtExpiry(e)}
            </button>
          ))}
        </div>
        <div className="ml-auto pr-3 shrink-0">
          <div className="inline-flex rounded-lg overflow-hidden" style={{ border: `1px solid ${C.border}` }}>
            {(['LTP', 'OI'] as ViewMode[]).map((mode, i) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className="px-3.5 py-1.5 text-[10px] font-bold tracking-wider transition-all duration-200"
                style={{
                  background: viewMode === mode ? C.primary : 'transparent',
                  color: viewMode === mode ? '#fff' : C.textMuted,
                  borderRight: i === 0 ? `1px solid ${C.border}` : 'none',
                }}
              >
                {mode}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ═══ OPTION CHAIN TABLE ═══ */}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden px-1 pt-1 pb-1">

        {loading ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="flex flex-col items-center gap-3">
              <div className="w-8 h-8 border-2 rounded-full animate-spin" style={{ borderColor: C.border, borderTopColor: C.primary }} />
              <span className="text-[12px] font-medium" style={{ color: C.textMuted }}>Loading option chain...</span>
            </div>
          </div>
        ) : strikes.length > 0 ? (
          <div className="flex-1 min-h-0 flex flex-col rounded-xl overflow-hidden" style={{ border: `1px solid ${C.border}`, background: C.surface }}>

            {/* ── Sticky Header ── */}
            <div className="shrink-0 sticky top-0 z-10" style={{ background: C.headerBg, borderBottom: `2px solid ${C.border}` }}>
              {isLTP ? (
                <>
                  {/* Top header row: CE label | columns | PE label */}
                  <div
                    className="grid items-center text-[10px] font-bold uppercase tracking-wider"
                    style={{
                      gridTemplateColumns: '1fr 48px 68px 64px 48px 1fr',
                      color: C.textMuted,
                    }}
                  >
                    <div className="flex items-center justify-end gap-2 pr-3 border-r" style={{ borderColor: C.border }}>
                      <span style={{ color: C.green }}>CE</span>
                      <span>LTP</span>
                    </div>
                    <div className="flex items-center justify-center border-r" style={{ borderColor: C.border }}>
                      Chg
                    </div>
                    <div className="flex items-center justify-center border-r" style={{ borderColor: C.border }}>
                      <span style={{ color: C.text }}>STRIKE</span>
                    </div>
                    <div className="flex items-center justify-center border-r" style={{ borderColor: C.border }}>
                      <span style={{ color: C.gold }}>SPREAD</span>
                    </div>
                    <div className="flex items-center justify-center border-r" style={{ borderColor: C.border }}>
                      Chg
                    </div>
                    <div className="flex items-center pl-3 gap-2">
                      <span>LTP</span>
                      <span style={{ color: C.red }}>PE</span>
                    </div>
                  </div>
                  {/* Sub-header with OI hint */}
                  <div
                    className="grid items-center text-[9px] font-semibold"
                    style={{
                      gridTemplateColumns: '1fr 48px 68px 64px 48px 1fr',
                      borderBottom: `1px solid ${C.border}`,
                    }}
                  >
                    <div className="flex items-center justify-end pr-3 border-r py-1" style={{ borderColor: C.border, color: C.green, background: C.greenDim, opacity: 0.6 }}>
                      OI →
                    </div>
                    <div className="border-r" style={{ borderColor: C.border }} />
                    <div className="border-r" style={{ borderColor: C.border }} />
                    <div className="border-r" style={{ borderColor: C.border }} />
                    <div className="border-r" style={{ borderColor: C.border }} />
                    <div className="flex items-center pl-3 py-1" style={{ color: C.red, background: C.redDim, opacity: 0.6 }}>
                      ← OI
                    </div>
                  </div>
                </>
              ) : (
                <div
                  className="grid items-center text-[10px] font-bold uppercase tracking-wider"
                  style={{
                    gridTemplateColumns: '1fr 48px 68px 64px 48px 1fr',
                    color: C.textMuted,
                  }}
                >
                  <div className="flex items-center justify-end gap-2 pr-3 border-r" style={{ borderColor: C.border }}>
                    <span style={{ color: C.green }}>CE</span>
                    <span>OI</span>
                  </div>
                  <div className="flex items-center justify-center border-r" style={{ borderColor: C.border }}>
                    Chg
                  </div>
                  <div className="flex items-center justify-center border-r" style={{ borderColor: C.border }}>
                    <span style={{ color: C.text }}>STRIKE</span>
                  </div>
                  <div className="flex items-center justify-center border-r" style={{ borderColor: C.border }}>
                    <span style={{ color: C.gold }}>SPREAD</span>
                  </div>
                  <div className="flex items-center justify-center border-r" style={{ borderColor: C.border }}>
                    Chg
                  </div>
                  <div className="flex items-center pl-3 gap-2">
                    <span>OI</span>
                    <span style={{ color: C.red }}>PE</span>
                  </div>
                </div>
              )}
            </div>

            {/* ── Scrollable Body ── */}
            <div ref={tableBodyRef} className="flex-1 overflow-y-auto custom-scrollbar">
              {strikes.map((s, idx) => {
                const ce = s.call_options?.market_data
                const pe = s.put_options?.market_data
                const isATM = s.strike_price === atm
                const ceITM = s.strike_price < data!.spot
                const peITM = s.strike_price > data!.spot
                const showSpotBadge = idx > 0 && s.strike_price >= data!.spot && strikes[idx - 1].strike_price < data!.spot
                const straddle = isATM && ce && pe ? ce.ltp + pe.ltp : 0
                const spread = (ce && pe) ? fmtSpread(ce.ltp, pe.ltp) : 0

                // OI bar widths (percentage of max OI)
                const ceOIWidth = maxOI > 0 ? ((ce?.oi || 0) / maxOI) * 100 : 0
                const peOIWidth = maxOI > 0 ? ((pe?.oi || 0) / maxOI) * 100 : 0

                if (!ce || !pe) return null

                if (isLTP) {
                  const ceChg = fmtChg(ce.ltp, ce.close_price)
                  const peChg = fmtChg(pe.ltp, pe.close_price)

                  return (
                    <React.Fragment key={s.strike_price}>
                      {/* Spot Price Divider */}
                      {showSpotBadge && (
                        <div
                          data-spot-badge="true"
                          className="grid items-center"
                          style={{ gridTemplateColumns: '1fr 48px 68px 64px 48px 1fr', height: '28px', borderBottom: `1px solid ${C.border}` }}
                        >
                          <div className="border-r" style={{ borderColor: C.border, background: C.greenDim }} />
                          <div className="border-r" style={{ borderColor: C.border }} />
                          <div
                            className="flex items-center justify-center gap-1.5"
                            style={{ borderRight: `1px solid ${C.border}`, background: C.spotBadge }}
                          >
                            <Zap className="size-3" style={{ color: C.blue }} />
                            <span className="text-[10px] font-bold" style={{ color: C.blue, fontVariantNumeric: 'tabular-nums' }}>
                              {data!.spot.toFixed(2)}
                            </span>
                          </div>
                          <div className="border-r" style={{ borderColor: C.border }} />
                          <div className="border-r" style={{ borderColor: C.border }} />
                          <div style={{ background: C.redDim }} />
                        </div>
                      )}

                      {/* Row */}
                      <div
                        data-atm={isATM ? 'true' : undefined}
                        className="grid items-center transition-all duration-100 cursor-pointer group relative"
                        style={{
                          gridTemplateColumns: '1fr 48px 68px 64px 48px 1fr',
                          height: isATM ? '46px' : '38px',
                          borderBottom: `1px solid ${isATM ? C.atmBorder : C.borderLight}`,
                          background: isATM ? C.atmBg : 'transparent',
                        }}
                        onMouseEnter={e => { if (!isATM) e.currentTarget.style.background = C.surfaceHover }}
                        onMouseLeave={e => { if (!isATM) e.currentTarget.style.background = 'transparent' }}
                        onClick={() => {
                          if (ce.oi >= pe.oi) openTrade('CE', s.strike_price, ce.ltp, 'BUY')
                          else openTrade('PE', s.strike_price, pe.ltp, 'BUY')
                        }}
                      >
                        {/* CE LTP */}
                        <div
                          className="flex items-center justify-end pr-3 border-r relative overflow-hidden"
                          style={{ borderColor: C.border, background: ceITM && !isATM ? C.greenBg : 'transparent' }}
                        >
                          {/* OI background bar */}
                          {ceOIWidth > 0 && (
                            <div
                              className="absolute right-0 top-0 bottom-0 opacity-20"
                              style={{
                                width: `${ceOIWidth}%`,
                                background: `linear-gradient(270deg, ${C.green} 0%, transparent 100%)`,
                                transition: 'width 0.3s ease',
                              }}
                            />
                          )}
                          <span
                            className="text-[12px] font-bold relative z-10"
                            style={{ color: C.text, fontVariantNumeric: 'tabular-nums' }}
                            onClick={(e) => { e.stopPropagation(); setStrikeOverview({ underlying: index, strike: s.strike_price, optionType: 'CE', instrumentKey: s.call_options?.instrument_key || '' }) }}
                          >
                            {fmtLtp(ce.ltp)}
                          </span>
                        </div>

                        {/* CE Chg */}
                        <div
                          className="flex items-center justify-center border-r text-[10px] font-semibold relative z-10"
                          style={{ borderColor: C.border, color: ceChg.up === true ? C.green : ceChg.up === false ? C.red : C.textMuted, fontVariantNumeric: 'tabular-nums' }}
                        >
                          {ceChg.text}
                        </div>

                        {/* Strike */}
                        <div
                          className="flex flex-col items-center justify-center border-r relative z-10"
                          style={{ borderColor: C.border, background: isATM ? C.primaryBg : 'transparent' }}
                        >
                          <span
                            className="text-[12px] font-extrabold"
                            style={{ color: isATM ? C.primary : C.text, fontVariantNumeric: 'tabular-nums' }}
                          >
                            {formatINRWhole(s.strike_price)}
                          </span>
                          {isATM && (
                            <span className="text-[8px] font-bold mt-px tracking-wider" style={{ color: C.primary }}>
                              ATM
                            </span>
                          )}
                        </div>

                        {/* Spread */}
                        <div
                          className="flex items-center justify-center border-r relative z-10"
                          style={{ borderColor: C.border, background: isATM ? 'rgba(251,191,36,0.06)' : 'transparent' }}
                        >
                          {spread > 0 ? (
                            <span className="text-[11px] font-bold px-1.5 py-0.5 rounded" style={{ color: C.gold, background: 'rgba(251,191,36,0.1)', fontVariantNumeric: 'tabular-nums' }}>
                              {spread.toFixed(1)}
                            </span>
                          ) : (
                            <span className="text-[11px]" style={{ color: C.textMuted }}>-</span>
                          )}
                        </div>

                        {/* PE Chg */}
                        <div
                          className="flex items-center justify-center border-r text-[10px] font-semibold relative z-10"
                          style={{ borderColor: C.border, color: peChg.up === true ? C.green : peChg.up === false ? C.red : C.textMuted, fontVariantNumeric: 'tabular-nums' }}
                        >
                          {peChg.text}
                        </div>

                        {/* PE LTP */}
                        <div
                          className="flex items-center pl-3 relative overflow-hidden"
                          style={{ background: peITM && !isATM ? C.redBg : 'transparent' }}
                        >
                          {/* OI background bar */}
                          {peOIWidth > 0 && (
                            <div
                              className="absolute left-0 top-0 bottom-0 opacity-20"
                              style={{
                                width: `${peOIWidth}%`,
                                background: `linear-gradient(90deg, ${C.red} 0%, transparent 100%)`,
                                transition: 'width 0.3s ease',
                              }}
                            />
                          )}
                          <span
                            className="text-[12px] font-bold relative z-10"
                            style={{ color: C.text, fontVariantNumeric: 'tabular-nums' }}
                            onClick={(e) => { e.stopPropagation(); setStrikeOverview({ underlying: index, strike: s.strike_price, optionType: 'PE', instrumentKey: s.put_options?.instrument_key || '' }) }}
                          >
                            {fmtLtp(pe.ltp)}
                          </span>
                        </div>
                      </div>
                    </React.Fragment>
                  )
                } else {
                  // OI Mode
                  const ceOI = ce.oi || 0
                  const peOI = pe.oi || 0
                  const ceOIChg = ce.prev_oi > 0 ? ce.oi - ce.prev_oi : 0
                  const peOIChg = pe.prev_oi > 0 ? pe.oi - pe.prev_oi : 0

                  return (
                    <React.Fragment key={s.strike_price}>
                      {showSpotBadge && (
                        <div
                          data-spot-badge="true"
                          className="grid items-center"
                          style={{ gridTemplateColumns: '1fr 48px 68px 64px 48px 1fr', height: '28px', borderBottom: `1px solid ${C.border}` }}
                        >
                          <div className="border-r" style={{ borderColor: C.border, background: C.greenDim }} />
                          <div className="border-r" style={{ borderColor: C.border }} />
                          <div
                            className="flex items-center justify-center gap-1.5"
                            style={{ borderRight: `1px solid ${C.border}`, background: C.spotBadge }}
                          >
                            <Zap className="size-3" style={{ color: C.blue }} />
                            <span className="text-[10px] font-bold" style={{ color: C.blue, fontVariantNumeric: 'tabular-nums' }}>
                              {data!.spot.toFixed(2)}
                            </span>
                          </div>
                          <div className="border-r" style={{ borderColor: C.border }} />
                          <div className="border-r" style={{ borderColor: C.border }} />
                          <div style={{ background: C.redDim }} />
                        </div>
                      )}

                      <div
                        data-atm={isATM ? 'true' : undefined}
                        className="grid items-center transition-all duration-100 cursor-pointer group relative"
                        style={{
                          gridTemplateColumns: '1fr 48px 68px 64px 48px 1fr',
                          height: isATM ? '46px' : '38px',
                          borderBottom: `1px solid ${isATM ? C.atmBorder : C.borderLight}`,
                          background: isATM ? C.atmBg : 'transparent',
                        }}
                        onMouseEnter={e => { if (!isATM) e.currentTarget.style.background = C.surfaceHover }}
                        onMouseLeave={e => { if (!isATM) e.currentTarget.style.background = 'transparent' }}
                        onClick={() => {
                          if (ce.oi >= pe.oi) openTrade('CE', s.strike_price, ce.ltp, 'BUY')
                          else openTrade('PE', s.strike_price, pe.ltp, 'BUY')
                        }}
                      >
                        {/* CE OI */}
                        <div
                          className="flex items-center justify-end pr-3 border-r relative overflow-hidden"
                          style={{ borderColor: C.border, background: ceITM && !isATM ? C.greenBg : 'transparent' }}
                        >
                          {ceOIWidth > 0 && (
                            <div
                              className="absolute right-0 top-0 bottom-0 opacity-25"
                              style={{
                                width: `${ceOIWidth}%`,
                                background: `linear-gradient(270deg, ${C.green} 0%, transparent 100%)`,
                                transition: 'width 0.3s ease',
                              }}
                            />
                          )}
                          <span className="text-[11px] font-bold relative z-10" style={{ color: C.text, fontVariantNumeric: 'tabular-nums' }}>
                            {ceOI > 0 ? fmtOI(ceOI) : '-'}
                          </span>
                        </div>

                        {/* CE OI Chg */}
                        <div
                          className="flex items-center justify-center border-r text-[10px] font-semibold relative z-10"
                          style={{
                            borderColor: C.border,
                            color: ceOIChg > 0 ? C.green : ceOIChg < 0 ? C.red : C.textMuted,
                            fontVariantNumeric: 'tabular-nums',
                          }}
                        >
                          {ceOIChg !== 0 ? `${ceOIChg > 0 ? '+' : ''}${fmtOI(Math.abs(ceOIChg))}` : '-'}
                        </div>

                        {/* Strike */}
                        <div
                          className="flex flex-col items-center justify-center border-r relative z-10"
                          style={{ borderColor: C.border, background: isATM ? C.primaryBg : 'transparent' }}
                        >
                          <span
                            className="text-[12px] font-extrabold"
                            style={{ color: isATM ? C.primary : C.text, fontVariantNumeric: 'tabular-nums' }}
                          >
                            {formatINRWhole(s.strike_price)}
                          </span>
                          {isATM && (
                            <span className="text-[8px] font-bold mt-px tracking-wider" style={{ color: C.primary }}>ATM</span>
                          )}
                        </div>

                        {/* Spread */}
                        <div
                          className="flex items-center justify-center border-r relative z-10"
                          style={{ borderColor: C.border, background: isATM ? 'rgba(251,191,36,0.06)' : 'transparent' }}
                        >
                          {spread > 0 ? (
                            <span className="text-[11px] font-bold px-1.5 py-0.5 rounded" style={{ color: C.gold, background: 'rgba(251,191,36,0.1)', fontVariantNumeric: 'tabular-nums' }}>
                              {spread.toFixed(1)}
                            </span>
                          ) : (
                            <span className="text-[11px]" style={{ color: C.textMuted }}>-</span>
                          )}
                        </div>

                        {/* PE OI Chg */}
                        <div
                          className="flex items-center justify-center border-r text-[10px] font-semibold relative z-10"
                          style={{
                            borderColor: C.border,
                            color: peOIChg > 0 ? C.green : peOIChg < 0 ? C.red : C.textMuted,
                            fontVariantNumeric: 'tabular-nums',
                          }}
                        >
                          {peOIChg !== 0 ? `${peOIChg > 0 ? '+' : ''}${fmtOI(Math.abs(peOIChg))}` : '-'}
                        </div>

                        {/* PE OI */}
                        <div
                          className="flex items-center pl-3 relative overflow-hidden"
                          style={{ background: peITM && !isATM ? C.redBg : 'transparent' }}
                        >
                          {peOIWidth > 0 && (
                            <div
                              className="absolute left-0 top-0 bottom-0 opacity-25"
                              style={{
                                width: `${peOIWidth}%`,
                                background: `linear-gradient(90deg, ${C.red} 0%, transparent 100%)`,
                                transition: 'width 0.3s ease',
                              }}
                            />
                          )}
                          <span className="text-[11px] font-bold relative z-10" style={{ color: C.text, fontVariantNumeric: 'tabular-nums' }}>
                            {peOI > 0 ? fmtOI(peOI) : '-'}
                          </span>
                        </div>
                      </div>
                    </React.Fragment>
                  )
                }
              })}

              {/* ── Legend ── */}
              <div
                className="shrink-0 flex items-center justify-center gap-5 py-2 px-3"
                style={{ background: C.headerBg, borderTop: `1px solid ${C.border}` }}
              >
                <span className="flex items-center gap-1.5 text-[9px] font-medium" style={{ color: C.textMuted }}>
                  <span className="w-2 h-2 rounded-sm" style={{ background: C.green }} />
                  Calls (ITM)
                </span>
                <span className="flex items-center gap-1.5 text-[9px] font-medium" style={{ color: C.textMuted }}>
                  <span className="w-2 h-2 rounded-sm" style={{ background: C.red }} />
                  Puts (ITM)
                </span>
                <span className="flex items-center gap-1.5 text-[9px] font-medium" style={{ color: C.textMuted }}>
                  <span className="w-2 h-2 rounded-sm" style={{ background: C.gold }} />
                  Spread
                </span>
                <span className="flex items-center gap-1.5 text-[9px] font-medium" style={{ color: C.textMuted }}>
                  <span className="w-2 h-2 rounded-sm" style={{ background: `linear-gradient(270deg, ${C.green}, transparent)`, opacity: 0.5 }} />
                  OI Bars
                </span>
              </div>
            </div>
          </div>
        ) : ocError ? (
          <div className="flex-1 flex items-center justify-center p-6">
            <div className="text-center max-w-sm p-6 rounded-xl" style={{ background: C.surface, border: `1px solid ${C.border}` }}>
              <div className="text-[32px] mb-3">&#9888;&#65039;</div>
              <div className="text-[14px] font-bold mb-2" style={{ color: C.text }}>
                {ocError === 'upstox_token' ? 'Upstox Token Required' : 'Data Not Available'}
              </div>
              <div className="text-[12px] leading-relaxed" style={{ color: C.textSec }}>
                {ocError === 'upstox_token'
                  ? 'Option chain data requires a valid Upstox access token. Please connect your Upstox account or set the token via admin settings.'
                  : 'Could not load option chain data. This may be due to a network issue or the data source is unavailable. Please try again.'}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <span className="text-[12px]" style={{ color: C.textMuted }}>
              {live ? 'No data for this expiry' : 'Connecting...'}
            </span>
          </div>
        )}
      </div>

      {/* ═══ Trade Panel (Bottom Sheet) ═══ */}
      {trade.open && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setTrade(defaultTrade)} />
          <div className="absolute bottom-0 left-0 right-0 rounded-t-2xl shadow-2xl max-h-[85vh] overflow-y-auto" style={{ background: C.surface, borderTop: `1px solid ${C.border}` }}>
            <div className="flex justify-center pt-2 pb-1">
              <div className="w-10 h-1 rounded-full" style={{ background: C.borderAccent }} />
            </div>

            <div className="flex items-center justify-between px-5 pb-3 border-b" style={{ borderColor: C.border }}>
              <div>
                <p className="text-sm font-bold" style={{ color: C.text }}>
                  {index} {trade.strike} {trade.optionType}
                </p>
                <p className="text-[11px] mt-0.5" style={{ color: C.textSec }}>
                  {fmtExpiry(expiry)} &middot; Lot: {lotSize} &middot; LTP: {formatINR(trade.ltp)}
                </p>
              </div>
              <button onClick={() => setTrade(defaultTrade)} className="p-1.5 rounded-full transition-colors" style={{ color: C.textSec }}
                onMouseEnter={e => e.currentTarget.style.background = C.surfaceAlt}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                <X className="size-5" />
              </button>
            </div>

            <div className="px-5 py-4 space-y-4">
              {/* Buy / Sell Toggle */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setTrade(t => ({ ...t, side: 'BUY' }))}
                  className="py-2.5 rounded-lg text-sm font-bold transition-all duration-200"
                  style={{
                    background: trade.side === 'BUY' ? C.green : C.surfaceAlt,
                    color: trade.side === 'BUY' ? '#fff' : C.textSec,
                    border: trade.side === 'BUY' ? `1px solid ${C.green}` : `1px solid ${C.border}`,
                  }}
                >
                  BUY {trade.optionType}
                </button>
                <button
                  onClick={() => setTrade(t => ({ ...t, side: 'SELL' }))}
                  className="py-2.5 rounded-lg text-sm font-bold transition-all duration-200"
                  style={{
                    background: trade.side === 'SELL' ? C.red : C.surfaceAlt,
                    color: trade.side === 'SELL' ? '#fff' : C.textSec,
                    border: trade.side === 'SELL' ? `1px solid ${C.red}` : `1px solid ${C.border}`,
                  }}
                >
                  SELL {trade.optionType}
                </button>
              </div>

              {/* Order Type + Product */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: C.textMuted }}>Order Type</label>
                  <div className="relative mt-1">
                    <select
                      value={trade.orderType}
                      onChange={e => setTrade(t => ({ ...t, orderType: e.target.value as 'MARKET' | 'LIMIT' }))}
                      className="w-full px-3 py-2.5 rounded-lg text-sm font-medium appearance-none pr-8"
                      style={{ background: C.surfaceAlt, borderColor: C.border, color: C.text, border: `1px solid ${C.border}` }}
                    >
                      <option value="MARKET">Market</option>
                      <option value="LIMIT">Limit</option>
                    </select>
                    <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 size-4 pointer-events-none mt-0.5" style={{ color: C.textMuted }} />
                  </div>
                </div>
                <div>
                  <label className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: C.textMuted }}>Product</label>
                  <div className="relative mt-1">
                    <select
                      value={trade.productType}
                      onChange={e => setTrade(t => ({ ...t, productType: e.target.value as 'INTRADAY' | 'DELIVERY' }))}
                      className="w-full px-3 py-2.5 rounded-lg text-sm font-medium appearance-none pr-8"
                      style={{ background: C.surfaceAlt, borderColor: C.border, color: C.text, border: `1px solid ${C.border}` }}
                    >
                      <option value="INTRADAY">Intraday</option>
                      <option value="DELIVERY">Delivery</option>
                    </select>
                    <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 size-4 pointer-events-none mt-0.5" style={{ color: C.textMuted }} />
                  </div>
                </div>
              </div>

              {/* Limit Price */}
              {trade.orderType === 'LIMIT' && (
                <div>
                  <label className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: C.textMuted }}>Limit Price</label>
                  <input
                    type="number"
                    value={trade.limitPrice}
                    onChange={e => setTrade(t => ({ ...t, limitPrice: e.target.value }))}
                    placeholder={String(trade.ltp)}
                    className="w-full mt-1 px-3 py-2.5 rounded-lg text-sm font-mono"
                    style={{ background: C.surfaceAlt, border: `1px solid ${C.border}`, color: C.text }}
                    step="0.05"
                  />
                </div>
              )}

              {/* Quantity */}
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: C.textMuted }}>
                  Quantity ({trade.lots} lot{trade.lots > 1 ? 's' : ''} = {totalQty} qty)
                </label>
                <div className="flex items-center gap-3 mt-1">
                  <button
                    onClick={() => setTrade(t => ({ ...t, lots: Math.max(1, t.lots - 1) }))}
                    className="w-10 h-10 rounded-lg flex items-center justify-center transition-colors"
                    style={{ border: `1px solid ${C.border}`, background: C.surfaceAlt, color: C.textSec }}
                    onMouseEnter={e => e.currentTarget.style.borderColor = C.primary}
                    onMouseLeave={e => e.currentTarget.style.borderColor = C.border}
                  >
                    <Minus className="size-4" />
                  </button>
                  <input
                    type="number"
                    value={trade.lots}
                    onChange={e => {
                      const v = parseInt(e.target.value) || 1
                      setTrade(t => ({ ...t, lots: Math.max(1, Math.min(v, 100)) }))
                    }}
                    className="flex-1 text-center text-lg font-bold font-mono py-2.5 rounded-lg"
                    style={{ background: C.surfaceAlt, border: `1px solid ${C.border}`, color: C.text }}
                    min={1}
                    max={100}
                  />
                  <button
                    onClick={() => setTrade(t => ({ ...t, lots: Math.min(100, t.lots + 1) }))}
                    className="w-10 h-10 rounded-lg flex items-center justify-center transition-colors"
                    style={{ border: `1px solid ${C.border}`, background: C.surfaceAlt, color: C.textSec }}
                    onMouseEnter={e => e.currentTarget.style.borderColor = C.primary}
                    onMouseLeave={e => e.currentTarget.style.borderColor = C.border}
                  >
                    <Plus className="size-4" />
                  </button>
                </div>
              </div>

              {/* Stop Loss & Target */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: C.red }}>Stop Loss</label>
                  <input
                    type="number"
                    value={trade.stopLoss}
                    onChange={e => setTrade(t => ({ ...t, stopLoss: e.target.value }))}
                    placeholder="Optional"
                    className="w-full mt-1 px-3 py-2.5 rounded-lg text-sm font-mono"
                    style={{ background: C.surfaceAlt, border: `1px solid ${C.border}`, color: C.text }}
                    step="0.05"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: C.green }}>Target</label>
                  <input
                    type="number"
                    value={trade.target}
                    onChange={e => setTrade(t => ({ ...t, target: e.target.value }))}
                    placeholder="Optional"
                    className="w-full mt-1 px-3 py-2.5 rounded-lg text-sm font-mono"
                    style={{ background: C.surfaceAlt, border: `1px solid ${C.border}`, color: C.text }}
                    step="0.05"
                  />
                </div>
              </div>

              {/* Order Summary */}
              <div className="rounded-xl p-4 space-y-2 text-xs" style={{ background: C.bg, border: `1px solid ${C.border}` }}>
                <div className="flex justify-between">
                  <span style={{ color: C.textSec }}>Available Margin</span>
                  <span className="font-mono font-bold" style={{ color: availableMargin > totalValue + brokerage ? C.green : C.red, fontVariantNumeric: 'tabular-nums' }}>
                    {formatINRWhole(availableMargin)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: C.textSec }}>Price</span>
                  <span className="font-mono font-bold" style={{ color: C.text, fontVariantNumeric: 'tabular-nums' }}>
                    {trade.orderType === 'LIMIT' && trade.limitPrice ? parseFloat(trade.limitPrice).toFixed(2) : fmtLtp(trade.ltp)}
                    {trade.orderType === 'MARKET' && <span className="ml-1" style={{ color: C.textMuted }}>(MKT)</span>}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: C.textSec }}>Total Value</span>
                  <span className="font-mono font-bold" style={{ color: C.text, fontVariantNumeric: 'tabular-nums' }}>
                    {formatINR(totalValue)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: C.textSec }}>Brokerage</span>
                  <span className="font-mono" style={{ color: C.text, fontVariantNumeric: 'tabular-nums' }}>
                    {formatINR(brokerage)}
                  </span>
                </div>
                {trade.side === 'SELL' && (
                  <div className="flex justify-between" style={{ color: C.red }}>
                    <span>Margin (150%)</span>
                    <span className="font-mono font-bold" style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {formatINRWhole(totalValue * 1.5)}
                    </span>
                  </div>
                )}
              </div>

              {/* Submit */}
              <button
                onClick={handleConfirm}
                disabled={fillPrice <= 0 || !token}
                className="w-full py-3.5 rounded-xl text-white font-bold text-sm transition-all duration-200 disabled:opacity-40"
                style={{
                  background: trade.side === 'BUY'
                    ? `linear-gradient(135deg, ${C.green}, #16a34a)`
                    : `linear-gradient(135deg, ${C.red}, #dc2626)`,
                }}
              >
                {!token ? 'Login to Trade' : `${trade.side} ${trade.lots} Lot (${totalQty} Qty)`}
              </button>
            </div>
          </div>
        </div>
      )}

      <TradeConfirmModal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        tradeData={confirmData}
        onConfirm={executeTrade}
        onSuccess={() => useAppStore.getState().setCurrentPage('positions')}
      />

      {/* ═══ Strike Overview Drawer ═══════════════════════════════════════ */}
      {strikeOverview && (() => {
        const strikeData = data?.strikes.find(s => s.strike_price === strikeOverview.strike)
        if (!strikeData) return null
        const optData = strikeOverview.optionType === 'CE' ? strikeData.call_options : strikeData.put_options
        if (!optData?.market_data) return null
        return (
          <StrikeOverviewDrawer
            open={!!strikeOverview}
            onOpenChange={(open) => { if (!open) setStrikeOverview(null) }}
            underlying={strikeOverview.underlying}
            strike={strikeOverview.strike}
            optionType={strikeOverview.optionType}
            expiry={data?.expiry || expiry}
            instrumentKey={strikeOverview.instrumentKey}
            ltp={optData.market_data.ltp}
            greeks={optData.option_greeks}
            marketData={optData.market_data}
            spot={data?.spot || 0}
            onTrade={() => {
              openTrade(strikeOverview.optionType, strikeOverview.strike, optData.market_data.ltp, 'BUY')
              setStrikeOverview(null)
            }}
          />
        )
      })()}
    </div>
  )
}