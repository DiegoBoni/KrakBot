require('dotenv').config()

const { createBot } = require('./bot/index')
const sessionManager = require('./utils/sessionManager')
const logger = require('./utils/logger')
const { validateAll } = require('./utils/cliValidator')
const { AGENTS } = require('./agents/router')

async function main() {
  logger.info('🚀 Telegram AI Gateway arrancando...')

  // Validate CLI binaries and API key env vars before accepting requests.
  // Non-fatal: bot still launches even if some CLIs are missing.
  global.__cliStatus = validateAll(AGENTS)

  const bot = createBot()

  // Periodic cleanup of stale sessions (every hour)
  const cleanupInterval = setInterval(() => {
    sessionManager.cleanup()
    logger.debug(`Active sessions: ${sessionManager.size}`)
  }, 60 * 60 * 1000)

  // Graceful shutdown
  const shutdown = (signal) => {
    logger.info(`${signal} recibido — apagando bot...`)
    clearInterval(cleanupInterval)
    bot.stop(signal)
    process.exit(0)
  }

  process.once('SIGINT',  () => shutdown('SIGINT'))
  process.once('SIGTERM', () => shutdown('SIGTERM'))

  await bot.launch({
    dropPendingUpdates: true,
  })

  // Register the "/" command menu visible in Telegram clients
  await bot.telegram.setMyCommands([
    { command: 'start',   description: 'Bienvenida e instrucciones' },
    { command: 'agentes', description: 'Ver agentes disponibles' },
    { command: 'claude',  description: 'Cambiar agente a Claude' },
    { command: 'gemini',  description: 'Cambiar agente a Gemini' },
    { command: 'codex',   description: 'Cambiar agente a Codex' },
    { command: 'sesion',  description: 'Info de la sesión actual' },
    { command: 'limpiar', description: 'Borrar historial de la sesión' },
    { command: 'ayuda',   description: 'Instrucciones de uso' },
    { command: 'ping',    description: 'Health check de los agentes' },
  ])

  logger.info(`✅ Bot corriendo: @${bot.botInfo?.username ?? 'unknown'}`)
}

main().catch((err) => {
  console.error('💥 Error fatal al arrancar:', err.message)
  process.exit(1)
})
