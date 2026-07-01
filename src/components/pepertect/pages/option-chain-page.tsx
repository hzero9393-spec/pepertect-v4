'use client'

import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/lib/auth-store'
import { useTradeSuccess } from '@/components/pepertect/trade-success-popup'
import { TradeConfirmModal, TradeConfirmData } from '@/components/pepertect/ui/trade-confirm-modal'
import { X, Minus, Plus, ChevronDown } from 'lucide-react'

// ─── Types ──────────────────────────────────────────────────────────────────

interface OCStrike {
  strike_price: number
  underlying_spot_price: number
  call_options: {
    market_data: {
      ltp: number; volume: number; oi: number; close_price: number
      bid_price: number; bid_qty: number; ask_price: number; ask_qty: number; prev_oi: number
    }
    option_greeks: { iv: number; delta: number; theta: number; vega: number; gamma: number }
  }
  put_options: {
    market_data: {
      ltp: number; volume: number; oi: number; close_price: number
      bid_price: number; bid_qty: number; ask_price: number; ask_qty: number; prev_oi: number
    }
    option_greeks: { iv: number; delta: number; theta: number; vega: number; gamma: number }
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

function fmtNum(n: number): string {
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

function fmtPct(n: number): string {
  if (!isFinite(n) || n === 0) return '-'
  return (n > 0 ? '+' : '') + n.toFixed(1) + '%'
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
}

const defaultTrade: TradeState = {
  open: false, side: 'BUY', optionType: 'CE', strike: 0, ltp: 0,
  lots: 1, orderType: 'MARKET', productType: 'INTRADAY', limitPrice: '',
}

// ─── Color Tokens ───────────────────────────────────────────────────────────

const C = {
  bg: '#F7F8FA',
  surface: '#FFFFFF',
  text: '#1a1a1a',
  textDim: '#6b7280',
  textMuted: '#9ca3af',
  border: '#E5E7EB',
  borderLight: '#F0F0F0',
  green: '#00B386',
  greenBg: 'rgba(0,179,134,0.06)',
  red: '#EB5B3C',
  redBg: 'rgba(235,91,60,0.06)',
  atmBg: '#EEF0F4',
  atmBorder: '#D5D9E2',
  primary: '#00D09C',
  headerBg: '#F4F5F7',
}

// ─── Main Component ─────────────────────────────────────────────────────────

export function OptionChainPage() {
  const [index, setIndex] = useState<Underlying>('NIFTY')
  const [expiries, setExpiries] = useState<string[]>([])
  const [expiry, setExpiry] = useState('')
  const [data, setData] = useState<OCUpdate | null>(null)
  const [live, setLive] = useState(false)
  const [loading, setLoading] = useState(true)
  const [viewMode, setViewMode] = useState<ViewMode>('LTP')
  const esRef = useRef<EventSource | null>(null)
  const tableBodyRef = useRef<HTMLDivElement>(null)
  const scrolledOnce = useRef(false)

  // Trade state
  const [trade, setTrade] = useState<TradeState>(defaultTrade)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmData, setConfirmData] = useState<TradeConfirmData | null>(null)
  const [executing, setExecuting] = useState(false)

  const token = useAuthStore(s => s.token)
  const userData = useAuthStore(s => s.user)
  const setUser = useAuthStore(s => s.setUser)
  const { showTradeSuccess } = useTradeSuccess()

  // Available margin = virtualBalance - marginUsed
  const availableMargin = userData ? (userData.virtualBalance - (userData.marginUsed || 0)) : 0

  // Lot size for current index
  const lotSize = INDICES.find(i => i.key === index)?.lotSize || 50

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

  // SSE stream
  useEffect(() => {
    if (!expiry) return
    esRef.current?.close()

    const es = new EventSource(`/api/options/stream?underlying=${index}&expiry=${encodeURIComponent(expiry)}`)
    esRef.current = es

    es.onopen = () => setLive(true)
    es.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data)
        if (msg.type === 'update' && msg.data) setData(msg.data)
      } catch { /* */ }
    }
    es.onerror = () => { setLive(false); es.close() }

    return () => { es.close(); esRef.current = null; setLive(false) }
  }, [index, expiry])

  // Auto-scroll to ATM once
  useEffect(() => {
    if (data && tableBodyRef.current && !scrolledOnce.current) {
      const el = tableBodyRef.current.querySelector('[data-atm="true"]')
      if (el) { el.scrollIntoView({ block: 'center' }); scrolledOnce.current = true }
    }
  }, [data?.strikes?.length])
  useEffect(() => { scrolledOnce.current = false }, [index, expiry])

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
    if (!first) return null
    return data.spot - first.call_options.market_data.close_price
  }, [data, strikes])

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

  const handleConfirm = useCallback(() => {
    if (!token || fillPrice <= 0) return

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
      availableBalance: 0,
      optionType: trade.optionType,
      strikePrice: trade.strike,
      lots: trade.lots,
      lotSize,
      expiryDate: expiry,
    })
    setConfirmOpen(true)
  }, [token, trade, fillPrice, totalQty, totalValue, brokerage, lotSize, index, expiry])

  const executeTrade = useCallback(async (): Promise<{
    success: boolean; message?: string; error?: string; orderId?: string; balance?: number; totalValue?: number; brokerage?: number
  }> => {
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
        // Refresh user data to sync balance & marginUsed
        if (resData.balance !== undefined && userData) {
          setUser({ ...userData, virtualBalance: resData.balance, totalPnl: resData.totalPnl ?? userData.totalPnl })
        }
        setTrade(defaultTrade)
        return { success: true, orderId: resData.order?.id?.slice(-8).toUpperCase(), balance: resData.balance, totalValue: resData.order?.totalValue, brokerage: resData.order?.brokerage }
      } else {
        return { success: false, error: resData.error || 'Trade failed' }
      }
    } catch {
      return { success: false, error: 'Network error' }
    }
  }, [token, trade, fillPrice, totalQty, lotSize, index, expiry, showTradeSuccess])

  // ─── Column config per mode ───

  const isLTP = viewMode === 'LTP'

  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 92px)', background: C.bg }}>

      {/* ═══ INDEX TABS ═══ */}
      <div className="shrink-0 border-b" style={{ borderColor: C.border, background: C.surface }}>
        <div className="flex items-center px-1">
          {INDICES.map(ind => (
            <button
              key={ind.key}
              onClick={() => setIndex(ind.key)}
              className="relative px-4 py-2.5 text-[12px] font-semibold tracking-wide transition-colors whitespace-nowrap"
              style={{
                color: index === ind.key ? C.text : C.textDim,
              }}
            >
              {ind.label}
              {index === ind.key && (
                <span className="absolute bottom-0 left-2 right-2 h-[2px] rounded-full" style={{ background: C.primary }} />
              )}
            </button>
          ))}
          <div className="ml-auto pr-3 flex items-center gap-1.5">
            {live && (
              <span className="flex items-center gap-1 text-[10px] font-medium" style={{ color: C.primary }}>
                <span className="w-1.5 h-1.5 rounded-full animate-live-pulse" style={{ background: C.primary }} />
                LIVE
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ═══ MARKET DATA STRIP (Bloomberg-style compressed) ═══ */}
      {data && (
        <div className="shrink-0 px-3 py-1.5 flex items-center gap-4 overflow-x-auto no-scrollbar text-[11px] border-b" style={{ background: C.surface, borderColor: C.border }}>
          <span className="font-semibold" style={{ color: C.text }}>
            {data.spot.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
          {spotChange !== null && spotChange !== 0 && (
            <span className="font-medium" style={{ color: spotChange > 0 ? C.green : C.red }}>
              {spotChange > 0 ? '+' : ''}{spotChange.toFixed(2)} ({((spotChange / (data.spot - spotChange)) * 100).toFixed(2)}%)
            </span>
          )}
          <span style={{ color: C.textMuted }}>PCR</span>
          <span className="font-semibold" style={{ color: data.pcr > 1 ? C.green : data.pcr < 0.8 ? C.red : C.text }}>
            {data.pcr > 0 ? data.pcr.toFixed(2) : '-'}
          </span>
          <span style={{ color: C.textMuted }}>MaxPain</span>
          <span className="font-semibold" style={{ color: C.text }}>
            {data.maxPainStrike > 0 ? data.maxPainStrike.toLocaleString('en-IN') : '-'}
          </span>
          <span style={{ color: C.textMuted }}>CE OI</span>
          <span className="font-semibold" style={{ color: C.green }}>{fmtNum(data.totalCallOI)}</span>
          <span style={{ color: C.textMuted }}>PE OI</span>
          <span className="font-semibold" style={{ color: C.red }}>{fmtNum(data.totalPutOI)}</span>
          <span style={{ color: C.textMuted }}>Lot</span>
          <span className="font-semibold" style={{ color: C.text }}>{lotSize}</span>
        </div>
      )}

      {/* ═══ EXPIRY BAR ═══ */}
      <div className="shrink-0 border-b flex items-center" style={{ borderColor: C.border, background: C.surface }}>
        <div className="flex items-center overflow-x-auto no-scrollbar px-1 py-0">
          {expiries.map(e => (
            <button
              key={e}
              onClick={() => setExpiry(e)}
              className="relative px-3.5 py-2 text-[11px] font-medium whitespace-nowrap transition-colors"
              style={{ color: expiry === e ? C.text : C.textDim }}
            >
              {fmtExpiry(e)}
              {expiry === e && (
                <span className="absolute bottom-0 left-1.5 right-1.5 h-[2px] rounded-full" style={{ background: C.primary }} />
              )}
            </button>
          ))}
        </div>

        {/* LTP / OI Toggle */}
        <div className="ml-auto pr-2 shrink-0">
          <div className="inline-flex rounded-md overflow-hidden border" style={{ borderColor: C.border }}>
            {(['LTP', 'OI'] as ViewMode[]).map(mode => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className="px-3 py-1 text-[10px] font-bold tracking-wider transition-colors"
                style={{
                  background: viewMode === mode ? C.text : 'transparent',
                  color: viewMode === mode ? C.surface : C.textDim,
                }}
              >
                {mode}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ═══ OPTION CHAIN TABLE (80% screen) ═══ */}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden px-1 pt-1 pb-1">

        {loading ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="flex items-center gap-2 text-[12px]" style={{ color: C.textMuted }}>
              <span className="w-3 h-3 border-2 rounded-full animate-spin" style={{ borderColor: C.border, borderTopColor: C.primary }} />
              Loading chain...
            </div>
          </div>
        ) : strikes.length > 0 ? (
          <div className="flex-1 min-h-0 flex flex-col rounded-sm overflow-hidden border" style={{ borderColor: C.border, background: C.surface }}>

            {/* ── Sticky Table Header ── */}
            <div className="shrink-0 sticky top-0 z-10" style={{ background: C.headerBg, borderBottom: `2px solid ${C.border}` }}>
              {isLTP ? (
                /* LTP Mode Header */
                <div className="grid text-[9px] font-bold uppercase tracking-wider" style={{
                  gridTemplateColumns: '1fr 60px 1fr',
                  color: C.textDim,
                }}>
                  <div className="grid grid-cols-5 text-right pr-1 border-r" style={{ borderColor: C.border }}>
                    <span className="px-0.5">OI Chg</span>
                    <span className="px-0.5">OI</span>
                    <span className="px-0.5">Vol</span>
                    <span className="px-0.5">IV</span>
                    <span className="px-0.5 text-center">LTP</span>
                  </div>
                  <div className="flex items-center justify-center" style={{ color: C.text }}>
                    <span className="text-[9px]">STRIKE</span>
                  </div>
                  <div className="grid grid-cols-5 text-left pl-1">
                    <span className="px-0.5 text-center">LTP</span>
                    <span className="px-0.5">IV</span>
                    <span className="px-0.5">Vol</span>
                    <span className="px-0.5">OI</span>
                    <span className="px-0.5 text-right pr-1">OI Chg</span>
                  </div>
                </div>
              ) : (
                /* OI Mode Header */
                <div className="grid text-[9px] font-bold uppercase tracking-wider" style={{
                  gridTemplateColumns: '1fr 60px 1fr',
                  color: C.textDim,
                }}>
                  <div className="grid grid-cols-3 text-right pr-1 border-r" style={{ borderColor: C.border }}>
                    <span className="px-0.5">OI</span>
                    <span className="px-0.5">OI Chg</span>
                    <span className="px-0.5 text-right pr-1">Chg %</span>
                  </div>
                  <div className="flex items-center justify-center" style={{ color: C.text }}>
                    <span className="text-[9px]">STRIKE</span>
                  </div>
                  <div className="grid grid-cols-3 text-left pl-1">
                    <span className="px-0.5 text-left pl-1">Chg %</span>
                    <span className="px-0.5">OI Chg</span>
                    <span className="px-0.5">OI</span>
                  </div>
                </div>
              )}

              {/* CE / PE labels */}
              <div className="grid" style={{
                gridTemplateColumns: '1fr 60px 1fr',
              }}>
                <div className="text-center text-[9px] font-bold py-0.5 border-r" style={{ color: C.green, background: C.greenBg, borderColor: C.border }}>
                  CALLS
                </div>
                <div />
                <div className="text-center text-[9px] font-bold py-0.5" style={{ color: C.red, background: C.redBg }}>
                  PUTS
                </div>
              </div>
            </div>

            {/* ── Scrollable Body ── */}
            <div ref={tableBodyRef} className="flex-1 overflow-y-auto custom-scrollbar">
              {strikes.map(s => {
                const ce = s.call_options.market_data
                const pe = s.put_options.market_data
                const ceIV = s.call_options.option_greeks?.iv || 0
                const peIV = s.put_options.option_greeks?.iv || 0
                const isATM = s.strike_price === atm
                const ceITM = s.strike_price < data!.spot
                const peITM = s.strike_price > data!.spot
                const ceOIChg = ce.oi - (ce.prev_oi || 0)
                const peOIChg = pe.oi - (pe.prev_oi || 0)
                const ceChgPct = ce.prev_oi > 0 ? (ceOIChg / ce.prev_oi) * 100 : 0
                const peChgPct = pe.prev_oi > 0 ? (peOIChg / pe.prev_oi) * 100 : 0

                return (
                  <div
                    key={s.strike_price}
                    data-atm={isATM ? 'true' : undefined}
                    className="grid items-center transition-colors duration-100"
                    style={{
                      gridTemplateColumns: '1fr 60px 1fr',
                      height: '36px',
                      borderBottom: `1px solid ${isATM ? C.atmBorder : C.borderLight}`,
                      background: isATM ? C.atmBg : 'transparent',
                    }}
                    onMouseEnter={e => { if (!isATM) e.currentTarget.style.background = '#F0F4FF' }}
                    onMouseLeave={e => { if (!isATM) e.currentTarget.style.background = 'transparent' }}
                  >
                    {/* ── CE Side ── */}
                    {isLTP ? (
                      <div
                        className="grid grid-cols-5 items-center text-right pr-1 border-r text-[11px] font-mono"
                        style={{
                          borderColor: C.border,
                          background: ceITM && !isATM ? C.greenBg : 'transparent',
                        }}
                      >
                        <span className="px-0.5" style={{ color: ceOIChg > 0 ? C.green : ceOIChg < 0 ? C.red : C.textMuted }}>
                          {ceOIChg !== 0 ? (ceOIChg > 0 ? '+' : '') + fmtNum(Math.abs(ceOIChg)) : '-'}
                        </span>
                        <span className="px-0.5" style={{ color: C.text }}>{ce.oi > 0 ? fmtNum(ce.oi) : '-'}</span>
                        <span className="px-0.5" style={{ color: C.textDim }}>{ce.volume > 0 ? fmtNum(ce.volume) : '-'}</span>
                        <span className="px-0.5" style={{ color: C.textDim }}>{ceIV > 0 ? ceIV.toFixed(1) : '-'}</span>
                        <button
                          className="px-0.5 text-center font-semibold cursor-pointer hover:opacity-70 transition-opacity"
                          style={{ color: C.text }}
                          onClick={() => openTrade('CE', s.strike_price, ce.ltp, 'BUY')}
                        >
                          {fmtLtp(ce.ltp)}
                        </button>
                      </div>
                    ) : (
                      <div
                        className="grid grid-cols-3 items-center text-right pr-1 border-r text-[11px] font-mono"
                        style={{
                          borderColor: C.border,
                          background: ceITM && !isATM ? C.greenBg : 'transparent',
                        }}
                      >
                        <span className="px-0.5" style={{ color: C.text }}>{ce.oi > 0 ? fmtNum(ce.oi) : '-'}</span>
                        <span className="px-0.5" style={{ color: ceOIChg > 0 ? C.green : ceOIChg < 0 ? C.red : C.textMuted }}>
                          {ceOIChg !== 0 ? (ceOIChg > 0 ? '+' : '') + fmtNum(Math.abs(ceOIChg)) : '-'}
                        </span>
                        <span className="px-0.5 pr-1" style={{ color: ceChgPct > 0 ? C.green : ceChgPct < 0 ? C.red : C.textMuted }}>
                          {fmtPct(ceChgPct)}
                        </span>
                      </div>
                    )}

                    {/* ── Strike ── */}
                    <div
                      className="flex items-center justify-center text-[11px] font-bold font-mono border-r cursor-pointer hover:opacity-70"
                      style={{
                        borderColor: C.border,
                        color: isATM ? C.primary : C.text,
                        background: isATM ? C.atmBg : 'transparent',
                      }}
                      onClick={() => {
                        const ceLtp = ce.ltp
                        const peLtp = pe.ltp
                        // Open with the option that has more OI (more active)
                        if (ce.oi >= pe.oi) openTrade('CE', s.strike_price, ceLtp, 'BUY')
                        else openTrade('PE', s.strike_price, peLtp, 'BUY')
                      }}
                    >
                      {s.strike_price.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                    </div>

                    {/* ── PE Side ── */}
                    {isLTP ? (
                      <div
                        className="grid grid-cols-5 items-center text-left pl-1 text-[11px] font-mono"
                        style={{
                          background: peITM && !isATM ? C.redBg : 'transparent',
                        }}
                      >
                        <button
                          className="px-0.5 text-center font-semibold cursor-pointer hover:opacity-70 transition-opacity"
                          style={{ color: C.text }}
                          onClick={() => openTrade('PE', s.strike_price, pe.ltp, 'BUY')}
                        >
                          {fmtLtp(pe.ltp)}
                        </button>
                        <span className="px-0.5" style={{ color: C.textDim }}>{peIV > 0 ? peIV.toFixed(1) : '-'}</span>
                        <span className="px-0.5" style={{ color: C.textDim }}>{pe.volume > 0 ? fmtNum(pe.volume) : '-'}</span>
                        <span className="px-0.5" style={{ color: C.text }}>{pe.oi > 0 ? fmtNum(pe.oi) : '-'}</span>
                        <span className="px-0.5 text-right pr-1" style={{ color: peOIChg > 0 ? C.green : peOIChg < 0 ? C.red : C.textMuted }}>
                          {peOIChg !== 0 ? (peOIChg > 0 ? '+' : '') + fmtNum(Math.abs(peOIChg)) : '-'}
                        </span>
                      </div>
                    ) : (
                      <div
                        className="grid grid-cols-3 items-center text-left pl-1 text-[11px] font-mono"
                        style={{
                          background: peITM && !isATM ? C.redBg : 'transparent',
                        }}
                      >
                        <span className="px-0.5 pl-1" style={{ color: peChgPct > 0 ? C.green : peChgPct < 0 ? C.red : C.textMuted }}>
                          {fmtPct(peChgPct)}
                        </span>
                        <span className="px-0.5" style={{ color: peOIChg > 0 ? C.green : peOIChg < 0 ? C.red : C.textMuted }}>
                          {peOIChg !== 0 ? (peOIChg > 0 ? '+' : '') + fmtNum(Math.abs(peOIChg)) : '-'}
                        </span>
                        <span className="px-0.5" style={{ color: C.text }}>{pe.oi > 0 ? fmtNum(pe.oi) : '-'}</span>
                      </div>
                    )}
                  </div>
                )
              })}

              {/* ── Total Row ── */}
              <div
                className="grid items-center shrink-0 text-[10px] font-bold"
                style={{
                  gridTemplateColumns: '1fr 60px 1fr',
                  height: '28px',
                  borderTop: `2px solid ${C.border}`,
                  background: C.headerBg,
                }}
              >
                {isLTP ? (
                  <>
                    <div className="grid grid-cols-5 items-center text-right pr-1 border-r" style={{ borderColor: C.border, color: C.textDim }}>
                      <span />
                      <span className="font-semibold" style={{ color: C.green }}>{fmtNum(data?.totalCallOI || 0)}</span>
                      <span className="text-[9px]">CE OI</span>
                      <span /><span />
                    </div>
                  </>
                ) : (
                  <div className="grid grid-cols-3 items-center text-right pr-1 border-r" style={{ borderColor: C.border, color: C.textDim }}>
                    <span className="font-semibold" style={{ color: C.green }}>{fmtNum(data?.totalCallOI || 0)}</span>
                    <span /><span />
                  </div>
                )}
                <div />
                {isLTP ? (
                  <div className="grid grid-cols-5 items-center text-left pl-1" style={{ color: C.textDim }}>
                      <span /><span />
                      <span className="text-[9px]">PE OI</span>
                      <span className="font-semibold" style={{ color: C.red }}>{fmtNum(data?.totalPutOI || 0)}</span>
                      <span />
                    </div>
                ) : (
                  <div className="grid grid-cols-3 items-center text-left pl-1" style={{ color: C.textDim }}>
                    <span /><span />
                    <span className="font-semibold" style={{ color: C.red }}>{fmtNum(data?.totalPutOI || 0)}</span>
                  </div>
                )}
              </div>
            </div>

            {/* ── Tiny Legend ── */}
            <div className="shrink-0 flex items-center justify-center gap-4 py-1 border-t text-[9px]" style={{ borderColor: C.border, color: C.textMuted, background: C.headerBg }}>
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: C.green }} />
                Calls (CE)
              </span>
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: C.red }} />
                Puts (PE)
              </span>
              <span>ATM highlighted</span>
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
          <div className="absolute inset-0 bg-black/40" onClick={() => setTrade(defaultTrade)} />
          <div className="absolute bottom-0 left-0 right-0 bg-white rounded-t-2xl shadow-2xl max-h-[85vh] overflow-y-auto">
            {/* Handle */}
            <div className="flex justify-center pt-2 pb-1">
              <div className="w-10 h-1 rounded-full" style={{ background: C.border }} />
            </div>

            {/* Header */}
            <div className="flex items-center justify-between px-4 pb-3 border-b" style={{ borderColor: C.border }}>
              <div>
                <p className="text-sm font-bold" style={{ color: C.text }}>
                  {index} {trade.strike} {trade.optionType}
                </p>
                <p className="text-[11px]" style={{ color: C.textDim }}>
                  {fmtExpiry(expiry)} &middot; Lot: {lotSize} &middot; LTP: {'\u20B9'}{fmtLtp(trade.ltp)}
                </p>
              </div>
              <button onClick={() => setTrade(defaultTrade)} className="p-1.5 rounded-full hover:bg-gray-100">
                <X className="size-5" style={{ color: C.textDim }} />
              </button>
            </div>

            <div className="px-4 py-3 space-y-3">
              {/* Buy / Sell Toggle */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setTrade(t => ({ ...t, side: 'BUY' }))}
                  className="py-2.5 rounded-lg text-sm font-bold transition-colors"
                  style={{
                    background: trade.side === 'BUY' ? C.green : '#F5F5F5',
                    color: trade.side === 'BUY' ? '#fff' : C.textDim,
                  }}
                >
                  BUY {trade.optionType}
                </button>
                <button
                  onClick={() => setTrade(t => ({ ...t, side: 'SELL' }))}
                  className="py-2.5 rounded-lg text-sm font-bold transition-colors"
                  style={{
                    background: trade.side === 'SELL' ? C.red : '#F5F5F5',
                    color: trade.side === 'SELL' ? '#fff' : C.textDim,
                  }}
                >
                  SELL {trade.optionType}
                </button>
              </div>

              {/* Order Type + Product Type */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: C.textMuted }}>Order Type</label>
                  <div className="relative mt-1">
                    <select
                      value={trade.orderType}
                      onChange={e => setTrade(t => ({ ...t, orderType: e.target.value as 'MARKET' | 'LIMIT' }))}
                      className="w-full px-3 py-2 rounded-lg border text-sm font-medium bg-white appearance-none pr-8"
                      style={{ borderColor: C.border, color: C.text }}
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
                      className="w-full px-3 py-2 rounded-lg border text-sm font-medium bg-white appearance-none pr-8"
                      style={{ borderColor: C.border, color: C.text }}
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
                    className="w-full mt-1 px-3 py-2 rounded-lg border text-sm font-mono"
                    style={{ borderColor: C.border, color: C.text }}
                    step="0.05"
                  />
                </div>
              )}

              {/* Quantity (Lots) */}
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: C.textMuted }}>
                  Quantity ({trade.lots} lot{trade.lots > 1 ? 's' : ''} = {totalQty} qty)
                </label>
                <div className="flex items-center gap-2 mt-1">
                  <button
                    onClick={() => setTrade(t => ({ ...t, lots: Math.max(1, t.lots - 1) }))}
                    className="w-10 h-10 rounded-lg border flex items-center justify-center hover:bg-gray-50 active:bg-gray-100 transition-colors"
                    style={{ borderColor: C.border }}
                  >
                    <Minus className="size-4" style={{ color: C.textDim }} />
                  </button>
                  <input
                    type="number"
                    value={trade.lots}
                    onChange={e => {
                      const v = parseInt(e.target.value) || 1
                      setTrade(t => ({ ...t, lots: Math.max(1, Math.min(v, 100)) }))
                    }}
                    className="flex-1 text-center text-lg font-bold font-mono py-2 rounded-lg border"
                    style={{ borderColor: C.border, color: C.text }}
                    min={1}
                    max={100}
                  />
                  <button
                    onClick={() => setTrade(t => ({ ...t, lots: Math.min(100, t.lots + 1) }))}
                    className="w-10 h-10 rounded-lg border flex items-center justify-center hover:bg-gray-50 active:bg-gray-100 transition-colors"
                    style={{ borderColor: C.border }}
                  >
                    <Plus className="size-4" style={{ color: C.textDim }} />
                  </button>
                </div>
              </div>

              {/* Order Summary */}
              <div className="rounded-lg p-3 space-y-1.5 text-xs" style={{ background: C.bg }}>
                <div className="flex justify-between">
                  <span style={{ color: C.textDim }}>Available Margin</span>
                  <span className="font-mono font-semibold" style={{ color: availableMargin > totalValue + brokerage ? C.green : C.red }}>
                    {'\u20B9'}{availableMargin.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: C.textDim }}>Price</span>
                  <span className="font-mono font-semibold" style={{ color: C.text }}>
                    {trade.orderType === 'LIMIT' && trade.limitPrice ? parseFloat(trade.limitPrice).toFixed(2) : fmtLtp(trade.ltp)}
                    {trade.orderType === 'MARKET' && <span className="ml-1" style={{ color: C.textMuted }}>(MKT)</span>}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: C.textDim }}>Total Value</span>
                  <span className="font-mono font-semibold" style={{ color: C.text }}>
                    {'\u20B9'}{totalValue.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: C.textDim }}>Brokerage</span>
                  <span className="font-mono" style={{ color: C.text }}>
                    {'\u20B9'}{Math.round(brokerage * 100) / 100}
                  </span>
                </div>
                {trade.side === 'SELL' && (
                  <div className="flex justify-between" style={{ color: C.red }}>
                    <span>Margin (150%)</span>
                    <span className="font-mono font-semibold">
                      {'\u20B9'}{(totalValue * 1.5).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                    </span>
                  </div>
                )}
              </div>

              {/* Submit Button */}
              <button
                onClick={handleConfirm}
                disabled={fillPrice <= 0 || !token}
                className="w-full py-3 rounded-xl text-white font-bold text-sm transition-all disabled:opacity-40"
                style={{
                  background: trade.side === 'BUY' ? C.green : C.red,
                }}
              >
                {!token ? 'Login to Trade' : `${trade.side} ${trade.lots} Lot (${totalQty} Qty)`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Modal */}
      <TradeConfirmModal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        tradeData={confirmData}
        onConfirm={executeTrade}
      />
    </div>
  )
}