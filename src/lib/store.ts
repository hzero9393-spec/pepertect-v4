import { create } from 'zustand'
import type { DateFilterPreset, DateRange } from '@/components/pepertect/date-filter'

export type PageId = 
  | 'dashboard'
  | 'trading'      // Stock trading screen
  | 'stockOverview' // Stock detail/overview page
  | 'indexDetail'  // Index detail page with chart + stats
  | 'positions'    // Positions with Index/Stock tabs
  | 'orders'       // Orders with Index/Stock tabs
  | 'portfolio'    // Portfolio overview
  | 'reports'      // Reports/analytics
  | 'watchlist'    // Watchlist page
  | 'futures'      // Futures trading
  | 'optionChain'  // Real-time option chain
  | 'learning'     // Learn section
  | 'profile'      // Profile/settings
  | 'activeDevices' // Active devices/sessions detail
  | 'helpSupport'   // Help & Support detail page
  // Footer pages
  | 'privacy-policy'
  | 'terms-of-service'
  | 'support'
  | 'contact-us'
  | 'faq'
  | 'disclaimer'
  | 'about-us'
  | 'refund-policy'

export type PositionsTab = 'stocks' | 'index' | 'nifty' | 'banknifty' | 'finnifty'

// ─── URL Mapping ──────────────────────────────────────────────────────────

/** Valid positions sub-tabs */
const VALID_POSITIONS_TABS = new Set<PositionsTab>(['stocks', 'index', 'nifty', 'banknifty', 'finnifty'])

/** Map PageId to URL path (positions tab is handled separately) */
const pageToUrlMap: Record<PageId, string> = {
  dashboard: '/',
  trading: '/stocks',
  stockOverview: '/stock', // needs symbol appended
  indexDetail: '/index',   // needs symbol appended
  positions: '/positions/stocks',
  orders: '/orders',
  portfolio: '/portfolio',
  reports: '/reports',
  watchlist: '/watchlist',
  futures: '/futures',
  optionChain: '/option-chain',
  learning: '/learning',
  profile: '/profile',
  activeDevices: '/active-devices',
  helpSupport: '/help-support',
  'privacy-policy': '/privacy-policy',
  'terms-of-service': '/terms-of-service',
  support: '/support',
  'contact-us': '/contact-us',
  faq: '/faq',
  disclaimer: '/disclaimer',
  'about-us': '/about-us',
  'refund-policy': '/refund-policy',
}

/** Get URL for a page (with optional stock/index symbol, or positions tab) */
export function getPageUrl(page: PageId, symbol?: string | null, positionsTab?: PositionsTab | null): string {
  const baseUrl = pageToUrlMap[page]
  if (!baseUrl) return '/'
  
  if ((page === 'stockOverview' || page === 'indexDetail') && symbol) {
    return `${baseUrl}/${encodeURIComponent(symbol)}`
  }
  
  // Override positions URL with tab
  if (page === 'positions' && positionsTab && VALID_POSITIONS_TABS.has(positionsTab)) {
    return `/positions/${positionsTab}`
  }
  
  return baseUrl
}

/** Parse URL path to determine page, symbol, and positions tab */
export function parseUrlPath(pathname: string): { page: PageId; stockSymbol?: string; indexSymbol?: string; positionsTab?: PositionsTab } {
  // Remove trailing slash
  const path = pathname.replace(/\/$/, '') || '/'
  
  // Exact matches
  if (path === '/') return { page: 'dashboard' }
  if (path === '/stocks') return { page: 'trading' }
  if (path === '/watchlist') return { page: 'watchlist' }

  // /positions/[tab] — positions with sub-tab
  const positionsMatch = path.match(/^\/positions\/([a-z]+)$/)
  if (positionsMatch) {
    const tab = positionsMatch[1] as PositionsTab
    if (VALID_POSITIONS_TABS.has(tab)) {
      return { page: 'positions', positionsTab: tab }
    }
    return { page: 'positions' }
  }
  if (path === '/positions') return { page: 'positions', positionsTab: 'stocks' }

  if (path === '/orders') return { page: 'orders' }
  if (path === '/portfolio') return { page: 'portfolio' }
  if (path === '/reports') return { page: 'reports' }
  if (path === '/futures') return { page: 'futures' }
  if (path === '/option-chain') return { page: 'optionChain' }
  if (path === '/learning') return { page: 'learning' }
  if (path === '/profile') return { page: 'profile' }
  if (path === '/active-devices') return { page: 'activeDevices' }
  if (path === '/help-support') return { page: 'helpSupport' }
  
  // Footer pages
  if (path === '/privacy-policy') return { page: 'privacy-policy' }
  if (path === '/terms-of-service') return { page: 'terms-of-service' }
  if (path === '/support') return { page: 'support' }
  if (path === '/contact-us') return { page: 'contact-us' }
  if (path === '/faq') return { page: 'faq' }
  if (path === '/disclaimer') return { page: 'disclaimer' }
  if (path === '/about-us') return { page: 'about-us' }
  if (path === '/refund-policy') return { page: 'refund-policy' }
  
  // Dynamic routes: /stock/[symbol] and /index/[symbol]
  if (path.startsWith('/stock/')) {
    const symbol = decodeURIComponent(path.slice(7))
    if (symbol) return { page: 'stockOverview', stockSymbol: symbol }
  }
  if (path.startsWith('/index/')) {
    const symbol = decodeURIComponent(path.slice(7))
    if (symbol) return { page: 'indexDetail', indexSymbol: symbol }
  }
  
  // Default to dashboard for unknown paths
  return { page: 'dashboard' }
}

// ─── State Interface ──────────────────────────────────────────────────────

interface AppState {
  currentPage: PageId
  sidebarOpen: boolean
  watchlistSidebarOpen: boolean
  selectedStockSymbol: string | null
  selectedIndexSymbol: string | null
  positionsTab: PositionsTab
  urlSyncEnabled: boolean
  // Shared date filter state (persists across pages)
  dateFilterPreset: DateFilterPreset
  dateFilterRange: DateRange | undefined
  tradeSignal: number          // bumped after any trade/square-off to trigger cross-page refresh
  setDateFilter: (preset: DateFilterPreset, range?: DateRange) => void
  setCurrentPage: (page: PageId) => void
  setSidebarOpen: (open: boolean) => void
  setWatchlistSidebarOpen: (open: boolean) => void
  setSelectedStockSymbol: (symbol: string | null) => void
  setSelectedIndexSymbol: (symbol: string | null) => void
  setPositionsTab: (tab: PositionsTab) => void
  navigateToPositions: (tab: PositionsTab) => void
  navigateToStock: (symbol: string) => void
  navigateToIndex: (symbol: string) => void
  initFromUrl: () => void
  setUrlSyncEnabled: (enabled: boolean) => void
  bumpTradeSignal: () => void   // call after trade/square-off to notify positions page
}

// ─── URL Push Helper ──────────────────────────────────────────────────────

function pushUrl(url: string) {
  if (typeof window === 'undefined') return
  // Only push if the URL is different from current
  if (window.location.pathname !== url) {
    window.history.pushState(null, '', url)
  }
}

// ─── Store ────────────────────────────────────────────────────────────────

export const useAppStore = create<AppState>((set, get) => ({
  currentPage: 'dashboard',
  sidebarOpen: false,
  watchlistSidebarOpen: false,
  selectedStockSymbol: null,
  selectedIndexSymbol: null,
  positionsTab: 'stocks' as PositionsTab,
  urlSyncEnabled: true,
  dateFilterPreset: 'all',
  dateFilterRange: undefined,
  tradeSignal: 0,
  
  setCurrentPage: (page) => {
    const state = get()
    const updates: Partial<AppState> = { currentPage: page, sidebarOpen: false }
    // Reset positionsTab to 'stocks' when navigating away from positions
    if (page !== 'positions') {
      updates.positionsTab = 'stocks'
    }
    set(updates)
    // Push URL change
    if (state.urlSyncEnabled) {
      pushUrl(getPageUrl(page, null, page === 'positions' ? state.positionsTab : null))
    }
  },
  
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  setWatchlistSidebarOpen: (open) => set({ watchlistSidebarOpen: open }),
  setSelectedStockSymbol: (symbol) => set({ selectedStockSymbol: symbol }),
  setSelectedIndexSymbol: (symbol) => set({ selectedIndexSymbol: symbol }),
  
  setPositionsTab: (tab) => {
    const state = get()
    if (state.positionsTab === tab) return
    set({ positionsTab: tab })
    if (state.urlSyncEnabled && state.currentPage === 'positions') {
      pushUrl(`/positions/${tab}`)
    }
  },

  navigateToPositions: (tab) => {
    const state = get()
    set({ positionsTab: tab, currentPage: 'positions', sidebarOpen: false })
    if (state.urlSyncEnabled) {
      pushUrl(`/positions/${tab}`)
    }
  },

  navigateToStock: (symbol) => {
    const state = get()
    set({ selectedStockSymbol: symbol, currentPage: 'stockOverview', sidebarOpen: false })
    // Push URL change
    if (state.urlSyncEnabled) {
      pushUrl(getPageUrl('stockOverview', symbol))
    }
  },
  
  navigateToIndex: (symbol) => {
    const state = get()
    set({ selectedIndexSymbol: symbol, currentPage: 'indexDetail', sidebarOpen: false })
    // Push URL change
    if (state.urlSyncEnabled) {
      pushUrl(getPageUrl('indexDetail', symbol))
    }
  },
  
  // Initialize store state from current URL (called on mount)
  initFromUrl: () => {
    if (typeof window === 'undefined') return
    const { page, stockSymbol, indexSymbol, positionsTab } = parseUrlPath(window.location.pathname)
    const updates: Partial<AppState> = { currentPage: page }
    if (stockSymbol) updates.selectedStockSymbol = stockSymbol
    if (indexSymbol) updates.selectedIndexSymbol = indexSymbol
    if (positionsTab) updates.positionsTab = positionsTab
    set(updates)
  },
  
  setDateFilter: (preset, range) => set({ dateFilterPreset: preset, dateFilterRange: range }),
  setUrlSyncEnabled: (enabled) => set({ urlSyncEnabled: enabled }),
  bumpTradeSignal: () => set(s => ({ tradeSignal: s.tradeSignal + 1 })),
}))