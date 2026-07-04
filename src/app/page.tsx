'use client'

import { useEffect, useState } from 'react'
import { AppShell } from '@/components/pepertect/app-shell'
import dynamic from 'next/dynamic'

const AdminShell = dynamic(() => import('@/components/admin/admin-shell'), { ssr: false })

export default function Home() {
  const [isAdmin, setIsAdmin] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    const checkHash = () => {
      setIsAdmin(window.location.hash === '#admin')
    }
    checkHash()
    window.addEventListener('hashchange', checkHash)
    return () => window.removeEventListener('hashchange', checkHash)
  }, [])

  if (!mounted) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#f5f7fa' }}>
        <div className="flex flex-col items-center gap-3">
          <div className="size-10 rounded-xl animate-pulse" style={{ background: '#00D09C' }} />
          <p className="text-sm text-[#6b7280]">Loading...</p>
        </div>
      </div>
    )
  }

  if (isAdmin) {
    return <AdminShell />
  }

  return <AppShell />
}