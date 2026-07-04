// ─── WebSocket Message Types ────────────────────────────────────────────

export interface WSMessage {
  type: string
  data?: any
}

// Client → Server messages
export type ClientMessage =
  | { type: 'ping' }
  | { type: 'subscribe'; channels: string[] }  // channels: 'market', 'positions', 'oc:NIFTY::2026-07-07'
  | { type: 'unsubscribe'; channels: string[] }

// Server → Client messages
export interface ServerMessage {
  type: 'pong' | 'auth:success' | 'auth:error' | 'error' | 'subscribed' | 'unsubscribed'
  | 'market:indices' | 'market:stocks' | 'market:tick'
  | 'positions:update' | 'positions:exit'
  | 'oc:update' | 'oc:spot'
  | 'trade:order' | 'trade:squareoff'
  data?: any
}

export interface ConnectedClient {
  id: string
  ws: import('ws').WebSocket
  userId: string
  userEmail: string
  userRole: string
  channels: Set<string>
  isAuthenticated: boolean
  lastPing: number
  isConnected: boolean
}