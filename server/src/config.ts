// ─── Server Configuration ────────────────────────────────────────────────────

export const config = {
  port: parseInt(process.env.PORT || '4000', 10),
  wsPath: process.env.WS_PATH || '/ws',
  corsOrigin: process.env.CORS_ORIGIN || 'https://pepertect-v2.vercel.app',
  jwtSecret: process.env.JWT_SECRET || 'pepertect-fallback-secret-key',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  nodeEnv: process.env.NODE_ENV || 'development',
  databaseUrl: process.env.DATABASE_URL!,
  upstoxAccessToken: process.env.UPSTOX_ACCESS_TOKEN || '',
  upstoxApiKey: process.env.UPSTOX_API_KEY || '',
  upstoxApiSecret: process.env.UPSTOX_API_SECRET || '',
  brokeragePercent: parseFloat(process.env.BROKERAGE_PERCENT || '0.0005'),
  minBrokerage: parseFloat(process.env.MIN_BROKERAGE || '20'),
  maxBrokerage: parseFloat(process.env.MAX_BROKERAGE || '500'),
  maxOrderVolume: parseInt(process.env.MAX_ORDER_VOLUME || '10000', 10),
  futuresMarginPercent: parseFloat(process.env.DEFAULT_FUTURES_MARGIN_PERCENT || '12'),
  optionsShortMarginPercent: parseFloat(process.env.DEFAULT_OPTIONS_SHORT_MARGIN_PERCENT || '150'),
} as const

export const isDev = config.nodeEnv === 'development'