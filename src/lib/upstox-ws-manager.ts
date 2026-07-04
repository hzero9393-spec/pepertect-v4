// ─── Backward Compatibility ──────────────────────────────────────────────
// This module has been replaced by market-data-manager.ts
// All imports are redirected to the new module

export { getMarketDataManager as getUpstoxWsManager, type MarketUpdate, type UpdateHandler } from '@/lib/market-data-manager'
