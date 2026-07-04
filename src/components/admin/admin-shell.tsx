'use client'

import { useState, useEffect } from 'react'
import AdminPanel from './admin-panel'

// ─── Admin Login Page ──────────────────────────────────────────────────
function AdminLogin({ onLogin }: { onLogin: () => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!username || !password) return
    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/admin/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })
      const data = await res.json()
      if (res.ok && data.token) {
        localStorage.setItem('admin_token', data.token)
        localStorage.setItem('admin_data', JSON.stringify(data.admin))
        onLogin()
      } else {
        setError(data.error || 'Invalid credentials')
      }
    } catch {
      setError('Connection failed. Try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: '#f5f7fa' }}>
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex size-14 items-center justify-center rounded-2xl mb-4" style={{ background: '#00D09C' }}>
            <svg className="size-7 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" /><polyline points="16 7 22 7 22 13" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-[#1a1a1a]">Pepertect Admin</h1>
          <p className="text-sm text-[#6b7280] mt-1">Sign in to access the admin panel</p>
        </div>

        {/* Login Card */}
        <div className="bg-white rounded-2xl border border-[#e5e7eb] p-6 shadow-sm">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-[#374151] mb-1.5">Username</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter username"
                className="w-full h-10 px-3 rounded-lg border border-[#e5e7eb] bg-[#f9fafb] text-sm text-[#1a1a1a] placeholder:text-[#9ca3af] focus:outline-none focus:ring-2 focus:ring-[#00D09C]/20 focus:border-[#00D09C] transition-all"
                autoComplete="username"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#374151] mb-1.5">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
                className="w-full h-10 px-3 rounded-lg border border-[#e5e7eb] bg-[#f9fafb] text-sm text-[#1a1a1a] placeholder:text-[#9ca3af] focus:outline-none focus:ring-2 focus:ring-[#00D09C]/20 focus:border-[#00D09C] transition-all"
                autoComplete="current-password"
              />
            </div>

            {error && (
              <div className="bg-red-50 border border-red-100 rounded-lg px-3 py-2.5">
                <p className="text-xs text-red-600 font-medium">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !username || !password}
              className="w-full h-10 rounded-lg text-sm font-semibold text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ background: loading || !username || !password ? '#9ca3af' : '#00D09C' }}
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin size-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Signing in...
                </span>
              ) : 'Sign In'}
            </button>
          </form>
        </div>

        <p className="text-center text-[11px] text-[#9ca3af] mt-6">
          Pepertect Trading Platform &middot; Admin Access Only
        </p>
      </div>
    </div>
  )
}

// ─── Admin Shell (Entry Point for #admin) ──────────────────────────────
export default function AdminShell() {
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [verifying, setVerifying] = useState(true)

  useEffect(() => {
    const token = localStorage.getItem('admin_token')
    if (token) {
      // Verify token is still valid
      fetch('/api/admin/auth/verify', {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then((res) => {
          if (res.ok) {
            setIsLoggedIn(true)
          } else {
            localStorage.removeItem('admin_token')
            localStorage.removeItem('admin_data')
          }
        })
        .catch(() => {
          // If verify fails, still try to show panel (offline support)
          setIsLoggedIn(true)
        })
        .finally(() => setVerifying(false))
    } else {
      setVerifying(false)
    }
  }, [])

  if (verifying) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#f5f7fa' }}>
        <div className="flex flex-col items-center gap-3">
          <div className="size-10 rounded-xl animate-pulse" style={{ background: '#00D09C' }} />
          <p className="text-sm text-[#6b7280]">Verifying access...</p>
        </div>
      </div>
    )
  }

  if (!isLoggedIn) {
    return <AdminLogin onLogin={() => setIsLoggedIn(true)} />
  }

  return <AdminPanel onLogout={() => setIsLoggedIn(false)} />
}