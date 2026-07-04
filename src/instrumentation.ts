// Global error handlers to prevent silent server crashes
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    process.on('uncaughtException', (err) => {
      console.error('[UNCAUGHT EXCEPTION]', err.message || String(err))
    })
    process.on('unhandledRejection', (err) => {
      console.error('[UNHANDLED REJECTION]', String(err))
    })
  }
}
