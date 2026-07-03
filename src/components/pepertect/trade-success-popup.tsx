'use client'

import { useState, useEffect, createContext, useContext, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { formatINR } from '@/lib/format'
import { CheckCircle2, X, ArrowUpRight, ArrowDownRight } from 'lucide-react'

// ─── Types ───────────────────────────────────────────────────────

interface TradeSuccessData {
  symbol: string
  type: 'BUY' | 'SELL'
  qty: number
  price: number
  time: string
  orderId: string
  segment?: string
  optionType?: string
  strikePrice?: number
  totalValue?: number
  brokerage?: number
}

interface TradeSuccessContextType {
  showTradeSuccess: (data: TradeSuccessData) => void
}

// ─── Context ─────────────────────────────────────────────────────

const TradeSuccessContext = createContext<TradeSuccessContextType>({
  showTradeSuccess: () => {},
})

export function useTradeSuccess() {
  return useContext(TradeSuccessContext)
}

// ─── Provider Component ──────────────────────────────────────────

export function TradeSuccessProvider({ children }: { children: React.ReactNode }) {
  const [tradeData, setTradeData] = useState<TradeSuccessData | null>(null)
  const [isVisible, setIsVisible] = useState(false)

  const showTradeSuccess = useCallback((data: TradeSuccessData) => {
    setTradeData(data)
    setIsVisible(true)
  }, [])

  const handleClose = useCallback(() => {
    setIsVisible(false)
    setTimeout(() => setTradeData(null), 300)
  }, [])

  // Auto close after 5 seconds
  useEffect(() => {
    if (isVisible) {
      const timer = setTimeout(handleClose, 5000)
      return () => clearTimeout(timer)
    }
  }, [isVisible, handleClose])

  return (
    <TradeSuccessContext.Provider value={{ showTradeSuccess }}>
      {children}

      {/* Trade Success Popup */}
      <AnimatePresence>
        {isVisible && tradeData && (
          <motion.div
            initial={{ opacity: 0, scale: 0.8, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.8, y: 20 }}
            transition={{ type: 'spring', stiffness: 300, damping: 25 }}
            className="fixed inset-0 z-[100] flex items-center justify-center pointer-events-none"
          >
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            />

            {/* Card */}
            <motion.div
              className="relative pointer-events-auto w-[90%] max-w-md"
              initial={{ y: 50 }}
              animate={{ y: 0 }}
              exit={{ y: 50 }}
            >
              <div className="bg-[#111827] rounded-2xl shadow-2xl border border-[#1f2937] overflow-hidden">
                {/* Header with success indicator */}
                <div className={`px-6 py-4 ${
                  tradeData.type === 'BUY'
                    ? 'bg-gradient-to-r from-emerald-500/20 to-emerald-500/5'
                    : 'bg-gradient-to-r from-red-500/20 to-red-500/5'
                }`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <motion.div
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        transition={{ delay: 0.2, type: 'spring', stiffness: 400, damping: 15 }}
                      >
                        <CheckCircle2 className={`size-8 ${
                          tradeData.type === 'BUY' ? 'text-emerald-500' : 'text-red-500'
                        }`} />
                      </motion.div>
                      <div>
                        <h3 className="text-lg font-bold text-white">
                          Trade Executed Successfully!
                        </h3>
                        <p className="text-xs text-gray-400">
                          Your order has been filled
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={handleClose}
                      className="size-8 rounded-full flex items-center justify-center hover:bg-[#1f2937] transition-colors"
                    >
                      <X className="size-4 text-gray-400" />
                    </button>
                  </div>
                </div>

                {/* Trade Details */}
                <div className="px-6 py-4 space-y-3">
                  {/* Symbol & Type */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-xl font-bold text-amber-500">{tradeData.symbol}</span>
                      {tradeData.optionType && tradeData.strikePrice && (
                        <span className="text-xs text-gray-400 bg-[#0a0e17] px-2 py-0.5 rounded border border-[#1f2937]">
                          {tradeData.strikePrice} {tradeData.optionType}
                        </span>
                      )}
                    </div>
                    <div className={`flex items-center gap-1 px-3 py-1.5 rounded-lg font-bold text-sm ${
                      tradeData.type === 'BUY'
                        ? 'bg-emerald-500/10 text-emerald-500'
                        : 'bg-red-500/10 text-red-500'
                    }`}>
                      {tradeData.type === 'BUY' ? (
                        <ArrowUpRight className="size-4" />
                      ) : (
                        <ArrowDownRight className="size-4" />
                      )}
                      {tradeData.type}
                    </div>
                  </div>

                  {/* Details Grid */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-[#0a0e17] rounded-lg p-3 border border-[#1f2937]">
                      <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">Quantity</p>
                      <p className="text-sm font-bold font-mono font-tabular text-white">{tradeData.qty}</p>
                    </div>
                    <div className="bg-[#0a0e17] rounded-lg p-3 border border-[#1f2937]">
                      <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">Price</p>
                      <p className="text-sm font-bold font-mono font-tabular text-white">{formatINR(tradeData.price)}</p>
                    </div>
                    <div className="bg-[#0a0e17] rounded-lg p-3 border border-[#1f2937]">
                      <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">Time</p>
                      <p className="text-sm font-mono font-tabular text-white">{tradeData.time}</p>
                    </div>
                    <div className="bg-[#0a0e17] rounded-lg p-3 border border-[#1f2937]">
                      <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">Order ID</p>
                      <p className="text-xs font-mono font-tabular text-gray-400">#{tradeData.orderId}</p>
                    </div>
                  </div>

                  {/* Total Value */}
                  {tradeData.totalValue && (
                    <div className="flex items-center justify-between px-3 py-2.5 rounded-lg bg-amber-500/5 border border-amber-500/10">
                      <span className="text-sm font-medium text-gray-400">Total Value</span>
                      <span className="text-lg font-bold font-mono font-tabular text-amber-500">
                        {formatINR(tradeData.totalValue)}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </TradeSuccessContext.Provider>
  )
}
