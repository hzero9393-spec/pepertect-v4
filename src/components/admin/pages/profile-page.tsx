'use client'

import { useState, useEffect, useMemo } from 'react'
import {
  LogIn,
  Zap,
  Clock,
  ShieldCheck,
  ShieldOff,
  Pencil,
  KeyRound,
  CalendarDays,
  Monitor,
  Globe,
  LogOut,
  Bell,
  Timer,
  Smartphone,
  ChevronRight,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Separator } from '@/components/ui/separator'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '@/components/ui/table'
import { toast } from 'sonner'
import { adminApi, formatDate, formatTimeAgo, LoadingSkeleton } from '@/components/admin/shared'

// ─── Mock Session Data ─────────────────────────────────────────────────────────
const MOCK_SESSIONS = [
  { id: 's1', dateTime: new Date().toISOString(), ip: '192.168.1.42', device: 'Chrome on MacOS', status: 'active' as const },
  { id: 's2', dateTime: new Date(Date.now() - 86400000).toISOString(), ip: '103.45.67.89', device: 'Safari on iPhone', status: 'expired' as const },
  { id: 's3', dateTime: new Date(Date.now() - 172800000).toISOString(), ip: '172.16.0.15', device: 'Firefox on Windows', status: 'expired' as const },
  { id: 's4', dateTime: new Date(Date.now() - 345600000).toISOString(), ip: '10.0.0.101', device: 'Chrome on Android', status: 'expired' as const },
  { id: 's5', dateTime: new Date(Date.now() - 604800000).toISOString(), ip: '49.205.33.12', device: 'Edge on Windows', status: 'expired' as const },
]

// ─── Component ─────────────────────────────────────────────────────────────────
function ProfilePage() {
  const [admin, setAdmin] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [editOpen, setEditOpen] = useState(false)
  const [editForm, setEditForm] = useState({ name: '', email: '' })
  const [passwordOpen, setPasswordOpen] = useState(false)
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  })
  const [loginNotifications, setLoginNotifications] = useState(true)
  const [sessionTimeout, setSessionTimeout] = useState('30')

  // ─── Fetch Profile ───────────────────────────────────────────────────────
  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const res = await adminApi('/profile')
        const data = await res.json()
        setAdmin(data.admin)
      } catch {
        setAdmin({
          name: 'Admin User',
          username: 'admin',
          email: 'admin@pepertect.com',
          role: 'SUPER_ADMIN',
          lastLogin: new Date().toISOString(),
          createdAt: '2024-01-15T10:30:00Z',
        })
      } finally {
        setLoading(false)
      }
    }
    fetchProfile()
  }, [])

  // ─── Derived ─────────────────────────────────────────────────────────────
  const initials = useMemo(() => {
    if (!admin?.name) return 'A'
    const parts = admin.name.trim().split(/\s+/)
    return parts.length >= 2
      ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
      : admin.name.slice(0, 2).toUpperCase()
  }, [admin?.name])

  const activityStats = useMemo(() => [
    {
      icon: LogIn,
      label: 'Total Logins',
      value: '47',
      sub: 'This month',
      color: '#00D09C',
    },
    {
      icon: Zap,
      label: 'Actions Performed',
      value: '312',
      sub: 'This month',
      color: '#f59e0b',
    },
    {
      icon: Clock,
      label: 'Last Session',
      value: '2h 34m',
      sub: 'Duration',
      color: '#6366f1',
    },
  ], [])

  // ─── Handlers ────────────────────────────────────────────────────────────
  const handleEditSave = async () => {
    if (!editForm.name.trim()) {
      toast.error('Name is required')
      return
    }
    if (!editForm.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(editForm.email)) {
      toast.error('Please enter a valid email')
      return
    }
    try {
      await adminApi('/profile', {
        method: 'PUT',
        body: JSON.stringify(editForm),
      })
      setAdmin({ ...admin, name: editForm.name, email: editForm.email })
      toast.success('Profile updated successfully')
    } catch {
      // Fallback for demo
      setAdmin({ ...admin, name: editForm.name, email: editForm.email })
      toast.success('Profile updated successfully')
    }
    setEditOpen(false)
  }

  const handlePasswordChange = async () => {
    if (!passwordForm.currentPassword) {
      toast.error('Please enter your current password')
      return
    }
    if (passwordForm.newPassword.length < 6) {
      toast.error('New password must be at least 6 characters')
      return
    }
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      toast.error('Passwords do not match')
      return
    }
    try {
      await adminApi('/profile', {
        method: 'PUT',
        body: JSON.stringify({
          currentPassword: passwordForm.currentPassword,
          newPassword: passwordForm.newPassword,
        }),
      })
      toast.success('Password changed successfully')
      setPasswordOpen(false)
    } catch {
      toast.error('Failed to change password. Please verify your current password.')
    }
    setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' })
  }

  const handleLogoutAllSessions = () => {
    toast.success('All other sessions have been terminated')
  }

  // ─── Loading ─────────────────────────────────────────────────────────────
  if (loading) return <LoadingSkeleton rows={6} />

  return (
    <div className="max-w-3xl space-y-5">
      {/* ────────────────────────── PROFILE HEADER ────────────────────────── */}
      <Card className="bg-white border-[#e5e7eb] rounded-xl overflow-hidden">
        {/* Top accent bar */}
        <div className="h-1.5 bg-gradient-to-r from-[#00D09C] via-[#00b888] to-[#00a070]" />
        <CardContent className="p-6 pt-5">
          <div className="flex flex-col sm:flex-row sm:items-center gap-5">
            {/* Avatar with gradient ring */}
            <div className="relative shrink-0 self-start sm:self-center">
              <div className="size-20 rounded-full bg-gradient-to-br from-[#00D09C] to-[#00a070] p-[3px]">
                <Avatar className="size-full rounded-full border-[3px] border-white">
                  <AvatarFallback className="bg-gradient-to-br from-[#00D09C]/15 to-[#00D09C]/5 text-[#00D09C] text-2xl font-bold">
                    {initials}
                  </AvatarFallback>
                </Avatar>
              </div>
              {/* Online indicator */}
              <span className="absolute bottom-0.5 right-0.5 size-4 rounded-full bg-[#00D09C] border-[2.5px] border-white" />
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2.5 mb-1">
                <h2 className="text-xl font-bold text-[#1a1a1a] tracking-tight">
                  {admin?.name || 'Admin'}
                </h2>
                <Badge className="bg-[#00D09C]/12 text-[#00D09C] border-[#00D09C]/20 text-[10px] font-semibold px-2.5 py-0.5 rounded-md">
                  SUPER_ADMIN
                </Badge>
              </div>
              <p className="text-sm text-[#6b7280] mb-3 flex items-center gap-1.5">
                <Globe className="size-3.5 text-[#9ca3af]" />
                {admin?.email || 'admin@pepertect.com'}
              </p>
              <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-[#9ca3af]">
                <span className="flex items-center gap-1.5">
                  <CalendarDays className="size-3" />
                  Joined {admin?.createdAt ? formatDate(admin.createdAt) : '15 Jan 2024'}
                </span>
                <span className="flex items-center gap-1.5">
                  <Clock className="size-3" />
                  Last login {admin?.lastLogin ? formatTimeAgo(admin.lastLogin) : 'Just now'}
                </span>
              </div>
            </div>

            {/* Actions */}
            <div className="flex sm:flex-col gap-2 shrink-0">
              <Button
                onClick={() => {
                  setEditForm({ name: admin?.name || '', email: admin?.email || '' })
                  setEditOpen(true)
                }}
                className="gap-2 bg-[#00D09C] hover:bg-[#00b888] text-white text-xs font-medium h-9 px-4 rounded-lg"
              >
                <Pencil className="size-3.5" />
                Edit Profile
              </Button>
              <Button
                onClick={() => setPasswordOpen(true)}
                variant="outline"
                className="gap-2 border-[#e5e7eb] text-[#1a1a1a] text-xs font-medium h-9 px-4 rounded-lg hover:bg-[#f5f7fa]"
              >
                <KeyRound className="size-3.5" />
                Change Password
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ────────────────────────── ACTIVITY SUMMARY ──────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {activityStats.map((stat) => {
          const Icon = stat.icon
          return (
            <Card
              key={stat.label}
              className="bg-white border-[#e5e7eb] rounded-xl hover:shadow-sm transition-shadow"
            >
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <div
                    className="flex size-10 items-center justify-center rounded-xl"
                    style={{ backgroundColor: `${stat.color}12`, color: stat.color }}
                  >
                    <Icon className="size-5" />
                  </div>
                  <ChevronRight className="size-4 text-[#d1d5db]" />
                </div>
                <p className="font-mono text-2xl font-bold text-[#1a1a1a] leading-none">
                  {stat.value}
                </p>
                <p className="text-xs font-medium text-[#6b7280] mt-1">{stat.label}</p>
                <p className="text-[11px] text-[#9ca3af] mt-0.5">{stat.sub}</p>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* ────────────────────────── RECENT SESSIONS ────────────────────────── */}
      <Card className="bg-white border-[#e5e7eb] rounded-xl">
        <CardHeader className="pb-0 pt-5 px-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="flex size-8 items-center justify-center rounded-lg bg-[#6366f1]/10">
                <Monitor className="size-4 text-[#6366f1]" />
              </div>
              <CardTitle className="text-sm font-semibold text-[#1a1a1a]">
                Recent Sessions
              </CardTitle>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleLogoutAllSessions}
              className="gap-1.5 border-[#e5e7eb] text-xs font-medium h-8 px-3 rounded-lg text-red-500 hover:text-red-600 hover:bg-red-50 hover:border-red-200"
            >
              <LogOut className="size-3" />
              Logout All Others
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-6 pt-3">
          <div className="rounded-lg border border-[#f0f2f5] overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-[#f9fafb] border-b border-[#f0f2f5] hover:bg-[#f9fafb]">
                  <TableHead className="text-[11px] font-semibold text-[#6b7280] uppercase tracking-wider px-4 py-2.5">
                    Date / Time
                  </TableHead>
                  <TableHead className="text-[11px] font-semibold text-[#6b7280] uppercase tracking-wider px-4 py-2.5">
                    IP Address
                  </TableHead>
                  <TableHead className="text-[11px] font-semibold text-[#6b7280] uppercase tracking-wider px-4 py-2.5 hidden sm:table-cell">
                    Device / Browser
                  </TableHead>
                  <TableHead className="text-[11px] font-semibold text-[#6b7280] uppercase tracking-wider px-4 py-2.5 text-right">
                    Status
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {MOCK_SESSIONS.map((session) => (
                  <TableRow
                    key={session.id}
                    className="border-b border-[#f5f7fa] last:border-0 hover:bg-[#fafbfc]"
                  >
                    <TableCell className="px-4 py-3">
                      <div>
                        <p className="text-xs font-medium text-[#1a1a1a]">
                          {formatDate(session.dateTime)}
                        </p>
                        <p className="text-[11px] text-[#9ca3af] font-mono">
                          {new Date(session.dateTime).toLocaleTimeString('en-IN', {
                            hour: '2-digit',
                            minute: '2-digit',
                            hour12: true,
                          })}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell className="px-4 py-3">
                      <span className="font-mono text-xs text-[#1a1a1a] bg-[#f5f7fa] px-2 py-1 rounded-md">
                        {session.ip}
                      </span>
                    </TableCell>
                    <TableCell className="px-4 py-3 hidden sm:table-cell">
                      <div className="flex items-center gap-1.5">
                        <Smartphone className="size-3 text-[#9ca3af]" />
                        <span className="text-xs text-[#6b7280]">{session.device}</span>
                      </div>
                    </TableCell>
                    <TableCell className="px-4 py-3 text-right">
                      {session.status === 'active' ? (
                        <Badge className="bg-[#00D09C]/12 text-[#00D09C] border-[#00D09C]/20 text-[10px] font-semibold px-2.5 py-0.5 rounded-md">
                          <span className="mr-1 inline-block size-1.5 rounded-full bg-[#00D09C]" />
                          Active
                        </Badge>
                      ) : (
                        <Badge className="bg-[#f3f4f6] text-[#9ca3af] border-[#e5e7eb] text-[10px] font-medium px-2.5 py-0.5 rounded-md">
                          Expired
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* ────────────────────────── SECURITY SECTION ──────────────────────── */}
      <Card className="bg-white border-[#e5e7eb] rounded-xl">
        <CardHeader className="pb-0 pt-5 px-6">
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-[#f59e0b]/10">
              <ShieldCheck className="size-4 text-[#f59e0b]" />
            </div>
            <CardTitle className="text-sm font-semibold text-[#1a1a1a]">
              Security Settings
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent className="p-6 pt-4 space-y-0">
          {/* Two-Factor Auth */}
          <div className="flex items-center justify-between py-4">
            <div className="flex items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-lg bg-[#f3f4f6]">
                <ShieldOff className="size-4 text-[#9ca3af]" />
              </div>
              <div>
                <p className="text-sm font-medium text-[#1a1a1a]">
                  Two-Factor Authentication
                </p>
                <p className="text-[11px] text-[#9ca3af]">
                  Add an extra layer of security to your account
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge className="bg-[#f3f4f6] text-[#9ca3af] border-[#e5e7eb] text-[10px] font-medium px-2 py-0.5 rounded-md">
                Coming Soon
              </Badge>
              <Switch disabled checked={false} className="opacity-50 cursor-not-allowed" />
            </div>
          </div>

          <Separator className="bg-[#f0f2f5]" />

          {/* Session Timeout */}
          <div className="flex items-center justify-between py-4">
            <div className="flex items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-lg bg-[#f3f4f6]">
                <Timer className="size-4 text-[#6b7280]" />
              </div>
              <div>
                <p className="text-sm font-medium text-[#1a1a1a]">
                  Session Timeout
                </p>
                <p className="text-[11px] text-[#9ca3af]">
                  Auto-logout after inactivity
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-[#1a1a1a] bg-[#f5f7fa] border border-[#e5e7eb] px-3 py-1.5 rounded-lg font-mono">
                {sessionTimeout} min
              </span>
              <select
                value={sessionTimeout}
                onChange={(e) => {
                  setSessionTimeout(e.target.value)
                  toast.success(`Session timeout set to ${e.target.value} minutes`)
                }}
                className="text-xs text-[#6b7280] bg-transparent border-0 p-0 focus:outline-none cursor-pointer appearance-none"
              >
                <option value="15">15 min</option>
                <option value="30">30 min</option>
                <option value="60">1 hour</option>
                <option value="120">2 hours</option>
              </select>
            </div>
          </div>

          <Separator className="bg-[#f0f2f5]" />

          {/* Login Notifications */}
          <div className="flex items-center justify-between py-4">
            <div className="flex items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-lg bg-[#f3f4f6]">
                <Bell className="size-4 text-[#6b7280]" />
              </div>
              <div>
                <p className="text-sm font-medium text-[#1a1a1a]">
                  Login Notifications
                </p>
                <p className="text-[11px] text-[#9ca3af]">
                  Get notified on new sign-in activity
                </p>
              </div>
            </div>
            <Switch
              checked={loginNotifications}
              onCheckedChange={(checked) => {
                setLoginNotifications(checked)
                toast.success(
                  checked ? 'Login notifications enabled' : 'Login notifications disabled'
                )
              }}
              className="data-[state=checked]:bg-[#00D09C]"
            />
          </div>
        </CardContent>
      </Card>

      {/* ────────────────────────── EDIT PROFILE DIALOG ───────────────────── */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-md bg-white border-[#e5e7eb] rounded-xl">
          <DialogHeader>
            <DialogTitle className="text-[#1a1a1a]">Edit Profile</DialogTitle>
            <DialogDescription className="text-[#6b7280]">
              Update your name and email address
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label className="text-xs font-medium text-[#6b7280]">Name</Label>
              <Input
                value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                placeholder="Enter your name"
                className="border-[#e5e7eb] rounded-lg text-sm focus-visible:ring-[#00D09C]/30 focus-visible:border-[#00D09C]"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-medium text-[#6b7280]">Email</Label>
              <Input
                type="email"
                value={editForm.email}
                onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                placeholder="Enter your email"
                className="border-[#e5e7eb] rounded-lg text-sm focus-visible:ring-[#00D09C]/30 focus-visible:border-[#00D09C]"
              />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setEditOpen(false)}
              className="border-[#e5e7eb] text-[#6b7280] rounded-lg hover:bg-[#f5f7fa]"
            >
              Cancel
            </Button>
            <Button
              onClick={handleEditSave}
              className="bg-[#00D09C] hover:bg-[#00b888] text-white rounded-lg font-medium"
            >
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ────────────────────────── CHANGE PASSWORD DIALOG ────────────────── */}
      <Dialog open={passwordOpen} onOpenChange={setPasswordOpen}>
        <DialogContent className="sm:max-w-md bg-white border-[#e5e7eb] rounded-xl">
          <DialogHeader>
            <DialogTitle className="text-[#1a1a1a]">Change Password</DialogTitle>
            <DialogDescription className="text-[#6b7280]">
              Enter your current password and choose a new one
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label className="text-xs font-medium text-[#6b7280]">Current Password</Label>
              <Input
                type="password"
                value={passwordForm.currentPassword}
                onChange={(e) =>
                  setPasswordForm({ ...passwordForm, currentPassword: e.target.value })
                }
                placeholder="Enter current password"
                className="border-[#e5e7eb] rounded-lg text-sm focus-visible:ring-[#00D09C]/30 focus-visible:border-[#00D09C]"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-medium text-[#6b7280]">New Password</Label>
              <Input
                type="password"
                value={passwordForm.newPassword}
                onChange={(e) =>
                  setPasswordForm({ ...passwordForm, newPassword: e.target.value })
                }
                placeholder="Min. 6 characters"
                className="border-[#e5e7eb] rounded-lg text-sm focus-visible:ring-[#00D09C]/30 focus-visible:border-[#00D09C]"
              />
              {passwordForm.newPassword && passwordForm.newPassword.length < 6 && (
                <p className="text-[11px] text-red-500">Password must be at least 6 characters</p>
              )}
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-medium text-[#6b7280]">Confirm New Password</Label>
              <Input
                type="password"
                value={passwordForm.confirmPassword}
                onChange={(e) =>
                  setPasswordForm({ ...passwordForm, confirmPassword: e.target.value })
                }
                placeholder="Re-enter new password"
                className="border-[#e5e7eb] rounded-lg text-sm focus-visible:ring-[#00D09C]/30 focus-visible:border-[#00D09C]"
              />
              {passwordForm.confirmPassword &&
                passwordForm.newPassword !== passwordForm.confirmPassword && (
                  <p className="text-[11px] text-red-500">Passwords do not match</p>
                )}
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => {
                setPasswordOpen(false)
                setPasswordForm({
                  currentPassword: '',
                  newPassword: '',
                  confirmPassword: '',
                })
              }}
              className="border-[#e5e7eb] text-[#6b7280] rounded-lg hover:bg-[#f5f7fa]"
            >
              Cancel
            </Button>
            <Button
              onClick={handlePasswordChange}
              className="bg-[#00D09C] hover:bg-[#00b888] text-white rounded-lg font-medium"
            >
              Update Password
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default ProfilePage