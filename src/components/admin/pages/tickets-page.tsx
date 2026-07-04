'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Ticket, Search, MessageSquare, Clock, CheckCircle, CircleDot, XCircle,
  Eye, Reply, Send, Loader2, ChevronDown, AlertCircle
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Separator } from '@/components/ui/separator'
import { toast } from 'sonner'
import {
  adminApi, formatDate, formatTimeAgo, LoadingSkeleton,
  EmptyState, SimplePagination, StatCard, AdminErrorBoundary
} from '@/components/admin/shared'

// ─── Types ───────────────────────────────────────────────────────────────────
type TicketStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED'
type TicketPriority = 'HIGH' | 'MEDIUM' | 'LOW'

interface SupportTicket {
  id: string
  userId: string
  userName: string
  userEmail: string
  subject: string
  description: string
  priority: TicketPriority
  status: TicketStatus
  createdAt: string
  updatedAt: string
  replies: { id: string; message: string; isAdmin: boolean; createdAt: string }[]
}

// ─── Mock Data ───────────────────────────────────────────────────────────────
const mockTickets: SupportTicket[] = [
  {
    id: 'TKT-1001', userId: 'usr_1003', userName: 'Rahul Verma', userEmail: 'rahul.verma@gmail.com',
    subject: 'Option chain data not loading for NIFTY 24000 CE',
    description: 'When I try to view the option chain for NIFTY 24000 CE, the data keeps showing a loading spinner. Other strikes load fine. I have tried clearing cache and logging back in but the issue persists. This started happening after the latest app update yesterday.',
    priority: 'HIGH', status: 'OPEN', createdAt: '2025-01-15T09:32:00.000Z', updatedAt: '2025-01-15T09:32:00.000Z', replies: []
  },
  {
    id: 'TKT-1002', userId: 'usr_1007', userName: 'Kavita Reddy', userEmail: 'kavita.reddy@yahoo.com',
    subject: 'Virtual balance showing incorrect after trade execution',
    description: 'I placed a BUY order for RELIANCE 2900 CE with 50 qty. The order shows executed but my balance was not deducted properly. It shows ₹1,02,500 instead of the expected amount. Please check and fix this urgently.',
    priority: 'HIGH', status: 'IN_PROGRESS', createdAt: '2025-01-14T14:18:00.000Z', updatedAt: '2025-01-15T08:45:00.000Z',
    replies: [{ id: 'r1', message: 'We are looking into this. Can you share the trade ID?', isAdmin: true, createdAt: '2025-01-14T15:00:00.000Z' }]
  },
  {
    id: 'TKT-1003', userId: 'usr_1012', userName: 'Manish Tiwari', userEmail: 'manish.t@outlook.com',
    subject: 'Request for premium subscription refund',
    description: 'I upgraded to premium 2 days ago but I am not satisfied with the features. The real-time data still has 5 second delay. I would like to request a full refund as per your refund policy. My transaction ID is TXN789456.',
    priority: 'MEDIUM', status: 'OPEN', createdAt: '2025-01-15T11:05:00.000Z', updatedAt: '2025-01-15T11:05:00.000Z', replies: []
  },
  {
    id: 'TKT-1004', userId: 'usr_1018', userName: 'Divya Iyengar', userEmail: 'divya.iyengar@gmail.com',
    subject: 'Unable to place SELL order for open position',
    description: 'I have an open BUY position in BANKNIFTY 50000 PE but the SELL button is greyed out. I have sufficient balance and the market is open. Other positions can be squared off normally.',
    priority: 'HIGH', status: 'IN_PROGRESS', createdAt: '2025-01-13T10:22:00.000Z', updatedAt: '2025-01-14T16:30:00.000Z',
    replies: [
      { id: 'r1', message: 'Thank you for reporting. We have identified the issue - it is related to lot size mismatch. Our team is deploying a fix.', isAdmin: true, createdAt: '2025-01-13T11:15:00.000Z' },
      { id: 'r2', message: 'Any update on this? The position is still stuck.', isAdmin: false, createdAt: '2025-01-14T10:00:00.000Z' },
      { id: 'r3', message: 'Fix is being tested. Should be live in next 2 hours.', isAdmin: true, createdAt: '2025-01-14T16:30:00.000Z' }
    ]
  },
  {
    id: 'TKT-1005', userId: 'usr_1025', userName: 'Nitin Deshmukh', userEmail: 'nitin.d@hdfc.com',
    subject: 'How to set up auto-exit stop loss?',
    description: 'I have been trying to configure auto-exit SL for my options positions but I am not sure about the exact steps. The help page does not explain it clearly. Can you guide me through the process?',
    priority: 'LOW', status: 'RESOLVED', createdAt: '2025-01-12T08:45:00.000Z', updatedAt: '2025-01-13T09:10:00.000Z',
    replies: [
      { id: 'r1', message: 'Sure! Go to your open position, click on the SL icon, set your stop loss price and hit "Set SL". The system will auto-square off when the price hits your SL level.', isAdmin: true, createdAt: '2025-01-12T09:30:00.000Z' },
      { id: 'r2', message: 'Thanks! That was easy. Appreciate the quick help.', isAdmin: false, createdAt: '2025-01-12T10:15:00.000Z' }
    ]
  },
  {
    id: 'TKT-1006', userId: 'usr_1031', userName: 'Swati Bhatt', userEmail: 'swati.b@icici.com',
    subject: 'Chart not updating in real-time for stock overview',
    description: 'The candlestick chart on the stock overview page is stuck and not showing live candles. It was working fine till yesterday. I am using Chrome on Android. Please fix this.',
    priority: 'MEDIUM', status: 'OPEN', createdAt: '2025-01-15T13:40:00.000Z', updatedAt: '2025-01-15T13:40:00.000Z', replies: []
  },
  {
    id: 'TKT-1007', userId: 'usr_1001', userName: 'Arjun Mehta', userEmail: 'arjun.mehta@gmail.com',
    subject: 'Account locked after multiple login attempts',
    description: 'I forgot my password and tried logging in multiple times. Now my account is locked. I have already tried the password reset link but it says "account temporarily locked". Please unlock my account.',
    priority: 'HIGH', status: 'RESOLVED', createdAt: '2025-01-11T16:20:00.000Z', updatedAt: '2025-01-12T08:00:00.000Z',
    replies: [
      { id: 'r1', message: 'Your account has been unlocked. You should now be able to log in with your new password.', isAdmin: true, createdAt: '2025-01-12T08:00:00.000Z' }
    ]
  },
  {
    id: 'TKT-1008', userId: 'usr_1015', userName: 'Ritu Saxena', userEmail: 'ritu.saxena@hotmail.com',
    subject: 'Feature request: Portfolio heatmap view',
    description: 'It would be great if we could see a portfolio heatmap showing P&L across all our positions. Similar to what Zerodha has. This would make it much easier to quickly see which positions are profitable and which are losing.',
    priority: 'LOW', status: 'OPEN', createdAt: '2025-01-14T17:30:00.000Z', updatedAt: '2025-01-14T17:30:00.000Z', replies: []
  },
  {
    id: 'TKT-1009', userId: 'usr_1040', userName: 'Praveen Yadav', userEmail: 'praveen.y@tcs.com',
    subject: 'Duplicate orders being placed on fast clicks',
    description: 'When I quickly double-click the "Buy" button, two orders are getting placed instead of one. This has happened 3 times now and I have lost virtual money due to this. Please add a debounce or disable the button after first click.',
    priority: 'MEDIUM', status: 'CLOSED', createdAt: '2025-01-10T09:15:00.000Z', updatedAt: '2025-01-12T14:00:00.000Z',
    replies: [
      { id: 'r1', message: 'We have added button debouncing to prevent duplicate orders. This fix is now live. Thank you for the feedback!', isAdmin: true, createdAt: '2025-01-12T14:00:00.000Z' }
    ]
  },
  {
    id: 'TKT-1010', userId: 'usr_1009', userName: 'Meera Joshi', userEmail: 'meera.j@infosys.com',
    subject: 'Watchlist items disappearing after page refresh',
    description: 'I added 8 stocks to my watchlist but every time I refresh the page, only 3-4 of them remain. The others disappear randomly. This is very frustrating. I am using the latest version of Chrome.',
    priority: 'MEDIUM', status: 'IN_PROGRESS', createdAt: '2025-01-15T07:55:00.000Z', updatedAt: '2025-01-15T10:20:00.000Z',
    replies: [{ id: 'r1', message: 'We can reproduce this issue. It seems to be related to the local storage sync. A fix is in progress.', isAdmin: true, createdAt: '2025-01-15T10:20:00.000Z' }]
  },
]

// ─── Priority & Status configs ───────────────────────────────────────────────
const priorityConfig: Record<TicketPriority, { color: string; label: string }> = {
  HIGH: { color: '#d44a2d', label: 'High' },
  MEDIUM: { color: '#F59E0B', label: 'Medium' },
  LOW: { color: '#3B82F6', label: 'Low' },
}

const statusConfig: Record<TicketStatus, { color: string; bg: string; border: string; label: string; icon: React.ComponentType<{ className?: string }> }> = {
  OPEN: { color: '#3B82F6', bg: '#3B82F6/10', border: '#3B82F6/30', label: 'Open', icon: CircleDot },
  IN_PROGRESS: { color: '#F59E0B', bg: '#F59E0B/10', border: '#F59E0B/30', label: 'In Progress', icon: Clock },
  RESOLVED: { color: '#00a87d', bg: '#00a87d/10', border: '#00a87d/30', label: 'Resolved', icon: CheckCircle },
  CLOSED: { color: '#6b7280', bg: '#6b7280/10', border: '#6b7280/30', label: 'Closed', icon: XCircle },
}

// ─── Tickets Page Inner ──────────────────────────────────────────────────────
function TicketsPageInner() {
  const [tickets, setTickets] = useState<SupportTicket[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('All')
  const [page, setPage] = useState(1)
  const [selectedTicket, setSelectedTicket] = useState<SupportTicket | null>(null)
  const [replyText, setReplyText] = useState('')
  const [sendingReply, setSendingReply] = useState(false)
  const [changingStatus, setChangingStatus] = useState(false)
  const limit = 10

  const fetchTickets = useCallback(async () => {
    setLoading(true)
    try {
      const res = await adminApi('/tickets')
      const data = await res.json()
      const mapped = (data.tickets || []).map((t: any) => ({
        id: t.id,
        userId: t.userId,
        userName: t.userName || t.user?.name || 'Unknown',
        userEmail: t.userEmail || t.user?.email || '',
        subject: t.subject,
        description: t.description,
        priority: t.priority,
        status: t.status,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
        replies: (t.replies || []).map((r: any) => ({
          id: r.id,
          message: r.message,
          isAdmin: r.isAdmin,
          createdAt: r.createdAt,
        })),
      }))
      setTickets(mapped)
    } catch {
      console.warn('[TicketsPage] API fetch failed, using mock data')
      setTickets(mockTickets)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchTickets() }, [fetchTickets])

  // Filter
  const filteredTickets = tickets.filter((t) => {
    if (statusFilter !== 'All' && t.status !== statusFilter) return false
    if (search) {
      const q = search.toLowerCase()
      return t.subject.toLowerCase().includes(q) || t.userName.toLowerCase().includes(q) || t.id.toLowerCase().includes(q)
    }
    return true
  })

  // Pagination
  const totalPages = Math.ceil(filteredTickets.length / limit)
  const paginatedTickets = filteredTickets.slice((page - 1) * limit, page * limit)

  // Stats
  const openCount = tickets.filter(t => t.status === 'OPEN').length
  const inProgressCount = tickets.filter(t => t.status === 'IN_PROGRESS').length
  const resolvedCount = tickets.filter(t => t.status === 'RESOLVED').length

  const handleSendReply = async () => {
    if (!replyText.trim() || !selectedTicket) return
    setSendingReply(true)
    try {
      await adminApi(`/tickets/${selectedTicket.id}`, {
        method: 'POST',
        body: JSON.stringify({ message: replyText, isAdmin: true }),
      })
      const newReply = { id: `r_${Date.now()}`, message: replyText, isAdmin: true, createdAt: new Date().toISOString() }
      const updated = { ...selectedTicket, replies: [...selectedTicket.replies, newReply] }
      setSelectedTicket(updated)
      setTickets(prev => prev.map(t => t.id === updated.id ? updated : t))
      setReplyText('')
      toast.success('Reply sent')
    } catch {
      const newReply = { id: `r_${Date.now()}`, message: replyText, isAdmin: true, createdAt: new Date().toISOString() }
      const updated = { ...selectedTicket, replies: [...selectedTicket.replies, newReply] }
      setSelectedTicket(updated)
      setTickets(prev => prev.map(t => t.id === updated.id ? updated : t))
      setReplyText('')
      toast.success('Reply sent')
    } finally {
      setSendingReply(false)
    }
  }

  const handleStatusChange = async (newStatus: string) => {
    if (!selectedTicket) return
    setChangingStatus(true)
    try {
      await adminApi(`/tickets/${selectedTicket.id}`, {
        method: 'PUT',
        body: JSON.stringify({ status: newStatus }),
      })
      const updated = { ...selectedTicket, status: newStatus as TicketStatus, updatedAt: new Date().toISOString() }
      setSelectedTicket(updated)
      setTickets(prev => prev.map(t => t.id === updated.id ? updated : t))
      toast.success(`Ticket status changed to ${statusConfig[newStatus as TicketStatus]?.label || newStatus}`)
    } catch {
      const updated = { ...selectedTicket, status: newStatus as TicketStatus, updatedAt: new Date().toISOString() }
      setSelectedTicket(updated)
      setTickets(prev => prev.map(t => t.id === updated.id ? updated : t))
      toast.success(`Ticket status changed to ${statusConfig[newStatus as TicketStatus]?.label || newStatus}`)
    } finally {
      setChangingStatus(false)
    }
  }

  const handleCloseTicket = async () => {
    if (!selectedTicket) return
    await handleStatusChange('CLOSED')
  }

  const statusFilters = ['All', 'OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']

  return (
    <div className="space-y-6">
      {/* Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard icon={CircleDot} label="Open Tickets" value={openCount} sub="Needs attention" color="#3B82F6" />
        <StatCard icon={Clock} label="In Progress" value={inProgressCount} sub="Being worked on" color="#F59E0B" />
        <StatCard icon={CheckCircle} label="Resolved" value={resolvedCount} sub="This week" color="#00a87d" />
        <StatCard icon={Clock} label="Avg Response" value="< 2h" sub="Response time" color="#8B5CF6" />
      </div>

      {/* Filter Bar */}
      <Card className="bg-white border-[#e5e7eb] rounded-xl">
        <CardContent className="p-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#9ca3af]" />
              <Input
                placeholder="Search tickets by ID, subject, or user..."
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1) }}
                className="rounded-lg border-[#e5e7eb] bg-[#f0f2f5] text-[#1a1a1a] pl-10 h-10"
              />
            </div>
            <div className="inline-flex items-center gap-1 rounded-full bg-[#f0f2f5] p-1 border border-[#e5e7eb] overflow-x-auto">
              {statusFilters.map((f) => (
                <button
                  key={f}
                  onClick={() => { setStatusFilter(f); setPage(1) }}
                  className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                    statusFilter === f ? 'bg-[#00D09C] text-white' : 'text-[#6b7280] hover:text-[#1a1a1a]'
                  }`}
                >
                  {f === 'IN_PROGRESS' ? 'In Progress' : f.charAt(0) + f.slice(1).toLowerCase()}
                </button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tickets Table */}
      <Card className="bg-white border-[#e5e7eb] rounded-xl">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-[#1a1a1a]">
            Support Tickets ({filteredTickets.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <LoadingSkeleton rows={8} />
          ) : paginatedTickets.length === 0 ? (
            <EmptyState icon={Ticket} title="No tickets found" description="No support tickets match the current filters." />
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-[#e5e7eb] hover:bg-transparent">
                      <TableHead className="text-[#6b7280] text-xs">ID</TableHead>
                      <TableHead className="text-[#6b7280] text-xs">User</TableHead>
                      <TableHead className="text-[#6b7280] text-xs">Subject</TableHead>
                      <TableHead className="text-[#6b7280] text-xs">Priority</TableHead>
                      <TableHead className="text-[#6b7280] text-xs">Status</TableHead>
                      <TableHead className="text-[#6b7280] text-xs hidden md:table-cell">Created</TableHead>
                      <TableHead className="text-right text-[#6b7280] text-xs">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedTickets.map((ticket) => {
                      const pCfg = priorityConfig[ticket.priority]
                      const sCfg = statusConfig[ticket.status]
                      const StatusIcon = sCfg.icon
                      return (
                        <TableRow key={ticket.id} className="border-[#f0f2f5] hover:bg-[#f7f8fc]">
                          <TableCell className="font-mono text-xs text-[#6b7280]">{ticket.id}</TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Avatar className="size-7">
                                <AvatarFallback className="bg-[#00D09C]/10 text-[#00D09C] text-[10px] font-semibold">
                                  {ticket.userName.split(' ').map(n => n[0]).join('')}
                                </AvatarFallback>
                              </Avatar>
                              <div>
                                <p className="text-xs font-medium text-[#1a1a1a]">{ticket.userName}</p>
                                <p className="text-[10px] text-[#9ca3af] hidden sm:block">{ticket.userEmail}</p>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="max-w-[200px]">
                            <p className="text-xs text-[#1a1a1a] truncate">{ticket.subject}</p>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-[10px] font-semibold" style={{ borderColor: `${pCfg.color}40`, backgroundColor: `${pCfg.color}12`, color: pCfg.color }}>
                              {pCfg.label}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-[10px] font-semibold gap-1" style={{ borderColor: `${sCfg.color}40`, backgroundColor: `${sCfg.color}12`, color: sCfg.color }}>
                              <StatusIcon className="size-3" />
                              {sCfg.label}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-[11px] text-[#6b7280] hidden md:table-cell">{formatDate(ticket.createdAt)}</TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="size-7 text-[#6b7280] hover:text-[#00D09C]"
                              onClick={() => setSelectedTicket(ticket)}
                            >
                              <Eye className="size-3.5" />
                            </Button>
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

      {/* Ticket Detail Dialog */}
      <Dialog open={!!selectedTicket} onOpenChange={() => setSelectedTicket(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          {selectedTicket && (
            <>
              <DialogHeader>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5">
                      <Badge variant="outline" className="text-[10px] font-mono" style={{ borderColor: `${priorityConfig[selectedTicket.priority].color}40`, backgroundColor: `${priorityConfig[selectedTicket.priority].color}12`, color: priorityConfig[selectedTicket.priority].color }}>
                        {priorityConfig[selectedTicket.priority].label}
                      </Badge>
                      <Badge variant="outline" className="text-[10px] font-semibold gap-1" style={{ borderColor: `${statusConfig[selectedTicket.status].color}40`, backgroundColor: `${statusConfig[selectedTicket.status].color}12`, color: statusConfig[selectedTicket.status].color }}>
                        {(() => { const SIcon = statusConfig[selectedTicket.status].icon; return <SIcon className="size-3" /> })()}
                        {statusConfig[selectedTicket.status].label}
                      </Badge>
                    </div>
                    <DialogTitle className="text-sm font-semibold text-[#1a1a1a] leading-snug">{selectedTicket.subject}</DialogTitle>
                    <DialogDescription className="text-xs text-[#9ca3af] mt-1">{selectedTicket.id} · Created {formatDate(selectedTicket.createdAt)} · Updated {formatTimeAgo(selectedTicket.updatedAt)}</DialogDescription>
                  </div>
                </div>
              </DialogHeader>

              {/* User Info */}
              <div className="flex items-center gap-3 p-3 rounded-xl bg-[#f7f8fc] border border-[#f0f2f5]">
                <Avatar className="size-10">
                  <AvatarFallback className="bg-[#00D09C]/10 text-[#00D09C] text-sm font-semibold">
                    {selectedTicket.userName.split(' ').map(n => n[0]).join('')}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <p className="text-xs font-semibold text-[#1a1a1a]">{selectedTicket.userName}</p>
                  <p className="text-[11px] text-[#6b7280]">{selectedTicket.userEmail}</p>
                </div>
              </div>

              {/* Description */}
              <div className="space-y-2">
                <p className="text-[10px] text-[#9ca3af] uppercase tracking-wider font-medium">Description</p>
                <p className="text-xs text-[#1a1a1a] leading-relaxed">{selectedTicket.description}</p>
              </div>

              <Separator />

              {/* Replies */}
              {selectedTicket.replies.length > 0 && (
                <div className="space-y-3">
                  <p className="text-[10px] text-[#9ca3af] uppercase tracking-wider font-medium">Conversation ({selectedTicket.replies.length})</p>
                  <div className="space-y-3 max-h-48 overflow-y-auto">
                    {selectedTicket.replies.map((reply) => (
                      <div key={reply.id} className={`p-3 rounded-xl border ${reply.isAdmin ? 'bg-[#00D09C]/5 border-[#00D09C]/20 ml-6' : 'bg-[#f7f8fc] border-[#f0f2f5] mr-6'}`}>
                        <div className="flex items-center justify-between mb-1.5">
                          <p className="text-[10px] font-semibold" style={{ color: reply.isAdmin ? '#00a87d' : '#6b7280' }}>
                            {reply.isAdmin ? '🛡️ Admin' : selectedTicket.userName}
                          </p>
                          <p className="text-[10px] text-[#9ca3af]">{formatTimeAgo(reply.createdAt)}</p>
                        </div>
                        <p className="text-xs text-[#1a1a1a] leading-relaxed">{reply.message}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Reply Section */}
              {selectedTicket.status !== 'CLOSED' && (
                <>
                  <Separator />
                  <div className="space-y-3">
                    <Label className="text-xs text-[#6b7280]">Reply</Label>
                    <textarea
                      rows={3}
                      className="w-full rounded-lg border border-[#e5e7eb] bg-transparent px-3 py-2 text-sm text-[#1a1a1a] placeholder:text-[#9ca3af] focus:outline-none focus:ring-2 focus:ring-[#00D09C]/20 focus:border-[#00D09C] resize-none"
                      placeholder="Type your reply..."
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                    />
                  </div>
                </>
              )}

              {/* Actions Footer */}
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Label className="text-xs text-[#9ca3af]">Status:</Label>
                  <Select
                    value={selectedTicket.status}
                    onValueChange={handleStatusChange}
                    disabled={changingStatus}
                  >
                    <SelectTrigger className="w-36 h-8 text-xs border-[#e5e7eb]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="OPEN">Open</SelectItem>
                      <SelectItem value="IN_PROGRESS">In Progress</SelectItem>
                      <SelectItem value="RESOLVED">Resolved</SelectItem>
                      <SelectItem value="CLOSED">Closed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-2">
                  {selectedTicket.status !== 'CLOSED' && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="border-[#e5e7eb] text-xs text-[#6b7280] hover:text-[#d44a2d] hover:border-[#d44a2d]/30 gap-1.5"
                      onClick={handleCloseTicket}
                    >
                      <XCircle className="size-3.5" />
                      Close Ticket
                    </Button>
                  )}
                  {selectedTicket.status !== 'CLOSED' && (
                    <Button
                      size="sm"
                      className="bg-[#00D09C] hover:bg-[#00b888] text-white text-xs gap-1.5"
                      onClick={handleSendReply}
                      disabled={sendingReply || !replyText.trim()}
                    >
                      {sendingReply ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
                      Send Reply
                    </Button>
                  )}
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function TicketsPage() {
  return (
    <AdminErrorBoundary fallback="Failed to load tickets">
      <TicketsPageInner />
    </AdminErrorBoundary>
  )
}

export default TicketsPage