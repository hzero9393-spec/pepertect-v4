'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Search, RefreshCw, Shield, ShieldOff, Settings, UserCog,
  LogIn, LogOut, Activity, TrendingUp, Clock
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  adminApi, formatDate, LoadingSkeleton,
  EmptyState, SimplePagination, AdminErrorBoundary
} from '@/components/admin/shared'

// ─── Types ───────────────────────────────────────────────────────────────────
type ActionType = 'LOGIN' | 'LOGOUT' | 'USER_UPDATE' | 'TRADE' | 'SETTINGS' | 'SYSTEM'

interface ActivityLog {
  id: string
  adminId: string
  adminName: string
  action: ActionType
  details: string
  ipAddress: string
  createdAt: string
}

// ─── Action Configs ──────────────────────────────────────────────────────────
const actionConfig: Record<ActionType, { color: string; bg: string; border: string; label: string; icon: React.ComponentType<{ className?: string }> }> = {
  LOGIN:     { color: '#00a87d', bg: '#00a87d/10', border: '#00a87d/30', label: 'LOGIN', icon: LogIn },
  LOGOUT:    { color: '#6b7280', bg: '#6b7280/10', border: '#6b7280/30', label: 'LOGOUT', icon: LogOut },
  USER_UPDATE: { color: '#3B82F6', bg: '#3B82F6/10', border: '#3B82F6/30', label: 'USER_UPDATE', icon: UserCog },
  TRADE:     { color: '#8B5CF6', bg: '#8B5CF6/10', border: '#8B5CF6/30', label: 'TRADE', icon: TrendingUp },
  SETTINGS:  { color: '#F59E0B', bg: '#F59E0B/10', border: '#F59E0B/30', label: 'SETTINGS', icon: Settings },
  SYSTEM:    { color: '#d44a2d', bg: '#d44a2d/10', border: '#d44a2d/30', label: 'SYSTEM', icon: Activity },
}

// ─── Mock Data ───────────────────────────────────────────────────────────────
const mockLogs: ActivityLog[] = [
  { id: 'log_001', adminId: 'adm_01', adminName: 'Admin Main', action: 'LOGIN', details: 'Admin logged in successfully from Chrome on macOS', ipAddress: '103.45.167.89', createdAt: '2025-01-15T14:32:00.000Z' },
  { id: 'log_002', adminId: 'adm_01', adminName: 'Admin Main', action: 'USER_UPDATE', details: 'Updated subscription for Arjun Mehta (usr_1001) from FREE to PREMIUM', ipAddress: '103.45.167.89', createdAt: '2025-01-15T14:28:00.000Z' },
  { id: 'log_003', adminId: 'adm_02', adminName: 'Support Agent', action: 'TRADE', details: 'Manually squared off position POS_3012 for Rahul Verma (bankrupt risk)', ipAddress: '45.33.210.12', createdAt: '2025-01-15T13:55:00.000Z' },
  { id: 'log_004', adminId: 'adm_01', adminName: 'Admin Main', action: 'SETTINGS', details: 'Changed subscription price from ₹79 to ₹99/month', ipAddress: '103.45.167.89', createdAt: '2025-01-15T13:40:00.000Z' },
  { id: 'log_005', adminId: 'adm_01', adminName: 'Admin Main', action: 'USER_UPDATE', details: 'Blocked user Nitin Deshmukh (usr_1025) — suspicious activity detected', ipAddress: '103.45.167.89', createdAt: '2025-01-15T12:15:00.000Z' },
  { id: 'log_006', adminId: 'adm_03', adminName: 'Ops Admin', action: 'SYSTEM', details: 'Cleared server cache — memory usage was at 92%', ipAddress: '192.168.1.100', createdAt: '2025-01-15T11:30:00.000Z' },
  { id: 'log_007', adminId: 'adm_02', adminName: 'Support Agent', action: 'LOGIN', details: 'Admin logged in from Firefox on Windows 11', ipAddress: '45.33.210.12', createdAt: '2025-01-15T11:05:00.000Z' },
  { id: 'log_008', adminId: 'adm_01', adminName: 'Admin Main', action: 'USER_UPDATE', details: 'Reset virtual balance for Priya Sharma (usr_1002) to ₹1,00,000', ipAddress: '103.45.167.89', createdAt: '2025-01-15T10:42:00.000Z' },
  { id: 'log_009', adminId: 'adm_03', adminName: 'Ops Admin', action: 'SYSTEM', details: 'Ran database migration — added index on trades.executedAt', ipAddress: '192.168.1.100', createdAt: '2025-01-15T10:00:00.000Z' },
  { id: 'log_010', adminId: 'adm_02', adminName: 'Support Agent', action: 'TRADE', details: 'Reviewed and approved manual trade reversal for TKT-1004', ipAddress: '45.33.210.12', createdAt: '2025-01-15T09:30:00.000Z' },
  { id: 'log_011', adminId: 'adm_01', adminName: 'Admin Main', action: 'SETTINGS', details: 'Enabled maintenance mode for scheduled server upgrade', ipAddress: '103.45.167.89', createdAt: '2025-01-14T22:00:00.000Z' },
  { id: 'log_012', adminId: 'adm_01', adminName: 'Admin Main', action: 'SETTINGS', details: 'Disabled maintenance mode — server upgrade complete', ipAddress: '103.45.167.89', createdAt: '2025-01-14T22:45:00.000Z' },
  { id: 'log_013', adminId: 'adm_03', adminName: 'Ops Admin', action: 'SYSTEM', details: 'Broadcast message sent: "Platform maintenance completed. Thank you for your patience."', ipAddress: '192.168.1.100', createdAt: '2025-01-14T22:50:00.000Z' },
  { id: 'log_014', adminId: 'adm_02', adminName: 'Support Agent', action: 'USER_UPDATE', details: 'Unblocked user Arjun Mehta (usr_1001) after password reset verification', ipAddress: '45.33.210.12', createdAt: '2025-01-14T20:15:00.000Z' },
  { id: 'log_015', adminId: 'adm_01', adminName: 'Admin Main', action: 'LOGOUT', details: 'Admin session ended', ipAddress: '103.45.167.89', createdAt: '2025-01-14T19:00:00.000Z' },
  { id: 'log_016', adminId: 'adm_01', adminName: 'Admin Main', action: 'LOGIN', details: 'Admin logged in successfully from Safari on iPhone', ipAddress: '103.45.167.90', createdAt: '2025-01-14T19:05:00.000Z' },
  { id: 'log_017', adminId: 'adm_03', adminName: 'Ops Admin', action: 'SYSTEM', details: 'Exported full data backup — 2.4GB compressed archive generated', ipAddress: '192.168.1.100', createdAt: '2025-01-14T16:30:00.000Z' },
  { id: 'log_018', adminId: 'adm_02', adminName: 'Support Agent', action: 'TRADE', details: 'Investigated duplicate order issue for Praveen Yadav (usr_1040)', ipAddress: '45.33.210.12', createdAt: '2025-01-14T14:20:00.000Z' },
]

// ─── Activity Logs Page Inner ────────────────────────────────────────────────
function ActivityLogsPageInner() {
  const [logs, setLogs] = useState<ActivityLog[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [actionFilter, setActionFilter] = useState<string>('All')
  const [page, setPage] = useState(1)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const intervalRef = useRef<NodeJS.Timeout | null>(null)
  const initialFetchDone = useRef(false)
  const limit = 10

  const fetchLogs = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true)
    }

    try {
      const res = await adminApi(`/activity-logs?page=1&limit=50&action=${actionFilter !== 'All' ? actionFilter : ''}`)
      const data = await res.json()
      const mapped = (data.logs || []).map((l: any) => ({
        id: l.id,
        adminId: l.adminId || l.admin?.id || '',
        adminName: l.adminName || l.admin?.name || l.admin?.username || 'Unknown Admin',
        action: l.action,
        details: l.details,
        ipAddress: l.ipAddress || '—',
        createdAt: l.createdAt,
      }))
      setLogs(mapped)
    } catch {
      console.warn('[ActivityLogsPage] API fetch failed, using mock data')
      setLogs(mockLogs)
    } finally {
      setLoading(false)
      setRefreshing(false)
      setLastRefresh(new Date())
    }
  }, [actionFilter])

  // Initial fetch
  useEffect(() => {
    if (!initialFetchDone.current) {
      initialFetchDone.current = true
      fetchLogs()
    }
  }, [fetchLogs])

  // Auto-refresh every 30 seconds
  useEffect(() => {
    if (autoRefresh) {
      intervalRef.current = setInterval(() => {
        fetchLogs(true)
      }, 30000)
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [autoRefresh, fetchLogs])

  // Filter
  const filteredLogs = logs.filter((l) => {
    if (actionFilter !== 'All' && l.action !== actionFilter) return false
    if (search) {
      const q = search.toLowerCase()
      return (
        l.adminName.toLowerCase().includes(q) ||
        l.details.toLowerCase().includes(q) ||
        l.action.toLowerCase().includes(q) ||
        l.ipAddress.includes(q)
      )
    }
    return true
  })

  // Pagination
  const totalPages = Math.ceil(filteredLogs.length / limit)
  const paginatedLogs = filteredLogs.slice((page - 1) * limit, page * limit)

  const actionFilters: (ActionType | 'All')[] = ['All', 'LOGIN', 'LOGOUT', 'USER_UPDATE', 'TRADE', 'SETTINGS', 'SYSTEM']

  return (
    <div className="space-y-6">
      {/* Auto-refresh indicator */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {autoRefresh && lastRefresh && (
            <Badge variant="outline" className="text-[10px] font-medium gap-1.5 border-[#00a87d]/30 bg-[#00a87d]/10 text-[#00a87d]">
              <span className="relative flex size-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#00a87d] opacity-40" />
                <span className="relative inline-flex rounded-full size-2 bg-[#00a87d]" />
              </span>
              Auto-refreshing every 30s
            </Badge>
          )}
          {lastRefresh && (
            <span className="text-[10px] text-[#9ca3af]">Last updated {lastRefresh.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="border-[#e5e7eb] text-xs text-[#6b7280] hover:text-[#1a1a1a] gap-1.5 h-8"
            onClick={() => setAutoRefresh(!autoRefresh)}
          >
            {autoRefresh ? (
              <>
                <Clock className="size-3.5" />
                Auto: On
              </>
            ) : (
              <>
                <Clock className="size-3.5" />
                Auto: Off
              </>
            )}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="border-[#e5e7eb] text-xs text-[#6b7280] hover:text-[#1a1a1a] gap-1.5 h-8"
            onClick={() => fetchLogs(true)}
            disabled={refreshing}
          >
            {refreshing ? <RefreshCw className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
            Refresh
          </Button>
        </div>
      </div>

      {/* Filter Bar */}
      <Card className="bg-white border-[#e5e7eb] rounded-xl">
        <CardContent className="p-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#9ca3af]" />
              <Input
                placeholder="Search by admin, action, or details..."
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1) }}
                className="rounded-lg border-[#e5e7eb] bg-[#f0f2f5] text-[#1a1a1a] pl-10 h-10"
              />
            </div>
            <div className="inline-flex items-center gap-1 rounded-full bg-[#f0f2f5] p-1 border border-[#e5e7eb] overflow-x-auto">
              {actionFilters.map((f) => {
                const cfg = f !== 'All' ? actionConfig[f] : null
                return (
                  <button
                    key={f}
                    onClick={() => { setActionFilter(f); setPage(1) }}
                    className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                      actionFilter === f
                        ? cfg
                          ? 'text-white'
                          : 'bg-[#00D09C] text-white'
                        : 'text-[#6b7280] hover:text-[#1a1a1a]'
                    }`}
                    style={actionFilter === f && cfg ? { backgroundColor: cfg.color } : undefined}
                  >
                    {f}
                  </button>
                )
              })}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Logs Table */}
      <Card className="bg-white border-[#e5e7eb] rounded-xl">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold text-[#1a1a1a]">
              Activity Logs ({filteredLogs.length})
            </CardTitle>
            {refreshing && (
              <Badge variant="outline" className="text-[10px] gap-1.5 border-[#F59E0B]/30 bg-[#F59E0B]/10 text-[#F59E0B]">
                <RefreshCw className="size-3 animate-spin" />
                Syncing...
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <LoadingSkeleton rows={10} />
          ) : paginatedLogs.length === 0 ? (
            <EmptyState icon={Activity} title="No logs found" description="No activity logs match the current filters." />
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-[#e5e7eb] hover:bg-transparent">
                      <TableHead className="text-[#6b7280] text-xs">Timestamp</TableHead>
                      <TableHead className="text-[#6b7280] text-xs">Admin</TableHead>
                      <TableHead className="text-[#6b7280] text-xs">Action</TableHead>
                      <TableHead className="text-[#6b7280] text-xs">Details</TableHead>
                      <TableHead className="text-[#6b7280] text-xs hidden md:table-cell">IP Address</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedLogs.map((log) => {
                      const cfg = actionConfig[log.action] || actionConfig.SYSTEM
                      const ActionIcon = cfg.icon
                      return (
                        <TableRow key={log.id} className="border-[#f0f2f5] hover:bg-[#f7f8fc]">
                          <TableCell className="whitespace-nowrap">
                            <div>
                              <p className="text-[11px] text-[#1a1a1a]">{formatDate(log.createdAt)}</p>
                              <p className="text-[10px] text-[#9ca3af] font-mono">
                                {new Date(log.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                              </p>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <div className="flex size-7 items-center justify-center rounded-full bg-[#f0f2f5]">
                                <Shield className="size-3.5 text-[#6b7280]" />
                              </div>
                              <p className="text-xs font-medium text-[#1a1a1a]">{log.adminName}</p>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-[10px] font-semibold gap-1" style={{ borderColor: `${cfg.color}40`, backgroundColor: `${cfg.bg}`, color: cfg.color }}>
                              <ActionIcon className="size-3" />
                              {cfg.label}
                            </Badge>
                          </TableCell>
                          <TableCell className="max-w-[300px]">
                            <p className="text-xs text-[#1a1a1a] truncate" title={log.details}>
                              {log.details}
                            </p>
                          </TableCell>
                          <TableCell className="hidden md:table-cell">
                            <span className="font-mono text-[11px] text-[#9ca3af]">{log.ipAddress}</span>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
              <SimplePagination page={page} totalPages={totalPages} onPageChange={setPage} />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function ActivityLogsPage() {
  return (
    <AdminErrorBoundary fallback="Failed to load activity logs">
      <ActivityLogsPageInner />
    </AdminErrorBoundary>
  )
}

export default ActivityLogsPage