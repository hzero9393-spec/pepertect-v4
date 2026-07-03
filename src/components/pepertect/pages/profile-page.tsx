'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from '@/components/ui/dialog'
import { useAuthStore } from '@/lib/auth-store'
import { useAppStore } from '@/lib/store'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { formatINR, formatINRWhole } from '@/lib/format'
import {
  User,
  Mail,
  Shield,
  Crown,
  Wallet,
  TrendingUp,
  TrendingDown,
  BarChart3,
  Target,
  Download,
  LogOut,
  Lock,
  MonitorSmartphone,
  KeyRound,
  HelpCircle,
  MessageSquare,
  Ticket,
  Plus,
  ArrowUpRight,
  AlertTriangle,
  FileText,
  RotateCcw,
  Zap,
  Bell,
  Settings,
  Trophy,
  IndianRupee,
  Phone,
  Check,
  X,
  Loader2,
  Eye,
  EyeOff,
  ChevronRight,
  FileBarChart,
  Calendar,
  Clock,
  Star,
  AlertCircle,
  LogIn,
  Sparkles,
  Monitor,
  Smartphone,
  Tablet,
  MapPin,
  Globe,
  Camera,
} from 'lucide-react'

// ─── Types ───────────────────────────────────────────────────────

interface PortfolioData {
  virtualBalance: number
  marginUsed: number
  availableMargin: number
  totalInvested: number
  totalCurrentValue: number
  totalUnrealizedPnl: number
  totalRealizedPnl: number
  totalPortfolioValue: number
  totalPnl: number
  totalReturn: number
  totalTrades: number
  initialCapital: number
  openPositionsCount: number
  bestTradePnl?: number
}

interface AppSettings {
  confirmBeforeTrade: boolean
  defaultOrderType: 'MARKET' | 'LIMIT'
  notifications: boolean
}

interface SessionInfo {
  id: string
  browser: string
  os: string
  deviceType: string
  location: string | null
  ipAddress: string | null
  device: string
  isCurrent: boolean
  createdAt: string
  expiresAt: string
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  })
}

function getInitials(name: string | null | undefined): string {
  if (!name) return '??'
  return name
    .split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

function formatRelativeTime(dateStr: string): string {
  const now = new Date()
  const date = new Date(dateStr)
  const diffMs = now.getTime() - date.getTime()
  const diffSec = Math.floor(diffMs / 1000)
  const diffMin = Math.floor(diffSec / 60)
  const diffHr = Math.floor(diffMin / 60)
  const diffDay = Math.floor(diffHr / 24)

  if (diffSec < 60) return 'Just now'
  if (diffMin < 60) return `${diffMin} min${diffMin !== 1 ? 's' : ''} ago`
  if (diffHr < 24) return `${diffHr} hour${diffHr !== 1 ? 's' : ''} ago`
  if (diffDay < 7) return `${diffDay} day${diffDay !== 1 ? 's' : ''} ago`
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

// ─── Animation Variants ──────────────────────────────────────────

const fadeInUp = {
  hidden: { opacity: 0, y: 16 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.05, duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] },
  }),
}

// ─── Plan Features ───────────────────────────────────────────────

const FREE_FEATURES = [
  'Virtual balance of ₹1,00,000',
  'Paper trading on NSE/BSE',
  'Basic portfolio analytics',
  'Up to 50 trades per month',
]

const PREMIUM_FEATURES = [
  'Virtual balance of ₹10,00,000',
  'Unlimited paper trades',
  'Advanced analytics & reports',
  'Options & futures trading',
  'Priority support',
  'Custom watchlists',
]

// ─── Image Compression Helper ────────────────────────────────────

function compressImage(file: File, maxWidth: number, maxHeight: number, quality: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement('canvas')
        let width = img.width
        let height = img.height

        // Resize if larger than max dimensions
        if (width > maxWidth || height > maxHeight) {
          const ratio = Math.min(maxWidth / width, maxHeight / height)
          width = Math.round(width * ratio)
          height = Math.round(height * ratio)
        }

        canvas.width = width
        canvas.height = height

        const ctx = canvas.getContext('2d')
        if (!ctx) { reject(new Error('Canvas context failed')); return }
        ctx.drawImage(img, 0, 0, width, height)

        const base64 = canvas.toDataURL('image/jpeg', quality)
        resolve(base64)
      }
      img.onerror = () => reject(new Error('Failed to load image'))
      img.src = e.target?.result as string
    }
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsDataURL(file)
  })
}

// ─── Component ───────────────────────────────────────────────────

export function ProfilePage() {
  const { user, token, logout, setUser } = useAuthStore()
  const { setCurrentPage } = useAppStore()
  const [portfolio, setPortfolio] = useState<PortfolioData | null>(null)
  const [loading, setLoading] = useState(true)
  const [downloadingReport, setDownloadingReport] = useState<string | null>(null)
  const [confirmDialog, setConfirmDialog] = useState<{ open: boolean; type: 'last' | 'monthly' | 'full' | null }>({ open: false, type: null })

  // Dialog States
  const [editProfileOpen, setEditProfileOpen] = useState(false)
  const [changePasswordOpen, setChangePasswordOpen] = useState(false)
  const [addMoneyOpen, setAddMoneyOpen] = useState(false)
  const [withdrawOpen, setWithdrawOpen] = useState(false)
  const [raiseTicketOpen, setRaiseTicketOpen] = useState(false)

  // Reset All Data State
  const [resetDataOpen, setResetDataOpen] = useState(false)
  const [resetDataSubmitting, setResetDataSubmitting] = useState(false)
  const [resetConfirmText, setResetConfirmText] = useState('')

  // Form States
  const [editName, setEditName] = useState('')
  const [editPhone, setEditPhone] = useState('')
  const [editProfileSubmitting, setEditProfileSubmitting] = useState(false)

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [changePasswordSubmitting, setChangePasswordSubmitting] = useState(false)
  const [showCurrentPassword, setShowCurrentPassword] = useState(false)
  const [showNewPassword, setShowNewPassword] = useState(false)

  const [addMoneyAmount, setAddMoneyAmount] = useState('')
  const [addMoneySubmitting, setAddMoneySubmitting] = useState(false)

  const [withdrawAmount, setWithdrawAmount] = useState('')
  const [withdrawSubmitting, setWithdrawSubmitting] = useState(false)

  const [ticketSubject, setTicketSubject] = useState('')
  const [ticketMessage, setTicketMessage] = useState('')
  const [ticketSubmitting, setTicketSubmitting] = useState(false)

  // Sessions State
  const [sessions, setSessions] = useState<SessionInfo[]>([])
  const [sessionsLoading, setSessionsLoading] = useState(false)
  const [logoutAllConfirmOpen, setLogoutAllConfirmOpen] = useState(false)
  const [logoutAllSubmitting, setLogoutAllSubmitting] = useState(false)
  const [loggingOutSessionId, setLoggingOutSessionId] = useState<string | null>(null)

  // Settings State
  const [settings, setSettings] = useState<AppSettings>({
    confirmBeforeTrade: true,
    defaultOrderType: 'MARKET',
    notifications: true,
  })

  // Avatar upload state
  const [uploadingAvatar, setUploadingAvatar] = useState(false)

  // Sync edit form when dialog opens
  useEffect(() => {
    if (editProfileOpen) {
      setEditName(user?.name ?? '')
      setEditPhone(user?.phone ?? '')
    }
  }, [editProfileOpen, user?.name, user?.phone])

  // Reset form fields when dialogs close
  useEffect(() => {
    if (!changePasswordOpen) {
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setShowCurrentPassword(false)
      setShowNewPassword(false)
    }
  }, [changePasswordOpen])

  useEffect(() => {
    if (!addMoneyOpen) setAddMoneyAmount('')
  }, [addMoneyOpen])

  useEffect(() => {
    if (!withdrawOpen) setWithdrawAmount('')
  }, [withdrawOpen])

  useEffect(() => {
    if (!raiseTicketOpen) {
      setTicketSubject('')
      setTicketMessage('')
    }
  }, [raiseTicketOpen])

  // Load settings from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem('pepertect_settings')
      if (saved) {
        setSettings(prev => ({ ...prev, ...JSON.parse(saved) }))
      }
    } catch { /* silent */ }
  }, [])

  // Fetch Sessions (must be defined BEFORE the useEffect that uses it)
  const fetchSessions = useCallback(async () => {
    if (!token) return
    setSessionsLoading(true)
    try {
      const res = await fetch('/api/auth/sessions', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const data = await res.json()
        setSessions(data.sessions || [])
      }
    } catch {
      // Silent fail for sessions
    } finally {
      setSessionsLoading(false)
    }
  }, [token])

  // Fetch active sessions on mount
  useEffect(() => {
    fetchSessions()
  }, [fetchSessions])

  // Save settings
  const saveSettings = useCallback((newSettings: AppSettings) => {
    setSettings(newSettings)
    try {
      localStorage.setItem('pepertect_settings', JSON.stringify(newSettings))
      toast.success('Settings saved')
    } catch {
      toast.error('Failed to save settings')
    }
  }, [])

  // Fetch Portfolio
  const fetchPortfolio = useCallback(async () => {
    if (!token) return
    try {
      const res = await fetch('/api/trade/portfolio', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const json = await res.json()
        setPortfolio(json.data)
      }
    } catch { /* silent */ }
  }, [token])

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      await fetchPortfolio()
      setLoading(false)
    }
    load()
  }, [fetchPortfolio])

  // Derived values
  const availableBalance = portfolio?.virtualBalance ?? user?.virtualBalance ?? 100000
  const usedCapital = portfolio?.marginUsed ?? user?.marginUsed ?? 0
  const totalPnl = portfolio?.totalPnl ?? user?.totalPnl ?? 0
  const isProfit = totalPnl >= 0
  const winRate = user?.winRate ?? 0
  const totalTrades = portfolio?.totalTrades ?? user?.totalTrades ?? 0
  const bestTradePnl = portfolio?.bestTradePnl ?? 0
  const showLowBalanceWarning = availableBalance < 10000
  const isOAuthUser = user?.oauthProvider === 'google'

  // ─── API Handlers ────────────────────────────────────────────

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Validate file type
    if (!file.type.startsWith('image/')) {
      toast.error('Please select an image file')
      return
    }

    // Validate file size (max 2MB)
    if (file.size > 2 * 1024 * 1024) {
      toast.error('Image must be less than 2MB')
      return
    }

    setUploadingAvatar(true)
    try {
      // Compress and convert to base64
      const base64 = await compressImage(file, 200, 200, 0.85)

      const res = await fetch('/api/profile/update', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ avatar: base64 }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to upload avatar')
      setUser(data.user)
      toast.success('Profile photo updated')
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to upload photo')
    } finally {
      setUploadingAvatar(false)
      // Reset input
      e.target.value = ''
    }
  }

  const handleRemoveAvatar = async () => {
    if (!token) return
    setUploadingAvatar(true)
    try {
      const res = await fetch('/api/profile/update', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ avatar: null }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to remove avatar')
      setUser(data.user)
      toast.success('Profile photo removed')
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove photo')
    } finally {
      setUploadingAvatar(false)
    }
  }

  const handleEditProfile = async () => {
    if (!token) { toast.error('Please login'); return }
    if (!editName.trim()) { toast.error('Name cannot be empty'); return }
    setEditProfileSubmitting(true)
    try {
      const res = await fetch('/api/profile/update', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: editName.trim(), phone: editPhone.trim() || undefined }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message || 'Failed to update profile')
      setUser(data.user)
      toast.success('Profile updated successfully')
      setEditProfileOpen(false)
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to update profile')
    } finally {
      setEditProfileSubmitting(false)
    }
  }

  const handleChangePassword = async () => {
    if (!token) { toast.error('Please login'); return }
    if (!currentPassword || !newPassword || !confirmPassword) { toast.error('Please fill all fields'); return }
    if (newPassword.length < 6) { toast.error('New password must be at least 6 characters'); return }
    if (newPassword !== confirmPassword) { toast.error('Passwords do not match'); return }
    setChangePasswordSubmitting(true)
    try {
      const res = await fetch('/api/profile/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ currentPassword, newPassword }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message || 'Failed to change password')
      toast.success(data.message || 'Password changed successfully')
      setChangePasswordOpen(false)
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to change password')
    } finally {
      setChangePasswordSubmitting(false)
    }
  }

  const handleAddMoney = async () => {
    if (!token) { toast.error('Please login'); return }
    const amount = parseFloat(addMoneyAmount)
    if (!amount || amount <= 0) { toast.error('Please enter a valid amount'); return }
    if (amount > 10000000) { toast.error('Maximum ₹1,00,00,000 per transaction'); return }
    setAddMoneySubmitting(true)
    try {
      const res = await fetch('/api/profile/wallet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'add', amount }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message || 'Failed to add money')
      if (user) setUser({ ...user, virtualBalance: data.newBalance })
      toast.success(`${formatINR(amount)} added to wallet`)
      setAddMoneyOpen(false)
      fetchPortfolio()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to add money')
    } finally {
      setAddMoneySubmitting(false)
    }
  }

  const handleWithdraw = async () => {
    if (!token) { toast.error('Please login'); return }
    const amount = parseFloat(withdrawAmount)
    if (!amount || amount <= 0) { toast.error('Please enter a valid amount'); return }
    if (amount > availableBalance) { toast.error('Insufficient balance'); return }
    setWithdrawSubmitting(true)
    try {
      const res = await fetch('/api/profile/wallet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'withdraw', amount }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message || 'Failed to withdraw')
      if (user) setUser({ ...user, virtualBalance: data.newBalance })
      toast.success(`${formatINR(amount)} withdrawn from wallet`)
      setWithdrawOpen(false)
      fetchPortfolio()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to withdraw')
    } finally {
      setWithdrawSubmitting(false)
    }
  }

  const handleLogoutAll = async () => {
    if (!token) return
    setLogoutAllSubmitting(true)
    try {
      const res = await fetch('/api/profile/logout-all', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message || 'Failed')
      toast.success(`Logged out from ${data.sessionsTerminated} device(s)`)
      setLogoutAllConfirmOpen(false)
      // Refresh sessions list
      fetchSessions()
    } catch {
      toast.error('Failed to logout from all devices')
    } finally {
      setLogoutAllSubmitting(false)
    }
  }

  const handleLogoutSession = async (sessionId: string) => {
    if (!token) return
    setLoggingOutSessionId(sessionId)
    try {
      const res = await fetch(`/api/auth/sessions/${sessionId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        toast.success('Device logged out successfully')
        setSessions(prev => prev.filter(s => s.id !== sessionId))
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to logout device')
      }
    } catch {
      toast.error('Failed to logout device')
    } finally {
      setLoggingOutSessionId(null)
    }
  }

  const handleResetBalance = async () => {
    if (!token) return
    try {
      const res = await fetch('/api/profile/wallet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'add', amount: 100000 - availableBalance }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message || 'Failed')
      if (user) setUser({ ...user, virtualBalance: 100000, marginUsed: 0 })
      toast.success('Virtual balance reset to ₹1,00,000')
      fetchPortfolio()
    } catch {
      toast.error('Failed to reset balance')
    }
  }

  const handleResetAllData = async () => {
    if (!token) return
    if (resetConfirmText !== 'RESET') {
      toast.error('Type RESET to confirm')
      return
    }
    setResetDataSubmitting(true)
    try {
      const res = await fetch('/api/profile/reset-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ confirmation: 'RESET_ALL_DATA' }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to reset data')

      // Update the user in auth store
      if (data.user) {
        setUser({
          ...user!,
          virtualBalance: data.user.virtualBalance,
          marginUsed: data.user.marginUsed,
          totalTrades: data.user.totalTrades,
          winRate: data.user.winRate,
          totalPnl: data.user.totalPnl,
        })
      }

      const deleted = data.deleted
      const totalDeleted = Object.values(deleted as Record<string, number>).reduce((a: number, b) => a + b, 0) as number

      toast.success('✅ All trading data reset successfully!', {
        description: `Deleted ${totalDeleted} records. Balance reset to ₹1,00,000.`,
        duration: 5000,
      })

      setResetDataOpen(false)
      setResetConfirmText('')
      fetchPortfolio()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to reset data')
    } finally {
      setResetDataSubmitting(false)
    }
  }

  const handleRaiseTicket = async () => {
    if (!ticketSubject.trim() || !ticketMessage.trim()) { toast.error('Please fill in all fields'); return }
    setTicketSubmitting(true)
    try {
      await new Promise(resolve => setTimeout(resolve, 1000))
      toast.success('Ticket submitted successfully! We will get back to you soon.')
      setRaiseTicketOpen(false)
    } catch {
      toast.error('Failed to submit ticket')
    } finally {
      setTicketSubmitting(false)
    }
  }

  const handleDownloadReport = async (type: 'last' | 'monthly' | 'full') => {
    if (!token) { toast.error('Please login to download reports'); return }
    setDownloadingReport(type)
    setConfirmDialog({ open: false, type: null })

    const reportLabel = type === 'last' ? 'Last Trade' : type === 'monthly' ? 'Monthly' : 'Full Trading'

    try {
      toast.loading(`Generating ${reportLabel} report...`, { id: 'pdf-download' })

      const res = await fetch(`/api/profile/report?type=${type}`, {
        headers: { Authorization: `Bearer ${token}` },
      })

      if (!res.ok) {
        let errorMsg = `Failed to generate ${reportLabel} report`
        try {
          const errorData = await res.json()
          errorMsg = errorData.error || errorMsg
        } catch {
          if (res.status === 401) errorMsg = 'Session expired. Please login again.'
          else if (res.status === 500) errorMsg = 'Server error. Please try again later.'
          else errorMsg = `Error ${res.status}: ${res.statusText}`
        }
        throw new Error(errorMsg)
      }

      const contentType = res.headers.get('content-type') || ''
      if (!contentType.includes('pdf') && !contentType.includes('octet-stream')) {
        throw new Error('Invalid response format. Expected PDF file.')
      }

      const blob = await res.blob()

      if (blob.size < 100) {
        throw new Error('Generated PDF is empty or corrupted. Please try again.')
      }

      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const filenameMap: Record<string, string> = {
        last: `pepertect-last-trade-${new Date().toISOString().split('T')[0]}.pdf`,
        monthly: `pepertect-monthly-report-${new Date().toISOString().split('T')[0]}.pdf`,
        full: `pepertect-full-report-${new Date().toISOString().split('T')[0]}.pdf`,
      }
      a.download = filenameMap[type]
      a.style.display = 'none'
      document.body.appendChild(a)
      a.click()

      setTimeout(() => {
        document.body.removeChild(a)
        window.URL.revokeObjectURL(url)
      }, 250)

      toast.dismiss('pdf-download')
      toast.success(`${reportLabel} report downloaded successfully!`, {
        description: `File: ${filenameMap[type]}`,
        duration: 4000,
      })
    } catch (err: unknown) {
      toast.dismiss('pdf-download')
      const errorMessage = err instanceof Error ? err.message : 'Failed to download report. Please try again.'
      toast.error(errorMessage, { duration: 6000 })
      console.error('[Report Download Error]', err)
    } finally {
      setDownloadingReport(null)
    }
  }

  const handleLogout = () => {
    logout()
    toast.success('Logged out successfully')
  }

  // ─── Loading State ───────────────────────────────────────────
  if (loading) {
    return (
      <div className="p-4 sm:p-6 lg:p-8 space-y-5">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-4 space-y-5">
            <Skeleton className="h-96 rounded-2xl" />
          </div>
          <div className="lg:col-span-8 space-y-5">
            <div className="grid grid-cols-3 gap-4">
              <Skeleton className="h-28 rounded-2xl" />
              <Skeleton className="h-28 rounded-2xl" />
              <Skeleton className="h-28 rounded-2xl" />
            </div>
            <Skeleton className="h-44 rounded-2xl" />
            <Skeleton className="h-52 rounded-2xl" />
            <Skeleton className="h-40 rounded-2xl" />
          </div>
        </div>
      </div>
    )
  }

  let si = 0 // section index for animation

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6">

      {/* ═══ LOW BALANCE WARNING ════════════════════════════════════ */}
      {showLowBalanceWarning && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-3 px-4 py-3.5 rounded-xl border border-[#eb5b3c]/20 bg-[#fef2ef]"
        >
          <AlertTriangle className="size-5 text-[#EB5B3C] shrink-0" />
          <p className="text-sm font-medium text-[#EB5B3C]">
            Low Balance Warning: Your virtual balance is below ₹10,000. Consider adding funds.
          </p>
        </motion.div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

        {/* ═══════════════════════════════════════════════════════════
            LEFT COLUMN: Profile Header (Sticky)
        ═══════════════════════════════════════════════════════════ */}
        <div className="lg:col-span-4">
          <div className="lg:sticky lg:top-6 space-y-5">

            {/* ── 1. PROFILE HEADER CARD ─────────────────────────── */}
            <motion.div custom={si++} variants={fadeInUp} initial="hidden" animate="visible">
              <div className="bg-white border border-[#e8eaf0] rounded-2xl shadow-sm overflow-hidden">
                {/* Top Accent Bar */}
                <div className="h-1.5 bg-gradient-to-r from-[#00D09C] via-[#00D09C] to-[#5367ff]" />

                <div className="p-6">
                  {/* Avatar + Name */}
                  <div className="flex flex-col items-center text-center mb-5">
                    <div className="relative group mb-4">
                      <div className="size-20 rounded-full bg-[#00D09C] flex items-center justify-center ring-4 ring-[#00D09C]/10 overflow-hidden">
                        {user?.avatar ? (
                          <img
                            src={user.avatar}
                            alt={user?.name || 'User'}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <span className="text-2xl font-bold text-white">
                            {getInitials(user?.name)}
                          </span>
                        )}
                      </div>
                      {/* Camera overlay */}
                      <label className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer">
                        <Camera className="size-6 text-white" />
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          className="hidden"
                          onChange={handleAvatarChange}
                        />
                      </label>
                      {user?.avatar && (
                        <button
                          onClick={handleRemoveAvatar}
                          className="absolute -top-1 -right-1 size-6 rounded-full bg-[#EB5B3C] flex items-center justify-center text-white shadow-sm hover:bg-[#d44f33] transition-colors"
                          title="Remove photo"
                        >
                          <X className="size-3" />
                        </button>
                      )}
                    </div>
                    {uploadingAvatar && (
                      <div className="flex items-center gap-2 mb-2">
                        <Loader2 className="size-3.5 animate-spin text-[#00D09C]" />
                        <span className="text-xs text-[#00D09C] font-medium">Uploading...</span>
                      </div>
                    )}
                    <h2 className="text-lg font-bold text-[#1a1a2e]">{user?.name ?? 'User'}</h2>
                    <p className="text-sm text-[#6b7280] mt-0.5">{user?.email ?? '—'}</p>
                    <div className="flex items-center gap-2 mt-2">
                      <span className="text-[10px] font-mono font-tabular px-2.5 py-0.5 rounded-md bg-[#f0f2f5] text-[#9ca3af] border border-[#e8eaf0]">
                        ID: {user?.id?.slice(0, 8) ?? '--------'}
                      </span>
                    </div>
                  </div>

                  {/* Wallet Balance Card */}
                  <div className="rounded-xl p-4 mb-5 bg-[#e6faf4] border border-[#00D09C]/15">
                    <div className="flex items-center justify-between">
                      <div className="text-left">
                        <p className="text-[10px] font-semibold uppercase tracking-widest text-[#6b7280]">Wallet Balance</p>
                        <p className="text-2xl font-bold text-[#00D09C] mt-1">{formatINRWhole(availableBalance)}</p>
                      </div>
                      <Badge className="border-0 text-[10px] font-bold px-2.5 py-1 bg-[#f0f2f5] text-[#6b7280]">
                        <Crown className="size-3 mr-1" />
                        {user?.subscription ?? 'FREE'}
                      </Badge>
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div className="flex gap-3">
                    <Button
                      className="flex-1 gap-2 text-sm font-semibold h-10 bg-[#00D09C] hover:bg-[#00b888] text-white border-0 shadow-sm"
                      onClick={() => setEditProfileOpen(true)}
                    >
                      <User className="size-4" />
                      Edit Profile
                    </Button>
                    {isOAuthUser ? (
                      <Button
                        className="flex-1 gap-2 text-sm font-semibold h-10 cursor-not-allowed opacity-70 bg-[#f0f2f5] text-[#9ca3af] border border-[#e8eaf0]"
                        disabled
                      >
                        <MonitorSmartphone className="size-4" />
                        Google Account
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        className="flex-1 gap-2 text-sm font-semibold h-10 border-[#e8eaf0] text-[#374151] hover:bg-[#f0f2f5]"
                        onClick={() => setChangePasswordOpen(true)}
                      >
                        <KeyRound className="size-4" />
                        Change Password
                      </Button>
                    )}
                  </div>

                  <Separator className="my-5 bg-[#e8eaf0]" />

                  {/* Contact Details */}
                  <div className="space-y-3">
                    <div className="flex items-center gap-3">
                      <div className="size-8 rounded-lg bg-[#f0f2f5] flex items-center justify-center shrink-0">
                        <Mail className="size-4 text-[#6b7280]" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-[#9ca3af]">Email</p>
                        <p className="text-sm font-medium text-[#1a1a2e] truncate">{user?.email ?? '—'}</p>
                      </div>
                      {user?.isEmailVerified && (
                        <Badge className="border-0 text-[10px] font-semibold px-1.5 py-0 bg-[#e6faf4] text-[#00D09C]">
                          <Check className="size-3 mr-0.5" /> Verified
                        </Badge>
                      )}
                    </div>

                    <div className="flex items-center gap-3">
                      <div className="size-8 rounded-lg bg-[#f0f2f5] flex items-center justify-center shrink-0">
                        <Phone className="size-4 text-[#6b7280]" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-[#9ca3af]">Phone</p>
                        <p className="text-sm font-medium text-[#1a1a2e]">{user?.phone ?? 'Not added'}</p>
                      </div>
                      {user?.isPhoneVerified && user?.phone && (
                        <Badge className="border-0 text-[10px] font-semibold px-1.5 py-0 bg-[#e6faf4] text-[#00D09C]">
                          <Check className="size-3 mr-0.5" /> Verified
                        </Badge>
                      )}
                    </div>

                    <div className="flex items-center gap-3">
                      <div className="size-8 rounded-lg bg-[#f0f2f5] flex items-center justify-center shrink-0">
                        <Shield className="size-4 text-[#6b7280]" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-[#9ca3af]">Role</p>
                        <p className="text-sm font-medium text-[#1a1a2e]">{user?.role ?? 'USER'}</p>
                      </div>
                    </div>
                  </div>

                  <Separator className="my-4 bg-[#e8eaf0]" />

                  {/* Last Login & Member Since */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-[#6b7280] flex items-center gap-1.5">
                        <Clock className="size-3" /> Last Login
                      </span>
                      <span className="text-xs font-medium text-[#374151]">
                        {user?.lastLoginAt
                          ? new Date(user.lastLoginAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
                          : '—'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-[#6b7280] flex items-center gap-1.5">
                        <Calendar className="size-3" /> Member Since
                      </span>
                      <span className="text-xs font-medium text-[#374151]">{formatDate(user?.createdAt ?? null)}</span>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        </div>

        {/* ═══════════════════════════════════════════════════════════
            RIGHT COLUMN: All Other Sections
        ═══════════════════════════════════════════════════════════ */}
        <div className="lg:col-span-8 space-y-5">

          {/* ── 2. WALLET SECTION ────────────────────────────────── */}
          <motion.div custom={si++} variants={fadeInUp} initial="hidden" animate="visible">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {/* Available Balance */}
              <div className="bg-white border border-[#e8eaf0] rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow">
                <div className="flex items-center gap-2 mb-3">
                  <div className="size-9 rounded-lg bg-[#e6faf4] flex items-center justify-center">
                    <Wallet className="size-4 text-[#00D09C]" />
                  </div>
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-[#6b7280]">Available Balance</span>
                </div>
                <p className="text-xl font-bold text-[#00D09C]">{formatINRWhole(availableBalance)}</p>
              </div>

              {/* Used Capital */}
              <div className="bg-white border border-[#e8eaf0] rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow">
                <div className="flex items-center gap-2 mb-3">
                  <div className="size-9 rounded-lg bg-[#f0f2f5] flex items-center justify-center">
                    <IndianRupee className="size-4 text-[#6b7280]" />
                  </div>
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-[#6b7280]">Used Capital</span>
                </div>
                <p className="text-xl font-bold text-[#1a1a2e]">{formatINRWhole(usedCapital)}</p>
              </div>

              {/* Total P&L */}
              <div className={cn(
                'bg-white rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow',
                isProfit ? 'border border-[#00D09C]/25' : 'border border-[#eb5b3c]/25'
              )}>
                <div className="flex items-center gap-2 mb-3">
                  <div className={cn('size-9 rounded-lg flex items-center justify-center', isProfit ? 'bg-[#e6faf4]' : 'bg-[#fef2ef]')}>
                    {isProfit ? <TrendingUp className="size-4 text-[#00D09C]" /> : <TrendingDown className="size-4 text-[#EB5B3C]" />}
                  </div>
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-[#6b7280]">Total P&L</span>
                </div>
                <p className={cn('text-xl font-bold', isProfit ? 'text-[#00D09C]' : 'text-[#EB5B3C]')}>
                  {isProfit ? '+' : '-'}{formatINR(Math.abs(totalPnl))}
                </p>
              </div>
            </div>

            {/* Wallet Actions */}
            <div className="flex gap-3 mt-4">
              <Button
                className="gap-2 text-sm font-semibold h-10 bg-[#00D09C] hover:bg-[#00b888] text-white border-0 shadow-sm"
                onClick={() => setAddMoneyOpen(true)}
              >
                <Plus className="size-4" /> Add Money
              </Button>
              <Button
                variant="outline"
                className="gap-2 text-sm font-semibold h-10 border-[#e8eaf0] text-[#374151] hover:bg-[#f0f2f5]"
                onClick={() => setWithdrawOpen(true)}
              >
                <ArrowUpRight className="size-4" /> Withdraw
              </Button>
            </div>
          </motion.div>

          {/* ── 3. SUBSCRIPTION SECTION ──────────────────────────── */}
          <motion.div custom={si++} variants={fadeInUp} initial="hidden" animate="visible">
            <div className="bg-white border border-[#e8eaf0] rounded-2xl shadow-sm overflow-hidden">
              <div className="p-5 pb-3">
                <div className="flex items-center gap-2">
                  <Crown className="size-5 text-[#00D09C]" />
                  <h3 className="text-base font-semibold text-[#1a1a2e]">Subscription</h3>
                </div>
              </div>
              <div className="px-5 pb-5">
                <div className="flex flex-col sm:flex-row sm:items-start gap-4 sm:gap-8">
                  <div className="space-y-3 flex-1">
                    <div className="flex items-center gap-3">
                      <span className="text-sm text-[#6b7280]">Current Plan:</span>
                      <Badge className={cn(
                        'border-0 text-xs font-bold px-3 py-1',
                        user?.subscription === 'PREMIUM' ? 'bg-[#e6faf4] text-[#00D09C]' : 'bg-[#f0f2f5] text-[#6b7280]'
                      )}>
                        <Crown className="size-3 mr-1" />
                        {user?.subscription ?? 'FREE'}
                      </Badge>
                    </div>
                    <div className="mt-3 space-y-2">
                      {(user?.subscription === 'PREMIUM' ? PREMIUM_FEATURES : FREE_FEATURES).map((feature, idx) => (
                        <div key={idx} className="flex items-center gap-2">
                          <Check className="size-3.5 shrink-0 text-[#00D09C]" />
                          <span className="text-sm text-[#374151]">{feature}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="flex gap-3 shrink-0">
                    <Button
                      className="gap-2 text-sm font-semibold h-10 px-5 bg-[#00D09C] hover:bg-[#00b888] text-white border-0 shadow-sm"
                      onClick={() => toast.info('Premium Features', { description: 'Unlock unlimited trades, advanced analytics & more!' })}
                    >
                      <Zap className="size-4" /> Upgrade Plan
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>

          {/* ── 4. SETTINGS SECTION ──────────────────────────────── */}
          <motion.div custom={si++} variants={fadeInUp} initial="hidden" animate="visible">
            <div className="bg-white border border-[#e8eaf0] rounded-2xl shadow-sm overflow-hidden">
              <div className="p-5 pb-3">
                <div className="flex items-center gap-2">
                  <Settings className="size-5 text-[#00D09C]" />
                  <h3 className="text-base font-semibold text-[#1a1a2e]">Settings</h3>
                </div>
              </div>
              <div className="px-5 pb-5 space-y-5">
                {/* Confirm before trade */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="size-9 rounded-lg bg-[#e6faf4] flex items-center justify-center">
                      <Shield className="size-4 text-[#00D09C]" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-[#1a1a2e]">Confirm before trade</p>
                      <p className="text-xs text-[#9ca3af]">Show confirmation dialog before placing orders</p>
                    </div>
                  </div>
                  <Switch
                    checked={settings.confirmBeforeTrade}
                    onCheckedChange={(v) => saveSettings({ ...settings, confirmBeforeTrade: v })}
                  />
                </div>

                {/* Default order type */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="size-9 rounded-lg bg-[#f0f2f5] flex items-center justify-center">
                      <Target className="size-4 text-[#6b7280]" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-[#1a1a2e]">Default order type</p>
                      <p className="text-xs text-[#9ca3af]">Choose your default order type</p>
                    </div>
                  </div>
                  <div className="flex bg-[#f0f2f5] rounded-lg p-0.5">
                    <button
                      onClick={() => saveSettings({ ...settings, defaultOrderType: 'MARKET' })}
                      className={cn(
                        'px-3 py-1.5 rounded-md text-xs font-bold transition-all',
                        settings.defaultOrderType === 'MARKET' ? 'bg-white text-[#1a1a2e] shadow-sm' : 'text-[#6b7280]'
                      )}
                    >
                      Market
                    </button>
                    <button
                      onClick={() => saveSettings({ ...settings, defaultOrderType: 'LIMIT' })}
                      className={cn(
                        'px-3 py-1.5 rounded-md text-xs font-bold transition-all',
                        settings.defaultOrderType === 'LIMIT' ? 'bg-white text-[#1a1a2e] shadow-sm' : 'text-[#6b7280]'
                      )}
                    >
                      Limit
                    </button>
                  </div>
                </div>

                {/* Notifications */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="size-9 rounded-lg bg-[#f0f2f5] flex items-center justify-center">
                      <Bell className="size-4 text-[#6b7280]" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-[#1a1a2e]">Notifications</p>
                      <p className="text-xs text-[#9ca3af]">Receive trade alerts and updates</p>
                    </div>
                  </div>
                  <Switch
                    checked={settings.notifications}
                    onCheckedChange={(v) => saveSettings({ ...settings, notifications: v })}
                  />
                </div>

                {/* Danger Zone: Reset All Data */}
                <div className="pt-3 border-t border-[#e8eaf0] space-y-3">
                  <div className="flex items-center gap-2 mb-2">
                    <AlertTriangle className="size-4 text-[#EB5B3C]" />
                    <span className="text-xs font-bold uppercase tracking-wider text-[#EB5B3C]">Danger Zone</span>
                  </div>

                  {/* Reset Virtual Balance */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="size-9 rounded-lg bg-[#fef2ef] flex items-center justify-center">
                        <RotateCcw className="size-4 text-[#EB5B3C]" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-[#1a1a2e]">Reset Virtual Balance</p>
                        <p className="text-xs text-[#9ca3af]">Reset balance to ₹1,00,000</p>
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-xs font-semibold border-[#eb5b3c]/30 text-[#EB5B3C] hover:bg-[#fef2ef]"
                      onClick={handleResetBalance}
                    >
                      Reset
                    </Button>
                  </div>

                  {/* Reset All Trading Data */}
                  <div className="flex items-center justify-between p-3 rounded-xl bg-[#EB5B3C]/5 border border-[#EB5B3C]/15">
                    <div className="flex items-center gap-3">
                      <div className="size-9 rounded-lg bg-[#EB5B3C]/15 flex items-center justify-center">
                        <AlertCircle className="size-4 text-[#EB5B3C]" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-[#1a1a2e]">Reset All Trading Data</p>
                        <p className="text-xs text-[#EB5B3C]/80">Delete all trades, positions, orders & reset balance</p>
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-xs font-semibold border-[#EB5B3C]/40 text-[#EB5B3C] bg-white hover:bg-[#EB5B3C] hover:text-white hover:border-[#EB5B3C]"
                      onClick={() => setResetDataOpen(true)}
                    >
                      Reset All Data
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>

          {/* ── 5. PERFORMANCE SUMMARY ───────────────────────────── */}
          <motion.div custom={si++} variants={fadeInUp} initial="hidden" animate="visible">
            <div className="bg-white border border-[#e8eaf0] rounded-2xl shadow-sm overflow-hidden">
              <div className="p-5 pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Trophy className="size-5 text-[#00D09C]" />
                    <h3 className="text-base font-semibold text-[#1a1a2e]">Performance Summary</h3>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs font-semibold text-[#5367ff] hover:text-[#4356e0] hover:bg-[#5367ff]/5"
                    onClick={() => setCurrentPage('analytics')}
                  >
                    View Full Report <ChevronRight className="size-3 ml-0.5" />
                  </Button>
                </div>
              </div>
              <div className="px-5 pb-5">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  {/* Total Trades */}
                  <div className="bg-[#f7f8fc] rounded-xl p-4 border border-[#e8eaf0]/50">
                    <div className="flex items-center gap-2 mb-2">
                      <BarChart3 className="size-4 text-[#5367ff]" />
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-[#9ca3af]">Total Trades</span>
                    </div>
                    <p className="text-xl font-bold text-[#1a1a2e]">{totalTrades}</p>
                  </div>

                  {/* Win Rate */}
                  <div className="bg-[#f7f8fc] rounded-xl p-4 border border-[#e8eaf0]/50">
                    <div className="flex items-center gap-2 mb-2">
                      <Target className="size-4 text-[#00D09C]" />
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-[#9ca3af]">Win Rate</span>
                    </div>
                    <p className={cn('text-xl font-bold', winRate >= 50 ? 'text-[#00D09C]' : 'text-[#EB5B3C]')}>
                      {Number(winRate).toFixed(1)}%
                    </p>
                  </div>

                  {/* Total P&L */}
                  <div className="bg-[#f7f8fc] rounded-xl p-4 border border-[#e8eaf0]/50">
                    <div className="flex items-center gap-2 mb-2">
                      {isProfit ? <TrendingUp className="size-4 text-[#00D09C]" /> : <TrendingDown className="size-4 text-[#EB5B3C]" />}
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-[#9ca3af]">Total P&L</span>
                    </div>
                    <p className={cn('text-xl font-bold', isProfit ? 'text-[#00D09C]' : 'text-[#EB5B3C]')}>
                      {isProfit ? '+' : ''}{formatINR(totalPnl)}
                    </p>
                  </div>

                  {/* Best Trade */}
                  <div className="bg-[#f7f8fc] rounded-xl p-4 border border-[#e8eaf0]/50">
                    <div className="flex items-center gap-2 mb-2">
                      <Star className="size-4 text-[#f59e0b]" />
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-[#9ca3af]">Best Trade</span>
                    </div>
                    <p className={cn('text-xl font-bold', bestTradePnl >= 0 ? 'text-[#00D09C]' : 'text-[#EB5B3C]')}>
                      {bestTradePnl > 0 ? '+' : ''}{formatINR(bestTradePnl)}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>

          {/* ── 6. PDF REPORT DOWNLOAD ───────────────────────────── */}
          <motion.div custom={si++} variants={fadeInUp} initial="hidden" animate="visible">
            <div className="bg-white border border-[#e8eaf0] rounded-2xl shadow-sm overflow-hidden">
              <div className="p-5 pb-3">
                <div className="flex items-center gap-2">
                  <FileBarChart className="size-5 text-[#00D09C]" />
                  <h3 className="text-base font-semibold text-[#1a1a2e]">Download Reports</h3>
                </div>
              </div>
              <div className="px-5 pb-5">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {/* Last Trade Report */}
                  <button
                    onClick={() => setConfirmDialog({ open: true, type: 'last' })}
                    disabled={downloadingReport !== null}
                    className="flex items-center gap-3 p-4 rounded-xl border border-[#e8eaf0] bg-[#f7f8fc] hover:bg-[#e6faf4] hover:border-[#00D09C]/30 transition-all group disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    <div className="size-10 rounded-lg bg-[#00D09C]/10 flex items-center justify-center shrink-0 group-hover:bg-[#00D09C]/20 transition-colors">
                      {downloadingReport === 'last' ? (
                        <Loader2 className="size-5 text-[#00D09C] animate-spin" />
                      ) : (
                        <Download className="size-5 text-[#00D09C]" />
                      )}
                    </div>
                    <div className="text-left">
                      <p className="text-sm font-semibold text-[#1a1a2e]">Last Trade</p>
                      <p className="text-[11px] text-[#9ca3af]">Download PDF</p>
                    </div>
                  </button>

                  {/* Monthly Report */}
                  <button
                    onClick={() => setConfirmDialog({ open: true, type: 'monthly' })}
                    disabled={downloadingReport !== null}
                    className="flex items-center gap-3 p-4 rounded-xl border border-[#e8eaf0] bg-[#f7f8fc] hover:bg-[#e6faf4] hover:border-[#00D09C]/30 transition-all group disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    <div className="size-10 rounded-lg bg-[#5367ff]/10 flex items-center justify-center shrink-0 group-hover:bg-[#5367ff]/20 transition-colors">
                      {downloadingReport === 'monthly' ? (
                        <Loader2 className="size-5 text-[#5367ff] animate-spin" />
                      ) : (
                        <Download className="size-5 text-[#5367ff]" />
                      )}
                    </div>
                    <div className="text-left">
                      <p className="text-sm font-semibold text-[#1a1a2e]">Monthly Report</p>
                      <p className="text-[11px] text-[#9ca3af]">Download PDF</p>
                    </div>
                  </button>

                  {/* Full Report */}
                  <button
                    onClick={() => setConfirmDialog({ open: true, type: 'full' })}
                    disabled={downloadingReport !== null}
                    className="flex items-center gap-3 p-4 rounded-xl border border-[#e8eaf0] bg-[#f7f8fc] hover:bg-[#e6faf4] hover:border-[#00D09C]/30 transition-all group disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    <div className="size-10 rounded-lg bg-[#f59e0b]/10 flex items-center justify-center shrink-0 group-hover:bg-[#f59e0b]/20 transition-colors">
                      {downloadingReport === 'full' ? (
                        <Loader2 className="size-5 text-[#f59e0b] animate-spin" />
                      ) : (
                        <Download className="size-5 text-[#f59e0b]" />
                      )}
                    </div>
                    <div className="text-left">
                      <p className="text-sm font-semibold text-[#1a1a2e]">Full Report</p>
                      <p className="text-[11px] text-[#9ca3af]">Download PDF</p>
                    </div>
                  </button>
                </div>
              </div>
            </div>
          </motion.div>

          {/* ── 7. SECURITY SECTION ──────────────────────────────── */}
          <motion.div custom={si++} variants={fadeInUp} initial="hidden" animate="visible">
            <div className="bg-white border border-[#e8eaf0] rounded-2xl shadow-sm overflow-hidden">
              <div className="p-5 pb-3">
                <div className="flex items-center gap-2">
                  <Lock className="size-5 text-[#00D09C]" />
                  <h3 className="text-base font-semibold text-[#1a1a2e]">Security</h3>
                </div>
              </div>
              <div className="px-5 pb-5 space-y-3">
                {/* Change Password */}
                <button
                  onClick={() => isOAuthUser ? toast.info('Your account uses Google authentication') : setChangePasswordOpen(true)}
                  className="flex items-center justify-between w-full p-3 rounded-xl hover:bg-[#f7f8fc] transition-colors group"
                >
                  <div className="flex items-center gap-3">
                    <div className="size-9 rounded-lg bg-[#f0f2f5] flex items-center justify-center group-hover:bg-[#e6faf4] transition-colors">
                      <KeyRound className="size-4 text-[#6b7280] group-hover:text-[#00D09C] transition-colors" />
                    </div>
                    <div className="text-left">
                      <p className="text-sm font-medium text-[#1a1a2e]">Change Password</p>
                      <p className="text-xs text-[#9ca3af]">{isOAuthUser ? 'Managed by Google' : 'Update your password'}</p>
                    </div>
                  </div>
                  <ChevronRight className="size-4 text-[#9ca3af]" />
                </button>

                {/* Enable 2FA */}
                <button
                  onClick={() => toast.info('Two-Factor Authentication is not available yet.')}
                  className="flex items-center justify-between w-full p-3 rounded-xl hover:bg-[#f7f8fc] transition-colors group"
                >
                  <div className="flex items-center gap-3">
                    <div className="size-9 rounded-lg bg-[#f0f2f5] flex items-center justify-center group-hover:bg-[#f0f2f5] transition-colors">
                      <Shield className="size-4 text-[#6b7280]" />
                    </div>
                    <div className="text-left">
                      <p className="text-sm font-medium text-[#1a1a2e]">Enable 2FA</p>
                      <p className="text-xs text-[#9ca3af]">Add an extra layer of security</p>
                    </div>
                  </div>
                  <Badge className="border-0 text-[10px] font-bold px-2 py-0.5 bg-[#f0f2f5] text-[#9ca3af]">Soon</Badge>
                </button>
              </div>
            </div>
          </motion.div>

          {/* ── 7.5. ACTIVE SESSIONS / DEVICES SECTION ─────────── */}
          <motion.div custom={si++} variants={fadeInUp} initial="hidden" animate="visible">
            <div className="bg-white border border-[#e8eaf0] rounded-2xl shadow-sm overflow-hidden">
              <div className="p-5 pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <MonitorSmartphone className="size-5 text-[#00D09C]" />
                    <h3 className="text-base font-semibold text-[#1a1a2e]">Active Devices</h3>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setCurrentPage('activeDevices')}
                      className="text-xs font-semibold text-[#5367ff] hover:text-[#4356e0] flex items-center gap-1 transition-colors"
                    >
                      View Details <ChevronRight className="size-3" />
                    </button>
                    {sessions.length > 1 && (
                      <button
                        onClick={() => setLogoutAllConfirmOpen(true)}
                        className="text-xs font-semibold text-[#EB5B3C] hover:text-[#d94f33] flex items-center gap-1 transition-colors"
                      >
                        <LogOut className="size-3" />
                        Logout All
                      </button>
                    )}
                  </div>
                </div>
                <p className="text-xs text-[#9ca3af] mt-1">
                  Your account is logged in on {sessions.length} device{sessions.length !== 1 ? 's' : ''}
                </p>
              </div>
              <div className="px-5 pb-5 space-y-2">
                {sessionsLoading ? (
                  // Loading skeleton
                  [1, 2].map(i => (
                    <div key={i} className="flex items-center gap-3 p-3 rounded-xl border border-[#e8eaf0]">
                      <div className="size-10 rounded-lg bg-[#f0f2f5] animate-pulse" />
                      <div className="flex-1 space-y-2">
                        <div className="h-3.5 w-32 rounded bg-[#f0f2f5] animate-pulse" />
                        <div className="h-3 w-24 rounded bg-[#f0f2f5] animate-pulse" />
                      </div>
                    </div>
                  ))
                ) : sessions.length === 0 ? (
                  <div className="py-6 text-center">
                    <MonitorSmartphone className="size-8 text-[#d1d5db] mx-auto mb-2" />
                    <p className="text-sm text-[#9ca3af]">No active sessions found</p>
                  </div>
                ) : (
                  sessions.map(session => (
                    <div
                      key={session.id}
                      className={cn(
                        "flex items-center gap-3 p-3 rounded-xl border transition-colors",
                        session.isCurrent
                          ? "border-[#00D09C]/20 bg-[#e6faf4]/30"
                          : "border-[#e8eaf0] hover:bg-[#f7f8fc]"
                      )}
                    >
                      {/* Device Icon */}
                      <div className={cn(
                        "size-10 rounded-lg flex items-center justify-center shrink-0",
                        session.isCurrent
                          ? "bg-[#00D09C]/10"
                          : session.deviceType === 'Mobile'
                            ? "bg-[#5367ff]/10"
                            : session.deviceType === 'Tablet'
                              ? "bg-[#f59e0b]/10"
                              : "bg-[#f0f2f5]"
                      )}>
                        {session.deviceType === 'Mobile' ? (
                          <Smartphone className={cn("size-5", session.isCurrent ? "text-[#00D09C]" : "text-[#5367ff]")} />
                        ) : session.deviceType === 'Tablet' ? (
                          <Tablet className={cn("size-5", session.isCurrent ? "text-[#00D09C]" : "text-[#f59e0b]")} />
                        ) : (
                          <Monitor className={cn("size-5", session.isCurrent ? "text-[#00D09C]" : "text-[#6b7280]")} />
                        )}
                      </div>

                      {/* Device Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-medium text-[#1a1a2e] truncate">{session.os}</p>
                          {session.isCurrent && (
                            <Badge className="bg-[#00D09C]/10 text-[#00D09C] hover:bg-[#00D09C]/20 border-0 text-[10px] px-1.5 py-0 font-semibold">
                              This Device
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5 text-[11px] text-[#9ca3af]">
                          <Globe className="size-3 shrink-0" />
                          <span className="truncate">{session.browser}</span>
                          {session.ipAddress && (
                            <>
                              <span className="text-[#d1d5db]">·</span>
                              <span className="truncate">{session.ipAddress.split(',')[0].trim()}</span>
                            </>
                          )}
                        </div>
                        {session.location && session.location !== 'Unknown Location' && (
                          <div className="flex items-center gap-1.5 mt-0.5 text-[11px] text-[#9ca3af]">
                            <MapPin className="size-3 shrink-0" />
                            <span className="truncate">{session.location}</span>
                          </div>
                        )}
                        <div className="flex items-center gap-1.5 mt-0.5 text-[11px] text-[#9ca3af]">
                          <Clock className="size-3 shrink-0" />
                          <span>{formatRelativeTime(session.createdAt)}</span>
                        </div>
                      </div>

                      {/* Logout Button */}
                      {!session.isCurrent && (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={loggingOutSessionId === session.id}
                          onClick={() => handleLogoutSession(session.id)}
                          className="text-[#9ca3af] hover:text-[#EB5B3C] hover:bg-[#EB5B3C]/5 shrink-0 gap-1"
                        >
                          {loggingOutSessionId === session.id ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <LogOut className="size-3.5" />
                          )}
                          <span className="hidden sm:inline text-xs">Logout</span>
                        </Button>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          </motion.div>

          {/* ── 8. HELP & SUPPORT ────────────────────────────────── */}
          <motion.div custom={si++} variants={fadeInUp} initial="hidden" animate="visible">
            <div className="bg-white border border-[#e8eaf0] rounded-2xl shadow-sm overflow-hidden">
              <div className="p-5 pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <HelpCircle className="size-5 text-[#00D09C]" />
                    <h3 className="text-base font-semibold text-[#1a1a2e]">Help & Support</h3>
                  </div>
                  <button
                    onClick={() => setCurrentPage('helpSupport')}
                    className="text-xs font-semibold text-[#5367ff] hover:text-[#4356e0] flex items-center gap-1 transition-colors"
                  >
                    View Details <ChevronRight className="size-3" />
                  </button>
                </div>
              </div>
              <div className="px-5 pb-5 space-y-3">
                {/* FAQ */}
                <button
                  onClick={() => setCurrentPage('helpSupport')}
                  className="flex items-center justify-between w-full p-3 rounded-xl hover:bg-[#f7f8fc] transition-colors group"
                >
                  <div className="flex items-center gap-3">
                    <div className="size-9 rounded-lg bg-[#f0f2f5] flex items-center justify-center group-hover:bg-[#e6faf4] transition-colors">
                      <HelpCircle className="size-4 text-[#6b7280] group-hover:text-[#00D09C] transition-colors" />
                    </div>
                    <div className="text-left">
                      <p className="text-sm font-medium text-[#1a1a2e]">FAQ</p>
                      <p className="text-xs text-[#9ca3af]">Frequently asked questions</p>
                    </div>
                  </div>
                  <ChevronRight className="size-4 text-[#9ca3af]" />
                </button>

                {/* Contact Support */}
                <button
                  onClick={() => setCurrentPage('helpSupport')}
                  className="flex items-center justify-between w-full p-3 rounded-xl hover:bg-[#f7f8fc] transition-colors group"
                >
                  <div className="flex items-center gap-3">
                    <div className="size-9 rounded-lg bg-[#f0f2f5] flex items-center justify-center group-hover:bg-[#e6faf4] transition-colors">
                      <MessageSquare className="size-4 text-[#6b7280] group-hover:text-[#00D09C] transition-colors" />
                    </div>
                    <div className="text-left">
                      <p className="text-sm font-medium text-[#1a1a2e]">Contact Support</p>
                      <p className="text-xs text-[#9ca3af]">Get in touch with our team</p>
                    </div>
                  </div>
                  <ChevronRight className="size-4 text-[#9ca3af]" />
                </button>

                {/* Raise a Ticket */}
                <button
                  onClick={() => setCurrentPage('helpSupport')}
                  className="flex items-center justify-between w-full p-3 rounded-xl hover:bg-[#f7f8fc] transition-colors group"
                >
                  <div className="flex items-center gap-3">
                    <div className="size-9 rounded-lg bg-[#f0f2f5] flex items-center justify-center group-hover:bg-[#5367ff]/10 transition-colors">
                      <Ticket className="size-4 text-[#6b7280] group-hover:text-[#5367ff] transition-colors" />
                    </div>
                    <div className="text-left">
                      <p className="text-sm font-medium text-[#1a1a2e]">Raise a Ticket</p>
                      <p className="text-xs text-[#9ca3af]">Report an issue or request a feature</p>
                    </div>
                  </div>
                  <ChevronRight className="size-4 text-[#9ca3af]" />
                </button>
              </div>
            </div>
          </motion.div>

          {/* ── 9. LOGOUT ────────────────────────────────────────── */}
          <motion.div custom={si++} variants={fadeInUp} initial="hidden" animate="visible">
            <button
              onClick={handleLogout}
              className="flex items-center justify-center gap-2 w-full p-4 rounded-2xl border border-[#eb5b3c]/20 bg-[#fef2ef] hover:bg-[#fde5dd] transition-colors group"
            >
              <LogOut className="size-5 text-[#EB5B3C] group-hover:translate-x-0.5 transition-transform" />
              <span className="text-sm font-bold text-[#EB5B3C]">Logout</span>
            </button>
          </motion.div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════
          ALL DIALOGS
      ═══════════════════════════════════════════════════════════ */}

      {/* ── Logout All Devices Confirmation Dialog ──────────── */}
      <Dialog open={logoutAllConfirmOpen} onOpenChange={setLogoutAllConfirmOpen}>
        <DialogContent className="sm:max-w-md bg-white border-[#e8eaf0]">
          <DialogHeader>
            <DialogTitle className="text-[#1a1a2e] flex items-center gap-2">
              <MonitorSmartphone className="size-5 text-[#EB5B3C]" /> Logout from all devices?
            </DialogTitle>
            <DialogDescription className="text-[#6b7280]">
              This will end all active sessions except your current device. You will need to login again on all other devices.
            </DialogDescription>
          </DialogHeader>
          <div className="py-3">
            <div className="p-3 rounded-xl bg-[#EB5B3C]/5 border border-[#EB5B3C]/20">
              <div className="flex items-start gap-2">
                <AlertTriangle className="size-4 text-[#EB5B3C] shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-[#1a1a2e]">
                    {sessions.filter(s => !s.isCurrent).length} other device{sessions.filter(s => !s.isCurrent).length !== 1 ? 's' : ''} will be logged out
                  </p>
                  <p className="text-xs text-[#9ca3af] mt-0.5">
                    Your current session will remain active.
                  </p>
                </div>
              </div>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <DialogClose asChild>
              <Button variant="outline" className="border-[#e8eaf0]" disabled={logoutAllSubmitting}>
                Cancel
              </Button>
            </DialogClose>
            <Button
              onClick={handleLogoutAll}
              disabled={logoutAllSubmitting}
              className="bg-[#EB5B3C] hover:bg-[#d94f33] text-white gap-2"
            >
              {logoutAllSubmitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Logging out...
                </>
              ) : (
                <>
                  <LogOut className="size-4" />
                  Logout All Devices
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Edit Profile Dialog ─────────────────────────────────── */}
      <Dialog open={editProfileOpen} onOpenChange={setEditProfileOpen}>
        <DialogContent className="sm:max-w-md bg-white border-[#e8eaf0]">
          <DialogHeader>
            <DialogTitle className="text-[#1a1a2e] flex items-center gap-2">
              <User className="size-5 text-[#00D09C]" /> Edit Profile
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label className="text-sm font-medium text-[#374151]">Full Name</Label>
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="border-[#e8eaf0] focus:border-[#00D09C] focus:ring-[#00D09C]/20"
                placeholder="Enter your name"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium text-[#374151]">Phone Number</Label>
              <Input
                value={editPhone}
                onChange={(e) => setEditPhone(e.target.value)}
                className="border-[#e8eaf0] focus:border-[#00D09C] focus:ring-[#00D09C]/20"
                placeholder="Enter phone number"
              />
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" className="border-[#e8eaf0]">Cancel</Button>
            </DialogClose>
            <Button
              onClick={handleEditProfile}
              disabled={editProfileSubmitting}
              className="bg-[#00D09C] hover:bg-[#00b888] text-white border-0"
            >
              {editProfileSubmitting ? <Loader2 className="size-4 animate-spin mr-2" /> : null}
              {editProfileSubmitting ? 'Saving...' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Change Password Dialog ──────────────────────────────── */}
      <Dialog open={changePasswordOpen} onOpenChange={setChangePasswordOpen}>
        <DialogContent className="sm:max-w-md bg-white border-[#e8eaf0]">
          <DialogHeader>
            <DialogTitle className="text-[#1a1a2e] flex items-center gap-2">
              <KeyRound className="size-5 text-[#00D09C]" /> Change Password
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label className="text-sm font-medium text-[#374151]">Current Password</Label>
              <div className="relative">
                <Input
                  type={showCurrentPassword ? 'text' : 'password'}
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="border-[#e8eaf0] focus:border-[#00D09C] focus:ring-[#00D09C]/20 pr-10"
                  placeholder="Enter current password"
                />
                <button
                  onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#9ca3af] hover:text-[#374151]"
                >
                  {showCurrentPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium text-[#374151]">New Password</Label>
              <div className="relative">
                <Input
                  type={showNewPassword ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="border-[#e8eaf0] focus:border-[#00D09C] focus:ring-[#00D09C]/20 pr-10"
                  placeholder="Enter new password"
                />
                <button
                  onClick={() => setShowNewPassword(!showNewPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#9ca3af] hover:text-[#374151]"
                >
                  {showNewPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium text-[#374151]">Confirm New Password</Label>
              <Input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="border-[#e8eaf0] focus:border-[#00D09C] focus:ring-[#00D09C]/20"
                placeholder="Confirm new password"
              />
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" className="border-[#e8eaf0]">Cancel</Button>
            </DialogClose>
            <Button
              onClick={handleChangePassword}
              disabled={changePasswordSubmitting}
              className="bg-[#00D09C] hover:bg-[#00b888] text-white border-0"
            >
              {changePasswordSubmitting ? <Loader2 className="size-4 animate-spin mr-2" /> : null}
              {changePasswordSubmitting ? 'Changing...' : 'Change Password'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Add Money Dialog ────────────────────────────────────── */}
      <Dialog open={addMoneyOpen} onOpenChange={setAddMoneyOpen}>
        <DialogContent className="sm:max-w-md bg-white border-[#e8eaf0]">
          <DialogHeader>
            <DialogTitle className="text-[#1a1a2e] flex items-center gap-2">
              <Plus className="size-5 text-[#00D09C]" /> Add Money
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label className="text-sm font-medium text-[#374151]">Amount (₹)</Label>
              <Input
                type="number"
                value={addMoneyAmount}
                onChange={(e) => setAddMoneyAmount(e.target.value)}
                className="border-[#e8eaf0] focus:border-[#00D09C] focus:ring-[#00D09C]/20 text-lg font-mono"
                placeholder="Enter amount"
              />
            </div>
            <div className="flex gap-2 flex-wrap">
              {[10000, 25000, 50000, 100000].map(amt => (
                <button
                  key={amt}
                  onClick={() => setAddMoneyAmount(String(amt))}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold bg-[#f0f2f5] text-[#6b7280] hover:bg-[#e6faf4] hover:text-[#00D09C] transition-colors"
                >
                  ₹{(amt / 1000)}K
                </button>
              ))}
            </div>
            <p className="text-xs text-[#9ca3af]">Current Balance: {formatINRWhole(availableBalance)}</p>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" className="border-[#e8eaf0]">Cancel</Button>
            </DialogClose>
            <Button
              onClick={handleAddMoney}
              disabled={addMoneySubmitting}
              className="bg-[#00D09C] hover:bg-[#00b888] text-white border-0"
            >
              {addMoneySubmitting ? <Loader2 className="size-4 animate-spin mr-2" /> : null}
              {addMoneySubmitting ? 'Adding...' : 'Add Money'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Withdraw Dialog ─────────────────────────────────────── */}
      <Dialog open={withdrawOpen} onOpenChange={setWithdrawOpen}>
        <DialogContent className="sm:max-w-md bg-white border-[#e8eaf0]">
          <DialogHeader>
            <DialogTitle className="text-[#1a1a2e] flex items-center gap-2">
              <ArrowUpRight className="size-5 text-[#EB5B3C]" /> Withdraw
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label className="text-sm font-medium text-[#374151]">Amount (₹)</Label>
              <Input
                type="number"
                value={withdrawAmount}
                onChange={(e) => setWithdrawAmount(e.target.value)}
                className="border-[#e8eaf0] focus:border-[#eb5b3c] focus:ring-[#eb5b3c]/20 text-lg font-mono"
                placeholder="Enter amount"
              />
            </div>
            <p className="text-xs text-[#9ca3af]">Available: {formatINRWhole(availableBalance)}</p>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" className="border-[#e8eaf0]">Cancel</Button>
            </DialogClose>
            <Button
              onClick={handleWithdraw}
              disabled={withdrawSubmitting}
              className="bg-[#eb5b3c] hover:bg-[#d44f33] text-white border-0"
            >
              {withdrawSubmitting ? <Loader2 className="size-4 animate-spin mr-2" /> : null}
              {withdrawSubmitting ? 'Withdrawing...' : 'Withdraw'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Raise Ticket Dialog ─────────────────────────────────── */}
      <Dialog open={raiseTicketOpen} onOpenChange={setRaiseTicketOpen}>
        <DialogContent className="sm:max-w-md bg-white border-[#e8eaf0]">
          <DialogHeader>
            <DialogTitle className="text-[#1a1a2e] flex items-center gap-2">
              <Ticket className="size-5 text-[#5367ff]" /> Raise a Ticket
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label className="text-sm font-medium text-[#374151]">Subject</Label>
              <Input
                value={ticketSubject}
                onChange={(e) => setTicketSubject(e.target.value)}
                className="border-[#e8eaf0] focus:border-[#5367ff] focus:ring-[#5367ff]/20"
                placeholder="Brief description of your issue"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium text-[#374151]">Message</Label>
              <textarea
                value={ticketMessage}
                onChange={(e) => setTicketMessage(e.target.value)}
                rows={4}
                className="w-full rounded-md border border-[#e8eaf0] bg-white px-3 py-2 text-sm focus:border-[#5367ff] focus:ring-[#5367ff]/20 focus:outline-none resize-none"
                placeholder="Describe your issue in detail..."
              />
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" className="border-[#e8eaf0]">Cancel</Button>
            </DialogClose>
            <Button
              onClick={handleRaiseTicket}
              disabled={ticketSubmitting}
              className="bg-[#5367ff] hover:bg-[#4356e0] text-white border-0"
            >
              {ticketSubmitting ? <Loader2 className="size-4 animate-spin mr-2" /> : null}
              {ticketSubmitting ? 'Submitting...' : 'Submit Ticket'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Reset All Data Confirmation Dialog ──────────────────────── */}
      <Dialog open={resetDataOpen} onOpenChange={(open) => {
        setResetDataOpen(open)
        if (!open) setResetConfirmText('')
      }}>
        <DialogContent className="sm:max-w-md bg-white border-[#EB5B3C]/20">
          <DialogHeader>
            <DialogTitle className="text-[#1a1a2e] flex items-center gap-2">
              <div className="size-8 rounded-lg bg-[#EB5B3C]/10 flex items-center justify-center">
                <AlertTriangle className="size-4 text-[#EB5B3C]" />
              </div>
              Reset All Trading Data
            </DialogTitle>
            <DialogDescription className="text-[#6b7280]">
              This action cannot be undone. All your trading data will be permanently deleted.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* What will be deleted */}
            <div className="rounded-xl border border-[#EB5B3C]/15 bg-[#EB5B3C]/5 p-4 space-y-2">
              <p className="text-xs font-bold uppercase tracking-wider text-[#EB5B3C]">This will delete:</p>
              <div className="space-y-1.5">
                {[
                  'All open & closed positions',
                  'All trade history',
                  'All pending orders',
                  'All portfolio snapshots',
                  'Watchlist items',
                  'Notifications',
                ].map((item, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <X className="size-3 text-[#EB5B3C]" />
                    <span className="text-sm text-[#374151]">{item}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* What will be reset */}
            <div className="rounded-xl border border-[#00D09C]/15 bg-[#00D09C]/5 p-4 space-y-2">
              <p className="text-xs font-bold uppercase tracking-wider text-[#00D09C]">This will reset:</p>
              <div className="space-y-1.5">
                {[
                  'Virtual balance → ₹1,00,000',
                  'Total trades → 0',
                  'Win rate → 0%',
                  'Total P&L → ₹0',
                ].map((item, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <RotateCcw className="size-3 text-[#00D09C]" />
                    <span className="text-sm text-[#374151]">{item}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Confirmation input */}
            <div className="space-y-2">
              <Label className="text-sm font-medium text-[#374151]">
                Type <span className="font-bold text-[#EB5B3C]">RESET</span> to confirm
              </Label>
              <Input
                value={resetConfirmText}
                onChange={(e) => setResetConfirmText(e.target.value.toUpperCase())}
                className="border-[#EB5B3C]/30 focus:border-[#EB5B3C] focus:ring-[#EB5B3C]/20 text-center font-bold tracking-widest"
                placeholder="RESET"
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <DialogClose asChild>
              <Button variant="outline" className="border-[#e8eaf0]">Cancel</Button>
            </DialogClose>
            <Button
              onClick={handleResetAllData}
              disabled={resetDataSubmitting || resetConfirmText !== 'RESET'}
              className="bg-[#EB5B3C] hover:bg-[#d44a2d] text-white border-0 disabled:opacity-50"
            >
              {resetDataSubmitting ? <Loader2 className="size-4 animate-spin mr-2" /> : <AlertTriangle className="size-4 mr-2" />}
              {resetDataSubmitting ? 'Resetting...' : 'Reset All Data'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── PDF Download Confirmation Dialog ──────────────────────────── */}
      <Dialog
        open={confirmDialog.open}
        onOpenChange={(open) => setConfirmDialog({ open, type: open ? confirmDialog.type : null })}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-[#1a1a2e] flex items-center gap-2">
              <div className="size-8 rounded-lg bg-[#00D09C]/10 flex items-center justify-center">
                <FileText className="size-4 text-[#00D09C]" />
              </div>
              Download {confirmDialog.type === 'last' ? 'Last Trade' : confirmDialog.type === 'monthly' ? 'Monthly' : 'Full Trading'} Report
            </DialogTitle>
            <DialogDescription className="text-[#9ca3af]">
              {confirmDialog.type === 'last'
                ? 'Generate a PDF report of your most recent trade.'
                : confirmDialog.type === 'monthly'
                ? 'Generate a PDF report of all trades from the last 30 days.'
                : 'Generate a comprehensive PDF of all your trading data.'}
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-xl border border-[#e8eaf0] bg-[#f7f8fc] p-4 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-[#9ca3af]">
              Report includes:
            </p>
            <div className="space-y-2">
              {[
                'User profile & account details',
                'Trade details table with P&L',
                'Performance summary & stats',
                'Brokerage breakdown',
                'AI analysis & suggestions',
              ].map((item, i) => (
                <div key={i} className="flex items-center gap-2">
                  <div className="size-4 rounded-full bg-[#00D09C]/10 flex items-center justify-center shrink-0">
                    <svg className="size-2.5 text-[#00D09C]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <span className="text-sm text-[#1a1a2e]">{item}</span>
                </div>
              ))}
            </div>

            {confirmDialog.type && (
              <div className="pt-2 border-t border-[#e8eaf0]">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[#9ca3af]">Trade count:</span>
                  <span className="font-semibold text-[#1a1a2e]">
                    {confirmDialog.type === 'last' ? '1 trade' : confirmDialog.type === 'monthly' ? 'Last 30 days' : 'All trades'}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs mt-1">
                  <span className="text-[#9ca3af]">Format:</span>
                  <span className="font-semibold text-[#1a1a2e]">PDF Document</span>
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              className="rounded-lg border-[#e8eaf0] text-[#6b7280] hover:bg-[#f5f7fa]"
              onClick={() => setConfirmDialog({ open: false, type: null })}
              disabled={downloadingReport !== null}
            >
              Cancel
            </Button>
            <Button
              className="gap-2 bg-[#00D09C] hover:bg-[#00b88a] text-white font-semibold rounded-lg min-w-[140px]"
              onClick={() => {
                if (confirmDialog.type) {
                  handleDownloadReport(confirmDialog.type)
                }
              }}
              disabled={downloadingReport !== null}
            >
              {downloadingReport !== null ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Download className="size-4" />
                  Download PDF
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
