import jwt from 'jsonwebtoken'

const JWT_SECRET = process.env.JWT_SECRET || 'pepertect-fallback-secret-key'

export interface JwtPayload {
  userId: string
  email: string
  role: string
}

export function verifyToken(token: string): JwtPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as JwtPayload
  } catch {
    return null
  }
}

export function getTokenFromAuthHeader(authHeader: string | null | undefined): string | null {
  if (!authHeader) return null
  if (authHeader.startsWith('Bearer ')) return authHeader.slice(7)
  return null
}