'use client'

import {
  Home,
  CandlestickChart,
  Crosshair,
  FileText,
  Star,
} from 'lucide-react'
import { useAppStore, type PageId } from '@/lib/store'
import { usePathname } from 'next/navigation'

interface MobileNavItem {
  id: PageId
  label: string
  icon: React.ComponentType<{ className?: string }>
  url: string
}

const mobileNavItems: MobileNavItem[] = [
  { id: 'dashboard', label: 'Home', icon: Home, url: '/' },
  { id: 'trading', label: 'Stocks', icon: CandlestickChart, url: '/stocks' },
  { id: 'watchlist', label: 'Watchlist', icon: Star, url: '/watchlist' },
  { id: 'positions', label: 'Positions', icon: Crosshair, url: '/positions' },
  { id: 'orders', label: 'Orders', icon: FileText, url: '/orders' },
]

export function MobileNav() {
  const { setCurrentPage } = useAppStore()
  const pathname = usePathname()

  const isActive = (item: MobileNavItem) => {
    if (item.id === 'dashboard') {
      return pathname === '/'
    }
    if (item.id === 'trading' && (pathname.startsWith('/stock/') || pathname.startsWith('/index/'))) {
      return true
    }
    if (item.id === 'trading' && pathname === '/stocks') {
      return true
    }
    if (item.url && (pathname === item.url || (item.id === 'positions' && pathname.startsWith('/positions')))) {
      return true
    }
    return false
  }

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-40 flex md:hidden"
      role="navigation"
      aria-label="Mobile navigation"
    >
      <div
        className="flex h-16 w-full items-center justify-around px-3"
        style={{
          background: '#ffffff',
          borderTop: '1px solid #e8ecf0',
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
          boxShadow: '0 -2px 12px rgba(0, 0, 0, 0.04)',
        }}
      >
        {mobileNavItems.map((item) => {
          const active = isActive(item)
          const Icon = item.icon
          return (
            <button
              key={item.id}
              onClick={() => setCurrentPage(item.id)}
              className="flex flex-col items-center justify-center gap-1 py-1.5 px-3 outline-none rounded-xl transition-all duration-200"
              style={{
                background: active ? 'rgba(0, 208, 156, 0.08)' : 'transparent',
                minWidth: '56px',
              }}
              aria-current={active ? 'page' : undefined}
              aria-label={item.label}
            >
              <div
                className="flex size-7 items-center justify-center rounded-lg transition-all duration-200"
                style={{
                  background: active ? 'rgba(0, 208, 156, 0.12)' : 'transparent',
                }}
              >
                <Icon
                  className="size-[18px] transition-colors duration-200"
                  style={{ color: active ? '#00D09C' : '#9ca3af' }}
                />
              </div>
              <span
                className="text-[10px] leading-tight transition-colors duration-200"
                style={{
                  color: active ? '#00A67E' : '#9ca3af',
                  fontWeight: active ? 700 : 500,
                }}
              >
                {item.label}
              </span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
