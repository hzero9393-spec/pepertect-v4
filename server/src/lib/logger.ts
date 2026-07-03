const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 }
const level = LOG_LEVELS[process.env.LOG_LEVEL as keyof typeof LOG_LEVELS] ?? LOG_LEVELS.info

export const logger = {
  debug: (...args: any[]) => level <= 0 && console.debug('[DEBUG]', ...args),
  info: (...args: any[]) => level <= 1 && console.log('[INFO]', ...args),
  warn: (...args: any[]) => level <= 2 && console.warn('[WARN]', ...args),
  error: (...args: any[]) => level <= 3 && console.error('[ERROR]', ...args),
}