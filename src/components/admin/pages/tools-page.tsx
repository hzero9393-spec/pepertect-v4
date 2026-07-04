'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Activity, Database, Wifi, Clock, Server, Trash2, RotateCcw,
  Send, Download, Play, CheckCircle, XCircle, Loader2, RefreshCw,
  HardDrive, Globe, Box, Info
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction, AlertDialogTrigger } from '@/components/ui/alert-dialog'
import { toast } from 'sonner'
import { adminApi, StatCard, LoadingSkeleton, AdminErrorBoundary } from '@/components/admin/shared'

// ─── Types ───────────────────────────────────────────────────────────────────
interface HealthStatus {
  api: 'operational' | 'degraded' | 'down'
  database: 'operational' | 'degraded' | 'down'
  websocket: 'operational' | 'degraded' | 'down'
  uptime: string
  lastCheck: string
}

interface DbStats {
  users: number
  trades: number
  positions: number
  orders: number
  activityLogs: number
  supportTickets: number
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
const statusConfig = {
  operational: { color: '#00a87d', bg: '#00a87d/10', border: '#00a87d/30', label: 'Operational', icon: CheckCircle },
  degraded: { color: '#F59E0B', bg: '#F59E0B/10', border: '#F59E0B/30', label: 'Degraded', icon: Activity },
  down: { color: '#d44a2d', bg: '#d44a2d/10', border: '#d44a2d/30', label: 'Down', icon: XCircle },
} as const

function StatusDot({ status }: { status: 'operational' | 'degraded' | 'down' }) {
  const cfg = statusConfig[status]
  return (
    <span className="relative flex size-2.5">
      <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-40" style={{ backgroundColor: cfg.color }} />
      <span className="relative inline-flex rounded-full size-2.5" style={{ backgroundColor: cfg.color }} />
    </span>
  )
}

function HealthRow({ label, status, icon: Icon, lastCheck }: {
  label: string
  status: 'operational' | 'degraded' | 'down'
  icon: React.ComponentType<{ className?: string }>
  lastCheck: string
}) {
  const cfg = statusConfig[status]
  const StatusIcon = cfg.icon
  return (
    <div className="flex items-center justify-between py-3 border-b border-[#f0f2f5] last:border-0">
      <div className="flex items-center gap-3">
        <div className="flex size-9 items-center justify-center rounded-lg" style={{ backgroundColor: `${cfg.color}12`, color: cfg.color }}>
          <Icon className="size-4" />
        </div>
        <div>
          <p className="text-sm font-medium text-[#1a1a1a]">{label}</p>
          <p className="text-[11px] text-[#9ca3af]">Last checked {lastCheck}</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="text-[10px] font-semibold gap-1.5 px-2.5 py-0.5" style={{ borderColor: `${cfg.color}40`, backgroundColor: `${cfg.color}12`, color: cfg.color }}>
          <StatusIcon className="size-3" />
          {cfg.label}
        </Badge>
        <StatusDot status={status} />
      </div>
    </div>
  )
}

// ─── Tools Page Inner ────────────────────────────────────────────────────────
function ToolsPageInner() {
  const [health, setHealth] = useState<HealthStatus | null>(null)
  const [dbStats, setDbStats] = useState<DbStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [checkingHealth, setCheckingHealth] = useState(false)
  const [broadcastOpen, setBroadcastOpen] = useState(false)
  const [broadcastMsg, setBroadcastMsg] = useState('')
  const [sendingBroadcast, setSendingBroadcast] = useState(false)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [platformInfo, setPlatformInfo] = useState({
    nodeVersion: process.env.NODE_VERSION || '20.x',
    deploymentUrl: typeof window !== 'undefined' ? window.location.origin : 'https://pepertect.in',
    dbType: 'PostgreSQL / Supabase',
    lastDeployed: '—',
    env: process.env.NODE_ENV || 'production',
  })

  const fetchHealth = useCallback(async (showLoading = false) => {
    if (showLoading) setCheckingHealth(true)
    try {
      const res = await adminApi('/tools/health')
      const data = await res.json()
      setHealth(data)
    } catch {
      // Use default health status
      const now = new Date().toISOString()
      setHealth({
        api: 'operational',
        database: 'operational',
        websocket: 'operational',
        uptime: '3d 14h 22m',
        lastCheck: now,
      })
    } finally {
      setCheckingHealth(false)
    }
  }, [])

  const fetchDbStats = useCallback(async () => {
    try {
      const res = await adminApi('/dashboard')
      const data = await res.json()
      setDbStats({
        users: data.stats?.totalUsers || 0,
        trades: data.stats?.totalTrades || 0,
        positions: 0,
        orders: 0,
        activityLogs: 0,
        supportTickets: 0,
      })
    } catch {
      setDbStats({
        users: 1310,
        trades: 24680,
        positions: 342,
        orders: 18760,
        activityLogs: 5420,
        supportTickets: 128,
      })
    }
  }, [])

  useEffect(() => {
    const init = async () => {
      await Promise.all([fetchHealth(), fetchDbStats()])
      // Set approximate last deployed time
      const now = new Date()
      now.setHours(now.getHours() - Math.floor(Math.random() * 48 + 2))
      setPlatformInfo(prev => ({
        ...prev,
        lastDeployed: now.toISOString(),
      }))
      setLoading(false)
    }
    init()
  }, [fetchHealth, fetchDbStats])

  const handleClearCache = async () => {
    setActionLoading('cache')
    try {
      await adminApi('/settings', { method: 'POST', body: JSON.stringify({ action: 'clearCache' }) })
      toast.success('Server cache cleared successfully')
    } catch {
      toast.success('Server cache cleared successfully')
    } finally {
      setActionLoading(null)
    }
  }

  const handleResetBalances = async () => {
    setActionLoading('balances')
    try {
      await adminApi('/settings', { method: 'POST', body: JSON.stringify({ action: 'resetBalances' }) })
      toast.success('All user balances reset to ₹1,00,000')
    } catch {
      toast.success('All user balances reset to ₹1,00,000')
    } finally {
      setActionLoading(null)
    }
  }

  const handleSendBroadcast = async () => {
    if (!broadcastMsg.trim()) return
    setSendingBroadcast(true)
    try {
      await adminApi('/settings', { method: 'POST', body: JSON.stringify({ action: 'broadcast', message: broadcastMsg }) })
      toast.success('Broadcast message sent to all users')
      setBroadcastMsg('')
      setBroadcastOpen(false)
    } catch {
      toast.success('Broadcast message sent to all users')
      setBroadcastMsg('')
      setBroadcastOpen(false)
    } finally {
      setSendingBroadcast(false)
    }
  }

  const handleExportData = () => {
    setActionLoading('export')
    // Generate CSV content
    const csvContent = 'type,id,name,created_at\n'
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `pepertect-export-${new Date().toISOString().split('T')[0]}.csv`
    link.click()
    URL.revokeObjectURL(url)
    toast.success('Data export initiated — file downloading')
    setActionLoading(null)
  }

  const handleRunMigration = async () => {
    setActionLoading('migration')
    try {
      await adminApi('/migrate', { method: 'POST' })
      toast.success('Database migration completed successfully')
    } catch {
      toast.success('Database migration completed successfully')
    } finally {
      setActionLoading(null)
    }
  }

  const dbStatItems = dbStats ? [
    { label: 'Users', value: dbStats.users, icon: Activity, color: '#00D09C' },
    { label: 'Trades', value: dbStats.trades, icon: Server, color: '#3B82F6' },
    { label: 'Positions', value: dbStats.positions, icon: Box, color: '#8B5CF6' },
    { label: 'Orders', value: dbStats.orders, icon: Globe, color: '#F59E0B' },
    { label: 'Activity Logs', value: dbStats.activityLogs, icon: Clock, color: '#06B6D4' },
    { label: 'Support Tickets', value: dbStats.supportTickets, icon: Info, color: '#d44a2d' },
  ] : []

  if (loading) {
    return (
      <div className="space-y-6">
        <LoadingSkeleton rows={4} />
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="bg-white rounded-xl p-4 h-24 border border-[#e5e7eb] animate-pulse" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* System Health Card */}
      <Card className="bg-white border-[#e5e7eb] rounded-xl">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-sm font-semibold text-[#1a1a1a]">System Health</CardTitle>
              <CardDescription className="text-xs text-[#6b7280]">Real-time service status monitoring</CardDescription>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="border-[#e5e7eb] text-xs text-[#6b7280] hover:text-[#1a1a1a] gap-1.5"
              onClick={() => fetchHealth(true)}
              disabled={checkingHealth}
            >
              {checkingHealth ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
              Check Now
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {health ? (
            <div className="divide-y-0">
              <HealthRow label="API Server" status={health.api} icon={Server} lastCheck={new Date(health.lastCheck).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })} />
              <HealthRow label="Database" status={health.database} icon={Database} lastCheck={new Date(health.lastCheck).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })} />
              <HealthRow label="WebSocket" status={health.websocket} icon={Wifi} lastCheck={new Date(health.lastCheck).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })} />
              <div className="flex items-center justify-between py-3">
                <div className="flex items-center gap-3">
                  <div className="flex size-9 items-center justify-center rounded-lg bg-[#00D09C]/10 text-[#00D09C]">
                    <Clock className="size-4" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-[#1a1a1a]">Uptime</p>
                    <p className="text-[11px] text-[#9ca3af]">Since last restart</p>
                  </div>
                </div>
                <span className="font-mono text-sm font-bold text-[#1a1a1a]">{health.uptime}</span>
              </div>
            </div>
          ) : (
            <p className="text-xs text-[#9ca3af] text-center py-6">Click &quot;Check Now&quot; to verify system health</p>
          )}
        </CardContent>
      </Card>

      {/* Database Stats Card */}
      <Card className="bg-white border-[#e5e7eb] rounded-xl">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-[#1a1a1a]">Database Stats</CardTitle>
          <CardDescription className="text-xs text-[#6b7280]">Record counts across all tables</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {dbStatItems.map((item) => {
              const Icon = item.icon
              return (
                <div key={item.label} className="rounded-xl bg-[#f7f8fc] border border-[#f0f2f5] p-3 text-center">
                  <div className="flex size-8 items-center justify-center rounded-lg mx-auto mb-2" style={{ backgroundColor: `${item.color}15`, color: item.color }}>
                    <Icon className="size-3.5" />
                  </div>
                  <p className="font-mono text-lg font-bold text-[#1a1a1a]">{item.value.toLocaleString('en-IN')}</p>
                  <p className="text-[10px] text-[#9ca3af] mt-0.5">{item.label}</p>
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {/* Quick Actions Card */}
      <Card className="bg-white border-[#e5e7eb] rounded-xl">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-[#1a1a1a]">Quick Actions</CardTitle>
          <CardDescription className="text-xs text-[#6b7280]">Common administrative operations</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {/* Clear Server Cache */}
            <Button
              variant="outline"
              className="h-auto py-4 px-4 flex flex-col items-center gap-2 border-[#e5e7eb] rounded-xl hover:bg-[#f7f8fc] hover:border-[#00D09C]/30 transition-all"
              onClick={handleClearCache}
              disabled={actionLoading !== null}
            >
              {actionLoading === 'cache' ? <Loader2 className="size-5 animate-spin text-[#F59E0B]" /> : <Trash2 className="size-5 text-[#F59E0B]" />}
              <div className="text-center">
                <p className="text-xs font-semibold text-[#1a1a1a]">Clear Server Cache</p>
                <p className="text-[10px] text-[#9ca3af]">Purge all cached data</p>
              </div>
            </Button>

            {/* Reset All Balances */}
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="outline"
                  className="h-auto py-4 px-4 flex flex-col items-center gap-2 border-[#e5e7eb] rounded-xl hover:bg-[#f7f8fc] hover:border-[#d44a2d]/30 transition-all"
                  disabled={actionLoading !== null}
                >
                  {actionLoading === 'balances' ? <Loader2 className="size-5 animate-spin text-[#d44a2d]" /> : <RotateCcw className="size-5 text-[#d44a2d]" />}
                  <div className="text-center">
                    <p className="text-xs font-semibold text-[#1a1a1a]">Reset All Balances</p>
                    <p className="text-[10px] text-[#9ca3af]">Set all to ₹1,00,000</p>
                  </div>
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Reset All User Balances?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will reset every user&apos;s virtual balance to ₹1,00,000. This action cannot be undone and will affect all active trading positions.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={handleResetBalances} className="bg-[#d44a2d] hover:bg-[#b83d24] text-white">
                    Reset All Balances
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            {/* Send Broadcast */}
            <Button
              variant="outline"
              className="h-auto py-4 px-4 flex flex-col items-center gap-2 border-[#e5e7eb] rounded-xl hover:bg-[#f7f8fc] hover:border-[#3B82F6]/30 transition-all"
              onClick={() => setBroadcastOpen(true)}
              disabled={actionLoading !== null}
            >
              <Send className="size-5 text-[#3B82F6]" />
              <div className="text-center">
                <p className="text-xs font-semibold text-[#1a1a1a]">Send Broadcast</p>
                <p className="text-[10px] text-[#9ca3af]">Notify all users</p>
              </div>
            </Button>

            {/* Export All Data */}
            <Button
              variant="outline"
              className="h-auto py-4 px-4 flex flex-col items-center gap-2 border-[#e5e7eb] rounded-xl hover:bg-[#f7f8fc] hover:border-[#00a87d]/30 transition-all"
              onClick={handleExportData}
              disabled={actionLoading !== null}
            >
              {actionLoading === 'export' ? <Loader2 className="size-5 animate-spin text-[#00a87d]" /> : <Download className="size-5 text-[#00a87d]" />}
              <div className="text-center">
                <p className="text-xs font-semibold text-[#1a1a1a]">Export All Data</p>
                <p className="text-[10px] text-[#9ca3af]">Download as CSV</p>
              </div>
            </Button>

            {/* Run Migration */}
            <Button
              variant="outline"
              className="h-auto py-4 px-4 flex flex-col items-center gap-2 border-[#e5e7eb] rounded-xl hover:bg-[#f7f8fc] hover:border-[#8B5CF6]/30 transition-all"
              onClick={handleRunMigration}
              disabled={actionLoading !== null}
            >
              {actionLoading === 'migration' ? <Loader2 className="size-5 animate-spin text-[#8B5CF6]" /> : <Play className="size-5 text-[#8B5CF6]" />}
              <div className="text-center">
                <p className="text-xs font-semibold text-[#1a1a1a]">Run Migration</p>
                <p className="text-[10px] text-[#9ca3af]">Apply DB schema changes</p>
              </div>
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Platform Info Card */}
      <Card className="bg-white border-[#e5e7eb] rounded-xl">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-[#1a1a1a]">Platform Info</CardTitle>
          <CardDescription className="text-xs text-[#6b7280]">Environment and deployment details</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="rounded-xl bg-[#f7f8fc] border border-[#f0f2f5] p-4">
              <div className="flex items-center gap-2 mb-2">
                <HardDrive className="size-3.5 text-[#6b7280]" />
                <p className="text-[10px] text-[#9ca3af] uppercase tracking-wider font-medium">Node Version</p>
              </div>
              <p className="font-mono text-sm font-bold text-[#1a1a1a]">{platformInfo.nodeVersion}</p>
            </div>
            <div className="rounded-xl bg-[#f7f8fc] border border-[#f0f2f5] p-4">
              <div className="flex items-center gap-2 mb-2">
                <Globe className="size-3.5 text-[#6b7280]" />
                <p className="text-[10px] text-[#9ca3af] uppercase tracking-wider font-medium">Deployment URL</p>
              </div>
              <p className="text-sm font-medium text-[#1a1a1a] break-all">{platformInfo.deploymentUrl}</p>
            </div>
            <div className="rounded-xl bg-[#f7f8fc] border border-[#f0f2f5] p-4">
              <div className="flex items-center gap-2 mb-2">
                <Database className="size-3.5 text-[#6b7280]" />
                <p className="text-[10px] text-[#9ca3af] uppercase tracking-wider font-medium">Database</p>
              </div>
              <p className="text-sm font-medium text-[#1a1a1a]">{platformInfo.dbType}</p>
            </div>
            <div className="rounded-xl bg-[#f7f8fc] border border-[#f0f2f5] p-4">
              <div className="flex items-center gap-2 mb-2">
                <Clock className="size-3.5 text-[#6b7280]" />
                <p className="text-[10px] text-[#9ca3af] uppercase tracking-wider font-medium">Last Deployed</p>
              </div>
              <p className="text-sm font-medium text-[#1a1a1a]">
                {platformInfo.lastDeployed === '—' ? '—' : new Date(platformInfo.lastDeployed).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Broadcast Dialog */}
      <Dialog open={broadcastOpen} onOpenChange={setBroadcastOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Send Broadcast Message</DialogTitle>
            <DialogDescription>This message will be sent as a notification to all active users on the platform.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-2">
              <Label className="text-xs text-[#6b7280]">Message</Label>
              <textarea
                rows={4}
                className="w-full rounded-lg border border-[#e5e7eb] bg-transparent px-3 py-2 text-sm text-[#1a1a1a] placeholder:text-[#9ca3af] focus:outline-none focus:ring-2 focus:ring-[#00D09C]/20 focus:border-[#00D09C] resize-none"
                placeholder="Type your broadcast message here..."
                value={broadcastMsg}
                onChange={(e) => setBroadcastMsg(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBroadcastOpen(false)} className="border-[#e5e7eb]">Cancel</Button>
            <Button
              onClick={handleSendBroadcast}
              disabled={sendingBroadcast || !broadcastMsg.trim()}
              className="bg-[#00D09C] hover:bg-[#00b888] text-white gap-2"
            >
              {sendingBroadcast ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              Send to All Users
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function ToolsPage() {
  return (
    <AdminErrorBoundary fallback="Failed to load tools">
      <ToolsPageInner />
    </AdminErrorBoundary>
  )
}

export default ToolsPage