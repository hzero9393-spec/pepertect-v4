/**
 * ═══════════════════════════════════════════════════════════════
 * Upstox Token Provider — Reads from env, DB, or manual cache
 * ═══════════════════════════════════════════════════════════════
 *
 * Priority: manual token > env var > DB platform_settings
 * Caches DB reads for 5 minutes to avoid excessive queries.
 */

import { db } from './db'

let cachedDbToken: string | null = null
let dbTokenFetchedAt = 0
const DB_CACHE_TTL = 5 * 60 * 1000 // 5 minutes

// Manual override token (set via admin API)
let manualToken: string | null = null
let manualTokenSetAt = 0
const MANUAL_TOKEN_TTL = 24 * 60 * 60 * 1000 // 24 hours

/** Set a manual token (from admin API or WS) */
export function setUpstoxToken(token: string) {
  manualToken = token
  manualTokenSetAt = Date.now()
  console.log(`[TokenProvider] Manual token set (prefix: ${token.substring(0, 8)}...)`)
}

/** Get the current best available Upstox access token */
export async function getUpstoxToken(): Promise<string | null> {
  // 1. Manual override (highest priority)
  if (manualToken && (Date.now() - manualTokenSetAt < MANUAL_TOKEN_TTL)) {
    return manualToken
  }

  // 2. Environment variable
  const envToken = process.env.UPSTOX_ACCESS_TOKEN
  if (envToken) return envToken

  // 3. Database (platform_settings table)
  const now = Date.now()
  if (cachedDbToken && (now - dbTokenFetchedAt < DB_CACHE_TTL)) {
    return cachedDbToken
  }

  try {
    const row = await db.platformSettings.findUnique({
      where: { key: 'upstox_access_token' },
      select: { value: true, updatedAt: true },
    })

    if (row?.value) {
      // Check if token is not too old (Upstox tokens expire in 24h)
      const tokenAge = now - new Date(row.updatedAt).getTime()
      if (tokenAge < 24 * 60 * 60 * 1000) {
        cachedDbToken = row.value
        dbTokenFetchedAt = now
        console.log(`[TokenProvider] DB token loaded (prefix: ${row.value.substring(0, 8)}..., age: ${Math.round(tokenAge / 60000)}min)`)
        return row.value
      } else {
        console.warn(`[TokenProvider] DB token is too old (${Math.round(tokenAge / 3600000)}h), skipping`)
      }
    }
  } catch (err) {
    console.error('[TokenProvider] Error reading from DB:', err)
  }

  return null
}

/** Get token info for diagnostics */
export async function getTokenInfo(): Promise<{
  hasEnvToken: boolean
  hasDbToken: boolean
  hasManualToken: boolean
  dbTokenAge: number | null
  dbTokenUpdatedAt: string | null
}> {
  const envToken = !!process.env.UPSTOX_ACCESS_TOKEN

  let hasDbToken = false
  let dbTokenAge: number | null = null
  let dbTokenUpdatedAt: string | null = null

  try {
    const row = await db.platformSettings.findUnique({
      where: { key: 'upstox_access_token' },
      select: { value: true, updatedAt: true },
    })
    if (row?.value) {
      hasDbToken = true
      dbTokenAge = Date.now() - new Date(row.updatedAt).getTime()
      dbTokenUpdatedAt = row.updatedAt.toISOString()
    }
  } catch {}

  return {
    hasEnvToken: envToken,
    hasDbToken,
    hasManualToken: !!manualToken,
    dbTokenAge,
    dbTokenUpdatedAt,
  }
}