'use client'

import { useEffect, useCallback } from 'react'
import { useAppStore, parseUrlPath } from '@/lib/store'
import { useAuthStore } from '@/lib/auth-store'
import { AuthPage } from '@/components/pepertect/auth-page'
import { Sidebar } from '@/components/pepertect/sidebar'
import { TopBar } from '@/components/pepertect/topbar'
import { MobileNav } from '@/components/pepertect/mobile-nav'
import { DashboardPage } from '@/components/pepertect/pages/dashboard-page'
import { TradingPage } from '@/components/pepertect/pages/trading-page'
import PortfolioPage from '@/components/pepertect/pages/portfolio-page'
import { OrdersPage } from '@/components/pepertect/pages/orders-page'
import { PositionsPage } from '@/components/pepertect/pages/positions-page'
import { ReportsPage } from '@/components/pepertect/pages/reports-page'
import { ProfilePage } from '@/components/pepertect/pages/profile-page'
import { StockOverviewPage } from '@/components/pepertect/pages/stock-overview-page'
import { IndexDetailPage } from '@/components/pepertect/pages/index-detail-page'
import { OptionChainPage } from '@/components/pepertect/pages/option-chain-page'
import { FuturesPage } from '@/components/pepertect/pages/futures-page'
import { LearningPage } from '@/components/pepertect/pages/learning-page'
import { WatchlistPage } from '@/components/pepertect/pages/watchlist-page'
import { WatchlistSidebar } from '@/components/pepertect/watchlist-sidebar'
import { ActiveDevicesPage } from '@/components/pepertect/pages/active-devices-page'
import { HelpSupportPage } from '@/components/pepertect/pages/help-support-page'
import { IndexTicker } from '@/components/pepertect/index-ticker'
import { TradeSuccessProvider } from '@/components/pepertect/trade-success-popup'
import { Footer } from '@/components/pepertect/footer'
import {
  PrivacyPolicyPage,
  TermsOfServicePage,
  SupportPage,
  ContactUsPage,
  FAQPage,
  DisclaimerPage,
  AboutUsPage,
  RefundPolicyPage,
} from '@/components/pepertect/footer-pages'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { TrendingUp } from 'lucide-react'
import { GlobalSLMonitor } from '@/components/pepertect/global-sl-monitor'

// Footer page IDs — these pages show their own footer-free layout
const FOOTER_PAGES = new Set([
  'privacy-policy',
  'terms-of-service',
  'support',
  'contact-us',
  'faq',
  'disclaimer',
  'about-us',
  'refund-policy',
])

function PageContent({ page }: { page: string }) {
  switch (page) {
    case 'dashboard':
      return <DashboardPage />
    case 'trading':
      return <TradingPage />
    case 'stockOverview':
      return <StockOverviewPage />
    case 'positions':
      return <PositionsPage />
    case 'orders':
      return <OrdersPage />
    case 'portfolio':
      return <PortfolioPage />
    case 'reports':
      return <ReportsPage />
    case 'indexDetail':
      return <IndexDetailPage />
    case 'optionChain':
      return <OptionChainPage />
    case 'futures':
      return <FuturesPage />
    case 'learning':
      return <LearningPage />
    case 'watchlist':
      return <WatchlistPage />
    case 'profile':
      return <ProfilePage />
    case 'activeDevices':
      return <ActiveDevicesPage />
    case 'helpSupport':
      return <HelpSupportPage />
    // Footer pages
    case 'privacy-policy':
      return <PrivacyPolicyPage />
    case 'terms-of-service':
      return <TermsOfServicePage />
    case 'support':
      return <SupportPage />
    case 'contact-us':
      return <ContactUsPage />
    case 'faq':
      return <FAQPage />
    case 'disclaimer':
      return <DisclaimerPage />
    case 'about-us':
      return <AboutUsPage />
    case 'refund-policy':
      return <RefundPolicyPage />
    default:
      return <DashboardPage />
  }
}

function LoadingScreen() {
  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{ background: '#f5f7fa' }}
    >
      <div className="flex flex-col items-center gap-4">
        <div
          className="flex size-14 items-center justify-center rounded-2xl animate-pulse"
          style={{
            background: '#00D09C',
            color: '#ffffff',
          }}
        >
          <TrendingUp className="size-7" />
        </div>
        <div className="text-center">
          <h2 className="text-lg font-bold" style={{ color: '#1a1a1a' }}>Pepertect</h2>
          <p className="text-sm mt-1" style={{ color: '#6b7280' }}>
            Loading your trading desk...
          </p>
        </div>
        <div className="flex gap-1.5 mt-2">
          <div
            className="size-2 rounded-full animate-bounce"
            style={{ background: '#00D09C', animationDelay: '0ms' }}
          />
          <div
            className="size-2 rounded-full animate-bounce"
            style={{ background: '#00D09C', animationDelay: '150ms' }}
          />
          <div
            className="size-2 rounded-full animate-bounce"
            style={{ background: '#00D09C', animationDelay: '300ms' }}
          />
        </div>
      </div>
    </div>
  )
}

export function AppShell() {
  const { currentPage, sidebarOpen, setSidebarOpen, watchlistSidebarOpen, initFromUrl } = useAppStore()
  const { isAuthenticated, isInitializing, initialize, logout, user, token, setAuth } = useAuthStore()

  // Handle OAuth callback token from URL
  const handleOAuthCallback = useCallback(async () => {
    const params = new URLSearchParams(window.location.search)
    const authToken = params.get('auth_token')

    if (authToken) {
      try {
        // Verify token with backend and get user data
        const response = await fetch('/api/auth/me', {
          headers: { Authorization: `Bearer ${authToken}` },
        })

        if (response.ok) {
          const data = await response.json()
          setAuth(data.user, authToken)
        } else {
          console.error('OAuth token verification failed')
        }
      } catch (err) {
        console.error('OAuth callback error:', err)
      }
      // Clean URL - keep the path but remove auth_token param
      const url = new URL(window.location.href)
      url.searchParams.delete('auth_token')
      window.history.replaceState(null, '', url.pathname + url.hash)
    }
  }, [setAuth])

  // Initialize auth on mount
  useEffect(() => {
    // Check for OAuth callback first
    handleOAuthCallback()
    initialize()
  }, [initialize, handleOAuthCallback])

  // Initialize store from URL on mount (after auth is ready)
  useEffect(() => {
    if (!isInitializing && isAuthenticated) {
      initFromUrl()
    }
  }, [isInitializing, isAuthenticated, initFromUrl])

  // Handle browser back/forward (popstate)
  useEffect(() => {
    const handlePopState = () => {
      const { page, stockSymbol, indexSymbol, positionsTab } = parseUrlPath(window.location.pathname)
      // Temporarily disable URL sync to avoid pushing back to the URL we just came from
      useAppStore.setState({
        currentPage: page,
        selectedStockSymbol: stockSymbol || useAppStore.getState().selectedStockSymbol,
        selectedIndexSymbol: indexSymbol || useAppStore.getState().selectedIndexSymbol,
        ...(positionsTab ? { positionsTab } : {}),
      })
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  // Show loading while checking auth
  if (isInitializing) {
    return <LoadingScreen />
  }

  // Show auth page if not logged in
  if (!isAuthenticated) {
    return <AuthPage />
  }

  // Handle logout
  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
    } catch {
      // Ignore logout API errors
    }
    logout()
    // Clear watchlist store on logout
    const { useWatchlistStore } = await import('@/lib/watchlist-store')
    useWatchlistStore.getState().clear()
  }

  const isFooterPage = FOOTER_PAGES.has(currentPage)

  return (
    <TradeSuccessProvider>
      <GlobalSLMonitor />
      <div className="flex min-h-screen flex-col" style={{ background: '#f5f7fa' }}>
        {/* Desktop Sidebar */}
        <Sidebar onLogout={handleLogout} userName={user?.name} userEmail={user?.email} userRole={user?.role} userAvatar={user?.avatar} />

        {/* Mobile Sidebar Sheet */}
        <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
          <SheetContent
            side="left"
            className="w-[240px] p-0"
            style={{ background: '#ffffff', borderRight: '1px solid #e5e7eb' }}
          >
            <Sidebar variant="mobile" onLogout={handleLogout} userName={user?.name} userEmail={user?.email} userRole={user?.role} userAvatar={user?.avatar} />
          </SheetContent>
        </Sheet>

        {/* Top Bar */}
        <TopBar userName={user?.name} onLogout={handleLogout} userAvatar={user?.avatar} />

        {/* Indian Market Index Ticker */}
        {!isFooterPage && <IndexTicker />}

        {/* Watchlist Sidebar (Desktop) */}
        <WatchlistSidebar />

        {/* Main Content */}
        <main
          className={`flex-1 md:ml-[240px] pb-16 md:pb-0 transition-all duration-300 ${isFooterPage ? 'mt-14' : 'mt-[92px]'}`}
          style={{ marginRight: watchlistSidebarOpen ? 280 : 0 }}
        >
          <PageContent page={currentPage} />

          {/* Footer - only show on profile, help/support, and footer pages */}
          {(currentPage === 'profile' || currentPage === 'helpSupport' || isFooterPage) && <Footer />}
        </main>

        {/* Mobile Bottom Nav */}
        {!isFooterPage && <MobileNav />}
      </div>
    </TradeSuccessProvider>
  )
}
