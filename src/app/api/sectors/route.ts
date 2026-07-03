import { db } from '@/lib/db'
import { NextResponse } from 'next/server'

// Force dynamic
export const dynamic = 'force-dynamic'
export const revalidate = 0

// ─── In-memory cache (5min TTL) ───────────────────────────────────────────
// Sectors rarely change — caching eliminates thousands of redundant DB queries.
let cachedResponse: { data: any; expiresAt: number } | null = null
const CACHE_TTL = 300_000 // 5 minutes

export async function GET() {
  try {
    const now = Date.now()
    if (cachedResponse && cachedResponse.expiresAt > now) {
      return NextResponse.json(cachedResponse.data)
    }

    const sectors = await db.sector.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    })

    const responseData = {
      success: true,
      data: sectors,
    }

    cachedResponse = { data: responseData, expiresAt: Date.now() + CACHE_TTL }

    return NextResponse.json(responseData)
  } catch (error) {
    console.error('[API /sectors] Error:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to fetch sectors' },
      { status: 500 }
    )
  }
}