'use client'

import { useState, useEffect, useSyncExternalStore } from 'react'
import {
  LayoutDashboard,
  BarChart3,
  Users,
  Crown,
  UserCheck,
  ArrowUpDown,
  Crosshair,
  FileText,
  Wrench,
  MessageSquare,
  ScrollText,
  Settings,
  UserCircle,
  LogOut,
  TrendingUp,
  Menu,
  Bell,
  Activity,
  ChevronRight,
  ShieldCheck,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import dynamic from 'next/dynamic'
import { AdminErrorBoundary } from './shared'

// ─── Types ───────────────────────────────────────────────────────────────────
type PageKey =
  | 'dashboard'
  | 'analytics'
  | 'users'
  | 'paid-users'
  | 'free-users'
  | 'trades'
  | 'positions'
  | 'reports'
  | 'tools'
  | 'tickets'
  | 'activity-logs'
  | 'settings'
  | 'profile'

interface AdminData {
  name?: string
  role?: string
  email?: string
}

interface NavItem {
  key: PageKey
  label: string
  icon: React.ComponentType<{ className?: string }>
}

interface NavSection {
  title: string
  items: NavItem[]
}

// ─── Dynamic imports (all ssr: false, each a separate chunk) ─────────────────
const DashboardPage = dynamic(() => import('./pages/dashboard-page'), {
  ssr: false,
  loading: () => <PageLoadingSkeleton />,
})
const AnalyticsPage = dynamic(() => import('./pages/analytics-page'), {
  ssr: false,
  loading: () => <PageLoadingSkeleton />,
})
const UsersPage = dynamic(() => import('./pages/users-page'), {
  ssr: false,
  loading: () => <PageLoadingSkeleton />,
})
const TradesPage = dynamic(() => import('./pages/trades-page'), {
  ssr: false,
  loading: () => <PageLoadingSkeleton />,
})
const PositionsPage = dynamic(() => import('./pages/positions-page'), {
  ssr: false,
  loading: () => <PageLoadingSkeleton />,
})
const ReportsPage = dynamic(() => import('./pages/reports-page'), {
  ssr: false,
  loading: () => <PageLoadingSkeleton />,
})
const ToolsPage = dynamic(() => import('./pages/tools-page'), {
  ssr: false,
  loading: () => <PageLoadingSkeleton />,
})
const TicketsPage = dynamic(() => import('./pages/tickets-page'), {
  ssr: false,
  loading: () => <PageLoadingSkeleton />,
})
const ActivityLogsPage = dynamic(() => import('./pages/activity-logs-page'), {
  ssr: false,
  loading: () => <PageLoadingSkeleton />,
})
const SettingsPage = dynamic(() => import('./pages/settings-page'), {
  ssr: false,
  loading: () => <PageLoadingSkeleton />,
})
const ProfilePage = dynamic(() => import('./pages/profile-page'), {
  ssr: false,
  loading: () => <PageLoadingSkeleton />,
})

// ─── Grouped navigation config ───────────────────────────────────────────────
const navSections: NavSection[] = [
  {
    title: 'OVERVIEW',
    items: [
      { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { key: 'analytics', label: 'Analytics', icon: BarChart3 },
    ],
  },
  {
    title: 'MANAGEMENT',
    items: [
      { key: 'users', label: 'Users', icon: Users },
      { key: 'paid-users', label: 'Paid Users', icon: Crown },
      { key: 'free-users', label: 'Free Users', icon: UserCheck },
      { key: 'trades', label: 'Trades', icon: ArrowUpDown },
      { key: 'positions', label: 'Positions', icon: Crosshair },
    ],
  },
  {
    title: 'SYSTEM',
    items: [
      { key: 'reports', label: 'Reports', icon: FileText },
      { key: 'tools', label: 'Tools', icon: Wrench },
      { key: 'tickets', label: 'Tickets', icon: MessageSquare },
      { key: 'activity-logs', label: 'Activity Logs', icon: ScrollText },
      { key: 'settings', label: 'Settings', icon: Settings },
    ],
  },
  {
    title: 'ACCOUNT',
    items: [{ key: 'profile', label: 'Profile', icon: UserCircle }],
  },
]

// ─── Helper: Get all nav items flat (for page title lookup) ──────────────────
const allNavItems = navSections.flatMap((s) => s.items)

function getPageLabel(key: PageKey | null): string {
  if (!key) return 'Welcome'
  const found = allNavItems.find((i) => i.key === key)
  if (found) return found.label
  return key
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

// ─── Page title for header when on welcome ───────────────────────────────────
function getHeaderDate(): string {
  return new Date().toLocaleDateString('en-IN', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

// ─── Loading Skeleton ────────────────────────────────────────────────────────
function PageLoadingSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="bg-white rounded-xl p-4 h-28 border border-[#e5e7eb]"
          />
        ))}
      </div>
      <div className="bg-white rounded-xl h-80 border border-[#e5e7eb]" />
      <div className="bg-white rounded-xl h-64 border border-[#e5e7eb]" />
    </div>
  )
}

// ─── Quick Stats for welcome screen ──────────────────────────────────────────
function WelcomeStats() {
  const [stats, setStats] = useState<{
    totalUsers: number
    activeUsers: number
    paidUsers: number
    totalTrades: number
  } | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const token = localStorage.getItem('admin_token')
        const res = await fetch('/api/admin/dashboard', {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (res.ok) {
          const data = await res.json()
          setStats({
            totalUsers: data.totalUsers || 0,
            activeUsers: data.activeUsers || 0,
            paidUsers: data.paidUsers || 0,
            totalTrades: data.totalTrades || 0,
          })
        }
      } catch {
        // Silent fail for welcome screen stats
      } finally {
        setLoading(false)
      }
    }
    fetchStats()
  }, [])

  if (loading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="bg-white rounded-xl p-4 h-24 border border-[#e5e7eb] animate-pulse"
          />
        ))}
      </div>
    )
  }

  if (!stats) return null

  const statItems = [
    {
      icon: Users,
      label: 'Total Users',
      value: stats.totalUsers.toLocaleString('en-IN'),
      color: '#00D09C',
    },
    {
      icon: Activity,
      label: 'Active Users',
      value: stats.activeUsers.toLocaleString('en-IN'),
      color: '#3B82F6',
    },
    {
      icon: Crown,
      label: 'Paid Users',
      value: stats.paidUsers.toLocaleString('en-IN'),
      color: '#F59E0B',
    },
    {
      icon: ArrowUpDown,
      label: 'Total Trades',
      value: stats.totalTrades.toLocaleString('en-IN'),
      color: '#8B5CF6',
    },
  ]

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {statItems.map((stat) => {
        const Icon = stat.icon
        return (
          <Card
            key={stat.label}
            className="bg-white border-[#e5e7eb] rounded-xl hover:shadow-sm transition-shadow"
          >
            <CardContent className="p-4">
              <div
                className="flex size-9 items-center justify-center rounded-lg"
                style={{
                  backgroundColor: `${stat.color}15`,
                  color: stat.color,
                }}
              >
                <Icon className="size-4" />
              </div>
              <p className="mt-3 text-xs font-medium text-[#6b7280]">
                {stat.label}
              </p>
              <p className="font-mono text-xl font-bold text-[#1a1a1a] mt-0.5">
                {stat.value}
              </p>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}

// ─── Quick action cards for welcome screen ───────────────────────────────────
const quickActions = [
  {
    key: 'dashboard' as PageKey,
    icon: LayoutDashboard,
    label: 'Dashboard',
    description: 'View platform analytics and charts',
    color: '#00D09C',
  },
  {
    key: 'users' as PageKey,
    icon: Users,
    label: 'User Management',
    description: 'Manage users, subscriptions, and balances',
    color: '#3B82F6',
  },
  {
    key: 'trades' as PageKey,
    icon: ArrowUpDown,
    label: 'Trades & Orders',
    description: 'Monitor trades across all segments',
    color: '#8B5CF6',
  },
  {
    key: 'analytics' as PageKey,
    icon: BarChart3,
    label: 'Analytics',
    description: 'Deep-dive into platform metrics',
    color: '#F59E0B',
  },
  {
    key: 'positions' as PageKey,
    icon: Crosshair,
    label: 'Open Positions',
    description: 'Track live positions across users',
    color: '#d44a2d',
  },
  {
    key: 'reports' as PageKey,
    icon: FileText,
    label: 'Reports',
    description: 'Generate and view platform reports',
    color: '#06B6D4',
  },
]

// ═════════════════════════════════════════════════════════════════════════════
// ADMIN PANEL
// ═════════════════════════════════════════════════════════════════════════════
export default function AdminPanel({ onLogout }: { onLogout: () => void }) {
  const [currentPage, setCurrentPage] = useState<PageKey | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const adminData = useSyncExternalStore(
    (onStoreChange) => {
      window.addEventListener('storage', onStoreChange)
      return () => window.removeEventListener('storage', onStoreChange)
    },
    () => {
      try {
        const raw = localStorage.getItem('admin_data')
        if (raw) return JSON.parse(raw) as AdminData
      } catch {
        // ignore parse errors
      }
      return {}
    },
    () => ({})
  )

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 1024)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  const adminName = adminData.name || 'Admin'
  const adminRole = adminData.role || 'Super Admin'
  const adminEmail = adminData.email || ''
  const adminInitials = adminName
    .split(' ')
    .map((w) => w.charAt(0).toUpperCase())
    .slice(0, 2)
    .join('')

  const handleNavClick = (key: PageKey) => {
    setCurrentPage(key)
    setSidebarOpen(false)
  }

  const handleLogout = () => {
    localStorage.removeItem('admin_token')
    localStorage.removeItem('admin_data')
    onLogout()
  }

  const renderPage = () => {
    if (!currentPage) {
      return (
        <div className="space-y-6">
          {/* Welcome hero */}
          <div className="relative bg-white border border-[#e5e7eb] rounded-2xl p-8 lg:p-10 overflow-hidden">
            <div className="absolute top-0 right-0 w-64 h-64 bg-[#00D09C]/5 rounded-full -translate-y-1/2 translate-x-1/2" />
            <div className="absolute bottom-0 left-0 w-40 h-40 bg-[#00D09C]/3 rounded-full translate-y-1/2 -translate-x-1/2" />
            <div className="relative">
              <div className="flex items-center gap-3 mb-4">
                <div className="flex size-12 items-center justify-center rounded-2xl bg-[#00D09C]/10">
                  <TrendingUp className="size-6 text-[#00D09C]" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-[#1a1a1a]">
                    Welcome back, {adminName}!
                  </h2>
                  <p className="text-xs text-[#6b7280] mt-0.5">
                    Here&apos;s what&apos;s happening on your platform today.
                  </p>
                </div>
              </div>
              <p className="text-sm text-[#6b7280] max-w-lg leading-relaxed">
                Select a section from the sidebar to get started, or use the
                quick actions below to jump to the most common areas.
              </p>
            </div>
          </div>

          {/* Quick stats */}
          <WelcomeStats />

          {/* Quick action grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {quickActions.map((action) => {
              const Icon = action.icon
              return (
                <button
                  key={action.key}
                  onClick={() => setCurrentPage(action.key)}
                  className="group bg-white border border-[#e5e7eb] rounded-xl p-5 text-left hover:shadow-md hover:border-[#d1d5db] transition-all duration-200"
                >
                  <div className="flex items-start justify-between">
                    <div
                      className="flex size-10 items-center justify-center rounded-xl transition-transform group-hover:scale-105"
                      style={{
                        backgroundColor: `${action.color}10`,
                        color: action.color,
                      }}
                    >
                      <Icon className="size-5" />
                    </div>
                    <ChevronRight className="size-4 text-[#9ca3af] group-hover:text-[#6b7280] group-hover:translate-x-0.5 transition-all" />
                  </div>
                  <h3 className="text-sm font-semibold text-[#1a1a1a] mt-3">
                    {action.label}
                  </h3>
                  <p className="text-xs text-[#6b7280] mt-1 leading-relaxed">
                    {action.description}
                  </p>
                </button>
              )
            })}
          </div>
        </div>
      )
    }

    switch (currentPage) {
      case 'dashboard':
        return (
          <AdminErrorBoundary fallback="Failed to load dashboard">
            <DashboardPage />
          </AdminErrorBoundary>
        )
      case 'analytics':
        return (
          <AdminErrorBoundary fallback="Failed to load analytics">
            <AnalyticsPage />
          </AdminErrorBoundary>
        )
      case 'users':
        return (
          <AdminErrorBoundary fallback="Failed to load users">
            <UsersPage />
          </AdminErrorBoundary>
        )
      case 'paid-users':
        return (
          <AdminErrorBoundary fallback="Failed to load paid users">
            <UsersPage subscriptionFilter="PREMIUM" />
          </AdminErrorBoundary>
        )
      case 'free-users':
        return (
          <AdminErrorBoundary fallback="Failed to load free users">
            <UsersPage subscriptionFilter="FREE" />
          </AdminErrorBoundary>
        )
      case 'trades':
        return (
          <AdminErrorBoundary fallback="Failed to load trades">
            <TradesPage />
          </AdminErrorBoundary>
        )
      case 'positions':
        return (
          <AdminErrorBoundary fallback="Failed to load positions">
            <PositionsPage />
          </AdminErrorBoundary>
        )
      case 'reports':
        return (
          <AdminErrorBoundary fallback="Failed to load reports">
            <ReportsPage />
          </AdminErrorBoundary>
        )
      case 'tools':
        return (
          <AdminErrorBoundary fallback="Failed to load tools">
            <ToolsPage />
          </AdminErrorBoundary>
        )
      case 'tickets':
        return (
          <AdminErrorBoundary fallback="Failed to load tickets">
            <TicketsPage />
          </AdminErrorBoundary>
        )
      case 'activity-logs':
        return (
          <AdminErrorBoundary fallback="Failed to load activity logs">
            <ActivityLogsPage />
          </AdminErrorBoundary>
        )
      case 'settings':
        return (
          <AdminErrorBoundary fallback="Failed to load settings">
            <SettingsPage />
          </AdminErrorBoundary>
        )
      case 'profile':
        return (
          <AdminErrorBoundary fallback="Failed to load profile">
            <ProfilePage />
          </AdminErrorBoundary>
        )
      default:
        return (
          <AdminErrorBoundary fallback="Failed to load dashboard">
            <DashboardPage />
          </AdminErrorBoundary>
        )
    }
  }

  // ─── Sidebar Content (shared between desktop & mobile) ─────────────────────
  const sidebarContent = (
    <div className="flex flex-col h-full">
      {/* Brand */}
      <div className="flex items-center gap-3 px-4 py-5 border-b border-[#e5e7eb]">
        <div className="flex size-9 items-center justify-center rounded-lg bg-[#00D09C] shrink-0">
          <TrendingUp className="size-4 text-white" />
        </div>
        <div className="min-w-0">
          <h1 className="text-sm font-bold text-[#1a1a1a] tracking-tight">
            Pepertect
          </h1>
          <p className="text-[10px] text-[#9ca3af] font-medium">Admin Panel</p>
        </div>
      </div>

      {/* Grouped navigation */}
      <ScrollArea className="flex-1 px-3 py-4">
        <nav className="space-y-5" role="navigation" aria-label="Admin navigation">
          {navSections.map((section) => (
            <div key={section.title}>
              <p className="px-3 mb-2 text-[10px] font-semibold tracking-[0.1em] text-[#9ca3af] uppercase select-none">
                {section.title}
              </p>
              <div className="space-y-0.5">
                {section.items.map((item) => {
                  const Icon = item.icon
                  const isActive = currentPage === item.key
                  return (
                    <button
                      key={item.key}
                      onClick={() => handleNavClick(item.key)}
                      className={`flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-xs font-medium transition-all duration-150 ${
                        isActive
                          ? 'bg-[#00D09C]/10 text-[#00D09C]'
                          : 'text-[#6b7280] hover:bg-[#f0f2f5] hover:text-[#1a1a1a]'
                      }`}
                      aria-current={isActive ? 'page' : undefined}
                    >
                      <Icon className="size-4 shrink-0" />
                      <span className="truncate">{item.label}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </nav>
      </ScrollArea>

      {/* Logout */}
      <div className="px-3 py-3 border-t border-[#e5e7eb]">
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <button className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-xs font-medium text-[#d44a2d] hover:bg-[#eb5b3c]/10 transition-colors">
              <LogOut className="size-4 shrink-0" />
              Logout
            </button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Confirm Logout</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to logout from the admin panel?
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleLogout}
                className="bg-[#eb5b3c] hover:bg-[#d44a2d] text-white"
              >
                Logout
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  )

  return (
    <div className="flex min-h-screen bg-[#f5f7fa]">
      {/* ─── Desktop Sidebar ───────────────────────────────────────────────── */}
      {!isMobile && (
        <aside className="w-60 bg-white border-r border-[#e5e7eb] flex flex-col shrink-0 sticky top-0 h-screen">
          {sidebarContent}
        </aside>
      )}

      {/* ─── Mobile Sidebar (Sheet) ────────────────────────────────────────── */}
      {isMobile && (
        <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
          <SheetContent side="left" className="w-60 p-0">
            {sidebarContent}
          </SheetContent>
        </Sheet>
      )}

      {/* ─── Main Area ─────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Topbar */}
        <header className="bg-white border-b border-[#e5e7eb] px-4 lg:px-6 py-3 sticky top-0 z-40">
          <div className="flex items-center justify-between">
            {/* Left: hamburger + title */}
            <div className="flex items-center gap-3">
              {isMobile && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-9"
                  onClick={() => setSidebarOpen(true)}
                >
                  <Menu className="size-5 text-[#6b7280]" />
                </Button>
              )}
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold text-[#1a1a1a]">
                    {getPageLabel(currentPage)}
                  </h2>
                  {currentPage && (
                    <Badge
                      variant="outline"
                      className="text-[10px] px-1.5 py-0 border-[#e5e7eb] text-[#9ca3af] font-normal"
                    >
                      {navSections
                        .find((s) =>
                          s.items.some((i) => i.key === currentPage)
                        )
                        ?.title.toLowerCase() || ''}
                    </Badge>
                  )}
                </div>
                <p className="text-[10px] text-[#9ca3af]">{getHeaderDate()}</p>
              </div>
            </div>

            {/* Right: notifications + admin info */}
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                className="size-9 text-[#9ca3af] hover:text-[#1a1a1a] relative"
              >
                <Bell className="size-4" />
                <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-[#eb5b3c] ring-2 ring-white" />
              </Button>
              <div className="flex items-center gap-2.5 pl-2.5 ml-1 border-l border-[#e5e7eb]">
                <Avatar className="size-8">
                  <AvatarFallback className="bg-[#00D09C]/10 text-[#00D09C] text-xs font-semibold">
                    {adminInitials}
                  </AvatarFallback>
                </Avatar>
                <div className="hidden sm:block min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="text-xs font-medium text-[#1a1a1a] truncate max-w-[120px]">
                      {adminName}
                    </p>
                    {adminRole && (
                      <ShieldCheck className="size-3 text-[#00D09C] shrink-0" />
                    )}
                  </div>
                  <p className="text-[10px] text-[#9ca3af] truncate max-w-[140px]">
                    {adminRole}
                    {adminEmail ? ` · ${adminEmail}` : ''}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 p-4 lg:p-6">{renderPage()}</main>
      </div>
    </div>
  )
}